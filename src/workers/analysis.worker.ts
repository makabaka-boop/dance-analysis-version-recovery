/// <reference lib="webworker" />
import { analyzeChoreography } from '../core/choreography'
import type { Choreography } from '../core/types'

export interface AnalyzeRequest {
  /** 单调递增的编辑版本号；主线程只接受与当前版本一致的结果 */
  version: number
  choreography: Choreography
}

export interface AnalyzeOkResponse {
  type: 'result'
  version: number
  report: ReturnType<typeof analyzeChoreography>
}

export interface AnalyzeErrorResponse {
  type: 'error'
  version: number
  message: string
}

export type AnalyzeResponse = AnalyzeOkResponse | AnalyzeErrorResponse

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const { version, choreography } = e.data
  try {
    // 计算为纯 BigInt 分数运算；DTO 中以字符串携带
    const report = analyzeChoreography(choreography)
    ;(self as DedicatedWorkerGlobalScope).postMessage({
      type: 'result',
      version,
      report
    } satisfies AnalyzeOkResponse)
  } catch (err) {
    // 计算抛错也要带回版本号，让主线程进入明确的失败态而不是永远"分析中"
    ;(self as DedicatedWorkerGlobalScope).postMessage({
      type: 'error',
      version,
      message: err instanceof Error ? err.message : String(err)
    } satisfies AnalyzeErrorResponse)
  }
}
