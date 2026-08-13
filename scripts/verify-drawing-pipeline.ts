import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import { createQueuedFile, isSupportedFile } from '../src/modules/file-loader.ts'
import { classifyDocument } from '../src/modules/document-classifier.ts'
import { extractDrawingMetadata } from '../src/modules/drawing-metadata-extractor.ts'
import { buildBuildingGeometry, buildWalls, extractRoofGeometry, listMissingGeometryItems } from '../src/modules/drawing-geometry-model.ts'
import { buildHeightDiagnostics } from '../src/modules/height-diagnostics.ts'
import { buildHeightCandidates } from '../src/modules/height-candidate-extractor.ts'
import { normalizeNumericToken, numericTokensFromText, toDimensionValue } from '../src/modules/dimension-normalizer.ts'
import { calculateTakeoffs } from '../src/modules/material-takeoff-engine.ts'
import { buildOptimizationMembers, optimizeCuttingPlan } from '../src/modules/cutting-optimization-engine.ts'
import { parseCostSummaries } from '../src/modules/cost-summary-parser.ts'
import { assessProjectWorkflow } from '../src/modules/project-workflow.ts'
import { takeoffsToCsv } from '../src/modules/export-report.ts'
import { DEFAULT_MATERIAL_SETTINGS } from '../src/types/domain.ts'
import type { AnalyzedFile, DrawingPage, Evidence, MaterialCatalogItem, ProjectWorkflow } from '../src/types/domain.ts'

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDirectory = (...parts: string[]) => join(rootDirectory, 'test-fixtures', ...parts)
const expected = JSON.parse(await readFile(fixtureDirectory('expected', 'integration.json'), 'utf8')) as {
  dimensionsMm: Record<string, number>
  geometry: { isReady: boolean; zones: Record<string, number> }
  takeoff: Record<string, number>
  workflow: Record<string, string>
}

const drawingPriority = ['cost-summary', 'floor-plan', 'elevation', 'section', 'detail', 'structural', 'material-schedule', 'unknown'] as const

function mimeTypeFor(name: string) {
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

function pageEvidence(fileId: string, fileName: string, pageNumber: number, drawingKind: DrawingPage['kind'], rawText: string, location?: Evidence['location']): Evidence {
  return {
    fileId,
    fileName,
    pageNumber,
    drawingKind,
    method: 'pdf-text',
    rawText,
    location: location || { x: 0, y: 0, width: 1, height: 1, coordinateSystem: 'normalized' },
  }
}

function itemLocation(item: { transform?: number[]; width?: number; height?: number }, width: number, height: number): Evidence['location'] {
  const transform = item.transform || []
  const x = Number(transform[4] || 0)
  const baselineY = Number(transform[5] || 0)
  const itemWidth = Math.max(Number(item.width || 0), 8)
  const itemHeight = Math.max(Math.abs(Number(transform[3] || item.height || 10)), 10)
  return {
    x: Math.min(1, Math.max(0, x / width)),
    y: Math.min(1, Math.max(0, 1 - ((baselineY + itemHeight) / height))),
    width: Math.min(1, itemWidth / width),
    height: Math.min(1, itemHeight / height),
    coordinateSystem: 'normalized',
  }
}

function classifyFileKind(pages: DrawingPage[], fileName: string) {
  const pageKinds = pages.map((page) => page.kind)
  const classification = classifyDocument(pages.map((page) => page.text).join('\n'), fileName)
  return drawingPriority.find((kind) => pageKinds.includes(kind)) || classification.kind
}

async function extractPdfFixture(filePath: string, fileId: string): Promise<AnalyzedFile> {
  const name = basename(filePath)
  const bytes = await readFile(filePath)
  const document = await pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: `${resolve(rootDirectory, 'node_modules/pdfjs-dist/standard_fonts')}/`,
  }).promise
  const pages: DrawingPage[] = []

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = content.items.filter((item) => Boolean(item && typeof item === 'object' && 'str' in item)) as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>
    const text = items.map((item) => item.str || '').join('\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
    const classification = classifyDocument(text, name)
    const evidenceItems = items.map((item) => {
      const raw = item.str || ''
      return {
        text: raw,
        evidence: pageEvidence(fileId, name, pageNumber, classification.kind, raw, itemLocation(item, viewport.width, viewport.height)),
      }
    })
    const fallbackEvidence = pageEvidence(fileId, name, pageNumber, classification.kind, text)
    const metadata = extractDrawingMetadata(evidenceItems, fallbackEvidence)
    let dimensionIndex = 0
    const dimensions = evidenceItems.flatMap((item, index) => {
      if (!item.text.trim()) return []
      const nearbyText = items.slice(Math.max(0, index - 1), Math.min(items.length, index + 1)).map((nearbyItem) => nearbyItem.str || '').join(' ')
      return numericTokensFromText(item.text, item.evidence).map((token) => toDimensionValue(
        normalizeNumericToken({ ...token, context: nearbyText }),
        dimensionIndex++,
      ))
    })
    pages.push({
      id: `${fileId}-page-${pageNumber}`,
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      text,
      previewUrl: '',
      kind: classification.kind,
      kindConfidence: classification.confidence,
      dimensions,
      zones: metadata.zones,
      roomNames: metadata.roomNames,
      axisLabels: metadata.axisLabels,
      scales: metadata.scales,
      unitCandidates: metadata.unitCandidates,
      vectorSegments: [],
      warnings: [],
      handWritingDetected: false,
    })
  }

  const fileKind = classifyFileKind(pages, name)
  return {
    id: fileId,
    name,
    extension: name.split('.').pop()?.toLowerCase() || '',
    mimeType: 'application/pdf',
    size: bytes.byteLength,
    status: 'complete',
    stage: 'complete',
    progress: 100,
    kind: fileKind,
    kindConfidence: pages.find((page) => page.kind === fileKind)?.kindConfidence || 'low',
    pages,
    previewUrl: '',
    warnings: [],
    error: '',
    uploadedAt: new Date(0).toISOString(),
    canReanalyze: true,
    externalProcessing: false,
  }
}

