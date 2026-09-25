<script setup lang="ts">
import { computed } from 'vue'
import { Fraction } from '../core/fraction'
import type { AnalysisReportDTO, ConflictDTO, PairReportDTO } from '../core/types'

const props = defineProps<{
  report: AnalysisReportDTO | null
  computing: boolean
  invalid: boolean
  selectedKey: string | null
}>()

const emit = defineEmits<{
  (e: 'select', payload: { pair: PairReportDTO; conflict: ConflictDTO; key: string } | null): void
}>()

const pairColor = (aId: number, bId: number) =>
  ['#ef6b6b', '#e89b5c', '#c98ce8', '#5ec8e6', '#9bd06a', '#e86b9a', '#6bb7e8', '#d8c65c'][
    (aId * 7 + bId * 3) % 8
  ]

const totalConflicts = computed(() =>
  props.report ? props.report.reports.reduce((n, r) => n + r.conflicts.length, 0) : 0
)

function key(r: PairReportDTO, c: ConflictDTO): string {
  return `${r.aId}-${r.bId}#${c.segA.waypointIndex}-${c.segB.waypointIndex}`
}

function distView(c: ConflictDTO): { exact: string; approx: string } {
  const f = Fraction.fromJSON(c.minSqDist)
  return { exact: f.toString(), approx: f.toFixedTrunc(4) }
}
</script>

<template>
  <aside class="panel report">
    <h2>冲突报告</h2>
    <p v-if="invalid" class="sub">编排未通过校验，无法分析（见左侧问题列表）。</p>
    <p v-else-if="computing" class="sub"><span class="tag run">分析中</span> Web Worker 正在做精确枚举…</p>
    <template v-else-if="report">
      <p class="sub">
        枚举 {{ report.segmentPairCount }} 对时间重叠线段，
        <b :class="totalConflicts ? 'bad' : 'good'">{{ totalConflicts }}</b> 条冲突线段，
        涉及 {{ report.reports.length }} 对舞者。
      </p>
      <p v-if="totalConflicts === 0" class="ok-box">✓ 全部舞者对的最小距离均大于半径和，编排安全。</p>

      <section v-for="r in report.reports" :key="`${r.aId}-${r.bId}`" class="pair-block">
        <h3 :style="{ color: pairColor(r.aId, r.bId) }">
          {{ r.aName }}（#{{ r.aId }}） ⨯ {{ r.bName }}（#{{ r.bId }}）
          <span class="tag bad">{{ r.conflicts.length }} 条</span>
        </h3>
        <ul>
          <li
            v-for="c in r.conflicts"
            :key="key(r, c)"
            :class="{ sel: selectedKey === key(r, c) }"
            @click="emit('select', { pair: r, conflict: c, key: key(r, c) })"
          >
            <div class="line1">
              线段 甲#{{ c.segA.waypointIndex }} t∈[{{ c.segA.t0 }}, {{ c.segA.t1 }}]
              ⨯ 乙#{{ c.segB.waypointIndex }} t∈[{{ c.segB.t0 }}, {{ c.segB.t1 }}]
            </div>
            <div class="line2 mono">
              min d² = <b class="bad">{{ distView(c).exact }}</b>
              <span class="sub">(≈{{ distView(c).approx }})</span>
              ≤ (r₁+r₂)² = {{ c.thresholdSq }}
            </div>
            <div class="line2 mono">
              发生时刻 t* = <b class="warn">{{ Fraction.fromJSON(c.atTime).toString() }}</b>
              ≈ {{ Fraction.fromJSON(c.atTime).toFixedTrunc(4) }}
              <span class="sub">（重叠区间 [{{ Fraction.fromJSON(c.overlapT0).toString() }}, {{ Fraction.fromJSON(c.overlapT1).toString() }}]）</span>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.report {
  grid-area: report;
}
.bad {
  color: var(--danger);
}
.good {
  color: var(--ok);
}
.warn {
  color: var(--warn);
}
.ok-box {
  border: 1px solid #336048;
  color: var(--ok);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
}
.pair-block h3 {
  margin: 14px 0 6px;
  font-size: 13px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
li {
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 7px 9px;
  cursor: pointer;
  background: var(--panel-2);
}
li:hover {
  border-color: #7a4a4a;
}
li.sel {
  border-color: var(--danger);
  box-shadow: 0 0 0 1px var(--danger) inset;
}
.line1 {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 3px;
}
.line2 {
  font-size: 12px;
}
</style>
