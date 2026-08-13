<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'

import Building3DViewer from './components/Building3DViewer.vue'
import ConfidenceReviewPanel from './components/ConfidenceReviewPanel.vue'
import { analyzeCadFile } from './modules/cad-parser-adapter'
import { parseCostSummaries } from './modules/cost-summary-parser'
import { classifyDocument, guessBuildingName } from './modules/document-classifier'
import { buildBuildingGeometry, buildWalls, extractRoofGeometry, listMissingGeometryItems } from './modules/drawing-geometry-model'
import { buildHeightCandidates, deriveLevelHeightDimensions } from './modules/height-candidate-extractor'
import { applyHeightReview, markHeightReviewRecalculated } from './modules/height-review'
import {
  buildHeightDiagnostics,
  emptyHeightDiagnostics,
  HEIGHT_DIAGNOSTIC_CAUSE_LABELS,
  HEIGHT_DIAGNOSTIC_STAGE_LABELS,
  HEIGHT_DIAGNOSTIC_STATUS_LABELS,
} from './modules/height-diagnostics'
import { createTestBuildingGeometry } from './modules/test-building-model'
import { extractPdfDocument } from './modules/pdf-extractor'
import { analyzeImage } from './modules/ocr-analyzer'
import {
  createQueuedFile,
  extensionOf,
  formatFileSize,
  isSupportedFile,
  unsupportedMessage,
} from './modules/file-loader'
import { calculateTakeoffs, panelSpec, summarizeTakeoffs } from './modules/material-takeoff-engine'
import {
  buildOptimizationMembers,
  createCatalogItem,
  optimizeCuttingPlan,
} from './modules/cutting-optimization-engine'
import {
  approveInventoryCutPlan,
  buildInventoryRequirementsFromMembers,
  calculateInventoryCutPlan,
  cancelInventoryCutPlan,
  createInventorySampleData,
  getInventoryRequirementMissingFields,
  mergeInventoryRequirements,
  normalizeInventoryRequirement,
} from './modules/inventory-cutting-engine'
import { assessProjectWorkflow, statusForAnalysisStage } from './modules/project-workflow'
import { emptyConsistencyValidation, validateConsistency } from './modules/consistency-validator'
import { clearProject, loadProject, saveProject } from './modules/project-store'
import {
  downloadCsv,
  downloadCuttingMembersCsv,
  downloadCuttingPlansCsv,
  downloadOptimizationInputsCsv,
  downloadOptimizationOrderCsv,
  downloadScrapsCsv,
  downloadScenarioComparisonCsv,
  printCuttingPlans,
  printReport,
} from './modules/export-report'
import {
  ANALYSIS_STAGE_LABELS,
  CONFIDENCE_COLORS,
  CONFIDENCE_LABELS,
  DEFAULT_MATERIAL_SETTINGS,
  DRAWING_KIND_LABELS,
  emptyInventoryCuttingState,
  PROJECT_STATUS_DESCRIPTIONS,
  PROJECT_STATUS_LABELS,
} from './types/domain'
import type {
  AnalyzedFile,
  CostSummary,
  CuttingPlacement,
  DimensionValue,
  DrawingKind,
  DrawingPage,
  HeightCandidate,
  HeightReviewAction,
  InventoryRequirement,
  InventoryStockSource,
  OwnedMaterial,
  MaterialCatalogItem,
  MaterialSettings,
  OptimizationReviewItem,
  ScrapPiece,
  ProjectStatus,
  ProjectState,
} from './types/domain'
import { emptyOptimizationState } from './types/domain'

const emptyCostSummary = (): CostSummary => ({
  rows: [],
  totalAmount: null,
  sourceFileIds: [],
  privacyNote: '',
})

function makeProject(): ProjectState {
  const now = new Date().toISOString()
  return {
    id: `project-${Date.now()}`,
    status: 'empty',
    statusMessage: PROJECT_STATUS_DESCRIPTIONS.empty,
    workflow: {
      reviewConfirmed: false,
      modelBuilt: false,
      takeoffCalculated: false,
      optimizationCalculated: false,
    },
    name: '도면 산출 프로젝트',
    buildingName: '아직 도면을 올리지 않았습니다',
    createdAt: now,
    updatedAt: now,
    files: [],
    dimensions: [],
    heightCandidates: [],
    walls: [],
    takeoffs: [],
    costSummary: emptyCostSummary(),
    settings: { ...DEFAULT_MATERIAL_SETTINGS },
    reviewItems: [],
    missingItems: [],
    heightDiagnostics: emptyHeightDiagnostics(),
    model: {
      walls: [],
      footprint: [],
      roof: {
        isReady: false,
        kind: 'unknown',
        heightMm: null,
        pitchDeg: null,
        evidence: [],
        blockedReason: '지붕 정보가 있는 입면도·단면도·지붕 상세도를 확인하지 못했습니다.',
      },
      isReady: false,
      blockedReason: '도면 파일을 올리면 입체 형상을 생성합니다.',
    },
    optimization: emptyOptimizationState(),
    consistencyValidation: emptyConsistencyValidation(),
    restoredFromStorage: false,
  }
}

const project = ref<ProjectState>(makeProject())
const fileInput = ref<HTMLInputElement | null>(null)
const sourceFiles = new Map<string, File>()
const isDragging = ref(false)
const isAnalyzing = ref(false)
const isBuilding3D = ref(false)
const isCalculating = ref(false)
const isOptimizing = ref(false)
const activeSection = ref('upload')
const selectedWallId = ref('')
const selectedPageId = ref('')
const selectedHeightCandidateId = ref('')
const showTestModel = ref(false)
const testBuildingModel = createTestBuildingGeometry()
const notice = ref('')
const showAllDimensions = ref(false)
const settingsDraft = reactive<MaterialSettings>({ ...DEFAULT_MATERIAL_SETTINGS })
const editingCatalogId = ref('')
const catalogFormOpen = ref(false)
const selectedOptimizationPlanId = ref('')
const optimizationReviewDrafts = reactive<Record<string, string>>({})
const heightReviewDrafts = reactive<Record<string, {
  valueMm: string
  reason: string
  wallNumber: string
  zone: string
}>>({})
const scrapFormOpen = ref(false)
const scrapDraft = reactive({
  materialId: '',
  widthMm: '',
  lengthMm: '',
  currentLocation: '',
  originZone: '',
  usableZones: '',
  plannedUseMemberId: '',
  generatedAt: '',
  plannedUseAt: '',
})
const inventoryStockFormOpen = ref(false)
const inventoryStockDraft = reactive({
  materialType: 'panel' as 'panel' | 'board',
  materialName: '',
  thicknessMm: '',
  widthMm: '',
  lengthMm: '',
  surfaceFinish: '',
  color: '',
  quantity: '1',
  source: 'new' as InventoryStockSource,
  usable: true,
  location: '',
  note: '',
})
const catalogDraft = reactive({
  name: '',
  materialType: 'panel' as 'panel' | 'profile',
  material: '',
  thicknessMm: '',
  stockWidthMm: '',
  stockLengthMm: '',
  stockLengthOptionsMm: '',
  unit: 'sheet' as 'sheet' | 'bar',
  unitLabel: '',
  unitPrice: '',
  minimumOrderQuantity: '',
  cuttingFee: '',
  cutCostPerCut: '',
  kerfMm: '',
  transportCost: '',
  handlingCost: '',
  disposalCostPerM2: '',
  disposalCostPerM: '',
  temporaryStorageCostPerDay: '',
  rotatable: false,
  grainDirection: 'free' as 'free' | 'fixed',
  lapAllowanceMm: '',
  minimumReusableOffcutMm: '',
  reworkRiskCost: '',
  surfaceFinish: '',
  color: '',
})

