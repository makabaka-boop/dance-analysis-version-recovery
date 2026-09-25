import { Fraction, frac, maxFrac, minFrac } from './fraction'
import type { Dancer, Waypoint } from './types'

/**
 * 匀速线段：在整数时刻区间 [t0, t1] 内，舞者位置随时间匀速变化。
 * 位置用「整数分子 / 整数时长」表示：
 *   X(t) = (x0*dt + dx*(t - t0)) / dt
 * 所以任意分数时刻的位置都是精确分数。
 */
export interface MotionSegment {
  dancerId: number
  /** 路点下标 i：线段为 waypoints[i] -> waypoints[i+1] */
  index: number
  t0: number
  t1: number
  x0: number
  y0: number
  x1: number
  y1: number
  dt: number
  dx: number
  dy: number
}

export function buildSegments(dancer: Dancer): MotionSegment[] {
  const segs: MotionSegment[] = []
  const w = dancer.waypoints
  for (let i = 0; i < w.length - 1; i++) {
    segs.push(toSegment(dancer.id, i, w[i], w[i + 1]))
  }
  return segs
}

export function toSegment(dancerId: number, index: number, a: Waypoint, b: Waypoint): MotionSegment {
  return {
    dancerId,
    index,
    t0: a.t,
    t1: b.t,
    x0: a.x,
    y0: a.y,
    x1: b.x,
    y1: b.y,
    dt: b.t - a.t,
    dx: b.x - a.x,
    dy: b.y - a.y
  }
}

/** 舞者在分数时刻 t 的精确位置（t 必须在其时间范围内） */
export function positionAt(
  dancer: Dancer,
  t: Fraction
): { x: Fraction; y: Fraction } {
  const w = dancer.waypoints
  // 找到第一段满足 t <= 段末时刻；末端时刻归入最后一段
  let i = w.length - 2
  for (let k = 0; k < w.length - 1; k++) {
    if (t.compareTo(frac(w[k + 1].t)) <= 0) {
      i = k
      break
    }
  }
  const a = w[i]
  const b = w[i + 1]
  const dt = b.t - a.t
  const u = t.sub(frac(a.t)).div(frac(dt)) // 段内比例
  return {
    x: frac(a.x).add(frac(b.x - a.x).mul(u)),
    y: frac(a.y).add(frac(b.y - a.y).mul(u))
  }
}

export interface OverlapResult {
  /** 两线段时间重叠区间（含端点）；零长度（端点相接）也算重叠 */
  t0: Fraction
  t1: Fraction
  /** 该线段对内的最小相对距离平方 */
  minSqDist: Fraction
  /** 最小距离发生时刻；相对位置恒定时为重叠区间起点 */
  atTime: Fraction
}

/**
 * 对两条匀速线段，在它们的时间重叠区间上精确求相对距离平方的最小值。
 *
 * 相对位移各分量的分子是时间的一次整系数函数，分母为 dA*dB：
 *   RXnum(t) = rx*t + sx，RYnum(t) = ry*t + sy
 * 距离平方 = (P t² + Q t + R) / (dA²·dB²)
 * 顶点 t* = -Q/(2P)，用分数夹到重叠整数区间内，全程 BigInt。
 * 不做时间采样，不引入任何浮点。
 */
export function minSquaredDistance(a: MotionSegment, b: MotionSegment): OverlapResult | null {
  const lo = maxFrac(frac(a.t0), frac(b.t0))
  const hi = minFrac(frac(a.t1), frac(b.t1))
  if (lo.gt(hi)) return null

  const dA = BigInt(a.dt)
  const dB = BigInt(b.dt)

  // X 分量分子系数：B - A
  const rx = dA * BigInt(b.dx) - dB * BigInt(a.dx)
  const sx =
    -dA * BigInt(b.dx) * BigInt(b.t0) +
    dB * BigInt(a.dx) * BigInt(a.t0) +
    dA * dB * BigInt(b.x0 - a.x0)
  // Y 分量分子系数
  const ry = dA * BigInt(b.dy) - dB * BigInt(a.dy)
  const sy =
    -dA * BigInt(b.dy) * BigInt(b.t0) +
    dB * BigInt(a.dy) * BigInt(a.t0) +
    dA * dB * BigInt(b.y0 - a.y0)

  const denom = dA * dA * dB * dB

  const P = rx * rx + ry * ry
  const Q = 2n * (rx * sx + ry * sy)
  const R = sx * sx + sy * sy

  // P = 0 ⇔ rx = ry = 0（平方和非负）⇒ 相对位置恒定
  if (P === 0n) {
    return { t0: lo, t1: hi, minSqDist: new Fraction(R, denom), atTime: lo }
  }

  // 顶点 t* = -Q/(2P) = -(rx*sx+ry*sy)/P
  const vertex = new Fraction(-(rx * sx + ry * sy), P)
  const tMin = vertex.lt(lo) ? lo : vertex.gt(hi) ? hi : vertex

  // N(tMin)：tMin = n/d
  const n = tMin.num
  const d = tMin.den
  const nAt = P * n * n + Q * n * d + R * d * d
  const dAt = d * d

  return {
    t0: lo,
    t1: hi,
    minSqDist: new Fraction(nAt, denom * dAt),
    atTime: tMin
  }
}
