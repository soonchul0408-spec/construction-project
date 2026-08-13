<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import ApiFallbackNotice from '@/components/regional/ApiFallbackNotice.vue'
import DataOriginBadge from '@/components/regional/DataOriginBadge.vue'
import SavedAnalysisCard from '@/components/analysis/SavedAnalysisCard.vue'
import { COMPANY_RELATION_STATUSES } from '@/data/regionalIndustryCompanies'
import { useAnalysisStore } from '@/stores/analysis'
import { useRegionalIndustryStore } from '@/stores/regionalIndustry'

const router = useRouter()
const analysisStore = useAnalysisStore()
const dataStore = useRegionalIndustryStore()
const memoDialogVisible = ref(false)
const editingProjectId = ref('')
const DART_SEARCH_URL = 'https://dart.fss.or.kr/dsab001/main.do?autoSearch=true&textCrpNm='

function createEmptyMemo() {
  return {
    interestReason: '',
    judgmentBasis: '',
    expectedScenario: '',
    concerns: '',
    nextChecks: '',
  }
}

const memoForm = reactive(createEmptyMemo())

const savedProjects = computed(() =>
  dataStore.items.filter((item) => analysisStore.savedProjectIds.includes(item.id)),
)

const savedCompanies = computed(() =>
  dataStore.companies.filter((company) => analysisStore.savedCompanyIds.includes(company.id)),
)

const savedItemCount = computed(
  () =>
    analysisStore.savedRegions.length + savedProjects.value.length + savedCompanies.value.length,
)

const hasSavedData = computed(
  () =>
    analysisStore.savedRegions.length > 0 ||
    savedProjects.value.length > 0 ||
    savedCompanies.value.length > 0,
)

function getRelatedCompanies(project) {
  return dataStore.getRelatedCompanies(project)
}

function getCompanyProjects(company) {
  return dataStore.items.filter((project) => (company.projectIds ?? []).includes(project.id))
}

function getSavedProjectCount(region) {
  return savedProjects.value.filter((project) => project.region === region).length
}

function getStatusType(status) {
  return COMPANY_RELATION_STATUSES.find((item) => item.value === status)?.type ?? 'info'
}

function openProject(projectId) {
  router.push({ name: 'regional-industry-detail', params: { id: projectId } })
}

function removeRegion(region) {
  analysisStore.toggleRegion(region)
}

function removeCompany(companyId) {
  analysisStore.toggleCompany(companyId)
}

function updateCompanyWeight(companyId, weight) {
  analysisStore.setCompanyWeight(companyId, weight)
}

function getDartSearchUrl(companyName) {
  return `${DART_SEARCH_URL}${encodeURIComponent(companyName)}`
}

function openMemoDialog(projectId) {
  editingProjectId.value = projectId
  Object.assign(memoForm, analysisStore.getProjectNote(projectId))
  memoDialogVisible.value = true
}

function closeMemoDialog() {
  memoDialogVisible.value = false
}

function saveMemo() {
  if (!editingProjectId.value) return

  analysisStore.updateProjectNote(editingProjectId.value, { ...memoForm })
  closeMemoDialog()
}

function goToRegionalIndustry() {
  router.push({ name: 'regional-industry' })
}

onMounted(() => {
  void dataStore.load()
})
</script>

