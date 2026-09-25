import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useCollisionAnalysis } from './useCollisionAnalysis'
import { PRESETS } from '../data/presets'
import { analyzeChoreography } from '../core/choreography'
import type { Choreography } from '../core/types'

// 让 analyzeChoreography 可被按需替换为抛错实现，用于确定性覆盖“计算报错”
vi.mock('../core/choreography', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/choreography')>()
  return { ...actual, analyzeChoreography: vi.fn(actual.analyzeChoreography) }
})

const analyzeMock = vi.mocked(analyzeChoreography)
const realAnalyze = analyzeMock.getMockImplementation()!

/**
 * 主线程版本协议测试（jsdom 无 Worker 时走同步兜底分支，版本核对逻辑一致）：
 * 编辑产生新版本后，旧版本的迟到结果必须被丢弃；计算报错必须有明确失败状态与重试。
 */
describe('useCollisionAnalysis 版本号协议', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    analyzeMock.mockImplementation(realAnalyze)
  })
  afterEach(() => vi.useRealTimers())

  const flush = () => vi.advanceTimersByTime(10)
  /** scheduleRun 有 60ms 防抖，兜底计算再延后一个 0ms 宏任务 */
  const flushScheduled = () => vi.advanceTimersByTime(61)

  it('合法编排：run 后版本递增并产出报告', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const { version, report, issues, computing, run } = useCollisionAnalysis(() => c)

    run()
    expect(version.value).toBe(1)
    expect(computing.value).toBe(true)
    flush()
    expect(computing.value).toBe(false)
    expect(issues.value).toEqual([])
    expect(report.value?.reports.length).toBe(1)
  })

  it('校验失败：版本仍递增，但不出报告', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const { version, report, issues, run } = useCollisionAnalysis(() => c)
    run()
    flush()
    expect(version.value).toBe(1)

    c.pop() // 只剩 1 名舞者
    run()
    expect(version.value).toBe(2)
    flush()
    expect(report.value).toBeNull()
    expect(issues.value.length).toBeGreaterThan(0)
  })

  it('连续编辑：旧版本的迟到结果按版本号丢弃，只保留最后一次', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const { version, report, run } = useCollisionAnalysis(() => c)

    run()
    const v1 = version.value
    expect(v1).toBe(1)

    // 第一次结果尚未回来时立刻再编辑（首版半径 0 安全，次版半径 1 冲突）
    c.forEach((d) => (d.radius = 0))
    run()
    expect(version.value).toBe(2)
    flush() // 只冲刷一次：兜底任务核对版本，v1 从未入队结果，v2 结果生效
    expect(report.value).not.toBeNull()
    // 次版（半径 0）精确相遇 d²=0 仍冲突，故仍有一条；再验证一次"改到安全编排"旧结果被作废
    const safe: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    safe[1].waypoints.forEach((w) => (w.y += 5)) // 错开 5 个单位，零半径无冲突
    c.splice(0, c.length, ...safe)
    run()
    const v3 = version.value
    expect(v3).toBe(3)
    // v2 的迟到结果若在此刻回来：模拟兜底 setTimeout 已被新版本标记拒绝
    flush()
    expect(report.value?.reports).toEqual([])
  })

  it('拖动间隔：scheduleRun 同步作废——防抖结束前版本已递增、旧报告清空、状态为分析中', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const ua = useCollisionAnalysis(() => c)
    ua.run()
    flush()
    expect(ua.report.value).not.toBeNull()

    // 拖动路径：在任何计时器触发前，旧碰撞标记与证据就必须随旧版本一起作废
    c[0].waypoints[1]!.x += 20
    ua.scheduleRun()
    expect(ua.version.value).toBe(2)
    expect(ua.report.value).toBeNull()
    expect(ua.computing.value).toBe(true)
    expect(ua.error.value).toBeNull()
    expect(ua.issues.value).toEqual([])

    // 60ms 防抖内的报告到达（版本号为 1）一律视为旧结果丢弃
    flushScheduled()
    expect(ua.report.value).not.toBeNull()
    expect(ua.computing.value).toBe(false)
  })

  it('备用路径：只计算发起瞬间的快照，防抖期内的再次修改不会被当作先前版本的结果', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const ua = useCollisionAnalysis(() => c)

    // 发起 v2：改成零半径且 y 错开 50 的安全编排，快照此刻定格
    const safe: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    safe.forEach((d) => (d.radius = 0))
    safe[1].waypoints.forEach((w) => (w.y += 50))
    c.splice(0, c.length, ...safe)
    ua.scheduleRun()
    const v2 = ua.version.value

    // 计算尚未开始（60ms 防抖窗口），又把当前路径改成必然冲突
    c[0].radius = 90
    c[1].radius = 90

    flushScheduled()
    expect(ua.version.value).toBe(v2)
    expect(ua.computing.value).toBe(false)
    // 结果必须来自发起时快照（安全），而不是后来 radius=90 的路径
    expect(ua.report.value?.reports).toEqual([])

    // 再编辑后分析恢复正常：这次读到的就是新路径
    ua.scheduleRun()
    flushScheduled()
    expect(ua.report.value?.reports.length).toBe(1)
  })

  it('备用路径：校验失败同步可见，不产生报告', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const ua = useCollisionAnalysis(() => c)
    c.pop()
    ua.scheduleRun()
    expect(ua.version.value).toBe(1)
    expect(ua.issues.value.length).toBeGreaterThan(0)
    expect(ua.report.value).toBeNull()
    vi.advanceTimersByTime(61)
    expect(ua.computing.value).toBe(false)
    expect(ua.report.value).toBeNull()
  })

  it('备用路径：计算抛错时有明确失败状态；重试得到新结果；再编辑恢复正常', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const ua = useCollisionAnalysis(() => c)

    analyzeMock.mockImplementationOnce(() => {
      throw new Error('bigint exploded')
    })
    ua.run()
    flush()
    expect(ua.computing.value).toBe(false)
    expect(ua.error.value).toBe('bigint exploded')
    expect(ua.report.value).toBeNull()

    // 重试：新版本、错误清除、走真实计算
    ua.retry()
    expect(ua.version.value).toBe(2)
    expect(ua.computing.value).toBe(true)
    expect(ua.error.value).toBeNull()
    flush()
    expect(ua.computing.value).toBe(false)
    expect(ua.report.value).not.toBeNull()

    // 失败之后再编辑：error 被同步清掉，正常出结果
    analyzeMock.mockImplementationOnce(() => {
      throw new Error('again')
    })
    ua.run()
    flush()
    expect(ua.error.value).toBe('again')
    c[0].waypoints[1]!.x += 1
    ua.scheduleRun()
    expect(ua.error.value).toBeNull()
    expect(ua.computing.value).toBe(true)
    flushScheduled()
    expect(ua.error.value).toBeNull()
    expect(ua.report.value).not.toBeNull()
  })
})
