<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { BuildingGeometry, Evidence, Opening } from '../types/domain'
import { calculateManualMarking, createPageScale, measuredAreaM2, measuredLengthMm, snapshotPreset, type MeasurementPoint, type PageScale } from '../modules/manual-marking-calculator'
import { planWallMaterial, type PanelCatalogItem, type StockPiece } from '../modules/wall-material-layout'
import { activateVersion } from '../modules/drawing-versioning'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker
const Building3DViewer = defineAsyncComponent(() => import('./Building3DViewer.vue'))

type DrawingKind = 'floor' | 'elevation' | 'section' | 'detail' | 'other'
type ReviewStatus = '검토 필요' | '확인 완료'

interface ManualSpec {
  id: string
  item: string
  specification: string
  unit: string
  quantity: number
  unitPrice: number
  inventory: number
  confidence: '높음' | '중간' | '낮음'
  status: ReviewStatus
  memo: string
  origin?: 'manual' | 'geometry-draft'
}

interface ManualDrawing {
  id: string
  name: string
  size: number
  uploadedAt: string
  status: '검토 준비' | '검토 중'
  kind: DrawingKind
  blob: Blob
  specs: ManualSpec[]
  hybridModel?: HybridModelDraft
  marks?: DrawingMark[]
  pageScales?: Record<number, PageScale>
  measurements?: DrawingMeasurement[]
  reviewZones?: ReviewZone[]
  blockOrderForHeldZones?: boolean
  panelCatalog?: PanelCatalogItem[]
  panelStock?: StockPiece[]
  reportInfo?: { siteName: string; projectName: string; author: string; version: string; lastPrintedAt: string }
  drawingGroup?: string
  versionNumber?: number
  versionMemo?: string
  changeReason?: string
  isCurrentVersion?: boolean
}

interface DrawingMark {
  id: string
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  color: string
  colorMode: 'auto' | 'manual'
  zoneName: string
  lengthM: number
  heightMm: number
  material: string
  effectiveWidthMm: number
  openingAreaM2: number
  inventoryPanels: number
  status: ReviewStatus
  memo: string
  reviewZoneId?: string
}

type MeasurementKind = 'wall' | 'area' | 'opening'
interface DrawingMeasurement {
  id: string
  pageNumber: number
  kind: MeasurementKind
  points: MeasurementPoint[]
  name: string
  manualLengthM: number
  heightMm: number
  material: string
  effectiveWidthMm: number
  inventoryPanels: number
  status: ReviewStatus
  openingIds: string[]
  memo: string
  presetId?: string
  presetName?: string
  color?: string
  reviewZoneId?: string
  openingType?: '문' | '창호' | '환기구' | '기타'
  openingWidthMm?: number
  openingHeightMm?: number
  openingQuantity?: number
  linkedWallId?: string
  openingPresetId?: string
  openingPresetName?: string
}

type ZoneStatus = '미검토' | '마킹 중' | '검토 완료' | '보류'
interface ReviewZone {
  id: string
  pageNumber: number
  name: string
  x: number
  y: number
  width: number
  height: number
  status: ZoneStatus
  holdReason: string
}

interface SpecPreset {
  id: string
  name: string
  material: string
  heightMm: number
  effectiveWidthMm: number
  color: string
  status: ReviewStatus
  sample?: boolean
}
interface OpeningPreset {
  id: string
  name: string
  type: '문' | '창호' | '환기구' | '기타'
  widthMm: number
  heightMm: number
  quantity: number
  status: ReviewStatus
}

interface HybridModelDraft {
  lengthMm: number
  widthMm: number
  wallHeightMm: number
  wallThicknessMm: number
  roofKind: 'flat' | 'gable'
  roofHeightMm: number
  status: '검토 필요' | '확인 완료'
  sourceNames: string[]
  candidates: Array<{ label: string; value: number; sourceName: string; status: '검토 필요' }>
  openings: HybridOpeningDraft[]
  note: string
}

interface HybridOpeningDraft {
  id: string
  label: string
  wallIndex: number
  type: 'door' | 'window'
  widthMm: number
  heightMm: number
  sillHeightMm: number
  offsetMm: number
  status: '검토 필요' | '확인 완료'
}

interface LocalTestManifest {
  projectName: string
  drawings: Array<{ name: string; size: number; kind?: DrawingKind }>
}

const DB_NAME = 'drawing-manual-review-v1'
const STORE_NAME = 'drawings'
const PRESET_STORE_NAME = 'spec-presets'
const OPENING_PRESET_STORE_NAME = 'opening-presets'
const MAX_FILE_SIZE = 50 * 1024 * 1024

const drawings = ref<ManualDrawing[]>([])
const selectedId = ref('')
const pageNumber = ref(1)
const pageCount = ref(0)
const zoom = ref(1)
const isLoading = ref(true)
const message = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const pdfStage = ref<HTMLElement | null>(null)
const localTestManifest = ref<LocalTestManifest | null>(null)
const selectedMarkId = ref('')
const markingEnabled = ref(false)
const repositioningMarkId = ref('')
const dragStart = ref<{ x: number; y: number } | null>(null)
const draftRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
const isCompact = ref(false)
const measurementMode = ref<'none' | 'scale' | MeasurementKind>('none')
const measurementDraft = ref<MeasurementPoint[]>([])
const scaleReferenceMm = ref(6000)
const selectedMeasurementId = ref('')
const presets = ref<SpecPreset[]>([])
const activePresetId = ref('')
const presetDraft = ref<SpecPreset>({ id: '', name: '', material: '', heightMm: 3000, effectiveWidthMm: 1000, color: '#0f766e', status: '검토 필요' })
const editingPresetId = ref('')
const openingPresets = ref<OpeningPreset[]>([])
const activeOpeningPresetId = ref('')
const openingPresetDraft = ref<OpeningPreset>({ id: '', name: '', type: '문', widthMm: 1000, heightMm: 2100, quantity: 1, status: '검토 필요' })
const selectedZoneId = ref('')
const zoneDrawingEnabled = ref(false)
const reviewFilter = ref<'all' | 'unreviewed' | 'excluded' | 'height-missing'>('all')
const versionCopySourceId = ref('')
const activePreset = computed(() => presets.value.find((preset) => preset.id === activePresetId.value) || null)
const catalog = computed(() => selectedDrawing.value?.panelCatalog || [])
const stock = computed(() => selectedDrawing.value?.panelStock || [])
const wallPlans = computed(() => (selectedDrawing.value?.measurements || []).filter((measurement) => measurement.kind === 'wall').map((wall) => {
  const net = calculateManualMarking({ lengthM: measurementLengthM(wall), heightMm: wall.heightMm, openingAreaM2: linkedOpeningArea(wall), effectiveWidthMm: wall.effectiveWidthMm, status: wall.status })
  const item = catalog.value.find((candidate) => candidate.name === wall.material)
  return { wall, net, plan: planWallMaterial({ lengthM: measurementLengthM(wall), heightMm: wall.heightMm, netAreaM2: net.netAreaM2, reviewed: wall.status === '확인 완료' && net.ready, catalog: item }, stock.value) }
}))
const orderPlans = computed(() => wallPlans.value.filter((row) => row.plan.ready))
const reportInfo = computed({ get: () => selectedDrawing.value?.reportInfo || { siteName: '', projectName: '', author: '', version: 'v1.0', lastPrintedAt: '' }, set: (value) => { if (selectedDrawing.value) selectedDrawing.value.reportInfo = value } })
const updateCompactMode = () => { isCompact.value = window.matchMedia('(max-width: 700px), (pointer: coarse)').matches }
let pdfDocument: Awaited<ReturnType<typeof pdfjsLib.getDocument>> | null = null
let renderTask: { cancel: () => void } | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const blobUrls = new Map<string, string>()

const kindLabels: Record<DrawingKind, string> = {
  floor: '평면도', elevation: '입면도', section: '단면도', detail: '상세도', other: '기타',
}

const defaultHybridModel = (): HybridModelDraft => ({
  lengthMm: 0,
  widthMm: 0,
  wallHeightMm: 0,
  wallThicknessMm: 150,
  roofKind: 'flat',
  roofHeightMm: 0,
  status: '검토 필요',
  sourceNames: [],
  candidates: [],
  openings: [],
  note: '',
})
const defaultPanelCatalog = (): PanelCatalogItem[] => [{ id: 'sample-panel-75', name: '샌드위치패널 75T', thicknessMm: 75, effectiveWidthMm: 1000, standardLengthMm: 3200, direction: 'vertical', cuttingAllowanceMm: 50, unitPrice: 100000 }]

