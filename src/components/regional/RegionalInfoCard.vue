<script setup>
import { useRouter } from 'vue-router'
import DataOriginBadge from '@/components/regional/DataOriginBadge.vue'
import SourceMeta from '@/components/regional/SourceMeta.vue'

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
})

const router = useRouter()

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

function openDetail() {
  router.push({
    name: 'regional-industry-detail',
    params: { id: props.item.id },
  })
}
</script>

<template>
  <el-card
    class="info-card clickable-card"
    shadow="hover"
    role="link"
    tabindex="0"
    :aria-label="`${item.projectName} 상세 정보 보기`"
    @click="openDetail"
    @keydown.enter="openDetail"
  >
    <div class="card-kicker">
      <el-tag size="small" type="info" effect="plain">{{ item.recordType }}</el-tag>
      <span>{{ item.region }}</span>
      <DataOriginBadge :origin="item.dataOrigin" />
    </div>

    <div class="card-title-row">
      <h3>{{ item.projectName }}</h3>
      <el-tag :type="getTagType(stageTagTypes, item.stage)" effect="dark">
        {{ item.stage }}
      </el-tag>
    </div>

    <dl class="card-details">
      <div>
        <dt>산업 카테고리</dt>
        <dd>
          <el-tag :type="getTagType(categoryTagTypes, item.category)" effect="plain">
            {{ item.category }}
          </el-tag>
        </dd>
      </div>
      <div>
        <dt>사업 규모</dt>
        <dd>{{ item.scale }}</dd>
      </div>
    </dl>

    <p class="card-description">{{ item.description }}</p>

    <div class="related-info">
      <span class="meta-label">산업 연관 기업</span>
      <p>{{ item.relatedCompanies.join(' · ') }}</p>
      <small>{{ item.stageNote }}</small>
    </div>

    <div class="card-footer">
      <SourceMeta :item="item" />
      <el-button type="primary" plain @click.stop="openDetail">상세 보기</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.info-card {
  height: 100%;
  border: 1px solid #e5eaf2;
  border-radius: 18px;
  background: #fff;
}

.clickable-card {
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.clickable-card:hover,
.clickable-card:focus-visible {
  border-color: #93c5fd;
  box-shadow: 0 16px 30px rgb(37 99 235 / 12%);
  outline: 0;
  transform: translateY(-2px);
}

:deep(.info-card .el-card__body) {
  display: flex;
  height: 100%;
  flex-direction: column;
  padding: 24px;
}

.card-kicker,
.card-title-row,
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-kicker {
  color: #738096;
  font-size: 0.82rem;
}

.card-title-row {
  align-items: flex-start;
  margin-top: 18px;
}

.card-title-row h3 {
  min-height: 3.2rem;
  margin: 0;
  color: #172033;
  font-size: 1.18rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.35;
}

.card-details {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 12px;
  margin: 24px 0 18px;
}

.card-details > div {
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
  padding: 13px;
  border-radius: 12px;
  background: #f7f9fc;
}

dt,
.meta-label {
  color: #8a96aa;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

dd {
  margin: 0;
  color: #26344d;
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.45;
}

.card-description {
  min-height: 4.6rem;
  margin: 0;
  color: #5f6d83;
  font-size: 0.9rem;
  line-height: 1.7;
}

.related-info {
  display: grid;
  gap: 4px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #edf0f5;
}

.related-info p {
  margin: 0;
  color: #34445e;
  font-size: 0.86rem;
  font-weight: 700;
}

.related-info small {
  color: #96a0b1;
  font-size: 0.74rem;
  line-height: 1.45;
}

.card-footer {
  align-items: flex-end;
  margin-top: auto;
  padding-top: 20px;
}

.card-footer :deep(.el-button) {
  flex-shrink: 0;
  font-weight: 800;
}

@media (max-width: 520px) {
  :deep(.info-card .el-card__body) {
    padding: 20px;
  }

  .card-details {
    grid-template-columns: 1fr;
  }

  .card-footer {
    align-items: flex-start;
    display: grid;
  }

  .card-footer :deep(.el-button) {
    justify-self: start;
  }
}
</style>
