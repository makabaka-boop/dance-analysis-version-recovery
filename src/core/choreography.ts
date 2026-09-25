import { Fraction } from './fraction'
import { buildSegments, minSquaredDistance } from './geometry'
import type {
  AnalysisReportDTO,
  Choreography,
  ConflictDTO,
  PairReportDTO
} from './types'

export const LIMITS = {
  MIN_DANCERS: 2,
  MAX_DANCERS: 8,
  MIN_WAYPOINTS: 2,
  MAX_WAYPOINTS: 25,
  MIN_TIME: 0,
  MAX_TIME: 600,
  MAX_COORD: 100
} as const

export interface ValidationIssue {
  dancerId?: number
  waypointIndex?: number
  message: string
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/** 校验一次编排的全部约束 */
export function validateChoreography(c: Choreography): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(c) || c.length < LIMITS.MIN_DANCERS || c.length > LIMITS.MAX_DANCERS) {
    issues.push({
      message: `舞者人数必须为 ${LIMITS.MIN_DANCERS}..${LIMITS.MAX_DANCERS} 人（当前 ${Array.isArray(c) ? c.length : 0}）`
    })
    return issues
  }

  const ids = new Set<number>()
  for (const d of c) {
    if (!isInt(d.id) || ids.has(d.id)) {
      issues.push({ dancerId: d.id, message: '舞者 ID 必须为不重复的整数' })
    }
    ids.add(d.id)

    if (!isInt(d.radius) || d.radius < 0) {
      issues.push({ dancerId: d.id, message: `安全半径必须为非负整数（当前 ${String(d.radius)}）` })
    }

    const w = d.waypoints
    if (!Array.isArray(w) || w.length < LIMITS.MIN_WAYPOINTS || w.length > LIMITS.MAX_WAYPOINTS) {
      issues.push({
        dancerId: d.id,
        message: `路点数必须为 ${LIMITS.MIN_WAYPOINTS}..${LIMITS.MAX_WAYPOINTS}（当前 ${Array.isArray(w) ? w.length : 0}）`
      })
      continue
    }

    let prevT: number | null = null
    w.forEach((p, i) => {
      const tag = { dancerId: d.id, waypointIndex: i }
      if (!isInt(p.t) || p.t < LIMITS.MIN_TIME || p.t > LIMITS.MAX_TIME) {
        issues.push({ ...tag, message: `时间必须为 ${LIMITS.MIN_TIME}..${LIMITS.MAX_TIME} 的整数（当前 ${String(p.t)}）` })
      } else if (prevT !== null && p.t <= prevT) {
        issues.push({ ...tag, message: `路点时间必须严格递增（第 ${i} 个时刻 ${p.t} 不大于前一时刻 ${prevT}）` })
      }
      prevT = p.t

      if (!isInt(p.x) || !isInt(p.y) || Math.abs(p.x) > LIMITS.MAX_COORD || Math.abs(p.y) > LIMITS.MAX_COORD) {
        issues.push({
          ...tag,
          message: `坐标必须为绝对值不超过 ${LIMITS.MAX_COORD} 的整数（当前 (${String(p.x)}, ${String(p.y)})）`
        })
      }
    })
  }
  return issues
}

/**
 * 枚举每对舞者的每对时间重叠线段，精确取最小相对距离平方，
 * 与半径和平方（整数）作 <= 比较。逐对返回所有冲突线段。
 */
export function analyzeChoreography(c: Choreography): AnalysisReportDTO {
  const segments = c.map((d) => ({ dancer: d, segs: buildSegments(d) }))
  const reports: PairReportDTO[] = []
  let segmentPairCount = 0

  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      const A = segments[i]
      const B = segments[j]
      const conflicts: ConflictDTO[] = []
      const radiusSum = BigInt(A.dancer.radius + B.dancer.radius)
      const thresholdSq = radiusSum * radiusSum

      for (const segA of A.segs) {
        for (const segB of B.segs) {
          const res = minSquaredDistance(segA, segB)
          if (!res) continue
          segmentPairCount++
          // 精确比较：距离分数 <= 整数阈值 ⇔ 分子 <= 阈值*分母
          if (res.minSqDist.num <= thresholdSq * res.minSqDist.den) {
            conflicts.push({
              segA: {
                waypointIndex: segA.index,
                t0: segA.t0,
                t1: segA.t1
              },
              segB: {
                waypointIndex: segB.index,
                t0: segB.t0,
                t1: segB.t1
              },
              overlapT0: res.t0.toJSON(),
              overlapT1: res.t1.toJSON(),
              minSqDist: res.minSqDist.toJSON(),
              atTime: res.atTime.toJSON(),
              thresholdSq: thresholdSq.toString()
            })
          }
        }
      }

      if (conflicts.length > 0) {
        reports.push({
          aId: A.dancer.id,
          aName: A.dancer.name,
          bId: B.dancer.id,
          bName: B.dancer.name,
          conflicts
        })
      }
    }
  }

  return { dancerCount: c.length, segmentPairCount, reports }
}

export function conflictKey(
  report: PairReportDTO,
  conflict: ConflictDTO
): string {
  return `${report.aId}-${report.bId}#${conflict.segA.waypointIndex}-${conflict.segB.waypointIndex}`
}

/** Worker 边界转换辅助：DTO 字符串 -> Fraction */
export function dtoToFraction(d: { num: string; den: string }): Fraction {
  return Fraction.fromJSON(d)
}
