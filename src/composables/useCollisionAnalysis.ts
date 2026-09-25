import { ref, shallowRef, getCurrentInstance, onBeforeUnmount } from 'vue'
import { analyzeChoreography, validateChoreography, type ValidationIssue } from '../core/choreography'
import type { AnalysisReportDTO, Choreography } from '../core/types'
import type { AnalyzeRequest, AnalyzeResponse } from '../workers/analysis.worker'

/**
 * 分析编排：
 * - 每次编辑后 version++，把旧结果整体作废（旧 Worker 响应回来时按版本号丢弃）；
 * - 优先使用 Web Worker，环境不支持时在主线程同步计算（如 Vitest）。
 */
export function useCollisionAnalysis(choreographyRef: () => Choreography) {
  const version = ref(0)
  const report = shallowRef<AnalysisReportDTO | null>(null)
  const issues = ref<ValidationIssue[]>([])
  const computing = ref(false)

  let worker: Worker | null = null
  try {
    worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (e: MessageEvent<AnalyzeResponse>) => {
      if (e.data.version !== version.value) {
        // 旧编辑版本的迟到结果：直接丢弃
        return
      }
      computing.value = false
      report.value = e.data.report
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = null
    }
  } catch {
    worker = null
  }

  function run() {
    const current = choreographyRef()
    const found = validateChoreography(current)
    issues.value = found
    version.value += 1
    computing.value = true
    report.value = null

    if (found.length > 0) {
      computing.value = false
      return
    }

    if (worker) {
      const req: AnalyzeRequest = {
        version: version.value,
        // 深拷贝一份普通对象，避免把 Vue 响应式代理交给结构化克隆
        choreography: JSON.parse(JSON.stringify(current))
      }
      worker.postMessage(req)
    } else {
      const v = version.value
      // 主线程兜底：仍按版本号核对，逻辑与 Worker 一致
      setTimeout(() => {
        if (v !== version.value) return
        report.value = analyzeChoreography(current)
        computing.value = false
      }, 0)
    }
  }

  if (getCurrentInstance()) onBeforeUnmount(() => worker?.terminate())

  return { version, report, issues, computing, run }
}