function findDimension(dimensions: AnalyzedFile['pages'][number]['dimensions'], pattern: RegExp, valueMm: number) {
  const dimension = dimensions.find((candidate) => pattern.test(`${candidate.context} ${candidate.label}`) && candidate.valueMm === valueMm)
  assert.ok(dimension, `치수 ${valueMm}mm / ${pattern} 을(를) 찾지 못했습니다.`)
  return dimension
}

function assertImageFixture(filePath: string) {
  return readFile(filePath).then(async (bytes) => {
    const name = basename(filePath)
    const input = new File([bytes], name, { type: mimeTypeFor(name) })
    assert.equal(isSupportedFile(input), true, `${name}은 지원 파일로 인식되어야 합니다.`)
    assert.equal(createQueuedFile(input).status, 'queued', `${name} 업로드 상태가 queued여야 합니다.`)
    if (name.endsWith('.png')) assert.deepEqual(Array.from(bytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])
    if (name.endsWith('.jpg')) assert.deepEqual(Array.from(bytes.slice(0, 2)), [255, 216])
  })
}

const [plan, elevation, section, detail, costSummary, multiPage] = await Promise.all([
  extractPdfFixture(fixtureDirectory('drawings', 'plan', 'test-floor-plan.pdf'), 'fixture-plan'),
  extractPdfFixture(fixtureDirectory('drawings', 'elevation', 'test-elevation.pdf'), 'fixture-elevation'),
  extractPdfFixture(fixtureDirectory('drawings', 'section', 'test-section.pdf'), 'fixture-section'),
  extractPdfFixture(fixtureDirectory('drawings', 'detail', 'test-detail.pdf'), 'fixture-detail'),
  extractPdfFixture(fixtureDirectory('drawings', 'cost-table', 'test-cost-summary-공사비-집계표.pdf'), 'fixture-cost'),
  extractPdfFixture(fixtureDirectory('drawings', 'plan', 'test-multi-page.pdf'), 'fixture-multi-page'),
])

await Promise.all([
  assertImageFixture(fixtureDirectory('drawings', 'plan', 'test-floor-plan.jpg')),
  assertImageFixture(fixtureDirectory('drawings', 'plan', 'test-floor-plan.png')),
])