const selectedDrawing = computed(() => drawings.value.find((drawing) => drawing.id === selectedId.value) || null)
const currentVersionWarning = computed(() => selectedDrawing.value && !selectedDrawing.value.isCurrentVersion ? '현재 사용 버전이 아닌 도면입니다. 발주 CSV 생성 전 현재 버전을 확인하세요.' : '')
const selectedMark = computed(() => selectedDrawing.value?.marks?.find((mark) => mark.id === selectedMarkId.value) || null)
const pageMarks = computed(() => selectedDrawing.value?.marks?.filter((mark) => mark.pageNumber === pageNumber.value) || [])
const pageScale = computed(() => selectedDrawing.value?.pageScales?.[pageNumber.value])
const pageMeasurements = computed(() => selectedDrawing.value?.measurements?.filter((measurement) => measurement.pageNumber === pageNumber.value) || [])
const pageZones = computed(() => selectedDrawing.value?.reviewZones?.filter((zone) => zone.pageNumber === pageNumber.value) || [])
const selectedMeasurement = computed(() => selectedDrawing.value?.measurements?.find((measurement) => measurement.id === selectedMeasurementId.value) || null)
const measurementLengthM = (measurement: DrawingMeasurement) => measurement.manualLengthM > 0 ? measurement.manualLengthM : (measuredLengthMm(measurement.points, selectedDrawing.value?.pageScales?.[measurement.pageNumber]) || 0) / 1000
const measurementArea = (measurement: DrawingMeasurement) => measuredAreaM2(measurement.points, selectedDrawing.value?.pageScales?.[measurement.pageNumber]) || 0
const openingArea = (opening: DrawingMeasurement) => finite(opening.openingWidthMm) && finite(opening.openingHeightMm) ? Number((finite(opening.openingWidthMm) * finite(opening.openingHeightMm) * Math.max(1, finite(opening.openingQuantity)) / 1_000_000).toFixed(3)) : measurementArea(opening)
const linkedOpenings = (wall: DrawingMeasurement, drawing = selectedDrawing.value) => (drawing?.measurements || []).filter((item) => { if (item.kind !== 'opening' || item.status !== '확인 완료') return false; if (item.linkedWallId) return item.linkedWallId === wall.id; const legacyLinks = (drawing?.measurements || []).filter((candidate) => candidate.kind === 'wall' && candidate.openingIds.includes(item.id)); return legacyLinks.length === 1 && legacyLinks[0].id === wall.id })
const linkedOpeningArea = (measurement: DrawingMeasurement) => linkedOpenings(measurement).reduce((sum, item) => sum + openingArea(item), 0)
const reviewedSpecs = computed(() => selectedDrawing.value?.specs.filter((spec) => spec.status === '확인 완료') || [])
const takeoffRows = computed(() => {
  const groups = new Map<string, { item: string; specification: string; unit: string; quantity: number; inventory: number; unitPrice: number }>()
  for (const spec of reviewedSpecs.value) {
    const key = `${spec.item}\u0000${spec.specification}\u0000${spec.unit}`
    const row = groups.get(key) || { item: spec.item || '항목 미입력', specification: spec.specification || '규격 미입력', unit: spec.unit || '단위 미입력', quantity: 0, inventory: 0, unitPrice: 0 }
    row.quantity += finite(spec.quantity)
    row.inventory += finite(spec.inventory)
    row.unitPrice = finite(spec.unitPrice)
    groups.set(key, row)
  }
  return [...groups.values()].map((row) => ({ ...row, shortage: Math.max(0, row.quantity - row.inventory), order: Math.max(0, row.quantity - row.inventory), amount: row.quantity * row.unitPrice }))
})
const totalAmount = computed(() => takeoffRows.value.reduce((sum, row) => sum + row.amount, 0))
const hybridModel = computed(() => selectedDrawing.value?.hybridModel || null)
const hybridCanRender = computed(() => {
  const draft = hybridModel.value
  return Boolean(draft && draft.status === '확인 완료' && finite(draft.lengthMm) && finite(draft.widthMm) && finite(draft.wallHeightMm))
})
const hybridBuilding = computed<BuildingGeometry>(() => buildHybridBuilding(hybridModel.value, selectedDrawing.value))
const hybridWallArea = computed(() => {
  const draft = hybridModel.value
  if (!draft || !hybridCanRender.value) return 0
  return Number((2 * (draft.lengthMm + draft.widthMm) * draft.wallHeightMm / 1_000_000).toFixed(2))
})
const hybridOpeningArea = computed(() => {
  const draft = hybridModel.value
  if (!draft) return 0
  return Number(draft.openings.filter((opening) => opening.status === '확인 완료').reduce((sum, opening) => sum + finite(opening.widthMm) * finite(opening.heightMm) / 1_000_000, 0).toFixed(2))
})
const hybridNetWallArea = computed(() => Math.max(0, Number((hybridWallArea.value - hybridOpeningArea.value).toFixed(2))))
const markingRows = computed(() => drawings.value.flatMap((drawing) => [
  ...(drawing.marks || []).map((mark) => ({ drawing, mark, calculation: calculateManualMarking(mark) })),
  ...(drawing.measurements || []).filter((measurement) => measurement.kind === 'wall').map((measurement) => {
    const lengthM = measurement.manualLengthM > 0 ? measurement.manualLengthM : (measuredLengthMm(measurement.points, drawing.pageScales?.[measurement.pageNumber]) || 0) / 1000
    const openingAreaM2 = linkedOpenings(measurement, drawing).reduce((sum, item) => sum + (finite(item.openingWidthMm) && finite(item.openingHeightMm) ? finite(item.openingWidthMm) * finite(item.openingHeightMm) * Math.max(1, finite(item.openingQuantity)) / 1_000_000 : (measuredAreaM2(item.points, drawing.pageScales?.[item.pageNumber]) || 0)), 0)
    const mark = { ...measurement, color: measurement.color || markColor(measurement.material, measurement.heightMm), lengthM, openingAreaM2 }
    return { drawing, mark, calculation: calculateManualMarking(mark) }
  }),
]))
const markingSummary = computed(() => {
  const groups = new Map<string, { color: string; material: string; heightMm: number; lengthM: number; gross: number; net: number; panels: number; inventory: number; excluded: number }>()
  for (const row of markingRows.value) {
    const { mark, calculation } = row
    const key = `${mark.color}\u0000${mark.material}\u0000${mark.heightMm}`
    const group = groups.get(key) || { color: mark.color, material: mark.material || '자재 미입력', heightMm: mark.heightMm, lengthM: 0, gross: 0, net: 0, panels: 0, inventory: 0, excluded: 0 }
    if (calculation.ready) { group.lengthM += Number(mark.lengthM) || 0; group.gross += calculation.grossAreaM2; group.net += calculation.netAreaM2; group.panels += calculation.panelCount; group.inventory += Number(mark.inventoryPanels) || 0 } else group.excluded += 1
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({ ...group, shortage: Math.max(0, group.panels - group.inventory), order: Math.max(0, group.panels - group.inventory) }))
})
const presetSummary = computed(() => {
  const groups = new Map<string, { name: string; color: string; count: number; lengthM: number; gross: number; net: number; panels: number }>()
  for (const row of markingRows.value) {
    if (!row.mark.presetId) continue
    const group = groups.get(row.mark.presetId) || { name: row.mark.presetName || '삭제된 프리셋', color: row.mark.color || '#64748b', count: 0, lengthM: 0, gross: 0, net: 0, panels: 0 }
    group.count += 1
    if (row.calculation.ready) { group.lengthM += row.mark.lengthM || 0; group.gross += row.calculation.grossAreaM2; group.net += row.calculation.netAreaM2; group.panels += row.calculation.panelCount }
    groups.set(row.mark.presetId, group)
  }
  return [...groups.values()]
})
const projectSummary = computed(() => ({
  drawingCount: drawings.value.length,
  classifiedCount: drawings.value.filter((drawing) => drawing.kind !== 'other').length,
  confirmedSpecCount: drawings.value.reduce((count, drawing) => count + drawing.specs.filter((spec) => spec.status === '확인 완료').length, 0),
  pendingSpecCount: drawings.value.reduce((count, drawing) => count + drawing.specs.filter((spec) => spec.status === '검토 필요').length, 0),
}))
function zoneWarnings(zone: ReviewZone, drawing = selectedDrawing.value) {
  if (!drawing) return []
  const measurements = (drawing.measurements || []).filter((item) => item.reviewZoneId === zone.id)
  const marks = (drawing.marks || []).filter((item) => item.reviewZoneId === zone.id)
  const warnings: string[] = []
  if (!drawing.pageScales?.[zone.pageNumber]) warnings.push('축척 미설정')
  if (measurements.some((item) => item.kind === 'wall' && !finite(item.heightMm))) warnings.push('높이 누락')
  if (measurements.some((item) => item.kind === 'wall' && !item.material.trim())) warnings.push('자재 누락')
  if (measurements.some((item) => item.kind === 'opening') && !measurements.some((item) => item.kind === 'wall' && item.openingIds.includes(item.id))) warnings.push('개구부 미확인')
  const openings = (drawing.measurements || []).filter((item) => item.kind === 'opening' && item.reviewZoneId === zone.id)
  if (openings.some((opening) => opening.status === '확인 완료' && !opening.linkedWallId && !(drawing.measurements || []).some((wall) => wall.kind === 'wall' && wall.openingIds.includes(opening.id)))) warnings.push('벽체 미연결 개구부')
  if (openings.some((opening) => !finite(opening.openingWidthMm) || !finite(opening.openingHeightMm))) warnings.push('개구부 규격 누락')
  if (marks.some((item) => !finite(item.heightMm))) warnings.push('높이 누락')
  if (marks.some((item) => !item.material.trim())) warnings.push('자재 누락')
  return warnings
}
const zoneDashboard = computed(() => (selectedDrawing.value?.reviewZones || []).map((zone) => {
  const measurements = (selectedDrawing.value?.measurements || []).filter((item) => item.reviewZoneId === zone.id)
  const marks = (selectedDrawing.value?.marks || []).filter((item) => item.reviewZoneId === zone.id)
  const all = [...measurements, ...marks]
  const completed = all.filter((item) => item.status === '확인 완료').length
  const pending = all.filter((item) => item.status !== '확인 완료').length
  return { zone, total: all.length, completed, pending, warnings: zoneWarnings(zone) }
}))
const filteredZones = computed(() => zoneDashboard.value.filter((row) => reviewFilter.value === 'all' || (reviewFilter.value === 'unreviewed' && row.zone.status === '미검토') || (reviewFilter.value === 'excluded' && (row.pending > 0 || row.warnings.length > 0)) || (reviewFilter.value === 'height-missing' && row.warnings.includes('높이 누락'))))
const preflightIssues = computed(() => {
  const drawing = selectedDrawing.value
  if (!drawing) return []
  const issues: string[] = []
  if (drawing.kind === 'other') issues.push('도면 유형을 확인하거나 수동 지정하세요.')
  if (drawing.hybridModel?.status !== '확인 완료') issues.push('3D 가로·세로·벽체 높이가 아직 확인 완료되지 않았습니다.')
  const pendingOpenings = drawing.hybridModel?.openings.filter((opening) => opening.status === '검토 필요').length || 0
  if (pendingOpenings) issues.push(`문·창호 개구부 ${pendingOpenings}건이 검토 필요입니다.`)
  const pendingSpecs = drawing.specs.filter((spec) => spec.status === '검토 필요').length
  if (pendingSpecs) issues.push(`사양·산출 항목 ${pendingSpecs}건이 검토 필요입니다.`)
  const excludedMarks = (drawing.marks || []).filter((mark) => !calculateManualMarking(mark).ready).length
  if (excludedMarks) issues.push(`도면 마킹 ${excludedMarks}건이 산출 제외 / 검토 필요입니다.`)
  if (!drawing.specs.some((spec) => spec.status === '확인 완료')) issues.push('확인 완료된 산출 항목이 아직 없습니다.')
  const unfinishedZones = (drawing.reviewZones || []).filter((zone) => zone.status !== '검토 완료' && (zone.status !== '보류' || drawing.blockOrderForHeldZones))
  if (unfinishedZones.length) issues.push(`검토 완료되지 않은 구역 ${unfinishedZones.length}곳이 있어 발주 전 확인이 필요합니다.`)
  return issues
})

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function newSpec(): ManualSpec {
  return { id: crypto.randomUUID(), item: '', specification: '', unit: '개', quantity: 0, unitPrice: 0, inventory: 0, confidence: '낮음', status: '검토 필요', memo: '', origin: 'manual' }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      if (!request.result.objectStoreNames.contains(PRESET_STORE_NAME)) request.result.createObjectStore(PRESET_STORE_NAME, { keyPath: 'id' })
      if (!request.result.objectStoreNames.contains(OPENING_PRESET_STORE_NAME)) request.result.createObjectStore(OPENING_PRESET_STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function loadDrawings() {
  try {
    const db = await openDatabase()
    const records = await new Promise<ManualDrawing[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as ManualDrawing[])
      request.onerror = () => reject(request.error)
    })
    db.close()
    drawings.value = records.map((drawing) => ({
      ...drawing,
      hybridModel: drawing.hybridModel ? { ...defaultHybridModel(), ...drawing.hybridModel, candidates: drawing.hybridModel.candidates || [], openings: drawing.hybridModel.openings || [] } : defaultHybridModel(),
      marks: drawing.marks || [],
      pageScales: drawing.pageScales || {},
      measurements: drawing.measurements || [],
      reviewZones: drawing.reviewZones || [],
      blockOrderForHeldZones: drawing.blockOrderForHeldZones ?? false,
      panelCatalog: drawing.panelCatalog || defaultPanelCatalog(),
      panelStock: drawing.panelStock || [],
      reportInfo: drawing.reportInfo || { siteName: '', projectName: '', author: '', version: 'v1.0', lastPrintedAt: '' },
      drawingGroup: drawing.drawingGroup || drawing.name.replace(/\.[^.]+$/, ''), versionNumber: drawing.versionNumber || 1, versionMemo: drawing.versionMemo || '', changeReason: drawing.changeReason || '', isCurrentVersion: drawing.isCurrentVersion ?? true,
    })).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    if (drawings.value[0]) await selectDrawing(drawings.value[0].id)
  } catch {
    message.value = '브라우저 저장소를 열지 못했습니다. 개인정보 보호 모드에서는 저장이 제한될 수 있습니다.'
  } finally {
    isLoading.value = false
    // The preview canvas is rendered only after the loading placeholder leaves
    // the DOM; otherwise a restored PDF list appears without its first page.
    await nextTick()
    await renderPage()
  }
}

const samplePresets = (): SpecPreset[] => [
  { id: 'sample-panel-3000', name: '샘플 · 75T 판넬 3m', material: '샌드위치패널 75T', heightMm: 3000, effectiveWidthMm: 1000, color: '#0f766e', status: '검토 필요', sample: true },
  { id: 'sample-panel-4200', name: '샘플 · 75T 판넬 4.2m', material: '샌드위치패널 75T', heightMm: 4200, effectiveWidthMm: 1000, color: '#2563eb', status: '검토 필요', sample: true },
]
async function loadPresets() {
  try {
    const db = await openDatabase()
    const records = await new Promise<SpecPreset[]>((resolve, reject) => {
      const request = db.transaction(PRESET_STORE_NAME, 'readonly').objectStore(PRESET_STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as SpecPreset[])
      request.onerror = () => reject(request.error)
    })
    db.close(); presets.value = records.length ? records : samplePresets()
    if (!records.length) await persistPresets()
  } catch { presets.value = samplePresets() }
}
async function persistPresets() {
  const db = await openDatabase()
  const transaction = db.transaction(PRESET_STORE_NAME, 'readwrite')
  const store = transaction.objectStore(PRESET_STORE_NAME)
  store.clear(); presets.value.forEach((preset) => store.put({ ...preset }))
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
  db.close()
}
function resetPresetDraft() { presetDraft.value = { id: '', name: '', material: '', heightMm: 3000, effectiveWidthMm: 1000, color: '#0f766e', status: '검토 필요' }; editingPresetId.value = '' }
function savePreset() {
  const draft = presetDraft.value
  if (!draft.name.trim() || !draft.material.trim() || !finite(draft.heightMm) || !finite(draft.effectiveWidthMm)) { message.value = '프리셋 이름·자재·높이·유효 폭을 입력하세요.'; return }
  const preset = { ...draft, id: editingPresetId.value || crypto.randomUUID(), name: draft.name.trim(), material: draft.material.trim(), sample: false }
  const index = presets.value.findIndex((item) => item.id === preset.id)
  if (index >= 0) presets.value[index] = preset; else presets.value.push(preset)
  activePresetId.value = preset.id; void persistPresets(); resetPresetDraft()
}
function editPreset(preset: SpecPreset) { presetDraft.value = { ...preset }; editingPresetId.value = preset.id }
function duplicatePreset(preset: SpecPreset) { presetDraft.value = { ...preset, id: '', name: `${preset.name} 복제`, sample: false }; editingPresetId.value = '' }
function deletePreset(id: string) { presets.value = presets.value.filter((preset) => preset.id !== id); if (activePresetId.value === id) activePresetId.value = ''; void persistPresets() }
function selectPreset(preset: SpecPreset) { activePresetId.value = preset.id; startMeasurement('wall') }
const sampleOpeningPresets = (): OpeningPreset[] => [{ id: 'sample-door-1000-2100', name: '샘플 · 출입문 1000×2100', type: '문', widthMm: 1000, heightMm: 2100, quantity: 1, status: '검토 필요' }, { id: 'sample-window-1200-1200', name: '샘플 · 창호 1200×1200', type: '창호', widthMm: 1200, heightMm: 1200, quantity: 1, status: '검토 필요' }]
async function loadOpeningPresets() { try { const db = await openDatabase(); const records = await new Promise<OpeningPreset[]>((resolve, reject) => { const request = db.transaction(OPENING_PRESET_STORE_NAME, 'readonly').objectStore(OPENING_PRESET_STORE_NAME).getAll(); request.onsuccess = () => resolve(request.result as OpeningPreset[]); request.onerror = () => reject(request.error) }); db.close(); openingPresets.value = records.length ? records : sampleOpeningPresets(); if (!records.length) await persistOpeningPresets() } catch { openingPresets.value = sampleOpeningPresets() } }
async function persistOpeningPresets() { const db = await openDatabase(); const transaction = db.transaction(OPENING_PRESET_STORE_NAME, 'readwrite'); const store = transaction.objectStore(OPENING_PRESET_STORE_NAME); store.clear(); openingPresets.value.forEach((preset) => store.put({ ...preset })); await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) }); db.close() }
function saveOpeningPreset() { const draft = openingPresetDraft.value; if (!draft.name.trim() || !finite(draft.widthMm) || !finite(draft.heightMm) || !finite(draft.quantity)) { message.value = '개구부 프리셋 이름·가로·세로·수량을 입력하세요.'; return }; const preset = { ...draft, id: draft.id || crypto.randomUUID(), name: draft.name.trim() }; const index = openingPresets.value.findIndex((item) => item.id === preset.id); if (index >= 0) openingPresets.value[index] = preset; else openingPresets.value.push(preset); void persistOpeningPresets(); openingPresetDraft.value = { id: '', name: '', type: '문', widthMm: 1000, heightMm: 2100, quantity: 1, status: '검토 필요' } }
function selectOpeningPreset(preset: OpeningPreset) { activeOpeningPresetId.value = preset.id; startMeasurement('opening') }
function applyPresetToSelected(presetId: string) {
  const preset = presets.value.find((item) => item.id === presetId)
  const measurement = selectedMeasurement.value
  if (!preset || !measurement || measurement.kind !== 'wall') return
  Object.assign(measurement, { presetId: preset.id, presetName: preset.name, name: measurement.name || preset.name, material: preset.material, heightMm: preset.heightMm, effectiveWidthMm: preset.effectiveWidthMm, status: preset.status, color: preset.color })
  schedulePersist(); void nextTick(renderPage)
}

