import { describe, expect, it } from 'vitest'
import { Fraction, frac } from './fraction'
import { buildSegments, minSquaredDistance, positionAt, toSegment } from './geometry'
import type { Waypoint } from './types'

const wp = (t: number, x: number, y: number): Waypoint => ({ t, x, y })

function pair(
  a: [Waypoint, Waypoint],
  b: [Waypoint, Waypoint]
) {
  return minSquaredDistance(toSegment(1, 0, a[0], a[1]), toSegment(2, 0, b[0], b[1]))
}

describe('minSquaredDistance 精确几何', () => {
  it('擦边：相对速度非零，最近点在段内分数时刻 8/17，d² = 4/17', () => {
    const r = pair(
      [wp(0, 0, 0), wp(10, 10, 0)],
      [wp(0, 0, 2), wp(10, 0, -38)]
    )
    expect(r).not.toBeNull()
    expect(r!.minSqDist.eq(new Fraction(4, 17))).toBe(true)
    expect(r!.atTime.eq(new Fraction(8, 17))).toBe(true)
    // 相对位置恒定标志不触发：atTime 不是区间起点
    expect(r!.atTime.eq(r!.t0)).toBe(false)
  })

  it('擦边边界：d² = 4/17 ≈ 0.235 时 r 和 1（阈值1）即冲突，仅 r 和 0 安全', () => {
    const r = pair(
      [wp(0, 0, 0), wp(10, 10, 0)],
      [wp(0, 0, 2), wp(10, 0, -38)]
    )!
    // 阈值比较：分子 <= 阈值 * 分母
    expect(r.minSqDist.num <= 4n * r.minSqDist.den).toBe(true) // (0+2)^2 = 4 ⇒ 冲突
    expect(r.minSqDist.num <= 1n * r.minSqDist.den).toBe(true) // (0+1)^2 = 1，4/17 < 1 ⇒ 冲突
    expect(r.minSqDist.num <= 0n).toBe(false) // 半径和 0 ⇒ 4/17 > 0 ⇒ 安全
  })

  it('反向相遇：t=5 精确相撞，d² = 0', () => {
    const r = pair(
      [wp(0, 0, 0), wp(10, 10, 0)],
      [wp(0, 10, 0), wp(10, 0, 0)]
    )!
    expect(r.minSqDist.isZero()).toBe(true)
    expect(r.atTime.eq(frac(5))).toBe(true)
  })

  it('端点相接：零长度重叠 [10,10] 也要检查，d² = 0', () => {
    const r = pair(
      [wp(0, 0, 0), wp(10, 10, 0)],
      [wp(10, 10, 0), wp(20, 20, 0)]
    )!
    expect(r.t0.eq(frac(10))).toBe(true)
    expect(r.t1.eq(frac(10))).toBe(true)
    expect(r.minSqDist.isZero()).toBe(true)
    expect(r.atTime.eq(frac(10))).toBe(true)
  })

  it('时间不重叠：返回 null', () => {
    expect(
      pair(
        [wp(0, 0, 0), wp(5, 5, 0)],
        [wp(6, 5, 0), wp(10, 10, 0)]
      )
    ).toBeNull()
  })

  it('平行等速（相对位置恒定）：d² 恒为 10，atTime 取重叠起点', () => {
    const r = pair(
      [wp(0, 0, 0), wp(10, 10, 0)],
      [wp(2, 1, 3), wp(12, 11, 3)]
    )!
    expect(r.minSqDist.eq(frac(10))).toBe(true)
    expect(r.atTime.eq(frac(2))).toBe(true)
    expect(r.t1.eq(frac(10))).toBe(true)
  })

  it('时长不等（分母不同）：t∈[2,6] 上顶点 8/3，d² = 0', () => {
    // A: (0,0)->(20,0) over [0,10]，速度 (2,0)；B: (4,-2)->(12,10) over [2,6]，速度 (2,3)
    // 相对位移 (0, 3t-8)，恰在 t=8/3 精确相遇 —— 校验跨分母 (dA*dB) 公式
    const r = pair(
      [wp(0, 0, 0), wp(10, 20, 0)],
      [wp(2, 4, -2), wp(6, 12, 10)]
    )!
    expect(r.t0.eq(frac(2))).toBe(true)
    expect(r.t1.eq(frac(6))).toBe(true)
    expect(r.atTime.eq(new Fraction(8, 3))).toBe(true)
    expect(r.minSqDist.isZero()).toBe(true)
  })

  it('顶点在重叠区间外时取端点：相向但只在 t∈[0,4] 重叠，最近点在 t=4', () => {
    const r = pair(
      [wp(0, 0, 0), wp(10, 10, 0)],
      [wp(-6, 20, 0), wp(4, 10, 0)]
    )!
    // t=4: A(4,0) B(10,0) d²=36；全局顶点 t=5 不在重叠区间 [0,4] 内
    expect(r.t0.eq(frac(0))).toBe(true)
    expect(r.t1.eq(frac(4))).toBe(true)
    expect(r.minSqDist.eq(frac(36))).toBe(true)
    expect(r.atTime.eq(frac(4))).toBe(true)
  })

  it('匀速分数位置：路点与段内分数时刻', () => {
    const dancer = {
      id: 1,
      name: 'A',
      radius: 0,
      waypoints: [wp(0, 0, 0), wp(4, 8, 12), wp(10, 8, 0)]
    }
    expect(positionAt(dancer, frac(0))).toMatchObject({ x: frac(0), y: frac(0) })
    const p = positionAt(dancer, new Fraction(1, 2))
    expect(p.x.eq(frac(1))).toBe(true)
    expect(p.y.eq(new Fraction(3, 2))).toBe(true)
    // 内部路点时刻归入前一段也无妨：位置连续
    expect(positionAt(dancer, frac(4)).x.eq(frac(8))).toBe(true)
    expect(positionAt(dancer, frac(10)).y.eq(frac(0))).toBe(true)
  })

  it('buildSegments 保留舞者 id 与段下标', () => {
    const d = { id: 7, name: 'A', radius: 1, waypoints: [wp(0, 0, 0), wp(2, 2, 0), wp(5, 2, 6)] }
    const segs = buildSegments(d)
    expect(segs.map((s) => s.index)).toEqual([0, 1])
    expect(segs.every((s) => s.dancerId === 7)).toBe(true)
    expect(segs[1]).toMatchObject({ dt: 3, dx: 0, dy: 6 })
  })
})
