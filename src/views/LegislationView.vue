<script setup>
import { computed, onMounted, ref } from 'vue'
import ApiFallbackNotice from '@/components/regional/ApiFallbackNotice.vue'
import DataOriginBadge from '@/components/regional/DataOriginBadge.vue'
import LegislationCard from '@/components/regional/LegislationCard.vue'
import LegislationFilters from '@/components/regional/LegislationFilters.vue'
import { SAVED_REGION_FILTER } from '@/data/legislationData'
import { useAnalysisStore } from '@/stores/analysis'
import { useLegislationStore } from '@/stores/legislation'

const selectedRegion = ref('전체')
const selectedCategory = ref('전체')
const selectedStage = ref('전체')
const analysisStore = useAnalysisStore()
const dataStore = useLegislationStore()

const filterRegionOptions = computed(() => {
  const interestOption = {
    value: SAVED_REGION_FILTER,
    label: analysisStore.savedRegions.length
      ? `관심 지역만 보기 (${analysisStore.savedRegions.length})`
      : '관심 지역만 보기 · 저장된 지역 없음',
    disabled: analysisStore.savedRegions.length === 0,
  }

  return [interestOption, ...dataStore.regionOptions]
})

const filteredItems = computed(() =>
  dataStore.items.filter((item) => {
    const matchesRegion =
      selectedRegion.value === '전체' ||
      (selectedRegion.value === SAVED_REGION_FILTER
        ? analysisStore.savedRegions.includes(item.region)
        : item.region === selectedRegion.value)
    const matchesCategory =
      selectedCategory.value === '전체' || item.category === selectedCategory.value
    const matchesStage = selectedStage.value === '전체' || item.stage === selectedStage.value

    return matchesRegion && matchesCategory && matchesStage
  }),
)

const activeRegionLabel = computed(() => {
  if (selectedRegion.value === SAVED_REGION_FILTER) {
    return analysisStore.savedRegions.length ? '저장한 관심 지역' : '관심 지역 없음'
  }

  const region = dataStore.regionOptions.find((option) => option.value === selectedRegion.value)
  return region?.label ?? '전체 지역'
})

function resetFilters() {
  selectedRegion.value = '전체'
  selectedCategory.value = '전체'
  selectedStage.value = '전체'
}

function handleRegionUpdate(value) {
  selectedRegion.value = value
}

onMounted(() => {
  void dataStore.load()
})
</script>

<template>
  <div class="legislation-page">
    <section class="legislation-hero">
      <div class="hero-copy">
        <p class="eyebrow">LEGISLATION &amp; PUBLIC NOTICE</p>
        <h1>법안·입법예고</h1>
        <p class="hero-description">
          관심 지역과 산업에 영향을 줄 수 있는 법안·입법 진행 정보를 공개자료 중심으로 정리합니다.
        </p>
        <div class="hero-note">
          <DataOriginBadge :origin="dataStore.dataOrigin" />
          <span>실제 데이터와 샘플 데이터는 카드의 배지로 구분됩니다.</span>
        </div>
      </div>

      <el-card class="hero-summary" shadow="never">
        <span>현재 확인 가능한 법안 관련 정보</span>
        <strong>{{ filteredItems.length }}<small>건</small></strong>
        <small>{{ activeRegionLabel }} · {{ dataStore.dataOriginLabel }}</small>
      </el-card>
    </section>

    <el-alert class="legislation-disclaimer" type="info" :closable="false" show-icon>
      <template #title>법안 발의·입법예고는 사업 확정이나 예산 확정을 의미하지 않습니다.</template>
      <p>
        법안의 진행 단계와 실제 지역 사업·예산 집행 여부는 서로 다른 공개자료에서 별도로 확인해야 합니다.
      </p>
    </el-alert>

    <ApiFallbackNotice
      :status="dataStore.status"
      :message="dataStore.errorMessage"
      @retry="dataStore.retry"
    />

    <section class="filter-section">
      <LegislationFilters
        :region-options="filterRegionOptions"
        :industry-categories="dataStore.industryCategories"
        :stages="dataStore.stages"
        :selected-region="selectedRegion"
        :selected-category="selectedCategory"
        :selected-stage="selectedStage"
        @update:selected-region="handleRegionUpdate"
        @update:selected-category="selectedCategory = $event"
        @update:selected-stage="selectedStage = $event"
        @reset="resetFilters"
      />
    </section>

    <section class="results-section">
      <div class="section-heading">
        <div>
          <p class="section-eyebrow">PUBLIC LEGISLATION DATA</p>
          <h2>법안 진행 정보</h2>
        </div>
        <el-tag type="info" effect="plain">{{ filteredItems.length }}건</el-tag>
      </div>

      <div v-if="dataStore.status === 'loading'" class="card-grid loading-grid" aria-busy="true">
        <el-card v-for="index in 4" :key="index" class="skeleton-card" shadow="never">
          <el-skeleton animated :rows="7" />
        </el-card>
      </div>

      <div v-else-if="filteredItems.length" class="card-grid">
        <LegislationCard v-for="item in filteredItems" :key="item.id" :item="item" />
      </div>

      <el-empty
        v-else
        class="empty-state"
        description="선택한 관심 지역·산업·진행 단계에 맞는 공개자료가 없습니다."
      >
        <el-button type="primary" plain @click="resetFilters">필터 초기화</el-button>
      </el-empty>
    </section>
  </div>