async function loadLocalTestManifest() {
  try {
    const response = await fetch('/local-drawing-manifest.json', { cache: 'no-store' })
    if (response.ok) localTestManifest.value = await response.json() as LocalTestManifest
  } catch {
    // This optional file is intentionally available only in a local dev setup.
  }
}

async function persist() {
  try {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    // IndexedDB cannot clone Vue's reactive Proxy. Store a plain record so PDF
    // blobs and manual inputs survive a browser refresh without serialization.
    drawings.value.forEach((drawing) => store.put({
      id: drawing.id,
      name: drawing.name,
      size: drawing.size,
      uploadedAt: drawing.uploadedAt,
      status: drawing.status,
      kind: drawing.kind,
      blob: drawing.blob,
      specs: drawing.specs.map((spec) => ({ ...spec })),
      marks: (drawing.marks || []).map((mark) => ({ ...mark })),
      pageScales: drawing.pageScales ? { ...drawing.pageScales } : {},
      measurements: (drawing.measurements || []).map((measurement) => ({ ...measurement, points: measurement.points.map((point) => ({ ...point })), openingIds: [...measurement.openingIds] })),
      reviewZones: (drawing.reviewZones || []).map((zone) => ({ ...zone })),
      blockOrderForHeldZones: Boolean(drawing.blockOrderForHeldZones),
      panelCatalog: (drawing.panelCatalog || []).map((item) => ({ ...item })), panelStock: (drawing.panelStock || []).map((item) => ({ ...item })),
      reportInfo: drawing.reportInfo ? { ...drawing.reportInfo } : undefined,
      drawingGroup: drawing.drawingGroup, versionNumber: drawing.versionNumber, versionMemo: drawing.versionMemo, changeReason: drawing.changeReason, isCurrentVersion: drawing.isCurrentVersion,
      hybridModel: drawing.hybridModel ? { ...drawing.hybridModel, sourceNames: [...drawing.hybridModel.sourceNames], candidates: drawing.hybridModel.candidates.map((candidate) => ({ ...candidate })), openings: drawing.hybridModel.openings.map((opening) => ({ ...opening })) } : undefined,
    } satisfies ManualDrawing))
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  } catch {
    message.value = '입력값을 브라우저에 저장하지 못했습니다. 저장 공간을 확인하세요.'
  }
}

function schedulePersist() {
  if (isLoading.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void persist(), 250)
}

async function chooseFiles(files: File[]) {
  const accepted: ManualDrawing[] = []
  for (const file of files) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      message.value = `${file.name}: PDF 파일만 추가할 수 있습니다.`
      continue
    }
    if (file.size > MAX_FILE_SIZE) {
      message.value = `${file.name}: 파일당 50MB 이하만 추가할 수 있습니다.`
      continue
    }
    accepted.push({ id: crypto.randomUUID(), name: file.name, size: file.size, uploadedAt: new Date().toISOString(), status: '검토 준비', kind: 'other', blob: file, specs: [], hybridModel: defaultHybridModel(), marks: [], pageScales: {}, measurements: [], reviewZones: [], blockOrderForHeldZones: false, panelCatalog: defaultPanelCatalog(), panelStock: [], reportInfo: { siteName: '', projectName: '', author: '', version: 'v1.0', lastPrintedAt: '' }, drawingGroup: file.name.replace(/\.[^.]+$/, ''), versionNumber: 1, versionMemo: '', changeReason: '', isCurrentVersion: true })
  }
  if (!accepted.length) return
  drawings.value = [...accepted, ...drawings.value]
  await persist()
  await selectDrawing(accepted[0].id)
  message.value = `${accepted.length}개 PDF를 브라우저 저장소에 추가했습니다. 서버로 전송하지 않습니다.`
}

function onInput(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) void chooseFiles([...input.files])
  input.value = ''
}

async function selectDrawing(id: string) {
  selectedId.value = id
  pageNumber.value = 1
  zoom.value = 1
  const drawing = drawings.value.find((item) => item.id === id)
  if (!drawing) return
  try {
    renderTask?.cancel()
    renderTask = null
    if (pdfDocument) {
      await pdfDocument.destroy()
      pdfDocument = null
    }
    // PDF.js transfers its input buffer to the worker. Give it a copy so the
    // browser-owned PDF Blob remains intact for IndexedDB persistence.
    const sourceBytes = new Uint8Array(await drawing.blob.arrayBuffer())
    pdfDocument = await pdfjsLib.getDocument({ data: sourceBytes.slice() }).promise
    pageCount.value = pdfDocument.numPages
    drawing.status = '검토 중'
    schedulePersist()
    await nextTick()
    await renderPage()
  } catch (error) {
    pageCount.value = 0
    console.warn('Manual PDF preview failed.', error)
    message.value = 'PDF를 미리보기로 열지 못했습니다. 파일이 손상되지 않았는지 확인하세요.'
  }
}

async function renderPage() {
  if (!pdfDocument || !canvas.value) return
  renderTask?.cancel()
  const page = await pdfDocument.getPage(pageNumber.value)
  const viewport = page.getViewport({ scale: zoom.value })
  const context = canvas.value.getContext('2d')
  if (!context) return
  canvas.value.width = Math.ceil(viewport.width)
  canvas.value.height = Math.ceil(viewport.height)
  renderTask = page.render({ canvasContext: context, viewport })
  try { await renderTask.promise; drawMeasurementOverlay(context) } catch (error) { if (!(error instanceof Error) || error.name !== 'RenderingCancelledException') throw error }
}

function drawMeasurementOverlay(context: CanvasRenderingContext2D) {
  const drawing = selectedDrawing.value
  const element = canvas.value
  if (!drawing || !element) return
  const point = (value: MeasurementPoint) => [value.x * element.width, value.y * element.height] as const
  const path = (points: MeasurementPoint[], color: string, closed: boolean) => {
    if (!points.length) return
    context.beginPath(); const [firstX, firstY] = point(points[0]); context.moveTo(firstX, firstY)
    points.slice(1).forEach((value) => { const [x, y] = point(value); context.lineTo(x, y) })
    if (closed) context.closePath()
    context.strokeStyle = color; context.lineWidth = 4; context.setLineDash([]); context.stroke()
    if (closed) { context.fillStyle = `${color}33`; context.fill() }
  }
  const scale = drawing.pageScales?.[pageNumber.value]
  if (scale) { context.setLineDash([10, 6]); context.strokeStyle = '#ec4899'; context.lineWidth = 4; const [x1, y1] = point(scale.start); const [x2, y2] = point(scale.end); context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke(); context.setLineDash([]); context.fillStyle = '#be185d'; context.font = 'bold 16px sans-serif'; context.fillText(`${scale.referenceMm}mm`, x1 + 8, y1 - 8) }
  ;(drawing.reviewZones || []).filter((zone) => zone.pageNumber === pageNumber.value).forEach((zone) => { const color = zone.status === '검토 완료' ? '#16a34a' : zone.status === '보류' ? '#9333ea' : zone.status === '마킹 중' ? '#d97706' : '#64748b'; const x = zone.x * element.width; const y = zone.y * element.height; const width = zone.width * element.width; const height = zone.height * element.height; context.strokeStyle = color; context.lineWidth = selectedZoneId.value === zone.id ? 5 : 3; context.setLineDash([8, 5]); context.strokeRect(x, y, width, height); context.setLineDash([]); context.fillStyle = `${color}22`; context.fillRect(x, y, width, height); context.fillStyle = color; context.font = 'bold 14px sans-serif'; context.fillText(zone.name, x + 6, y + 18) })
  ;(drawing.measurements || []).filter((measurement) => measurement.pageNumber === pageNumber.value).forEach((measurement) => path(measurement.points, measurementColor(measurement.kind, measurement.color), measurement.kind !== 'wall'))
}

const markColors = ['#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6']
function markPoint(event: PointerEvent) {
  const bounds = (event.currentTarget as SVGElement).getBoundingClientRect()
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
}
function markColor(material: string, heightMm: number) {
  let hash = 0
  for (const character of `${material}-${heightMm}`) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return markColors[Math.abs(hash) % markColors.length] || markColors[0]
}
function pointerDown(event: PointerEvent) {
  if (measurementMode.value !== 'none') { addMeasurementPoint(markPoint(event)); return }
  if ((!markingEnabled.value && !zoneDrawingEnabled.value) || isCompact.value || !selectedDrawing.value) return
  const point = markPoint(event)
  dragStart.value = point
  draftRect.value = { ...point, width: 0, height: 0 }
  ;(event.currentTarget as SVGElement).setPointerCapture(event.pointerId)
}
function pointerMove(event: PointerEvent) {
  if (!dragStart.value) return
  const point = markPoint(event)
  draftRect.value = { x: Math.min(dragStart.value.x, point.x), y: Math.min(dragStart.value.y, point.y), width: Math.abs(point.x - dragStart.value.x), height: Math.abs(point.y - dragStart.value.y) }
}
function pointerUp() {
  const rectangle = draftRect.value
  if (!rectangle || rectangle.width < .01 || rectangle.height < .01 || !selectedDrawing.value) { dragStart.value = null; draftRect.value = null; return }
  if (zoneDrawingEnabled.value) {
    const zone: ReviewZone = { id: crypto.randomUUID(), pageNumber: pageNumber.value, ...rectangle, name: `검토 구역 ${pageZones.value.length + 1}`, status: '미검토', holdReason: '' }
    selectedDrawing.value.reviewZones ||= []; selectedDrawing.value.reviewZones.push(zone); selectedZoneId.value = zone.id; zoneDrawingEnabled.value = false
  } else if (repositioningMarkId.value) {
    const mark = selectedDrawing.value.marks?.find((item) => item.id === repositioningMarkId.value)
    if (mark) Object.assign(mark, rectangle)
    repositioningMarkId.value = ''
  } else {
    const mark: DrawingMark = { id: crypto.randomUUID(), pageNumber: pageNumber.value, ...rectangle, color: markColor('', 0), colorMode: 'auto', zoneName: `구역 ${((selectedDrawing.value.marks?.length || 0) + 1)}`, lengthM: 0, heightMm: 0, material: '', effectiveWidthMm: 1000, inventoryPanels: 0, status: '검토 필요', memo: '', reviewZoneId: selectedZoneId.value || undefined }
    selectedDrawing.value.marks ||= []
    selectedDrawing.value.marks.push(mark)
    selectedMarkId.value = mark.id
  }
  dragStart.value = null; draftRect.value = null; schedulePersist()
}
function selectMark(id: string) { selectedMarkId.value = id; markingEnabled.value = false }
function removeMark(id: string) { if (selectedDrawing.value) selectedDrawing.value.marks = (selectedDrawing.value.marks || []).filter((mark) => mark.id !== id); if (selectedMarkId.value === id) selectedMarkId.value = ''; schedulePersist() }
function syncMarkColor(mark: DrawingMark) { if (mark.colorMode === 'auto') mark.color = markColor(mark.material, mark.heightMm); schedulePersist() }
function setMarkHeight(value: number) { if (selectedMark.value) { selectedMark.value.heightMm = value; syncMarkColor(selectedMark.value) } }
function setMarkMaterial(value: string) { if (selectedMark.value) { selectedMark.value.material = value; syncMarkColor(selectedMark.value) } }

