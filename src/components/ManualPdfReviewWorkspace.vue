<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { BuildingGeometry, Evidence, Opening } from '../types/domain'

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
const localTestManifest = ref<LocalTestManifest | null>(null)
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

const selectedDrawing = computed(() => drawings.value.find((drawing) => drawing.id === selectedId.value) || null)
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

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function newSpec(): ManualSpec {
  return { id: crypto.randomUUID(), item: '', specification: '', unit: '개', quantity: 0, unitPrice: 0, inventory: 0, confidence: '낮음', status: '검토 필요', memo: '', origin: 'manual' }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
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
    accepted.push({ id: crypto.randomUUID(), name: file.name, size: file.size, uploadedAt: new Date().toISOString(), status: '검토 준비', kind: 'other', blob: file, specs: [], hybridModel: defaultHybridModel() })
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
  try { await renderTask.promise } catch (error) { if (!(error instanceof Error) || error.name !== 'RenderingCancelledException') throw error }
}

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

watch([pageNumber, zoom], () => void nextTick(renderPage))
watch(drawings, schedulePersist, { deep: true })
onMounted(() => { void loadDrawings(); void loadLocalTestManifest() })
onBeforeUnmount(() => { pdfDocument?.destroy(); renderTask?.cancel(); if (saveTimer) clearTimeout(saveTimer); blobUrls.forEach((url) => URL.revokeObjectURL(url)) })
</script>

<template>
  <section class="manual-workspace panel-card" aria-labelledby="manual-pdf-title">
    <div class="panel-heading"><div><span class="panel-kicker">1차 구현 테스트</span><h2 id="manual-pdf-title">수동 PDF 검토·자재 산출</h2><p>PDF 원본과 입력값은 이 브라우저의 IndexedDB에만 저장됩니다. 자동 판독, 3D 생성, 발주 전송은 추후 연동입니다.</p></div><span class="manual-safe-badge">서버 업로드 없음</span></div>
    <div class="manual-upload-row"><input ref="fileInput" class="visually-hidden" type="file" accept="application/pdf,.pdf" multiple @change="onInput"><button type="button" class="primary-button" @click="fileInput?.click()">PDF 여러 개 추가</button><small>PDF만 · 파일당 50MB 이하 · 새로고침 후에도 유지</small></div>
    <section v-if="localTestManifest" class="local-test-manifest"><div><span class="panel-kicker">로컬 개발 전용 테스트 프로젝트</span><h3>{{ localTestManifest.projectName }}</h3><p>아래 목록은 이 Mac의 파일명·용량만 표시합니다. 원본은 선택 전까지 브라우저가 읽지 않으며 GitHub에 포함되지 않습니다.</p></div><ol><li v-for="drawing in localTestManifest.drawings" :key="drawing.name"><b>{{ drawing.name }}</b><span>{{ drawing.kind ? kindLabels[drawing.kind] : '유형 미지정' }} · {{ formatSize(drawing.size) }}</span></li></ol></section>
    <p v-if="message" class="manual-message">{{ message }}</p>
    <div v-if="isLoading" class="manual-empty">저장된 검토 작업을 불러오는 중입니다.</div>
    <div v-else-if="!drawings.length" class="manual-empty">실제 도면 PDF를 추가하면 이곳에서 미리보기·사양 검토·수동 산출을 시작할 수 있습니다.</div>
    <div v-else class="manual-layout">
      <aside class="manual-list" aria-label="업로드한 PDF 목록"><article v-for="drawing in drawings" :key="drawing.id" :class="{ selected: selectedId === drawing.id }"><button type="button" @click="selectDrawing(drawing.id)"><b>{{ drawing.name }}</b><small>{{ formatSize(drawing.size) }} · {{ formatDate(drawing.uploadedAt) }}</small><span>{{ drawing.status }} · {{ kindLabels[drawing.kind] }}</span></button><button type="button" class="manual-delete" :aria-label="`${drawing.name} 삭제`" @click="deleteDrawing(drawing.id)">삭제</button></article></aside>
      <div v-if="selectedDrawing" class="manual-content">
        <div class="manual-toolbar"><label>도면 유형<select v-model="selectedDrawing.kind"><option v-for="(label, key) in kindLabels" :key="key" :value="key">{{ label }}</option></select></label><span>{{ pageCount ? `${pageNumber} / ${pageCount} 페이지` : '미리보기 준비 중' }}</span><button type="button" :disabled="pageNumber <= 1" @click="pageNumber--">이전</button><button type="button" :disabled="pageNumber >= pageCount" @click="pageNumber++">다음</button><button type="button" :disabled="zoom <= .5" @click="zoom = Math.max(.5, zoom - .25)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button type="button" :disabled="zoom >= 2" @click="zoom = Math.min(2, zoom + .25)">＋</button></div>
        <div class="pdf-canvas-wrap"><canvas ref="canvas" aria-label="선택한 PDF 페이지 미리보기" /></div>
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
      </div>
    </div>
  </section>
</template>