<template>
  <div class="my-analysis-page">
    <section class="analysis-hero">
      <div class="hero-copy">
        <p class="eyebrow">PERSONAL RESEARCH</p>
        <h1>내 분석</h1>
        <p class="hero-description">
          관심 지역·정책·사업·기업을 모아보고, 공개자료를 바탕으로 나만의 분석 메모를 기록하세요.
        </p>
        <div class="research-notice">
          <DataOriginBadge :origin="dataStore.dataOrigin" />
          <el-tag type="success" effect="dark">공개자료 기반 개인 리서치 기록</el-tag>
          <p>이 서비스는 투자 추천이 아니라 정보 정리와 개인 판단 기록을 위한 서비스입니다.</p>
        </div>
      </div>

      <el-card class="analysis-summary" shadow="never">
        <span>저장 항목</span>
        <strong>{{ savedItemCount }}<small>건</small></strong>
        <small>
          지역 {{ analysisStore.savedRegions.length }} · 정책·사업 {{ savedProjects.length }} · 기업
          {{ savedCompanies.length }}
        </small>
      </el-card>
    </section>

    <ApiFallbackNotice
      :status="dataStore.status"
      :message="dataStore.errorMessage"
      @retry="dataStore.retry"
    />

    <div v-if="!hasSavedData" class="empty-container">
      <el-empty description="저장한 관심 정보가 없습니다.">
        <el-button type="primary" @click="goToRegionalIndustry">
          지역산업 분석에서 정보 찾아보기
        </el-button>
      </el-empty>
    </div>

    <template v-else>
      <section v-if="analysisStore.savedRegions.length" class="analysis-section regions-section">
        <div class="section-heading">
          <div>
            <p class="section-eyebrow">SAVED REGIONS</p>
            <h2>관심 지역</h2>
          </div>
          <el-tag type="success" effect="plain">{{ analysisStore.savedRegions.length }}개 지역</el-tag>
        </div>

        <el-card class="regions-card" shadow="never">
          <div class="region-list">
            <div v-for="region in analysisStore.savedRegions" :key="region" class="region-row">
              <div>
                <el-tag type="success">{{ region }}</el-tag>
                <span>{{ getSavedProjectCount(region) }}개 저장 사업</span>
              </div>
              <el-button text type="danger" @click="removeRegion(region)">관심 지역 해제</el-button>
            </div>
          </div>
        </el-card>
      </section>

      <section class="analysis-section projects-section">
        <div class="section-heading">
          <div>
            <p class="section-eyebrow">SAVED POLICY &amp; PROJECTS</p>
            <h2>저장한 정책·사업</h2>
          </div>
          <el-tag type="primary" effect="plain">{{ savedProjects.length }}개</el-tag>
        </div>

        <div v-if="savedProjects.length" class="project-list">
          <SavedAnalysisCard
            v-for="project in savedProjects"
            :key="project.id"
            :project="project"
            :related-companies="getRelatedCompanies(project)"
            @edit-memo="openMemoDialog"
          />
        </div>
        <el-empty v-else description="저장한 정책·사업이 없습니다.">
          <el-button type="primary" plain @click="goToRegionalIndustry">
            정책·사업 찾아보기
          </el-button>
        </el-empty>
      </section>

      <section class="analysis-section companies-section">
        <div class="section-heading">
          <div>
            <p class="section-eyebrow">SAVED COMPANIES</p>
            <h2>관심 기업</h2>
          </div>
          <el-tag type="info" effect="plain">{{ savedCompanies.length }}개</el-tag>
        </div>

        <div v-if="savedCompanies.length" class="company-grid">
          <el-card v-for="company in savedCompanies" :key="company.id" class="company-card" shadow="never">
            <template #header>
              <div class="company-card-header">
                <div>
                  <h3>{{ company.companyName }}</h3>
                  <div class="company-header-tags">
                    <el-tag :type="getStatusType(company.relationStatus)" size="small" effect="plain">
                      {{ company.relationStatus }}
                    </el-tag>
                    <DataOriginBadge :origin="company.dataOrigin" />
                  </div>
                </div>
                <el-button text type="danger" @click="removeCompany(company.id)">관심 해제</el-button>
              </div>
            </template>

            <div class="industry-tags">
              <el-tag v-for="industry in company.industries" :key="industry" effect="plain">
                {{ industry }}
              </el-tag>
            </div>
            <p class="company-business">{{ company.mainBusiness }}</p>
            <p v-if="company.dartBusinessSummary" class="dart-business-summary">
              {{ company.dartBusinessSummary }}
            </p>

            <dl class="company-details">
              <div>
                <dt>해당 사업과 연결되는 이유</dt>
                <dd>{{ company.relationReason }}</dd>
              </div>
              <div>
                <dt>직접 참여 여부</dt>
                <dd>{{ company.directParticipation }}</dd>
              </div>
              <div>
                <dt>연결 근거</dt>
                <dd>{{ company.connectionBasis }}</dd>
              </div>
            </dl>

            <div class="linked-projects">
              <span>연결된 정책·사업</span>
              <div>
                <el-button
                  v-for="project in getCompanyProjects(company)"
                  :key="project.id"
                  text
                  type="primary"
                  @click="openProject(project.id)"
                >
                  {{ project.projectName }}
                </el-button>
              </div>
            </div>

            <div class="company-dart-links">
              <span>DART 공시 출처</span>
              <div v-if="company.dartDisclosures?.length" class="dart-disclosure-list">
                <el-link
                  v-for="disclosure in company.dartDisclosures.slice(0, 3)"
                  :key="disclosure.receiptNo"
                  :href="disclosure.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  type="primary"
                >
                  {{ disclosure.reportName }} ↗
                </el-link>
              </div>
              <el-link
                v-else
                :href="getDartSearchUrl(company.companyName)"
                target="_blank"
                rel="noopener noreferrer"
                type="primary"
              >
                DART 기업검색 ↗
              </el-link>
              <small v-if="company.verifiedAt">확인 {{ company.verifiedAt }}</small>
            </div>

            <div class="company-interest-control">
              <div class="interest-heading">
                <span>개인 관심 비중</span>
                <strong>{{ analysisStore.getCompanyWeight(company.id) }}%</strong>
              </div>
              <el-progress :percentage="analysisStore.getCompanyWeight(company.id)" />
              <div class="interest-input-row">
                <el-input-number
                  :model-value="analysisStore.getCompanyWeight(company.id)"
                  :min="0"
                  :max="100"
                  :step="5"
                  controls-position="right"
                  aria-label="개인 관심 비중 입력"
                  @update:model-value="updateCompanyWeight(company.id, $event)"
                />
                <small>권장 비율이 아닌 사용자가 설정하는 개인 관심 비중입니다.</small>
              </div>
            </div>

            <el-link
              class="company-link"
              :href="company.officialUrl"
              target="_blank"
              rel="noopener noreferrer"
              type="primary"
            >
              {{ company.officialLinkLabel }} ↗
            </el-link>
          </el-card>
        </div>
        <el-empty v-else description="관심 기업으로 추가한 기업이 없습니다.">
          <el-button type="primary" plain @click="goToRegionalIndustry">
            관련 기업 찾아보기
          </el-button>
        </el-empty>
      </section>
    </template>

    <el-dialog v-model="memoDialogVisible" title="개인 분석 메모" width="680px" destroy-on-close>
      <p class="dialog-description">저장한 정책·사업에 대한 공개자료 기반 개인 판단 기록입니다.</p>
      <el-form :model="memoForm" label-position="top" class="memo-form">
        <el-form-item label="관심 이유">
          <el-input
            v-model="memoForm.interestReason"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="이 정책·사업에 관심을 둔 이유를 적어보세요."
          />
        </el-form-item>
        <el-form-item label="투자 판단 근거">
          <el-input
            v-model="memoForm.judgmentBasis"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="공개자료를 바탕으로 정리한 개인 판단 근거를 적어보세요."
          />
        </el-form-item>
        <el-form-item label="기대하는 시나리오">
          <el-input
            v-model="memoForm.expectedScenario"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="앞으로 전개될 수 있다고 생각하는 시나리오를 적어보세요."
          />
        </el-form-item>
        <el-form-item label="우려되는 점">
          <el-input
            v-model="memoForm.concerns"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="확인되지 않은 부분이나 우려되는 점을 적어보세요."
          />
        </el-form-item>
        <el-form-item label="앞으로 확인할 정보">
          <el-input
            v-model="memoForm.nextChecks"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="다음에 확인할 공식 출처·공시·정책 자료를 적어보세요."
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeMemoDialog">취소</el-button>
        <el-button type="primary" @click="saveMemo">메모 저장</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.my-analysis-page {
  max-width: 1240px;
  margin: 0 auto;
  padding: 56px 24px 88px;
}

