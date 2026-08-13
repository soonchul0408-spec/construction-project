<script setup lang="ts">
import { computed, reactive } from 'vue'

import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, DRAWING_KIND_LABELS } from '../types/domain'
import type { DimensionValue } from '../types/domain'

const props = defineProps<{
  dimensions: DimensionValue[]
}>()

const emit = defineEmits<{
  update: [payload: { id: string; valueMm: number; displayValue: string }]
}>()

const edits = reactive<Record<string, string>>({})
const reviewItems = computed(() => props.dimensions.filter((dimension) => dimension.confidence !== 'high'))

function confirmValue(dimension: DimensionValue) {
  const valueMm = Number(edits[dimension.id])
  if (!Number.isFinite(valueMm) || valueMm <= 0) return
  emit('update', { id: dimension.id, valueMm, displayValue: `${valueMm} mm (사용자 확인)` })
}

function beginEdit(dimension: DimensionValue) {
  if (edits[dimension.id] === undefined) edits[dimension.id] = dimension.valueMm === null ? '' : String(dimension.valueMm)
}

function evidenceText(dimension: DimensionValue) {
  const evidence = dimension.evidence[0]
  if (!evidence) return '근거 미확인'
  const location = evidence.location
    ? ` · 위치 ${(evidence.location.x * 100).toFixed(0)}%, ${(evidence.location.y * 100).toFixed(0)}%`
    : ''
  return `${evidence.fileName} · ${evidence.pageNumber}페이지 · ${DRAWING_KIND_LABELS[evidence.drawingKind]}${location}`
}
</script>

<template>
  <section class="review-panel" aria-labelledby="review-title">
    <div class="section-heading compact">
      <div>
        <p class="eyebrow">확인할 값</p>
        <h2 id="review-title">검토가 필요한 값</h2>
      </div>
      <span class="review-count">{{ reviewItems.length }}건</span>
    </div>
    <p v-if="!reviewItems.length" class="empty-review">중간·낮은 신뢰도 값이 없습니다. 새 파일을 올리면 여기에 표시됩니다.</p>
    <div v-else class="review-list">
      <article v-for="dimension in reviewItems" :key="dimension.id" class="review-item">
        <div class="review-item__topline">
          <span class="confidence-dot" :style="{ backgroundColor: CONFIDENCE_COLORS[dimension.confidence] }" />
          <strong>{{ dimension.label }}</strong>
          <span class="confidence-label" :style="{ color: CONFIDENCE_COLORS[dimension.confidence] }">{{ CONFIDENCE_LABELS[dimension.confidence] }}</span>
          <span v-if="dimension.userEdited" class="user-value-label">사용자 확인값</span>
        </div>
        <p class="evidence-line">{{ evidenceText(dimension) }}</p>
        <p class="value-line">추출값 {{ dimension.originalValueMm === null || dimension.originalValueMm === undefined ? '없음' : `${dimension.originalValueMm}mm` }} · 현재값 {{ dimension.valueMm === null ? '없음' : `${dimension.valueMm}mm` }}{{ dimension.userEdited ? ' · 사용자 확인' : '' }}</p>
        <p class="context-line">“{{ dimension.context || dimension.displayValue }}”</p>
        <div class="review-edit">
          <label :for="`review-${dimension.id}`">값(mm)</label>
          <input :id="`review-${dimension.id}`" v-model="edits[dimension.id]" type="number" min="1" step="1" :placeholder="dimension.valueMm === null ? '값 필요' : String(dimension.valueMm)" :aria-label="`${dimension.label} 확인값(mm)`" @focus="beginEdit(dimension)">
          <button type="button" @click="confirmValue(dimension)">확인값 반영</button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.review-panel {
  padding: 24px;
  border: 1px solid #e0e9e4;
  border-radius: 18px;
  background: #fff;
}

.section-heading.compact {
  margin-bottom: 18px;
}

.review-count {
  display: inline-flex;
  min-width: 38px;
  min-height: 27px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: #b45b33;
  background: #fff3e9;
  font-size: 12px;
  font-weight: 800;
}

.empty-review {
  margin: 0;
  color: #81918b;
  font-size: 16px;
  line-height: 1.65;
}

.review-list {
  display: grid;
  gap: 12px;
}

.review-item {
  padding: 14px;
  border: 1px solid #e7eee9;
  border-radius: 13px;
  background: #fbfdfc;
}

.review-item__topline {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  color: #29453c;
  font-size: 17px;
}

.confidence-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.confidence-label,
.user-value-label {
  font-size: 14px;
  font-weight: 800;
}

.user-value-label {
  padding: 2px 7px;
  border-radius: 5px;
  color: #17674f;
  background: #e4f4ec;
}

.evidence-line,
.value-line,
.context-line {
  margin: 6px 0 0;
  color: #71847b;
  font-size: 15px;
  line-height: 1.55;
}

.value-line {
  color: #315f50;
  font-weight: 700;
}

.context-line {
  overflow: hidden;
  color: #52685e;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-edit {
  display: grid;
  grid-template-columns: auto minmax(90px, 140px) auto;
  gap: 8px;
  align-items: center;
  margin-top: 11px;
}

.review-edit label {
  color: #6a7d74;
  font-size: 15px;
  font-weight: 700;
}

.review-edit input {
  width: 100%;
  min-height: 50px;
  padding: 9px 11px;
  border: 1px solid #ccdcd4;
  border-radius: 7px;
  color: #1e332c;
  background: #fff;
  font: inherit;
  font-size: 17px;
}

.review-edit button {
  min-height: 50px;
  padding: 9px 13px;
  border: 0;
  border-radius: 7px;
  color: #fff;
  background: #1b765f;
  font: inherit;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}

@media (max-width: 560px) {
  .review-panel {
    padding: 18px;
  }

  .review-edit {
    grid-template-columns: auto 1fr;
  }

  .review-edit button {
    grid-column: 2;
  }
}
</style>
