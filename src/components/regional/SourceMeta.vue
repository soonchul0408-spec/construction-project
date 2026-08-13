<script setup>
import { computed } from 'vue'

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
})

const source = computed(() =>
  props.item.source ?? props.item.sources?.[0] ?? {
    title: props.item.sourceTitle,
    url: props.item.sourceUrl,
    publishedAt: props.item.sourceDate,
    verifiedAt: props.item.verifiedAt,
  },
)
</script>

<template>
  <div class="source-meta">
    <span class="source-meta__title">{{ source.title || '공식 출처' }}</span>
    <small v-if="source.publishedAt">공개일 {{ source.publishedAt }}</small>
    <small v-if="source.verifiedAt || source.retrievedAt">
      확인 {{ source.verifiedAt ?? source.retrievedAt }}
    </small>
    <el-link
      v-if="source.url"
      :href="source.url"
      target="_blank"
      rel="noopener noreferrer"
      type="primary"
      @click.stop
    >
      출처 URL 열기 ↗
    </el-link>
  </div>
</template>

<style scoped>
.source-meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.source-meta__title {
  overflow: hidden;
  color: #34445e;
  font-size: 0.78rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-meta small {
  color: #96a0b1;
  font-size: 0.7rem;
  line-height: 1.4;
}

.source-meta :deep(.el-link) {
  justify-self: start;
  font-size: 0.76rem;
  font-weight: 700;
}
</style>