.analysis-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  padding: 48px;
  border-radius: 28px;
  color: #fff;
  background:
    radial-gradient(circle at 90% 12%, rgb(45 212 191 / 28%), transparent 32%),
    linear-gradient(135deg, #172554 0%, #1e3a8a 56%, #0f766e 130%);
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

.analysis-hero h1 {
  margin: 0;
  color: #fff;
  font-size: clamp(2.3rem, 5vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.07em;
  line-height: 1.1;
}

.hero-description {
  max-width: 650px;
  margin: 20px 0 0;
  color: #dbeafe;
  font-size: 1.04rem;
  line-height: 1.75;
}

.research-notice {
  display: grid;
  gap: 10px;
  margin-top: 24px;
}

.research-notice p {
  margin: 0;
  color: #bfdbfe;
  font-size: 0.82rem;
  line-height: 1.6;
}

.analysis-summary {
  display: grid;
  flex: 0 0 230px;
  gap: 8px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 18px;
  color: #dbeafe;
  background: rgb(15 23 42 / 24%);
}

:deep(.analysis-summary .el-card__body) {
  display: grid;
  gap: 8px;
  padding: 22px;
}

.analysis-summary > span,
.analysis-summary > small {
  color: #bfdbfe;
  font-size: 0.76rem;
}

.analysis-summary strong {
  color: #fff;
  font-size: 3rem;
  font-weight: 800;
  letter-spacing: -0.08em;
  line-height: 1;
}

.analysis-summary strong small {
  margin-left: 4px;
  color: #bfdbfe;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0;
}

.empty-container {
  display: grid;
  min-height: 360px;
  margin-top: 34px;
  place-items: center;
  border: 1px dashed #cbd5e1;
  border-radius: 20px;
  background: #fff;
}

.analysis-section {
  margin-top: 54px;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
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

.regions-card,
.company-card {
  border: 1px solid #e5eaf2;
  border-radius: 20px;
  background: #fff;
}

.region-list {
  display: grid;
  gap: 10px;
}

.region-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 13px;
  background: #f7f9fc;
}

.region-row > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.region-row span {
  color: #6b7890;
  font-size: 0.82rem;
}

.project-list {
  display: grid;
  gap: 20px;
}

.company-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.company-card :deep(.el-card__header) {
  padding: 20px 22px;
}

.company-card :deep(.el-card__body) {
  padding: 20px 22px 22px;
}

.company-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.company-header-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.company-card-header h3 {
  margin: 0 0 9px;
  color: #172033;
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.industry-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.company-business {
  margin: 12px 0 0;
  color: #34445e;
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.6;
}

.dart-business-summary {
  margin: 6px 0 0;
  color: #738097;
  font-size: 0.76rem;
  line-height: 1.55;
}

.company-details {
  display: grid;
  gap: 12px;
  margin: 20px 0 0;
}

.company-details > div {
  display: grid;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid #edf0f5;
}

dt,
.linked-projects > span,
.interest-heading span {
  color: #8a96aa;
  font-size: 0.72rem;
  font-weight: 800;
}

dd {
  margin: 0;
  color: #5f6d83;
  font-size: 0.82rem;
  line-height: 1.65;
}

.linked-projects {
  display: grid;
  gap: 7px;
  margin-top: 20px;
  padding: 14px;
  border-radius: 13px;
  background: #f7f9fc;
}

.linked-projects > div {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 8px;
}

.linked-projects :deep(.el-button) {
  height: auto;
  padding: 3px 0;
  text-align: left;
  white-space: normal;
}

.company-dart-links {
  display: grid;
  gap: 7px;
  margin-top: 18px;
  padding: 14px;
  border-radius: 13px;
  background: #f7f9fc;
}

.company-dart-links > span {
  color: #8a96aa;
  font-size: 0.72rem;
  font-weight: 800;
}

.dart-disclosure-list {
  display: grid;
  gap: 5px;
}

.company-dart-links small {
  color: #96a0b1;
  font-size: 0.7rem;
}

.company-interest-control {
  display: grid;
  gap: 10px;
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid #edf0f5;
}

.interest-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.interest-heading strong {
  color: #2563eb;
  font-size: 0.9rem;
}

.interest-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.interest-input-row :deep(.el-input-number) {
  width: 130px;
}

.interest-input-row small {
  color: #96a0b1;
  font-size: 0.72rem;
  line-height: 1.5;
}

.company-link {
  margin-top: 18px;
  font-size: 0.8rem;
  font-weight: 700;
}

.dialog-description {
  margin: 0 0 18px;
  color: #6b7890;
  font-size: 0.86rem;
  line-height: 1.6;
}

.memo-form {
  display: grid;
  gap: 2px;
}

.memo-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

@media (max-width: 900px) {
  .analysis-hero {
    align-items: stretch;
    display: grid;
    padding: 34px 28px;
  }

  .analysis-summary {
    width: 100%;
  }

  .company-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .my-analysis-page {
    padding: 32px 18px 60px;
  }

  .analysis-hero {
    padding: 28px 22px;
    border-radius: 22px;
  }

  .section-heading {
    align-items: flex-start;
    display: grid;
  }

  .region-row,
  .interest-input-row {
    align-items: flex-start;
    display: grid;
  }

  .interest-input-row :deep(.el-input-number) {
    width: 100%;
  }
}
</style>
