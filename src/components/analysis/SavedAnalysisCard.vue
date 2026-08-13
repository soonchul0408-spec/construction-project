<script setup>
import { computed } from 'vue'
import DataOriginBadge from '@/components/regional/DataOriginBadge.vue'
import SourceMeta from '@/components/regional/SourceMeta.vue'
import { useAnalysisStore } from '@/stores/analysis'

const props = defineProps({
  project: {
    type: Object,
    required: true,
  },
  relatedCompanies: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['edit-memo'])
const analysisStore = useAnalysisStore()
const DART_SEARCH_URL = 'https://dart.fss.or.kr/dsab001/main.do?autoSearch=true&textCrpNm='

const relationStatusTypes = {
  '산업 관련 기업': 'info',
  '컨소시엄 참여 기업': 'success',
  '공급계약 확인 기업': 'warning',
  '수주 공시 확인 기업': 'danger',
  '관련성만 확인된 기업': '',
}

const memo = computed(() => analysisStore.getProjectNote(props.project.id))
const memoFields = computed(() => [
  { key: 'interestReason', label: '관심 이유', value: memo.value.interestReason },
  { key: 'judgmentBasis', label: '투자 판단 근거', value: memo.value.judgmentBasis },
  { key: 'expectedScenario', label: '기대하는 시나리오', value: memo.value.expectedScenario },
  { key: 'concerns', label: '우려되는 점', value: memo.value.concerns },
  { key: 'nextChecks', label: '앞으로 확인할 정보', value: memo.value.nextChecks },
])

const hasMemo = computed(() => memoFields.value.some((field) => field.value.trim()))

function getStatusType(status) {
  return relationStatusTypes[status] ?? 'info'
}

function toggleProject() {
  analysisStore.toggleProject(props.project.id)
}

function toggleCompany(companyId) {
  analysisStore.toggleCompany(companyId)
}

function updateCompanyWeight(companyId, weight) {
  analysisStore.setCompanyWeight(companyId, weight)
}

function getDartSearchUrl(companyName) {
  return `${DART_SEARCH_URL}${encodeURIComponent(companyName)}`
}
</script>

<template>
  <el-card class="saved-analysis-card" shadow="hover">
    <template #header>
      <div class="card-header">
        <div>
          <div class="record-meta">
            <span class="record-type">{{ project.recordType }}</span>
            <DataOriginBadge :origin="project.dataOrigin" />
          </div>
          <h3>{{ project.projectName }}</h3>
        </div>
        <el-button type="danger" link @click="toggleProject">저장 해제</el-button>
      </div>
    </template>

    <dl class="project-summary">
      <div>
        <dt>지역</dt>
        <dd>{{ project.region }}</dd>
      </div>
      <div>
        <dt>관련 산업</dt>
        <dd><el-tag type="primary" effect="plain">{{ project.category }}</el-tag></dd>
      </div>
      <div>
        <dt>정책 진행 단계</dt>
        <dd><el-tag type="success">{{ project.stage }}</el-tag></dd>
      </div>
      <div>
        <dt>사업 규모</dt>
        <dd>{{ project.scale }}</dd>
      </div>
    </dl>

    <SourceMeta :item="project" class="project-source" />

    <section class="saved-section">
      <div class="section-heading">
        <h4>관련 기업</h4>
        <el-tag type="info" effect="plain">{{ relatedCompanies.length }}개</el-tag>
      </div>

      <div v-if="relatedCompanies.length" class="company-list">
        <article v-for="company in relatedCompanies" :key="company.id" class="company-row">
          <div class="company-row__header">
            <div>
              <strong>{{ company.companyName }}</strong>
              <div class="company-row__tags">
                <el-tag :type="getStatusType(company.relationStatus)" size="small" effect="plain">
                  {{ company.relationStatus }}
                </el-tag>
                <DataOriginBadge :origin="company.dataOrigin" />
              </div>
            </div>
            <el-button size="small" plain @click="toggleCompany(company.id)">
              {{ analysisStore.isCompanySaved(company.id) ? '관심 해제' : '관심 기업 추가' }}
            </el-button>
          </div>

          <p class="company-reason">{{ company.relationReason }}</p>
          <p v-if="company.dartBusinessSummary" class="company-dart-summary">
            {{ company.dartBusinessSummary }}
          </p>

          <div class="company-disclosures">
            <span>DART 공시 출처</span>
            <div v-if="company.dartDisclosures?.length" class="company-disclosure-list">
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

          <div class="weight-control">
            <div class="weight-heading">
              <span>개인 관심 비중</span>
              <strong>{{ analysisStore.getCompanyWeight(company.id) }}%</strong>
            </div>
            <div class="weight-input-row">
              <el-progress
                :percentage="analysisStore.getCompanyWeight(company.id)"
                :show-text="false"
                :stroke-width="10"
              />
              <el-input-number
                :model-value="analysisStore.getCompanyWeight(company.id)"
                :min="0"
                :max="100"
                :step="5"
                :controls-position="'right'"
                size="small"
                aria-label="개인 관심 비중 입력"
                @update:model-value="updateCompanyWeight(company.id, $event)"
              />
            </div>
            <small>투자 비율이 아닌 사용자가 설정하는 개인 관심 비중입니다.</small>
          </div>
        </article>
      </div>
      <el-empty v-else :image-size="60" description="연결된 기업 정보가 없습니다." />
    </section>

    <section class="saved-section connection-section">
      <h4>연결 근거</h4>
      <ul>
        <li v-for="company in relatedCompanies" :key="`${company.id}-basis`">
          <strong>{{ company.companyName }}</strong>
          <span>{{ company.connectionBasis }}</span>
        </li>
      </ul>
    </section>

    <section class="saved-section memo-section">
      <div class="section-heading">
        <h4>사용자가 작성한 판단 메모</h4>
        <el-button type="primary" link @click="emit('edit-memo', project.id)">
          {{ hasMemo ? '메모 수정' : '메모 작성' }}
        </el-button>
      </div>
      <div v-if="hasMemo" class="memo-list">
        <div v-for="field in memoFields" :key="field.key" class="memo-item">
          <span v-if="field.value">{{ field.label }}</span>
          <p v-if="field.value">{{ field.value }}</p>
        </div>
      </div>
      <p v-else class="empty-memo">아직 작성한 개인 분석 메모가 없습니다.</p>
    </section>
  </el-card>
</template>

<style scoped>
.saved-analysis-card {
  border: 1px solid #e5eaf2;
  border-radius: 20px;
  background: #fff;
}

.card-header,
.section-heading,
.company-row__header,
.weight-heading,
.weight-input-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-header > div {
  min-width: 0;
}

.record-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.record-type {
  color: #8a96aa;
  font-size: 0.75rem;
  font-weight: 800;
}

.card-header h3 {
  margin: 5px 0 0;
  color: #172033;
  font-size: 1.22rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.4;
}

.project-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.project-summary > div {
  display: grid;
  align-content: start;
  gap: 7px;
  padding: 13px;
  border-radius: 12px;
  background: #f7f9fc;
}

dt,
.weight-heading span,
.memo-item span {
  color: #8a96aa;
  font-size: 0.72rem;
  font-weight: 800;
}

dd {
  margin: 0;
  color: #26344d;
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.45;
}

.project-source {
  margin-top: 16px;
}

.saved-section {
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid #edf0f5;
}

.section-heading {
  margin-bottom: 14px;
}

.section-heading h4,
.connection-section h4 {
  margin: 0;
  color: #172033;
  font-size: 0.96rem;
  font-weight: 800;
}

.company-list {
  display: grid;
  gap: 12px;
}

.company-row {
  padding: 16px;
  border: 1px solid #e9edf4;
  border-radius: 14px;
  background: #fbfcfe;
}

.company-row__header > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.company-row__tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 6px;
}

