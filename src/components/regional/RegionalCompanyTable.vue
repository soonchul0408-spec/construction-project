<script setup>
import DataOriginBadge from '@/components/regional/DataOriginBadge.vue'
import { useAnalysisStore } from '@/stores/analysis'

defineProps({
  companies: {
    type: Array,
    required: true,
  },
})

const analysisStore = useAnalysisStore()
const DART_SEARCH_URL = 'https://dart.fss.or.kr/dsab001/main.do?autoSearch=true&textCrpNm='

const relationStatusTypes = {
  '산업 관련 기업': 'info',
  '컨소시엄 참여 기업': 'success',
  '공급계약 확인 기업': 'warning',
  '수주 공시 확인 기업': 'danger',
  '관련성만 확인된 기업': '',
}

function getStatusType(status) {
  return relationStatusTypes[status] ?? 'info'
}

function toggleCompany(companyId) {
  analysisStore.toggleCompany(companyId)
}

function isCompanySaved(companyId) {
  return analysisStore.isCompanySaved(companyId)
}

function getDartSearchUrl(companyName) {
  return `${DART_SEARCH_URL}${encodeURIComponent(companyName)}`
}
</script>

<template>
  <el-table :data="companies" row-key="id" border class="company-table">
    <el-table-column label="기업명" min-width="150" fixed="left">
      <template #default="{ row }">
        <div class="company-name-cell">
          <strong>{{ row.companyName }}</strong>
          <small>{{ row.relationStatus }}</small>
          <DataOriginBadge :origin="row.dataOrigin" />
        </div>
      </template>
    </el-table-column>

    <el-table-column label="상태" min-width="150">
      <template #default="{ row }">
        <el-tag :type="getStatusType(row.relationStatus)" effect="plain">
          {{ row.relationStatus }}
        </el-tag>
      </template>
    </el-table-column>

    <el-table-column label="주요 사업" min-width="240">
      <template #default="{ row }">
        <p class="table-copy">{{ row.mainBusiness }}</p>
        <small v-if="row.dartBusinessSummary" class="dart-summary">
          {{ row.dartBusinessSummary }}
        </small>
      </template>
    </el-table-column>

    <el-table-column label="관련 산업" min-width="170">
      <template #default="{ row }">
        <div class="industry-tags">
          <el-tag v-for="industry in row.industries" :key="industry" size="small" effect="plain">
            {{ industry }}
          </el-tag>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="해당 사업과 연결되는 이유" min-width="290">
      <template #default="{ row }">
        <p class="table-copy">{{ row.relationReason }}</p>
      </template>
    </el-table-column>

    <el-table-column label="직접 참여 여부" min-width="135">
      <template #default="{ row }">
        <el-tag :type="row.directParticipation === '확인됨' ? 'success' : 'info'" effect="light">
          {{ row.directParticipation }}
        </el-tag>
      </template>
    </el-table-column>

    <el-table-column label="연결 근거" min-width="330">
      <template #default="{ row }">
        <p class="table-copy">{{ row.connectionBasis }}</p>
        <small v-if="row.verifiedAt || row.sources?.[0]?.retrievedAt" class="verified-date">
          확인 {{ row.verifiedAt ?? row.sources[0].retrievedAt }}
        </small>
        <el-link
          v-if="row.evidenceUrl"
          :href="row.evidenceUrl"
          target="_blank"
          rel="noopener noreferrer"
          type="primary"
        >
          {{ row.evidenceTitle }} ↗
        </el-link>
      </template>
    </el-table-column>

    <el-table-column label="관련 정책·사업" min-width="230">
      <template #default="{ row }">
        <div v-if="row.relatedProjectNames?.length" class="related-projects">
          <span v-for="projectName in row.relatedProjectNames" :key="projectName">
            {{ projectName }}
          </span>
        </div>
        <span v-else class="muted-copy">연결된 정책·사업 확인 필요</span>
      </template>
    </el-table-column>

    <el-table-column label="DART 공시 출처" min-width="250">
      <template #default="{ row }">
        <div v-if="row.dartDisclosures?.length" class="dart-links">
          <el-link
            v-for="disclosure in row.dartDisclosures.slice(0, 3)"
            :key="disclosure.receiptNo"
            :href="disclosure.url"
            target="_blank"
            rel="noopener noreferrer"
            type="primary"
          >
            {{ disclosure.reportName }} ↗
          </el-link>
          <small v-if="row.verifiedAt" class="verified-date">확인 {{ row.verifiedAt }}</small>
        </div>
        <div v-else class="dart-links">
          <el-link
            :href="getDartSearchUrl(row.companyName)"
            target="_blank"
            rel="noopener noreferrer"
            type="primary"
          >
            DART 기업검색 ↗
          </el-link>
          <small class="muted-copy">샘플 기업의 공시는 기업검색에서 확인하세요.</small>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="관심 기업" width="145" fixed="right">
      <template #default="{ row }">
        <el-button
          size="small"
          :type="isCompanySaved(row.id) ? 'success' : 'primary'"
          plain
          @click="toggleCompany(row.id)"
        >
          {{ isCompanySaved(row.id) ? '관심 해제' : '관심 기업 추가' }}
        </el-button>
      </template>
    </el-table-column>

    <el-table-column label="공식 링크" width="145" fixed="right">
      <template #default="{ row }">
        <el-link
          v-if="row.officialUrl"
          :href="row.officialUrl"
          target="_blank"
          rel="noopener noreferrer"
          type="primary"
        >
          {{ row.officialLinkLabel }} ↗
        </el-link>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.company-table {
  width: 100%;
  border-radius: 14px;
  overflow: hidden;
}

.company-name-cell,
.industry-tags {
  display: grid;
  gap: 6px;
}

.company-name-cell strong {
  color: #172033;
  font-size: 0.9rem;
}

.company-name-cell small {
  color: #8a96aa;
  font-size: 0.72rem;
}

.company-name-cell :deep(.el-tag) {
  width: fit-content;
}

.verified-date {
  display: block;
  margin-bottom: 8px;
  color: #96a0b1;
  font-size: 0.7rem;
}

.dart-summary,
.muted-copy {
  display: block;
  color: #96a0b1;
  font-size: 0.72rem;
  line-height: 1.5;
}

.related-projects,
.dart-links {
  display: grid;
  gap: 7px;
}

.related-projects span {
  color: #526078;
  font-size: 0.82rem;
  line-height: 1.5;
}

.industry-tags {
  display: flex;
  flex-wrap: wrap;
}

.table-copy {
  margin: 0 0 8px;
  color: #526078;
  font-size: 0.82rem;
  line-height: 1.6;
  white-space: normal;
}

.company-table :deep(.el-table__cell) {
  vertical-align: top;
}

.company-table :deep(.cell) {
  line-height: 1.5;
}

.company-table :deep(.el-link) {
  font-size: 0.78rem;
  font-weight: 700;
  white-space: normal;
}
</style>