for (const unsupportedName of ['future-plan.dwg', 'future-plan.dxf', 'future-model.ifc']) {
  const unsupportedFile = new File(['not parsed'], unsupportedName, { type: 'application/octet-stream' })
  assert.equal(isSupportedFile(unsupportedFile), false)
  const queued = createQueuedFile(unsupportedFile)
  assert.equal(queued.status, 'failed')
  assert.match(queued.error, /현재 이 파일 형식은 자동 분석을 지원하지 않습니다/)
}

assert.equal(plan.kind, 'floor-plan')
assert.equal(elevation.kind, 'elevation')
assert.equal(section.kind, 'section')
assert.equal(detail.kind, 'detail')
assert.equal(costSummary.kind, 'cost-summary')
assert.equal(multiPage.pages.length, 2)
assert.deepEqual(multiPage.pages.map((page) => page.kind), ['floor-plan', 'elevation'])

const dimensions = [plan, elevation, section, detail].flatMap((file) => file.pages.flatMap((page) => page.dimensions))
assert.equal(findDimension(dimensions, /wall w-01/i, expected.dimensionsMm.wallA).valueMm, expected.dimensionsMm.wallA)
assert.equal(findDimension(dimensions, /wall w-02/i, expected.dimensionsMm.wallB).valueMm, expected.dimensionsMm.wallB)
assert.equal(findDimension(dimensions, /wall height/i, expected.dimensionsMm.heightA).valueMm, expected.dimensionsMm.heightA)
assert.equal(findDimension(dimensions, /wall height/i, expected.dimensionsMm.heightB).valueMm, expected.dimensionsMm.heightB)
assert.equal(findDimension(dimensions, /door width/i, expected.dimensionsMm.doorD1Width).sourceType, 'pdf-text')
assert.equal(findDimension(dimensions, /door height/i, expected.dimensionsMm.doorD1Height).valueMm, expected.dimensionsMm.doorD1Height)
assert.equal(findDimension(dimensions, /door offset/i, expected.dimensionsMm.doorD1Offset).valueMm, expected.dimensionsMm.doorD1Offset)
assert.equal(findDimension(dimensions, /window width/i, expected.dimensionsMm.windowW1Width).valueMm, expected.dimensionsMm.windowW1Width)
assert.equal(findDimension(dimensions, /window height/i, expected.dimensionsMm.windowW1Height).valueMm, expected.dimensionsMm.windowW1Height)
assert.equal(findDimension(dimensions, /window offset/i, expected.dimensionsMm.windowW1Offset).valueMm, expected.dimensionsMm.windowW1Offset)
assert.equal(findDimension(dimensions, /window sill/i, expected.dimensionsMm.windowW1Sill).valueMm, expected.dimensionsMm.windowW1Sill)
assert.equal(findDimension(dimensions, /wall w-01/i, expected.dimensionsMm.wallA).originalValueMm, expected.dimensionsMm.wallA)
assert.equal(normalizeNumericToken({ raw: '1.250', context: '층고 1.250m', evidence: pageEvidence('unit', 'unit-plan.pdf', 1, 'section', '1.250m') }).valueMm, 1250)
assert.equal(normalizeNumericToken({ raw: '145,000', context: '벽체 길이 145,000mm', evidence: pageEvidence('unit', 'unit-plan.pdf', 1, 'floor-plan', '145,000mm') }).valueMm, 145000)

const drawingFiles = [plan, elevation, section, detail]
const allUploadedFiles = [...drawingFiles, costSummary]
const allDimensions = allUploadedFiles.flatMap((file) => file.pages.flatMap((page) => page.dimensions))
const drawingDimensions = allDimensions.filter((dimension) => dimension.evidence[0]?.drawingKind !== 'cost-summary')
const walls = buildWalls(drawingFiles, allDimensions)
assert.equal(walls.length, 2, '평면도의 WALL W-01/W-02가 두 벽체로 연결되어야 합니다.')
assert.deepEqual(walls.map((wall) => ({ zone: wall.zone, wallNumber: wall.wallNumber, lengthMm: wall.lengthMm, heightMm: wall.heightMm })), [
  { zone: 'ZONE A', wallNumber: 'W-01', lengthMm: 12000, heightMm: 3200 },
  { zone: 'ZONE B', wallNumber: 'W-02', lengthMm: 8000, heightMm: 4800 },
])
assert.equal(walls[0]?.openings.length, 1)
assert.equal(walls[0]?.openings[0]?.label, 'D1')
assert.equal(walls[0]?.openings[0]?.areaM2, 1.89)
assert.ok(walls[0]?.openings[0]?.evidence.some((evidence) => evidence.fileId === 'fixture-detail'), '상세도의 D1 근거가 평면도 개구부에 연결되어야 합니다.')
assert.equal(walls[1]?.openings.length, 1)
assert.equal(walls[1]?.openings[0]?.label, 'W1')
assert.equal(walls[1]?.openings[0]?.areaM2, 2.16)
assert.ok(walls[1]?.openings[0]?.evidence.some((evidence) => evidence.fileId === 'fixture-detail'), '상세도의 W1 근거가 평면도 개구부에 연결되어야 합니다.')

