import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'regional-industry-personal-analysis'

const EMPTY_NOTE = {
  interestReason: '',
  judgmentBasis: '',
  expectedScenario: '',
  concerns: '',
  nextChecks: '',
}

function createEmptyState() {
  return {
    savedRegions: [],
    savedProjectIds: [],
    savedCompanyIds: [],
    projectNotes: {},
    companyWeights: {},
  }
}

function readSavedState() {
  if (typeof window === 'undefined') return createEmptyState()

  try {
    const savedState = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!savedState || typeof savedState !== 'object') return createEmptyState()

    return {
      savedRegions: Array.isArray(savedState.savedRegions) ? savedState.savedRegions : [],
      savedProjectIds: Array.isArray(savedState.savedProjectIds) ? savedState.savedProjectIds : [],
      savedCompanyIds: Array.isArray(savedState.savedCompanyIds)
        ? savedState.savedCompanyIds
        : [],
      projectNotes:
        savedState.projectNotes && typeof savedState.projectNotes === 'object'
          ? savedState.projectNotes
          : {},
      companyWeights:
        savedState.companyWeights && typeof savedState.companyWeights === 'object'
          ? savedState.companyWeights
          : {},
    }
  } catch {
    return createEmptyState()
  }
}

export const useAnalysisStore = defineStore('analysis', () => {
  const savedState = readSavedState()
  const savedRegions = ref(savedState.savedRegions)
  const savedProjectIds = ref(savedState.savedProjectIds)
  const savedCompanyIds = ref(savedState.savedCompanyIds)
  const projectNotes = ref(savedState.projectNotes)
  const companyWeights = ref(savedState.companyWeights)

  function persist() {
    if (typeof window === 'undefined') return

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          savedRegions: savedRegions.value,
          savedProjectIds: savedProjectIds.value,
          savedCompanyIds: savedCompanyIds.value,
          projectNotes: projectNotes.value,
          companyWeights: companyWeights.value,
        }),
      )
    } catch {
      // 저장 공간이나 브라우저 정책에 따른 localStorage 오류는 화면 동작을 막지 않습니다.
    }
  }

  watch(
    [savedRegions, savedProjectIds, savedCompanyIds, projectNotes, companyWeights],
    persist,
    { deep: true },
  )

  function toggleRegion(region) {
    if (!region || region === '전체') return

    savedRegions.value = savedRegions.value.includes(region)
      ? savedRegions.value.filter((savedRegion) => savedRegion !== region)
      : [...savedRegions.value, region]
  }

  function isRegionSaved(region) {
    return savedRegions.value.includes(region)
  }

  function toggleProject(projectId) {
    if (!projectId) return

    savedProjectIds.value = savedProjectIds.value.includes(projectId)
      ? savedProjectIds.value.filter((savedProjectId) => savedProjectId !== projectId)
      : [...savedProjectIds.value, projectId]
  }

  function isProjectSaved(projectId) {
    return savedProjectIds.value.includes(projectId)
  }

  function toggleCompany(companyId) {
    if (!companyId) return

    savedCompanyIds.value = savedCompanyIds.value.includes(companyId)
      ? savedCompanyIds.value.filter((savedCompanyId) => savedCompanyId !== companyId)
      : [...savedCompanyIds.value, companyId]
  }

  function isCompanySaved(companyId) {
    return savedCompanyIds.value.includes(companyId)
  }

  function getProjectNote(projectId) {
    return {
      ...EMPTY_NOTE,
      ...projectNotes.value[projectId],
    }
  }

  function updateProjectNote(projectId, note) {
    if (!projectId) return

    projectNotes.value = {
      ...projectNotes.value,
      [projectId]: {
        ...EMPTY_NOTE,
        ...note,
      },
    }
  }

  function getCompanyWeight(companyId) {
    return Number(companyWeights.value[companyId] ?? 0)
  }

  function setCompanyWeight(companyId, weight) {
    if (!companyId) return

    const nextWeight = Math.min(100, Math.max(0, Number(weight) || 0))
    companyWeights.value = {
      ...companyWeights.value,
      [companyId]: nextWeight,
    }
  }

  return {
    savedRegions,
    savedProjectIds,
    savedCompanyIds,
    projectNotes,
    companyWeights,
    toggleRegion,
    isRegionSaved,
    toggleProject,
    isProjectSaved,
    toggleCompany,
    isCompanySaved,
    getProjectNote,
    updateProjectNote,
    getCompanyWeight,
    setCompanyWeight,
  }
})
