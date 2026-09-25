import { describe, expect, it } from 'vitest'
import { analyzeChoreography } from './choreography'
import { Fraction } from './fraction'
import { buildSegments, minSquaredDistance, type MotionSegment } from './geometry'
import type { Choreography, Dancer } from './types'

/**
 * 对拍：用一套独立的「浮点位置函数 + 密集采样 + 解析抛物线顶点」实现
 * （不引用被测的分数代码路径）作为 oracle，在大量小样本随机编排上
 * 与 BigInt 精确实现逐线段对核对冲突判定、最小距离与发生时刻。
 *
 * 采样只用于发现几何情形；最终断言以精确结果为基准，容差用于容纳
 * oracle 的浮点误差。
 */

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface NumSeg {
  t0: number
  t1: number
  x0: number
  y0: number
  vx: number
  vy: number
}

function numSegs(d: Dancer): NumSeg[] {
  return d.waypoints.slice(0, -1).map((a, i) => {
    const b = d.waypoints[i + 1]
    const dt = b.t - a.t
    return { t0: a.t, t1: b.t, x0: a.x, y0: a.y, vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt }
  })
}

function pos(s: NumSeg, t: number) {
  const u = t - s.t0
  return { x: s.x0 + s.vx * u, y: s.y0 + s.vy * u }
}

/** oracle：与 geometry.ts 完全独立的抛物线解析最小值 */
function oracleMin(a: NumSeg, b: NumSeg, radiusSum: number) {
  const lo = Math.max(a.t0, b.t0)
  const hi = Math.min(a.t1, b.t1)
  if (lo > hi) return null
  const pa = pos(a, lo)
  const pb = pos(b, lo)
  const rvx = b.vx - a.vx
  const rvy = b.vy - a.vy
  const x0 = pb.x - pa.x
  const y0 = pb.y - pa.y
  // d²(u) = P u² + Q u + R，u = t - lo
  const P = rvx * rvx + rvy * rvy
  const Q = 2 * (rvx * x0 + rvy * y0)
  const R = x0 * x0 + y0 * y0
  let u: number
  if (P === 0) u = 0
  else {
    const uv = -Q / (2 * P)
    u = Math.max(0, Math.min(hi - lo, uv))
  }
  const minSq = P * u * u + Q * u + R
  // 密集采样二次核对（故意保留"逐帧式"朴素方法作交叉参照，不作判定依据）
  let sampleMinSq = Infinity
  const N = 400
  for (let k = 0; k <= N; k++) {
    const t = lo + ((hi - lo) * k) / N
    const xa = pos(a, t)
    const xb = pos(b, t)
    const dd = (xb.x - xa.x) ** 2 + (xb.y - xa.y) ** 2
    if (dd < sampleMinSq) sampleMinSq = dd
  }
  return {
    lo,
    hi,
    t: lo + u,
    minSq,
    sampleMinSq,
    conflict: minSq <= radiusSum * radiusSum + 1e-9
  }
}

function randomDancer(rng: () => number, id: number): Dancer {
  const n = 2 + Math.floor(rng() * 4) // 2..5 个路点（小样本）
  const times = new Set<number>()
  while (times.size < n) times.add(Math.floor(rng() * 21)) // t ∈ 0..20，小窗口迫使重叠/端点情形出现
  const ts = [...times].sort((a, b) => a - b)
  return {
    id,
    name: `D${id}`,
    radius: Math.floor(rng() * 4),
    waypoints: ts.map((t) => ({
      t,
      x: Math.floor(rng() * 11) - 5,
      y: Math.floor(rng() * 11) - 5
    }))
  }
}

