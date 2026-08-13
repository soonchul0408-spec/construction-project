<script setup>
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ApiFallbackNotice from '@/components/regional/ApiFallbackNotice.vue'
import DataOriginBadge from '@/components/regional/DataOriginBadge.vue'
import RegionalCompanyTable from '@/components/regional/RegionalCompanyTable.vue'
import SourceMeta from '@/components/regional/SourceMeta.vue'
import {
  COMPANY_RELATION_STATUSES,
} from '@/data/regionalIndustryCompanies'
import { useAnalysisStore } from '@/stores/analysis'
import { useRegionalIndustryStore } from '@/stores/regionalIndustry'

const route = useRoute()
const router = useRouter()
const analysisStore = useAnalysisStore()
const dataStore = useRegionalIndustryStore()

const item = computed(() => dataStore.getItem(route.params.id))

const relatedCompanies = computed(() => {
  return dataStore.getRelatedCompanies(item.value)
})

const isProjectSaved = computed(() =>
  item.value ? analysisStore.isProjectSaved(item.value.id) : false,
)

const isRegionSaved = computed(() =>
  item.value ? analysisStore.isRegionSaved(item.value.region) : false,
)

const categoryTagTypes = {
  'AI·데이터센터': 'primary',
  반도체: 'success',
  방산: 'danger',
  이차전지: 'warning',
  '전력·에너지': 'info',
}

const stageTagTypes = {
  발의: 'info',
  '심사 중': 'warning',
  예산안: 'warning',
  '사업 공고': 'primary',
  '사업자 선정': 'success',
  착공: 'danger',
}

function getTagType(types, value) {
  return types[value] ?? 'info'
}

function goBack() {
  router.push({ name: 'regional-industry' })
}

function toggleProject() {
  if (item.value) analysisStore.toggleProject(item.value.id)
}

function toggleRegion() {
  if (item.value) analysisStore.toggleRegion(item.value.region)
}

onMounted(() => {
  void dataStore.load()
})
</script>

