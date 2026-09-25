import { describe, expect, it } from 'vitest'
import { analyzeChoreography, validateChoreography } from './choreography'
import { PRESETS } from '../data/presets'
import type { Choreography, Dancer } from './types'

const mk = (over: Partial<Dancer> = {}): Dancer => ({
  id: 1,
  name: 'A',
  radius: 0,
  waypoints: [
    { t: 0, x: 0, y: 0 },
    { t: 10, x: 1, y: 0 }
  ],
  ...over
})

describe('validateChoreography 约束校验', () => {
  it('人数必须为 2..8', () => {
    expect(validateChoreography([mk()]).length).toBeGreaterThan(0)
    expect(validateChoreography(Array.from({ length: 9 }, (_, i) => mk({ id: i + 1 }))).length).toBeGreaterThan(0)
    expect(validateChoreography([mk({ id: 1 }), mk({ id: 2 })])).toEqual([])
  })

  it('路点数必须为 2..25', () => {
    const one = mk({ waypoints: [{ t: 0, x: 0, y: 0 }] })
    expect(validateChoreography([one, mk({ id: 2 })]).some((x) => x.message.includes('路点'))).toBe(true)
    const many = mk({
      id: 1,
      waypoints: Array.from({ length: 26 }, (_, i) => ({ t: i, x: 0, y: 0 }))
    })
    expect(validateChoreography([many, mk({ id: 2 })]).some((x) => x.message.includes('路点'))).toBe(true)
  })

  it('时间必须是 0..600 内严格递增整数', () => {
    const bad = [
      mk({ id: 1, waypoints: [{ t: 5, x: 0, y: 0 }, { t: 5, x: 1, y: 0 }] }),
      mk({ id: 2 })
    ]
    expect(validateChoreography(bad).some((x) => x.message.includes('严格递增'))).toBe(true)
    const range = [
      mk({ id: 1, waypoints: [{ t: 0, x: 0, y: 0 }, { t: 601, x: 1, y: 0 }] }),
      mk({ id: 2 })
    ]
    expect(validateChoreography(range).some((x) => x.message.includes('时间'))).toBe(true)
    const fracT = [
      mk({ id: 1, waypoints: [{ t: 0, x: 0, y: 0 }, { t: 2.5, x: 1, y: 0 }] }),
      mk({ id: 2 })
    ]
    expect(validateChoreography(fracT).some((x) => x.message.includes('整数'))).toBe(true)
  })

  it('坐标 |x|,|y| <= 100 且为整数，半径为非负整数', () => {
    const c = [
      mk({ id: 1, waypoints: [{ t: 0, x: 101, y: 0 }, { t: 10, x: 0, y: -101 }] }),
      mk({ id: 2, radius: -1 })
    ]
    const issues = validateChoreography(c)
    expect(issues.some((x) => x.message.includes('坐标'))).toBe(true)
    expect(issues.some((x) => x.message.includes('半径'))).toBe(true)
  })

  it('ID 必须唯一', () => {
    expect(validateChoreography([mk({ id: 3 }), mk({ id: 3 })]).some((x) => x.message.includes('ID'))).toBe(true)
  })
})