.company-row__header strong {
  color: #26344d;
  font-size: 0.9rem;
}

.company-reason {
  margin: 12px 0 0;
  color: #5f6d83;
  font-size: 0.82rem;
  line-height: 1.6;
}

.company-dart-summary {
  margin: 8px 0 0;
  color: #738097;
  font-size: 0.76rem;
  line-height: 1.55;
}

.company-disclosures {
  display: grid;
  gap: 7px;
  margin-top: 14px;
  padding: 12px;
  border-radius: 12px;
  background: #f7f9fc;
}

.company-disclosures > span {
  color: #8a96aa;
  font-size: 0.72rem;
  font-weight: 800;
}

.company-disclosure-list {
  display: grid;
  gap: 5px;
}

.company-disclosures small {
  color: #96a0b1;
  font-size: 0.7rem;
}

.weight-control {
  display: grid;
  gap: 7px;
  margin-top: 16px;
}

.weight-heading strong {
  color: #2563eb;
  font-size: 0.88rem;
}

.weight-input-row {
  gap: 12px;
}

.weight-input-row :deep(.el-progress) {
  flex: 1;
}

.weight-input-row :deep(.el-input-number) {
  width: 105px;
}

.weight-control small {
  color: #96a0b1;
  font-size: 0.72rem;
}

.connection-section ul {
  display: grid;
  gap: 10px;
  margin: 12px 0 0;
  padding-left: 18px;
}

.connection-section li {
  color: #5f6d83;
  font-size: 0.82rem;
  line-height: 1.6;
}

.connection-section li strong {
  margin-right: 5px;
  color: #34445e;
}

.memo-section {
  margin-bottom: 2px;
}

.memo-list {
  display: grid;
  gap: 12px;
}

.memo-item {
  padding: 12px 14px;
  border-radius: 12px;
  background: #f7f9fc;
}

.memo-item p {
  margin: 5px 0 0;
  color: #526078;
  font-size: 0.84rem;
  line-height: 1.65;
  white-space: pre-wrap;
}

.empty-memo {
  margin: 0;
  color: #96a0b1;
  font-size: 0.82rem;
}

@media (max-width: 900px) {
  .project-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .project-summary {
    grid-template-columns: 1fr;
  }

  .company-row__header {
    align-items: flex-start;
    display: grid;
  }

  .weight-input-row {
    align-items: stretch;
    display: grid;
  }

  .weight-input-row :deep(.el-input-number) {
    width: 100%;
  }
}
</style>