const wallA = findDimension(plan.pages[0]?.dimensions || [], /wall w-01/i, expected.dimensionsMm.wallA)
const duplicateWallDimension = {
  ...wallA,
  id: 'duplicate-wall-a',
  value: 12500,
  valueMm: 12500,
  normalizedValueMm: 12500,
  displayValue: '12500',
  sourceText: '12500',
  evidence: [pageEvidence('duplicate-plan', 'duplicate-plan.pdf', 1, 'floor-plan', 'ZONE A WALL W-01 12500 mm')],
  originalValueMm: 12500,
}
const duplicateWalls = buildWalls(drawingFiles, [...allDimensions, duplicateWallDimension])
assert.equal(duplicateWalls.filter((wall) => wall.wallNumber === 'W-01').length, 1, '같은 W-01은 페이지가 달라도 한 번만 계산되어야 합니다.')
assert.ok(duplicateWalls.find((wall) => wall.wallNumber === 'W-01')?.conflicts?.some((conflict) => conflict.kind === 'length'), '서로 다른 같은 벽체 길이는 충돌로 표시되어야 합니다.')

const heightA = findDimension(elevation.pages[0]?.dimensions || [], /wall height/i, expected.dimensionsMm.heightA)
const conflictingHeight = {
  ...heightA,
  id: 'conflicting-height-a',
  value: 3500,
  valueMm: 3500,
  normalizedValueMm: 3500,
  displayValue: '3500',
  sourceText: '3500',
  context: 'ZONE A ELEVATION WALL HEIGHT 3500 mm',
  evidence: [pageEvidence('conflicting-elevation', 'conflicting-elevation.pdf', 1, 'elevation', 'ZONE A ELEVATION WALL HEIGHT 3500 mm')],
  originalValueMm: 3500,
}
const conflictingWalls = buildWalls(drawingFiles, [...allDimensions, conflictingHeight])
assert.ok(conflictingWalls.find((wall) => wall.wallNumber === 'W-01')?.conflicts?.some((conflict) => conflict.kind === 'height'), '연결된 높이 값이 다르면 높이 충돌로 표시되어야 합니다.')

const roof = extractRoofGeometry(drawingFiles, walls)
const model = buildBuildingGeometry(walls, DEFAULT_MATERIAL_SETTINGS.panelThicknessMm, roof)
assert.equal(model.isReady, expected.geometry.isReady)
assert.equal(model.roof.kind, 'flat')
assert.equal(model.roof.heightMm, 4800)
assert.equal(model.walls.length, 2, '실제 도면에서 확인된 두 벽체가 3D geometry로 전달되어야 합니다.')
assert.deepEqual(model.walls.map((wall) => wall.heightMm), [3200, 4800])
assert.equal(model.walls[0]?.lengthMm, 12000)
assert.equal(model.walls[0]?.start.y, 0)
assert.equal(model.walls[0]?.end.x, 12)
assert.equal(model.walls[1]?.heightMm, 4800)
assert.equal(model.walls[0]?.openings[0]?.type, 'door')
assert.equal(model.walls[1]?.openings[0]?.type, 'window')
assert.deepEqual(Object.fromEntries(walls.map((wall) => [wall.zone, wall.heightMm])), expected.geometry.zones)

