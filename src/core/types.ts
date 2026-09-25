/**
 * 共享领域类型。
 *
 * 所有几何判断都建立在整数坐标 / 整数时间之上，中间量用 BigInt 分数保存，
 * 任何地方都不使用 SVG 像素坐标或按帧采样来判定冲突。
 */

export interface Waypoint {
  /** 时间，整数，0..600，同一舞者内严格递增 */
  t: number
  /** 平面坐标，整数，|x|,|y| <= 100 */
  x: number
  y: number
}

export interface Dancer {
  id: number
  name: string
  /** 安全半径（整数，>= 0）：两舞者距离 <= 半径和 即冲突 */
  radius: number
  /** 2..25 个路点 */
  waypoints: Waypoint[]
}

export type Choreography = Dancer[]

/** 分数的可序列化形态（BigInt 在 JSON 中用字符串传递） */
export interface FractionDTO {
  num: string
  den: string
}

/** 冲突中的一条线段对（线段用舞者各自的路点下标表示：waypoints[i] -> waypoints[i+1]） */
export interface SegmentRef {
  waypointIndex: number
  t0: number
  t1: number
}

export interface ConflictDTO {
  /** 甲的线段 */
  segA: SegmentRef
  /** 乙的线段 */
  segB: SegmentRef
  /** 线段对时间重叠区间（含端点）的时刻，分数 */
  overlapT0: FractionDTO
  overlapT1: FractionDTO
  /** 该线段对内最小相对距离平方（分数） */
  minSqDist: FractionDTO
  /** 最小距离发生时刻（分数）；相对距离恒定时取重叠区间起点 */
  atTime: FractionDTO
  /** 阈值 = (rA + rB)^2，整数平方 */
  thresholdSq: string
}

export interface PairReportDTO {
  aId: number
  aName: string
  bId: number
  bName: string
  conflicts: ConflictDTO[]
}

export interface AnalysisReportDTO {
  dancerCount: number
  segmentPairCount: number
  reports: PairReportDTO[]
}
