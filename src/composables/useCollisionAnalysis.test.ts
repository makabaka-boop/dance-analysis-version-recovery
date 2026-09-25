import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  useCollisionAnalysis,
  type AnalysisWorkerLike
} from './useCollisionAnalysis'
import { PRESETS } from '../data/presets'
import type { Choreography } from '../core/types'
import type { AnalyzeRequest, AnalyzeResponse } from '../workers/analysis.worker'

/**
 * 可控计时的假分析工作进程：
 * - 每次 postMessage 只记录最近一次请求；结果由测试显式 deliver 回来（模拟迟到）；
 * - deliverCrash / deliverComputeError 覆盖 worker.onerror 与计算报错两种故障；
 * - failNextFactory 让"下一次重建出来的 Worker"一 postMessage 就崩溃，模拟故障后重试。
 */
class FakeWorker implements AnalysisWorkerLike {
  onmessage: ((e: { data: AnalyzeResponse }) => void) | null = null
  onerror: ((e: { message?: string }) => void) | null = null
  onmessageerror: ((e: { message?: string }) => void) | null = null
  lastRequest: AnalyzeRequest | null = null
  postCount = 0
  terminated = false

  static crashOnce = false

  postMessage(message: AnalyzeRequest) {
    this.postCount++
    if (FakeWorker.crashOnce) {
      FakeWorker.crashOnce = false
      this.onerror?.({ message: '模拟工作进程崩溃' })
    }
    this.lastRequest = message
  }

  /** 把当前请求的结果送回主线程（模拟 Worker 完成计算） */
  deliver(overrideVersion?: number) {
    const req = this.lastRequest
    if (!req) throw new Error('没有在途请求')
    // 真实 Worker 计算用的就是 postMessage 时的快照
    this.onmessage?.({
      data: { type: 'result', version: overrideVersion ?? req.version, report: analyze(req.choreography) }
    })
  }

  /** 工作进程级错误（onerror）：消息通道直接坏掉 */
  deliverCrash(message = '模拟工作进程错误') {
    this.onerror?.({ message })
  }

  /** 计算抛错：Worker 内部捕获后回 type=error 消息 */
  deliverComputeError(message = '模拟计算失败') {
    this.onmessage?.({
      data: { type: 'error', version: this.lastRequest?.version ?? -1, message }
    })
  }

  terminate() {
    this.terminated = true
  }
}

// 假 Worker 内复用真实分析逻辑，产出与主线程一致的 DTO
import { analyzeChoreography } from '../core/choreography'
function analyze(c: Choreography) {
  return analyzeChoreography(c)
}

function makeWorkerFactory() {
  const created: FakeWorker[] = []
  return {
    created,
    factory: () => {
      const w = new FakeWorker()
      created.push(w)
      return w
    }
  }
}

