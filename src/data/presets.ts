import type { Choreography } from '../core/types'

export interface Preset {
  key: string
  label: string
  description: string
  data: Choreography
}

/**
 * 内置场景，覆盖关键几何情形：
 * - graze：擦边通过（最小距离分数 4/17，恰在段内顶点 8/17）
 * - head-on：反向相遇（t=5 精确相撞）
 * - endpoint-touch：端点相接（t=10 的零长度重叠）
 * - ensemble：三人多段，含安全平行与边界擦碰
 */
export const PRESETS: Preset[] = [
  {
    key: 'graze',
    label: '擦边通过',
    description: '最近点 4/17 出现在段内分数时刻 8/17；半径 0+0 安全，任一舞者半径为 1 即冲突',
    data: [
      {
        id: 1,
        name: '甲',
        radius: 0,
        waypoints: [
          { t: 0, x: 0, y: 0 },
          { t: 10, x: 10, y: 0 }
        ]
      },
      {
        id: 2,
        name: '乙',
        radius: 0,
        waypoints: [
          { t: 0, x: 0, y: 2 },
          { t: 10, x: 0, y: -38 }
        ]
      }
    ]
  },
  {
    key: 'head-on',
    label: '反向相遇',
    description: '两人相向而行，t=5 在 (5,0) 精确相遇',
    data: [
      {
        id: 1,
        name: '甲',
        radius: 1,
        waypoints: [
          { t: 0, x: 0, y: 0 },
          { t: 10, x: 10, y: 0 }
        ]
      },
      {
        id: 2,
        name: '乙',
        radius: 1,
        waypoints: [
          { t: 0, x: 10, y: 0 },
          { t: 10, x: 0, y: 0 }
        ]
      }
    ]
  },
  {
    key: 'endpoint-touch',
    label: '端点相接',
    description: '甲的段终点与乙的段起点在 t=10 重合（零长度时间重叠）',
    data: [
      {
        id: 1,
        name: '甲',
        radius: 0,
        waypoints: [
          { t: 0, x: 0, y: 0 },
          { t: 10, x: 10, y: 0 }
        ]
      },
      {
        id: 2,
        name: '乙',
        radius: 0,
        waypoints: [
          { t: 10, x: 10, y: 0 },
          { t: 20, x: 20, y: 0 }
        ]
      }
    ]
  },
  {
    key: 'ensemble',
    label: '三人多段',
    description: '甲与乙在 t=200、t=600 相遇；甲与丙在 t=300 恰好距离=半径和（边界冲突）',
    data: [
      {
        id: 1,
        name: '甲',
        radius: 1,
        waypoints: [
          { t: 0, x: -8, y: 0 },
          { t: 200, x: 0, y: 0 },
          { t: 400, x: 8, y: 0 },
          { t: 600, x: 0, y: 0 }
        ]
      },
      {
        id: 2,
        name: '乙',
        radius: 1,
        waypoints: [
          { t: 0, x: 8, y: 4 },
          { t: 200, x: 0, y: 0 },
          { t: 400, x: -8, y: 4 },
          { t: 600, x: 0, y: 0 }
        ]
      },
      {
        id: 3,
        name: '丙',
        radius: 3,
        waypoints: [
          { t: 0, x: -4, y: -4 },
          { t: 600, x: 12, y: -4 }
        ]
      }
    ]
  }
]
