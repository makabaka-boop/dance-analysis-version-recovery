import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { createApp } from 'vue'
import App from './App.vue'
import type { AnalyzeRequest, AnalyzeResponse } from './workers/analysis.worker'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 可控假 Worker：手动决定每条请求何时回成功 / 失败 / 崩溃 */
class MockWorker {
  static instances: MockWorker[] = []
  static reset() {
    MockWorker.instances = []
  }
  onmessage: ((e: MessageEvent<AnalyzeResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  posted: AnalyzeRequest[] = []
  constructor(_url: URL, _opts?: unknown) {
    MockWorker.instances.push(this)
  }
  postMessage(req: AnalyzeRequest) {
    this.posted.push(req)
  }
  terminate() {}
  replyLast(over: Partial<AnalyzeResponse>) {
    const req = this.posted.at(-1)!
    this.onmessage?.({ data: { version: req.version, ...over } } as MessageEvent<AnalyzeResponse>)
  }
  crash(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }
}

describe('App 页面集成（Worker 不可用时走同步兜底）', () => {
  let host: HTMLElement | null = null

  afterEach(() => {
    host?.remove()
    host = null
  })

  it('载入默认擦边场景并渲染报告、版本号', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    createApp(App).mount(host)

    await sleep(50)

    const text = host.textContent ?? ''
    expect(text).toContain('舞台轨迹检查')
    expect(text).toContain('冲突报告')
    expect(text).toContain('v1')
    // 默认 graze 预设半径均为 0：d²=4/17 > 0，无冲突
    expect(text).toContain('无冲突')

    // 时间滑块存在且范围为 0..600
    const range = host.querySelector('input[type="range"]') as HTMLInputElement
    expect(range).toBeTruthy()
    expect(range.min).toBe('0')
    expect(range.max).toBe('600')
  })
})

describe('App 页面集成 · 失败状态、重试与重编辑恢复（可控 Worker 计时）', () => {
  let host: HTMLElement
  let savedWorker: typeof globalThis.Worker

  beforeEach(() => {
    MockWorker.reset()
    savedWorker = globalThis.Worker
    globalThis.Worker = MockWorker as unknown as typeof globalThis.Worker
    host = document.createElement('div')
    document.body.appendChild(host)
  })
  afterEach(() => {
    host.remove()
    globalThis.Worker = savedWorker
  })

  const safeReport = () => ({
    dancerCount: 2,
    segmentPairCount: 1,
    reports: []
  })

  it('Worker 报错后明确显示失败与重试入口；重试得到新结果；重新编辑恢复正常', async () => {
    createApp(App).mount(host)
    await vi.waitFor(() => expect(MockWorker.instances.length).toBeGreaterThan(0))
    expect(MockWorker.instances[0]!.posted.at(-1)!.version).toBe(1)

    // 首版计算以错误响应返回：界面不能停在“分析中”，要有失败状态和重试
    MockWorker.instances[0]!.replyLast({ error: 'boom' })
    await vi.waitFor(() => expect(host.textContent).toContain('分析失败'))
    expect(host.textContent).not.toContain('分析中')
    const retryBtn = host.querySelector('.report button') as HTMLButtonElement
    expect(retryBtn).toBeTruthy()

    // 重试：新版本 v2 正常返回安全结果
    retryBtn.click()
    await vi.waitFor(() =>
      expect(MockWorker.instances[0]!.posted.at(-1)!.version).toBe(2)
    )
    MockWorker.instances[0]!.replyLast({ report: safeReport() as never })
    await vi.waitFor(() => expect(host.textContent).toContain('无冲突'))
    expect(host.textContent).not.toContain('分析失败')

    // 再次编辑：正常进入分析中并由新 Worker 事件出结果
    const radiusInput = host.querySelector('.r-input') as HTMLInputElement
    radiusInput.value = '5'
    radiusInput.dispatchEvent(new Event('input', { bubbles: true }))
    // 60ms 防抖窗口内：已是 v2 作废后的 v3“分析中”，失败状态同步消失
    await vi.waitFor(() => expect(host.textContent).toContain('v3'))
    expect(host.textContent).not.toContain('分析失败')
    expect(host.textContent).toContain('分析中')
    await vi.waitFor(() =>
      expect(MockWorker.instances[0]!.posted.at(-1)!.version).toBe(3)
    )
    MockWorker.instances[0]!.replyLast({ report: safeReport() as never })
    await vi.waitFor(() => expect(host.textContent).toContain('无冲突'))
  })

  it('Worker 进程崩溃：重建 Worker 完成重试，且不会一直卡在分析中', async () => {
    createApp(App).mount(host)
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1))
    MockWorker.instances[0]!.crash('process died')
    await vi.waitFor(() => expect(host.textContent).toContain('分析失败'))
    expect(host.textContent).toContain('process died')

    ;(host.querySelector('.report button') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(2))
    MockWorker.instances[1]!.replyLast({ report: safeReport() as never })
    await vi.waitFor(() => expect(host.textContent).toContain('无冲突'))
  })
})