const allPages = computed(() => project.value.files.flatMap((file) => file.pages))
const currentPage = computed<DrawingPage | null>(() => {
  return allPages.value.find((page) => page.id === selectedPageId.value) || allPages.value[0] || null
})
const selectedWall = computed(() => project.value.walls.find((wall) => wall.id === selectedWallId.value) || null)
const supportedFiles = computed(() => project.value.files.filter((file) => file.status !== 'failed' || file.pages.length))
const costFiles = computed(() => project.value.files.filter((file) => file.kind === 'cost-summary'))
const drawingDimensions = computed(() => project.value.dimensions.filter((dimension) => dimension.evidence[0]?.drawingKind !== 'cost-summary'))
const activeDimensions = computed(() => {
  const values = drawingDimensions.value
  return showAllDimensions.value ? values : values.slice(0, 10)
})
const lowerConfidenceCount = computed(() => drawingDimensions.value.filter((dimension) => dimension.confidence !== 'high').length)
const summary = computed(() => summarizeTakeoffs(project.value.takeoffs))
const showFileList = ref(false)
const modelStatus = computed(() => {
  if (showTestModel.value) return '테스트 모델'
  if (project.value.status === 'building-3d') return '생성 중'
  if (project.value.status === 'failed' && !project.value.model.isReady) return '분석 실패'
  if (project.value.model.isReady && project.value.model.partial) return '부분 모델'
  if (project.value.model.isReady) return '실제 분석 모델'
  if (project.value.reviewItems.length || project.value.missingItems.length || project.value.status === 'needs-review') return '확인 필요'
  return '3차원 생성 대기'
})
const modelDisplayMode = computed<'actual' | 'partial' | 'test' | 'failed' | 'review' | 'empty'>(() => {
  if (showTestModel.value) return 'test'
  if (project.value.status === 'failed' && !project.value.model.isReady) return 'failed'
  if (project.value.model.isReady && project.value.model.partial) return 'partial'
  if (project.value.model.isReady) return 'actual'
  if (project.value.reviewItems.length || project.value.missingItems.length || project.value.status === 'needs-review') return 'review'
  return 'empty'
})
const displayModel = computed(() => showTestModel.value ? testBuildingModel : project.value.model)
const modelSourceLabel = computed(() => {
  if (showTestModel.value) return '발주 계산에 사용하지 않음'
  const names = project.value.files.filter((file) => file.pages.some((page) => ['floor-plan', 'elevation', 'section'].includes(page.kind))).map((file) => file.name)
  if (!names.length) return '업로드한 설계도 없음'
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}개` : names.join(', ')
})
function openingNeedsReview(wall: ProjectState['walls'][number], opening: ProjectState['walls'][number]['openings'][number]) {
  if (opening.conflict || opening.widthMm === null || opening.heightMm === null || opening.offsetMm === null) return true
  if (opening.widthMm <= 0 || opening.heightMm <= 0 || opening.offsetMm < 0 || wall.lengthMm === null) return true
  if (opening.offsetMm + opening.widthMm > wall.lengthMm) return true
  if (opening.type !== 'door' && opening.sillHeightMm === null) return true
  const sill = opening.type === 'door' ? 0 : opening.sillHeightMm || 0
  return wall.heightMm === null || sill < 0 || sill + opening.heightMm > wall.heightMm
}
const modelSummary = computed(() => {
  const model = displayModel.value
  const sourceWalls = showTestModel.value ? model.walls : project.value.walls
  const heightReviewCount = showTestModel.value ? 0 : sourceWalls.filter((wall) => wall.heightMm === null || wall.conflicts?.some((conflict) => conflict.kind === 'height')).length
  const openingReviewCount = showTestModel.value ? 0 : sourceWalls.filter((wall) => wall.openings.some((opening) => openingNeedsReview(wall, opening))).length
  const calculatedZones = showTestModel.value ? 0 : new Set(project.value.takeoffs.filter((takeoff) => takeoff.reviewStatus === '확정').map((takeoff) => takeoff.zone)).size
  return {
    totalWalls: sourceWalls.length,
    generatedWalls: model.walls.length,
    heightReviewCount,
    openingReviewCount,
    calculatedZones,
    usable: showTestModel.value ? false : project.value.workflow.takeoffCalculated && workflowAssessment.value.canIssue,
  }
})
const floorCount = computed(() => {
  const floorNumbers = allPages.value.flatMap((page) => [...page.text.matchAll(/(\d+)\s*층/g)].map((match) => Number(match[1])))
  return floorNumbers.length ? Math.max(...floorNumbers) : null
})
const heightDimensions = computed(() => project.value.heightCandidates.filter((candidate) => candidate.status !== '기준 레벨만 확인됨'))
const heightReviewEntries = computed(() => project.value.heightDiagnostics.entries.filter((entry) => Boolean(entry.cause)))
const selectedPageMarkers = computed(() => {
  if (!currentPage.value) return []
  return project.value.dimensions.filter((dimension) => dimension.evidence.some((evidence) => evidence.fileId === fileIdForPage(currentPage.value as DrawingPage) && evidence.pageNumber === currentPage.value?.pageNumber))
})
const selectedPageWalls = computed(() => {
  if (!currentPage.value) return []
  const fileId = fileIdForPage(currentPage.value)
  return project.value.walls.filter((wall) => wall.evidence.some((evidence) => evidence.fileId === fileId && evidence.pageNumber === currentPage.value?.pageNumber))
})
const selectedPageOpenings = computed(() => selectedPageWalls.value.flatMap((wall) => wall.openings.map((opening) => ({ opening, wall }))))
const workflowAssessment = computed(() => assessProjectWorkflow({
  files: project.value.files,
  workflow: project.value.workflow,
  model: project.value.model,
  takeoffs: project.value.takeoffs,
  missingItems: project.value.missingItems,
  reviewItems: project.value.reviewItems,
  consistency: project.value.consistencyValidation,
  isAnalyzing: isAnalyzing.value,
  currentStatus: project.value.status,
}))
const projectStatusLabel = computed(() => PROJECT_STATUS_LABELS[project.value.status])
const projectStatusDescription = computed(() => project.value.statusMessage || PROJECT_STATUS_DESCRIPTIONS[project.value.status])
const reviewBlockers = computed(() => [...new Set([...project.value.missingItems, ...project.value.reviewItems])])
// A medium-confidence height may be shown in a temporary/partial 3D model,
// but a missing or invalid height must never be replaced by a default value.
// The actual gate is therefore whether at least one verified wall geometry
// exists; issuance remains blocked by the workflow review state.
const canBuild3D = computed(() => !isAnalyzing.value && !isBuilding3D.value && !isCalculating.value && project.value.files.length > 0 && project.value.walls.length > 0 && project.value.model.isReady)
const canCalculateMaterials = computed(() => project.value.workflow.modelBuilt && project.value.model.isReady && !isAnalyzing.value && !isBuilding3D.value && !isCalculating.value)
const canDownloadReports = computed(() => !isAnalyzing.value && !isBuilding3D.value && !isCalculating.value && workflowAssessment.value.canIssue && project.value.workflow.takeoffCalculated && project.value.takeoffs.length > 0)
const workflowSteps = [
  { id: 'upload', label: '파일 업로드' },
  { id: 'analysis', label: '도면 분석' },
  { id: 'model', label: '3차원 확인' },
  { id: 'takeoff', label: '발주 산출표' },
  { id: 'optimization', label: '절단 최적화' },
]
const workflowProgressIndex = computed(() => {
  if (project.value.workflow.optimizationCalculated || ['calculated', 'approved'].includes(project.value.optimization.inventory?.status || '')) return 4
  if (project.value.status === 'completed' || project.value.workflow.takeoffCalculated) return 3
  if (project.value.workflow.modelBuilt || project.value.status === 'building-3d') return 2
  if (project.value.files.length && (project.value.status === 'needs-review' || project.value.status === 'partial' || project.value.workflow.reviewConfirmed)) return 1
  if (project.value.status === 'linking' || project.value.status === 'extracting' || project.value.status === 'classifying') return 1
  if (project.value.status === 'uploading') return 0
  return project.value.files.length ? 1 : 0
})
const optimizationScenario = computed(() => project.value.optimization.scenarios.find((scenario) => scenario.id === project.value.optimization.selectedScenarioId) || project.value.optimization.scenarios[0] || null)
const selectedOptimizationPlan = computed(() => optimizationScenario.value?.stockPlans.find((plan) => plan.id === selectedOptimizationPlanId.value) || optimizationScenario.value?.stockPlans[0] || null)
const optimizationCatalogPanels = computed(() => project.value.optimization.catalog.filter((item) => item.materialType === 'panel'))
const optimizationCatalogProfiles = computed(() => project.value.optimization.catalog.filter((item) => item.materialType === 'profile'))
const optimizationNeedsReview = computed(() => project.value.optimization.reviews.filter((item) => !item.resolved))
const optimizationCanRun = computed(() => project.value.workflow.takeoffCalculated && project.value.optimization.catalog.length > 0 && !isAnalyzing.value && !isOptimizing.value && !isCalculating.value)
const inventoryState = computed(() => project.value.optimization.inventory || emptyInventoryCuttingState())
const inventoryPlan = computed(() => inventoryState.value.plan)
const inventoryRequirementsNeedingReview = computed(() => inventoryState.value.requirements.filter((requirement) => requirement.status !== 'ready' || requirement.missingFields.length))
const inventoryStatusLabel = computed(() => {
  if (inventoryState.value.status === 'approved') return '승인·재고 예약 완료'
  if (inventoryState.value.status === 'calculated') return '계산 결과 확인 필요'
  if (inventoryState.value.status === 'cancelled') return '계획 취소됨'
  if (inventoryState.value.status === 'needs-review') return '확인 필요'
  return '계산 전'
})
const inventoryLocked = computed(() => inventoryState.value.status === 'approved')
const optimizationStatusLabel = computed(() => {
  if (project.value.optimization.status === 'calculated') return '최적화 결과 준비됨'
  if (project.value.optimization.status === 'needs-review') return '확인 후 다시 계산'
  if (project.value.optimization.status === 'blocked') return '계산 불가'
  return '계산 대기'
})

function fileIdForPage(page: DrawingPage) {
  return page.id.replace(/-page-\d+$/, '')
}

function setNotice(message: string) {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 5000)
}

function setProjectStatus(status: ProjectStatus, message = PROJECT_STATUS_DESCRIPTIONS[status]) {
  project.value.status = status
  project.value.statusMessage = message
  project.value.updatedAt = new Date().toISOString()
}

function resetWorkflow() {
  project.value.workflow = {
    reviewConfirmed: false,
    modelBuilt: false,
    takeoffCalculated: false,
    optimizationCalculated: false,
  }
  const existingScraps = project.value.optimization?.scraps?.filter((scrap) => scrap.source === 'existing') || []
  const existingInventory = project.value.optimization?.inventory || emptyInventoryCuttingState()
  project.value.optimization = {
    ...emptyOptimizationState(),
    catalog: project.value.optimization?.catalog || [],
    selectedPanelMaterialId: project.value.optimization?.selectedPanelMaterialId || '',
    selectedProfileMaterialId: project.value.optimization?.selectedProfileMaterialId || '',
    scraps: existingScraps,
    inventory: existingInventory.status === 'approved'
      ? existingInventory
      : {
          ...existingInventory,
          plan: null,
          status: existingInventory.requirements.length ? 'needs-review' : 'not-ready',
          lastCalculatedAt: null,
        },
  }
}

function workflowStepClass(index: number) {
  if (index < workflowProgressIndex.value) return 'done'
  if (index === workflowProgressIndex.value) return 'active'
  return 'pending'
}

function workflowStepEnabled(id: string) {
  if (id === 'upload') return true
  if (id === 'analysis') return project.value.files.length > 0
  // The 3D screen is also the place where a missing height, failed WebGL
  // setup, or partial model is explained. Keep it reachable before and after
  // model generation instead of hiding the diagnostic component.
  if (id === 'model') return true
  if (id === 'takeoff') return project.value.workflow.modelBuilt
  if (id === 'optimization') return true
  return false
}

function updateSettings() {
  if (isCalculating.value || isOptimizing.value) return
  Object.assign(project.value.settings, settingsDraft)
  const shouldRecalculate = project.value.workflow.modelBuilt
  if (shouldRecalculate) {
    project.value.workflow.takeoffCalculated = false
    project.value.workflow.optimizationCalculated = false
    setProjectStatus('calculating', '판넬 기준이 변경되어 벽체별 자재 수량을 다시 계산해야 합니다.')
  }
  recompute()
  if (shouldRecalculate) void calculateMaterials()
}

function syncSettingsDraft(settings: MaterialSettings) {
  Object.assign(settingsDraft, settings)
}

function resetCatalogDraft() {
  Object.assign(catalogDraft, {
    name: '',
    materialType: 'panel',
    material: '',
    thicknessMm: '',
    stockWidthMm: '',
    stockLengthMm: '',
    stockLengthOptionsMm: '',
    unit: 'sheet',
    unitLabel: '',
    unitPrice: '',
    minimumOrderQuantity: '',
    cuttingFee: '',
    cutCostPerCut: '',
    kerfMm: '',
    transportCost: '',
    handlingCost: '',
    disposalCostPerM2: '',
    disposalCostPerM: '',
    temporaryStorageCostPerDay: '',
    rotatable: false,
    grainDirection: 'free',
    lapAllowanceMm: '',
    minimumReusableOffcutMm: '',
    reworkRiskCost: '',
    surfaceFinish: '',
    color: '',
  })
  editingCatalogId.value = ''
}

function optionalNumber(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function numberList(value: string) {
  return value
    .split(/[,，\s]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
}

function editCatalogItem(item: MaterialCatalogItem) {
  Object.assign(catalogDraft, {
    name: item.name,
    materialType: item.materialType,
    material: item.material,
    thicknessMm: item.thicknessMm === null ? '' : String(item.thicknessMm),
    stockWidthMm: item.stockWidthMm === null ? '' : String(item.stockWidthMm),
    stockLengthMm: item.stockLengthMm === null ? '' : String(item.stockLengthMm),
    stockLengthOptionsMm: item.stockLengthOptionsMm.join(', '),
    unit: item.unit,
    unitLabel: item.unitLabel,
    unitPrice: item.unitPrice === null ? '' : String(item.unitPrice),
    minimumOrderQuantity: item.minimumOrderQuantity === null ? '' : String(item.minimumOrderQuantity),
    cuttingFee: item.cuttingFee === null ? '' : String(item.cuttingFee),
    cutCostPerCut: item.cutCostPerCut === null ? '' : String(item.cutCostPerCut),
    kerfMm: item.kerfMm === null ? '' : String(item.kerfMm),
    transportCost: item.transportCost === null ? '' : String(item.transportCost),
    handlingCost: item.handlingCost === null ? '' : String(item.handlingCost),
    disposalCostPerM2: item.disposalCostPerM2 === null ? '' : String(item.disposalCostPerM2),
    disposalCostPerM: item.disposalCostPerM === null ? '' : String(item.disposalCostPerM),
    temporaryStorageCostPerDay: item.temporaryStorageCostPerDay === null ? '' : String(item.temporaryStorageCostPerDay),
    rotatable: item.rotatable,
    grainDirection: item.grainDirection,
    lapAllowanceMm: item.lapAllowanceMm === null ? '' : String(item.lapAllowanceMm),
    minimumReusableOffcutMm: item.minimumReusableOffcutMm === null ? '' : String(item.minimumReusableOffcutMm),
    reworkRiskCost: item.reworkRiskCost === null ? '' : String(item.reworkRiskCost),
    surfaceFinish: item.surfaceFinish || '',
    color: item.color || '',
  })
  editingCatalogId.value = item.id
  catalogFormOpen.value = true
}

function saveCatalogItem() {
  if (!catalogDraft.name.trim() || !catalogDraft.material.trim()) {
    setNotice('자재 종류와 재질을 입력하세요.')
    return
  }
  const existing = editingCatalogId.value ? project.value.optimization.catalog.find((item) => item.id === editingCatalogId.value) : null
  const item = createCatalogItem({
    id: existing?.id,
    name: catalogDraft.name.trim(),
    materialType: catalogDraft.materialType,
    material: catalogDraft.material.trim(),
    thicknessMm: optionalNumber(catalogDraft.thicknessMm),
    stockWidthMm: optionalNumber(catalogDraft.stockWidthMm),
    stockLengthMm: optionalNumber(catalogDraft.stockLengthMm),
    stockLengthOptionsMm: numberList(catalogDraft.stockLengthOptionsMm),
    unit: catalogDraft.unit,
    unitLabel: catalogDraft.unitLabel.trim() || (catalogDraft.unit === 'bar' ? '본' : '장'),
    unitPrice: optionalNumber(catalogDraft.unitPrice),
    minimumOrderQuantity: optionalNumber(catalogDraft.minimumOrderQuantity),
    cuttingFee: optionalNumber(catalogDraft.cuttingFee),
    cutCostPerCut: optionalNumber(catalogDraft.cutCostPerCut),
    kerfMm: optionalNumber(catalogDraft.kerfMm),
    transportCost: optionalNumber(catalogDraft.transportCost),
    handlingCost: optionalNumber(catalogDraft.handlingCost),
    disposalCostPerM2: optionalNumber(catalogDraft.disposalCostPerM2),
    disposalCostPerM: optionalNumber(catalogDraft.disposalCostPerM),
    temporaryStorageCostPerDay: optionalNumber(catalogDraft.temporaryStorageCostPerDay),
    rotatable: catalogDraft.rotatable,
    grainDirection: catalogDraft.grainDirection,
    lapAllowanceMm: optionalNumber(catalogDraft.lapAllowanceMm),
    minimumReusableOffcutMm: optionalNumber(catalogDraft.minimumReusableOffcutMm),
    reworkRiskCost: optionalNumber(catalogDraft.reworkRiskCost),
    surfaceFinish: catalogDraft.surfaceFinish.trim(),
    color: catalogDraft.color.trim(),
  })
  const catalog = [...project.value.optimization.catalog]
  const index = catalog.findIndex((candidate) => candidate.id === item.id)
  if (index >= 0) catalog.splice(index, 1, item)
  else catalog.push(item)
  project.value.optimization.catalog = catalog
  if (item.materialType === 'panel' && !project.value.optimization.selectedPanelMaterialId) project.value.optimization.selectedPanelMaterialId = item.id
  if (item.materialType === 'profile' && !project.value.optimization.selectedProfileMaterialId) project.value.optimization.selectedProfileMaterialId = item.id
  invalidateOptimizationPlan()
  resetCatalogDraft()
  catalogFormOpen.value = false
  setNotice(`${item.name} 자재 기준을 저장했습니다. 가격·규격이 비어 있으면 비용 계산은 보류됩니다.`)
}

function removeCatalogItem(item: MaterialCatalogItem) {
  if (!window.confirm(`${item.name || '이 자재'} 기준을 삭제할까요?`)) return
  project.value.optimization.catalog = project.value.optimization.catalog.filter((candidate) => candidate.id !== item.id)
  if (project.value.optimization.selectedPanelMaterialId === item.id) project.value.optimization.selectedPanelMaterialId = ''
  if (project.value.optimization.selectedProfileMaterialId === item.id) project.value.optimization.selectedProfileMaterialId = ''
  invalidateOptimizationPlan()
}

function selectOptimizationMaterial(type: 'panel' | 'profile', id: string) {
  if (type === 'panel') project.value.optimization.selectedPanelMaterialId = id
  else project.value.optimization.selectedProfileMaterialId = id
  invalidateOptimizationPlan()
}

function invalidateOptimizationPlan() {
  const current = project.value.optimization || emptyOptimizationState()
  const existingScraps = current.scraps?.filter((scrap) => scrap.source === 'existing') || []
  const currentInventory = current.inventory || emptyInventoryCuttingState()
  project.value.optimization = {
    ...emptyOptimizationState(),
    catalog: current.catalog || [],
    selectedPanelMaterialId: current.selectedPanelMaterialId || '',
    selectedProfileMaterialId: current.selectedProfileMaterialId || '',
    scraps: existingScraps,
    inventory: currentInventory.status === 'approved'
      ? currentInventory
      : {
          ...currentInventory,
          plan: null,
          status: currentInventory.requirements.length ? 'needs-review' : 'not-ready',
          lastCalculatedAt: null,
        },
  }
  project.value.workflow.optimizationCalculated = false
}

function ensureInventoryState() {
  if (!project.value.optimization.inventory) project.value.optimization.inventory = emptyInventoryCuttingState()
  return project.value.optimization.inventory
}

function invalidateInventoryPlan() {
  const inventory = ensureInventoryState()
  if (inventory.status === 'approved') return
  inventory.plan = null
  inventory.status = inventory.requirements.length ? 'needs-review' : 'not-ready'
  inventory.missingFields = []
  inventory.lastCalculatedAt = null
}

function refreshInventoryRequirements(members = project.value.optimization.members) {
  const inventory = ensureInventoryState()
  if (inventory.status === 'approved') {
    setNotice('이미 승인된 보유 자재 예약은 변경하지 않았습니다. 새 계획은 기존 예약을 먼저 처리한 뒤 계산하세요.')
    return
  }
  const sourceMembers = members.length
    ? members
    : buildOptimizationMembers(
        project.value.walls,
        project.value.settings,
        project.value.optimization.selectedPanelMaterialId,
        project.value.optimization.catalog.find((item) => item.id === project.value.optimization.selectedPanelMaterialId) || null,
      ).members
  const generated = buildInventoryRequirementsFromMembers(
    sourceMembers,
    project.value.optimization.catalog,
    allPages.value,
  )
  inventory.requirements = mergeInventoryRequirements(inventory.requirements, generated)
  invalidateInventoryPlan()
}

function loadInventorySample() {
  if (inventoryLocked.value) {
    setNotice('승인된 계획이 있어 예제 데이터로 바꾸지 않았습니다.')
    return
  }
  project.value.optimization.inventory = createInventorySampleData()
  project.value.workflow.optimizationCalculated = false
  saveProject(project.value)
  setNotice('기본 예제를 불러왔습니다. 계산 후 2,800mm 자재가 먼저 사용되는지 확인하세요.')
}

function updateInventoryRequirement(requirement: InventoryRequirement) {
  if (inventoryLocked.value) return
  const normalized = normalizeInventoryRequirement({ ...requirement, status: 'needs-review', confirmedAt: null, confirmedBy: null })
  Object.assign(requirement, normalized)
  invalidateInventoryPlan()
}

function confirmInventoryRequirement(requirement: InventoryRequirement) {
  if (inventoryLocked.value) return
  const normalized = normalizeInventoryRequirement(requirement)
  if (normalized.missingFields.length) {
    requirement.missingFields = normalized.missingFields
    requirement.status = 'needs-review'
    setNotice(`${requirement.zone} · ${requirement.location}: ${normalized.missingFields.join(', ')}를 입력한 뒤 확인하세요.`)
    return
  }
  Object.assign(requirement, normalized, {
    status: 'ready' as const,
    confirmedAt: new Date().toISOString(),
    confirmedBy: '사용자 확인',
  })
  invalidateInventoryPlan()
  setNotice(`${requirement.zone} · ${requirement.location} 정보를 확인했습니다.`)
}

function confirmAllInventoryRequirements() {
  if (inventoryLocked.value) return
  const requirements = ensureInventoryState().requirements
  let missingCount = 0
  for (const requirement of requirements) {
    const normalized = normalizeInventoryRequirement(requirement)
    if (normalized.missingFields.length) {
      Object.assign(requirement, normalized, { status: 'needs-review' as const })
      missingCount += 1
    } else {
      Object.assign(requirement, normalized, {
        status: 'ready' as const,
        confirmedAt: new Date().toISOString(),
        confirmedBy: '사용자 일괄 확인',
      })
    }
  }
  invalidateInventoryPlan()
  setNotice(missingCount ? `${missingCount}개 필요 조각에 확인할 정보가 남아 있습니다.` : '필요 조각을 모두 사용자 확인 상태로 바꿨습니다.')
}

function resetInventoryStockDraft() {
  Object.assign(inventoryStockDraft, {
    materialType: 'panel',
    materialName: '',
    thicknessMm: '',
    widthMm: '',
    lengthMm: '',
    surfaceFinish: '',
    color: '',
    quantity: '1',
    source: 'new',
    usable: true,
    location: '',
    note: '',
  })
}

function addInventoryStock() {
  if (inventoryLocked.value) {
    setNotice('승인된 계획의 보유 자재는 예약을 해제하기 전까지 수정할 수 없습니다.')
    return
  }
  const thicknessMm = optionalNumber(inventoryStockDraft.thicknessMm)
  const widthMm = optionalNumber(inventoryStockDraft.widthMm)
  const lengthMm = optionalNumber(inventoryStockDraft.lengthMm)
  const quantity = optionalNumber(inventoryStockDraft.quantity)
  if (!inventoryStockDraft.materialName.trim() || !thicknessMm || !widthMm || !lengthMm || !quantity || quantity < 1 || !inventoryStockDraft.surfaceFinish.trim() || !inventoryStockDraft.color.trim() || !inventoryStockDraft.location.trim()) {
    setNotice('자재 종류·두께·폭·길이·마감·색상·수량·보관 위치를 모두 입력하세요.')
    return
  }
  const stock: OwnedMaterial = {
    id: `owned-material-${Date.now()}`,
    materialType: inventoryStockDraft.materialType,
    materialName: inventoryStockDraft.materialName.trim(),
    thicknessMm,
    widthMm,
    lengthMm,
    surfaceFinish: inventoryStockDraft.surfaceFinish.trim(),
    color: inventoryStockDraft.color.trim(),
    quantity: Math.floor(quantity),
    reservedQuantity: 0,
    source: inventoryStockDraft.source,
    usable: inventoryStockDraft.usable,
    location: inventoryStockDraft.location.trim(),
    addedAt: new Date().toISOString(),
    note: inventoryStockDraft.note.trim(),
  }
  const inventory = ensureInventoryState()
  inventory.ownedMaterials = [...inventory.ownedMaterials, stock]
  invalidateInventoryPlan()
  resetInventoryStockDraft()
  inventoryStockFormOpen.value = false
  saveProject(project.value)
  setNotice(`${stock.materialName} 보유 자재를 등록했습니다.`)
}

function removeInventoryStock(stock: OwnedMaterial) {
  if (stock.reservedQuantity > 0) {
    setNotice('예약 처리된 자재는 삭제하지 않습니다. 실제 현장 재고를 확인한 뒤 별도 처리하세요.')
    return
  }
  const inventory = ensureInventoryState()
  inventory.ownedMaterials = inventory.ownedMaterials.filter((candidate) => candidate.id !== stock.id)
  invalidateInventoryPlan()
  saveProject(project.value)
}

function calculateInventoryPlanForProject() {
  if (inventoryLocked.value) {
    setNotice('이미 승인된 계획입니다. 재고 예약을 변경하지 않고 결과만 확인합니다.')
    return
  }
  const inventory = ensureInventoryState()
  const result = calculateInventoryCutPlan({
    requirements: inventory.requirements,
    ownedMaterials: inventory.ownedMaterials,
    settings: inventory.settings,
  })
  inventory.plan = result.plan
  inventory.status = result.status
  inventory.missingFields = result.missingFields
  inventory.lastCalculatedAt = new Date().toISOString()
  saveProject(project.value)
  if (result.status === 'calculated') setNotice('보유 자재 우선 절단 계획을 계산했습니다. 승인 전에는 실제 재고가 차감되지 않습니다.')
  else setNotice('확인 필요 정보가 있어 절단 계획을 확정하지 않았습니다.')
}

function approveInventoryPlanForProject() {
  const inventory = ensureInventoryState()
  if (!inventory.plan) {
    setNotice('먼저 보유 자재 기반 절단 계획을 계산하세요.')
    return
  }
  const result = approveInventoryCutPlan(inventory.plan, inventory.ownedMaterials)
  if (!result.ok) {
    setNotice(result.message)
    return
  }
  inventory.plan = result.plan
  inventory.ownedMaterials = result.ownedMaterials
  inventory.status = 'approved'
  saveProject(project.value)
  setNotice(result.message)
}

function cancelInventoryPlanForProject() {
  const inventory = ensureInventoryState()
  if (!inventory.plan || inventory.plan.status !== 'calculated') {
    setNotice('계산 완료 상태의 계획만 취소할 수 있습니다.')
    return
  }
  inventory.plan = cancelInventoryCutPlan(inventory.plan)
  inventory.status = 'cancelled'
  saveProject(project.value)
  setNotice('절단 계획을 취소했습니다. 실제 재고 예약은 변경하지 않았습니다.')
}

function inventorySourceLabel(source: InventoryStockSource) {
  return source === 'scrap' ? '자투리' : '신규 보유'
}

function inventoryRequirementSourceLabel(requirement: InventoryRequirement) {
  const source = requirement.sourceReferences[0]
  return source ? `${source.fileName} · ${source.pageNumber}페이지` : requirement.source === 'sample' ? 'MVP 기본 예제' : '도면 근거 확인 필요'
}

function inventoryRequirementMissingLabels(requirement: InventoryRequirement) {
  return getInventoryRequirementMissingFields(requirement)
}

function inventoryCutStatusLabel(status: string) {
  if (status === 'approved') return '승인·예약'
  if (status === 'cancelled') return '취소'
  return '예상 사용'
}

function inventoryNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '확인 필요' : value.toLocaleString('ko-KR')
}

function runOptimization() {
  if (isOptimizing.value) return
  if (!project.value.workflow.takeoffCalculated) {
    setNotice('먼저 벽체별 자재 수량을 계산하세요.')
    scrollToSection('takeoff')
    return
  }
  isOptimizing.value = true
  try {
    const panelMaterial = project.value.optimization.catalog.find((item) => item.id === project.value.optimization.selectedPanelMaterialId) || null
    const membersResult = buildOptimizationMembers(project.value.walls, project.value.settings, project.value.optimization.selectedPanelMaterialId, panelMaterial)
    const result = optimizeCuttingPlan({
      walls: project.value.walls,
      members: membersResult.members,
      catalog: project.value.optimization.catalog,
      existingScraps: project.value.optimization.scraps.filter((scrap) => scrap.source === 'existing'),
    })
    project.value.optimization.members = result.members
    project.value.optimization.reviews = [...membersResult.reviews, ...result.reviews.filter((review) => !membersResult.reviews.some((current) => current.id === review.id))]
    project.value.optimization.scenarios = result.scenarios
    project.value.optimization.selectedScenarioId = result.selectedScenarioId
    project.value.optimization.recommendedScenarioId = result.recommendedScenarioId
    project.value.optimization.status = result.status
    project.value.optimization.validation = result.validation
    project.value.optimization.scraps = result.scraps
    project.value.optimization.lastCalculatedAt = new Date().toISOString()
    refreshInventoryRequirements(result.members)
    project.value.workflow.optimizationCalculated = true
    selectedOptimizationPlanId.value = ''
    project.value.status = result.status === 'calculated' ? 'completed' : 'partial'
    project.value.statusMessage = result.status === 'calculated'
      ? '절단 배치와 비용 비교가 완료되었습니다.'
      : '절단 배치는 계산했지만 가격·규격·도면 근거 확인이 필요합니다.'
    saveProject(project.value)
    setNotice(result.status === 'calculated' ? '총비용·폐기량·작업 단순안을 비교했습니다.' : '계산 결과에 확인 필요 항목이 있습니다. 임의의 비용은 표시하지 않았습니다.')
  } finally {
    isOptimizing.value = false
  }
}

function chooseOptimizationScenario(id: 'cost' | 'waste' | 'simple') {
  project.value.optimization.selectedScenarioId = id
  selectedOptimizationPlanId.value = ''
}

function formatOptimizationCost(value: number | null) {
  return value === null ? '계산 불가' : `${value.toLocaleString('ko-KR')}원`
}

function formatOptimizationMm(value: number | null) {
  return value === null ? '확인 필요' : `${value.toLocaleString('ko-KR')}mm`
}

function addExistingScrap() {
  const material = project.value.optimization.catalog.find((item) => item.id === scrapDraft.materialId)
  const lengthMm = optionalNumber(scrapDraft.lengthMm)
  if (!material || lengthMm === null || lengthMm <= 0) {
    setNotice('자투리 자재와 길이를 입력하세요.')
    return
  }
  const widthMm = optionalNumber(scrapDraft.widthMm)
  const planned = Boolean(scrapDraft.plannedUseMemberId && scrapDraft.plannedUseAt)
  const scrap: ScrapPiece = {
    id: `existing-scrap-${Date.now()}`,
    source: 'existing',
    sourceStockPlanId: null,
    materialId: material.id,
    material: material.material,
    thicknessMm: material.thicknessMm,
    widthMm,
    lengthMm,
    xMm: null,
    yMm: null,
    currentLocation: scrapDraft.currentLocation.trim() || '현장 위치 확인 필요',
    originZone: scrapDraft.originZone.trim() || '발생 구역 확인 필요',
    usableZones: scrapDraft.usableZones.split(/[,，]+/).map((item) => item.trim()).filter(Boolean),
    plannedUseMemberId: scrapDraft.plannedUseMemberId || null,
    generatedAt: scrapDraft.generatedAt || new Date().toISOString(),
    plannedUseAt: scrapDraft.plannedUseAt || null,
    storageDays: null,
    temporaryStorageCost: null,
    available: planned,
    status: planned ? 'reuse-planned' : 'reuse-unavailable',
    disposalCategory: planned ? null : '업체 반납',
    note: planned ? '현재 현장 부재에 배정 예정' : '사용처·사용 시점이 없어 현장 재사용 불가',
  }
  project.value.optimization.scraps = [...project.value.optimization.scraps.filter((item) => item.source === 'existing'), scrap]
  invalidateOptimizationPlan()
  Object.assign(scrapDraft, { materialId: '', widthMm: '', lengthMm: '', currentLocation: '', originZone: '', usableZones: '', plannedUseMemberId: '', generatedAt: '', plannedUseAt: '' })
  scrapFormOpen.value = false
}

function removeExistingScrap(id: string) {
  project.value.optimization.scraps = project.value.optimization.scraps.filter((scrap) => scrap.id !== id)
  invalidateOptimizationPlan()
}

function saveOptimizationReviewValue(item: OptimizationReviewItem) {
  const value = optimizationReviewDrafts[item.id]?.trim()
  if (!value) {
    setNotice('수정할 값을 입력하거나 원본 분석·자재 카탈로그에서 값을 먼저 수정하세요.')
    return
  }
  if (item.targetId && item.targetField) {
    const material = project.value.optimization.catalog.find((candidate) => candidate.id === item.targetId)
    if (!material) {
      setNotice('수정 대상 자재를 찾지 못했습니다. 자재 카탈로그를 다시 확인하세요.')
      return
    }
    const numericFields: Array<keyof MaterialCatalogItem> = [
      'thicknessMm', 'stockWidthMm', 'stockLengthMm', 'unitPrice', 'minimumOrderQuantity',
      'cuttingFee', 'cutCostPerCut', 'kerfMm', 'transportCost', 'handlingCost',
      'disposalCostPerM2', 'disposalCostPerM', 'temporaryStorageCostPerDay',
      'lapAllowanceMm', 'minimumReusableOffcutMm', 'reworkRiskCost',
    ]
    const parsed = Number(value.replace(/,/g, ''))
    if (numericFields.includes(item.targetField) && (!Number.isFinite(parsed) || parsed < 0)) {
      setNotice('수정값은 0 이상의 숫자로 입력하세요.')
      return
    }
    material[item.targetField] = numericFields.includes(item.targetField) ? parsed : value
    item.editableValue = value
    optimizationReviewDrafts[item.id] = ''
    setNotice('자재 카탈로그의 확인값을 반영하고 절단 배치를 다시 계산합니다.')
    runOptimization()
    return
  }
  item.editableValue = value
  item.reason = `${item.reason} 확인 요청값: ${value}`
  optimizationReviewDrafts[item.id] = ''
  setNotice('확인 요청값을 기록했습니다. 원본 분석값 또는 자재 카탈로그를 수정한 뒤 다시 계산하세요.')
}

function catalogSpec(item: MaterialCatalogItem) {
  const size = item.materialType === 'panel'
    ? `${formatOptimizationMm(item.stockLengthMm)} × ${formatOptimizationMm(item.stockWidthMm)}`
    : `${item.stockLengthOptionsMm.length ? item.stockLengthOptionsMm.map((value) => `${value.toLocaleString('ko-KR')}mm`).join('·') : formatOptimizationMm(item.stockLengthMm)}`
  return `${item.material} · ${item.thicknessMm === null ? '두께 확인 필요' : `${item.thicknessMm}mm`} · ${size}`
}

function catalogMissingLabel(item: MaterialCatalogItem) {
  const missing: string[] = []
  if (item.materialType === 'panel' && (item.stockWidthMm === null || item.stockLengthMm === null)) missing.push('판재 크기')
  if (item.materialType === 'profile' && !item.stockLengthOptionsMm.length && item.stockLengthMm === null) missing.push('원자재 길이')
  if (item.kerfMm === null) missing.push('절단폭')
  if (item.unitPrice === null) missing.push('단가')
  if (item.minimumOrderQuantity === null) missing.push('최소 주문')
  return missing.length ? `확인 필요: ${missing.join('·')}` : '계산 기준 입력 완료'
}

function planScraps(plan: NonNullable<typeof selectedOptimizationPlan.value>) {
  return optimizationScenario.value?.scraps.filter((scrap) => plan.scrapIds.includes(scrap.id) && (scrap.source === 'generated' || scrap.status !== 'reuse-planned')) || []
}

function placementStyle(placement: CuttingPlacement, plan: NonNullable<typeof selectedOptimizationPlan.value>) {
  const stockWidth = plan.stockWidthMm || Math.max(placement.widthMm || 1, 1)
  if (plan.materialType === 'profile') {
    return {
      left: `${(placement.xMm / plan.stockLengthMm) * 100}%`,
      width: `${Math.max((placement.lengthMm / plan.stockLengthMm) * 100, 1)}%`,
    }
  }
  return {
    left: `${(placement.xMm / plan.stockLengthMm) * 100}%`,
    top: `${(placement.yMm / stockWidth) * 100}%`,
    width: `${Math.max((placement.lengthMm / plan.stockLengthMm) * 100, 1)}%`,
    height: `${Math.max(((placement.widthMm || 0) / stockWidth) * 100, 1)}%`,
  }
}

function scrapStyle(scrap: ScrapPiece, plan: NonNullable<typeof selectedOptimizationPlan.value>) {
  const stockWidth = plan.stockWidthMm || Math.max(scrap.widthMm || 1, 1)
  const leftMm = scrap.xMm ?? 0
  const topMm = scrap.yMm ?? 0
  if (plan.materialType === 'profile') {
    return {
      left: `${(leftMm / plan.stockLengthMm) * 100}%`,
      width: `${Math.max((scrap.lengthMm / plan.stockLengthMm) * 100, 1)}%`,
    }
  }
  return {
    left: `${(leftMm / plan.stockLengthMm) * 100}%`,
    top: `${(topMm / stockWidth) * 100}%`,
    width: `${Math.max((scrap.lengthMm / plan.stockLengthMm) * 100, 1)}%`,
    height: `${Math.max(((scrap.widthMm || 0) / stockWidth) * 100, 1)}%`,
  }
}

function optimizationValidationMessages() {
  const validation = project.value.optimization.validation
  return [
    ...validation.memberAssignmentErrors,
    ...validation.oversizedMemberErrors,
    ...validation.overlapErrors,
    ...validation.kerfErrors,
    ...validation.unitErrors,
    ...validation.duplicateCalculationErrors,
    ...validation.openingDoubleCountErrors,
    ...validation.unsupportedShapeErrors,
  ]
}

function exportSelectedOptimization(kind: 'plans' | 'members' | 'orders' | 'scraps' | 'comparison' | 'inputs') {
  const scenario = optimizationScenario.value
  if (!scenario) {
    setNotice('먼저 절단 최적화를 계산하세요.')
    return
  }
  if (kind === 'plans') downloadCuttingPlansCsv(scenario)
  if (kind === 'members') downloadCuttingMembersCsv(project.value.optimization.members)
  if (kind === 'orders') downloadOptimizationOrderCsv(scenario, project.value.optimization.catalog)
  if (kind === 'scraps') downloadScrapsCsv(scenario.scraps)
  if (kind === 'comparison') downloadScenarioComparisonCsv(project.value.optimization.scenarios)
  if (kind === 'inputs') downloadOptimizationInputsCsv(project.value.optimization.catalog, project.value.optimization.members)
}

function printSelectedCuttingPlans() {
  const scenario = optimizationScenario.value
  if (!scenario) {
    setNotice('먼저 절단 최적화를 계산하세요.')
    return
  }
  printCuttingPlans(project.value.name, scenario)
}

function recompute() {
  const extractedDimensions = project.value.files.flatMap((file) => file.pages.flatMap((page) => page.dimensions))
  // User-confirmed values are the source of truth when a previous review edited one.
  const userValues = new Map(project.value.dimensions.filter((dimension) => dimension.userEdited).map((dimension) => [dimension.id, dimension]))
  const dimensions = extractedDimensions.map((dimension) => {
    const userValue = userValues.get(dimension.id)
    return userValue ? { ...dimension, ...userValue, evidence: dimension.evidence } : dimension
  })
  const levelDimensions = deriveLevelHeightDimensions(dimensions)
  project.value.dimensions = [...dimensions, ...levelDimensions]
  project.value.walls = buildWalls(project.value.files, project.value.dimensions)
  const conflictDimensionIds = new Set(project.value.walls.flatMap((wall) => (wall.conflicts || []).flatMap((conflict) => conflict.values.map((value) => value.dimensionId))))
  if (conflictDimensionIds.size) {
    project.value.dimensions = project.value.dimensions.map((dimension) => conflictDimensionIds.has(dimension.id) && !dimension.userEdited
      ? { ...dimension, confidence: 'low' }
      : dimension)
  }
  project.value.model = buildBuildingGeometry(project.value.walls, project.value.settings.panelThicknessMm, extractRoofGeometry(project.value.files, project.value.walls))
  project.value.heightCandidates = buildHeightCandidates(project.value.files, project.value.dimensions, project.value.walls)
  for (const candidate of project.value.heightCandidates) heightReviewDraft(candidate)
  project.value.heightDiagnostics = buildHeightDiagnostics(project.value.files, project.value.dimensions, project.value.walls, project.value.model, project.value.heightCandidates)
  if (import.meta.env.DEV) {
    console.info('[높이 진단]', project.value.heightDiagnostics.stages, project.value.heightDiagnostics.entries)
  }
  project.value.takeoffs = project.value.workflow.takeoffCalculated
    ? calculateTakeoffs(project.value.walls, project.value.settings)
    : []
  project.value.consistencyValidation = validateConsistency({
    files: project.value.files,
    dimensions: project.value.dimensions,
    walls: project.value.walls,
    model: project.value.model,
    takeoffs: project.value.takeoffs,
    optimization: project.value.optimization,
    workflow: project.value.workflow,
    actualData: project.value.files.some((file) => file.pages.length > 0 && file.kind !== 'cost-summary'),
    testData: false,
  })
  const wallValidation = new Map(project.value.consistencyValidation.wallResults.map((result) => [result.wallId, result.status]))
  project.value.walls = project.value.walls.map((wall) => ({ ...wall, validationStatus: wallValidation.get(wall.id) || '확인 필요' }))
  const takeoffValidation = new Map(project.value.consistencyValidation.takeoffResults.map((result) => [result.wallId, result.status]))
  project.value.takeoffs = project.value.takeoffs.map((takeoff) => ({ ...takeoff, validationStatus: takeoffValidation.get(takeoff.wallId) || '확인 필요' }))
  project.value.model.walls = project.value.model.walls.map((wall) => ({ ...wall, validationStatus: wallValidation.get(wall.wallId) || '확인 필요' }))
  project.value.optimization.members = project.value.optimization.members.map((member) => ({
    ...member,
    validationStatus: project.value.consistencyValidation.cutting.memberResults.find((result) => result.memberId === member.id)?.status || (project.value.workflow.optimizationCalculated ? '확인 필요' : '계산 불가'),
  }))
  const fileFailures = project.value.files
    .filter((file) => file.status === 'failed')
    .map((file) => `${file.name}: ${file.error || '파일 분석 실패'}`)
  project.value.missingItems = [...new Set([...listMissingGeometryItems(project.value.files, project.value.walls), ...fileFailures, ...project.value.consistencyValidation.blockingReasons])]
  const dimensionReviewItems = project.value.dimensions
    .filter((dimension) => dimension.confidence !== 'high' && !['approved', 'edited'].includes(dimension.heightReviewAction || ''))
    .map((dimension) => `${dimension.label}: ${dimension.displayValue} · ${dimension.sourceFile} ${dimension.pageNumber}페이지 위치 ${(dimension.sourcePosition.x * 100).toFixed(0)}%, ${(dimension.sourcePosition.y * 100).toFixed(0)}%`)
  const conflictReviewItems = project.value.walls.flatMap((wall) => (wall.conflicts || []).map((conflict) => {
    const first = conflict.values[0]
    const source = first?.evidence[0]
    const location = source?.location ? ` 위치 ${(source.location.x * 100).toFixed(0)}%, ${(source.location.y * 100).toFixed(0)}%` : ''
    return `${wall.zone} ${wall.wallNumber}: ${conflict.reason}${source ? ` · ${source.fileName} ${source.pageNumber}페이지${location}` : ''}`
  }))
  project.value.reviewItems = [...new Set([...dimensionReviewItems, ...conflictReviewItems])]
  project.value.costSummary = parseCostSummaries(project.value.files)
  const firstSource = project.value.files.find((file) => file.pages.length && file.kind !== 'cost-summary') || project.value.files.find((file) => file.pages.length)
  if (firstSource) {
    const sourcePage = firstSource.pages[0]
    project.value.buildingName = guessBuildingName(sourcePage?.text || '', firstSource.name)
  } else if (!project.value.files.length) {
    project.value.buildingName = '아직 도면을 올리지 않았습니다'
  }
  project.value.updatedAt = new Date().toISOString()
  if (selectedWallId.value && !project.value.walls.some((wall) => wall.id === selectedWallId.value)) selectedWallId.value = ''
  if (selectedPageId.value && !allPages.value.some((page) => page.id === selectedPageId.value)) selectedPageId.value = ''
  saveProject(project.value)
}

function classifyFile(file: AnalyzedFile, pages: DrawingPage[]) {
  const text = pages.map((page) => page.text).join('\n')
  const pageKinds = pages.map((page) => page.kind)
  const classification = classifyDocument(text, file.name)
  const priority: DrawingKind[] = ['cost-summary', 'floor-plan', 'elevation', 'section', 'detail', 'structural', 'material-schedule', 'unknown']
  const strongestKind = priority.find((kind) => pageKinds.includes(kind)) || classification.kind
  const selectedPage = pages.find((page) => page.kind === strongestKind) || pages[0]
  file.kind = strongestKind
  file.kindConfidence = selectedPage?.kindConfidence || classification.confidence
  file.warnings = [...new Set([...file.warnings, ...pages.flatMap((page) => page.warnings)])]
}

function nextUiTick() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}

function setAnalysisStage(meta: AnalyzedFile, stage: AnalyzedFile['stage'], progress?: number) {
  meta.stage = stage
  if (typeof progress === 'number') meta.progress = progress
  if (meta.status === 'analyzing' && ['uploading', 'identifying', 'classifying', 'extracting', 'checking-height'].includes(stage)) {
    setProjectStatus(statusForAnalysisStage(stage))
  }
}

function needsReview(meta: AnalyzedFile) {
  const pages = meta.pages
  return meta.warnings.length > 0 ||
    meta.kind === 'unknown' ||
    pages.some((page) => page.kindConfidence !== 'high' || page.handWritingDetected || page.dimensions.some((dimension) => dimension.confidence !== 'high')) ||
    pages.every((page) => page.dimensions.length === 0)
}

async function analyzeOne(file: File, meta: AnalyzedFile) {
  resetWorkflow()
  meta.status = 'analyzing'
  setAnalysisStage(meta, 'uploading', 1)
  meta.error = ''
  try {
    await nextUiTick()
    setAnalysisStage(meta, 'identifying', 5)
    await nextUiTick()
    if (!isSupportedFile(file)) {
      const cad = analyzeCadFile(file)
      meta.status = 'failed'
      setAnalysisStage(meta, 'failed', 100)
      meta.error = cad.message || unsupportedMessage(file.name)
      meta.warnings = [meta.error]
      recompute()
      return
    }
    setAnalysisStage(meta, 'extracting', 10)
    if (extensionOf(file.name) === 'pdf') {
      const result = await extractPdfDocument(file, meta.id, (progress) => { meta.progress = progress })
      meta.pages = result.pages
      meta.previewUrl = result.pages[0]?.previewUrl || ''
      setAnalysisStage(meta, 'classifying', 94)
      classifyFile(meta, result.pages)
    } else {
      const result = await analyzeImage(file, meta.id, (progress) => { meta.progress = progress })
      meta.pages = [result.page]
      meta.previewUrl = result.page.previewUrl
      setAnalysisStage(meta, 'classifying', 94)
      classifyFile(meta, meta.pages)
      if (result.engineWarning) meta.warnings.push(result.engineWarning)
    }
    setAnalysisStage(meta, 'checking-height', 97)
    await nextUiTick()
    meta.progress = 100
    if (needsReview(meta)) {
      meta.status = 'warning'
      setAnalysisStage(meta, 'needs-review', 100)
    } else {
      meta.status = 'complete'
      setAnalysisStage(meta, 'complete', 100)
    }
    meta.canReanalyze = true
  } catch (error) {
    meta.status = 'failed'
    setAnalysisStage(meta, 'failed', 100)
    meta.error = error instanceof Error ? error.message : '파일 분석에 실패했습니다.'
    meta.warnings = [meta.error]
    meta.canReanalyze = true
  }
  recompute()
}

async function analyzeFiles(files: File[]) {
  if (isAnalyzing.value) {
    setNotice('현재 파일 분석이 끝난 뒤 추가 파일을 올려주세요.')
    return
  }
  const queued = files.map((file) => {
    const meta = createQueuedFile(file)
    sourceFiles.set(meta.id, file)
    project.value.files.push(meta)
    return { file, meta }
  })
  resetWorkflow()
  setProjectStatus('uploading', '업로드한 파일을 프로젝트에 등록했습니다.')
  recompute()
  isAnalyzing.value = true
  for (const item of queued) {
    if (item.meta.status === 'failed') continue
    await analyzeOne(item.file, item.meta)
  }
  isAnalyzing.value = false
  setProjectStatus('linking', '모든 파일의 분석 결과를 하나의 프로젝트로 연결하고 있습니다.')
  await nextUiTick()
  recompute()
  const assessment = workflowAssessment.value
  setProjectStatus(assessment.status === 'failed' ? 'failed' : 'needs-review', assessment.status === 'failed' ? '처리 가능한 설계도 파일이 없습니다.' : PROJECT_STATUS_DESCRIPTIONS['needs-review'])
  saveProject(project.value)
  const analyzedCount = queued.filter((item) => item.meta.status !== 'failed').length
  if (analyzedCount) setNotice(`${analyzedCount}개 파일의 분석이 완료되었습니다. 근거와 경고를 확인하세요.`)
}

function handleInput(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) void analyzeFiles(Array.from(input.files))
  input.value = ''
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (files?.length) void analyzeFiles(Array.from(files))
}

function triggerFileInput() {
  fileInput.value?.click()
}

function removeFile(fileId: string) {
  const file = project.value.files.find((item) => item.id === fileId)
  if (!file) return
  project.value.files = project.value.files.filter((item) => item.id !== fileId)
  sourceFiles.delete(fileId)
  resetWorkflow()
  if (selectedPageId.value.startsWith(fileId)) selectedPageId.value = ''
  if (selectedHeightCandidateId.value && !project.value.heightCandidates.some((candidate) => candidate.candidateId === selectedHeightCandidateId.value)) selectedHeightCandidateId.value = ''
  recompute()
  if (!project.value.files.length) setProjectStatus('empty')
  else setProjectStatus('needs-review', '파일이 변경되었습니다. 연결 결과와 신뢰도를 다시 확인하세요.')
  saveProject(project.value)
  setNotice(`${file.name} 파일을 프로젝트에서 제거했습니다.`)
}

async function reanalyze(fileId: string) {
  const file = sourceFiles.get(fileId)
  const meta = project.value.files.find((item) => item.id === fileId)
  if (!file || !meta) {
    setNotice('새로고침 후에는 원본 파일을 다시 올려야 재분석할 수 있습니다.')
    return
  }
  resetWorkflow()
  setProjectStatus('uploading', `${meta.name} 파일을 다시 분석하고 있습니다.`)
  await analyzeOne(file, meta)
  setProjectStatus('linking', '다시 분석한 결과를 기존 프로젝트와 연결하고 있습니다.')
  recompute()
  const assessment = workflowAssessment.value
  setProjectStatus(assessment.status === 'failed' ? 'failed' : 'needs-review', assessment.status === 'failed' ? '처리 가능한 설계도 파일이 없습니다.' : PROJECT_STATUS_DESCRIPTIONS['needs-review'])
  saveProject(project.value)
}

function syncDimensionToPages(dimension: DimensionValue) {
  for (const file of project.value.files) {
    for (const page of file.pages) {
      const pageDimension = page.dimensions.find((candidate) => candidate.id === dimension.id)
      if (pageDimension) Object.assign(pageDimension, dimension)
    }
  }
}

function heightCandidateForEntry(candidateOrId: HeightCandidate | string) {
  const id = typeof candidateOrId === 'string' ? candidateOrId : candidateOrId.candidateId
  return project.value.heightCandidates.find((candidate) => candidate.candidateId === id) || null
}

function heightReviewDraft(candidate: HeightCandidate) {
  if (!heightReviewDrafts[candidate.candidateId]) {
    heightReviewDrafts[candidate.candidateId] = {
      valueMm: candidate.valueMm === null ? '' : String(candidate.valueMm),
      reason: '',
      wallNumber: candidate.relatedWallId ? project.value.walls.find((wall) => wall.id === candidate.relatedWallId)?.wallNumber || '' : '',
      zone: candidate.relatedZone || '',
    }
  }
  return heightReviewDrafts[candidate.candidateId]
}

function selectHeightCandidate(candidateOrId: HeightCandidate | string) {
  const candidate = heightCandidateForEntry(candidateOrId)
  if (!candidate) return
  selectedHeightCandidateId.value = candidate.candidateId
  const dimension = project.value.dimensions.find((item) => item.id === candidate.candidateId)
  const evidence = dimension?.evidence.find((item) => item.pageNumber === candidate.pageNumber) || dimension?.evidence[0]
  const page = allPages.value.find((item) => item.id === `${evidence?.fileId}-page-${candidate.pageNumber}`)
  if (page) selectedPageId.value = page.id
  activeSection.value = 'analysis'
  void nextTick(() => {
    document.querySelector('.source-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

function heightReviewActionLabel(action: HeightReviewAction) {
  const labels: Record<HeightReviewAction, string> = {
    approved: '승인',
    excluded: '제외',
    edited: '값 수정 후 승인',
    linked: '벽체·구역 연결',
    'marked-handwriting': '손글씨로 표시',
    'needs-review': '확인 필요 유지',
  }
  return labels[action]
}

function reviewHeightCandidate(candidateOrId: HeightCandidate | string, action: HeightReviewAction, overrideValueMm?: number) {
  const candidate = heightCandidateForEntry(candidateOrId)
  if (!candidate) return
  const existing = project.value.dimensions.find((dimension) => dimension.id === candidate.candidateId)
  if (!existing) {
    setNotice('원본 높이 후보를 찾지 못했습니다. 파일을 다시 분석해 주세요.')
    return
  }
  const draft = heightReviewDraft(candidate)
  const valueMm = overrideValueMm ?? (draft.valueMm.trim() ? Number(draft.valueMm.replace(/,/g, '')) : null)
  if (['approved', 'edited', 'linked'].includes(action) && (!Number.isFinite(valueMm) || (valueMm as number) <= 0)) {
    setNotice('승인·연결하려면 0보다 큰 높이(mm)를 확인해야 합니다.')
    return
  }
  if (action === 'linked' && (!draft.wallNumber || !draft.zone)) {
    setNotice('벽체와 구역을 선택한 뒤 연결하세요.')
    return
  }
  const beforeModelBuilt = project.value.workflow.modelBuilt
  const beforeTakeoffCalculated = project.value.workflow.takeoffCalculated
  const now = new Date().toISOString()
  const next = applyHeightReview(existing, {
    action,
    valueMm,
    reason: draft.reason || `${heightReviewActionLabel(action)} · 원본 도면 근거를 사람이 확인함`,
    wallNumber: action === 'linked' ? draft.wallNumber : undefined,
    zone: action === 'linked' ? draft.zone : undefined,
    reviewedAt: now,
  })
  if (action === 'approved' || action === 'edited') next.confidence = 'high'
  project.value.dimensions = project.value.dimensions.map((dimension) => dimension.id === next.id ? next : dimension)
  syncDimensionToPages(next)
  resetWorkflow()
  recompute()
  // A previously generated model/takeoff is recalculated immediately after a
  // height decision. It is never silently reused from the old geometry.
  if (beforeModelBuilt && project.value.model.isReady) {
    project.value.workflow.modelBuilt = true
    if (beforeTakeoffCalculated) {
      project.value.takeoffs = calculateTakeoffs(project.value.walls, project.value.settings)
      project.value.workflow.takeoffCalculated = true
    }
  }
  const recalculated = project.value.dimensions.find((dimension) => dimension.id === next.id)
  if (recalculated) {
    const withAudit = markHeightReviewRecalculated(recalculated, new Date().toISOString())
    project.value.dimensions = project.value.dimensions.map((dimension) => dimension.id === withAudit.id ? withAudit : dimension)
    syncDimensionToPages(withAudit)
  }
  setProjectStatus(project.value.model.isReady ? 'partial' : 'needs-review', `${heightReviewActionLabel(action)} 처리 후 3차원 형상과 연결된 수량을 다시 계산했습니다. 발주 전 확인 상태를 확인하세요.`)
  saveProject(project.value)
  setNotice(`${heightReviewActionLabel(action)} 처리 및 관련 3차원·자재 계산을 다시 실행했습니다.`)
}

function updateDimension(payload: { id: string; valueMm: number; displayValue: string }) {
  const candidate = heightCandidateForEntry(payload.id)
  if (candidate) {
    const draft = heightReviewDraft(candidate)
    draft.valueMm = String(payload.valueMm)
    void reviewHeightCandidate(candidate, 'edited', payload.valueMm)
    return
  }
  const existing = project.value.dimensions.find((dimension) => dimension.id === payload.id)
  if (!existing) return
  const originalValueMm = existing.originalValueMm ?? existing.valueMm
  existing.valueMm = payload.valueMm
  existing.value = payload.valueMm
  existing.normalizedValueMm = payload.valueMm
  existing.displayValue = payload.displayValue
  existing.unit = 'mm'
  existing.confidence = 'high'
  existing.source = 'user'
  existing.sourceType = 'calculated'
  existing.userEdited = true
  existing.originalValueMm = originalValueMm
  existing.userValueMm = payload.valueMm
  existing.heightReviewAction = 'edited'
  existing.heightReview = {
    action: 'edited',
    beforeValueMm: originalValueMm,
    afterValueMm: payload.valueMm,
    reason: '기존 신뢰도 검토 패널에서 사용자가 값을 수정함',
    reviewedAt: new Date().toISOString(),
    reviewedBy: '현재 사용자',
    recalculatedAt: null,
  }
  syncDimensionToPages(existing)
  resetWorkflow()
  recompute()
  setProjectStatus('needs-review', '사용자 확인값을 반영했습니다. 검토를 완료한 뒤 3차원 모델을 생성하세요.')
  saveProject(project.value)
  setNotice('사용자 확인값으로 반영했고, 관련 벽체·수량을 다시 계산했습니다.')
}

async function build3DModel() {
  if (isBuilding3D.value) return
  if (!canBuild3D.value) {
    setProjectStatus('needs-review', project.value.heightDiagnostics.message || '높이·벽체 길이를 확인해야 3차원 모델을 만들 수 있습니다.')
    setNotice(project.value.heightDiagnostics.message || reviewBlockers.value[0] || '검토가 필요한 값이 있습니다.')
    scrollToSection('analysis')
    return
  }
  project.value.workflow.reviewConfirmed = true
  project.value.workflow.modelBuilt = false
  project.value.workflow.takeoffCalculated = false
  isBuilding3D.value = true
  setProjectStatus('building-3d', '검토가 완료되어 실제 길이·높이 기반 입체 형상을 생성하고 있습니다.')
  try {
    await nextUiTick()
    recompute()
    if (!project.value.model.isReady) {
      setProjectStatus('partial', project.value.model.blockedReason)
      saveProject(project.value)
      return
    }
    project.value.workflow.modelBuilt = true
    setProjectStatus('partial', project.value.model.partial ? '높이가 확인된 벽체만 부분 3차원 모델로 만들었습니다. 누락 벽체는 높이 확인 후 추가됩니다.' : '3차원 모델이 생성되었습니다. 벽체를 검토한 뒤 자재 계산을 시작하세요.')
    saveProject(project.value)
    scrollToSection('model')
  } finally {
    isBuilding3D.value = false
  }
}

async function calculateMaterials() {
  if (isCalculating.value) return
  if (!canCalculateMaterials.value) {
    setNotice('먼저 검토를 완료하고 3차원 모델을 생성하세요.')
    scrollToSection('model')
    return
  }
  isCalculating.value = true
  try {
    setProjectStatus('calculating', '벽체별 실제 배치 기준으로 판넬과 부자재 수량을 계산하고 있습니다.')
    await nextUiTick()
    project.value.takeoffs = calculateTakeoffs(project.value.walls, project.value.settings)
    project.value.workflow.takeoffCalculated = true
    const assessment = assessProjectWorkflow({
      files: project.value.files,
      workflow: project.value.workflow,
      model: project.value.model,
      takeoffs: project.value.takeoffs,
      missingItems: project.value.missingItems,
      reviewItems: project.value.reviewItems,
      consistency: project.value.consistencyValidation,
      isAnalyzing: false,
      currentStatus: 'calculating',
    })
    setProjectStatus(assessment.status, assessment.status === 'completed'
      ? PROJECT_STATUS_DESCRIPTIONS.completed
      : '수량은 계산됐지만 일부 벽체 또는 근거는 발주 전 검토가 필요합니다.')
    saveProject(project.value)
    if (assessment.status === 'completed') setNotice('발주 가능한 산출표가 준비되었습니다.')
    else setNotice('산출표는 계산됐지만 발주 전 확인이 필요한 항목이 있습니다.')
    scrollToSection('takeoff')
  } finally {
    isCalculating.value = false
  }
}

function selectWall(wallId: string) {
  if (showTestModel.value) return
  selectedWallId.value = wallId
  if (activeSection.value !== 'model') {
    activeSection.value = 'model'
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  void nextTick(() => {
    const element = document.getElementById('wall-detail')
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

function toggleTestModel() {
  showTestModel.value = !showTestModel.value
  selectedWallId.value = ''
  setNotice(showTestModel.value
    ? '테스트 모델을 표시합니다. 실제 발주 계산과 저장 결과에는 사용되지 않습니다.'
    : '실제 설계도 분석 모델로 돌아왔습니다.')
}

function scrollToSection(section: string) {
  if (section === 'analysis' && !workflowStepEnabled('analysis')) {
    setNotice('먼저 파일을 업로드하세요.')
    return
  }
  if (section === 'takeoff' && !workflowStepEnabled('takeoff')) {
    setNotice('먼저 3차원 모델을 만들고 벽체를 확인하세요.')
    return
  }
  if (section === 'optimization' && !workflowStepEnabled('optimization')) {
    setNotice('먼저 벽체별 자재 수량을 계산하세요.')
    return
  }
  activeSection.value = section
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function resetProject() {
  if (!window.confirm('현재 프로젝트와 로컬 저장 결과를 지울까요?')) return
  clearProject()
  sourceFiles.clear()
  project.value = makeProject()
  syncSettingsDraft(project.value.settings)
  selectedPageId.value = ''
  selectedWallId.value = ''
  selectedHeightCandidateId.value = ''
  setNotice('새 프로젝트를 시작했습니다.')
}

function formatMm(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${(value / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}미터`
}

