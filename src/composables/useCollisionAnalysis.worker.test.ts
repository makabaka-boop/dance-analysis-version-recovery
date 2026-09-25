import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useCollisionAnalysis } from './useCollisionAnalysis'
import { PRESETS } from '../data/presets'
import type { Choreography } from '../core/types'
import type { AnalyzeRequest, AnalyzeResponse } from '../workers/analysis.worker'

/**
 * 可控的假 Worker：保留每次 postMessage 的请求（版本 + 编排快照），
 * 由测试决定何时回成功 / 失败消息或派发 error 事件。
 * 覆盖：拖动间隔同步作废、旧版本迟到结果丢弃、Worker 报错明确失败 + 重试、
 * 快照绑定（读到的永远是发起时路径，不是后来的路径）。
 */
class MockWorker {
  static instances: MockWorker[] = []
  static reset() {
    MockWorker.instances = []
  }

  onmessage: ((e: MessageEvent<AnalyzeResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  posted: AnalyzeRequest[] = []
  terminated = false

  constructor(_url: URL, _opts?: unknown) {
    MockWorker.instances.push(this)
  }

  postMessage(req: AnalyzeRequest) {
    this.posted.push(req)
  }
  terminate() {
    this.terminated = true
  }

  /** 回最后一次收到的请求对应的结果 */
  replyLast(over: Partial<AnalyzeResponse> = {}) {
    const req = this.posted[this.posted.length - 1]!
    this.onmessage?.({ data: { version: req.version, ...over } } as MessageEvent<AnalyzeResponse>)
  }
  reply(version: number, over: Partial<AnalyzeResponse> = {}) {
    this.onmessage?.({ data: { version, ...over } } as MessageEvent<AnalyzeResponse>)
  }
  crash(message = 'worker crashed') {
    this.onerror?.({ message } as ErrorEvent)
  }
}

const safeChoreo = (): Choreography => {
  const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
  c.forEach((d) => (d.radius = 0))
  c[1].waypoints.forEach((w) => (w.y += 50))
  return c
}

const reportOf = (conflictPairs: number) =>
  ({ dancerCount: 2, segmentPairCount: 1, reports: new Array(conflictPairs).fill(0).map((_, i) => ({
    aId: 1,
    aName: '甲',
    bId: 2,
    bName: '乙',
    conflicts: [
      {
        segA: { waypointIndex: i, t0: 0, t1: 10 },
        segB: { waypointIndex: i, t0: 0, t1: 10 },
        overlapT0: { num: '0', den: '1' },
        overlapT1: { num: '10', den: '1' },
        minSqDist: { num: '0', den: '1' },
        atTime: { num: '5', den: '1' },
        thresholdSq: '4'
      }
    ]
  })) })

describe('useCollisionAnalysis · Web Worker 事件与版本协议', () => {
  let savedWorker: typeof globalThis.Worker

  beforeEach(() => {
    vi.useFakeTimers()
    MockWorker.reset()
    savedWorker = globalThis.Worker
    globalThis.Worker = MockWorker as unknown as typeof globalThis.Worker
  })
  afterEach(() => {
    globalThis.Worker = savedWorker
    vi.useRealTimers()
  })

  const flushDebounce = () => vi.advanceTimersByTime(61)
  const worker = () => MockWorker.instances[MockWorker.instances.length - 1]!

  it('拖动间隔：编辑即同步作废，旧报告在任何 Worker 事件前清空且版本已递增', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const ua = useCollisionAnalysis(() => c)
    ua.run()
    worker().replyLast({ report: reportOf(1) })
    expect(ua.report.value).not.toBeNull()

    // 模拟拖动：watch 的 pre-flush 阶段同步调用 scheduleRun
    c[0].waypoints[1]!.x += 30
    ua.scheduleRun()

    // 还没过防抖、也没有任何新 Worker 响应：旧碰撞标记已不在新路径上
    expect(ua.version.value).toBe(2)
    expect(ua.report.value).toBeNull()
    expect(ua.computing.value).toBe(true)
    expect(ua.error.value).toBeNull()
  })

  it('迟到结果：旧版本响应恰在防抖间隔回来时按版本丢弃，不冒充当前结果', () => {
    const c: Choreography = safeChoreo()
    const ua = useCollisionAnalysis(() => c)
    ua.run() // v1 已在途
    flushDebounce()
    expect(worker().posted).toHaveLength(1)
    expect(worker().posted[0]!.version).toBe(1)

    // 再编辑（v2），防抖尚未结束、v2 尚未 post
    c[0].waypoints[1]!.x += 5
    ua.scheduleRun()
    expect(ua.version.value).toBe(2)

    // v1 的迟到结果恰在这段间隔返回：必须丢弃
    worker().reply(1, { report: reportOf(1) })
    expect(ua.report.value).toBeNull()
    expect(ua.computing.value).toBe(true)

    // v2 正常完成后，只剩 v2 的安全结果
    flushDebounce()
    expect(worker().posted.at(-1)!.version).toBe(2)
    worker().replyLast({ report: reportOf(0) })
    expect(ua.report.value?.reports).toEqual([])
    expect(ua.computing.value).toBe(false)
  })

  it('快照绑定：Worker 收到的是发起瞬间路径；开始计算前的再修改不会混入旧版本', () => {
    const c: Choreography = safeChoreo()
    const ua = useCollisionAnalysis(() => c)
    ua.scheduleRun() // v2=1：安全快照定格
    // 计算尚未 post 前，当前编排被改成必然冲突
    c[0].radius = 90
    c[1].radius = 90
    flushDebounce()

    const sent = worker().posted[0]!
    expect(sent.version).toBe(1)
    expect(sent.choreography[0]!.radius).toBe(0)
    expect(sent.choreography[1]!.radius).toBe(0)
    // 回复用的也是 v1 快照算出来的安全结果
    worker().replyLast({ report: reportOf(0) })
    expect(ua.report.value?.reports).toEqual([])

    // 再编辑后按新路径正常分析
    ua.scheduleRun()
    flushDebounce()
    const sent2 = worker().posted.at(-1)!
    expect(sent2.version).toBe(2)
    expect(sent2.choreography[0]!.radius).toBe(90)
  })

  it('Worker 回错误响应：进入明确失败状态（不再一直“分析中”），无报告，可重试', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const ua = useCollisionAnalysis(() => c)
    ua.run()
    worker().replyLast({ error: 'compute boom' })

    expect(ua.computing.value).toBe(false)
    expect(ua.error.value).toBe('compute boom')
    expect(ua.report.value).toBeNull()

    // 重试：新版本、错误清除、重新发出请求并得到新结果
    ua.retry()
    expect(ua.version.value).toBe(2)
    expect(ua.computing.value).toBe(true)
    expect(ua.error.value).toBeNull()
    expect(worker().posted.at(-1)!.version).toBe(2)
    worker().replyLast({ report: reportOf(1) })
    expect(ua.computing.value).toBe(false)
    expect(ua.report.value?.reports.length).toBe(1)
  })

  it('Worker 进程 error 事件：失败后再编辑可恢复正常分析', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const ua = useCollisionAnalysis(() => c)
    ua.run()
    const dead = worker()
    dead.crash('process died')

    expect(dead.terminated).toBe(true)
    expect(ua.computing.value).toBe(false)
    expect(ua.error.value).toBe('process died')

    // 失败之后重新编辑：error 同步清除、重建 Worker、正常出结果
    c[0].waypoints[1]!.x += 1
    ua.scheduleRun()
    expect(ua.error.value).toBeNull()
    expect(ua.computing.value).toBe(true)
    flushDebounce()
    expect(MockWorker.instances.length).toBe(2)
    expect(worker().terminated).toBe(false)
    worker().replyLast({ report: reportOf(0) })
    expect(ua.computing.value).toBe(false)
    expect(ua.error.value).toBeNull()
    expect(ua.report.value).not.toBeNull()
  })

