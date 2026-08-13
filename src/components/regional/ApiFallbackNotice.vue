<script setup>
defineProps({
  status: {
    type: String,
    default: 'sample',
  },
  message: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['retry'])
</script>

<template>
  <el-alert
    v-if="status === 'fallback' || status === 'partial'"
    class="api-notice"
    type="warning"
    :closable="false"
    show-icon
  >
    <template #title>
      {{ status === 'partial' ? '일부 공개 API 연결이 필요합니다.' : '공개 API 연결에 실패했습니다.' }}
    </template>
    <div class="api-notice__content">
      <span>
        {{ message || '현재 샘플 데이터로 화면을 표시하고 있습니다.' }}
        API 연결이 복구되면 다시 시도할 수 있습니다.
      </span>
      <el-button text type="warning" @click="emit('retry')">다시 시도</el-button>
    </div>
  </el-alert>
</template>

<style scoped>
.api-notice {
  margin-top: 22px;
  border: 1px solid #f3d19e;
}

.api-notice__content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #8a5a00;
  font-size: 0.82rem;
  line-height: 1.6;
}

.api-notice__content :deep(.el-button) {
  flex-shrink: 0;
  font-weight: 800;
}

@media (max-width: 560px) {
  .api-notice__content {
    align-items: flex-start;
    display: grid;
  }
}
</style>