describe('analyzeChoreography 编排级分析', () => {
  it('反向相遇：半径 1+1 冲突；零半径且精确相遇 d²=0 仍冲突；错开一个单位才安全', () => {
    const data: Choreography = JSON.parse(JSON.stringify(PRESETS.find((p) => p.key === 'head-on')!.data))
    const hitReport = analyzeChoreography(data).reports[0]
    expect(hitReport.conflicts).toHaveLength(1)
    const hit = hitReport.conflicts[0]
    expect(hit.minSqDist.num).toBe('0')
    expect(hit.atTime.num).toBe('5')
    expect(hit.thresholdSq).toBe('4')

    const zeroRadii: Choreography = JSON.parse(JSON.stringify(data))
    zeroRadii.forEach((d) => (d.radius = 0))
    // 精确相遇：距离 0 <= 0，仍冲突（≤ 判定含等号）
    expect(analyzeChoreography(zeroRadii).reports[0].conflicts[0].thresholdSq).toBe('0')

    // 乙整条轨迹抬高 1 个单位：最近 d²=1，零半径安全，半径 1 冲突
    const offset: Choreography = JSON.parse(JSON.stringify(data))
    offset.forEach((d) => (d.radius = 0))
    offset[1].waypoints.forEach((w) => (w.y += 1))
    expect(analyzeChoreography(offset).reports).toEqual([])
    offset[1].radius = 1
    const near = analyzeChoreography(offset).reports[0].conflicts[0]
    expect(near.minSqDist).toEqual({ num: '1', den: '1' })
    expect(near.atTime).toEqual({ num: '5', den: '1' })
  })

  it('擦边：r 和 0 安全（4/17 > 0），r 和 1 冲突（4/17 < 1），距离 4/17 @ 8/17', () => {
    const data: Choreography = JSON.parse(JSON.stringify(PRESETS.find((p) => p.key === 'graze')!.data))
    expect(data[0].radius + data[1].radius).toBe(0)
    expect(analyzeChoreography(data).reports).toEqual([])

    data[1].radius = 1
    const rep = analyzeChoreography(data).reports[0]
    const c = rep.conflicts[0]
    expect(c.minSqDist).toEqual({ num: '4', den: '17' })
    expect(c.atTime).toEqual({ num: '8', den: '17' })
    expect(c.thresholdSq).toBe('1')
  })

  it('端点相接：零半径也在零长度重叠上报冲突', () => {
    const rep = analyzeChoreography(PRESETS[2].data).reports[0]
    expect(rep.conflicts).toHaveLength(1)
    const c = rep.conflicts[0]
    expect(c.overlapT0).toEqual({ num: '10', den: '1' })
    expect(c.overlapT1).toEqual({ num: '10', den: '1' })
    expect(c.minSqDist.num).toBe('0')
    expect(c.thresholdSq).toBe('0')
  })

  it('三人多段：逐对报告，统计所有重叠线段对', () => {
    const r = analyzeChoreography(PRESETS.find((p) => p.key === 'ensemble')!.data)
    const pairs = r.reports.map((x) => `${x.aId}-${x.bId}`).sort()
    expect(pairs).toEqual(['1-2', '1-3'])
    // 非零长度重叠：甲3⨟乙3=9（同段3对为 [t,200] 等），甲3⨟丙1=2（甲段0 [0,200] 已在丙起点结束后无重叠），
    // 乙3⨟丙1=2 —— 端点零长度重叠另计：合计 13
    expect(r.segmentPairCount).toBe(13)
    // 甲(1)-乙(2)：t=200 与 t=600 相遇（端点相接的线段对会同时出现，共 5 条）
    const ab = r.reports.find((x) => x.aId === 1 && x.bId === 2)!
    expect(ab.conflicts).toHaveLength(5)
    expect(ab.conflicts.some((c) => c.atTime.num === '200' && c.minSqDist.num === '0')).toBe(true)
    expect(ab.conflicts.some((c) => c.atTime.num === '600' && c.minSqDist.num === '0')).toBe(true)
    // 甲(1)-丙(3)：t=300 与 t=420 恰好距离 = 半径和 4（d²=16=阈值16，边界冲突）
    const ac = r.reports.find((x) => x.aId === 1 && x.bId === 3)!
    expect(ac.conflicts.map((c) => c.atTime.num)).toEqual(['300', '420'])
    for (const c of ac.conflicts) {
      expect(c.minSqDist).toEqual({ num: '16', den: '1' })
      expect(c.thresholdSq).toBe('16')
    }
  })

  it('不重叠的两条线段不计入枚举', () => {
    const c: Choreography = [
      mk({ id: 1, waypoints: [{ t: 0, x: 0, y: 0 }, { t: 5, x: 5, y: 0 }] }),
      mk({ id: 2, waypoints: [{ t: 6, x: 5, y: 0 }, { t: 10, x: 10, y: 0 }] })
    ]
    const r = analyzeChoreography(c)
    expect(r.segmentPairCount).toBe(0)
    expect(r.reports).toEqual([])
  })
})