describe('useCollisionAnalysis 版本号协议（主线程兜底）', () => {
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

describe('useCollisionAnalysis 拖动间隔 / 迟到结果 / 故障 / 兜底快照', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWorker.crashOnce = false
  })
  afterEach(() => vi.useRealTimers())

  it('拖动后到重算前：旧碰撞标记立即撤下，界面进入"分析中 v新版本"，防抖内不发起计算', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const { factory, created } = makeWorkerFactory()
    const { version, report, reportVersion, computing, run, schedule } =
      useCollisionAnalysis(() => c, { debounceMs: 60, createWorker: factory })

    run()
    const w0 = created[0]
    expect(w0.lastRequest?.version).toBe(1)
    w0.deliver()
    expect(report.value).not.toBeNull()
    expect(reportVersion.value).toBe(1)

    // 指导拖动路径：编辑瞬间旧版本标记整体作废
    c[0].waypoints[1].x = 99
    schedule()
    expect(version.value).toBe(2)
    expect(report.value).toBeNull()
    expect(computing.value).toBe(true)
    // 防抖窗口内还没有把新版本发出去
    expect(w0.lastRequest?.version).toBe(1)
    expect(w0.postCount).toBe(1)

    vi.advanceTimersByTime(59)
    expect(w0.postCount).toBe(1)

    vi.advanceTimersByTime(1)
    expect(w0.postCount).toBe(2)
    expect(w0.lastRequest?.version).toBe(2)
    w0.deliver()
    expect(reportVersion.value).toBe(2)
    expect(computing.value).toBe(false)
  })

  it('旧分析在拖动间隔里迟到返回：输入已变，旧结果必须丢弃，不得显示成当前结果', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const { factory, created } = makeWorkerFactory()
    const { version, report, reportVersion, computing, run, schedule } =
      useCollisionAnalysis(() => c, { createWorker: factory })

    run() // v1 在途
    const w0 = created[0]
    expect(w0.lastRequest?.version).toBe(1)

    // 拖动到第二版（防抖已过，v2 已发起）
    c[0].waypoints[1].x = 42
    schedule()
    vi.advanceTimersByTime(60)
    expect(version.value).toBe(2)
    expect(w0.lastRequest?.version).toBe(2)

    // 此刻 v1 的结果才迟到回来（真实 Worker 保留着旧请求）：必须被丢弃
    w0.onmessage?.({
      data: { type: 'result', version: 1, report: analyzeChoreography(JSON.parse(JSON.stringify(PRESETS[1].data))) }
    })
    expect(report.value).toBeNull()
    expect(computing.value).toBe(true)

    // v2 正常返回后才有结果，且报告版本 == 当前版本
    w0.deliver()
    expect(reportVersion.value).toBe(2)
    expect(report.value).not.toBeNull()
  })

  it('工作进程崩溃（onerror）：进入明确失败态而非一直"分析中"，重试在新 Worker 上拿到新结果', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const { factory, created } = makeWorkerFactory()
    const { version, computing, failed, errorMessage, report, retry, run } =
      useCollisionAnalysis(() => c, { createWorker: factory })

    run()
    const w0 = created[0]
    w0.deliverCrash('模拟工作进程崩溃')
    expect(computing.value).toBe(false)
    expect(failed.value).toBe(true)
    expect(errorMessage.value).toContain('崩溃')
    expect(w0.terminated).toBe(true)
    expect(report.value).toBeNull()
    const failedVersion = version.value

    // 明确重试：新版本、重建 Worker、得到新结果
    retry()
    expect(version.value).toBe(failedVersion + 1)
    expect(computing.value).toBe(true)
    expect(failed.value).toBe(false)
    expect(created.length).toBe(2)
    const w1 = created[1]
    expect(w1.lastRequest?.version).toBe(version.value)
    w1.deliver()
    expect(report.value).not.toBeNull()
    expect(computing.value).toBe(false)
    expect(failed.value).toBe(false)
  })

  it('计算报错（type=error 消息）：失败态可重试，重试产生新版本结果', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const { factory, created } = makeWorkerFactory()
    const { version, failed, errorMessage, report, retry, run } = useCollisionAnalysis(() => c, {
      createWorker: factory
    })

    run()
    created[0].deliverComputeError('BigInt 爆了')
    expect(failed.value).toBe(true)
    expect(errorMessage.value).toBe('BigInt 爆了')
    const v = version.value

    retry()
    expect(version.value).toBe(v + 1)
    // 计算报错不意味着 Worker 通道损坏：复用同一 Worker 重发请求
    expect(created.length).toBe(1)
    expect(created[0].lastRequest?.version).toBe(version.value)
    created[0].deliver()
    expect(failed.value).toBe(false)
    expect(report.value).not.toBeNull()
  })

  it('故障后重新编辑（不手动重试）也能恢复正常分析', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const { factory, created } = makeWorkerFactory()
    const { failed, report, schedule, run } = useCollisionAnalysis(() => c, {
      debounceMs: 60,
      createWorker: factory
    })

    run()
    created[0].deliverCrash()
    expect(failed.value).toBe(true)

    c[0].radius = 0
    schedule()
    expect(failed.value).toBe(false)
    vi.advanceTimersByTime(60)
    expect(created.length).toBe(2)
    created[1].deliver()
    expect(report.value).not.toBeNull()
    expect(failed.value).toBe(false)
  })

  it('主线程兜底：计算读取的是发起时的版本快照，后改路径不影响已排队的结果归属', () => {
    const initial: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data)) // 半径 1+1：1 条冲突
    const c: Choreography = JSON.parse(JSON.stringify(initial))
    // 不注入 Worker -> 走 setTimeout 主线程兜底
    const { version, report, reportVersion, computing, run } = useCollisionAnalysis(() => c)

    run()
    const requestVersion = version.value
    expect(requestVersion).toBe(1)
    expect(computing.value).toBe(true)

    // 兜底任务尚未执行前，把路径改成"安全编排"——已排队的分析只允许读快照
    const safe: Choreography = JSON.parse(JSON.stringify(initial))
    safe[1].waypoints.forEach((w) => (w.y += 5))
    c.splice(0, c.length, ...safe)

    vi.advanceTimersByTime(10)
    // 任务携带的是 v1；当前编排未 bump 版本，结果仍按 v1 的快照落地（旧路径、1 条冲突），
    // 证明兜底分支不会读到后来的路径
    expect(reportVersion.value).toBe(1)
    expect(report.value?.reports.length).toBe(1)
    expect(computing.value).toBe(false)
  })

  it('兜底分支：编辑后（新版本）先前排队的快照结果被版本核对丢弃', () => {
    const initial: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const c: Choreography = JSON.parse(JSON.stringify(initial))
    const { report, reportVersion, run } = useCollisionAnalysis(() => c)

    run() // v1 排队（冲突编排）
    const safe: Choreography = JSON.parse(JSON.stringify(initial))
    safe[1].waypoints.forEach((w) => (w.y += 5))
    c.splice(0, c.length, ...safe)
    run() // v2 排队（安全编排）

    vi.advanceTimersByTime(10)
    expect(reportVersion.value).toBe(2)
    expect(report.value?.reports).toEqual([])
  })

  it('防抖合并：连续拖动只在停顿后发起一次分析，版本号随每次编辑前进', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const { factory, created } = makeWorkerFactory()
    const { version, reportVersion, computing, schedule } = useCollisionAnalysis(() => c, {
      debounceMs: 60,
      createWorker: factory
    })

    schedule()
    expect(version.value).toBe(1)
    vi.advanceTimersByTime(40)
    c[0].radius = 0
    schedule()
    expect(version.value).toBe(2)
    vi.advanceTimersByTime(40)
    c[0].radius = 2
    schedule()
    expect(version.value).toBe(3)
    expect(created[0].postCount).toBe(0)

    vi.advanceTimersByTime(60)
    expect(created[0].postCount).toBe(1)
    expect(created[0].lastRequest?.version).toBe(3)
    expect(created[0].lastRequest?.choreography[0].radius).toBe(2)
    created[0].deliver()
    expect(reportVersion.value).toBe(3)
    expect(computing.value).toBe(false)
  })
})
