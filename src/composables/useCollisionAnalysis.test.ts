import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useCollisionAnalysis } from './useCollisionAnalysis'
import { PRESETS } from '../data/presets'
import type { Choreography } from '../core/types'

/**
 * 主线程版本协议测试（jsdom 无 Worker 时走同步兜底分支，版本核对逻辑一致）：
 * 编辑产生新版本后，旧版本的迟到结果必须被丢弃。
 */
describe('useCollisionAnalysis 版本号协议', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const flush = () => vi.advanceTimersByTime(10)

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
})
