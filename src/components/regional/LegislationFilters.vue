<script setup>
defineProps({
  regionOptions: {
    type: Array,
    required: true,
  },
  industryCategories: {
    type: Array,
    required: true,
  },
  stages: {
    type: Array,
    required: true,
  },
  selectedRegion: {
    type: String,
    required: true,
  },
  selectedCategory: {
    type: String,
    required: true,
  },
  selectedStage: {
    type: String,
    required: true,
  },
})

const emit = defineEmits([
  'update:selectedRegion',
  'update:selectedCategory',
  'update:selectedStage',
  'reset',
])
</script>

<template>
  <el-card class="legislation-filter-card" shadow="never">
    <div class="filter-heading">
      <div>
        <p class="filter-eyebrow">FILTERS</p>
        <h2>관심 지역과 산업을 선택하세요</h2>
      </div>
      <el-button plain @click="emit('reset')">필터 초기화</el-button>
    </div>

    <div class="filter-grid">
      <div class="filter-field">
        <label for="legislation-region-filter">관심 지역</label>
        <el-select
          id="legislation-region-filter"
          :model-value="selectedRegion"
          aria-label="법안 관련 지역 선택"
          @update:model-value="emit('update:selectedRegion', $event)"
        >
          <el-option
            v-for="option in regionOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
            :disabled="option.disabled"
          />
        </el-select>
      </div>

      <div class="filter-field">
        <label for="legislation-category-filter">산업 카테고리</label>
        <el-select
          id="legislation-category-filter"
          :model-value="selectedCategory"
          aria-label="법안 산업 카테고리 선택"
          @update:model-value="emit('update:selectedCategory', $event)"
        >
          <el-option
            v-for="option in industryCategories"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>

      <div class="filter-field">
        <label for="legislation-stage-filter">진행 단계</label>
        <el-select
          id="legislation-stage-filter"
          :model-value="selectedStage"
          aria-label="법안 진행 단계 선택"
          @update:model-value="emit('update:selectedStage', $event)"
        >
          <el-option
            v-for="option in stages"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
    </div>

    <div class="active-filters">
      <span>현재 조건</span>
      <el-tag effect="plain">
        {{ regionOptions.find((option) => option.value === selectedRegion)?.label }}
      </el-tag>
      <el-tag type="success" effect="plain">{{ selectedCategory }}</el-tag>
      <el-tag type="warning" effect="plain">{{ selectedStage }}</el-tag>
    </div>
  </el-card>
</template>

<style scoped>
.legislation-filter-card {
  border: 1px solid #e5eaf2;
  border-radius: 20px;
  background: #fff;
}

:deep(.legislation-filter-card .el-card__body) {
  padding: 24px;
}

.filter-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}

.filter-eyebrow {
  margin: 0 0 8px;
  color: #2563eb;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.filter-heading h2 {
  margin: 0;
  color: #172033;
  font-size: 1.3rem;
  font-weight: 800;
  letter-spacing: -0.05em;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.filter-field {
  display: grid;
  gap: 8px;
}

.filter-field label {
  color: #536179;
  font-size: 0.8rem;
  font-weight: 800;
}

.filter-field :deep(.el-select) {
  width: 100%;
}

.active-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid #edf0f5;
}

.active-filters > span {
  margin-right: 4px;
  color: #8a96aa;
  font-size: 0.76rem;
  font-weight: 700;
}

@media (max-width: 720px) {
  .filter-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .filter-heading {
    align-items: flex-start;
    display: grid;
  }
}
</style>
