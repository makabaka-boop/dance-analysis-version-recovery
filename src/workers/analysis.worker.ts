/// <reference lib="webworker" />
import { analyzeChoreography } from '../core/choreography'
import type { Choreography } from '../core/types'

export interface AnalyzeRequest {
  /** 单调递增的编辑版本号；主线程只接受与当前版本一致的结果 */
  version: number
  choreography: Choreography
}

export interface AnalyzeResponse {
  version: number
  report: ReturnType<typeof analyzeChoreography>
}

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const { version, choreography } = e.data
  // 计算为纯 BigInt 分数运算；DTO 中以字符串携带
  const report = analyzeChoreography(choreography)
  ;(self as DedicatedWorkerGlobalScope).postMessage({
    version,
    report
  } satisfies AnalyzeResponse)
}