</template>

<style scoped>
.legislation-page {
  max-width: 1240px;
  margin: 0 auto;
  padding: 56px 24px 88px;
}

.legislation-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  padding: 48px;
  border-radius: 28px;
  color: #fff;
  background:
    radial-gradient(circle at 92% 10%, rgb(251 191 36 / 24%), transparent 34%),
    linear-gradient(135deg, #312e81 0%, #1e3a8a 56%, #0f766e 130%);
  box-shadow: 0 24px 50px rgb(30 58 138 / 18%);
}

.hero-copy {
  max-width: 720px;
}

.eyebrow,
.section-eyebrow {
  margin: 0 0 10px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.eyebrow {
  color: #c4b5fd;
}

.legislation-hero h1 {
  margin: 0;
  color: #fff;
  font-size: clamp(2.3rem, 5vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.07em;
  line-height: 1.1;
}

.hero-description {
  max-width: 640px;
  margin: 20px 0 0;
  color: #e0e7ff;
  font-size: 1.04rem;
  line-height: 1.75;
}

.hero-note {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 24px;
  color: #c7d2fe;
  font-size: 0.82rem;
}

.hero-summary {
  display: grid;
  flex: 0 0 240px;
  gap: 8px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 18px;
  color: #e0e7ff;
  background: rgb(15 23 42 / 24%);
}

:deep(.hero-summary .el-card__body) {
  display: grid;
  gap: 8px;
  padding: 22px;
}

.hero-summary > span,
.hero-summary > small {
  color: #c7d2fe;
  font-size: 0.76rem;
}

.hero-summary strong {
  color: #fff;
  font-size: 3rem;
  font-weight: 800;
  letter-spacing: -0.08em;
  line-height: 1;
}

.hero-summary strong small {
  margin-left: 4px;
  color: #c7d2fe;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0;
}

.legislation-disclaimer {
  margin-top: 24px;
  border: 1px solid #bfdbfe;
}

.legislation-disclaimer p {
  margin: 6px 0 0;
  color: #536179;
  font-size: 0.82rem;
  line-height: 1.6;
}

.filter-section,
.results-section {
  margin-top: 54px;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}

.section-eyebrow {
  color: #2563eb;
}

.section-heading h2 {
  margin: 0;
  color: #172033;
  font-size: 1.55rem;
  font-weight: 800;
  letter-spacing: -0.05em;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.skeleton-card {
  min-height: 380px;
  border: 1px solid #e5eaf2;
  border-radius: 18px;
}

.empty-state {
  min-height: 300px;
  border: 1px dashed #d6deec;
  border-radius: 18px;
  background: #fff;
}

@media (max-width: 820px) {
  .legislation-hero {
    align-items: stretch;
    display: grid;
  }

  .hero-summary {
    max-width: 280px;
  }
}

@media (max-width: 680px) {
  .legislation-page {
    padding: 32px 18px 64px;
  }

  .legislation-hero {
    padding: 32px 24px;
  }

  .hero-note {
    align-items: flex-start;
    display: grid;
  }

  .card-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .section-heading {
    align-items: flex-start;
    display: grid;
  }
}
</style>
