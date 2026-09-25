import { describe, expect, it, afterEach } from 'vitest'
import { createApp } from 'vue'
import App from './App.vue'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
