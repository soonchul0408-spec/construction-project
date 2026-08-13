<script setup>
import { computed } from 'vue'

const props = defineProps({
  origin: {
    type: String,
    default: 'sample',
  },
})

const originLabel = computed(() => {
  if (props.origin === 'live') return '실제 공개자료'
  if (props.origin === 'mixed') return '실제 + 샘플'
  return '샘플 데이터'
})

const tagType = computed(() => {
  if (props.origin === 'live') return 'success'
  if (props.origin === 'mixed') return 'warning'
  return 'info'
})
</script>

<template>
  <el-tag :type="tagType" size="small" effect="plain">
    {{ originLabel }}
  </el-tag>
</template>
