<script setup lang="ts">
import { computed } from 'vue'
import { Fraction } from '../core/fraction'
import type { ConflictDTO } from '../core/types'

const props = defineProps<{
  currentTime: number
  marks: { conflict: ConflictDTO; color: string }[]
  witness: Fraction | null
  playing: boolean
}>()

const emit = defineEmits<{
  (e: 'update:time', t: number): void
  (e: 'toggle-play'): void
  (e: 'seek-fraction', f: Fraction): void
}>()

const pct = (t: number) => `${(t / 600) * 100}%`

const marksView = computed(() =>
  props.marks.map((m) => ({
    left: (Fraction.fromJSON(m.conflict.atTime).toNumber() / 600) * 100,
    color: m.color,
    at: Fraction.fromJSON(m.conflict.atTime)
  }))
)
</script>

<template>
  <div class="slider-panel panel">
    <div class="row">
      <h2 style="margin: 0">时间</h2>
      <button :class="{ primary: playing }" @click="emit('toggle-play')">
        {{ playing ? '暂停' : '播放' }}
      </button>
      <button @click="emit('update:time', 0)">归零</button>
      <span class="mono time-label">t = {{ currentTime.toFixed(2) }} / 600</span>
      <span v-if="witness" class="mono witness-label">
        见证 t* = <b>{{ witness.toString() }}</b> ≈ {{ witness.toFixedTrunc(4) }}
      </span>
    </div>
    <div class="track">
      <input
        type="range"
        min="0"
        max="600"
        step="0.01"
        :value="currentTime"
        @input="emit('update:time', Number(($event.target as HTMLInputElement).value))"
      />
      <div class="marks">
        <button
          v-for="(m, i) in marksView"
          :key="i"
          class="mark"
          :style="{ left: m.left + '%', background: m.color }"
          :title="`跳到冲突时刻 ${m.at.toString()}`"
          @click="emit('seek-fraction', m.at)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.slider-panel {
  grid-area: slider;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.time-label {
  color: var(--text);
}
.witness-label {
  color: var(--danger);
}
.track {
  position: relative;
  padding: 0 2px;
}
.marks {
  position: relative;
  height: 8px;
  margin-top: -2px;
}
.mark {
  position: absolute;
  width: 7px;
  height: 7px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid #0f1420;
  transform: translateX(-50%);
  cursor: pointer;
}
.mark:hover {
  width: 10px;
  height: 10px;
}
</style>