describe('小样本枚举分段对拍', () => {
  const SEEDS = [1, 7, 13, 42, 99, 1234, 2024, 55555]
  const PAIR_TOL = 1e-9

  it.each(SEEDS)('seed=%s：精确实现与独立 oracle 逐线段对一致', (seed) => {
    const rng = mulberry32(seed)
    const nDancers = 2 + Math.floor(rng() * 3) // 2..4 人
    const choreo: Choreography = Array.from({ length: nDancers }, (_, i) => randomDancer(rng, i + 1))

    // 精确结果按 "a-b#i-j" 索引
    const exact = analyzeChoreography(choreo)
    const exactConflicts = new Set<string>()
    for (const rep of exact.reports) {
      for (const c of rep.conflicts) {
        exactConflicts.add(`${rep.aId}-${rep.bId}#${c.segA.waypointIndex}-${c.segB.waypointIndex}`)
      }
    }

    let overlapPairs = 0
    let conflictCount = 0

    for (let i = 0; i < choreo.length; i++) {
      for (let j = i + 1; j < choreo.length; j++) {
        const A = choreo[i]
        const B = choreo[j]
        const aSegs = buildSegments(A)
        const bSegs = buildSegments(B)
        const na = numSegs(A)
        const nb = numSegs(B)
        const radiusSum = A.radius + B.radius

        for (let p = 0; p < aSegs.length; p++) {
          for (let q = 0; q < bSegs.length; q++) {
            const ex = minSquaredDistance(aSegs[p] as MotionSegment, bSegs[q] as MotionSegment)
            const ora = oracleMin(na[p], nb[q], radiusSum)
            expect(!!ex).toBe(!!ora)
            if (!ex || !ora) continue
            overlapPairs++

            // 1) 重叠区间一致
            expect(Math.abs(ex.t0.toNumber() - ora.lo)).toBeLessThan(PAIR_TOL)
            expect(Math.abs(ex.t1.toNumber() - ora.hi)).toBeLessThan(PAIR_TOL)

            // 2) 最小距离平方与发生时刻一致（浮点容差）
            expect(Math.abs(ex.minSqDist.toNumber() - ora.minSq)).toBeLessThan(1e-7)
            expect(Math.abs(ex.atTime.toNumber() - ora.t)).toBeLessThan(1e-7)

            // 3) 最小距离非负
            expect(ex.minSqDist.num >= 0n).toBe(true)

            // 4) 朴素密集采样只能给出不小于精确最小值的结果（采样会漏掉两帧间的冲突）
            expect(ora.sampleMinSq + 1e-9).toBeGreaterThanOrEqual(ora.minSq)

            // 5) 冲突判定双方一致：精确分数 ≤ 半径和平方
            const threshold = BigInt(radiusSum) ** 2n
            const exactHit = ex.minSqDist.num <= threshold * ex.minSqDist.den
            expect(exactHit).toBe(ora.conflict)
            if (exactHit) {
              conflictCount++
              expect(exactConflicts.has(`${A.id}-${B.id}#${p}-${q}`)).toBe(true)
            } else {
              expect(exactConflicts.has(`${A.id}-${B.id}#${p}-${q}`)).toBe(false)
            }
          }
        }
      }
    }

    expect(exact.segmentPairCount).toBe(overlapPairs)
    expect(exactConflicts.size).toBe(conflictCount)
  })

  it('密集采样确实可能漏掉两帧间的相遇：构造采样步长跨过零点的情形作警示性断言', () => {
    // A 与 B 在 u=1/800（400 份采样格点 1/400 的半格处）精确相遇
    const a: NumSeg = { t0: 0, t1: 1, x0: 0, y0: 0, vx: 1, vy: 0 }
    const b: NumSeg = { t0: 0, t1: 1, x0: 1 / 800, y0: 0, vx: 0, vy: 0 }
    const N = 400
    let hit = false
    for (let k = 0; k <= N; k++) {
      const t = k / N
      if (Math.abs(pos(a, t).x - pos(b, t).x) < 1e-12) hit = true
    }
    expect(hit).toBe(false) // 采样帧看不到相撞
    // 分数表示下相遇时刻是精确有理数（实际编排由 analyzeChoreography 用整数缩放精确捕获）
    expect(new Fraction(1, 800).gt(Fraction.ZERO)).toBe(true)
  })
})