<style scoped>
.manual-workspace { margin-top: 22px; }.manual-safe-badge { color: #176341; font-weight: 800; }.manual-upload-row,.manual-toolbar,.manual-spec-heading,.manual-spec-top,.hybrid-confirmed,.hybrid-opening-heading { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }.local-test-manifest { margin:14px 0; padding:14px; border:1px solid #c9ddd0; border-radius:10px; background:#f4faf6; }.local-test-manifest h3 { margin:3px 0; }.local-test-manifest p { margin:4px 0 10px; color:#587063; font-size:13px; }.local-test-manifest ol { margin:0; padding-left:22px; display:grid; gap:5px; }.local-test-manifest li { display:flex; justify-content:space-between; gap:12px; font-size:12px; }.local-test-manifest li span { white-space:nowrap; color:#61776a; }.manual-message { color:#28634c; }.manual-empty { padding:22px; border:1px dashed #b8c8bf; border-radius:10px; color:#61736a; }.manual-layout { display:grid; grid-template-columns:250px minmax(0,1fr); gap:16px; }.manual-list { display:grid; align-content:start; gap:8px; max-height:620px; overflow:auto; }.manual-list article { border:1px solid #d7e1db; border-radius:10px; padding:8px; }.manual-list article.selected { border-color:#398367; background:#f0f8f3; }.manual-list article > button:first-child { display:grid; gap:4px; width:100%; border:0; background:transparent; text-align:left; cursor:pointer; }.manual-list small,.manual-list span { color:#687b72; font-size:12px; }.manual-delete { margin-top:6px; border:0; background:transparent; color:#a73535; cursor:pointer; }.manual-content { min-width:0; }.manual-toolbar { padding:10px; background:#f6f8f6; border-radius:8px; }.manual-toolbar button { border:1px solid #c7d4cc; border-radius:6px; background:white; padding:5px 8px; }.pdf-canvas-wrap { margin-top:12px; min-height:260px; overflow:auto; background:#edf1ee; padding:14px; text-align:center; }.pdf-canvas-wrap canvas { max-width:none; background:white; box-shadow:0 2px 10px #2c41331f; }.manual-spec-heading { justify-content:space-between; margin-top:22px; }.manual-spec-heading h3 { margin:0; }.manual-spec-heading p { margin:4px 0 0; color:#64766c; }.hybrid-model-card { margin-top:22px; padding:16px; border:1px solid #bed8cc; border-radius:12px; background:#f7fbf8; }.hybrid-model-card .manual-spec-heading { margin-top:0; }.hybrid-privacy,.hybrid-source,.hybrid-blocked { margin:10px 0 0; font-size:13px; color:#526f60; }.hybrid-candidates { margin-top:12px; padding:10px; border-radius:8px; background:#edf6ef; color:#315944; font-size:13px; }.hybrid-candidates ul { margin:8px 0 0; padding-left:18px; }.hybrid-candidates li { display:flex; justify-content:space-between; gap:12px; }.hybrid-opening-heading { justify-content:space-between; margin-top:16px; }.hybrid-opening-heading p { margin:3px 0 0; font-size:12px; color:#526f60; }.hybrid-opening-row { display:grid; grid-template-columns:20px repeat(8,minmax(82px,1fr)) auto; gap:8px; align-items:end; margin-top:8px; padding:10px; border:1px solid #d7e5dc; border-radius:8px; background:#fff; }.hybrid-opening-row label { display:grid; gap:3px; font-size:11px; font-weight:700; color:#52645a; }.hybrid-opening-row input,.hybrid-opening-row select { min-width:0; border:1px solid #cbd8d0; border-radius:6px; padding:7px; background:white; }.hybrid-confirmed { justify-content:space-between; margin-top:14px; padding:10px; border-radius:8px; background:#e0f2e7; color:#185d3c; }.hybrid-blocked { padding:14px; border:1px dashed #b8c8bf; border-radius:8px; }.hybrid-viewer { margin-top:14px; min-height:380px; border-radius:10px; overflow:hidden; background:#eef4ef; }.hybrid-inputs { margin-top:14px; }.manual-spec { border-top:1px solid #dfe7e1; padding:14px 0; }.manual-spec-top { justify-content:space-between; }.manual-spec-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:10px; }.manual-spec-grid label { display:grid; gap:4px; font-size:12px; font-weight:700; color:#52645a; }.manual-spec-grid input,.manual-spec-grid select,.manual-toolbar select { width:100%; box-sizing:border-box; border:1px solid #cbd8d0; border-radius:6px; padding:7px; background:white; }.manual-wide { grid-column:span 2; }.manual-takeoff { margin-top:20px; padding-top:4px; }.manual-takeoff strong { color:#176341; } @media (max-width: 850px) { .manual-layout { grid-template-columns:1fr; }.manual-list { max-height:220px; }.manual-spec-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.hybrid-opening-row { grid-template-columns:20px repeat(2,minmax(0,1fr)); }.manual-wide { grid-column:span 2; } } @media (max-width: 500px) { .local-test-manifest li,.hybrid-candidates li { display:grid; }.manual-spec-grid { grid-template-columns:1fr; }.hybrid-opening-row { grid-template-columns:1fr; }.manual-wide { grid-column:auto; } }
</style>