<template>
  <div v-if="item" class="detail-page">
    <div class="detail-toolbar">
      <el-button text @click="goBack">← 목록으로</el-button>
      <div class="toolbar-tags">
        <DataOriginBadge :origin="item.dataOrigin" />
        <el-tag type="info" effect="plain">공개자료 기반 관련 기업</el-tag>
      </div>
    </div>

    <ApiFallbackNotice
      :status="dataStore.status"
      :message="dataStore.errorMessage"
      @retry="dataStore.retry"
    />

    <section class="detail-hero">
      <div>
        <p class="eyebrow">REGIONAL INDUSTRY DETAIL</p>
        <div class="hero-title-row">
          <el-tag size="small" type="info" effect="plain">{{ item.recordType }}</el-tag>
          <span>{{ item.region }}</span>
        </div>
        <h1>{{ item.projectName }}</h1>
        <p>{{ item.description }}</p>
      </div>
      <div class="hero-tags">
        <el-tag :type="getTagType(categoryTagTypes, item.category)" effect="dark">
          {{ item.category }}
        </el-tag>
        <el-tag :type="getTagType(stageTagTypes, item.stage)" effect="dark">
          {{ item.stage }}
        </el-tag>
      </div>
    </section>

    <div class="detail-layout">
      <main class="detail-main">
        <el-card class="project-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span>사업 개요</span>
              <el-tag type="info" effect="plain">{{ item.category }}</el-tag>
            </div>
          </template>

          <dl class="project-details">
            <div>
              <dt>지역</dt>
              <dd>{{ item.region }}</dd>
            </div>
            <div>
              <dt>사업명</dt>
              <dd>{{ item.projectName }}</dd>
            </div>
            <div>
              <dt>사업 규모</dt>
              <dd>{{ item.scale }}</dd>
            </div>
            <div>
              <dt>현재 진행 단계</dt>
              <dd>
                <el-tag :type="getTagType(stageTagTypes, item.stage)">{{ item.stage }}</el-tag>
              </dd>
            </div>
          </dl>

          <div class="description-block">
            <span class="detail-label">사업 설명</span>
            <p>{{ item.description }}</p>
          </div>

          <SourceMeta :item="item" class="detail-source-meta" />

          <div class="source-actions">
            <el-button type="primary" @click="toggleProject">
              {{ isProjectSaved ? '관심 정책·사업 해제' : '관심 정책·사업 저장' }}
            </el-button>
            <el-button type="success" plain @click="toggleRegion">
              {{ isRegionSaved ? '관심 지역 해제' : '관심 지역 저장' }}
            </el-button>
            <el-button
              plain
              tag="a"
              :href="item.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              공식 출처 열기 ↗
            </el-button>
            <el-button plain @click="goBack">목록으로 돌아가기</el-button>
          </div>
        </el-card>

        <el-card class="timeline-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span>사업 진행 타임라인</span>
              <small>공개자료 기준</small>
            </div>
          </template>

          <el-timeline>
            <el-timeline-item
              v-for="event in item.timeline"
              :key="`${event.date}-${event.title}`"
              :timestamp="event.date"
              :type="event.type"
              placement="top"
            >
              <strong>{{ event.title }}</strong>
              <p>{{ event.description }}</p>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </main>

      <aside class="detail-aside">
        <el-card class="company-summary" shadow="never">
          <template #header>
            <div class="card-header">
              <span>관련 기업 연결</span>
              <el-tag type="success" effect="plain">{{ relatedCompanies.length }}개</el-tag>
            </div>
          </template>
          <strong class="company-count">{{ relatedCompanies.length }}</strong>
          <p>
            사업과 산업적으로 연결된 기업을 공개자료 기반으로 정리했습니다. 직접 참여 여부와 연결 근거를
            구분해 확인할 수 있습니다.
          </p>
          <div class="status-legend">
            <span class="detail-label">기업 상태 구분</span>
            <el-tag
              v-for="status in COMPANY_RELATION_STATUSES"
              :key="status.value"
              :type="status.type"
              effect="plain"
            >
              {{ status.value }}
            </el-tag>
          </div>
        </el-card>
      </aside>
    </div>

    <section class="companies-section">
      <div class="section-heading">
        <div>
          <p class="section-eyebrow">CONNECTED COMPANIES</p>
          <h2>공개자료 기반 관련 기업</h2>
          <p>기업별 연결 이유, 직접 참여 여부, 연결 근거를 분리해 표시합니다.</p>
        </div>
        <el-tag type="info" effect="plain">{{ relatedCompanies.length }}개 기업</el-tag>
      </div>

      <el-alert class="company-disclaimer" type="info" :closable="false" show-icon>
        <div class="company-disclaimer__content">
          <strong>공개자료 기반 관련 기업 정보입니다.</strong>
          <span>산업 관련성이 실제 사업 참여를 의미하지는 않습니다.</span>
          <span>이 서비스는 투자 추천이 아니라 정보 정리와 개인 판단 기록을 위한 서비스입니다.</span>
        </div>
      </el-alert>

      <ApiFallbackNotice
        :status="dataStore.companyStatus"
        :message="dataStore.companyErrorMessage"
        @retry="dataStore.retry"
      />

      <div
        v-if="dataStore.companyStatus === 'loading'"
        class="company-loading-grid"
        aria-busy="true"
        aria-label="DART 기업정보를 불러오는 중"
      >
        <el-card v-for="index in 2" :key="index" shadow="never">
          <el-skeleton animated :rows="6" />
        </el-card>
      </div>

      <el-alert
        v-else-if="dataStore.companyStatus === 'empty'"
        class="company-empty-notice"
        type="info"
        :closable="false"
        show-icon
        title="DART 기업 데이터가 없어 기존 샘플 기업을 표시하고 있습니다."
      />

      <RegionalCompanyTable v-if="dataStore.companyStatus !== 'loading' && relatedCompanies.length" :companies="relatedCompanies" />
      <el-empty v-else-if="dataStore.companyStatus !== 'loading'" description="현재 연결된 관련 기업 공개자료가 없습니다.">
        <el-button type="primary" plain @click="goBack">목록으로 돌아가기</el-button>
      </el-empty>
    </section>
  </div>

  <el-empty v-else class="missing-detail" description="해당 사업 정보를 찾을 수 없습니다.">
    <el-button type="primary" @click="goBack">지역산업 분석으로 돌아가기</el-button>
  </el-empty>
</template>

<style scoped>
.detail-page {
  max-width: 1240px;
  margin: 0 auto;
  padding: 34px 24px 88px;
}

.detail-toolbar,
.hero-title-row,
.hero-tags,
.card-header,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.detail-toolbar {
  margin-bottom: 18px;
}

.toolbar-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.detail-toolbar :deep(.el-button) {
  padding: 0;
  color: #526078;
  font-weight: 800;
}