function startMeasurement(mode: 'scale' | MeasurementKind) {
  if (isCompact.value) return
  measurementMode.value = mode
  measurementDraft.value = []
  markingEnabled.value = false
  message.value = mode === 'scale' ? '도면의 기준 치수 시작점과 끝점을 차례로 클릭하세요.' : '도면 위를 클릭해 점을 추가한 뒤 ‘측정 완료’를 누르세요.'
}
function addMeasurementPoint(point: MeasurementPoint) {
  if (!selectedDrawing.value || isCompact.value) return
  if (measurementMode.value === 'scale') {
    const points = [...measurementDraft.value, point]
    if (points.length < 2) { measurementDraft.value = points; return }
    const scale = createPageScale(points[0], points[1], scaleReferenceMm.value)
    if (!scale) { message.value = '기준선과 실제 길이는 0보다 커야 합니다.'; measurementDraft.value = []; return }
    selectedDrawing.value.pageScales ||= {}
    selectedDrawing.value.pageScales[pageNumber.value] = scale
    measurementDraft.value = []; measurementMode.value = 'none'; message.value = `${scale.referenceMm.toLocaleString()}mm 기준선으로 이 페이지 축척을 보정했습니다.`; schedulePersist(); void nextTick(renderPage); return
  }
  measurementDraft.value = [...measurementDraft.value, point]
}
function finishMeasurement() {
  const kind = measurementMode.value
  if (!selectedDrawing.value || kind === 'none' || kind === 'scale') return
  const minPoints = kind === 'wall' ? 2 : 3
  if (measurementDraft.value.length < minPoints) { message.value = kind === 'wall' ? '벽체 길이선은 2점 이상 필요합니다.' : '면적 구역은 3점 이상 필요합니다.'; return }
  const preset = kind === 'wall' && activePreset.value ? snapshotPreset({ presetId: activePreset.value.id, presetName: activePreset.value.name, material: activePreset.value.material, heightMm: activePreset.value.heightMm, effectiveWidthMm: activePreset.value.effectiveWidthMm, color: activePreset.value.color, status: activePreset.value.status }) : null
  const openingPreset = kind === 'opening' ? openingPresets.value.find((item) => item.id === activeOpeningPresetId.value) : null
  const measurement: DrawingMeasurement = { id: crypto.randomUUID(), pageNumber: pageNumber.value, kind, points: measurementDraft.value, name: `${preset?.presetName || openingPreset?.name || (kind === 'wall' ? '벽체' : kind === 'opening' ? '개구부' : '면적')} ${pageMeasurements.value.length + 1}`, manualLengthM: 0, heightMm: preset?.heightMm || 0, material: preset?.material || '', effectiveWidthMm: preset?.effectiveWidthMm || 1000, inventoryPanels: 0, status: preset?.status || openingPreset?.status || '검토 필요', openingIds: [], memo: '', presetId: preset?.presetId, presetName: preset?.presetName, color: preset?.color, openingType: openingPreset?.type || '문', openingWidthMm: openingPreset?.widthMm || 0, openingHeightMm: openingPreset?.heightMm || 0, openingQuantity: openingPreset?.quantity || 1, openingPresetId: openingPreset?.id, openingPresetName: openingPreset?.name }
  measurement.reviewZoneId = selectedZoneId.value || undefined
  selectedDrawing.value.measurements ||= []; selectedDrawing.value.measurements.push(measurement)
  selectedMeasurementId.value = measurement.id; measurementDraft.value = []; measurementMode.value = (preset && kind === 'wall') || (openingPreset && kind === 'opening') ? kind : 'none'; schedulePersist(); void nextTick(renderPage)
}
function removeMeasurement(id: string) {
  if (!selectedDrawing.value) return
  selectedDrawing.value.measurements = (selectedDrawing.value.measurements || []).filter((measurement) => measurement.id !== id)
  selectedDrawing.value.measurements.forEach((measurement) => { measurement.openingIds = measurement.openingIds.filter((openingId) => openingId !== id) })
  if (selectedMeasurementId.value === id) selectedMeasurementId.value = ''
  schedulePersist(); void nextTick(renderPage)
}
function removeZone(id: string) { if (!selectedDrawing.value) return; selectedDrawing.value.reviewZones = (selectedDrawing.value.reviewZones || []).filter((zone) => zone.id !== id); selectedDrawing.value.measurements.forEach((measurement) => { if (measurement.reviewZoneId === id) measurement.reviewZoneId = undefined }); selectedDrawing.value.marks.forEach((mark) => { if (mark.reviewZoneId === id) mark.reviewZoneId = undefined }); if (selectedZoneId.value === id) selectedZoneId.value = ''; schedulePersist(); void nextTick(renderPage) }
async function goToZone(zone: ReviewZone) { selectedZoneId.value = zone.id; if (zone.pageNumber !== pageNumber.value) { pageNumber.value = zone.pageNumber; await nextTick(); await renderPage() } }
function measurementLabel(measurement: DrawingMeasurement) { return measurement.kind === 'wall' ? '벽체 길이선' : measurement.kind === 'opening' ? '개구부' : '면적 구역' }
function measurementColor(kind: MeasurementKind, customColor?: string) { return customColor || (kind === 'wall' ? '#0f766e' : kind === 'opening' ? '#dc2626' : '#2563eb') }

function addSpec() {
  if (!selectedDrawing.value) return
  selectedDrawing.value.specs.push(newSpec())
  schedulePersist()
}

function removeSpec(id: string) {
  if (!selectedDrawing.value) return
  selectedDrawing.value.specs = selectedDrawing.value.specs.filter((spec) => spec.id !== id)
  schedulePersist()
}

function ensureHybridDraft() {
  if (!selectedDrawing.value) return null
  selectedDrawing.value.hybridModel ||= defaultHybridModel()
  return selectedDrawing.value.hybridModel
}

function valuesFromPdfText(text: string) {
  return [...text.matchAll(/(?<!\d)(\d{1,2}(?:[, ]\d{3})+|\d{4,5})(?!\d)/g)]
    .map((match) => Number(match[1].replace(/[ ,]/g, '')))
    .filter((value) => value >= 1000 && value <= 50000)
}

function inferDrawingKind(name: string, text: string): DrawingKind {
  const source = `${name} ${text}`.toLowerCase()
  if (/평면|floor\s*plan|\bplan\b/.test(source)) return 'floor'
  if (/입면|elevation/.test(source)) return 'elevation'
  if (/단면|section/.test(source)) return 'section'
  if (/상세|detail/.test(source)) return 'detail'
  return 'other'
}

async function createBrowserDraft() {
  const draft = ensureHybridDraft()
  if (!draft || !drawings.value.length) return
  message.value = '브라우저에서 PDF 텍스트와 파일명을 읽어 검토용 초안을 만드는 중입니다.'
  const values: Array<{ value: number; sourceName: string }> = []
  const sourceNames: string[] = []
  for (const drawing of drawings.value) {
    try {
      const bytes = new Uint8Array(await drawing.blob.arrayBuffer())
      const document = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
      const pages = Math.min(document.numPages, 2)
      let text = ''
      for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        text += ` ${content.items.map((item) => ('str' in item ? item.str : '')).join(' ')}`
      }
      const inferredKind = inferDrawingKind(drawing.name, text)
      drawing.kind = inferredKind
      drawing.status = '검토 중'
      values.push(...valuesFromPdfText(text).map((value) => ({ value, sourceName: drawing.name })))
      sourceNames.push(drawing.name)
      await document.destroy()
    } catch {
      // A scanned/image-only PDF can still be used through manual input.
    }
  }
  const unique = values.filter((hit, index) => values.findIndex((other) => other.value === hit.value) === index)
  // These are candidates only: PDF text has no reliable semantic relationship
  // between a number and a building edge without a dedicated CAD/BIM parser.
  const length = unique[0]
  const width = unique.find((hit) => hit.value !== length?.value)
  const height = unique.find((hit) => hit.value >= 2100 && hit.value <= 6000 && hit.value !== length?.value && hit.value !== width?.value)
  draft.lengthMm = length?.value || draft.lengthMm
  draft.widthMm = width?.value || draft.widthMm
  draft.wallHeightMm = height?.value || draft.wallHeightMm
  draft.sourceNames = sourceNames
  draft.candidates = [
    length && { label: '가로 후보', value: length.value, sourceName: length.sourceName, status: '검토 필요' as const },
    width && { label: '세로 후보', value: width.value, sourceName: width.sourceName, status: '검토 필요' as const },
    height && { label: '벽체 높이 후보', value: height.value, sourceName: height.sourceName, status: '검토 필요' as const },
  ].filter(Boolean) as HybridModelDraft['candidates']
  draft.status = '검토 필요'
  draft.note = sourceNames.length
    ? '브라우저 PDF 텍스트에서 숫자 후보를 채운 초안입니다. 도면의 치수선·층고와 대조한 뒤에만 확인 완료로 바꾸세요.'
    : '텍스트를 읽을 수 없는 PDF입니다. 도면을 보고 치수를 직접 입력하세요.'
  schedulePersist()
  message.value = sourceNames.length ? '자동 초안을 만들었습니다. 모든 값은 아직 검토 필요입니다.' : '읽을 수 있는 PDF 텍스트가 없어 수동 입력이 필요합니다.'
}

function addGeometryTakeoffDraft() {
  if (!selectedDrawing.value || !hybridCanRender.value || !hybridWallArea.value) return
  const exists = selectedDrawing.value.specs.some((spec) => spec.origin === 'geometry-draft')
  if (exists) {
    message.value = '3D 개략 면적 산출 초안이 이미 있습니다. 값을 수정하거나 기존 초안을 삭제하세요.'
    return
  }
  selectedDrawing.value.specs.push({
    id: crypto.randomUUID(),
    item: '외벽 마감 면적',
    specification: '3D 개략 모델 기준',
    unit: '㎡',
    quantity: hybridNetWallArea.value,
    unitPrice: 0,
    inventory: 0,
    confidence: '중간',
    status: '검토 필요',
    origin: 'geometry-draft',
    memo: `확인된 가로·세로·벽체 높이로 계산한 외벽 총면적 ${hybridWallArea.value}㎡에서 확인 완료 개구부 ${hybridOpeningArea.value}㎡를 차감한 ${hybridNetWallArea.value}㎡입니다. 실제 마감 범위를 도면에서 대조하세요.`,
  })
  schedulePersist()
  message.value = '3D 개략 면적을 사양 검토 초안으로 추가했습니다. 확인 완료 전에는 산출표에 반영되지 않습니다.'
}

function addOpeningDraft() {
  const draft = ensureHybridDraft()
  if (!draft) return
  draft.openings.push({ id: crypto.randomUUID(), label: '개구부', wallIndex: 0, type: 'window', widthMm: 0, heightMm: 0, sillHeightMm: 900, offsetMm: 0, status: '검토 필요' })
  schedulePersist()
}

function removeOpeningDraft(id: string) {
  const draft = ensureHybridDraft()
  if (!draft) return
  draft.openings = draft.openings.filter((opening) => opening.id !== id)
  schedulePersist()
}

function hybridEvidence(drawing: ManualDrawing | null): Evidence {
  return {
    fileId: drawing?.id || 'manual-hybrid-model',
    fileName: drawing?.name || '수동 입력',
    pageNumber: 1,
    drawingKind: 'unknown',
    method: 'user',
    note: '사용자가 도면 원본과 대조해 확인한 개략 3D 입력값입니다.',
  }
}

function buildHybridBuilding(draft: HybridModelDraft | null, drawing: ManualDrawing | null): BuildingGeometry {
  if (!draft || !finite(draft.lengthMm) || !finite(draft.widthMm) || !finite(draft.wallHeightMm)) {
    return { walls: [], footprint: [], roof: { isReady: false, kind: 'unknown', heightMm: null, pitchDeg: null, evidence: [], blockedReason: '가로·세로·벽체 높이를 입력하고 검토하세요.' }, isReady: false, blockedReason: '확인된 입력값이 필요합니다.' }
  }
  const length = draft.lengthMm / 1000
  const width = draft.widthMm / 1000
  const points = [{ x: 0, z: 0 }, { x: length, z: 0 }, { x: length, z: width }, { x: 0, z: width }]
  const evidence = hybridEvidence(drawing)
  const openingsByWall = new Map<number, Opening[]>()
  for (const opening of draft.openings.filter((item) => item.status === '확인 완료')) {
    const list = openingsByWall.get(opening.wallIndex) || []
    list.push({ id: opening.id, type: opening.type, label: opening.label || (opening.type === 'door' ? '문' : '창호'), widthMm: finite(opening.widthMm) || null, heightMm: finite(opening.heightMm) || null, sillHeightMm: opening.type === 'door' ? 0 : finite(opening.sillHeightMm), offsetMm: finite(opening.offsetMm), areaM2: Number((finite(opening.widthMm) * finite(opening.heightMm) / 1_000_000).toFixed(2)), confidence: 'medium', evidence: [evidence], excludedFromAutomaticTakeoff: false })
    openingsByWall.set(opening.wallIndex, list)
  }
  return {
    walls: points.map((start, index) => {
      const end = points[(index + 1) % points.length]
      const lengthMm = Math.round(Math.hypot(end.x - start.x, end.z - start.z) * 1000)
      return { wallId: `MANUAL-${index + 1}`, zone: '수동 검토 건물', zoneName: '수동 검토 건물', number: `W-${index + 1}`, wallNumber: `W-${index + 1}`, start: { x: start.x, y: 0, z: start.z }, end: { x: end.x, y: 0, z: end.z }, lengthMm, heightMm: draft.wallHeightMm, thicknessMm: draft.wallThicknessMm || 150, openings: openingsByWall.get(index) || [], color: index % 2 ? '#16836d' : '#2f6fed', confidence: 'medium', sourceReferences: [evidence], geometrySource: 'dimension-layout', validationStatus: draft.status === '확인 완료' ? '일부 검증 완료' : '확인 필요' }
    }),
    footprint: points,
    roof: { isReady: draft.roofKind === 'flat' || finite(draft.roofHeightMm), kind: draft.roofKind, heightMm: draft.roofKind === 'flat' ? null : draft.roofHeightMm, pitchDeg: null, evidence: [evidence], blockedReason: '지붕 형상은 입력값을 확인한 뒤에만 개략 표시합니다.' },
    isReady: true,
    partial: false,
    blockedReason: '도면 원본 대조가 완료된 개략 모델입니다. 구조·인허가·시공 모델은 아닙니다.',
  }
}

async function deleteDrawing(id: string) {
  const drawing = drawings.value.find((item) => item.id === id)
  if (!drawing || !confirm(`${drawing.name}과 검토 입력값을 이 브라우저에서 삭제할까요?`)) return
  const db = await openDatabase()
  db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id)
  db.close()
  drawings.value = drawings.value.filter((item) => item.id !== id)
  if (selectedId.value === id) await selectDrawing(drawings.value[0]?.id || '')
}

