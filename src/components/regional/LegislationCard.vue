<script setup>
import DataOriginBadge from '@/components/regional/DataOriginBadge.vue'
import SourceMeta from '@/components/regional/SourceMeta.vue'

defineProps({
  item: {
    type: Object,
    required: true,
  },
})

const categoryTagTypes = {
  'AI·데이터센터': 'primary',
  반도체: 'success',
  방산: 'danger',
  이차전지: 'warning',
  '전력·에너지': 'info',
}

const stageTagTypes = {
  발의: 'info',
  입법예고: 'warning',
  '상임위 심사': 'warning',
  '본회의 심사': 'primary',
  통과: 'success',
  '계류·폐기': 'danger',
}

function getTagType(types, value) {
  return types[value] ?? 'info'
}
</script>

<template>
  <el-card class="legislation-card" shadow="hover">
    <div class="card-kicker">
      <div class="kicker-left">
        <el-tag size="small" type="info" effect="plain">{{ item.recordType }}</el-tag>
        <span>{{ item.region }}</span>
      </div>
      <DataOriginBadge :origin="item.dataOrigin" />
    </div>

    <div class="card-title-row">
      <div>
        <p class="bill-number">의안번호 {{ item.billNumber }}</p>
        <h3>{{ item.billName }}</h3>
      </div>
      <el-tag :type="getTagType(stageTagTypes, item.stage)" effect="dark">
        {{ item.stage }}
      </el-tag>
    </div>

    <div class="category-row">
      <el-tag :type="getTagType(categoryTagTypes, item.category)" effect="plain">
        {{ item.category }}
      </el-tag>
      <span>제안일 {{ item.proposedAt }}</span>
    </div>

    <dl class="bill-details">
      <div>
        <dt>제안자</dt>
        <dd>{{ item.proposer }}</dd>
      </div>
      <div>
        <dt>소관기관</dt>
        <dd>{{ item.responsibleOrg }}</dd>
      </div>
    </dl>

    <p class="card-description">{{ item.description }}</p>

    <div class="stage-note">
      <span>진행 단계 근거</span>
      <p>{{ item.stageNote }}</p>
    </div>

    <div class="card-footer">
      <SourceMeta :item="item" />
      <el-link
        v-if="item.sourceUrl"
        :href="item.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        type="primary"
      >
        공식 출처 ↗
      </el-link>
    </div>
  </el-card>
</template>

<style scoped>
.legislation-card {
  height: 100%;
  border: 1px solid #e5eaf2;
  border-radius: 18px;
  background: #fff;
}

:deep(.legislation-card .el-card__body) {
  display: flex;
  height: 100%;
  flex-direction: column;
  padding: 24px;
}

.card-kicker,
.card-title-row,
.card-footer,
.category-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.kicker-left {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #738096;
  font-size: 0.82rem;
}

.card-title-row {
  align-items: flex-start;
  margin-top: 18px;
}

.bill-number {
  margin: 0 0 6px;
  color: #8a96aa;
  font-size: 0.72rem;
  font-weight: 700;
}

.card-title-row h3 {
  max-width: 590px;
  margin: 0;
  color: #172033;
  font-size: 1.16rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.4;
}

.category-row {
  justify-content: flex-start;
  margin-top: 16px;
  color: #738096;
  font-size: 0.78rem;
}

.bill-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 20px 0 18px;
}

.bill-details > div {
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
  padding: 13px;
  border-radius: 12px;
  background: #f7f9fc;
}

dt,
.stage-note > span {
  color: #8a96aa;
  font-size: 0.72rem;
  font-weight: 700;
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: #26344d;
  font-size: 0.84rem;
  font-weight: 700;
  line-height: 1.45;
}

.card-description {
  min-height: 4.2rem;
  margin: 0;
  color: #5f6d83;
  font-size: 0.9rem;
  line-height: 1.7;
}

.stage-note {
  display: grid;
  gap: 5px;
  margin-top: 18px;
  padding: 14px;
  border: 1px solid #e8eef8;
  border-radius: 12px;
  background: #fbfcff;
}

.stage-note p {
  margin: 0;
  color: #536179;
  font-size: 0.78rem;
  line-height: 1.55;
}

.card-footer {
  align-items: flex-end;
  margin-top: auto;
  padding-top: 20px;
}

.card-footer :deep(.el-link) {
  flex-shrink: 0;
  font-size: 0.78rem;
  font-weight: 800;
}

@media (max-width: 520px) {
  :deep(.legislation-card .el-card__body) {
    padding: 20px;
  }

  .card-title-row {
    display: grid;
  }

  .bill-details {
    grid-template-columns: 1fr;
  }

  .card-footer {
    align-items: flex-start;
    display: grid;
  }
}
</style>