function formatAmount(value: number | null) {
  if (value === null) return '—'
  return `${value.toLocaleString('ko-KR')}원`
}

function fileTypeLabel(extension: string) {
  if (extension === 'pdf') return 'PDF 문서'
  if (extension === 'jpg' || extension === 'jpeg') return '사진 파일'
  if (extension === 'png') return '사진 파일'
  return '파일'
}

function sourceTypeLabel(sourceType: DimensionValue['sourceType']) {
  if (sourceType === 'pdf-text') return 'PDF 글자에서 추출'
  if (sourceType === 'vector') return '도면 선에서 추출'
  if (sourceType === 'ocr') return '사진 글자에서 추출'
  return '계산된 값'
}

function heightStageClass(status: string) {
  return `height-stage-${status.replace('needs-review', 'review')}`
}

function heightDiagnosticCauseLabel(cause: keyof typeof HEIGHT_DIAGNOSTIC_CAUSE_LABELS | null) {
  return cause ? HEIGHT_DIAGNOSTIC_CAUSE_LABELS[cause] : ''
}

function heightDiagnosticStatusLabel(status: keyof typeof HEIGHT_DIAGNOSTIC_STATUS_LABELS) {
  return HEIGHT_DIAGNOSTIC_STATUS_LABELS[status]
}