function formatSize(size: number) { return `${(size / 1024 / 1024).toFixed(1)} MB` }
function formatDate(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }
function formatWon(value: number) { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(value) }

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function downloadReviewReport() {
  const rows: unknown[][] = [['구분', '도면명', '도면 유형', '상태', '항목/이름', '규격/상세', '단위', '수량', '단가', '재고', '검토 메모']]
  for (const drawing of drawings.value) {
    rows.push(['도면', drawing.name, kindLabels[drawing.kind], drawing.status, '', '', '', '', '', '', 'PDF 원본은 보고서에 포함하지 않음'])
    const model = drawing.hybridModel
    if (model) rows.push(['3D 입력', drawing.name, kindLabels[drawing.kind], model.status, '가로×세로×벽체 높이', `${model.lengthMm}×${model.widthMm}×${model.wallHeightMm}mm`, '', '', '', '', model.note])
    for (const mark of drawing.marks || []) {
      const calculation = calculateManualMarking(mark)
      rows.push(['도면 마킹', drawing.name, kindLabels[drawing.kind], mark.status, mark.zoneName, `${mark.material || '자재 미입력'} · ${mark.heightMm || '높이 미입력'}mm`, '㎡', calculation.netAreaM2, '', mark.inventoryPanels, calculation.ready ? `예상 판넬 ${calculation.panelCount}장 · 개구부 ${mark.openingAreaM2 || 0}㎡` : `산출 제외: ${calculation.reason}`])
    }
    for (const opening of model?.openings || []) rows.push(['개구부', drawing.name, kindLabels[drawing.kind], opening.status, opening.label, `W-${opening.wallIndex + 1} · ${opening.type}`, '㎡', Number((finite(opening.widthMm) * finite(opening.heightMm) / 1_000_000).toFixed(2)), '', '', `${opening.widthMm}×${opening.heightMm}mm · 위치 ${opening.offsetMm}mm`])
    for (const spec of drawing.specs) rows.push([spec.origin === 'geometry-draft' ? '3D 계산 초안' : '사양', drawing.name, kindLabels[drawing.kind], spec.status, spec.item, spec.specification, spec.unit, spec.quantity, spec.unitPrice, spec.inventory, spec.memo])
  }
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `도면-검토-보고서-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  message.value = 'PDF 원본 없이 검토·산출 입력값만 CSV로 저장했습니다.'
}
function downloadCsv(name: string, rows: unknown[][]) { const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`; const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
function downloadWallCsv() { downloadCsv('벽체별-산출-근거', [['도면', '페이지', '벽체', '검토 구역', '길이m', '높이mm', '순면적㎡', '자재', '필요 길이mm', '판넬', '상태/제외 사유'], ...wallPlans.value.map((row) => [selectedDrawing.value?.name, row.wall.pageNumber, row.wall.name, row.wall.reviewZoneId || '', measurementLengthM(row.wall), row.wall.heightMm, row.net.netAreaM2, row.wall.material, row.plan.requiredLengthMm, row.plan.panelCount, row.plan.ready ? '검토 완료' : row.plan.reason])]) }
function downloadStockCsv() { downloadCsv('재고-자투리-사용계획', [['벽체', '후보', '상태', '길이mm'], ...orderPlans.value.flatMap((row) => row.plan.stockCandidates.map((candidate) => [row.wall.name, candidate.piece.id, candidate.status, candidate.piece.lengthMm]))]) }
function downloadOrderCsv() { downloadCsv('신규-발주-준비', [['벽체', '자재', '필요 길이mm', '신규 수량', '예상 금액'], ...orderPlans.value.map((row) => [row.wall.name, row.wall.material, row.plan.requiredLengthMm, row.plan.orderCount, row.plan.cost])]) }
function downloadWarningsCsv() { downloadCsv('검토필요-보류', [['구분', '이름', '사유'], ...wallPlans.value.filter((row) => !row.plan.ready).map((row) => ['벽체', row.wall.name, row.plan.reason]), ...zoneDashboard.value.filter((row) => row.zone.status !== '검토 완료').map((row) => ['검토 구역', row.zone.name, row.zone.status === '보류' ? row.zone.holdReason || '보류 사유 미입력' : row.warnings.join(', ') || row.zone.status])]) }
function printFieldReport() { reportInfo.value.lastPrintedAt = new Date().toISOString(); schedulePersist(); window.print() }
function activateDrawingVersion(copyMarks: boolean) { const drawing = selectedDrawing.value; if (!drawing) return; const source = copyMarks ? drawings.value.find((item) => item.id === versionCopySourceId.value) : undefined; const plain = drawings.value.map((item) => ({ id: item.id, group: item.drawingGroup || item.name, version: item.versionNumber || 1, current: Boolean(item.isCurrentVersion), marks: item.marks || [], printedAt: item.reportInfo?.lastPrintedAt })); const result = activateVersion(plain, drawing.id, source?.id); result.drawings.forEach((state) => { const target = drawings.value.find((item) => item.id === state.id); if (target) target.isCurrentVersion = state.current }); if (source) { drawing.marks = result.drawings.find((item) => item.id === drawing.id)?.marks || []; drawing.measurements = (source.measurements || []).map((item) => ({ ...item, status: '검토 필요', memo: `${item.memo ? `${item.memo} · ` : ''}이전 도면에서 가져온 값 / 재확인 필요` })); drawing.reviewZones = (source.reviewZones || []).map((item) => ({ ...item, id: crypto.randomUUID(), status: '마킹 중' })); } if (result.reprintRecommended) message.value = '도면 변경 이후 재출력 권장: 이전 버전의 발주 준비서를 다시 확인하세요.'; schedulePersist() }

watch([pageNumber, zoom], () => void nextTick(renderPage))
watch(drawings, schedulePersist, { deep: true })
const stopContinuousMarking = (event: KeyboardEvent) => { if (event.key === 'Escape') { measurementMode.value = 'none'; measurementDraft.value = []; activePresetId.value = '' } }
onMounted(() => { updateCompactMode(); window.addEventListener('resize', updateCompactMode); window.addEventListener('keydown', stopContinuousMarking); void loadDrawings(); void loadLocalTestManifest(); void loadPresets(); void loadOpeningPresets() })
onBeforeUnmount(() => { window.removeEventListener('resize', updateCompactMode); window.removeEventListener('keydown', stopContinuousMarking); pdfDocument?.destroy(); renderTask?.cancel(); if (saveTimer) clearTimeout(saveTimer); blobUrls.forEach((url) => URL.revokeObjectURL(url)) })
</script>

<template>
  <section class="manual-workspace panel-card" aria-labelledby="manual-pdf-title">
    <div class="panel-heading"><div><span class="panel-kicker">1차 구현 테스트</span><h2 id="manual-pdf-title">수동 PDF 검토·자재 산출</h2><p>PDF 원본과 입력값은 이 브라우저의 IndexedDB에만 저장됩니다. 수동 마킹·산출과 보조 분석은 로컬에서 처리하며, 실제 발주 전송은 추후 연동입니다.</p></div><span class="manual-safe-badge">서버 업로드 없음</span></div>
    <div class="manual-upload-row"><input ref="fileInput" class="visually-hidden" type="file" accept="application/pdf,.pdf" multiple @change="onInput"><button type="button" class="primary-button" @click="fileInput?.click()">PDF 여러 개 추가</button><small>PDF만 · 파일당 50MB 이하 · 새로고침 후에도 유지</small></div>
    <section v-if="localTestManifest" class="local-test-manifest"><div><span class="panel-kicker">로컬 개발 전용 테스트 프로젝트</span><h3>{{ localTestManifest.projectName }}</h3><p>아래 목록은 이 Mac의 파일명·용량만 표시합니다. 원본은 선택 전까지 브라우저가 읽지 않으며 GitHub에 포함되지 않습니다.</p></div><ol><li v-for="drawing in localTestManifest.drawings" :key="drawing.name"><b>{{ drawing.name }}</b><span>{{ drawing.kind ? kindLabels[drawing.kind] : '유형 미지정' }} · {{ formatSize(drawing.size) }}</span></li></ol></section>
    <p v-if="message" class="manual-message">{{ message }}</p>
    <div v-if="isLoading" class="manual-empty">저장된 검토 작업을 불러오는 중입니다.</div>
    <div v-else-if="!drawings.length" class="manual-empty">실제 도면 PDF를 추가하면 이곳에서 미리보기·사양 검토·수동 산출을 시작할 수 있습니다.</div>
    <div v-else class="manual-layout">
      <aside class="manual-list" aria-label="업로드한 PDF 목록"><article v-for="drawing in drawings" :key="drawing.id" :class="{ selected: selectedId === drawing.id }"><button type="button" @click="selectDrawing(drawing.id)"><b>{{ drawing.name }}</b><small>{{ formatSize(drawing.size) }} · {{ formatDate(drawing.uploadedAt) }}</small><span>{{ drawing.status }} · {{ kindLabels[drawing.kind] }}</span></button><button type="button" class="manual-delete" :aria-label="`${drawing.name} 삭제`" @click="deleteDrawing(drawing.id)">삭제</button></article></aside>
      <div v-if="selectedDrawing" class="manual-content">
        <div class="manual-toolbar"><label>도면 유형<select v-model="selectedDrawing.kind"><option v-for="(label, key) in kindLabels" :key="key" :value="key">{{ label }}</option></select></label><span>{{ pageCount ? `${pageNumber} / ${pageCount} 페이지` : '미리보기 준비 중' }}</span><button type="button" :disabled="pageNumber <= 1" @click="pageNumber--">이전</button><button type="button" :disabled="pageNumber >= pageCount" @click="pageNumber++">다음</button><button type="button" :disabled="zoom <= .5" @click="zoom = Math.max(.5, zoom - .25)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button type="button" :disabled="zoom >= 2" @click="zoom = Math.min(2, zoom + .25)">＋</button></div>
        <section class="version-card"><div class="manual-spec-heading"><div><span class="panel-kicker">도면 변경 이력</span><h3>{{ selectedDrawing.drawingGroup }} · 버전 {{ selectedDrawing.versionNumber }}</h3><p>{{ selectedDrawing.isCurrentVersion ? '현재 사용 버전' : '이전 버전 · 발주 CSV 생성 전 현재 버전을 확인하세요.' }}</p></div><button type="button" class="outline-button" @click="activateDrawingVersion(Boolean(versionCopySourceId))">현재 사용 버전으로 전환</button></div><div class="manual-spec-grid"><label>도면 그룹<input v-model="selectedDrawing.drawingGroup" @change="schedulePersist"></label><label>버전 번호<input v-model.number="selectedDrawing.versionNumber" min="1" type="number" @change="schedulePersist"></label><label>변경 사유<input v-model="selectedDrawing.changeReason" @change="schedulePersist"></label><label>작성 메모<input v-model="selectedDrawing.versionMemo" @change="schedulePersist"></label><label>이전 마킹 복사<select v-model="versionCopySourceId"><option value="">새로 마킹</option><option v-for="item in drawings.filter((item) => item.id !== selectedDrawing.id && item.drawingGroup === selectedDrawing.drawingGroup)" :key="item.id" :value="item.id">v{{ item.versionNumber }} · {{ item.name }}</option></select></label></div><p v-if="currentVersionWarning" class="zone-warning">{{ currentVersionWarning }}</p></section>
        <section class="preset-card"><div class="manual-spec-heading"><div><span class="panel-kicker">반복 마킹</span><h3>사양 프리셋</h3><p>{{ activePreset ? `${activePreset.name} 연속 벽체 마킹 중 · Esc 또는 마킹 종료로 끝냅니다.` : '프리셋을 선택하면 같은 사양으로 벽체 길이선을 연속 마킹합니다.' }}</p></div><button v-if="activePreset" type="button" class="outline-button" @click="activePresetId = ''; measurementMode = 'none'; measurementDraft = []">마킹 종료</button></div><div class="preset-buttons"><button v-for="preset in presets" :key="preset.id" type="button" :class="{ active: activePresetId === preset.id }" :style="{ borderColor: preset.color }" @click="selectPreset(preset)"><i :style="{ background: preset.color }" />{{ preset.name }}<small v-if="preset.sample">샘플</small></button></div><div class="preset-editor"><label>프리셋 이름<input v-model="presetDraft.name" placeholder="예: 외벽 판넬 3m"></label><label>자재<input v-model="presetDraft.material" placeholder="예: 샌드위치패널 75T"></label><label>높이(mm)<input v-model.number="presetDraft.heightMm" min="1" type="number"></label><label>유효 폭(mm)<input v-model.number="presetDraft.effectiveWidthMm" min="1" type="number"></label><label>색상<input v-model="presetDraft.color" type="color"></label><label>기본 상태<select v-model="presetDraft.status"><option>검토 필요</option><option>확인 완료</option></select></label><button type="button" class="primary-button" @click="savePreset">{{ editingPresetId ? '프리셋 수정 저장' : '프리셋 추가' }}</button><button v-if="editingPresetId" type="button" @click="resetPresetDraft">취소</button></div><div class="preset-manage"><span v-for="preset in presets" :key="`${preset.id}-manage`"><b>{{ preset.name }}</b><button type="button" @click="editPreset(preset)">수정</button><button type="button" @click="duplicatePreset(preset)">복제</button><button type="button" class="danger-text" @click="deletePreset(preset.id)">삭제</button></span></div></section>
        <section v-if="presetSummary.length" class="preset-summary"><b>프리셋별 실시간 집계</b><div v-for="row in presetSummary" :key="row.name"><i :style="{ background: row.color }" />{{ row.name }} · {{ row.count }}개 · {{ row.lengthM.toFixed(2) }}m · 총 {{ row.gross.toFixed(2) }}㎡ · 순 {{ row.net.toFixed(2) }}㎡ · {{ row.panels }}장</div></section>
        <section class="opening-card"><div class="manual-spec-heading"><div><span class="panel-kicker">문·창호 자동 차감</span><h3>개구부 프리셋 · 연속 마킹</h3><p>{{ activeOpeningPresetId ? '개구부 프리셋 연속 마킹 중입니다. Esc로 종료합니다.' : '확인 완료된 개구부만 연결 벽체에서 차감합니다.' }}</p></div><button v-if="activeOpeningPresetId" type="button" class="outline-button" @click="activeOpeningPresetId = ''; measurementMode = 'none'">개구부 마킹 종료</button></div><div class="preset-buttons"><button v-for="preset in openingPresets" :key="preset.id" type="button" :class="{ active: activeOpeningPresetId === preset.id }" @click="selectOpeningPreset(preset)">{{ preset.name }} · {{ preset.type }}<small>샘플 가능</small></button></div><div class="preset-editor"><label>이름<input v-model="openingPresetDraft.name"></label><label>종류<select v-model="openingPresetDraft.type"><option>문</option><option>창호</option><option>환기구</option><option>기타</option></select></label><label>가로(mm)<input v-model.number="openingPresetDraft.widthMm" min="1" type="number"></label><label>세로(mm)<input v-model.number="openingPresetDraft.heightMm" min="1" type="number"></label><label>수량<input v-model.number="openingPresetDraft.quantity" min="1" type="number"></label><label>상태<select v-model="openingPresetDraft.status"><option>검토 필요</option><option>확인 완료</option></select></label><button type="button" class="primary-button" @click="saveOpeningPreset">개구부 프리셋 저장</button></div><div v-for="opening in pageMeasurements.filter((item) => item.kind === 'opening')" :key="opening.id" class="opening-row"><b>{{ opening.name }}</b><label>종류<select v-model="opening.openingType" @change="schedulePersist"><option>문</option><option>창호</option><option>환기구</option><option>기타</option></select></label><label>가로<input v-model.number="opening.openingWidthMm" min="0" type="number" @change="schedulePersist"></label><label>세로<input v-model.number="opening.openingHeightMm" min="0" type="number" @change="schedulePersist"></label><label>수량<input v-model.number="opening.openingQuantity" min="1" type="number" @change="schedulePersist"></label><label>연결 벽체<select v-model="opening.linkedWallId" @change="schedulePersist"><option value="">미연결</option><option v-for="wall in pageMeasurements.filter((item) => item.kind === 'wall')" :key="wall.id" :value="wall.id">{{ wall.name }}</option></select></label><label>상태<select v-model="opening.status" @change="schedulePersist"><option>검토 필요</option><option>확인 완료</option></select></label><span>{{ openingArea(opening).toFixed(2) }}㎡</span></div></section>
        <section class="review-board"><div class="manual-spec-heading"><div><span class="panel-kicker">누락 방지 검토판</span><h3>검토 구역 → 프리셋 → 연속 마킹 → 완료</h3><p>도면에서 아직 확인하지 않은 구역과 누락된 사양을 점검합니다.</p></div><button type="button" class="outline-button" :disabled="isCompact" @click="zoneDrawingEnabled = !zoneDrawingEnabled; markingEnabled = false">{{ zoneDrawingEnabled ? '구역 만들기 종료' : '검토 구역 만들기' }}</button></div><div class="review-filters"><button v-for="filter in [{ id: 'all', label: '전체' }, { id: 'unreviewed', label: '미검토 구역만' }, { id: 'excluded', label: '산출 제외 항목만' }, { id: 'height-missing', label: '높이 누락만' }]" :key="filter.id" type="button" :class="{ active: reviewFilter === filter.id }" @click="reviewFilter = filter.id as typeof reviewFilter">{{ filter.label }}</button></div><div v-for="row in filteredZones" :key="row.zone.id" class="review-zone-row"><button type="button" @click="goToZone(row.zone)">{{ row.zone.name }} · {{ row.zone.pageNumber }}쪽</button><label>상태<select v-model="row.zone.status" @change="schedulePersist; nextTick(renderPage)"><option>미검토</option><option>마킹 중</option><option>검토 완료</option><option>보류</option></select></label><span>마킹 {{ row.total }} · 완료 {{ row.completed }} · 필요 {{ row.pending }}</span><span v-if="row.warnings.length" class="zone-warning">{{ row.warnings.join(', ') }}</span><label v-if="row.zone.status === '보류'">보류 사유<input v-model="row.zone.holdReason" @change="schedulePersist"></label><button type="button" class="danger-text" @click="removeZone(row.zone.id)">삭제</button></div><p v-if="!filteredZones.length" class="manual-empty">조건에 맞는 검토 구역이 없습니다.</p><label class="hold-block"><input v-model="selectedDrawing.blockOrderForHeldZones" type="checkbox" @change="schedulePersist"> 보류 구역도 발주 전 경고에 포함</label></section>
        <section class="scale-card"><div class="manual-spec-heading"><div><span class="panel-kicker">도면 측정</span><h3>페이지별 축척 보정</h3><p>{{ pageScale ? `보정 완료 · 기준선 ${pageScale.referenceMm.toLocaleString()}mm` : '축척 설정 필요 · 기준 치수 2개 이상으로 확인을 권장합니다.' }}</p></div><div class="scale-actions"><label>기준 실제 길이(mm)<input v-model.number="scaleReferenceMm" min="1" type="number"></label><button type="button" class="outline-button" :disabled="isCompact" @click="startMeasurement('scale')">축척 설정</button></div></div><p v-if="selectedMeasurement?.kind === 'wall'" class="preset-apply">선택 벽체에 다른 프리셋 적용: <select :value="selectedMeasurement.presetId" @change="applyPresetToSelected(($event.target as HTMLSelectElement).value)"><option value="">선택</option><option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></p><p v-if="isCompact" class="hybrid-blocked">모바일에서는 축척·측정점을 새로 만들지 않고, 기존 측정값의 조회·수정을 지원합니다.</p><div v-else class="quick-buttons"><button type="button" :class="{ active: measurementMode === 'wall' }" @click="startMeasurement('wall')">벽체 길이선</button><button type="button" :class="{ active: measurementMode === 'area' }" @click="startMeasurement('area')">면적 구역</button><button type="button" :class="{ active: measurementMode === 'opening' }" @click="startMeasurement('opening')">개구부</button><button v-if="measurementMode !== 'none' && measurementMode !== 'scale'" type="button" class="primary-button" @click="finishMeasurement">측정 완료</button><button v-if="measurementMode !== 'none'" type="button" @click="measurementMode = 'none'; measurementDraft = []">취소</button></div></section>
        <section class="marking-card"><div class="manual-spec-heading"><div><span class="panel-kicker">디지털 형광펜</span><h3>도면 구역 마킹</h3><p>사각형으로 표시한 위치는 구역 식별용입니다. 실제 산출은 아래 입력값만 사용합니다.</p></div><button type="button" class="outline-button" :disabled="isCompact" @click="markingEnabled = !markingEnabled">{{ markingEnabled ? '마킹 종료' : '사각형 마킹 시작' }}</button></div><p v-if="isCompact" class="hybrid-blocked">모바일에서는 마킹 위치를 새로 그리지 않고, 기존 마킹의 조회·수정·삭제를 지원합니다.</p><div ref="pdfStage" class="pdf-canvas-wrap pdf-stage" :class="{ marking: markingEnabled }"><canvas ref="canvas" aria-label="선택한 PDF 페이지 미리보기" /><svg v-if="canvas" class="mark-overlay" :viewBox="`0 0 ${canvas.width} ${canvas.height}`" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp"><g v-for="(mark, index) in pageMarks" :key="mark.id" @pointerdown.stop="selectMark(mark.id)"><rect :x="mark.x * canvas.width" :y="mark.y * canvas.height" :width="mark.width * canvas.width" :height="mark.height * canvas.height" :fill="mark.color" fill-opacity=".28" :stroke="mark.color" stroke-width="4" /><text :x="mark.x * canvas.width + 10" :y="mark.y * canvas.height + 28" class="mark-number">{{ index + 1 }}</text></g><rect v-if="draftRect" :x="draftRect.x * canvas.width" :y="draftRect.y * canvas.height" :width="draftRect.width * canvas.width" :height="draftRect.height * canvas.height" fill="#f59e0b" fill-opacity=".2" stroke="#d97706" stroke-width="4" /></svg></div><div v-if="selectedMark" class="mark-editor"><div class="manual-spec-heading"><b>선택 마킹 {{ pageMarks.findIndex((mark) => mark.id === selectedMark?.id) + 1 }}</b><span class="mark-chip" :style="{ background: selectedMark.color }">{{ selectedMark.zoneName || '구역명 미입력' }}</span><button type="button" class="text-button" :disabled="isCompact" @click="repositioningMarkId = selectedMark.id; markingEnabled = true">위치 다시 표시</button><button type="button" class="text-button danger-text" @click="removeMark(selectedMark.id)">삭제</button></div><div class="manual-spec-grid"><label>구역 이름<input v-model="selectedMark.zoneName" @change="schedulePersist"></label><label>벽체 길이(m)<input v-model.number="selectedMark.lengthM" min="0" step=".01" type="number" @change="schedulePersist"></label><label>높이(mm)<input v-model.number="selectedMark.heightMm" min="0" type="number" @change="syncMarkColor(selectedMark)"></label><label>자재 종류<input v-model="selectedMark.material" placeholder="예: 샌드위치패널" @change="syncMarkColor(selectedMark)"></label><label>판넬 유효 폭(mm)<input v-model.number="selectedMark.effectiveWidthMm" min="0" type="number" @change="schedulePersist"></label><label>개구부 제외 면적(㎡)<input v-model.number="selectedMark.openingAreaM2" min="0" step=".01" type="number" @change="schedulePersist"></label><label>재고/자투리 사용 가능(장)<input v-model.number="selectedMark.inventoryPanels" min="0" type="number" @change="schedulePersist"></label><label>검토 상태<select v-model="selectedMark.status" @change="schedulePersist"><option>검토 필요</option><option>확인 완료</option></select></label><label>색상<input v-model="selectedMark.color" type="color" @input="selectedMark.colorMode = 'manual'; schedulePersist()"></label><label class="manual-wide">검토 메모<input v-model="selectedMark.memo" @change="schedulePersist"></label></div><div class="quick-buttons"><span>빠른 선택</span><button v-for="height in [2400, 2700, 3000, 4200]" :key="height" type="button" @click="setMarkHeight(height)">{{ height.toLocaleString() }}mm</button><button v-for="material in ['샌드위치패널', '석고보드', '단열재']" :key="material" type="button" @click="setMarkMaterial(material)">{{ material }}</button></div><p class="mark-calculation">{{ calculateManualMarking(selectedMark).ready ? `계산: ${calculateManualMarking(selectedMark).grossAreaM2}㎡ − ${selectedMark.openingAreaM2 || 0}㎡ = ${calculateManualMarking(selectedMark).netAreaM2}㎡ · 예상 ${calculateManualMarking(selectedMark).panelCount}장` : `산출 제외: ${calculateManualMarking(selectedMark).reason}` }}</p></div></section>
        <section class="measurement-list"><div class="manual-spec-heading"><div><span class="panel-kicker">축척 환산 측정값</span><h3>벽체·면적·개구부</h3><p>{{ pageScale ? '도면 축척 환산값입니다. 수동값으로 덮어쓸 수 있습니다.' : '축척 설정 필요: 측정값은 산출에 반영되지 않습니다.' }}</p></div></div><div v-for="measurement in pageMeasurements" :key="measurement.id" class="measurement-row"><button type="button" @click="selectedMeasurementId = measurement.id">{{ measurementLabel(measurement) }} · {{ measurement.name }}</button><span>{{ measurement.kind === 'wall' ? `${measurementLengthM(measurement).toFixed(2)}m` : `${measurementArea(measurement).toFixed(2)}㎡` }}</span><button type="button" class="text-button danger-text" @click="removeMeasurement(measurement.id)">삭제</button></div><div v-if="selectedMeasurement" class="mark-editor"><div class="manual-spec-heading"><b>{{ measurementLabel(selectedMeasurement) }} 편집</b><button type="button" class="text-button danger-text" @click="removeMeasurement(selectedMeasurement.id)">삭제</button></div><div class="manual-spec-grid"><label>이름<input v-model="selectedMeasurement.name" @change="schedulePersist"></label><label v-if="selectedMeasurement.kind === 'wall'">수동 길이 덮어쓰기(m)<input v-model.number="selectedMeasurement.manualLengthM" min="0" step=".01" type="number" @change="schedulePersist"></label><label v-if="selectedMeasurement.kind === 'wall'">높이(mm)<input v-model.number="selectedMeasurement.heightMm" min="0" type="number" @change="schedulePersist"></label><label v-if="selectedMeasurement.kind === 'wall'">자재 종류<input v-model="selectedMeasurement.material" @change="schedulePersist"></label><label v-if="selectedMeasurement.kind === 'wall'">판넬 유효 폭(mm)<input v-model.number="selectedMeasurement.effectiveWidthMm" min="0" type="number" @change="schedulePersist"></label><label v-if="selectedMeasurement.kind === 'wall'">재고/자투리(장)<input v-model.number="selectedMeasurement.inventoryPanels" min="0" type="number" @change="schedulePersist"></label><label v-if="selectedMeasurement.kind === 'wall'">연결 개구부<select v-model="selectedMeasurement.openingIds" multiple @change="schedulePersist"><option v-for="opening in selectedDrawing.measurements?.filter((item) => item.kind === 'opening') || []" :key="opening.id" :value="opening.id">{{ opening.name }} · {{ measurementArea(opening).toFixed(2) }}㎡</option></select></label><label v-if="selectedMeasurement.kind === 'wall'">검토 상태<select v-model="selectedMeasurement.status" @change="schedulePersist"><option>검토 필요</option><option>확인 완료</option></select></label><label class="manual-wide">검토 메모<input v-model="selectedMeasurement.memo" @change="schedulePersist"></label></div><p class="mark-calculation">{{ selectedMeasurement.kind === 'wall' ? (pageScale || selectedMeasurement.manualLengthM > 0 ? `길이 ${measurementLengthM(selectedMeasurement).toFixed(2)}m × 높이 ${selectedMeasurement.heightMm || '미입력'}mm − 개구부 ${linkedOpeningArea(selectedMeasurement).toFixed(2)}㎡` : '산출 제외: 축척 설정 필요 또는 수동 길이를 입력하세요.') : `도면 축척 환산 면적 ${measurementArea(selectedMeasurement).toFixed(2)}㎡` }}</p></div><p v-if="!pageMeasurements.length" class="manual-empty">이 페이지의 측정값이 없습니다.</p></section>
        <section class="marking-summary"><div class="manual-spec-heading"><div><span class="panel-kicker">마킹 자동 집계</span><h3>색상·높이·자재별 산출</h3><p>확인 완료 및 필수 입력값이 있는 마킹만 집계합니다.</p></div></div><div v-if="markingSummary.length" class="table-scroll"><table class="data-table"><thead><tr><th>색상</th><th>자재</th><th>높이</th><th>벽체 길이</th><th>총면적</th><th>순면적</th><th>예상 판넬</th><th>재고·자투리</th><th>부족/신규 발주</th><th>제외</th></tr></thead><tbody><tr v-for="row in markingSummary" :key="`${row.color}-${row.material}-${row.heightMm}`"><td><i class="color-dot" :style="{ background: row.color }" /></td><td>{{ row.material }}</td><td>{{ row.heightMm || '—' }}mm</td><td>{{ row.lengthM.toFixed(2) }}m</td><td>{{ row.gross.toFixed(2) }}㎡</td><td>{{ row.net.toFixed(2) }}㎡</td><td>{{ row.panels }}장</td><td>{{ row.inventory }}장</td><td>{{ row.shortage }}장 / {{ row.order }}장</td><td>{{ row.excluded }}건</td></tr></tbody></table></div><p v-else class="manual-empty">아직 계산 가능한 마킹이 없습니다. 길이·높이·규격을 입력하고 검토 완료로 바꾸세요.</p></section>
        <section class="hybrid-model-card" aria-labelledby="hybrid-model-title">
          <div class="manual-spec-heading"><div><span class="panel-kicker">혼합형 3D 초안</span><h3 id="hybrid-model-title">전체 도면 분석 → 검토 → 개략 3D → 산출 초안</h3><p>PDF 텍스트·파일명에서 도면 유형과 숫자 후보를 채울 수 있지만, 자동 결과는 확정값이 아닙니다.</p></div><button type="button" class="outline-button" @click="createBrowserDraft">전체 도면 분석</button></div>
          <template v-if="hybridModel">
            <p class="hybrid-privacy">브라우저 안에서만 처리 · 서버 업로드·유료 AI 사용 없음 · 구조/시공 확정 모델 아님</p>
            <div v-if="hybridModel.candidates.length" class="hybrid-candidates"><b>자동 추출 후보 · 모두 검토 필요</b><ul><li v-for="candidate in hybridModel.candidates" :key="`${candidate.label}-${candidate.value}`"><span>{{ candidate.label }}: {{ candidate.value.toLocaleString() }}mm</span><small>{{ candidate.sourceName }} · {{ candidate.status }}</small></li></ul></div>
            <div class="manual-spec-grid hybrid-inputs"><label>가로 길이(mm)<input v-model.number="hybridModel.lengthMm" min="0" type="number" placeholder="예: 8000"></label><label>세로 길이(mm)<input v-model.number="hybridModel.widthMm" min="0" type="number" placeholder="예: 6000"></label><label>벽체 높이(mm)<input v-model.number="hybridModel.wallHeightMm" min="0" type="number" placeholder="예: 2800"></label><label>벽 두께(mm)<input v-model.number="hybridModel.wallThicknessMm" min="50" type="number"></label><label>지붕 형태<select v-model="hybridModel.roofKind"><option value="flat">평지붕</option><option value="gable">박공지붕</option></select></label><label>지붕 높이(mm)<input v-model.number="hybridModel.roofHeightMm" min="0" type="number" :disabled="hybridModel.roofKind === 'flat'"></label><label>검토 상태<select v-model="hybridModel.status"><option>검토 필요</option><option>확인 완료</option></select></label><label class="manual-wide">검토 메모<input v-model="hybridModel.note" placeholder="도면 페이지·치수선·층고 확인 내용"></label></div>
            <div class="hybrid-opening-heading"><div><b>문·창호 개구부 검토</b><p>확인 완료된 개구부만 3D에 표시하고 외벽 면적에서 차감합니다.</p></div><button type="button" class="outline-button" @click="addOpeningDraft">개구부 추가</button></div>
            <div v-for="(opening, index) in hybridModel.openings" :key="opening.id" class="hybrid-opening-row"><b>{{ index + 1 }}</b><label>이름<input v-model="opening.label" placeholder="예: 주출입문"></label><label>벽<select v-model.number="opening.wallIndex"><option :value="0">W-1</option><option :value="1">W-2</option><option :value="2">W-3</option><option :value="3">W-4</option></select></label><label>종류<select v-model="opening.type"><option value="window">창호</option><option value="door">문</option></select></label><label>폭(mm)<input v-model.number="opening.widthMm" min="0" type="number"></label><label>높이(mm)<input v-model.number="opening.heightMm" min="0" type="number"></label><label v-if="opening.type === 'window'">창대 높이(mm)<input v-model.number="opening.sillHeightMm" min="0" type="number"></label><label>벽 시작점에서 거리(mm)<input v-model.number="opening.offsetMm" min="0" type="number"></label><label>상태<select v-model="opening.status"><option>검토 필요</option><option>확인 완료</option></select></label><button type="button" class="text-button danger-text" @click="removeOpeningDraft(opening.id)">삭제</button></div>
            <p v-if="hybridModel.sourceNames.length" class="hybrid-source">자동 후보 출처: {{ hybridModel.sourceNames.join(', ') }} (최대 앞 2쪽의 텍스트만 참고)</p>
            <template v-if="hybridCanRender"><div class="hybrid-confirmed"><b>확인된 3D 개략 모델</b><span>외벽 {{ hybridWallArea.toLocaleString() }}㎡ − 확인 개구부 {{ hybridOpeningArea.toLocaleString() }}㎡ = {{ hybridNetWallArea.toLocaleString() }}㎡</span><button type="button" class="outline-button" @click="addGeometryTakeoffDraft">순면적을 산출 초안에 추가</button></div><div class="hybrid-viewer"><Building3DViewer :model="hybridBuilding" selected-wall-id="" mode="review" source-label="수동 확인 개략 모델" /></div></template>
            <p v-else class="hybrid-blocked">가로·세로·벽체 높이를 원본 도면과 대조하고 ‘확인 완료’로 바꾸면 3D를 표시합니다.</p>
          </template>
        </section>
        <div class="manual-spec-heading"><div><h3>사양 검토</h3><p>모든 항목은 수동 입력이며 기본 상태는 ‘검토 필요’입니다.</p></div><button type="button" class="outline-button" @click="addSpec">항목 추가</button></div>
        <div class="manual-spec-list"><article v-for="(spec, index) in selectedDrawing.specs" :key="spec.id" class="manual-spec"><div class="manual-spec-top"><b>{{ index + 1 }}번 {{ spec.origin === 'geometry-draft' ? '3D 계산 초안' : '수동 검토 항목' }}</b><button type="button" class="text-button danger-text" @click="removeSpec(spec.id)">삭제</button></div><div class="manual-spec-grid"><label>항목명<input v-model="spec.item" placeholder="예: 샌드위치패널"></label><label>규격<input v-model="spec.specification" placeholder="예: 75T"></label><label>단위<input v-model="spec.unit" placeholder="예: ㎡, 개, m"></label><label>수량<input v-model.number="spec.quantity" min="0" type="number"></label><label>단가(원)<input v-model.number="spec.unitPrice" min="0" type="number"></label><label>재고 수량<input v-model.number="spec.inventory" min="0" type="number"></label><label>신뢰도<select v-model="spec.confidence"><option>높음</option><option>중간</option><option>낮음</option></select></label><label>검토 상태<select v-model="spec.status"><option>검토 필요</option><option>확인 완료</option></select></label><label class="manual-wide">검토 메모<input v-model="spec.memo" placeholder="원본 페이지·치수 확인 내용"></label></div></article><p v-if="!selectedDrawing.specs.length" class="manual-empty">아직 사양 항목이 없습니다. ‘항목 추가’로 실제 도면의 값을 입력하세요.</p></div>
        <section class="manual-takeoff"><div class="manual-spec-heading"><div><h3>수동 자재 산출</h3><p>‘확인 완료’ 항목만 반영합니다. 단위가 다르면 별도 행으로 유지합니다.</p></div><strong>{{ formatWon(totalAmount) }}</strong></div><div v-if="takeoffRows.length" class="table-scroll"><table class="data-table"><thead><tr><th>항목</th><th>규격</th><th>단위</th><th>확인 수량</th><th>재고</th><th>부족</th><th>신규 발주</th><th>금액</th></tr></thead><tbody><tr v-for="row in takeoffRows" :key="`${row.item}-${row.specification}-${row.unit}`"><td>{{ row.item }}</td><td>{{ row.specification }}</td><td>{{ row.unit }}</td><td>{{ row.quantity }}</td><td>{{ row.inventory }}</td><td>{{ row.shortage }}</td><td>{{ row.order }}</td><td>{{ formatWon(row.amount) }}</td></tr></tbody></table></div><p v-else class="manual-empty">확인 완료된 사양 항목만 산출표에 표시됩니다.</p></section>
        <section class="material-layout"><div class="manual-spec-heading"><div><span class="panel-kicker">벽체별 자재 배치</span><h3>재고 우선 · 절단 계획 · 발주 준비</h3><p>승인된 재고만 제안에 반영하며 자동 차감·예약은 하지 않습니다.</p></div></div><div class="catalog-row" v-for="item in catalog" :key="item.id"><b>{{ item.name }}</b><span>{{ item.thicknessMm }}T · {{ item.effectiveWidthMm }}mm · {{ item.direction === 'vertical' ? '세로' : '가로' }} · 표준 {{ item.standardLengthMm }}mm · 여유 {{ item.cuttingAllowanceMm }}mm · {{ formatWon(item.unitPrice) }}</span></div><div v-for="row in wallPlans" :key="row.wall.id" class="wall-plan"><b>{{ row.wall.name }}</b><span v-if="row.plan.ready">{{ row.plan.panelCount }}장 · 필요 {{ row.plan.requiredLengthMm }}mm · 승인 재고 {{ row.plan.approvedStock }}장 · 신규 {{ row.plan.orderCount }}장 · 자투리/폐기 {{ row.plan.wasteMm }}mm · 재고 우선 {{ formatWon(row.plan.cost) }} / 신규 위주 {{ formatWon(row.plan.newOrderOnlyCost) }}</span><span v-else class="zone-warning">발주 제외: {{ row.plan.reason }}</span></div><p v-if="!wallPlans.length" class="manual-empty">확인 완료된 벽체에 자재명을 카탈로그 항목과 동일하게 지정하면 배치 계획을 만듭니다.</p><div v-if="orderPlans.length" class="order-ready"><b>신규 발주 준비</b><span>검토 통과 벽체 {{ orderPlans.length }}곳 · 신규 수량 {{ orderPlans.reduce((sum, row) => sum + row.plan.orderCount, 0) }}장 · 예상 금액 {{ formatWon(orderPlans.reduce((sum, row) => sum + row.plan.cost, 0)) }}</span></div></section>
        <section class="print-card"><div class="manual-spec-heading"><div><span class="panel-kicker">현장 검토서·발주 준비서</span><h3>출력 및 CSV</h3><p>자동 확정 아님 / 현장 최종 확인 필요 · PDF 원본은 포함하지 않습니다.</p></div><button type="button" class="primary-button" @click="printFieldReport">인쇄 미리보기</button></div><div class="manual-spec-grid"><label>현장명<input v-model="reportInfo.siteName" @change="schedulePersist"></label><label>프로젝트명<input v-model="reportInfo.projectName" @change="schedulePersist"></label><label>작성자<input v-model="reportInfo.author" @change="schedulePersist"></label><label>버전<input v-model="reportInfo.version" @change="schedulePersist"></label></div><div class="quick-buttons"><button type="button" @click="downloadWallCsv">벽체별 산출 근거 CSV</button><button type="button" @click="downloadStockCsv">재고·자투리 CSV</button><button type="button" @click="downloadOrderCsv" :disabled="!orderPlans.length">신규 발주 CSV</button><button type="button" @click="downloadWarningsCsv">검토 필요·보류 CSV</button></div><p v-if="reportInfo.lastPrintedAt">마지막 출력: {{ formatDate(reportInfo.lastPrintedAt) }}</p></section>
        <section class="preflight-card"><div class="manual-spec-heading"><div><span class="panel-kicker">발주 전 확인</span><h3>검토 상태와 보고서</h3><p>PDF 원본은 포함하지 않고 이 브라우저의 입력·검토 결과만 내보냅니다.</p></div><button type="button" class="outline-button" @click="downloadReviewReport">검토 보고서 CSV 저장</button></div><div class="preflight-summary"><span>도면 {{ projectSummary.drawingCount }}장</span><span>유형 확인 {{ projectSummary.classifiedCount }}장</span><span>확인 완료 항목 {{ projectSummary.confirmedSpecCount }}건</span><span>검토 필요 항목 {{ projectSummary.pendingSpecCount }}건</span></div><ul v-if="preflightIssues.length" class="preflight-issues"><li v-for="issue in preflightIssues" :key="issue">{{ issue }}</li></ul><p v-else class="preflight-ready">현재 선택 도면은 이 화면에서 관리하는 확인 항목을 모두 통과했습니다. 실제 발주 전에는 원본 도면·현장 조건·단가를 별도로 확인하세요.</p></section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.manual-workspace { margin-top: 22px; }.manual-safe-badge { color: #176341; font-weight: 800; }.manual-upload-row,.manual-toolbar,.manual-spec-heading,.manual-spec-top,.hybrid-confirmed,.hybrid-opening-heading { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }.local-test-manifest { margin:14px 0; padding:14px; border:1px solid #c9ddd0; border-radius:10px; background:#f4faf6; }.local-test-manifest h3 { margin:3px 0; }.local-test-manifest p { margin:4px 0 10px; color:#587063; font-size:13px; }.local-test-manifest ol { margin:0; padding-left:22px; display:grid; gap:5px; }.local-test-manifest li { display:flex; justify-content:space-between; gap:12px; font-size:12px; }.local-test-manifest li span { white-space:nowrap; color:#61776a; }.manual-message { color:#28634c; }.manual-empty { padding:22px; border:1px dashed #b8c8bf; border-radius:10px; color:#61736a; }.manual-layout { display:grid; grid-template-columns:250px minmax(0,1fr); gap:16px; }.manual-list { display:grid; align-content:start; gap:8px; max-height:620px; overflow:auto; }.manual-list article { border:1px solid #d7e1db; border-radius:10px; padding:8px; }.manual-list article.selected { border-color:#398367; background:#f0f8f3; }.manual-list article > button:first-child { display:grid; gap:4px; width:100%; border:0; background:transparent; text-align:left; cursor:pointer; }.manual-list small,.manual-list span { color:#687b72; font-size:12px; }.manual-delete { margin-top:6px; border:0; background:transparent; color:#a73535; cursor:pointer; }.manual-content { min-width:0; }.manual-toolbar { padding:10px; background:#f6f8f6; border-radius:8px; }.manual-toolbar button { border:1px solid #c7d4cc; border-radius:6px; background:white; padding:5px 8px; }.pdf-canvas-wrap { margin-top:12px; min-height:260px; overflow:auto; background:#edf1ee; padding:14px; text-align:center; }.pdf-canvas-wrap canvas { max-width:none; background:white; box-shadow:0 2px 10px #2c41331f; }.manual-spec-heading { justify-content:space-between; margin-top:22px; }.manual-spec-heading h3 { margin:0; }.manual-spec-heading p { margin:4px 0 0; color:#64766c; }.hybrid-model-card { margin-top:22px; padding:16px; border:1px solid #bed8cc; border-radius:12px; background:#f7fbf8; }.hybrid-model-card .manual-spec-heading { margin-top:0; }.hybrid-privacy,.hybrid-source,.hybrid-blocked { margin:10px 0 0; font-size:13px; color:#526f60; }.hybrid-candidates { margin-top:12px; padding:10px; border-radius:8px; background:#edf6ef; color:#315944; font-size:13px; }.hybrid-candidates ul { margin:8px 0 0; padding-left:18px; }.hybrid-candidates li { display:flex; justify-content:space-between; gap:12px; }.hybrid-opening-heading { justify-content:space-between; margin-top:16px; }.hybrid-opening-heading p { margin:3px 0 0; font-size:12px; color:#526f60; }.hybrid-opening-row { display:grid; grid-template-columns:20px repeat(8,minmax(82px,1fr)) auto; gap:8px; align-items:end; margin-top:8px; padding:10px; border:1px solid #d7e5dc; border-radius:8px; background:#fff; }.hybrid-opening-row label { display:grid; gap:3px; font-size:11px; font-weight:700; color:#52645a; }.hybrid-opening-row input,.hybrid-opening-row select { min-width:0; border:1px solid #cbd8d0; border-radius:6px; padding:7px; background:white; }.hybrid-confirmed { justify-content:space-between; margin-top:14px; padding:10px; border-radius:8px; background:#e0f2e7; color:#185d3c; }.hybrid-blocked { padding:14px; border:1px dashed #b8c8bf; border-radius:8px; }.hybrid-viewer { margin-top:14px; min-height:380px; border-radius:10px; overflow:hidden; background:#eef4ef; }.hybrid-inputs { margin-top:14px; }.manual-spec { border-top:1px solid #dfe7e1; padding:14px 0; }.manual-spec-top { justify-content:space-between; }.manual-spec-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:10px; }.manual-spec-grid label { display:grid; gap:4px; font-size:12px; font-weight:700; color:#52645a; }.manual-spec-grid input,.manual-spec-grid select,.manual-toolbar select { width:100%; box-sizing:border-box; border:1px solid #cbd8d0; border-radius:6px; padding:7px; background:white; }.manual-wide { grid-column:span 2; }.manual-takeoff { margin-top:20px; padding-top:4px; }.manual-takeoff strong { color:#176341; } @media (max-width: 850px) { .manual-layout { grid-template-columns:1fr; }.manual-list { max-height:220px; }.manual-spec-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.hybrid-opening-row { grid-template-columns:20px repeat(2,minmax(0,1fr)); }.manual-wide { grid-column:span 2; } } @media (max-width: 500px) { .local-test-manifest li,.hybrid-candidates li { display:grid; }.manual-spec-grid { grid-template-columns:1fr; }.hybrid-opening-row { grid-template-columns:1fr; }.manual-wide { grid-column:auto; } }
.preflight-card { margin-top:22px; padding:16px; border:1px solid #d6e2d9; border-radius:12px; background:#fafcfb; }.preflight-card .manual-spec-heading { margin-top:0; }.preflight-summary { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }.preflight-summary span { padding:6px 9px; border-radius:999px; background:#edf4ef; color:#3c604a; font-size:12px; font-weight:700; }.preflight-issues { margin:12px 0 0; padding:12px 12px 12px 30px; border-radius:8px; background:#fff8e8; color:#795b1e; font-size:13px; }.preflight-issues li + li { margin-top:5px; }.preflight-ready { margin:12px 0 0; padding:12px; border-radius:8px; background:#e6f5ea; color:#24613e; font-size:13px; }
.marking-card,.marking-summary { margin-top:18px; padding:16px; border:1px solid #f1d59a; border-radius:12px; background:#fffdf6; }.marking-card .manual-spec-heading,.marking-summary .manual-spec-heading { margin-top:0; }.pdf-stage { position:relative; display:inline-block; min-width:100%; padding:0; text-align:left; }.pdf-stage canvas { display:block; }.mark-overlay { position:absolute; inset:0; width:100%; height:100%; touch-action:none; }.pdf-stage.marking .mark-overlay { cursor:crosshair; }.mark-editor { margin-top:14px; padding:12px; border:1px solid #eddca8; border-radius:10px; background:#fff; }.mark-editor .manual-spec-heading { margin-top:0; }.mark-number { fill:#172033; font-size:24px; font-weight:900; paint-order:stroke; stroke:#fff; stroke-width:5px; }.mark-chip { padding:4px 8px; border-radius:999px; color:#fff; font-size:12px; font-weight:800; }.quick-buttons { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:10px; }.quick-buttons span { color:#66766d; font-size:12px; font-weight:700; }.quick-buttons button { border:1px solid #d6c784; border-radius:999px; background:#fff9df; padding:5px 8px; cursor:pointer; }.mark-calculation { margin:10px 0 0; color:#2a6246; font-weight:700; font-size:13px; }.color-dot { display:inline-block; width:16px; height:16px; border-radius:50%; border:1px solid #778; vertical-align:middle; }
.scale-card,.measurement-list { margin-top:18px; padding:16px; border:1px solid #bdd8ea; border-radius:12px; background:#f7fbff; }.scale-card .manual-spec-heading,.measurement-list .manual-spec-heading { margin-top:0; }.scale-actions { display:flex; gap:8px; align-items:end; }.scale-actions label { display:grid; gap:4px; font-size:12px; font-weight:700; color:#52645a; }.scale-actions input { width:150px; border:1px solid #cbd8d0; border-radius:6px; padding:7px; }.quick-buttons button.active { background:#dceffd; border-color:#4d8fba; }.measurement-row { display:flex; gap:10px; align-items:center; padding:9px 0; border-bottom:1px solid #dce7ef; }.measurement-row > button:first-child { border:0; background:transparent; color:#1d4f72; font-weight:700; cursor:pointer; text-align:left; }.measurement-row span { color:#526f60; font-size:13px; }.measurement-line,.measurement-draft { fill:none; stroke-width:4px; stroke-linejoin:round; }.measurement-draft { stroke:#f59e0b; stroke-dasharray:8 5; }.scale-line { stroke:#ec4899; stroke-width:4px; stroke-dasharray:10 6; }
.preset-card,.preset-summary { margin-top:18px; padding:16px; border:1px solid #c9d8f0; border-radius:12px; background:#fbfcff; }.preset-card .manual-spec-heading { margin-top:0; }.preset-buttons { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }.preset-buttons button { display:flex; align-items:center; gap:6px; border:2px solid #94a3b8; border-radius:8px; background:#fff; padding:8px 10px; cursor:pointer; font-weight:700; }.preset-buttons button.active { background:#eaf4ff; box-shadow:0 0 0 2px #60a5fa; }.preset-buttons i,.preset-summary i { display:inline-block; width:12px; height:12px; border-radius:50%; }.preset-buttons small { color:#64748b; }.preset-editor { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)) auto auto; gap:8px; align-items:end; margin-top:14px; }.preset-editor label { display:grid; gap:4px; color:#52645a; font-size:11px; font-weight:700; }.preset-editor input,.preset-editor select,.preset-apply select { min-width:0; border:1px solid #cbd8d0; border-radius:6px; padding:7px; background:#fff; }.preset-manage { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }.preset-manage span { display:flex; align-items:center; gap:5px; padding:6px 8px; border-radius:7px; background:#f1f5f9; font-size:12px; }.preset-manage button { border:0; background:transparent; color:#2563eb; cursor:pointer; }.preset-manage .danger-text { color:#b91c1c; }.preset-summary { display:grid; gap:7px; color:#334155; font-size:13px; }.preset-summary div { display:flex; align-items:center; gap:6px; }.preset-apply { margin:10px 0 0; color:#36556e; font-size:13px; } @media (max-width:850px) { .preset-editor { grid-template-columns:repeat(2,minmax(0,1fr)); } } @media (max-width:500px) { .preset-editor { grid-template-columns:1fr; } }
.review-board { margin-top:18px; padding:16px; border:1px solid #d8c6ed; border-radius:12px; background:#fcfaff; }.review-board .manual-spec-heading { margin-top:0; }.review-filters { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0; }.review-filters button { border:1px solid #cfc4dc; border-radius:999px; background:#fff; padding:6px 9px; cursor:pointer; }.review-filters button.active { background:#eee7f8; border-color:#8b5cb7; }.review-zone-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:10px 0; border-top:1px solid #e5def0; font-size:13px; }.review-zone-row > button:first-child { border:0; background:transparent; color:#5b337e; font-weight:800; cursor:pointer; }.review-zone-row label { display:flex; gap:4px; align-items:center; font-size:12px; }.review-zone-row input,.review-zone-row select { border:1px solid #cfc4dc; border-radius:6px; padding:5px; background:#fff; }.zone-warning { color:#a64d17; font-weight:700; }.hold-block { display:block; margin-top:12px; color:#5b4a69; font-size:13px; }
.opening-card { margin-top:18px; padding:16px; border:1px solid #f0c7ad; border-radius:12px; background:#fffaf7; }.opening-card .manual-spec-heading { margin-top:0; }.opening-row { display:flex; gap:8px; flex-wrap:wrap; align-items:end; padding:10px 0; border-top:1px solid #f1ded1; }.opening-row label { display:grid; gap:3px; color:#6b574b; font-size:11px; font-weight:700; }.opening-row input,.opening-row select { border:1px solid #dfc8b8; border-radius:6px; padding:6px; background:#fff; max-width:130px; }
.material-layout { margin-top:20px; padding:16px; border:1px solid #b9d7cc; border-radius:12px; background:#f7fcf9; }.material-layout .manual-spec-heading { margin-top:0; }.catalog-row,.wall-plan,.order-ready { display:flex; gap:10px; flex-wrap:wrap; padding:9px 0; border-top:1px solid #dceae2; font-size:13px; }.catalog-row span,.wall-plan span { color:#456156; }.order-ready { margin-top:10px; padding:10px; border-radius:8px; background:#e0f2e7; color:#185d3c; border:0; }
.print-card { margin-top:20px; padding:16px; border:1px solid #b9d3e8; border-radius:12px; background:#f8fcff; }.print-card .manual-spec-heading { margin-top:0; } @media print { .manual-upload-row,.manual-list,.manual-toolbar,.preset-card,.opening-card,.review-board,.scale-card button,.quick-buttons,.outline-button,.primary-button,.text-button { display:none !important; }.manual-layout { display:block; }.manual-content { width:100%; }.pdf-canvas-wrap { break-inside:avoid; background:white; }.material-layout,.print-card,.preflight-card,.marking-summary { break-inside:avoid; border-color:#aaa; }.data-table { font-size:10px; } }
.version-card { margin-top:16px; padding:16px; border:1px solid #d7c7a1; border-radius:12px; background:#fffdf7; }.version-card .manual-spec-heading { margin-top:0; }
</style>