.detail-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  padding: 42px;
  border-radius: 26px;
  color: #fff;
  background:
    radial-gradient(circle at 86% 12%, rgb(45 212 191 / 28%), transparent 32%),
    linear-gradient(135deg, #172554 0%, #1e3a8a 56%, #0f766e 130%);
  box-shadow: 0 24px 50px rgb(30 58 138 / 18%);
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

.hero-title-row {
  justify-content: flex-start;
  color: #bfdbfe;
  font-size: 0.86rem;
  font-weight: 700;
}

.detail-hero h1 {
  max-width: 760px;
  margin: 14px 0 0;
  color: #fff;
  font-size: clamp(2rem, 4vw, 3.2rem);
  font-weight: 800;
  letter-spacing: -0.07em;
  line-height: 1.16;
}

.detail-hero p {
  max-width: 720px;
  margin: 16px 0 0;
  color: #dbeafe;
  font-size: 0.98rem;
  line-height: 1.75;
}

.hero-tags {
  align-items: flex-end;
  flex-shrink: 0;
  flex-direction: column;
}

.detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
  gap: 20px;
  margin-top: 28px;
}

.detail-main {
  display: grid;
  gap: 20px;
}

.project-card,
.timeline-card,
.company-summary {
  border: 1px solid #e5eaf2;
  border-radius: 20px;
  background: #fff;
}

.card-header {
  color: #172033;
  font-size: 1rem;
  font-weight: 800;
}

.card-header small {
  color: #8a96aa;
  font-size: 0.76rem;
  font-weight: 700;
}

.project-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
}

.project-details > div {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: 13px;
  background: #f7f9fc;
}

dt,
.detail-label {
  color: #8a96aa;
  font-size: 0.75rem;
  font-weight: 800;
}

dd {
  margin: 0;
  color: #26344d;
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.5;
}

.description-block {
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid #edf0f5;
}

.description-block p,
.company-summary p,
.section-heading p {
  margin: 8px 0 0;
  color: #5f6d83;
  font-size: 0.88rem;
  line-height: 1.7;
}

.detail-source-meta {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid #edf0f5;
}

.source-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
}

.timeline-card :deep(.el-card__body) {
  padding-bottom: 10px;
}

.timeline-card :deep(.el-timeline-item__content) {
  color: #34445e;
}

.timeline-card strong {
  color: #172033;
  font-size: 0.92rem;
}

.timeline-card p {
  margin: 5px 0 0;
  color: #6b7890;
  font-size: 0.84rem;
  line-height: 1.6;
}

.company-summary :deep(.el-card__body) {
  display: grid;
  gap: 14px;
}

.company-count {
  color: #2563eb;
  font-size: 3.2rem;
  font-weight: 800;
  letter-spacing: -0.08em;
  line-height: 1;
}

.status-legend {
  display: grid;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid #edf0f5;
}

.status-legend :deep(.el-tag) {
  width: fit-content;
  max-width: 100%;
  white-space: normal;
}

.companies-section {
  margin-top: 54px;
}

.section-heading {
  align-items: flex-end;
  margin-bottom: 20px;
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

.section-heading > :last-child {
  flex-shrink: 0;
}

.company-disclaimer {
  margin-bottom: 16px;
}

.company-disclaimer__content {
  display: grid;
  gap: 4px;
  color: #526078;
  font-size: 0.82rem;
  line-height: 1.6;
}

.company-disclaimer__content strong {
  color: #34445e;
}

.company-loading-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.company-loading-grid :deep(.el-card) {
  border: 1px solid #e5eaf2;
  border-radius: 16px;
}

.company-empty-notice {
  margin-bottom: 16px;
}

.missing-detail {
  min-height: 420px;
}

@media (max-width: 900px) {
  .detail-layout {
    grid-template-columns: 1fr;
  }

  .detail-aside {
    order: -1;
  }
}

@media (max-width: 680px) {
  .detail-page {
    padding: 24px 18px 60px;
  }

  .detail-hero {
    align-items: stretch;
    display: grid;
    padding: 28px 22px;
    border-radius: 22px;
  }

  .hero-tags {
    align-items: flex-start;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .project-details {
    grid-template-columns: 1fr;
  }

  .section-heading {
    align-items: flex-start;
    display: grid;
  }

  .company-loading-grid {
    grid-template-columns: 1fr;
  }

  .detail-toolbar {
    align-items: flex-start;
    display: grid;
    gap: 10px;
  }
}
</style>
