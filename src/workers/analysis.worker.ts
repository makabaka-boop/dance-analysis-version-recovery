/// <reference lib="webworker" />
import { analyzeChoreography } from '../core/choreography'
import type { AnalysisReportDTO, Choreography } from '../core/types'

export interface AnalyzeRequest {
  /** 单调递增的编排版本号；主线程只接受与当前版本一致的结果 */
  version: number
  /** 发起请求那一刻的编排快照；Worker 永远不会读到请求之后的编辑 */
  choreography: Choreography
}

export interface AnalyzeResponse {
  version: number
  /** 成功时的报告；与 error 互斥 */
  report?: AnalysisReportDTO
  /** 计算失败时的错误信息（主线程据此给出明确失败状态与重试入口） */
  error?: string
}

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const { version, choreography } = e.data
  try {
    // 计算为纯 BigInt 分数运算；DTO 中以字符串携带
    const report = analyzeChoreography(choreography)
    ;(self as DedicatedWorkerGlobalScope).postMessage({
      version,
      report
    } satisfies AnalyzeResponse)
  } catch (err) {
    // 不让异常只表现为 worker error 事件：回一条带版本号的失败响应，
    // 主线程可以明确标记该版失败并允许重试。
    ;(self as DedicatedWorkerGlobalScope).postMessage({
      version,
      error: err instanceof Error ? err.message : String(err)
    } satisfies AnalyzeResponse)
  }
}
