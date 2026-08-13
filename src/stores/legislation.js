import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  LEGISLATION_INDUSTRY_CATEGORIES,
  LEGISLATION_ITEMS,
  LEGISLATION_REGION_OPTIONS,
  LEGISLATION_STAGES,
} from '@/data/legislationData'
import { fetchLegislationSnapshot, isLegislationApiEnabled } from '@/services/api/legislationService'
import { normalizeLegislationSnapshot } from '@/services/api/legislationMappers'

export const useLegislationStore = defineStore('legislation', () => {
  const items = ref(LEGISLATION_ITEMS)
  const status = ref('sample')
  const errorMessage = ref('')
  const lastUpdatedAt = ref(null)
  let loadPromise = null

  const hasSampleRecords = computed(() => items.value.some((item) => item.dataOrigin === 'sample'))
  const hasLiveRecords = computed(() => items.value.some((item) => item.dataOrigin === 'live'))
  const dataOrigin = computed(() => {
    if (hasLiveRecords.value && hasSampleRecords.value) return 'mixed'
    return hasLiveRecords.value ? 'live' : 'sample'
  })
  const dataOriginLabel = computed(() => {
    if (dataOrigin.value === 'mixed') return '실제 + 샘플 데이터'
    return dataOrigin.value === 'live' ? '실제 공개자료' : '샘플 데이터'
  })

  const regionOptions = computed(() => {
    const knownRegions = new Set(LEGISLATION_REGION_OPTIONS.map((option) => option.value))
    const dynamicRegions = [
      ...new Set(
        items.value
          .map((item) => item.region)
          .filter((region) => region && !knownRegions.has(region)),
      ),
    ].map((region) => ({ value: region, label: region }))

    return [...LEGISLATION_REGION_OPTIONS, ...dynamicRegions]
  })

  function mergeRecords(liveRecords, sampleRecords) {
    const records = new Map(sampleRecords.map((record) => [record.id, record]))
    liveRecords.forEach((record) => records.set(record.id, record))
    return [...records.values()]
  }

  async function load({ force = false } = {}) {
    if (!isLegislationApiEnabled) return items.value
    if (status.value === 'loading' && loadPromise) return loadPromise
    if (!force && hasLiveRecords.value) return items.value

    status.value = 'loading'
    errorMessage.value = ''

    loadPromise = fetchLegislationSnapshot()
      .then((payload) => normalizeLegislationSnapshot(payload))
      .then((snapshot) => {
        items.value = mergeRecords(snapshot.items, LEGISLATION_ITEMS)
        status.value = 'live'
        lastUpdatedAt.value = snapshot.retrievedAt
        return items.value
      })
      .catch((error) => {
        items.value = LEGISLATION_ITEMS
        status.value = 'fallback'
        errorMessage.value =
          error instanceof Error ? error.message : '국회 의안정보 API 연결에 실패했습니다.'
        return items.value
      })
      .finally(() => {
        loadPromise = null
      })

    return loadPromise
  }

  function retry() {
    return load({ force: true })
  }

  return {
    items,
    status,
    errorMessage,
    lastUpdatedAt,
    hasSampleRecords,
    hasLiveRecords,
    dataOrigin,
    dataOriginLabel,
    regionOptions,
    industryCategories: LEGISLATION_INDUSTRY_CATEGORIES,
    stages: LEGISLATION_STAGES,
    load,
    retry,
  }
})
