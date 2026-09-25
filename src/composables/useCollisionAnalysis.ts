import { computed, ref, shallowRef, getCurrentInstance, onBeforeUnmount } from 'vue'
import {
  analyzeChoreography,
  validateChoreography,
  type ValidationIssue
} from '../core/choreography'
import type { AnalysisReportDTO, Choreography } from '../core/types'
import type { AnalyzeRequest, AnalyzeResponse } from '../workers/analysis.worker'

/**
 * 分析在 Worker / 主线程兜底通道上的最小接口。
 * 允许测试注入一个可控计时、可模拟崩溃与计算报错的假 Worker。
 */
export interface AnalysisWorkerLike {
  postMessage(message: AnalyzeRequest): void
  onmessage: ((e: { data: AnalyzeResponse }) => void) | null
  onerror: ((e: { message?: string }) => void) | null
  onmessageerror: ((e: { message?: string }) => void) | null
  terminate(): void
}

export interface UseCollisionAnalysisOptions {
  /** 防抖时长（默认 60ms，合并连续拖动） */
  debounceMs?: number
  /** Worker 工厂；返回 null 时回落主线程同步计算。测试可注入假 Worker。 */
  createWorker?: () => AnalysisWorkerLike | null
}

export function useCollisionAnalysis(
  choreographyRef: () => Choreography,
  options: UseCollisionAnalysisOptions = {}
) {
  const { debounceMs = 60, createWorker = createDefaultWorker } = options

  /**
   * 当前编排版本：
   * - 任何一次编辑（schedule）立即 +1，标记旧版本整体作废：旧报告 / 旧选中证据
   *   立刻从界面撤下，不再覆盖在新路径上；
   * - run（防抖后真正发起分析）也 +1；只有与 currentVersion 同版本的结果才会落地；
   * - 每个版本只保留一份不可快照旧快照，Worker 与主线程兜底都只对快照计算，
   *   迟到的结果永远不会以"当前结果"的样子出现。
   */
  const currentVersion = ref(0)
  /** 最近一次成功落地的报告及其版本（二者始终同版） */
  const report = shallowRef<AnalysisReportDTO | null>(null)
  const reportVersion = ref(0)
  const issues = ref<ValidationIssue[]>([])
  const issuesVersion = ref(0)
  /** 正在分析的版本；null 表示当前没有在途计算 */
  const pendingVersion = ref<number | null>(null)
  /** 已编辑、等待防抖发起分析 */
  const debouncing = ref(false)
  /** 当前版本的失败信息；null 表示未失败 */
  const errorMessage = ref<string | null>(null)

  const computing = computed(() => pendingVersion.value !== null || debouncing.value)
  const failed = computed(() => errorMessage.value !== null && !computing.value)

  let worker: AnalysisWorkerLike | null = createWorker()

  function finishVersion(version: number) {
    if (pendingVersion.value !== version) return
    pendingVersion.value = null
  }

  function applyResult(version: number, nextReport: AnalysisReportDTO) {
    if (version !== currentVersion.value) {
      // 编辑已产生新版本：迟到结果即使内容看似"当前"也必须丢弃
      return
    }
    report.value = nextReport
    reportVersion.value = version
    errorMessage.value = null
    finishVersion(version)
  }

  function applyError(version: number, message: string) {
    if (version !== currentVersion.value) return
    errorMessage.value = message
    finishVersion(version)
  }

  function bindWorker(w: AnalysisWorkerLike) {
    w.onmessage = (e: { data: AnalyzeResponse }) => {
      const msg = e.data
      if (msg.type === 'result') applyResult(msg.version, msg.report)
      else applyError(msg.version, msg.message || '分析工作进程计算失败')
    }
    const crash = (e: { message?: string }) => {
      const version = pendingVersion.value
      // 崩溃的 Worker 不可再用：终止并丢弃，下一次 run 惰性重建
      worker?.terminate()
      worker = null
      if (version !== null) applyError(version, e.message || '分析工作进程发生错误')
    }
    w.onerror = crash
    w.onmessageerror = crash
  }

  if (worker) bindWorker(worker)

  /** 取一份不可变的普通对象快照，避免读到响应式代理 / 后来的路径 */
  function snapshot(): Choreography {
    return JSON.parse(JSON.stringify(choreographyRef()))
  }

  /**
   * 标记一次编辑：立即让旧版本的标记、报告、选中证据、问题列表失效，
   * 但不立即发起计算（由 schedule 防抖合并）。
   */
  function stampEdit() {
    currentVersion.value += 1
    report.value = null
    reportVersion.value = 0
    issues.value = []
    issuesVersion.value = 0
    errorMessage.value = null
    pendingVersion.value = null
  }

  /** 对指定版本的快照发起一次分析（Worker 优先，否则主线程兜底） */
  function dispatch(version: number, snap: Choreography) {
    debouncing.value = false
    const found = validateChoreography(snap)
    issues.value = found
    issuesVersion.value = version

    if (found.length > 0) {
      // 校验失败：该版本没有报告、没有在途计算
      pendingVersion.value = null
      return
    }

    pendingVersion.value = version

    if (worker || (worker = createWorker())) {
      bindWorker(worker)
      const req: AnalyzeRequest = {
        version,
        // 深拷贝的普通对象快照：既不把 Vue 响应式代理交给结构化克隆，
        // 也保证 Worker 读到的就是该版本的路径
        choreography: JSON.parse(JSON.stringify(snap))
      }
      try {
        worker.postMessage(req)
      } catch (err) {
        worker.terminate()
        worker = null
        applyError(version, err instanceof Error ? err.message : String(err))
      }
      return
    }

    // 主线程兜底：只对该版本的快照计算，与 Worker 通道一样按版本号核对
    setTimeout(() => {
      if (version !== currentVersion.value) return
      try {
        applyResult(version, analyzeChoreography(snap))
      } catch (err) {
        applyError(version, err instanceof Error ? err.message : String(err))
      }
    }, 0)
  }

  /**
   * 立即为当前编排开一个新版本并发起分析（初始加载 / 失败后手动重试）。
   */
  function run() {
    stampEdit()
    const version = currentVersion.value
    dispatch(version, snapshot())
  }

  /**
   * 编辑入口：立即作废旧版本（界面同步进入空 / 分析中态），再防抖合并，
   * 到点后才快照路径、开分析版本发起计算。
   */
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  function schedule() {
    stampEdit()
    debouncing.value = true
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      // 防抖期间若又有编辑，会再次 stampEdit 产生更新的版本；
      // 这里为当前版本取快照并发起分析
      dispatch(currentVersion.value, snapshot())
    }, debounceMs)
  }

  /** 故障后明确重试：新版本、新结果 */
  function retry() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    run()
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (debounceTimer) clearTimeout(debounceTimer)
      worker?.terminate()
    })
  }

  return {
    /** 当前编排版本（路径编辑、计算状态、证据选中、报告都以此为准） */
    version: currentVersion,
    report,
    /** 报告所属版本；report 非空时必与 version 一致 */
    reportVersion,
    issues,
    issuesVersion,
    computing,
    failed,
    errorMessage,
    /** 立即分析（初始 / 重试） */
    run,
    /** 编辑入口（带防抖；立即作废旧版本） */
    schedule,
    retry
  }
}

/** 默认使用真实的模块 Worker；环境不支持（Vitest/jsdom）时返回 null 走主线程兜底 */
export function createDefaultWorker(): AnalysisWorkerLike | null {
  try {
    if (typeof Worker === 'undefined') return null
    return new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
      type: 'module'
    }) as unknown as AnalysisWorkerLike
  } catch {
    return null
  }
}