function heightDiagnosticValue(value: number | null) {
  return value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

function heightDiagnosticPosition(position: { x: number; y: number; width: number; height: number } | null) {
  if (!position) return '원본 위치 미확인'
  return `x ${(position.x * 100).toFixed(0)}% · y ${(position.y * 100).toFixed(0)}% · 폭 ${(position.width * 100).toFixed(0)}% · 높이 ${(position.height * 100).toFixed(0)}%`
}

function heightCandidateSourceTypeLabel(sourceType: string | undefined) {
  if (sourceType === 'PDF_TEXT') return 'PDF_TEXT · 인쇄 텍스트'
  if (sourceType === 'PRINTED_OCR') return 'PRINTED_OCR · 인쇄 OCR'
  if (sourceType === 'HANDWRITING') return 'HANDWRITING · 손글씨'
  if (sourceType === 'LEVEL_CALCULATION') return 'LEVEL_CALCULATION · 레벨 계산'
  return '확인 필요'
}

function heightPrintStatusLabel(sourceType: string | undefined) {
  if (sourceType === 'HANDWRITING') return '손글씨 · 자동 계산 제외'
  if (sourceType === 'PRINTED_OCR' || sourceType === 'PDF_TEXT') return '인쇄 문자로 판정'
  if (sourceType === 'LEVEL_CALCULATION') return '레벨 계산값 · 원문 기준 확인'
  return '인쇄·손글씨 구분 확인 필요'
}

function heightSourceForWall(wallId: string) {
  const wall = project.value.walls.find((item) => item.id === wallId)
  return wall?.heightSourceDimensionId
    ? project.value.dimensions.find((dimension) => dimension.id === wall.heightSourceDimensionId) || null
    : null
}

function fileStatusLabel(file: AnalyzedFile) {
  if (file.warnings.some((warning) => /OCR\s*(엔진|기능)|OCR.*(사용 불가|초기화|실행하지 못)|인식 엔진/i.test(warning))) return 'OCR 사용 불가'
  const label = ANALYSIS_STAGE_LABELS[file.stage]
  return file.status === 'analyzing' ? `${label} ${file.progress}%` : label
}

function fileStatusClass(file: AnalyzedFile) {
  return `status-${file.status}`
}

function pageOcrStatus(page: DrawingPage) {
  if (page.warnings.some((warning) => /OCR\s*(엔진|기능)|OCR.*(사용 불가|초기화|실행하지 못)/i.test(warning))) return 'OCR 사용 불가'
  if (page.dimensions.some((dimension) => dimension.sourceType === 'ocr') || page.processingNotes?.some((note) => /OCR/i.test(note))) return '실행됨'
  return page.kind === 'cost-summary' || page.text.trim() ? '필요 없음 · PDF 글자' : '결과 없음'
}

function pageAnalysisStatus(page: DrawingPage, file: AnalyzedFile) {
  if (file.status === 'failed') return '분석 실패'
  if (page.warnings.some((warning) => /OCR\s*(엔진|기능)|OCR.*(사용 불가|초기화|실행하지 못)/i.test(warning))) return 'OCR 사용 불가'
  const candidates = project.value.heightCandidates.filter((candidate) => candidate.sourceFileName === file.name && candidate.pageNumber === page.pageNumber)
  if (page.kindConfidence !== 'high' || page.warnings.length || candidates.some((candidate) => candidate.status === '확인 필요' || candidate.status === '높이 값 충돌' || candidate.confidence !== 'high')) return '확인 필요'
  if (file.status === 'analyzing') return fileStatusLabel(file)
  return file.status === 'complete' ? '분석 완료' : '분석 대기'
}

function fileAnalysisSummary(file: AnalyzedFile) {
  const candidates = project.value.heightCandidates.filter((candidate) => candidate.sourceFileName === file.name)
  const autoLinked = candidates.filter((candidate) => candidate.relatedWallId && candidate.status === '벽체 연결 완료' && !project.value.dimensions.find((dimension) => dimension.id === candidate.candidateId)?.heightReviewAction)
  const reviewCount = candidates.filter((candidate) => candidate.status === '확인 필요' || candidate.status === '높이 값 충돌' || candidate.confidence !== 'high').length
  const pageWallIds = new Set(project.value.walls.filter((wall) => wall.evidence.some((evidence) => evidence.fileId === file.id)).map((wall) => wall.id))
  const modelWallIds = new Set(project.value.model.walls.map((wall) => wall.wallId))
  const takeoffWallIds = new Set(project.value.takeoffs.filter((takeoff) => takeoff.sourceReferences?.some((evidence) => evidence.fileId === file.id)).map((takeoff) => takeoff.wallId))
  const ocrUnavailable = file.warnings.some((warning) => /OCR\s*(엔진|기능)|OCR.*(사용 불가|초기화|실행하지 못)/i.test(warning)) || file.pages.some((page) => page.warnings.some((warning) => /OCR\s*(엔진|기능)|OCR.*(사용 불가|초기화|실행하지 못)/i.test(warning)))
  const ocrExecuted = file.pages.some((page) => page.dimensions.some((dimension) => dimension.sourceType === 'ocr') || page.processingNotes?.some((note) => /OCR/i.test(note)))
  return {
    pages: file.pages.length,
    textCount: file.pages.reduce((total, page) => total + page.text.length, 0),
    heightCandidates: candidates.length,
    autoLinked: autoLinked.length,
    reviewCount,
    ocr: ocrUnavailable ? '사용 불가' : ocrExecuted ? '실행됨' : file.extension === 'pdf' ? '필요 없음 · PDF 글자' : '결과 없음',
    can3d: file.kind !== 'cost-summary' && [...pageWallIds].some((wallId) => modelWallIds.has(wallId)),
    canMaterial: [...pageWallIds].some((wallId) => takeoffWallIds.has(wallId)),
  }
}

function pageAnalysisSummary(file: AnalyzedFile, page: DrawingPage) {
  const candidates = project.value.heightCandidates.filter((candidate) => candidate.sourceFileName === file.name && candidate.pageNumber === page.pageNumber)
  const wallIds = new Set(project.value.walls.filter((wall) => wall.evidence.some((evidence) => evidence.fileId === file.id && evidence.pageNumber === page.pageNumber)).map((wall) => wall.id))
  const modelWallIds = new Set(project.value.model.walls.map((wall) => wall.wallId))
  const takeoffWallIds = new Set(project.value.takeoffs.filter((takeoff) => takeoff.sourceReferences?.some((evidence) => evidence.fileId === file.id && evidence.pageNumber === page.pageNumber)).map((takeoff) => takeoff.wallId))
  return {
    candidateCount: candidates.length,
    linkedCount: candidates.filter((candidate) => candidate.relatedWallId).length,
    reviewCount: candidates.filter((candidate) => candidate.status === '확인 필요' || candidate.status === '높이 값 충돌' || candidate.confidence !== 'high').length,
    can3d: [...wallIds].some((wallId) => modelWallIds.has(wallId)),
    canMaterial: [...wallIds].some((wallId) => takeoffWallIds.has(wallId)),
  }
}

function takeoffStatusClass(status: string) {
  if (status === '확정') return 'confirmed'
  if (status === '검토 필요') return 'needs-review'
  return 'missing-height'
}

function openFilePreview(file: AnalyzedFile) {
  const page = file.pages[0]
  if (page) selectedPageId.value = page.id
  scrollToSection('analysis')
}

function evidenceForWall(wallId: string) {
  const wall = project.value.walls.find((item) => item.id === wallId)
  const evidence = wall?.evidence[0]
  if (!evidence) return '도면 근거 미확인'
  return `${evidence.fileName} · ${DRAWING_KIND_LABELS[evidence.drawingKind]} · ${evidence.pageNumber}페이지`
}

function markerStyle(dimension: DimensionValue) {
  const evidence = dimension.evidence.find((item) => item.pageNumber === currentPage.value?.pageNumber)
  const style = evidenceMarkerStyle(evidence?.location, CONFIDENCE_COLORS[dimension.confidence])
  if (selectedHeightCandidateId.value === dimension.id) {
    return {
      ...style,
      borderColor: '#c44c5c',
      color: '#c44c5c',
      zIndex: 4,
      boxShadow: '0 0 0 5px rgba(196, 76, 92, 0.22)',
    }
  }
  return style
}

function evidenceMarkerStyle(location: DrawingPage['dimensions'][number]['evidence'][number]['location'], color: string) {
  return {
    left: `${(location?.x || 0.5) * 100}%`,
    top: `${(location?.y || 0.5) * 100}%`,
    borderColor: color,
    color,
  }
}

function clickPage(page: DrawingPage) {
  selectedPageId.value = page.id
}

watch(() => project.value.settings, (settings) => {
  syncSettingsDraft(settings)
}, { deep: true })

onMounted(() => {
  const stored = loadProject()
  if (stored) {
    project.value = stored
    syncSettingsDraft(stored.settings)
    recompute()
    setNotice('새로고침으로 저장된 프로젝트를 복원했습니다. 원본 파일은 재분석을 위해 다시 올려야 합니다.')
  }
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="topbar__inner">
        <button type="button" class="brand" aria-label="도면 산출 홈" @click="scrollToSection('upload')">
          <span class="brand-mark"><span /><span /><span /></span>
          <span class="brand-text">
            <strong>설계 자재 계산기</strong>
            <small>도면으로 발주 수량 계산</small>
          </span>
        </button>
        <div class="topbar-actions">
          <span class="local-badge"><i /> 이 컴퓨터에서 안전하게 분석</span>
          <button type="button" class="new-project-button" @click="resetProject">새 프로젝트</button>
        </div>
      </div>
    </header>

    <div v-if="notice" class="notice-toast" role="status">{{ notice }}</div>

    <main class="workspace">
      <aside class="sidebar">
        <div class="project-chip">
          <span class="project-chip__dot" />
          <div>
            <small>현재 프로젝트</small>
            <strong>{{ project.name }}</strong>
          </div>
        </div>
        <div class="project-status-card" :class="`status-${project.status}`" aria-live="polite">
          <small>현재 상태</small>
          <strong>{{ projectStatusLabel }}</strong>
          <p>{{ projectStatusDescription }}</p>
        </div>
        <nav class="step-nav" aria-label="프로젝트 단계">
          <button type="button" :class="{ active: activeSection === 'upload' }" @click="scrollToSection('upload')">
            <span class="step-number">01</span><span><b>도면 업로드</b><small>파일을 모아 분석</small></span>
          </button>
          <button type="button" :class="{ active: activeSection === 'analysis' }" :disabled="!workflowStepEnabled('analysis')" @click="scrollToSection('analysis')">
            <span class="step-number">02</span><span><b>자동 분석 결과</b><small>치수·근거·검토</small></span>
          </button>
          <button type="button" :class="{ active: activeSection === 'model' }" :disabled="!workflowStepEnabled('model')" @click="scrollToSection('model')">
            <span class="step-number">03</span><span><b>3차원 모델</b><small>벽체를 눌러 확인</small></span>
          </button>
          <button type="button" :class="{ active: activeSection === 'takeoff' }" :disabled="!workflowStepEnabled('takeoff')" @click="scrollToSection('takeoff')">
            <span class="step-number">04</span><span><b>발주 산출표</b><small>기준 입력·내보내기</small></span>
          </button>
          <button type="button" :class="{ active: activeSection === 'optimization' }" :disabled="!workflowStepEnabled('optimization')" @click="scrollToSection('optimization')">
            <span class="step-number">05</span><span><b>절단 최적화</b><small>자투리·비용 비교</small></span>
          </button>
        </nav>
        <div class="sidebar-footnote">
          <span class="shield-icon">✓</span>
          <p>파일은 이 브라우저에서 처리됩니다.<br>외부 전송 없이 분석 근거를 저장합니다.</p>
        </div>
      </aside>

      <div class="content-column">
        <section class="workflow-progress" aria-labelledby="workflow-title">
          <div class="workflow-progress__header">
            <div><span class="panel-kicker">작업 순서</span><strong id="workflow-title">{{ projectStatusLabel }}</strong></div>
            <span>{{ Math.min(workflowSteps.length, workflowProgressIndex + 1) }}단계 / {{ workflowSteps.length }}단계</span>
          </div>
          <ol class="workflow-progress__steps">
            <li v-for="(step, index) in workflowSteps" :key="step.id" :class="workflowStepClass(index)">
              <span>{{ String(index + 1).padStart(2, '0') }}</span><small>{{ step.label }}</small>
            </li>
          </ol>
          <p class="workflow-progress__message">{{ projectStatusDescription }}</p>
        </section>
        <section v-if="activeSection === 'upload'" id="upload" class="hero-section">
          <div class="hero-copy">
            <p class="eyebrow">첫 단계 · 도면 올리기</p>
            <h1>도면을 올리면<br><em>발주 수량의 근거</em>가 쌓입니다.</h1>
            <p class="hero-description">치수와 높이를 도면에서 읽고, 벽체별 개구부를 차감해 자재 산출용 모델과 발주표로 연결합니다.</p>
          </div>
          <div class="hero-stat-row" aria-label="프로젝트 현황">
            <div><strong>{{ project.files.length }}</strong><span>파일</span></div>
            <div><strong>{{ allPages.length }}</strong><span>페이지</span></div>
            <div><strong>{{ project.walls.length }}</strong><span>벽체 후보</span></div>
          </div>

          <div
            class="drop-zone"
            :class="{ dragging: isDragging }"
            role="button"
            tabindex="0"
            aria-label="도면 파일 드래그 앤 드롭 또는 파일 선택"
            @dragenter.prevent="isDragging = true"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
            @click="triggerFileInput"
            @keydown.enter.prevent="triggerFileInput"
            @keydown.space.prevent="triggerFileInput"
          >
            <input ref="fileInput" class="visually-hidden" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" @change="handleInput">
            <div class="drop-icon" aria-hidden="true"><span class="upload-arrow">↑</span><span class="upload-tray" /></div>
            <div class="drop-copy">
              <strong>{{ isDragging ? '여기에 놓으세요' : '설계도 파일을 여기에 놓으세요' }}</strong>
              <span>또는 <u>파일 선택</u> · 여러 파일 동시 업로드</span>
            </div>
            <div class="file-pills" aria-label="지원 파일 형식">
              <span>PDF 문서</span><span>JPG 사진</span><span>PNG 사진</span>
              <small>여러 페이지 PDF 지원</small>
            </div>
          </div>
          <div class="upload-guidance"><span class="lightbulb">✦</span><span><b>평면도·입면도·단면도를 함께 올리면</b> 높이와 3차원 모델 정확도가 올라갑니다.</span><small class="future-format-note">캐드 도면(DWG·DXF)·건물 모델(IFC) 연결 구조 준비 · 현재 자동 분석 불가</small></div>

          <div v-if="project.files.length" class="file-list" aria-live="polite">
            <div class="file-list-heading"><span>올린 파일 <b>{{ project.files.length }}개</b></span><button type="button" class="text-button" @click="showFileList = !showFileList">{{ showFileList ? '파일 목록 닫기' : '파일 목록 자세히 보기' }}</button><span class="analysis-pulse" :class="{ active: isAnalyzing }"><i /> {{ isAnalyzing ? '분석 진행 중' : '분석 상태 확인' }}</span></div>
            <p v-if="!showFileList" class="file-list-summary">파일 {{ project.files.length }}개를 올렸습니다. 분석 결과를 확인하려면 아래 버튼을 누르세요.</p>
            <div v-if="showFileList">
              <article v-for="file in project.files" :key="file.id" class="file-card">
                <div class="file-type-icon" :class="`file-${file.extension}`">{{ fileTypeLabel(file.extension).split(' ')[0] }}</div>
                  <div class="file-info">
                    <div class="file-name-row"><strong>{{ file.name }}</strong><span :class="['status-chip', fileStatusClass(file)]"><i /> {{ fileStatusLabel(file) }}</span></div>
                    <div class="file-meta"><span>{{ fileTypeLabel(file.extension) }}</span><span>{{ formatFileSize(file.size) }}</span><span v-if="file.pages.length">{{ file.pages.length }}페이지</span><span v-if="file.pages.length">{{ DRAWING_KIND_LABELS[file.kind] }}</span></div>
                    <div class="file-analysis-facts" aria-label="파일별 분석 요약">
                      <span>페이지 <b>{{ fileAnalysisSummary(file).pages }}</b></span>
                      <span>OCR <b>{{ fileAnalysisSummary(file).ocr }}</b></span>
                      <span>추출 문자 <b>{{ fileAnalysisSummary(file).textCount.toLocaleString('ko-KR') }}</b></span>
                      <span>높이 후보 <b>{{ fileAnalysisSummary(file).heightCandidates }}</b></span>
                      <span>자동 연결 <b>{{ fileAnalysisSummary(file).autoLinked }}</b></span>
                      <span>확인 필요 <b>{{ fileAnalysisSummary(file).reviewCount }}</b></span>
                      <span>3D <b>{{ fileAnalysisSummary(file).can3d ? '가능' : file.kind === 'cost-summary' ? '사용 안 함' : '확인 필요' }}</b></span>
                      <span>자재 계산 <b>{{ fileAnalysisSummary(file).canMaterial ? '가능' : file.kind === 'cost-summary' ? '사용 안 함' : '확인 필요' }}</b></span>
                    </div>
                    <div v-if="file.status === 'analyzing'" class="progress-track"><span :style="{ width: `${file.progress}%` }" /></div>
                    <div class="analysis-stage-line" :class="`stage-${file.stage}`"><span class="stage-pip" />{{ fileStatusLabel(file) }}</div>
                    <p v-if="file.error" class="file-error">{{ file.error }}</p>
                    <p v-else-if="file.warnings.length" class="file-warning">{{ file.warnings[0] }}</p>
                    <details v-if="file.pages.length" class="file-pages-details">
                      <summary><b>페이지별 분석 상태 보기</b><span>{{ file.pages.length }}페이지</span></summary>
                      <div class="file-page-status-list">
                        <article v-for="page in file.pages" :key="page.id" class="file-page-status">
                          <div><strong>{{ page.pageNumber }}페이지 · {{ DRAWING_KIND_LABELS[page.kind] }}</strong><span :class="['page-status-label', pageAnalysisStatus(page, file) === '분석 완료' ? 'is-complete' : 'is-review']">{{ pageAnalysisStatus(page, file) }}</span></div>
                          <small>OCR {{ pageOcrStatus(page) }} · 추출 문자 {{ page.text.length.toLocaleString('ko-KR') }}자 · 치수 {{ page.dimensions.length }}개</small>
                          <small>높이 후보 {{ pageAnalysisSummary(file, page).candidateCount }}개 · 자동 연결 {{ pageAnalysisSummary(file, page).linkedCount }}개 · 확인 필요 {{ pageAnalysisSummary(file, page).reviewCount }}개</small>
                          <small>3D {{ pageAnalysisSummary(file, page).can3d ? '생성 가능' : file.kind === 'cost-summary' ? '사용 안 함' : '확인 필요' }} · 자재 계산 {{ pageAnalysisSummary(file, page).canMaterial ? '가능' : file.kind === 'cost-summary' ? '사용 안 함' : '확인 필요' }}</small>
                          <button type="button" class="text-button" @click="clickPage(page)">원본 페이지 열기</button>
                        </article>
                      </div>
                    </details>
                  </div>
                <div class="file-actions">
                  <button v-if="file.pages.length" type="button" class="text-button" @click="openFilePreview(file)">미리보기</button>
                  <button v-if="file.canReanalyze" type="button" class="icon-button" title="다시 분석" aria-label="다시 분석" @click="reanalyze(file.id)">↻</button>
                  <button type="button" class="icon-button danger" title="파일 삭제" aria-label="파일 삭제" @click="removeFile(file.id)">×</button>
                </div>
              </article>
            </div>
            <div class="upload-next-card">
              <div><strong>도면 분석 결과를 확인할 차례입니다.</strong><p>파일 종류, 치수, 높이, 벽체 연결 결과를 큰 화면으로 확인할 수 있습니다.</p></div>
              <button type="button" class="primary-button" :disabled="isAnalyzing" @click="scrollToSection('analysis')">분석 결과 보기</button>
            </div>
          </div>
        </section>

        <template v-if="project.files.length">
          <section v-if="activeSection === 'analysis'" id="analysis" class="section-block">
              <div class="section-heading">
              <div><p class="eyebrow">둘째 단계 · 도면 분석</p><h2>자동 분석 결과</h2><p>파일 종류와 원본 위치를 보존한 채, 계산에 사용되는 값만 다음 단계로 넘깁니다.</p></div><span class="actual-result-badge">실제 파일 분석 결과</span>
              <div class="section-heading-actions"><span class="source-count">{{ supportedFiles.length }}개 분석 결과</span><span v-if="lowerConfidenceCount" class="low-count">{{ lowerConfidenceCount }}건 검토 필요</span></div>
            </div>

            <button type="button" class="back-button" @click="scrollToSection('upload')">← 파일 올리기 화면으로</button>

            <div class="summary-grid">
              <div class="summary-card accent-card"><span>건물 이름</span><strong>{{ project.buildingName }}</strong><small>파일명·도면 제목에서 추출</small></div>
              <div class="summary-card"><span>도면 종류</span><strong>{{ [...new Set(project.files.map((file) => DRAWING_KIND_LABELS[file.kind]))].join(' · ') || '—' }}</strong><small>페이지별 분류 저장</small></div>
              <div class="summary-card"><span>층 수</span><strong>{{ floorCount ? `${floorCount}층` : '정보 없음' }}</strong><small>{{ floorCount ? '도면 표기에서 확인' : '층 표기 미확인' }}</small></div>
              <div class="summary-card"><span>높이 근거</span><strong>{{ heightDimensions.length ? `${heightDimensions.length}개 후보` : '높이 정보 없음' }}</strong><small>{{ heightDimensions.length ? '입면·단면 우선 연결' : '입면도 또는 단면도 필요' }}</small></div>
            </div>

            <section class="height-diagnostic-panel panel-card" aria-labelledby="height-diagnostic-title">
              <div class="panel-heading"><div><span class="panel-kicker">높이 추적 로그</span><h3 id="height-diagnostic-title">높이 정보가 3차원 모델까지 전달됐는지 확인</h3></div><span :class="['height-diagnostic-overall', `height-overall-${project.heightDiagnostics.overallStatus}`]">{{ heightDiagnosticStatusLabel(project.heightDiagnostics.overallStatus) }}</span></div>
              <p class="height-diagnostic-message">{{ project.heightDiagnostics.message }}</p>
              <p class="height-diagnostic-current">현재 단계: <b>{{ HEIGHT_DIAGNOSTIC_STAGE_LABELS[project.heightDiagnostics.currentStage] }}</b></p>
              <ol class="height-pipeline" aria-label="높이 처리 단계">
                <li v-for="(stage, index) in project.heightDiagnostics.stages" :key="stage.id" :class="heightStageClass(stage.status)">
                  <span class="height-pipeline-number">{{ index + 1 }}</span>
                  <div><strong>{{ HEIGHT_DIAGNOSTIC_STAGE_LABELS[stage.id] }}</strong><small>{{ stage.message }}</small><em v-if="stage.cause">{{ heightDiagnosticCauseLabel(stage.cause) }}</em></div>
                  <b>{{ heightDiagnosticStatusLabel(stage.status) }}</b>
                </li>
              </ol>
              <div v-if="project.heightDiagnostics.floorPlanOnly" class="height-plane-guidance">현재 파일에서 평면 치수는 확인했지만 벽체 높이를 확인할 수 없습니다. 입면도·단면도·층고표를 추가해 주세요.</div>
              <details class="height-entry-details" :open="project.heightDiagnostics.entries.length <= 3">
                <summary><span><b>높이 후보·벽체별 세부 로그</b><small>추출값·단위·원본 위치·연결 벽체를 눌러 확인하세요.</small></span><strong>{{ project.heightCandidates.length }}건</strong></summary>
                <div v-if="project.heightDiagnostics.entries.length" class="height-entry-list">
                  <details v-for="entry in project.heightDiagnostics.entries" :key="entry.id" class="height-entry" :class="`height-entry--${entry.status}`">
                    <summary @click="entry.dimensionId && selectHeightCandidate(entry.dimensionId)"><span><b>{{ entry.zone || '구역 미확인' }} / {{ entry.linkedWallNumber || '높이 후보' }}</b><small>{{ entry.normalizedValueMm === null ? entry.displayValue : `높이 ${heightDiagnosticValue(entry.normalizedValueMm)}mm` }}</small></span><em>{{ heightDiagnosticStatusLabel(entry.status) }}</em></summary>
                    <div v-if="entry.dimensionId && heightCandidateForEntry(entry.dimensionId)" class="height-entry-jump-row">
                      <button type="button" class="outline-button height-candidate-jump" @click="selectHeightCandidate(entry.dimensionId)">원본 도면 위치 보기</button>
                      <span>후보를 누르면 해당 파일·페이지와 위치 표시가 선택됩니다.</span>
                    </div>
                    <div class="height-entry-grid">
                      <div><span>추출된 높이</span><b>{{ entry.extractedValue === null ? '—' : heightDiagnosticValue(entry.extractedValue) }}</b></div>
                      <div><span>단위</span><b>{{ entry.unit || '확인 필요' }}</b></div>
                      <div><span>정규화된 높이</span><b>{{ entry.normalizedValueMm === null ? 'null · 변환 확인 필요' : `${heightDiagnosticValue(entry.normalizedValueMm)}mm` }}</b></div>
                      <div><span>신뢰도</span><b :class="['confidence-text', entry.confidence]">{{ CONFIDENCE_LABELS[entry.confidence] }}</b></div>
                      <div><span>원본 파일·페이지</span><b>{{ entry.sourceFile || '원본 미확인' }} · {{ entry.pageNumber ? `${entry.pageNumber}페이지` : '페이지 미확인' }}</b></div>
                      <div><span>도면 종류·추출 방식</span><b>{{ entry.drawingType }} · {{ entry.sourceType || '확인 필요' }}</b></div>
                      <div><span>높이 후보 원천</span><b>{{ heightCandidateSourceTypeLabel(entry.candidateSourceType) }}</b></div>
                      <div><span>원래 인식된 문자열</span><b>{{ entry.originalText || entry.displayValue || '근거 없음' }}</b></div>
                      <div><span>인쇄·손글씨 판정</span><b>{{ heightPrintStatusLabel(entry.candidateSourceType) }}</b></div>
                      <div><span>연결된 벽체·구역</span><b>{{ entry.linkedWallNumber ? `${entry.zone} / ${entry.linkedWallNumber}` : '높이 미연결' }}</b></div>
                      <div><span>도면 위치</span><b>{{ heightDiagnosticPosition(entry.sourcePosition) }}</b></div>
                      <div v-if="entry.upperLevelMm !== null && entry.upperLevelMm !== undefined || entry.lowerLevelMm !== null && entry.lowerLevelMm !== undefined" class="height-level-facts"><span>레벨 계산 근거</span><b>상부 {{ heightDiagnosticValue(entry.upperLevelMm ?? null) }}mm − 하부 {{ heightDiagnosticValue(entry.lowerLevelMm ?? null) }}mm</b><small>{{ entry.calculation || '계산식 확인 필요' }} · 기준면 {{ entry.referencePlane || '미확인' }}</small></div>
                      <div class="height-entry-evidence"><span>근거 문장·이미지 좌표</span><p>{{ entry.evidenceText || '근거 문장 없음' }}</p></div>
                      <div v-if="entry.evidenceImage" class="height-entry-image"><span>근거 이미지 확대</span><img :src="entry.evidenceImage" alt="높이 숫자 근거 확대 이미지"></div>
                    </div>
                    <p class="height-entry-message">{{ entry.message }}<span v-if="entry.cause"> · {{ heightDiagnosticCauseLabel(entry.cause) }}</span></p>
                    <div v-if="entry.dimensionId && entry.candidateSourceType !== 'LEVEL_CALCULATION' && heightCandidateForEntry(entry.dimensionId)" class="height-review-actions">
                      <div class="height-review-form-grid">
                        <label>사람이 확인할 높이(mm)<input v-model="heightReviewDrafts[entry.dimensionId].valueMm" type="number" min="1" step="1" :aria-label="`${entry.zone || '높이 후보'} 확인 높이(mm)`"></label>
                        <label>수정·확인 이유<input v-model="heightReviewDrafts[entry.dimensionId].reason" type="text" placeholder="예: 입면도 원본 치수와 대조"></label>
                        <label>연결 구역<select v-model="heightReviewDrafts[entry.dimensionId].zone"><option value="">구역 선택</option><option v-for="zone in [...new Set(project.walls.map((wall) => wall.zone))]" :key="zone" :value="zone">{{ zone }}</option></select></label>
                        <label>연결 벽체<select v-model="heightReviewDrafts[entry.dimensionId].wallNumber"><option value="">벽체 선택</option><option v-for="wall in project.walls" :key="wall.id" :value="wall.wallNumber">{{ wall.zone }} · {{ wall.wallNumber }}</option></select></label>
                      </div>
                      <div class="height-review-button-row">
                        <button type="button" class="primary-button" @click="reviewHeightCandidate(entry.dimensionId, 'approved')">승인</button>
                        <button type="button" class="outline-button" @click="reviewHeightCandidate(entry.dimensionId, 'edited')">값 수정 후 승인</button>
                        <button type="button" class="outline-button" @click="reviewHeightCandidate(entry.dimensionId, 'linked')">벽체·구역 연결</button>
                        <button type="button" class="text-button" @click="reviewHeightCandidate(entry.dimensionId, 'needs-review')">확인 필요로 유지</button>
                        <button type="button" class="text-button danger-text" @click="reviewHeightCandidate(entry.dimensionId, 'excluded')">후보 제외</button>
                        <button type="button" class="text-button danger-text" @click="reviewHeightCandidate(entry.dimensionId, 'marked-handwriting')">손글씨로 표시</button>
                      </div>
                      <div v-if="heightReviewDrafts[entry.dimensionId].reason || project.dimensions.find((dimension) => dimension.id === entry.dimensionId)?.heightReview" class="height-review-audit">
                        <span v-if="project.dimensions.find((dimension) => dimension.id === entry.dimensionId)?.heightReview">최근 처리: {{ heightReviewActionLabel(project.dimensions.find((dimension) => dimension.id === entry.dimensionId)?.heightReview?.action || 'needs-review') }} · {{ project.dimensions.find((dimension) => dimension.id === entry.dimensionId)?.heightReview?.reviewedBy }} · {{ project.dimensions.find((dimension) => dimension.id === entry.dimensionId)?.heightReview?.reviewedAt }}</span>
                        <span v-if="project.dimensions.find((dimension) => dimension.id === entry.dimensionId)?.heightReview">변경 전 {{ project.dimensions.find((dimension) => dimension.id === entry.dimensionId)?.heightReview?.beforeValueMm ?? '없음' }}mm → 변경 후 {{ project.dimensions.find((dimension) => dimension.id === entry.dimensionId)?.heightReview?.afterValueMm ?? '없음' }}mm · 재계산 {{ project.dimensions.find((dimension) => dimension.id === entry.dimensionId)?.heightReview?.recalculatedAt ? '완료' : '대기' }}</span>
                      </div>
                    </div>
                  </details>
                </div>
                <div v-else class="height-entry-empty">추출된 높이 후보가 없습니다. 평면도만 있거나 OCR/PDF 텍스트에서 높이 숫자를 읽지 못했을 수 있습니다.</div>
              </details>
              <details v-if="heightReviewEntries.length" class="height-review-details">
                <summary><span><b>확인 필요한 높이만 보기</b><small>연결 실패·충돌·레벨만 확인·손글씨·OCR 문제</small></span><strong>{{ heightReviewEntries.length }}건</strong></summary>
                <ul class="height-review-list"><li v-for="entry in heightReviewEntries" :key="`review-${entry.id}`"><b>{{ entry.zone || '구역 미확인' }} / {{ entry.linkedWallNumber || '벽체 미연결' }}</b><span>{{ entry.message }}</span><small>{{ entry.sourceFile || '원본 미확인' }} · {{ entry.pageNumber ? `${entry.pageNumber}페이지` : '페이지 미확인' }} · {{ heightDiagnosticPosition(entry.sourcePosition) }}</small></li></ul>
              </details>
            </section>

            <div class="analysis-layout">
              <div class="source-panel panel-card">
                <div class="panel-heading"><div><span class="panel-kicker">원본 확인</span><h3>원본 도면 근거</h3></div><span v-if="currentPage" class="page-badge">{{ currentPage.pageNumber }} / {{ allPages.length }} 페이지</span></div>
                <div v-if="currentPage" class="drawing-preview">
                  <template v-if="currentPage.previewUrl">
                    <img :src="currentPage.previewUrl" :alt="`${currentPage.pageNumber}페이지 도면 미리보기`">
                    <div v-for="dimension in selectedPageMarkers" :key="dimension.id" :class="['drawing-marker', { selected: selectedHeightCandidateId === dimension.id }]" :style="markerStyle(dimension)" :title="`${dimension.displayValue} · ${CONFIDENCE_LABELS[dimension.confidence]}`">
                      <span>{{ dimension.displayValue }}</span>
                    </div>
                    <div v-for="wall in selectedPageWalls" :key="`wall-marker-${wall.id}`" class="drawing-wall-marker" :style="evidenceMarkerStyle(wall.evidence[0]?.location, wall.color)" :title="`${wall.zone} · ${wall.number}`">
                      <span>{{ wall.number }}</span>
                    </div>
                    <div v-for="item in selectedPageOpenings" :key="`opening-marker-${item.opening.id}`" class="drawing-opening-marker" :style="evidenceMarkerStyle(item.opening.evidence[0]?.location, item.opening.type === 'window' ? '#3f91a7' : '#4a5a54')" :title="`${item.opening.type === 'window' ? '창호' : '문'} · ${item.opening.label}`">
                      <span>{{ item.opening.type === 'window' ? '창' : '문' }}</span>
                    </div>
                  </template>
                  <div v-else class="preview-empty">새로고침 복원 결과입니다. 원본 파일을 다시 올리면 미리보기와 재분석을 복구합니다.</div>
                  <div v-if="currentPage.previewUrl" class="preview-legend"><span><i class="legend-wall" /> 추출 치수</span><span><i class="legend-low" /> 검토 필요</span></div>
                </div>
                <div v-else class="preview-empty">분석 완료된 페이지 미리보기가 없습니다.</div>
                <div v-if="allPages.length > 1" class="page-strip" aria-label="원본 페이지 선택">
                  <button v-for="page in allPages" :key="page.id" type="button" :class="{ active: currentPage?.id === page.id }" @click="clickPage(page)">{{ page.pageNumber }}페이지 · {{ DRAWING_KIND_LABELS[page.kind] }}</button>
                </div>
                <div v-if="currentPage" class="source-details">
                  <span class="kind-tag">{{ DRAWING_KIND_LABELS[currentPage.kind] }}</span>
                  <span>{{ currentPage.kindConfidence === 'high' ? '분류 신뢰도 높음' : '분류 검토 필요' }}</span>
                  <span>{{ currentPage.dimensions.length }}개 숫자 추출</span>
                  <span v-if="currentPage.handwritingStatus === 'handwriting'">손글씨 표기 감지 · 자동 계산 제외</span>
                  <span v-else-if="currentPage.handwritingStatus === 'uncertain'">인쇄·손글씨 구분 불확실</span>
                </div>
                <div v-if="currentPage" class="metadata-grid" aria-label="도면 메타데이터 추출 결과">
                  <div><small>구역명</small><b>{{ currentPage.zones.map((item) => item.value).join(', ') || '미확인' }}</b></div>
                  <div><small>방 이름</small><b>{{ currentPage.roomNames.map((item) => item.value).join(', ') || '미확인' }}</b></div>
                  <div><small>축 번호</small><b>{{ currentPage.axisLabels.map((item) => item.value).join(', ') || '미확인' }}</b></div>
                  <div><small>축척 · 단위</small><b>{{ currentPage.scales.map((item) => item.ratio).join(', ') || '미확인' }} · {{ currentPage.unitCandidates.join(', ') || '미확인' }}</b></div>
                  <div><small>도면 선분</small><b>{{ currentPage.vectorSegments.length ? `${currentPage.vectorSegments.length}개` : '미확인' }}</b></div>
                  <div v-if="currentPage.processingNotes?.length"><small>이미지·PDF 처리</small><b>{{ currentPage.processingNotes.join(' · ') }}</b></div>
                </div>
              </div>

              <div class="extracted-panel panel-card">
                <div class="panel-heading"><div><span class="panel-kicker">숫자 확인</span><h3>추출된 치수</h3></div><span class="confidence-key"><i class="high-dot" /> 높음 <i class="medium-dot" /> 중간 <i class="low-dot" /> 낮음</span></div>
                <div v-if="activeDimensions.length" class="dimension-list">
                  <div v-for="dimension in activeDimensions" :key="dimension.id" class="dimension-row">
                    <div class="dimension-label"><span class="confidence-dot" :style="{ backgroundColor: CONFIDENCE_COLORS[dimension.confidence] }" /><strong>{{ dimension.label }}</strong><small>{{ dimension.context || '원본 텍스트에서 숫자 추출' }}</small></div>
                    <div class="dimension-value"><b>{{ dimension.displayValue }}</b><span>{{ dimension.unit }}</span></div>
                    <div class="dimension-source"><span>{{ dimension.sourceFile || dimension.evidence[0]?.fileName || '—' }}</span><small>{{ dimension.pageNumber || dimension.evidence[0]?.pageNumber || '—' }}페이지 · {{ sourceTypeLabel(dimension.sourceType) }} · {{ dimension.source === 'user' ? `사용자 확인값 · 원래 ${dimension.originalValueMm ?? '—'}mm` : `위치 ${(dimension.sourcePosition.x * 100).toFixed(0)}%, ${(dimension.sourcePosition.y * 100).toFixed(0)}%` }}</small></div>
                  </div>
                </div>
                <div v-else class="empty-state small"><span>∅</span><p>아직 숫자 치수를 읽지 못했습니다.<br>원본 해상도와 치수 텍스트를 확인하세요.</p></div>
                <button v-if="project.dimensions.length > 10" type="button" class="show-more-button" @click="showAllDimensions = !showAllDimensions">{{ showAllDimensions ? '간략히 보기' : `전체 치수 ${project.dimensions.length}개 보기` }} <span>{{ showAllDimensions ? '↑' : '↓' }}</span></button>
              </div>
            </div>

            <div class="wall-overview panel-card">
              <div class="panel-heading"><div><span class="panel-kicker">벽체 확인</span><h3>벽체·구역 연결 결과</h3></div><span class="subtle-note">높이는 같은 도면 → 입면도 → 단면도 순서로 확인</span></div>
              <div v-if="project.walls.length" class="table-scroll"><table class="data-table wall-table"><thead><tr><th>구역</th><th>벽체</th><th>길이</th><th>높이</th><th>개구부</th><th>신뢰도</th><th>검토</th></tr></thead><tbody><tr v-for="wall in project.walls" :key="wall.id" :class="{ selected: selectedWallId === wall.id }" @click="selectWall(wall.id)"><td><span class="zone-color" :style="{ backgroundColor: wall.color }" />{{ wall.zone }}</td><td><b>{{ wall.number }}</b></td><td>{{ formatMm(wall.lengthMm) }}</td><td><span :class="{ 'missing-value': wall.heightMm === null }">{{ formatMm(wall.heightMm) }}</span></td><td>{{ wall.openings.length ? `${wall.openings.length}개` : '없음' }}</td><td><span :class="['confidence-text', wall.confidence]">{{ CONFIDENCE_LABELS[wall.confidence] }}</span></td><td><span :class="['review-pill', wall.reviewStatus]">{{ wall.conflicts?.length ? '치수 충돌' : wall.reviewStatus === 'verified' ? '자동 반영' : wall.reviewStatus === 'review' ? '검토' : '차단' }}</span></td></tr></tbody></table></div>
              <div v-else class="missing-callout"><span class="warning-symbol">!</span><div><strong>벽체를 자동 생성할 근거가 아직 부족합니다.</strong><p>평면도의 실제 치수선과 벽체 표기가 읽혀야 하며, 높이는 임의로 입력하지 않습니다.</p></div></div>
            </div>
          </section>

          <ConfidenceReviewPanel v-if="activeSection === 'analysis'" :dimensions="drawingDimensions" @update="updateDimension" />
          <section v-if="activeSection === 'analysis'" class="workflow-action-card review-action" aria-labelledby="review-next-title">
            <div>
              <span class="panel-kicker">다음 단계</span>
              <h3 id="review-next-title">확인했으면 3차원 모델로 이동하세요.</h3>
              <p v-if="reviewBlockers.length">{{ reviewBlockers[0] }}{{ reviewBlockers.length > 1 ? ` 외 ${reviewBlockers.length - 1}건` : '' }}</p>
              <p v-else>현재 확인이 필요한 치수와 높이가 없어 다음 단계로 진행할 수 있습니다.</p>
            </div>
            <button type="button" class="primary-button" :disabled="!canBuild3D" @click="build3DModel">확인 완료 · 3차원 모델 보기</button>
          </section>

          <section v-if="activeSection === 'model'" id="model" class="section-block model-section">
            <div class="section-heading">
              <div><p class="eyebrow">셋째 단계 · 3차원 확인</p><h2>자재 산출용 3차원 모델</h2><p>벽체를 눌러 길이·높이·문과 창호 정보를 확인하세요.</p></div>
              <div class="model-heading-status"><span :class="['model-status', { ready: modelDisplayMode === 'actual' }]" /><strong>{{ modelStatus }}</strong></div>
            </div>
            <div class="model-section-actions">
              <button type="button" class="back-button" @click="scrollToSection(project.files.length ? 'analysis' : 'upload')">← {{ project.files.length ? '분석 결과' : '파일 업로드' }}로 돌아가기</button>
              <button type="button" class="outline-button" @click="toggleTestModel">{{ showTestModel ? '실제 도면 모델로 돌아가기' : '3D 화면 테스트 모델 보기' }}</button>
            </div>
            <div v-if="showTestModel" class="model-notice model-notice--test"><span class="model-notice-icon">!</span><span><b>테스트 모델</b>입니다. 높이 2,800mm·4,200mm 벽체와 문·창문을 렌더링 확인용으로 표시합니다. 실제 발주 수량·비용·저장 결과에는 사용하지 않습니다.</span></div>
            <div v-else class="model-notice"><span class="model-notice-icon">◇</span><span>도면 정보를 기반으로 만든 자재 산출용 개략 3차원 모델입니다. <b>구조검토 및 설계 승인을 대신하지 않습니다.</b><small class="model-roof-note">{{ project.model.partial ? project.model.blockedReason : '' }} 지붕: {{ project.model.partial ? '부분 모델이라 반영하지 않음' : project.model.roof.isReady ? `${project.model.roof.kind === 'flat' ? '평지붕' : '지붕 형태'} 반영` : project.model.roof.blockedReason }}</small></span></div>
            <div class="model-summary-strip" aria-label="3차원 모델 요약">
              <div><strong>{{ modelSummary.totalWalls }}</strong><span>전체 벽체</span></div>
              <div><strong>{{ modelSummary.generatedWalls }}</strong><span>생성된 벽체</span></div>
              <div><strong>{{ modelSummary.heightReviewCount }}</strong><span>높이 확인 필요</span></div>
              <div><strong>{{ modelSummary.openingReviewCount }}</strong><span>개구부 확인 필요</span></div>
              <div><strong>{{ modelSummary.calculatedZones }}</strong><span>자재 계산 가능 구역</span></div>
              <div><strong>{{ modelSummary.usable ? '가능' : showTestModel ? '사용 안 함' : project.workflow.modelBuilt ? '확인 필요' : '계산 전' }}</strong><span>발주 계산 사용</span></div>
            </div>
            <div class="model-layout">
              <div class="viewer-card">
                <Building3DViewer :model="displayModel" :selected-wall-id="showTestModel ? '' : selectedWallId" :mode="modelDisplayMode" :source-label="modelSourceLabel" @select="selectWall" />
                <p v-if="!showTestModel && !project.model.isReady" class="model-blocked-note">{{ project.model.blockedReason }}</p>
              </div>
              <aside id="wall-detail" class="wall-detail panel-card" :class="{ empty: !selectedWall || showTestModel }">
                <template v-if="selectedWall && !showTestModel">
                  <div class="detail-heading"><div><span class="panel-kicker">선택한 벽체</span><h3>{{ selectedWall.zone }} / {{ selectedWall.number }}</h3></div><span class="detail-zone" :style="{ backgroundColor: selectedWall.color }" /></div>
                  <div class="detail-metrics"><div><span>가로 길이</span><b>{{ formatMm(selectedWall.lengthMm) }}</b></div><div><span>높이</span><b>{{ formatMm(selectedWall.heightMm) }}</b></div><div><span>개구부 면적</span><b>{{ project.takeoffs.find((row) => row.wallId === selectedWall.id)?.openingAreaM2.toFixed(2) || '0.00' }}㎡</b></div><div><span>순 벽체 면적</span><b>{{ project.takeoffs.find((row) => row.wallId === selectedWall.id)?.netAreaM2?.toFixed(2) || '—' }}㎡</b></div></div>
                  <dl class="detail-list"><div><dt>판넬</dt><dd>{{ project.takeoffs.find((row) => row.wallId === selectedWall.id)?.panelsWithWaste ?? '—' }}장</dd></div><div><dt>고정 피스</dt><dd>{{ project.takeoffs.find((row) => row.wallId === selectedWall.id)?.fasteners ?? '—' }}개</dd></div><div><dt>실란트</dt><dd>{{ project.takeoffs.find((row) => row.wallId === selectedWall.id)?.sealantCartridges ?? '—' }}본</dd></div><div><dt>코너재 · 마감재</dt><dd>{{ project.takeoffs.find((row) => row.wallId === selectedWall.id)?.cornerPieces ?? '—' }} · {{ project.takeoffs.find((row) => row.wallId === selectedWall.id)?.finishPieces ?? '—' }}본</dd></div><div><dt>자재 계산 상태</dt><dd>{{ project.takeoffs.find((row) => row.wallId === selectedWall.id)?.reviewStatus || '계산 전' }}</dd></div></dl>
                  <div class="detail-evidence"><span>도면 근거</span><p>{{ evidenceForWall(selectedWall.id) }}</p><small>{{ selectedWall.geometrySource === 'drawing-vector' ? '도면 선에서 시작점과 끝점을 만들었습니다.' : '도면 선 좌표가 없어 추출 치수 순서로 개략 배치했습니다.' }}</small><small v-if="selectedWall.conflicts?.length">{{ selectedWall.conflicts.map((conflict) => conflict.reason).join(' · ') }}</small><small v-if="project.takeoffs.find((row) => row.wallId === selectedWall.id)?.formula">계산식: {{ project.takeoffs.find((row) => row.wallId === selectedWall.id)?.formula }}</small></div>
                  <div class="height-source-card"><span>벽체 높이 출처</span><template v-if="heightSourceForWall(selectedWall.id)"><b>{{ formatMm(heightSourceForWall(selectedWall.id)?.valueMm ?? null) }} · {{ heightCandidateSourceTypeLabel(project.heightCandidates.find((candidate) => candidate.candidateId === selectedWall.heightSourceDimensionId)?.sourceType) }}</b><small>{{ heightSourceForWall(selectedWall.id)?.sourceFile }} · {{ heightSourceForWall(selectedWall.id)?.pageNumber }}페이지 · {{ heightSourceForWall(selectedWall.id)?.sourceText }} · 신뢰도 {{ CONFIDENCE_LABELS[heightSourceForWall(selectedWall.id)?.confidence || 'low'] }}</small><small v-if="heightSourceForWall(selectedWall.id)?.handwritingStatus === 'handwriting'">손글씨로 판단되어 자동 계산에서 제외됩니다.</small><small v-else>발주 계산 사용 가능 여부: {{ selectedWall.heightStatus === 'known' && selectedWall.confidence !== 'low' ? '검토 후 가능' : '확인 필요' }}</small></template><b v-else>높이 연결 확인 필요</b></div>
                </template>
                <div v-else-if="showTestModel" class="empty-detail"><span class="cursor-icon">◇</span><strong>테스트 모델 표시 중</strong><p>이 geometry는 3D 조작 확인용이며 실제 발주 계산에는 연결되지 않습니다.</p></div>
                <div v-else class="empty-detail"><span class="cursor-icon">⌖</span><strong>{{ project.model.isReady ? '벽체를 클릭하세요' : '표시할 실제 벽체를 기다리는 중입니다' }}</strong><p>{{ project.model.isReady ? '3차원 모델에서 벽체를 선택하면 길이, 높이, 개구부와 자재 수량을 확인할 수 있습니다.' : project.model.blockedReason }}</p></div>
              </aside>
            </div>
            <div v-if="!showTestModel && !project.model.isReady" class="workflow-gate-card">
              <span class="gate-icon">◇</span>
              <div><strong>{{ project.files.length ? '실제 3차원 모델을 생성할 수 없습니다.' : '설계도를 먼저 업로드하세요.' }}</strong><p>{{ project.files.length ? (reviewBlockers[0] || project.model.blockedReason) : '테스트 모델과 실제 모델은 화면에서 명확히 구분됩니다.' }}</p></div>
              <button v-if="project.files.length && canBuild3D" type="button" class="primary-button" @click="build3DModel">3차원 모델 생성</button>
              <button v-else-if="project.files.length" type="button" class="outline-button" @click="scrollToSection('analysis')">확인할 항목 보기</button>
              <button v-else type="button" class="primary-button" @click="scrollToSection('upload')">도면 업로드</button>
            </div>
            <div v-if="!showTestModel && project.workflow.modelBuilt && !project.workflow.takeoffCalculated" class="workflow-action-card model-action">
              <div><span class="panel-kicker">다음 단계</span><h3>벽체를 확인했으면 자재 계산을 시작하세요.</h3><p>3차원 모델에서 벽체를 눌러 길이·높이·문과 창호를 확인한 뒤 계산합니다.</p></div>
              <button type="button" class="primary-button" :disabled="!canCalculateMaterials" @click="calculateMaterials">벽체별 자재 계산</button>
            </div>
          </section>

          <section v-if="project.files.length && activeSection === 'takeoff'" id="takeoff" class="section-block takeoff-section">
            <div class="section-heading"><div><p class="eyebrow">넷째 단계 · 발주 산출</p><h2>발주 기준과 산출표</h2><p>기준은 프로젝트 전체에서 한 번만 입력하며, 구역별 높이·길이는 도면 근거에서 자동으로 가져옵니다.</p></div><div class="section-heading-actions"><span :class="['orderability-badge', { ready: canDownloadReports }]">{{ canDownloadReports ? '발주 가능' : '발주 가능 판정 대기' }}</span><button type="button" class="outline-button" @click="scrollToSection('analysis')">원본 결과 보기</button><button type="button" class="outline-button" :disabled="!canDownloadReports" @click="downloadCsv(project.takeoffs)">표 파일 내려받기</button><button type="button" class="outline-button" :disabled="!canDownloadReports" @click="printReport(project.name, project.takeoffs, project.settings)">산출표 인쇄</button><button type="button" class="primary-button" :disabled="!canDownloadReports" @click="printReport(project.name, project.takeoffs, project.settings)">인쇄용 산출표</button></div></div>
            <button type="button" class="back-button" @click="scrollToSection('model')">← 3차원 모델로 돌아가기</button>
            <div v-if="!project.workflow.modelBuilt" class="workflow-gate-card takeoff-gate">
              <span class="gate-icon">04</span>
              <div><strong>먼저 3차원 모델을 생성하고 벽체를 검토하세요.</strong><p>도면 근거가 확정된 뒤 프로젝트 공통 자재 기준을 적용할 수 있습니다.</p></div>
            </div>
            <div v-if="project.workflow.modelBuilt" class="takeoff-top-grid">
              <div class="settings-card panel-card">
                <div class="panel-heading"><div><span class="panel-kicker">한 번만 입력</span><h3>판넬·부자재 기준</h3></div><span class="single-input-note">이 프로젝트의 공통 기준</span></div>
                <div class="settings-grid">
                  <label>판넬 유효 폭(mm)<input v-model.number="settingsDraft.panelEffectiveWidthMm" type="number" min="1" @change="updateSettings"></label>
                  <label>판넬 표준 길이(mm)<input v-model.number="settingsDraft.panelStandardLengthMm" type="number" min="1" @change="updateSettings"></label>
                  <label>판넬 두께(mm)<input v-model.number="settingsDraft.panelThicknessMm" type="number" min="1" @change="updateSettings"></label>
                  <label>판넬 시공 방향<select v-model="settingsDraft.panelDirection" @change="updateSettings"><option value="vertical">세로</option><option value="horizontal">가로</option></select></label>
                  <label>판넬 여유율(%)<input v-model.number="settingsDraft.panelWasteRate" type="number" min="0" step="0.5" @change="updateSettings"></label>
                  <label>판넬당 고정 피스<input v-model.number="settingsDraft.fastenersPerPanel" type="number" min="0" @change="updateSettings"></label>
                  <label>실란트 1본당 길이(m)<input v-model.number="settingsDraft.sealantLengthM" type="number" min="0.1" step="0.1" @change="updateSettings"></label>
                  <label>코너재 1본당 길이(m)<input v-model.number="settingsDraft.cornerLengthM" type="number" min="0.1" step="0.1" @change="updateSettings"></label>
                  <label>마감재 1본당 길이(m)<input v-model.number="settingsDraft.finishLengthM" type="number" min="0.1" step="0.1" @change="updateSettings"></label>
                  <label class="checkbox-label"><input v-model="settingsDraft.reuseOffcuts" type="checkbox" @change="updateSettings"><span>절단 잔재 재사용</span></label>
                </div>
                <p class="settings-preview">현재 기준: {{ panelSpec(project.settings) }}</p>
              </div>
              <div class="takeoff-summary-card">
                <span class="panel-kicker">전체 계산 결과</span><strong>{{ summary.netAreaM2.toFixed(2) }}<small>㎡</small></strong><span>계산된 순 벽체 면적</span>
                <div class="takeoff-total-grid"><div><b>{{ summary.panels || '—' }}</b><small>판넬</small></div><div><b>{{ summary.fasteners || '—' }}</b><small>고정 피스</small></div><div><b>{{ summary.sealant || '—' }}</b><small>실란트</small></div><div><b>{{ summary.finish || '—' }}</b><small>마감재</small></div></div>
              </div>
            </div>

            <div v-if="project.workflow.modelBuilt" class="formula-strip"><span>계산 방법</span><p>길이 × 높이 − 문과 창호 → 판넬 배치 → 여유율 → 피스·실란트·코너재·마감재</p><small>전체 면적만 나누지 않고 벽체별 실제 규격을 반영합니다.</small></div>
            <div v-if="project.workflow.takeoffCalculated" class="takeoff-table panel-card">
              <div class="panel-heading"><div><span class="panel-kicker">발주 표</span><h3>벽체별 발주 산출표</h3></div><span class="table-note">{{ project.takeoffs.length }}개 벽체 · {{ project.takeoffs.filter((row) => row.reviewStatus !== '확정').length }}개 검토 대상</span></div>
              <div class="table-scroll"><table class="data-table purchase-table"><thead><tr><th>구역</th><th>벽체 번호</th><th>도면 근거</th><th>가로 길이</th><th>높이</th><th>개구부 면적</th><th>순 벽체 면적</th><th>판넬 규격</th><th>기본</th><th>여유 포함</th><th>고정 피스</th><th>실란트</th><th>코너재</th><th>마감재</th><th>절단 잔재</th><th>신뢰도</th><th>검토 상태</th></tr></thead><tbody><tr v-for="row in project.takeoffs" :key="row.wallId" :class="{ blocked: row.reviewStatus === '높이 정보 없음' }" @click="selectWall(row.wallId)"><td><span class="zone-color" :style="{ backgroundColor: project.walls.find((wall) => wall.id === row.wallId)?.color }" />{{ row.zone }}</td><td><b>{{ row.wallNumber }}</b></td><td class="evidence-cell">{{ row.evidenceLabel }}</td><td>{{ formatMm(row.lengthMm) }}</td><td>{{ formatMm(row.heightMm) }}</td><td>{{ row.openingAreaM2.toFixed(2) }}㎡</td><td>{{ row.netAreaM2 === null ? '—' : `${row.netAreaM2.toFixed(2)}㎡` }}</td><td class="spec-cell">{{ row.panelSpec }}</td><td>{{ row.basePanels ?? '—' }}</td><td><b>{{ row.panelsWithWaste ?? '—' }}</b></td><td>{{ row.fasteners ?? '—' }}</td><td>{{ row.sealantCartridges ?? '—' }}</td><td>{{ row.cornerPieces ?? '—' }}</td><td>{{ row.finishPieces ?? '—' }}</td><td>{{ row.offcutM === null ? '—' : `${row.offcutM.toFixed(2)}미터` }}</td><td><span :class="['confidence-text', row.confidence]">{{ CONFIDENCE_LABELS[row.confidence] }}</span></td><td><span :class="['review-pill', takeoffStatusClass(row.reviewStatus)]">{{ row.reviewStatus }}</span></td></tr><tr v-if="!project.takeoffs.length"><td colspan="17" class="empty-table">높이와 벽체 길이가 확인된 뒤 발주 산출표가 만들어집니다.</td></tr></tbody></table></div>
              <div v-if="project.missingItems.length" class="missing-list"><strong>자동 산출을 막는 확인 항목</strong><span v-for="item in project.missingItems" :key="item">{{ item }}</span></div>
            </div>
            <div v-else-if="project.workflow.modelBuilt" class="workflow-action-card takeoff-action">
              <div><span class="panel-kicker">계산 준비</span><h3>프로젝트 자재 기준을 확인하고 계산하세요.</h3><p>시공 방향·유효 폭·표준 길이·여유율을 확인한 뒤 벽체별 수량을 계산합니다.</p></div>
              <button type="button" class="primary-button" @click="calculateMaterials">자재 수량 계산</button>
            </div>
            <div v-if="project.workflow.takeoffCalculated" class="workflow-action-card optimization-entry-card">
              <div><span class="panel-kicker">다음 단계</span><h3>설계는 그대로 두고 절단·폐기 비용을 비교하세요.</h3><p>자재 카탈로그를 입력하면 원자재 규격, 절단 순서, 현장 내 자투리 사용 여부를 계산합니다.</p></div>
              <button type="button" class="primary-button" @click="scrollToSection('optimization')">절단 최적화 열기</button>
            </div>
          </section>

          <section v-if="activeSection === 'optimization'" id="optimization" class="section-block optimization-section">
            <div class="section-heading">
              <div><p class="eyebrow">다섯째 단계 · 현장 절단 최적화</p><h2>설계는 그대로, 낭비와 비용 비교</h2><p>벽 길이·높이·개구부·구역은 도면 값 그대로 고정하고, 원자재 규격·절단 순서·현재 현장 자투리 사용 순서만 비교합니다.</p></div>
              <div class="section-heading-actions"><span :class="['orderability-badge', { ready: project.optimization.status === 'calculated' }]">{{ optimizationStatusLabel }}</span></div>
            </div>
            <button type="button" class="back-button" @click="scrollToSection('takeoff')">← 발주 산출표로 돌아가기</button>

            <div class="optimization-notice panel-card"><strong>설계 변경 없음</strong><span>도면의 벽체·개구부·구역 형태를 최적화 대상으로 바꾸지 않습니다. 가격·규격·절단폭이 없는 값은 비용 또는 배치 확정에서 제외하고 확인 필요로 표시합니다.</span><small>프로젝트가 끝난 뒤 자투리를 장기 재고로 저장하지 않습니다. 사용처와 사용 시점이 없는 자투리는 폐기·고철·업체 반납 대상으로 분류합니다.</small></div>

            <section class="inventory-mvp-card panel-card">
              <div class="panel-heading inventory-mvp-heading">
                <div><span class="panel-kicker">소규모 현장 MVP · 동일 폭 길이 절단</span><h3>보유 자재 기반 절단 계획</h3><p>직사각형 패널·보드의 폭은 그대로 비교하고, 길이 방향만 한 자재씩 절단합니다. 복잡한 2차원 네스팅이나 도면 수정은 하지 않습니다.</p></div>
                <span :class="['orderability-badge', { ready: inventoryState.status === 'calculated' || inventoryState.status === 'approved' }]">{{ inventoryStatusLabel }}</span>
              </div>

              <div class="inventory-mvp-actions">
                <div><strong>시작 방법</strong><span>도면 부재를 가져오거나 아래 기본 예제로 계산 흐름을 확인하세요.</span></div>
                <div class="inventory-mvp-action-buttons"><button type="button" class="outline-button" @click="refreshInventoryRequirements()">도면 부재 가져오기</button><button type="button" class="outline-button" @click="loadInventorySample">기본 예제 불러오기</button></div>
              </div>

              <div class="inventory-scope-grid">
                <div><b>계산 대상</b><span>동일 폭 직사각형 패널·보드의 길이 절단</span></div>
                <div><b>자동 제외</b><span>곡선·불규칙 형상·규격 불일치 자재·손상 판정</span></div>
                <div><b>재고 처리</b><span>계산 중 예상 사용 · 승인 후 예약 · 취소 시 변경 없음</span></div>
              </div>

              <section class="inventory-settings-card">
                <div class="inventory-subheading"><div><span class="panel-kicker">1단계</span><h4>절단 기준</h4></div><small>비어 있으면 계획을 확정하지 않습니다.</small></div>
                <div class="inventory-settings-grid">
                  <label>톱날 절단폭(mm)<input v-model.number="inventoryState.settings.kerfMm" type="number" min="0" step="0.1" :disabled="inventoryLocked" @change="invalidateInventoryPlan" /></label>
                  <label>최소 절단 여유(mm)<input v-model.number="inventoryState.settings.minimumCutAllowanceMm" type="number" min="0" step="1" :disabled="inventoryLocked" @change="invalidateInventoryPlan" /></label>
                  <label>재사용 최소 잔량(mm)<input v-model.number="inventoryState.settings.minimumReusableOffcutMm" type="number" min="1" step="1" :disabled="inventoryLocked" @change="invalidateInventoryPlan" /></label>
                  <label>기존 방식 비교용 원자재 길이(mm)<input v-model.number="inventoryState.settings.baselineStockLengthMm" type="number" min="1" step="1" :disabled="inventoryLocked" @change="invalidateInventoryPlan" /><small>입력하지 않으면 폐기량 비교는 확인 필요로 남습니다.</small></label>
                </div>
              </section>

              <section class="inventory-requirements-card">
                <div class="inventory-subheading"><div><span class="panel-kicker">2단계</span><h4>필요 조각 목록</h4></div><div class="inventory-subheading-actions"><span class="table-note">{{ inventoryState.requirements.length }}개 · 확인 필요 {{ inventoryRequirementsNeedingReview.length }}개</span><button type="button" class="outline-button" :disabled="!inventoryState.requirements.length || inventoryLocked" @click="confirmAllInventoryRequirements">모두 확인</button></div></div>
                <p class="inventory-help">도면에서 가져온 값은 자동으로 확정하지 않습니다. 높이·폭·두께·표면 마감·도면 축척을 직접 확인한 뒤 조각별로 확인하세요.</p>
                <div v-if="inventoryState.requirements.length" class="inventory-requirement-list">
                  <article v-for="requirement in inventoryState.requirements" :key="requirement.id" class="inventory-requirement-card" :class="{ confirmed: requirement.status === 'ready' && !requirement.missingFields.length }">
                    <div class="inventory-card-title"><div><strong>{{ requirement.zone }} · {{ requirement.location }}</strong><small>{{ inventoryRequirementSourceLabel(requirement) }} · {{ requirement.source === 'sample' ? '예제' : '도면/사용자 입력' }} · 신뢰도 {{ CONFIDENCE_LABELS[requirement.confidence] }}</small></div><span :class="['review-pill', requirement.status === 'ready' && !requirement.missingFields.length ? 'confirmed' : 'blocked']">{{ requirement.status === 'ready' && !requirement.missingFields.length ? '사용자 확인' : '확인 필요' }}</span></div>
                    <div class="inventory-field-grid">
                      <label>자재 종류<input v-model="requirement.materialName" type="text" :disabled="inventoryLocked" @change="updateInventoryRequirement(requirement)" /></label>
                      <label>두께(mm)<input v-model.number="requirement.thicknessMm" type="number" min="1" :disabled="inventoryLocked" @change="updateInventoryRequirement(requirement)" /></label>
                      <label>폭(mm)<input v-model.number="requirement.widthMm" type="number" min="1" :disabled="inventoryLocked" @change="updateInventoryRequirement(requirement)" /></label>
                      <label>필요 길이(mm)<input v-model.number="requirement.requiredLengthMm" type="number" min="1" :disabled="inventoryLocked" @change="updateInventoryRequirement(requirement)" /></label>
                      <label>높이(mm)<input v-model.number="requirement.heightMm" type="number" min="1" :disabled="inventoryLocked" @change="updateInventoryRequirement(requirement)" /></label>
                      <label>수량<input v-model.number="requirement.quantity" type="number" min="1" step="1" :disabled="inventoryLocked" @change="updateInventoryRequirement(requirement)" /></label>
                      <label>표면 마감<input v-model="requirement.surfaceFinish" type="text" placeholder="예: 평판 도장" :disabled="inventoryLocked" @change="updateInventoryRequirement(requirement)" /></label>
                      <label>색상<input v-model="requirement.color" type="text" placeholder="예: 아이보리" :disabled="inventoryLocked" @change="updateInventoryRequirement(requirement)" /></label>
                      <label>도면 축척<input v-model="requirement.drawingScale" type="text" placeholder="예: 1:50" :disabled="inventoryLocked" @change="updateInventoryRequirement(requirement)" /></label>
                    </div>
                    <div class="inventory-requirement-footer"><span v-if="inventoryRequirementMissingLabels(requirement).length" class="inventory-missing-fields">빠진 정보: {{ inventoryRequirementMissingLabels(requirement).join(' · ') }}</span><span v-else class="inventory-ready-note">필수 정보가 입력됐지만 사용자 확인 전에는 계산하지 않습니다.</span><button type="button" class="primary-button" :disabled="inventoryLocked || requirement.status === 'ready' && !requirement.missingFields.length" @click="confirmInventoryRequirement(requirement)">{{ requirement.status === 'ready' && !requirement.missingFields.length ? '확인 완료' : '정보 확인' }}</button></div>
                  </article>
                </div>
                <div v-else class="inventory-empty"><strong>필요 조각이 없습니다.</strong><span>도면 분석 후 ‘도면 부재 가져오기’를 누르거나 기본 예제를 불러오세요.</span></div>
              </section>

              <section class="inventory-owned-card">
                <div class="inventory-subheading"><div><span class="panel-kicker">3단계</span><h4>보유 자재</h4></div><div class="inventory-subheading-actions"><span class="table-note">{{ inventoryState.ownedMaterials.length }}종</span><button type="button" class="outline-button" :disabled="inventoryLocked" @click="inventoryStockFormOpen = !inventoryStockFormOpen">{{ inventoryStockFormOpen ? '입력 닫기' : '보유 자재 추가' }}</button></div></div>
                <div v-if="inventoryState.ownedMaterials.length" class="inventory-owned-list">
                  <article v-for="stock in inventoryState.ownedMaterials" :key="stock.id" class="inventory-owned-card-row" :class="{ unusable: !stock.usable }"><div><strong>{{ stock.materialName }} · {{ stock.thicknessMm }}T · {{ inventorySourceLabel(stock.source) }}</strong><small>폭 {{ inventoryNumber(stock.widthMm) }}mm · 길이 {{ inventoryNumber(stock.lengthMm) }}mm · {{ stock.surfaceFinish }} · {{ stock.color }}</small><small>{{ stock.location }} · {{ stock.usable ? '사용 가능' : '사용 안 함' }} · 예약 {{ stock.reservedQuantity }}/{{ stock.quantity }}</small></div><button type="button" class="icon-button danger" :disabled="stock.reservedQuantity > 0 || inventoryLocked" aria-label="보유 자재 삭제" @click="removeInventoryStock(stock)">×</button></article>
                </div>
                <div v-else class="inventory-empty"><strong>등록된 보유 자재가 없습니다.</strong><span>현장에 있는 자재와 자투리를 먼저 입력하세요. 길이·폭·두께·마감·색상이 맞지 않으면 자동 사용하지 않습니다.</span></div>
                <div v-if="inventoryStockFormOpen" class="inventory-stock-form">
                  <label>자재 종류<select v-model="inventoryStockDraft.materialType"><option value="panel">샌드위치패널</option><option value="board">보드</option></select></label>
                  <label>자재 이름<input v-model="inventoryStockDraft.materialName" type="text" placeholder="예: 50T 샌드위치패널" /></label>
                  <label>두께(mm)<input v-model="inventoryStockDraft.thicknessMm" type="number" min="1" /></label>
                  <label>폭(mm)<input v-model="inventoryStockDraft.widthMm" type="number" min="1" /></label>
                  <label>길이(mm)<input v-model="inventoryStockDraft.lengthMm" type="number" min="1" /></label>
                  <label>표면 마감<input v-model="inventoryStockDraft.surfaceFinish" type="text" placeholder="예: 평판 도장" /></label>
                  <label>색상<input v-model="inventoryStockDraft.color" type="text" placeholder="예: 아이보리" /></label>
                  <label>수량<input v-model="inventoryStockDraft.quantity" type="number" min="1" step="1" /></label>
                  <label>구분<select v-model="inventoryStockDraft.source"><option value="new">신규 자재</option><option value="scrap">자투리 자재</option></select></label>
                  <label>보관 위치<input v-model="inventoryStockDraft.location" type="text" placeholder="예: 1층 자재장" /></label>
                  <label class="checkbox-label"><input v-model="inventoryStockDraft.usable" type="checkbox" /><span>사용 가능</span></label>
                  <label>메모<input v-model="inventoryStockDraft.note" type="text" placeholder="현장 메모" /></label>
                  <div class="inventory-stock-form-actions"><button type="button" class="outline-button" @click="inventoryStockFormOpen = false; resetInventoryStockDraft()">취소</button><button type="button" class="primary-button" @click="addInventoryStock">보유 자재 저장</button></div>
                </div>
              </section>

              <section class="inventory-calculation-card">
                <div><span class="panel-kicker">4단계</span><h4>계산·승인</h4><p>계산은 예상 사용만 만들며 실제 재고를 바꾸지 않습니다. 사용자가 승인한 뒤에만 예약 수량을 올립니다.</p></div>
                <div class="inventory-calculation-actions"><button type="button" class="primary-button" :disabled="inventoryLocked" @click="calculateInventoryPlanForProject">보유 자재 기반 계산</button><button v-if="inventoryPlan?.status === 'calculated'" type="button" class="outline-button" @click="cancelInventoryPlanForProject">계획 취소</button><button v-if="inventoryPlan?.status === 'calculated'" type="button" class="primary-button" @click="approveInventoryPlanForProject">승인·재고 예약</button></div>
              </section>

              <section v-if="inventoryState.missingFields.length" class="inventory-missing-panel"><strong>확인 필요 — 계획을 확정하지 않았습니다.</strong><ul><li v-for="item in inventoryState.missingFields" :key="item">{{ item }}</li></ul></section>

              <section v-if="inventoryPlan" class="inventory-plan-result">
                <div class="inventory-subheading"><div><span class="panel-kicker">계산 결과</span><h4>현장 절단 계획 · {{ inventoryCutStatusLabel(inventoryPlan.status) }}</h4></div><small>계산 시각 {{ inventoryPlan.createdAt }}</small></div>
                <div class="inventory-result-summary"><div><b>{{ inventoryPlan.requiredPieceCount }}</b><span>필요 조각</span></div><div><b>{{ inventoryPlan.ownedPieceCount }}</b><span>보유 자재 사용</span></div><div><b>{{ inventoryPlan.newOrderPieceCount }}</b><span>신규 발주</span></div><div><b>{{ inventoryPlan.orderReductionPieceCount === null ? '확인 필요' : inventoryPlan.orderReductionPieceCount }}</b><span>기존 대비 발주 감소</span></div><div><b>{{ inventoryNumber(inventoryPlan.reusableLengthMm) }}mm</b><span>재사용 가능 잔량</span></div><div><b>{{ inventoryNumber(inventoryPlan.plannedWasteLengthMm) }}mm</b><span>폐기 예상 잔량</span></div></div>
                <div class="inventory-comparison-note">기존 방식 대비 발주 감소: <strong>{{ inventoryPlan.orderReductionPieceCount === null ? '비교 기준 입력 필요' : `${inventoryPlan.orderReductionPieceCount}개` }}</strong> · 폐기량 감소: <strong>{{ inventoryPlan.wasteReductionLengthMm === null ? '비교 기준 입력 필요' : `${inventoryPlan.wasteReductionLengthMm.toLocaleString('ko-KR')}mm` }}</strong></div>

                <div class="inventory-usage-list"><article v-for="usage in inventoryPlan.usages" :key="usage.id" class="inventory-usage-card"><div class="inventory-card-title"><div><strong>{{ usage.materialName }} · {{ usage.lengthMm.toLocaleString('ko-KR') }} × {{ usage.widthMm.toLocaleString('ko-KR') }}mm</strong><small>{{ usage.source === 'scrap' ? '자투리 자재 우선 사용' : '보유 신규 자재 사용' }} · {{ inventoryCutStatusLabel(inventoryPlan.status) }}</small></div><span class="inventory-usage-remainder">잔량 {{ usage.remainingLengthMm.toLocaleString('ko-KR') }}mm</span></div><ol class="inventory-cut-list"><li v-for="cut in usage.cuts" :key="cut.id"><span class="cut-order-number">{{ cut.cutOrder }}</span><div><strong>{{ cut.zone }} · {{ cut.location }}</strong><small>필요 {{ cut.requiredLengthMm.toLocaleString('ko-KR') }}mm · 실제 사용 {{ cut.actualUsedLengthMm.toLocaleString('ko-KR') }}mm · 톱날 {{ cut.kerfMm }}mm</small><small>절단 전 {{ cut.stockLengthBeforeMm.toLocaleString('ko-KR') }}mm → 절단 후 {{ cut.remainingLengthMm.toLocaleString('ko-KR') }}mm</small></div></li></ol><div class="inventory-usage-footer"><span>실제 사용 {{ usage.usedLengthMm.toLocaleString('ko-KR') }}mm</span><span>재사용 가능 {{ usage.reusableRemainingLengthMm.toLocaleString('ko-KR') }}mm</span><span>폐기 예상 {{ usage.wasteRemainingLengthMm.toLocaleString('ko-KR') }}mm</span></div></article></div>

                <div v-if="inventoryPlan.newOrders.length" class="inventory-new-order-list"><h5>신규 발주 필요 자재</h5><article v-for="order in inventoryPlan.newOrders" :key="order.id"><strong>{{ order.materialName }} · {{ order.thicknessMm }}T · 폭 {{ order.widthMm }}mm · 길이 {{ order.lengthMm }}mm × {{ order.quantity }}개</strong><span>{{ order.surfaceFinish }} · {{ order.color }} · {{ order.reason }}</span></article></div><div v-else class="inventory-success-note">보유 자재만으로 필요한 조각을 모두 배정했습니다. 신규 발주가 없습니다.</div>

                <div v-if="inventoryPlan.excludedMaterials.length" class="inventory-excluded-list"><h5>사용 대상에서 제외한 보유 자재</h5><article v-for="item in inventoryPlan.excludedMaterials" :key="item.ownedMaterialId"><strong>{{ item.label }}</strong><span>{{ item.reasons.join(' · ') }}</span></article></div>
              </section>
            </section>

            <section class="optimization-catalog panel-card">
              <div class="panel-heading"><div><span class="panel-kicker">첫 번째 확인</span><h3>자재 카탈로그</h3></div><button type="button" class="outline-button" @click="catalogFormOpen = !catalogFormOpen; resetCatalogDraft()">{{ catalogFormOpen ? '입력 닫기' : '자재 기준 입력' }}</button></div>
              <p class="optimization-help">실제 업체 가격과 원자재 규격을 입력해야 총비용을 계산할 수 있습니다. 입력하지 않은 값은 임의로 채우지 않습니다.</p>
              <div class="catalog-selection-grid">
                <label>판넬 부재에 사용할 자재<select v-model="project.optimization.selectedPanelMaterialId" @change="selectOptimizationMaterial('panel', project.optimization.selectedPanelMaterialId)"><option value="">선택하지 않음</option><option v-for="item in optimizationCatalogPanels" :key="item.id" :value="item.id">{{ item.name || '이름 없음' }} · {{ item.material }}</option></select></label>
                <label>프로파일 부재에 사용할 자재<select v-model="project.optimization.selectedProfileMaterialId" @change="selectOptimizationMaterial('profile', project.optimization.selectedProfileMaterialId)"><option value="">선택하지 않음</option><option v-for="item in optimizationCatalogProfiles" :key="item.id" :value="item.id">{{ item.name || '이름 없음' }} · {{ item.material }}</option></select></label>
              </div>
              <p v-if="optimizationCatalogProfiles.length && !project.optimization.members.some((member) => member.materialType === 'profile')" class="optimization-help">현재 도면 분석에서 구조용 프로파일 부재의 위치·규격 근거를 찾지 못했습니다. 임의의 프로파일 수량은 만들지 않으며, 근거가 추가된 부재만 프로파일 절단 계산에 사용합니다.</p>
                  <div v-if="!project.optimization.catalog.length" class="optimization-empty"><strong>등록된 실제 자재 기준이 없습니다.</strong><span>샘플 단가와 규격을 자동으로 만들지 않습니다. 자재 기준 입력 버튼에서 업체 자료를 넣어주세요.</span></div>
                <div v-else class="catalog-list">
                <article v-for="item in project.optimization.catalog" :key="item.id" class="catalog-item" :class="{ selected: item.id === project.optimization.selectedPanelMaterialId || item.id === project.optimization.selectedProfileMaterialId }">
                  <div class="catalog-item__main"><strong>{{ item.name || '이름 없음' }} <em v-if="item.source === 'sample'" class="sample-data-label">샘플 데이터</em></strong><span>{{ item.materialType === 'panel' ? '판재' : '프로파일' }} · {{ item.material || '재질 확인 필요' }}</span><small>{{ catalogSpec(item) }}</small><small>{{ item.surfaceFinish || '표면 마감 확인 필요' }} · {{ item.color || '색상 확인 필요' }}</small></div>
                  <div class="catalog-item__meta"><b>{{ item.unitPrice === null ? '단가 확인 필요' : `${item.unitPrice.toLocaleString('ko-KR')}원/${item.unitLabel}` }}</b><span>{{ catalogMissingLabel(item) }}</span></div>
                  <div class="catalog-item__actions"><button type="button" class="text-button" @click="editCatalogItem(item)">수정</button><button type="button" class="icon-button danger" aria-label="자재 기준 삭제" @click="removeCatalogItem(item)">×</button></div>
                </article>
              </div>

              <div v-if="catalogFormOpen" class="catalog-editor">
                <div class="editor-heading"><strong>{{ editingCatalogId ? '자재 기준 수정' : '새 자재 기준 입력' }}</strong><span>빈 가격·규격은 계산 보류로 남습니다.</span></div>
                <div class="settings-grid catalog-form-grid">
                  <label>자재 이름<input v-model="catalogDraft.name" type="text" placeholder="예: 외벽 판넬" /></label>
                  <label>자재 종류<select v-model="catalogDraft.materialType"><option value="panel">판재</option><option value="profile">프로파일</option></select></label>
                  <label>재질<input v-model="catalogDraft.material" type="text" placeholder="예: 샌드위치 판넬·각파이프" /></label>
                  <label>두께(mm)<input v-model="catalogDraft.thicknessMm" type="number" min="0" /></label>
                  <label>판재 폭(mm)<input v-model="catalogDraft.stockWidthMm" type="number" min="1" placeholder="판재인 경우" /></label>
                  <label>원자재 길이(mm)<input v-model="catalogDraft.stockLengthMm" type="number" min="1" /></label>
                  <label>비교할 원자재 길이(mm)<input v-model="catalogDraft.stockLengthOptionsMm" type="text" placeholder="6000, 9000, 12000" /></label>
                  <label>판매 단위<select v-model="catalogDraft.unit"><option value="sheet">판</option><option value="bar">본</option></select></label>
                  <label>단위 표시<input v-model="catalogDraft.unitLabel" type="text" placeholder="장 또는 본" /></label>
                  <label>단가(원)<input v-model="catalogDraft.unitPrice" type="number" min="0" /></label>
                  <label>최소 주문 수량<input v-model="catalogDraft.minimumOrderQuantity" type="number" min="1" /></label>
                  <label>절단비(원/원자재)<input v-model="catalogDraft.cuttingFee" type="number" min="0" /></label>
                  <label>절단 1회 비용(원)<input v-model="catalogDraft.cutCostPerCut" type="number" min="0" /></label>
                  <label>톱날 절단폭(mm)<input v-model="catalogDraft.kerfMm" type="number" min="0" step="0.1" /></label>
                  <label>운반비(원)<input v-model="catalogDraft.transportCost" type="number" min="0" /></label>
                  <label>현장 취급비(원)<input v-model="catalogDraft.handlingCost" type="number" min="0" /></label>
                  <label>판재 폐기비(원/㎡)<input v-model="catalogDraft.disposalCostPerM2" type="number" min="0" /></label>
                  <label>프로파일 폐기비(원/m)<input v-model="catalogDraft.disposalCostPerM" type="number" min="0" /></label>
                  <label>임시 보관비(원/일)<input v-model="catalogDraft.temporaryStorageCostPerDay" type="number" min="0" /></label>
                  <label>허용 이음·겹침(mm)<input v-model="catalogDraft.lapAllowanceMm" type="number" min="0" /></label>
                  <label>최소 재사용 자투리(mm)<input v-model="catalogDraft.minimumReusableOffcutMm" type="number" min="1" /></label>
                  <label>재작업 위험 비용(원)<input v-model="catalogDraft.reworkRiskCost" type="number" min="0" /></label>
                  <label>표면 마감<input v-model="catalogDraft.surfaceFinish" type="text" placeholder="예: 평판 도장" /></label>
                  <label>색상<input v-model="catalogDraft.color" type="text" placeholder="예: 아이보리" /></label>
                  <label class="checkbox-label"><input v-model="catalogDraft.rotatable" type="checkbox" /><span>회전 가능</span></label>
                  <label>도장·무늬 방향<select v-model="catalogDraft.grainDirection"><option value="fixed">방향 고정</option><option value="free">회전 가능 방향</option></select></label>
                </div>
                <div class="editor-actions"><button type="button" class="outline-button" @click="catalogFormOpen = false; resetCatalogDraft()">취소</button><button type="button" class="primary-button" @click="saveCatalogItem">자재 기준 저장</button></div>
              </div>
            </section>

            <details class="optimization-details panel-card" open>
              <summary><span><b>시공 대상 부재 목록</b><small>도면에서 고정된 부재만 절단 대상으로 사용합니다.</small></span><strong>{{ project.optimization.members.length }}개</strong></summary>
              <div v-if="project.optimization.members.length" class="table-scroll"><table class="data-table optimization-member-table"><thead><tr><th>부재 ID</th><th>구역·벽체</th><th>필요 길이</th><th>필요 폭</th><th>필요 높이</th><th>자재</th><th>형상</th><th>도면 근거</th><th>상태</th></tr></thead><tbody><tr v-for="member in project.optimization.members" :key="member.id"><td><b>{{ member.id }}</b></td><td>{{ member.zone }} · {{ member.wallNumber }}</td><td>{{ formatOptimizationMm(member.requiredLengthMm) }}</td><td>{{ formatOptimizationMm(member.requiredWidthMm) }}</td><td>{{ formatOptimizationMm(member.requiredHeightMm) }}</td><td>{{ project.optimization.catalog.find((item) => item.id === member.materialId)?.name || '확인 필요' }}</td><td>{{ member.shape === 'rectangle' ? '직사각형' : '지원되지 않는 형상' }}</td><td>{{ member.sourceReferences[0] ? `${member.sourceReferences[0].fileName} · ${member.sourceReferences[0].pageNumber}페이지` : '근거 미확인' }}</td><td><span :class="['review-pill', member.reviewStatus === 'ready' ? 'verified' : 'review']">{{ member.reviewStatus === 'ready' ? '준비됨' : '확인 필요' }}</span></td></tr></tbody></table></div>
              <div v-else class="optimization-empty"><strong>아직 절단 대상 부재를 만들지 않았습니다.</strong><span>발주 산출표를 계산한 뒤 자재 기준을 선택하고 최적화 계산을 실행하세요.</span></div>
            </details>

            <details class="optimization-details panel-card">
              <summary><span><b>현재 현장 자투리 입력</b><small>사용처와 사용 시점이 없는 자투리는 자동으로 재사용하지 않습니다.</small></span><strong>{{ project.optimization.scraps.filter((scrap) => scrap.source === 'existing').length }}개</strong></summary>
              <div class="existing-scrap-list"><article v-for="scrap in project.optimization.scraps.filter((item) => item.source === 'existing')" :key="scrap.id" class="existing-scrap-row"><div><strong>{{ scrap.material }} · {{ formatOptimizationMm(scrap.lengthMm) }}<span v-if="scrap.widthMm"> × {{ formatOptimizationMm(scrap.widthMm) }}</span></strong><small>{{ scrap.currentLocation }} · 발생 구역 {{ scrap.originZone }}</small></div><span :class="['review-pill', scrap.status === 'reuse-planned' ? 'confirmed' : 'blocked']">{{ scrap.status === 'reuse-planned' ? '재사용 예정' : '현장 재사용 불가' }}</span><button type="button" class="icon-button danger" aria-label="자투리 삭제" @click="removeExistingScrap(scrap.id)">×</button></article></div>
              <button type="button" class="outline-button" @click="scrapFormOpen = !scrapFormOpen">{{ scrapFormOpen ? '자투리 입력 닫기' : '현장 자투리 등록' }}</button>
              <div v-if="scrapFormOpen" class="scrap-editor">
                <label>자재<select v-model="scrapDraft.materialId"><option value="">선택</option><option v-for="item in project.optimization.catalog" :key="item.id" :value="item.id">{{ item.name }} · {{ item.material }}</option></select></label>
                <label>길이(mm)<input v-model="scrapDraft.lengthMm" type="number" min="1" /></label>
                <label>폭(mm, 판재)<input v-model="scrapDraft.widthMm" type="number" min="1" /></label>
                <label>현재 보관 위치<input v-model="scrapDraft.currentLocation" type="text" placeholder="예: 1층 자재장" /></label>
                <label>발생 구역<input v-model="scrapDraft.originZone" type="text" /></label>
                <label>사용 가능한 구역<input v-model="scrapDraft.usableZones" type="text" placeholder="구역 A, 구역 B" /></label>
                <label>사용 예정 부재<select v-model="scrapDraft.plannedUseMemberId"><option value="">아직 정하지 않음</option><option v-for="member in project.optimization.members" :key="member.id" :value="member.id">{{ member.id }} · {{ member.zone }}</option></select></label>
                <label>발생 시점<input v-model="scrapDraft.generatedAt" type="date" /></label>
                <label>사용 예정 시점<input v-model="scrapDraft.plannedUseAt" type="date" /></label>
                <button type="button" class="primary-button" @click="addExistingScrap">자투리 저장</button>
              </div>
            </details>

            <div class="optimization-run-card workflow-action-card"><div><span class="panel-kicker">계산 실행</span><h3>원자재·절단 순서·자투리 사용을 계산합니다.</h3><p>큰 부재부터 배치하고 회전 가능 여부와 절단폭을 검증합니다. 설계 치수는 변경하지 않습니다.</p></div><button type="button" class="primary-button" :disabled="!optimizationCanRun" @click="runOptimization">절단 최적화 계산</button></div>

            <section v-if="project.optimization.reviews.length" class="optimization-review panel-card">
              <div class="panel-heading"><div><span class="panel-kicker">사람이 확인할 항목</span><h3>확인 필요 목록</h3></div><span class="low-count">{{ optimizationNeedsReview.length }}건</span></div>
              <article v-for="item in project.optimization.reviews" :key="item.id" class="optimization-review-item"><div><strong>{{ item.problem }}</strong><span>{{ item.sourceLabel }}</span><small>현재 값: {{ item.currentValue }}</small><p>{{ item.reason }}</p></div><div class="review-value-editor"><label>사람이 수정할 값<input v-model="optimizationReviewDrafts[item.id]" type="text" placeholder="확인값 또는 메모" /></label><button type="button" class="outline-button" @click="saveOptimizationReviewValue(item)">값 기록</button></div></article>
              <div class="review-recalculate"><span>원본 높이는 분석 결과에서, 규격·가격은 자재 카탈로그에서 수정한 뒤 다시 계산하세요.</span><button type="button" class="primary-button" @click="runOptimization">수정 후 다시 계산</button></div>
            </section>

            <section v-if="project.optimization.scenarios.length" class="optimization-results">
              <div class="section-heading compact"><div><p class="eyebrow">계산 결과 비교</p><h2>어떤 기준으로 발주할까요?</h2><p>기본 추천은 총비용 최소안입니다. 가격이 없으면 총비용은 계산 불가로 남고 물량·폐기량만 비교합니다.</p></div></div>
              <div class="scenario-grid"><button v-for="scenario in project.optimization.scenarios" :key="scenario.id" type="button" class="scenario-card" :class="{ selected: optimizationScenario?.id === scenario.id }" @click="chooseOptimizationScenario(scenario.id)"><span>{{ scenario.label }}</span><strong>{{ formatOptimizationCost(scenario.cost.totalCost) }}</strong><small>원자재 {{ scenario.stockCount }}{{ scenario.orderQuantity === null ? '개' : `개 주문` }} · 절단 {{ scenario.cutCount }}회</small><small v-if="scenario.wasteAreaM2 !== null">폐기 면적 {{ scenario.wasteAreaM2.toFixed(2) }}㎡ · 폐기율 {{ scenario.wasteRate === null ? '계산 불가' : `${scenario.wasteRate}%` }}</small><small v-else>폐기 길이 {{ formatOptimizationMm(scenario.wasteLengthMm) }}</small><em>{{ scenario.recommendation }}</em></button></div>
              <div class="scenario-explanation">총비용 최소안은 폐기량 최소안보다 자재 폐기량이 많을 수 있습니다. 현장에서는 구매비·절단비·운반비·보관비까지 합산해 결정해야 합니다.</div>
              <div v-if="optimizationScenario?.stockLengthComparison.length" class="stock-length-comparison panel-card"><strong>원자재 길이 비교</strong><span v-for="item in optimizationScenario.stockLengthComparison" :key="`${item.stockLengthMm}-${item.stockCount}`" :class="{ selected: item.selected }">{{ item.stockLengthMm.toLocaleString('ko-KR') }}mm · {{ item.stockCount }}개<span v-if="item.selected"> · 선택</span></span></div>

              <section class="cutting-layout-card panel-card">
                <div class="panel-heading"><div><span class="panel-kicker">절단 배치도</span><h3>원자재별 배치와 남는 자투리</h3></div><select v-if="optimizationScenario" v-model="selectedOptimizationPlanId" aria-label="절단 배치 선택"><option v-for="plan in optimizationScenario.stockPlans" :key="plan.id" :value="plan.id">{{ plan.source === 'raw-material' ? '원자재' : '현장 자투리' }} {{ plan.stockIndex }} · {{ formatOptimizationMm(plan.stockLengthMm) }}</option></select></div>
                <div v-if="selectedOptimizationPlan" class="cutting-layout-wrap">
                  <div v-if="selectedOptimizationPlan.materialType === 'panel'" class="sheet-layout" :style="{ aspectRatio: `${selectedOptimizationPlan.stockLengthMm} / ${selectedOptimizationPlan.stockWidthMm || 1}` }"><span class="stock-label">원자재 {{ formatOptimizationMm(selectedOptimizationPlan.stockLengthMm) }} × {{ formatOptimizationMm(selectedOptimizationPlan.stockWidthMm) }}</span><div v-for="placement in selectedOptimizationPlan.placements" :key="placement.id" class="cut-piece cut-piece--use" :style="placementStyle(placement, selectedOptimizationPlan)"><b>{{ placement.label }}</b><small>{{ placement.lengthMm }} × {{ placement.widthMm }}mm</small><i>{{ placement.cutOrder }}번 절단</i></div><div v-for="scrap in planScraps(selectedOptimizationPlan)" :key="scrap.id" :class="['cut-piece', scrap.status === 'reuse-planned' ? 'cut-piece--reuse' : 'cut-piece--waste']" :style="scrapStyle(scrap, selectedOptimizationPlan)"><b>자투리</b><small>{{ scrap.lengthMm }} × {{ scrap.widthMm || '길이' }}mm</small><i>{{ scrap.status === 'reuse-planned' ? '현장 재사용' : '폐기·반납 확인' }}</i></div></div>
                  <div v-else class="profile-layout"><span class="stock-label">원자재 {{ formatOptimizationMm(selectedOptimizationPlan.stockLengthMm) }}</span><div v-for="placement in selectedOptimizationPlan.placements" :key="placement.id" class="profile-piece cut-piece--use" :style="placementStyle(placement, selectedOptimizationPlan)"><b>{{ placement.label }}</b><small>{{ formatOptimizationMm(placement.lengthMm) }}</small><i>{{ placement.cutOrder }}번 절단</i></div><div v-for="scrap in planScraps(selectedOptimizationPlan)" :key="scrap.id" :class="['profile-piece', 'cut-piece', scrap.status === 'reuse-planned' ? 'cut-piece--reuse' : 'cut-piece--waste']" :style="scrapStyle(scrap, selectedOptimizationPlan)"><b>자투리</b><small>{{ formatOptimizationMm(scrap.lengthMm) }}</small><i>{{ scrap.status === 'reuse-planned' ? '현장 재사용' : '폐기·반납 확인' }}</i></div></div>
                  <div class="cutting-legend"><span class="legend-use">사용 부재</span><span class="legend-reuse">현장 재사용 자투리</span><span class="legend-waste">사용처 없음</span><span class="legend-review">확인 필요</span></div>
                  <div class="cutting-plan-facts"><div><span>절단 순서</span><b>{{ selectedOptimizationPlan.placements.map((placement) => placement.label).join(' → ') || '없음' }}</b></div><div><span>남는 자투리</span><b>{{ planScraps(selectedOptimizationPlan).length }}개 · {{ selectedOptimizationPlan.materialType === 'panel' ? `${(selectedOptimizationPlan.wasteAreaM2 || 0).toFixed(2)}㎡` : formatOptimizationMm(selectedOptimizationPlan.wasteLengthMm) }}</b></div><div><span>현장 재사용</span><b>{{ planScraps(selectedOptimizationPlan).filter((scrap) => scrap.status === 'reuse-planned').length }}개</b></div><div><span>폐기·반납</span><b>{{ planScraps(selectedOptimizationPlan).filter((scrap) => scrap.status !== 'reuse-planned').length }}개</b></div></div>
                </div>
                <div v-else class="optimization-empty"><strong>표시할 절단 배치가 없습니다.</strong><span>원자재 규격과 부재 치수를 확인하세요.</span></div>
              </section>

              <section class="optimization-output panel-card"><div class="panel-heading"><div><span class="panel-kicker">발주·현장 출력</span><h3>파일로 내려받기</h3></div><span class="table-note">비용이 계산 불가여도 입력값·근거·검토 상태는 출력할 수 있습니다.</span></div><div class="output-button-grid"><button type="button" class="outline-button" @click="exportSelectedOptimization('orders')">자재 발주서 CSV</button><button type="button" class="outline-button" @click="exportSelectedOptimization('members')">부재 절단 목록 CSV</button><button type="button" class="outline-button" @click="exportSelectedOptimization('plans')">절단 배치 CSV</button><button type="button" class="outline-button" @click="exportSelectedOptimization('scraps')">자투리 목록 CSV</button><button type="button" class="outline-button" @click="exportSelectedOptimization('comparison')">비용 비교표 CSV</button><button type="button" class="outline-button" @click="exportSelectedOptimization('inputs')">입력값·도면 근거 CSV</button><button type="button" class="primary-button" @click="printSelectedCuttingPlans">절단 배치도 인쇄·PDF</button></div></section>

              <section class="optimization-validation panel-card"><div class="panel-heading"><div><span class="panel-kicker">계산 신뢰성 검사</span><h3>배치 검증 결과</h3></div><span :class="['orderability-badge', { ready: project.optimization.validation.passed }]">{{ project.optimization.validation.passed ? '검증 통과' : '확인 필요' }}</span></div><div v-if="project.optimization.validation.passed" class="validation-success">모든 부재가 한 번씩 배정되고, 원자재 밖 배치·겹침·절단폭·개구부 중복을 검사했습니다.</div><ul v-else class="validation-errors"><li v-for="message in optimizationValidationMessages()" :key="message">{{ message }}</li></ul></section>
            </section>
          </section>

          <section v-if="costFiles.length && activeSection === 'analysis'" class="cost-section panel-card">
            <div class="panel-heading"><div><span class="panel-kicker">참고 자료</span><h3>공사비 집계표 비용 분석</h3></div><span class="cost-exclusion">3차원·자재 산출 제외</span></div>
            <p class="cost-note">{{ project.costSummary.privacyNote }}</p>
            <div class="cost-total"><span>추출 합계</span><strong>{{ formatAmount(project.costSummary.totalAmount) }}</strong></div>
            <div class="table-scroll"><table class="data-table cost-table"><thead><tr><th>월</th><th>업체명(비식별화)</th><th>품명</th><th>월별 금액</th><th>누계/합계</th><th>근거</th></tr></thead><tbody><tr v-for="row in project.costSummary.rows" :key="row.id"><td>{{ row.month }}</td><td>{{ row.vendor }}</td><td>{{ row.item }}</td><td>{{ formatAmount(row.amount) }}</td><td>{{ formatAmount(row.total) }}</td><td>{{ row.evidence[0]?.fileName }} · {{ row.evidence[0]?.pageNumber }}p</td></tr><tr v-if="!project.costSummary.rows.length"><td colspan="6" class="empty-table">표의 금액 행을 읽지 못했습니다. 비용 자료로만 저장되었습니다.</td></tr></tbody></table></div>
          </section>
        </template>

        <section class="privacy-banner"><span class="privacy-lock">⌁</span><div><strong>개인정보와 외부 전송 안내</strong><p>업체명·사람 이름·전화번호·주소·계좌번호는 계산에 필요하지 않아 결과에서 비식별화합니다. 현재 파일은 이 컴퓨터 안에서 처리하며 외부로 보내지 않습니다. 인공지능 분석을 사용하려면 서버 설정이 필요합니다.</p></div></section>
        <footer class="site-footer"><span>설계 자재 계산기</span><span>실제 발주 전에는 원본 도면·현장 실측·시공 상세·제조사 기준을 반드시 확인하세요.</span></footer>
      </div>
    </main>
  </div>
</template>
