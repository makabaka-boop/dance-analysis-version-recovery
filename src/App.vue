<script setup lang="ts">
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue'
import StageView from './components/StageView.vue'
import TimeSlider from './components/TimeSlider.vue'
import ConflictReport from './components/ConflictReport.vue'
import DancerEditor from './components/DancerEditor.vue'
import { PRESETS } from './data/presets'
import { useCollisionAnalysis } from './composables/useCollisionAnalysis'
import { Fraction } from './core/fraction'
import type { ConflictDTO, PairReportDTO } from './core/types'

const choreography = reactive(structuredClone(PRESETS[0].data))

const { version, report, issues, computing, run } = useCollisionAnalysis(() => choreography)

// 编辑（含滑块无关的所有深度变化）后用版本号作废旧 Worker 结果；做轻量防抖合并连续输入
let scheduleTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => choreography,
  () => {
    if (scheduleTimer) clearTimeout(scheduleTimer)
    scheduleTimer = setTimeout(() => run(), 60)
  },
  { deep: true }
)
run()

// ---- 时间与播放 ----
const currentTime = ref(0)
const playing = ref(false)
let raf = 0
let lastTs = 0

function tick(ts: number) {
  if (!playing.value) return
  if (lastTs) {
    const next = currentTime.value + (ts - lastTs) / 1000
    currentTime.value = next >= 600 ? 0 : next
  }
  lastTs = ts
  raf = requestAnimationFrame(tick)
}
function togglePlay() {
  playing.value = !playing.value
  lastTs = 0
  if (playing.value) raf = requestAnimationFrame(tick)
  else cancelAnimationFrame(raf)
}
onBeforeUnmount(() => cancelAnimationFrame(raf))

// ---- 冲突选择 / 见证联动 ----
const selectedKey = ref<string | null>(null)

interface Selection {
  pair: PairReportDTO
  conflict: ConflictDTO
}

const selected = computed<Selection | null>(() => {
  if (!report.value || !selectedKey.value) return null
  for (const pair of report.value.reports) {
    for (const conflict of pair.conflicts) {
      const k = `${pair.aId}-${pair.bId}#${conflict.segA.waypointIndex}-${conflict.segB.waypointIndex}`
      if (k === selectedKey.value) return { pair, conflict }
    }
  }
  return null
})

const selectedPair = computed(() =>
  selected.value ? { aId: selected.value.pair.aId, bId: selected.value.pair.bId } : null
)
const witness = computed(() =>
  selected.value ? Fraction.fromJSON(selected.value.conflict.atTime) : null
)

const pairColor = (aId: number, bId: number) =>
  ['#ef6b6b', '#e89b5c', '#c98ce8', '#5ec8e6', '#9bd06a', '#e86b9a', '#6bb7e8', '#d8c65c'][
    (aId * 7 + bId * 3) % 8
  ]

const marks = computed(() => {
  if (!report.value) return []
  return report.value.reports.flatMap((pair) =>
    pair.conflicts.map((conflict) => ({ conflict, color: pairColor(pair.aId, pair.bId) }))
  )
})

function onSelect(payload: { pair: PairReportDTO; conflict: ConflictDTO; key: string } | null) {
  if (!payload) {
    selectedKey.value = null
    return
  }
  // 再次点击同一条目即取消
  selectedKey.value = selectedKey.value === payload.key ? null : payload.key
  if (selectedKey.value) {
    currentTime.value = Fraction.fromJSON(payload.conflict.atTime).toNumber()
  }
}
function onSeekFraction(f: Fraction) {
  currentTime.value = f.toNumber()
}

// 新报告回来后，旧选择若已不存在（编辑所致）则丢弃
watch(report, () => {
  if (selectedKey.value && !selected.value) selectedKey.value = null
})

const invalid = computed(() => issues.value.length > 0)
const conflictTotal = computed(() =>
  report.value ? report.value.reports.reduce((n, r) => n + r.conflicts.length, 0) : 0
)
</script>

<template>
  <div class="app">
    <header>
      <h1>舞台轨迹检查 · Stage Trajectory Check</h1>
      <p class="sub head-sub">
        匀速线段 · 枚举每对舞者时间重叠的线段对 · 相对距离平方二次函数以 BigInt 分数精确求最小 ·
        不按帧采样、不用 SVG 像素判定
      </p>
      <span v-if="invalid" class="tag bad">校验失败 v{{ version }}</span>
      <span v-else-if="computing" class="tag run">分析中 v{{ version }}…</span>
      <span v-else-if="conflictTotal > 0" class="tag bad">发现 {{ conflictTotal }} 条冲突 · v{{ version }}</span>
      <span v-else class="tag ok">无冲突 · v{{ version }}</span>
    </header>

    <DancerEditor :choreography="choreography" :issues="issues" :version="version" />

    <div class="panel stage-panel" style="grid-area: stage">
      <StageView
        :choreography="choreography"
        :current-time="currentTime"
        :selected-pair="selectedPair"
        :witness="witness"
      />
    </div>

    <TimeSlider
      :current-time="currentTime"
      :marks="marks"
      :witness="witness"
      :playing="playing"
      @update:time="currentTime = $event"
      @toggle-play="togglePlay"
      @seek-fraction="onSeekFraction"
    />

    <ConflictReport
      :report="report"
      :computing="computing"
      :invalid="invalid"
      :selected-key="selectedKey"
      @select="onSelect"
    />
  </div>
</template>

<style scoped>
header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 4px;
}
.head-sub {
  margin: 0;
  flex: 1;
}
.stage-panel {
  overflow: hidden;
}
</style>