  it('旧版本在途 Worker 崩溃不影响当前版本；失败响应迟到也按版本丢弃', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const ua = useCollisionAnalysis(() => c)
    ua.run() // v1 在途
    flushDebounce()

    // v2 已发起、共享同一个 Worker
    c[0].radius += 1
    ua.scheduleRun()
    flushDebounce()
    expect(worker().posted.map((r) => r.version)).toEqual([1, 2])

    // v1 的迟到错误响应：丢弃，v2 仍分析中
    worker().reply(1, { error: 'late failure' })
    expect(ua.error.value).toBeNull()
    expect(ua.computing.value).toBe(true)

    // v2 成功
    worker().reply(2, { report: reportOf(1) })
    expect(ua.report.value).not.toBeNull()
    expect(ua.computing.value).toBe(false)
  })

  it('防抖间隔内旧 Worker 崩溃：不标记失败，新版本照常重建 Worker 出结果', () => {
    const c: Choreography = JSON.parse(JSON.stringify(PRESETS[1].data))
    const ua = useCollisionAnalysis(() => c)
    ua.run()
    flushDebounce()
    expect(worker().posted[0]!.version).toBe(1)

    // v2 在防抖中（尚未发出），此时 v1 的 Worker 崩溃
    c[0].radius += 1
    ua.scheduleRun()
    worker().crash('old worker died')
    expect(ua.error.value).toBeNull()
    expect(ua.computing.value).toBe(true)

    // v2 发起时惰性重建 Worker 并正常完成
    flushDebounce()
    expect(MockWorker.instances.length).toBe(2)
    expect(worker().posted[0]!.version).toBe(2)
    worker().replyLast({ report: reportOf(1) })
    expect(ua.report.value).not.toBeNull()
    expect(ua.error.value).toBeNull()
  })
})
