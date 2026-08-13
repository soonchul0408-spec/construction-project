<script setup>
import { computed, onMounted, ref } from 'vue'
import ApiFallbackNotice from '@/components/regional/ApiFallbackNotice.vue'
import DataOriginBadge from '@/components/regional/DataOriginBadge.vue'
import RegionalInfoCard from '@/components/regional/RegionalInfoCard.vue'
import { useAnalysisStore } from '@/stores/analysis'
import { useRegionalIndustryStore } from '@/stores/regionalIndustry'

const selectedRegion = ref('전체')
const selectedCategory = ref('전체')
const selectedStage = ref('전체')
const analysisStore = useAnalysisStore()
const dataStore = useRegionalIndustryStore()

const filteredItems = computed(() =>
  dataStore.items.filter((item) => {
    const matchesRegion = selectedRegion.value === '전체' || item.region === selectedRegion.value
    const matchesCategory =
      selectedCategory.value === '전체' || item.category === selectedCategory.value
    const matchesStage = selectedStage.value === '전체' || item.stage === selectedStage.value

    return matchesRegion && matchesCategory && matchesStage
  }),
)

const activeRegionLabel = computed(() => {
  const region = dataStore.regionOptions.find((option) => option.value === selectedRegion.value)
  return region?.label ?? '전체 지역'
})

const isSelectedRegionSaved = computed(
  () => selectedRegion.value !== '전체' && analysisStore.isRegionSaved(selectedRegion.value),
)

function toggleSelectedRegion() {
  if (selectedRegion.value !== '전체') analysisStore.toggleRegion(selectedRegion.value)
}

function resetFilters() {
  selectedRegion.value = '전체'
  selectedCategory.value = '전체'
  selectedStage.value = '전체'
}

onMounted(() => {
  void dataStore.load()
})
</script>

<template>
  <div class="regional-page">
    <section class="regional-hero">
      <div class="hero-copy">
        <p class="eyebrow">REGIONAL INDUSTRY INSIGHT</p>
        <h1>지역산업 분석</h1>
        <p class="hero-description">
          관심 지역의 정책·예산·사업 관련 정보와 산업 연관 기업을 공개자료 중심으로 살펴보세요.
        </p>
        <div class="hero-note">
          <DataOriginBadge :origin="dataStore.dataOrigin" />
          <span>투자 판단을 대신하지 않으며, 공개자료를 정리해 보여줍니다.</span>
        </div>
      </div>

      <el-card class="hero-summary" shadow="never">
        <span>현재 확인 가능한 관련 정보</span>
        <strong>{{ filteredItems.length }}<small>건</small></strong>
        <small>{{ activeRegionLabel }} · {{ dataStore.dataOriginLabel }}</small>
      </el-card>
    </section>

    <ApiFallbackNotice
      :status="dataStore.status"
      :message="dataStore.errorMessage"
      @retry="dataStore.retry"
    />

    <section class="filter-section">
      <div class="section-heading">
        <div>
          <p class="section-eyebrow">FILTERS</p>
          <h2>관심 지역과 조건을 선택하세요</h2>
        </div>
        <el-button plain @click="resetFilters">필터 초기화</el-button>
      </div>

      <el-card class="filter-card" shadow="never">
        <div class="filter-grid">
          <div class="filter-field">
            <label for="region-filter">시·도 / 지역</label>
            <div class="region-filter-control">
              <el-select id="region-filter" v-model="selectedRegion" aria-label="시·도 또는 지역 선택">
                <el-option
                  v-for="option in dataStore.regionOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <el-button
                type="primary"
                plain
                :disabled="selectedRegion === '전체'"
                @click="toggleSelectedRegion"
              >
                {{ isSelectedRegionSaved ? '관심 지역 해제' : '관심 지역 저장' }}
              </el-button>
            </div>
          </div>

          <div class="filter-field">
            <label for="category-filter">산업 카테고리</label>
            <el-select id="category-filter" v-model="selectedCategory" aria-label="산업 카테고리 선택">
              <el-option
                v-for="option in dataStore.industryCategories"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </div>

          <div class="filter-field">
            <label for="stage-filter">정책 진행 단계</label>
            <el-select id="stage-filter" v-model="selectedStage" aria-label="정책 진행 단계 선택">
              <el-option
                v-for="option in dataStore.policyStages"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </div>
        </div>

        <div class="active-filters">
          <span>현재 조건</span>
          <el-tag effect="plain">{{ activeRegionLabel }}</el-tag>
          <el-tag v-if="isSelectedRegionSaved" type="success">관심 지역 저장됨</el-tag>
          <el-tag type="success" effect="plain">{{ selectedCategory }}</el-tag>
          <el-tag type="warning" effect="plain">{{ selectedStage }}</el-tag>
        </div>
      </el-card>
    </section>

    <section class="results-section">
      <div class="section-heading results-heading">
        <div>
          <p class="section-eyebrow">PUBLIC DATA</p>
          <h2>정책·예산·사업 관련 정보</h2>
        </div>
        <el-tag type="info" effect="plain">{{ filteredItems.length }}건</el-tag>
      </div>

      <div v-if="dataStore.status === 'loading'" class="card-grid loading-grid" aria-busy="true">
        <el-card v-for="index in 4" :key="index" class="skeleton-card" shadow="never">
          <el-skeleton animated :rows="6" />
        </el-card>
      </div>

      <div v-else-if="filteredItems.length" class="card-grid">
        <RegionalInfoCard v-for="item in filteredItems" :key="item.id" :item="item" />
      </div>

      <el-empty
        v-else
        class="empty-state"
        description="선택한 조건에 맞는 공개자료가 없습니다. 필터를 바꿔 다시 확인해 보세요."
      />
    </section>
  </div>
