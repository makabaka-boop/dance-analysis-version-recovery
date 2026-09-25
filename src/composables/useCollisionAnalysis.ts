import { ref, shallowRef, getCurrentInstance, onBeforeUnmount } from 'vue'
import { analyzeChoreography, validateChoreography, type ValidationIssue } from '../core/choreography'
import type { AnalysisReportDTO, Choreography } from '../core/types'
import type { AnalyzeRequest, AnalyzeResponse } from '../workers/analysis.worker'

/** 等待计算的一版请求：版本号与发起瞬间的编排快照永远绑定在一起 */
interface PendingRequest {
  version: number
  snapshot: Choreography
}

/**
 * 分析编排的版本一致性由以下机制保证：
 * - 每次编辑在渲染前同步 `invalidate`：version++、清报告、置计算中，
 *   于是拖动后到重分析完成之间，旧碰撞标记 / 选中证据绝不会继续盖在新路径上，
 *   旧 Worker 的迟到结果也会因版本号不再相等而被丢弃；
 * - 发起时对编排做一次深拷贝快照，Worker / 主线程兜底都只计算该快照，
 *   杜绝“读到后来的路径却挂上先前版本号”；
 * - 计算失败有明确 error 状态（不会一直停在“分析中”），可 retry；
 * - 再次编辑会清掉错误并重新走正常分析。
 *
 * 优先使用 Web Worker，环境不支持时在主线程同步计算（如 Vitest）。
 */
export function useCollisionAnalysis(choreographyRef: () => Choreography) {
  const version = ref(0)
  const report = shallowRef<AnalysisReportDTO | null>(null)
  const issues = ref<ValidationIssue[]>([])
  const computing = ref(false)
  const error = ref<string | null>(null)

  let worker: Worker | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let pending: PendingRequest | null = null
  /** 最近一次作废后的最新版本（可能尚未发出计算） */
  let liveVersion = 0
  /** 最近一次真正交给计算方（Worker / 兜底）的版本 */
  let postedVersion = 0
  let disposed = false

  function createWorker(): Worker | null {
    try {
      const w = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
        type: 'module'
      })
      w.onmessage = (e: MessageEvent<AnalyzeResponse>) => {
        // 必须同时是“最新已作废版本”和“最新已发出请求”：
        // 防抖间隔内 live 已超前 posted 时，旧在途请求的迟到成功 / 失败一律丢弃
        if (
          e.data.version !== liveVersion ||
          e.data.version !== postedVersion ||
          !pending
        )
          return
        pending = null
        computing.value = false
        if (e.data.error) {
          error.value = e.data.error
        } else {
          report.value = e.data.report ?? null
        }
      }
      w.onerror = (e) => {
        // Worker 脚本加载失败 / 进程崩溃等：死掉的 Worker 一律摘除，
        // 后续 startCompute 会惰性重建。
        // 若已有更新版本在等待计算（防抖中），当前失败结果直接忽略；
        // 否则把最新版本明确标记为失败，供界面展示与重试。
        killWorker()
        if (liveVersion !== postedVersion) return
        failPending(e.message || '分析工作进程发生错误')
      }
      return w
    } catch {
      return null
    }
  }

  function killWorker() {
    worker?.terminate()
    worker = null
  }

  /** 标记当前在途请求失败（Worker 已由调用方摘除） */
  function failPending(message: string) {
    pending = null
    if (disposed) return
    computing.value = false
    error.value = message
  }

  /** 同步作废旧版本：必须在 DOM 重渲染前调用，避免旧证据闪现到新路径上 */
  function invalidate() {
    const current = choreographyRef()
    const found = validateChoreography(current)
    issues.value = found
    version.value += 1
    liveVersion = version.value
    error.value = null
    report.value = null
    computing.value = true
    return { version: version.value, current, valid: found.length === 0 }
  }

  /**
   * 编辑入口：同步作废 + 快照绑定版本，60ms 防抖只推迟“开始计算”，
   * 不推迟版本作废，也不推迟快照。
   */
  function scheduleRun() {
    if (debounceTimer) clearTimeout(debounceTimer)
    const next = invalidate()
    // 即便校验失败也排一次计时器：触发时直接落地“暂停分析”状态
    const invalid = !next.valid
    const snapshot: Choreography = JSON.parse(JSON.stringify(next.current))
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (version.value !== next.version) return // 已被更新的编辑作废
      if (invalid) {
        computing.value = false
        return
      }
      startCompute({ version: next.version, snapshot })
    }, 60)
  }

  /** 立即执行（初始挂载 / 重试）：同样先作废旧状态再算 */
  function run() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    const next = invalidate()
    if (!next.valid) {
      computing.value = false
      return
    }
    const snapshot: Choreography = JSON.parse(JSON.stringify(next.current))
    startCompute({ version: next.version, snapshot })
  }

  /** 失败后重试：用当前编排开新版本计算，得到全新结果 */
  function retry() {
    run()
  }

  function startCompute(req: PendingRequest) {
    pending = req
    postedVersion = req.version
    computing.value = true
    error.value = null

    if (!worker) worker = createWorker()
    if (worker) {
      const message: AnalyzeRequest = {
        version: req.version,
        // 快照本身已是普通对象，避免把 Vue 响应式代理交给结构化克隆
        choreography: req.snapshot
      }
      worker.postMessage(message)
      return
    }

    // 主线程兜底：只计算发起时的快照，并按版本号核对，逻辑与 Worker 一致
    const v = req.version
    setTimeout(() => {
      if (v !== postedVersion || v !== liveVersion || !pending) return
      pending = null
      computing.value = false
      try {
        report.value = analyzeChoreography(req.snapshot)
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err)
      }
    }, 0)
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      disposed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      killWorker()
    })
  }

  return { version, report, issues, computing, error, scheduleRun, run, retry }
}
