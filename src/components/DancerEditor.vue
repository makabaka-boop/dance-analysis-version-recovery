<script setup lang="ts">
import { PRESETS } from '../data/presets'
import type { Choreography, Dancer, Waypoint } from '../core/types'
import type { ValidationIssue } from '../core/choreography'
import { LIMITS } from '../core/choreography'

const props = defineProps<{
  choreography: Choreography
  issues: ValidationIssue[]
  version: number
}>()

function loadPreset(key: string) {
  const p = PRESETS.find((x) => x.key === key)
  if (!p) return
  const fresh = JSON.parse(JSON.stringify(p.data)) as Choreography
  props.choreography.splice(0, props.choreography.length, ...fresh)
}

function addDancer() {
  if (props.choreography.length >= LIMITS.MAX_DANCERS) return
  const nextId = props.choreography.reduce((m, d) => Math.max(m, d.id), 0) + 1
  props.choreography.push({
    id: nextId,
    name: `舞者${nextId}`,
    radius: 1,
    waypoints: [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 10, y: 10 }
    ]
  })
}

function removeDancer(d: Dancer) {
  const i = props.choreography.indexOf(d)
  if (i >= 0 && props.choreography.length > LIMITS.MIN_DANCERS) props.choreography.splice(i, 1)
}

function addWaypoint(d: Dancer) {
  if (d.waypoints.length >= LIMITS.MAX_WAYPOINTS) return
  const last = d.waypoints[d.waypoints.length - 1]
  const nt = Math.min(last.t + 10, LIMITS.MAX_TIME)
  const w: Waypoint = { t: nt, x: last.x, y: last.y }
  d.waypoints.push(w)
}

function removeWaypoint(d: Dancer, i: number) {
  if (d.waypoints.length > LIMITS.MIN_WAYPOINTS) d.waypoints.splice(i, 1)
}

function issuesOf(dancerId: number, waypointIndex?: number): ValidationIssue[] {
  return props.issues.filter(
    (x) => x.dancerId === dancerId && (waypointIndex === undefined || x.waypointIndex === waypointIndex)
  )
}
</script>

<template>
  <aside class="panel editor">
    <h2>编排编辑</h2>
    <div class="presets">
      <label class="sub">预设场景</label>
      <select
        @change="
          loadPreset(($event.target as HTMLSelectElement).value)
          ;($event.target as HTMLSelectElement).selectedIndex = 0
        "
      >
        <option value="">— 选择载入 —</option>
        <option v-for="p in PRESETS" :key="p.key" :value="p.key">{{ p.label }}</option>
      </select>
    </div>

    <div v-if="issues.length" class="issues">
      <h3>校验问题（{{ issues.length }}）· 已暂停几何分析</h3>
      <ul>
        <li v-for="(x, i) in issues" :key="i" class="mono">
          <template v-if="x.dancerId !== undefined">
            #{{ x.dancerId }}<template v-if="x.waypointIndex !== undefined">.路点{{ x.waypointIndex }}</template
            >：
          </template>
          {{ x.message }}
        </li>
      </ul>
    </div>

    <div class="dancer-list">
      <section v-for="d in choreography" :key="d.id" class="dancer">
        <header>
          <input v-model.number="d.id" class="id-input" title="ID" />
          <input v-model="d.name" class="name-input" title="名称" />
          <input v-model.number="d.radius" class="r-input" title="安全半径" />
          <button class="danger" title="删除舞者" @click="removeDancer(d)">✕</button>
        </header>
        <div
          v-for="(x, k) in issuesOf(d.id).filter((q) => q.waypointIndex === undefined)"
          :key="'g' + k"
          class="d-issue"
        >
          {{ x.message }}
        </div>

        <table>
          <thead>
            <tr>
              <th>t</th>
              <th>x</th>
              <th>y</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(w, i) in d.waypoints" :key="i">
              <td><input v-model.number="w.t" type="number" min="0" max="600" step="1" /></td>
              <td><input v-model.number="w.x" type="number" min="-100" max="100" step="1" /></td>
              <td><input v-model.number="w.y" type="number" min="-100" max="100" step="1" /></td>
              <td>
                <button
                  class="danger tiny"
                  :disabled="d.waypoints.length <= 2"
                  title="删除路点"
                  @click="removeWaypoint(d, i)"
                >
                  ✕
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <ul class="wp-issues">
          <li
            v-for="(x, k) in issuesOf(d.id).filter((q) => q.waypointIndex !== undefined)"
            :key="'w' + k"
            class="d-issue mono"
          >
            路点{{ x.waypointIndex }}：{{ x.message }}
          </li>
        </ul>
        <button class="tiny add" :disabled="d.waypoints.length >= 25" @click="addWaypoint(d)">+ 路点</button>
      </section>
    </div>

    <button class="primary" :disabled="choreography.length >= 8" @click="addDancer">
      + 添加舞者（{{ choreography.length }}/8）
    </button>
    <p class="sub foot">
      约束：2–8 名舞者 · 每人 2–25 个严格递增整数时刻路点 · t∈[0,600] · |x|,|y|≤100 · 半径为非负整数
      · 编辑版本 v{{ version }}
    </p>
  </aside>
</template>

<style scoped>
.editor {
  grid-area: editor;
}
.presets {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.presets select {
  width: auto;
  flex: 1;
}
.issues {
  border: 1px solid #7a4a4a;
  border-radius: 7px;
  padding: 7px 9px;
  margin-bottom: 10px;
}
.issues h3 {
  margin: 0 0 5px;
  font-size: 12px;
  color: var(--danger);
}
.issues ul {
  margin: 0;
  padding-left: 16px;
  color: #e5a0a0;
  font-size: 12px;
}
.dancer {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 10px;
  background: var(--panel-2);
}
.dancer header {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.id-input {
  width: 44px;
}
.name-input {
  width: auto;
  flex: 1;
}
.r-input {
  width: 52px;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th {
  text-align: left;
  color: var(--muted);
  font-weight: normal;
  font-size: 11px;
}
td input {
  width: 100%;
}
td:last-child {
  width: 30px;
}
button.tiny {
  padding: 1px 8px;
  font-size: 12px;
}
button.add {
  margin-top: 6px;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.d-issue {
  color: #e5a0a0;
  font-size: 11.5px;
  margin: 2px 0;
}
.wp-issues {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}
.foot {
  margin-top: 8px;
  font-size: 11px;
}
</style>