</template>

<style scoped>
.regional-page {
  max-width: 1240px;
  margin: 0 auto;
  padding: 56px 24px 88px;
}

.regional-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  padding: 48px;
  border-radius: 28px;
  color: #fff;
  background:
    radial-gradient(circle at 92% 10%, rgb(45 212 191 / 28%), transparent 34%),
    linear-gradient(135deg, #172554 0%, #1e3a8a 55%, #0f766e 130%);
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
  color: #93c5fd;
}

.regional-hero h1 {
  margin: 0;
  font-size: clamp(2.3rem, 5vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.07em;
  line-height: 1.1;
}

.hero-description {
  max-width: 620px;
  margin: 20px 0 0;
  color: #dbeafe;
  font-size: 1.04rem;
  line-height: 1.75;
}

.hero-note {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 24px;
  color: #bfdbfe;
  font-size: 0.82rem;
}

.hero-summary {
  display: grid;
  flex: 0 0 230px;
  gap: 8px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 18px;
  color: #dbeafe;
  background: rgb(15 23 42 / 24%);
}

:deep(.hero-summary .el-card__body) {
  display: grid;
  gap: 8px;
  padding: 22px;
}

.hero-summary > span,
.hero-summary > small {
  color: #bfdbfe;
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
  color: #bfdbfe;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0;
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
  margin-bottom: 18px;
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

.filter-card {
  border: 1px solid #e5eaf2;
  border-radius: 20px;
  background: #fff;
}

:deep(.filter-card .el-card__body) {
  padding: 24px;
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

.region-filter-control {
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

.results-heading {
  margin-bottom: 22px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.skeleton-card {
  min-height: 360px;
  border: 1px solid #e5eaf2;
  border-radius: 18px;
}

:deep(.skeleton-card .el-card__body) {
  padding: 24px;
}

.empty-state {
  min-height: 280px;
  border: 1px dashed #cbd5e1;
  border-radius: 18px;
  background: #fff;
}

@media (max-width: 820px) {
  .regional-hero {
    align-items: stretch;
    display: grid;
    padding: 34px 28px;
  }

  .hero-summary {
    width: 100%;
  }
}

@media (max-width: 680px) {
  .regional-page {
    padding: 32px 18px 60px;
  }

  .regional-hero {
    padding: 28px 22px;
    border-radius: 22px;
  }

  .hero-description {
    font-size: 0.94rem;
  }

  .hero-note {
    align-items: flex-start;
    display: grid;
    gap: 8px;
  }

  .filter-grid,
  .card-grid {
    grid-template-columns: 1fr;
  }

  .section-heading {
    align-items: flex-start;
    display: grid;
  }

  .results-heading {
    display: flex;
    align-items: flex-end;
  }
}
</style>
