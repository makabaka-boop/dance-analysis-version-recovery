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

  it('编辑路径立即作废旧版碰撞标记与选中证据，重算后得到同版新报告', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    await sleep(20)

    // 切到"反向相遇"预设（半径 1+1，t=5 精确相撞）：v2 报告 1 条冲突
    const select = host.querySelector('select') as HTMLSelectElement
    select.value = 'head-on'
    select.dispatchEvent(new Event('change'))
    await sleep(120)
    expect(host.textContent).toContain('1 条冲突')

    // 点开唯一一条冲突：舞台上出现见证虚线
    const item = host.querySelector('.report li') as HTMLElement
    expect(item).toBeTruthy()
    item.click()
    await sleep(0)
    expect(host.querySelector('.report li.sel')).toBeTruthy()
    expect(host.querySelector('g.witness')).toBeTruthy()

    // 拖动甲的第二个路点（t=10）向 y 方向错开 50：两人路径不再靠近到半径和以内
    const firstDancerRows = host.querySelectorAll('.editor .dancer:first-child tbody tr')
    expect(firstDancerRows.length).toBe(2)
    const yAtT10 = firstDancerRows[1].querySelectorAll('input[type="number"]')[2] as HTMLInputElement
    yAtT10.value = '50'
    yAtT10.dispatchEvent(new Event('input', { bubbles: true }))

    // 编辑后立即（远早于 60ms 防抖）：旧选中证据撤下，旧报告整体作废，新版本进入分析中
    await sleep(0)
    expect(host.querySelector('.report li.sel')).toBeNull()
    expect(host.querySelector('g.witness')).toBeNull()
    expect(host.textContent).toContain('分析中')
    expect(host.textContent).not.toContain('发现 1 条冲突')

    // 兜底计算完成：新报告与新版本号一致，错开后的编排安全
    await sleep(120)
    const text = host.textContent ?? ''
    expect(text).toContain('无冲突')
    expect(text).toContain('v3')

    app.unmount()
  })

  it('校验失败后重新编辑修复编排：不重试也能恢复正常分析', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(App)
    app.mount(host)
    await sleep(20)

    // 构造非法半径：校验失败态优先展示（暂停分析），修复后应自动恢复分析
    const rInput = host.querySelector<HTMLInputElement>('.dancer:first-child .r-input')!
    rInput.value = '-1'
    rInput.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(120)
    expect(host.textContent).toContain('校验失败')

    rInput.value = '0'
    rInput.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(120)
    expect(host.textContent).toContain('无冲突')

    app.unmount()
  })
})
