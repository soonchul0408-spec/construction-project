import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  INDUSTRY_CATEGORIES,
  POLICY_STAGES,
  REGION_OPTIONS,
  REGIONAL_INDUSTRY_ITEMS,
} from '@/data/regionalIndustryData'
import { REGIONAL_INDUSTRY_COMPANIES } from '@/data/regionalIndustryCompanies'
import { fetchRegionalIndustrySnapshot, isApiEnabled } from '@/services/api/apiClient'
import { fetchDartCompaniesSnapshot, isDartApiEnabled } from '@/services/api/dartService'
import { normalizeDartCompaniesSnapshot } from '@/services/api/dartMappers'
import { normalizeRegionalIndustrySnapshot } from '@/services/api/normalizers'

export const useRegionalIndustryStore = defineStore('regionalIndustry', () => {
  const items = ref(REGIONAL_INDUSTRY_ITEMS)
  const companies = ref(REGIONAL_INDUSTRY_COMPANIES)
  const status = ref('sample')
  const errorMessage = ref('')
  const lastUpdatedAt = ref(null)
  const companyStatus = ref('sample')
  const companyErrorMessage = ref('')
  const companyLastUpdatedAt = ref(null)
  let regionalLoadPromise = null
  let dartLoadPromise = null

  const isFallback = computed(() => status.value === 'fallback')
  const isPartial = computed(() => status.value === 'partial')
  const isLive = computed(() => status.value === 'live')
  const isCompanyFallback = computed(() => companyStatus.value === 'fallback')
  const isCompanyPartial = computed(() => companyStatus.value === 'partial')
  const isCompanyLive = computed(() => companyStatus.value === 'live')
  const hasSampleRecords = computed(
    () =>
      items.value.some((item) => ['sample', 'mixed'].includes(item.dataOrigin)) ||
      companies.value.some((company) => ['sample', 'mixed'].includes(company.dataOrigin)),
  )
  const hasLiveRecords = computed(
    () =>
      items.value.some((item) => ['live', 'mixed'].includes(item.dataOrigin)) ||
      companies.value.some((company) => ['live', 'mixed'].includes(company.dataOrigin)),
  )
  const dataOrigin = computed(() => {
    if (hasLiveRecords.value && hasSampleRecords.value) return 'mixed'
    return hasLiveRecords.value ? 'live' : 'sample'
  })
  const dataOriginLabel = computed(() => {
    if (dataOrigin.value === 'mixed') return '실제 + 샘플 데이터'
    return dataOrigin.value === 'live' ? '실제 공개자료' : '샘플 데이터'
  })

  const regionOptions = computed(() => {
    const knownRegions = new Set(REGION_OPTIONS.map((option) => option.value))
    const dynamicRegions = items.value
      .map((item) => item.region)
      .filter((region) => region && !knownRegions.has(region))
      .map((region) => ({ value: region, label: region }))

    return [...REGION_OPTIONS, ...dynamicRegions]
  })

  function getItem(itemId) {
    return items.value.find((item) => item.id === itemId)
  }

  function getRelatedCompanies(item) {
    const companyIds = item?.relatedCompanyIds ?? []
    return companies.value.filter((company) => companyIds.includes(company.id))
  }

  function mergeRecords(liveRecords, sampleRecords) {
    const records = new Map(sampleRecords.map((record) => [record.id, record]))
    liveRecords.forEach((record) => records.set(record.id, record))
    return [...records.values()]
  }

  function mergeCompanies(records) {
    const companyMap = new Map(
      [...REGIONAL_INDUSTRY_COMPANIES, ...companies.value].map((company) => [company.id, company]),
    )

    records.forEach((company) => {
      const previous = companyMap.get(company.id)
      const mergedSources = [ ...(previous?.sources ?? []), ...(company.sources ?? []) ]
        .filter((source) => source?.url)
        .filter((source, index, sources) => sources.findIndex((item) => item.url === source.url) === index)

      companyMap.set(company.id, {
        ...previous,
        ...company,
        projectIds: [...new Set([...(previous?.projectIds ?? []), ...(company.projectIds ?? [])])],
        relatedProjectNames: [
          ...new Set([...(previous?.relatedProjectNames ?? []), ...(company.relatedProjectNames ?? [])]),
        ],
        industries: company.industries?.length ? company.industries : previous?.industries ?? [],
        sources: mergedSources,
        dartDisclosures: company.dartDisclosures ?? previous?.dartDisclosures ?? [],
        dartProfile: company.dartProfile ?? previous?.dartProfile,
      })
    })

    return [...companyMap.values()]
  }

  async function loadRegionalItems({ force = false } = {}) {
    if (!isApiEnabled) return items.value
    if (status.value === 'loading' && regionalLoadPromise) return regionalLoadPromise
    if (!force && isLive.value) return items.value

    status.value = 'loading'
    errorMessage.value = ''

    regionalLoadPromise = fetchRegionalIndustrySnapshot()
      .then((payload) => normalizeRegionalIndustrySnapshot(payload))
      .then((snapshot) => {
        items.value = mergeRecords(snapshot.items, REGIONAL_INDUSTRY_ITEMS)
        if (snapshot.companies.length) companies.value = mergeCompanies(snapshot.companies)
        lastUpdatedAt.value = snapshot.retrievedAt

        if (snapshot.companies.length) {
          status.value = 'live'
        } else {
          status.value = 'partial'
          errorMessage.value = '관련 기업 API 응답이 없어 기업 샘플 데이터를 함께 표시합니다.'
        }

        return items.value
      })
      .catch((error) => {
        items.value = REGIONAL_INDUSTRY_ITEMS
        status.value = 'fallback'
        errorMessage.value = error instanceof Error ? error.message : '공개 API 연결에 실패했습니다.'
        return items.value
      })
      .finally(() => {
        regionalLoadPromise = null
      })

    return regionalLoadPromise
  }

  async function loadDartCompanies({ force = false } = {}) {
    if (!isDartApiEnabled) return companies.value
    if (companyStatus.value === 'loading' && dartLoadPromise) return dartLoadPromise
    if (!force && isCompanyLive.value) return companies.value

    companyStatus.value = 'loading'
    companyErrorMessage.value = ''

    dartLoadPromise = fetchDartCompaniesSnapshot()
      .then((payload) => normalizeDartCompaniesSnapshot(payload))
      .then((snapshot) => {
        companies.value = snapshot.companies.length
          ? mergeCompanies(snapshot.companies)
          : companies.value
        companyLastUpdatedAt.value = snapshot.retrievedAt

        if (!snapshot.companies.length) {
          companyStatus.value = 'empty'
          companyErrorMessage.value = 'DART 기업 응답이 없어 기존 샘플 기업 데이터를 표시합니다.'
        } else if (snapshot.requestedCount > snapshot.companies.length) {
          companyStatus.value = 'partial'
          companyErrorMessage.value = '일부 기업의 DART 응답이 없어 해당 기업은 샘플 데이터로 표시합니다.'
        } else {
          companyStatus.value = 'live'
        }

        return companies.value
      })
      .catch((error) => {
        companyStatus.value = 'fallback'
        companyErrorMessage.value =
          error instanceof Error ? error.message : 'DART 공개자료 연결에 실패했습니다.'
        return companies.value
      })
      .finally(() => {
        dartLoadPromise = null
      })

    return dartLoadPromise
  }

  async function load({ force = false } = {}) {
    await Promise.all([loadRegionalItems({ force }), loadDartCompanies({ force })])
    return items.value
  }

  function retry() {
    return load({ force: true })
  }

  return {
    items,
    companies,
    status,
    errorMessage,
    lastUpdatedAt,
    isFallback,
    isPartial,
    isLive,
    companyStatus,
    companyErrorMessage,
    companyLastUpdatedAt,
    isCompanyFallback,
    isCompanyPartial,
    isCompanyLive,
    dataOrigin,
    dataOriginLabel,
    regionOptions,
    industryCategories: INDUSTRY_CATEGORIES,
    policyStages: POLICY_STAGES,
    getItem,
    getRelatedCompanies,
    load,
    retry,
  }
})