const heightDiagnostics = buildHeightDiagnostics(allUploadedFiles, allDimensions, walls, model)
assert.equal(heightDiagnostics.overallStatus, 'passed')
assert.equal(heightDiagnostics.candidateCount > 0, true)
assert.equal(heightDiagnostics.linkedWallCount, 2)
assert.equal(heightDiagnostics.modelWallCount, 2)
assert.equal(heightDiagnostics.stages.find((stage) => stage.id === 'normalization')?.status, 'passed')
assert.equal(heightDiagnostics.stages.find((stage) => stage.id === 'linking')?.status, 'passed')
assert.equal(heightDiagnostics.entries.filter((entry) => entry.status === 'modelled').length >= 2, true)
const heightCandidates = buildHeightCandidates(allUploadedFiles, allDimensions, walls)
assert.ok(heightCandidates.length >= 2, '실제 PDF에서 높이 후보가 추출되어야 합니다.')
assert.ok(heightCandidates.every((candidate) => candidate.pageNumber && candidate.sourceFileName && candidate.boundingBox), '높이 후보는 원본 파일·페이지·위치를 보존해야 합니다.')
assert.ok(heightCandidates.some((candidate) => candidate.relatedWallId), '실제 PDF의 높이 후보가 벽체까지 연결되어야 합니다.')

const takeoffs = calculateTakeoffs(walls, DEFAULT_MATERIAL_SETTINGS)
assert.equal(takeoffs.length, 2)
assert.equal(takeoffs[0]?.openingAreaM2, expected.takeoff.wallAOpeningAreaM2)
assert.equal(takeoffs[1]?.openingAreaM2, expected.takeoff.wallBOpeningAreaM2)
assert.equal(takeoffs[0]?.netAreaM2, expected.takeoff.wallANetAreaM2)
assert.equal(takeoffs[1]?.netAreaM2, expected.takeoff.wallBNetAreaM2)
assert.ok(takeoffs.every((row) => row.reviewStatus === '확정'), `검토 상태: ${takeoffs.map((row) => row.reviewStatus).join(', ')}`)
assert.ok(takeoffs.every((row) => row.formula && row.sourceReferences?.length), '각 산출행은 계산식과 도면 근거를 보존해야 합니다.')

// Pass the fixture's real linked walls through the browser's member and
// cutting engine. This prevents the integration check from stopping at the
// takeoff table with a sample-only optimization result.
const fixturePanel: MaterialCatalogItem = {
  id: 'fixture-panel',
  name: '시험용 판넬',
  materialType: 'panel',
  material: '시험 재질',
  thicknessMm: 75,
  stockWidthMm: 1000,
  stockLengthMm: 6000,
  stockLengthOptionsMm: [6000, 9000],
  unit: 'sheet',
  unitLabel: '장',
  unitPrice: 100,
  minimumOrderQuantity: 1,
  cuttingFee: 10,
  cutCostPerCut: 1,
  kerfMm: 0,
  transportCost: 10,
  handlingCost: 10,
  disposalCostPerM2: 1,
  disposalCostPerM: null,
  temporaryStorageCostPerDay: 0,
  rotatable: false,
  grainDirection: 'fixed',
  lapAllowanceMm: 0,
  minimumReusableOffcutMm: 100,
  reworkRiskCost: 10,
  source: 'sample',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const optimizationMembers = buildOptimizationMembers(walls, DEFAULT_MATERIAL_SETTINGS, fixturePanel.id, fixturePanel).members
const optimization = optimizeCuttingPlan({ walls, members: optimizationMembers, catalog: [fixturePanel], now: '2026-01-01T00:00:00.000Z' })
assert.ok(optimizationMembers.length > 0, '실제 도면 벽체에서 절단 부재가 생성되어야 합니다.')
assert.ok(optimization.scenarios.find((scenario) => scenario.id === 'cost')?.stockPlans.length, '실제 도면 부재가 원자재 배치까지 연결되어야 합니다.')
assert.equal(optimization.validation.passed, true, '실제 도면 기반 절단 배치 검증이 통과해야 합니다.')

const projectMissingItems = listMissingGeometryItems(allUploadedFiles, walls)
assert.deepEqual(projectMissingItems, [])
const emptyWorkflow: ProjectWorkflow = { reviewConfirmed: false, modelBuilt: false, takeoffCalculated: false, optimizationCalculated: false }
const beforeReview = assessProjectWorkflow({ files: allUploadedFiles, workflow: emptyWorkflow, model, takeoffs: [], missingItems: projectMissingItems, reviewItems: [], isAnalyzing: false })
assert.equal(beforeReview.status, expected.workflow.withoutReview)
const confirmedWorkflow: ProjectWorkflow = { reviewConfirmed: true, modelBuilt: true, takeoffCalculated: true, optimizationCalculated: false }
const completed = assessProjectWorkflow({ files: allUploadedFiles, workflow: confirmedWorkflow, model, takeoffs, missingItems: projectMissingItems, reviewItems: [], isAnalyzing: false })
assert.equal(completed.status, expected.workflow.withConfirmedResults)
assert.equal(completed.canIssue, true)

const noHeightFiles = [plan, detail]
const noHeightWalls = buildWalls(noHeightFiles, noHeightFiles.flatMap((file) => file.pages.flatMap((page) => page.dimensions)))
const noHeightModel = buildBuildingGeometry(noHeightWalls)
const noHeightMissingItems = listMissingGeometryItems(noHeightFiles, noHeightWalls)
const noHeightAssessment = assessProjectWorkflow({ files: noHeightFiles, workflow: emptyWorkflow, model: noHeightModel, takeoffs: [], missingItems: noHeightMissingItems, reviewItems: [], isAnalyzing: false })
assert.equal(noHeightModel.isReady, false)
assert.equal(noHeightAssessment.status, expected.workflow.withoutHeight)
assert.ok(noHeightAssessment.blockers.some((item) => /높이 정보 없음|입면도|단면도/.test(item)))
const noHeightDiagnostics = buildHeightDiagnostics(noHeightFiles, noHeightFiles.flatMap((file) => file.pages.flatMap((page) => page.dimensions)), noHeightWalls, noHeightModel)
assert.equal(noHeightDiagnostics.floorPlanOnly, true)
assert.equal(noHeightDiagnostics.candidateCount, 0)
assert.equal(noHeightDiagnostics.entries.some((entry) => entry.cause === 'drawing-no-height'), true)
assert.match(noHeightDiagnostics.message, /평면 치수는 확인했지만 벽체 높이를 확인할 수 없습니다/)

const sourceHeight = heightA
const unlinkedHeight = {
  ...sourceHeight,
  id: 'unlinked-height',
  context: 'OTHER ZONE SECTION HEIGHT 3500 mm',
  sourceText: '3500',
  displayValue: '3500',
  value: 3500,
  valueMm: 3500,
  normalizedValueMm: 3500,
  evidence: [pageEvidence('unlinked-section', 'unlinked-section.pdf', 2, 'section', 'OTHER ZONE SECTION HEIGHT 3500 mm')],
}
const unlinkedWalls = buildWalls([plan, detail], [...plan.pages.flatMap((page) => page.dimensions), ...detail.pages.flatMap((page) => page.dimensions), unlinkedHeight])
const unlinkedModel = buildBuildingGeometry(unlinkedWalls)
const unlinkedDiagnostics = buildHeightDiagnostics([plan, detail], [...plan.pages.flatMap((page) => page.dimensions), ...detail.pages.flatMap((page) => page.dimensions), unlinkedHeight], unlinkedWalls, unlinkedModel)
assert.equal(unlinkedDiagnostics.entries.some((entry) => entry.cause === 'height-not-linked'), true)
assert.equal(unlinkedDiagnostics.stages.find((stage) => stage.id === 'linking')?.status, 'blocked')

const invalidUnitHeight = {
  ...unlinkedHeight,
  id: 'invalid-unit-height',
  value: 2.8,
  valueMm: null,
  normalizedValueMm: null,
  unit: 'mm' as const,
  context: 'ZONE A ELEVATION HEIGHT 2.8 unknown-unit',
}
const invalidUnitDiagnostics = buildHeightDiagnostics([plan], [invalidUnitHeight], [], buildBuildingGeometry([]))
assert.equal(invalidUnitDiagnostics.entries[0]?.cause, 'unit-conversion-failed')

const invalidZeroHeight = { ...invalidUnitHeight, id: 'invalid-zero-height', value: 0, context: 'ZONE A ELEVATION HEIGHT 0 mm' }
const invalidZeroDiagnostics = buildHeightDiagnostics([plan], [invalidZeroHeight], [], buildBuildingGeometry([]))
assert.equal(invalidZeroDiagnostics.entries[0]?.cause, 'invalid-height')

const lowConfidenceWall = { ...walls[0], id: 'low-confidence-wall', heightSourceDimensionId: sourceHeight.id, confidence: 'low' as const }
const lowConfidenceModel = buildBuildingGeometry([lowConfidenceWall])
const lowConfidenceDiagnostics = buildHeightDiagnostics([elevation], [sourceHeight], [lowConfidenceWall], lowConfidenceModel)
assert.equal(lowConfidenceDiagnostics.entries[0]?.cause, 'low-confidence')

const fieldMismatchWall = { ...walls[0], id: 'field-mismatch-wall', heightSourceDimensionId: sourceHeight.id }
const fieldMismatchDiagnostics = buildHeightDiagnostics([elevation], [sourceHeight], [fieldMismatchWall], { ...lowConfidenceModel, walls: [], isReady: false, blockedReason: '테스트 입력 필드 불일치' })
assert.equal(fieldMismatchDiagnostics.entries[0]?.cause, 'field-mismatch')

const partialWalls = walls.map((wall, index) => index === 1 ? { ...wall, heightMm: null, heightStatus: 'missing' as const } : wall)
const partialModel = buildBuildingGeometry(partialWalls)
assert.equal(partialModel.isReady, true)
assert.equal(partialModel.partial, true)
assert.equal(partialModel.walls.length, 1)
assert.deepEqual(partialModel.blockedWallIds, [partialWalls[1]?.id])

const cost = parseCostSummaries([costSummary])
assert.equal(cost.totalAmount, 1500000)
assert.equal(cost.rows.length, 3)
assert.deepEqual(cost.sourceFileIds, ['fixture-cost'])
assert.ok(cost.rows.every((row) => !row.vendor.includes('TESTVENDOR')))
assert.equal(buildWalls(allUploadedFiles, allDimensions).length, 2, '공사비 집계표를 함께 올려도 geometry 벽체가 늘어나면 안 됩니다.')
assert.ok(drawingDimensions.every((dimension) => dimension.evidence[0]?.drawingKind !== 'cost-summary'))

const csv = takeoffsToCsv(takeoffs)
assert.ok(csv.includes('구역'))
assert.ok(csv.includes('W-01'))
assert.ok(csv.includes('36.51'))
assert.ok(csv.includes('확정'))

console.log(JSON.stringify({
  files: {
    pdf: 5,
    image: 2,
    multiPagePdfPages: multiPage.pages.length,
    kinds: [plan, elevation, section, detail, costSummary].map((file) => file.kind),
  },
  dimensions: dimensions.length,
  heightCandidates: {
    total: heightCandidates.length,
    linked: heightCandidates.filter((candidate) => candidate.relatedWallId).length,
    needsReview: heightCandidates.filter((candidate) => candidate.status === '확인 필요' || candidate.confidence !== 'high').length,
    pages: [...new Set(heightCandidates.map((candidate) => `${candidate.sourceFileName} · ${candidate.pageNumber}페이지`))],
  },
  walls: walls.map((wall) => ({ zone: wall.zone, wallNumber: wall.wallNumber, lengthMm: wall.lengthMm, heightMm: wall.heightMm })),
  takeoffs: takeoffs.map((row) => ({ wallNumber: row.wallNumber, netAreaM2: row.netAreaM2, panels: row.panelsWithWaste, reviewStatus: row.reviewStatus })),
  costSummary: { rows: cost.rows.length, totalAmount: cost.totalAmount, sourceFileIds: cost.sourceFileIds },
  workflow: { beforeReview: beforeReview.status, withoutHeight: noHeightAssessment.status, completed: completed.status, canIssue: completed.canIssue },
  csv: { bytes: new TextEncoder().encode(csv).byteLength, hasHeaders: csv.includes('구역') },
  optimization: {
    members: optimizationMembers.length,
    stockPlans: optimization.scenarios.find((scenario) => scenario.id === 'cost')?.stockPlans.length || 0,
    validationPassed: optimization.validation.passed,
  },
}, null, 2))
