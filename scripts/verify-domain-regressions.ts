import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createServer } from 'vite'

import { normalizeNumericToken, numericTokensFromText, toDimensionValue } from '../src/modules/dimension-normalizer.ts'
import { buildWalls } from '../src/modules/drawing-geometry-model.ts'
import { deriveLevelHeightDimensions } from '../src/modules/height-candidate-extractor.ts'
import { calculateTakeoffs } from '../src/modules/material-takeoff-engine.ts'
import { maskSensitiveCostText, parseCostSummaries } from '../src/modules/cost-summary-parser.ts'
import { DEFAULT_MATERIAL_SETTINGS } from '../src/types/domain.ts'
import type { AnalyzedFile, DimensionValue, DrawingKind, Evidence, Opening, ProjectState, Wall } from '../src/types/domain.ts'

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function evidence(id: string, drawingKind: DrawingKind = 'floor-plan'): Evidence {
  return {
    fileId: 'regression-file',
    fileName: 'regression-plan.pdf',
    pageNumber: 1,
    drawingKind,
    method: 'pdf-text',
    rawText: id,
  }
}

function dimension(
  id: string,
  valueMm: number,
  context: string,
  sourceText: string,
  options: { drawingKind?: DrawingKind; label?: string; heightRole?: DimensionValue['heightRole'] } = {},
): DimensionValue {
  const drawingKind = options.drawingKind || 'floor-plan'
  return {
    id,
    label: options.label || '벽체 길이 후보',
    value: valueMm,
    unit: 'mm',
    normalizedValueMm: valueMm,
    sourceFile: 'regression-plan.pdf',
    pageNumber: 1,
    drawingType: drawingKind,
    sourceText,
    sourcePosition: { x: 0, y: 0, width: 0, height: 0 },
    sourceType: 'pdf-text',
    valueMm,
    displayValue: sourceText,
    confidence: 'high',
    source: 'extracted',
    evidence: [evidence(id, drawingKind)],
    context,
    userEdited: false,
    originalValueMm: valueMm,
    userValueMm: null,
    heightRole: options.heightRole || 'none',
    handwritingStatus: 'printed',
  }
}

const sectionEvidence = evidence('levels', 'section')
const upperLevel = numericTokensFromText('T.O.S. +2.800m', sectionEvidence).map(normalizeNumericToken)[0]
const lowerLevel = numericTokensFromText('T.O.F. -1.200m', sectionEvidence).map(normalizeNumericToken)[0]
assert.equal(upperLevel?.valueMm, 2800)
assert.equal(upperLevel?.heightRole, 'level')
assert.equal(upperLevel?.levelDatum?.marker, 'T.O.S.')
assert.equal(upperLevel?.levelDatum?.role, 'upper')
assert.equal(lowerLevel?.valueMm, -1200)
assert.equal(lowerLevel?.heightRole, 'level')
assert.equal(lowerLevel?.levelDatum?.marker, 'T.O.F.')
assert.equal(lowerLevel?.levelDatum?.role, 'lower')
assert.equal(numericTokensFromText('T.O.F. +0.000m', sectionEvidence).map(normalizeNumericToken)[0]?.valueMm, 0)
assert.equal(numericTokensFromText('T.O.S. +2.800', sectionEvidence).map(normalizeNumericToken)[0]?.valueMm, 2800)
assert.equal(numericTokensFromText('T.O.F. -1.200', sectionEvidence).map(normalizeNumericToken)[0]?.valueMm, -1200)
assert.equal(numericTokensFromText('FFL ±0.000', sectionEvidence).map(normalizeNumericToken)[0]?.valueMm, 0)
assert.equal(numericTokensFromText('T.O.F. ± 0.000', sectionEvidence).map(normalizeNumericToken)[0]?.valueMm, 0)
const derivedSignedHeight = deriveLevelHeightDimensions([
  toDimensionValue({ ...upperLevel!, context: 'ZONE A T.O.S. +2.800m' }, 0),
  toDimensionValue({ ...lowerLevel!, context: 'ZONE A T.O.F. -1.200m' }, 1),
])[0]
assert.equal(derivedSignedHeight?.valueMm, 4000)
assert.equal(derivedSignedHeight?.upperLevelMm, 2800)
assert.equal(derivedSignedHeight?.lowerLevelMm, -1200)
const duplicateUpper = {
  ...toDimensionValue({ ...upperLevel!, context: 'ZONE A T.O.S. +2.800m' }, 0),
  id: 'duplicate-upper-level',
  value: 3000,
  valueMm: 3000,
  normalizedValueMm: 3000,
  displayValue: '+3.000m',
}
assert.equal(deriveLevelHeightDimensions([
  toDimensionValue({ ...upperLevel!, context: 'ZONE A T.O.S. +2.800m' }, 0),
  duplicateUpper,
  toDimensionValue({ ...lowerLevel!, context: 'ZONE A T.O.F. -1.200m' }, 1),
]).length, 0, '같은 페이지·구역에 상부 또는 하부 레벨이 여러 개면 임의의 첫 값으로 높이를 만들면 안 됩니다.')
const invalidDirectHeight = normalizeNumericToken({
  raw: '-2800',
  context: '벽체 높이 -2800 mm',
  localContext: '벽체 높이 -2800 mm',
  unitHint: 'mm',
  evidence: sectionEvidence,
})
assert.equal(invalidDirectHeight.valueMm, null, '일반 높이 치수의 양수 조건은 유지해야 합니다.')

const repeatedTokens = numericTokensFromText('폭 300 cm, 높이 300 mm', evidence('repeated-values'))
const repeatedDimensions = repeatedTokens.map(normalizeNumericToken)
assert.deepEqual(repeatedTokens.map((token) => token.localContext), ['폭 300 cm', '높이 300 mm'])
assert.deepEqual(repeatedDimensions.map((item) => item.valueMm), [3000, 300])
assert.deepEqual(repeatedDimensions.map((item) => item.unit), ['cm', 'mm'])
assert.deepEqual(repeatedDimensions.map((item) => item.heightRole), ['none', 'direct'])
const splitHeightToken = numericTokensFromText('3000 mm', evidence('split-height', 'section'))[0]
assert.ok(splitHeightToken)
const splitHeight = normalizeNumericToken({ ...splitHeightToken, context: '높이 3000 mm' })
assert.equal(splitHeight.heightRole, 'direct')
assert.equal(splitHeight.label, '높이 후보')

const wallDimensions = [
  dimension('wall-1-length', 4000, 'ZONE A WALL W-01 LENGTH 4000 mm AXIS A-1', '4000'),
  dimension('wall-2-length', 5000, 'ZONE A WALL W-02 LENGTH 5000 mm AXIS A-2', '5000'),
  dimension('zone-height', 3000, 'ZONE A WALL HEIGHT 3000 mm', '3000', { drawingKind: 'elevation', label: '높이 후보', heightRole: 'direct' }),
]

function doorDimensions(token: string, target: string) {
  return [
    dimension(`${token}-width`, 1000, `ZONE A ${target} DOOR ${token} WIDTH 1000 mm`, '1000'),
    dimension(`${token}-height`, 2000, `ZONE A ${target} DOOR ${token} HEIGHT 2000 mm`, '2000'),
    dimension(`${token}-offset`, 500, `ZONE A ${target} DOOR ${token} OFFSET 500 mm`, '500'),
  ]
}

const targetedWalls = buildWalls([], [
  ...wallDimensions,
  ...doorDimensions('D-1', 'WALL W-01'),
  ...doorDimensions('D-3', 'AXIS A-2'),
])
assert.deepEqual(targetedWalls.find((wall) => wall.wallNumber === 'W-01')?.openings.map((opening) => opening.label), ['D-1'])
assert.deepEqual(targetedWalls.find((wall) => wall.wallNumber === 'W-02')?.openings.map((opening) => opening.label), ['D-3'])
const axisWall = buildWalls([], [
  dimension('axis-w-length', 4000, 'ZONE A AXIS W-1 LENGTH 4000 mm', '4000'),
  dimension('axis-w-height', 3000, 'ZONE A WALL HEIGHT 3000 mm', '3000', { drawingKind: 'elevation', label: '높이 후보', heightRole: 'direct' }),
])
assert.equal(axisWall.length, 1, 'W 형식 축 라벨을 창호로 오인해 벽 길이를 버리면 안 됩니다.')
const anonymousWidthWalls = buildWalls([], [
  dimension('anonymous-width-1', 4000, 'ZONE A WIDTH 4000 mm', '4000'),
  dimension('anonymous-width-2', 5000, 'ZONE A WIDTH 5000 mm', '5000'),
  dimension('anonymous-height', 3000, 'ZONE A HEIGHT 3000 mm', '3000', { drawingKind: 'elevation', label: '높이 후보', heightRole: 'direct' }),
])
assert.equal(anonymousWidthWalls.length, 2)
assert.ok(anonymousWidthWalls.every((wall) => wall.wallNumber !== 'W-IDTH'))
const explicitlyLinkedHeightWalls = buildWalls([], [
  dimension('height-wall-1', 4000, 'ZONE A WALL W-01 LENGTH 4000 mm', '4000'),
  dimension('height-wall-2', 5000, 'ZONE A WALL W-02 LENGTH 5000 mm', '5000'),
  dimension('height-only-wall-2', 3000, 'ZONE A WALL W-02 HEIGHT 3000 mm', '3000', { drawingKind: 'elevation', label: '높이 후보', heightRole: 'direct' }),
])
assert.equal(explicitlyLinkedHeightWalls.find((wall) => wall.wallNumber === 'W-01')?.heightMm, null)
assert.equal(explicitlyLinkedHeightWalls.find((wall) => wall.wallNumber === 'W-02')?.heightMm, 3000)
const wallLabelFormatWalls = buildWalls([], [
  dimension('wall-label-a-length', 4000, 'ZONE A WALL A-01 LENGTH 4000 mm', '4000'),
  dimension('wall-label-a-height', 2800, 'ZONE A WALL A-01 HEIGHT 2800 mm', '2800', { drawingKind: 'elevation', label: '높이 후보', heightRole: 'direct' }),
  dimension('wall-label-b-length', 5000, 'ZONE A WALL W-B-02 LENGTH 5000 mm', '5000'),
  dimension('wall-label-b-height', 3200, 'ZONE A WALL W-B-02 HEIGHT 3200 mm', '3200', { drawingKind: 'elevation', label: '높이 후보', heightRole: 'direct' }),
  dimension('wall-label-c-length', 6000, 'ZONE A WALL NO. W-03 LENGTH 6000 mm', '6000'),
  dimension('wall-label-c-height', 3600, 'ZONE A WALL NO. W-03 HEIGHT 3600 mm', '3600', { drawingKind: 'elevation', label: '높이 후보', heightRole: 'direct' }),
])
assert.deepEqual(wallLabelFormatWalls.map((wall) => wall.wallNumber), ['W-A-01', 'W-B-02', 'W-03'])
assert.deepEqual(wallLabelFormatWalls.map((wall) => wall.heightMm), [2800, 3200, 3600])
const mismatchedZoneOpeningWalls = buildWalls([], [
  dimension('zone-a-wall', 4000, 'ZONE A WALL W-01 길이 4000', '길이 4000'),
  ...doorDimensions('D-9', 'ZONE B'),
])
assert.equal(mismatchedZoneOpeningWalls[0]?.openings.length, 0, '명시된 다른 구역의 개구부를 같은 페이지 벽에 붙이면 안 됩니다.')
assert.notEqual(mismatchedZoneOpeningWalls[0]?.reviewStatus, 'verified')

const repeatedOpeningWalls = buildWalls([], [
  ...wallDimensions,
  ...doorDimensions('D-4', 'WALL W-01'),
  dimension('D-4-second-offset', 3000, 'ZONE A WALL W-01 DOOR D-4 OFFSET 3000 mm', '3000'),
])
const repeatedOpeningWall = repeatedOpeningWalls.find((wall) => wall.wallNumber === 'W-01')
assert.equal(repeatedOpeningWall?.openings.length, 1)
assert.ok(repeatedOpeningWall?.openings[0]?.conflict, '같은 개구부 표기의 서로 다른 offset은 조용히 하나로 합치면 안 됩니다.')
assert.equal(repeatedOpeningWall?.openings[0]?.excludedFromAutomaticTakeoff, true)
assert.equal(repeatedOpeningWall?.reviewStatus, 'review')

const ambiguousWalls = buildWalls([], [
  ...wallDimensions,
  ...doorDimensions('D-2', ''),
])
assert.ok(ambiguousWalls.every((wall) => wall.openings.length === 0), '대상 벽이 불명확한 개구부를 모든 벽에 복제하면 안 됩니다.')
assert.ok(ambiguousWalls.every((wall) => wall.reviewStatus === 'review'), '불명확한 개구부 연결은 검토 대상으로 남아야 합니다.')

const offWallOpening: Opening = {
  id: 'off-wall-door',
  type: 'door',
  label: 'D-OFF',
  zone: 'ZONE A',
  widthMm: 1000,
  heightMm: 2000,
  sillHeightMm: null,
  offsetMm: 3500,
  areaM2: 2,
  confidence: 'high',
  evidence: [evidence('off-wall-door')],
  excludedFromAutomaticTakeoff: false,
}
const takeoffWall: Wall = {
  id: 'takeoff-wall',
  zone: 'ZONE A',
  zoneName: 'ZONE A',
  number: 'W-01',
  wallNumber: 'W-01',
  lengthMm: 4000,
  heightMm: 3000,
  heightStatus: 'known',
  openings: [offWallOpening],
  confidence: 'high',
  evidence: [evidence('takeoff-wall')],
  sourceReferences: [evidence('takeoff-wall')],
  sourceDimensionIds: [],
  reviewStatus: 'verified',
  geometryStart: { x: 0, z: 0 },
  geometryEnd: { x: 4, z: 0 },
  geometrySource: 'dimension-layout',
  color: '#000000',
  conflicts: [],
}
const clippedTakeoff = calculateTakeoffs([takeoffWall], DEFAULT_MATERIAL_SETTINGS)[0]
assert.equal(clippedTakeoff?.openingAreaM2, 1, '벽체와 겹치는 500×2000mm만 차감해야 합니다.')
assert.equal(clippedTakeoff?.netAreaM2, 11)
assert.equal(clippedTakeoff?.reviewStatus, '검토 필요')
assert.ok(clippedTakeoff?.notes.some((note) => /벽체 경계/.test(note)))
const fullyOutsideTakeoff = calculateTakeoffs([{
  ...takeoffWall,
  id: 'fully-outside-takeoff-wall',
  openings: [{ ...offWallOpening, id: 'fully-outside-door', offsetMm: 4500 }],
}], DEFAULT_MATERIAL_SETTINGS)[0]
assert.equal(fullyOutsideTakeoff?.openingAreaM2, 0)
assert.equal(fullyOutsideTakeoff?.netAreaM2, 12)
assert.equal(fullyOutsideTakeoff?.reviewStatus, '검토 필요')

const costFile = {
  id: 'cost-regression',
  name: '공사비-집계표.pdf',
  kind: 'cost-summary',
  pages: [{
    pageNumber: 1,
    text: [
      '1월 A건설 철근 단가 100,000 금액 1,000,000 연락처 01012345678 계좌: 123-456-789012',
      '2월 B건설 콘크리트 단가 200,000 금액 2,000,000',
    ].join('\n'),
  }],
} as unknown as AnalyzedFile
const costSummary = parseCostSummaries([costFile])
assert.deepEqual(costSummary.rows.map((row) => row.amount), [1_000_000, 2_000_000])
assert.ok(costSummary.rows.every((row) => row.total === null))
assert.equal(costSummary.totalAmount, 3_000_000)
const maskedCostEvidence = costSummary.rows[0]?.evidence[0]?.rawText || ''
assert.doesNotMatch(maskedCostEvidence, /01012345678|010-1234-5678|123-456-789012/)
assert.match(maskedCostEvidence, /010-\*{4}-\*{4}/)
assert.match(maskedCostEvidence, /계좌: \[비식별화\]/)
const landlineCostSummary = parseCostSummaries([{
  ...costFile,
  id: 'landline-cost-regression',
  pages: [{ pageNumber: 1, text: '1월 A건설 공사금액 1,000,000 연락처 02 1234 5678' }],
} as unknown as AnalyzedFile])
assert.equal(landlineCostSummary.totalAmount, 1_000_000)
const mixedDocument = {
  ...costFile,
  id: 'mixed-document-regression',
  name: '대한건설_통합도면.pdf',
  pages: [
    { pageNumber: 1, kind: 'floor-plan', text: 'ZONE A WALL W-01 길이 5000', previewUrl: 'data:image/png;base64,normal', dimensions: [] },
    { pageNumber: 2, kind: 'cost-summary', text: '1월 주식회사 대한 공사금액 1,500,000', previewUrl: 'data:image/png;base64,cost', dimensions: [], zones: [{ sourceText: '주식회사 대한' }] },
    { pageNumber: 3, kind: 'unknown', text: '분류 미정 도면 치수 7000', previewUrl: 'data:image/png;base64,unknown', dimensions: [] },
  ],
} as unknown as AnalyzedFile
const mixedCostSummary = parseCostSummaries([mixedDocument])
assert.equal(mixedCostSummary.rows.length, 1, '혼합 PDF에서는 비용 페이지의 행만 집계해야 합니다.')
assert.equal(mixedCostSummary.totalAmount, 1_500_000)
assert.equal(mixedCostSummary.rows[0]?.evidence[0]?.pageNumber, 2)
const multilineMasked = maskSensitiveCostText('주소: 서울 강남구\n1월 공사금액 1,000,000')
assert.match(multilineMasked, /주소: \[비식별화\]\n1월 공사금액 1,000,000/)
for (const vendorText of ['주식회사 ABC', '㈜대한', '(주)대한', '업체: 주식회사 새봄']) {
  assert.doesNotMatch(maskSensitiveCostText(vendorText), /ABC|대한|새봄/, `접두 업체명도 비식별화해야 합니다: ${vendorText}`)
}
for (const contactText of ['070-1234-5678', '080-123-4567', '0505-123-4567', '+82-2-1234-5678', 'sales@daehan.co.kr', '담당자 홍길동']) {
  assert.doesNotMatch(maskSensitiveCostText(contactText), /1234-5678|sales@|홍길동/, `연락처·담당자 정보를 비식별화해야 합니다: ${contactText}`)
}
const sensitiveCostText = '주소: 서울 강남구\n1월 공사금액 1,000,000 연락처 02 1234 5678'
const storageCostDimension: DimensionValue = {
  ...dimension('storage-cost-dimension', 1_000_000, sensitiveCostText, sensitiveCostText, { drawingKind: 'cost-summary' }),
  sourceFile: costFile.name,
  evidence: [{ ...evidence('storage-cost-evidence', 'cost-summary'), fileId: costFile.id, fileName: costFile.name, rawText: sensitiveCostText, imageDataUrl: 'data:image/png;base64,secret' }],
}

const viteServer = await createServer({
  root: rootDirectory,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})
try {
  const projectStore = await viteServer.ssrLoadModule('/src/modules/project-store.ts') as {
    projectForStorage: (project: ProjectState, compact?: boolean) => ProjectState
  }
  const storedCostProject = projectStore.projectForStorage({
    files: [{
      ...costFile,
      previewUrl: 'data:image/png;base64,secret',
      pages: [{ ...costFile.pages[0], kind: 'cost-summary', previewUrl: 'data:image/png;base64,secret', dimensions: [storageCostDimension] }],
    }],
    dimensions: [storageCostDimension],
    heightCandidates: [],
    heightDiagnostics: { candidates: [], entries: [] },
    costSummary,
  } as unknown as ProjectState)
  const storedCostJson = JSON.stringify(storedCostProject)
  assert.doesNotMatch(storedCostJson, /02 1234 5678|data:image\/png;base64,secret/)
  assert.doesNotMatch(storedCostProject.files[0]?.pages[0]?.text || '', /2월 B건설/)
  assert.match(storedCostProject.files[0]?.pages[0]?.text || '', /2월 B\*{3}/)

  const storedMixedProject = projectStore.projectForStorage({
    files: [{ ...mixedDocument, previewUrl: 'data:image/png;base64,normal' }],
    dimensions: [],
    heightCandidates: [],
    heightDiagnostics: { candidates: [], entries: [] },
    costSummary: mixedCostSummary,
    walls: [{ evidence: [{ ...evidence('mixed-wall-evidence'), fileId: mixedDocument.id, fileName: mixedDocument.name, pageNumber: 1 }] }],
  } as unknown as ProjectState)
  assert.equal(storedMixedProject.files[0]?.previewUrl, 'data:image/png;base64,normal', '혼합 PDF 첫 도면 페이지 미리보기는 보존해야 합니다.')
  assert.equal(storedMixedProject.files[0]?.pages[0]?.previewUrl, 'data:image/png;base64,normal')
  assert.equal(storedMixedProject.files[0]?.pages[0]?.text, 'ZONE A WALL W-01 길이 5000')
  assert.equal(storedMixedProject.files[0]?.pages[1]?.previewUrl, '')
  assert.doesNotMatch(storedMixedProject.files[0]?.pages[1]?.text || '', /주식회사 대한/)
  assert.deepEqual(storedMixedProject.files[0]?.pages[1]?.zones, [])
  assert.equal(storedMixedProject.files[0]?.pages[2]?.text, '분류 미정 도면 치수 7000', '명시 비용 페이지가 있는 혼합 PDF의 unknown 페이지를 비용으로 승격하면 안 됩니다.')
  assert.equal(storedMixedProject.files[0]?.pages[2]?.previewUrl, 'data:image/png;base64,unknown')
  assert.doesNotMatch(storedMixedProject.files[0]?.name || '', /대한건설/)
  assert.doesNotMatch(JSON.stringify(storedMixedProject), /대한건설_통합도면/)

  const pdfExtractor = await viteServer.ssrLoadModule('/src/modules/pdf-extractor.ts') as {
    extractPdfVectorSegments: (
      operatorList: { fnArray?: number[]; argsArray?: unknown[][] },
      pageWidth: number,
      pageHeight: number,
      fileId: string,
      fileName: string,
      pageNumber: number,
      drawingKind: DrawingKind,
    ) => Array<{ lengthPageUnits: number }>
  }
  const vectorSegments = pdfExtractor.extractPdfVectorSegments({
    fnArray: [pdfjsLib.OPS.constructPath],
    argsArray: [[
      new Uint8Array([pdfjsLib.OPS.moveTo, pdfjsLib.OPS.lineTo, pdfjsLib.OPS.lineTo, pdfjsLib.OPS.closePath]),
      new Float32Array([10, 10, 90, 10, 90, 90]),
    ]] as unknown[][],
  }, 100, 100, 'vector-regression', 'vector.pdf', 1, 'floor-plan')
  assert.equal(vectorSegments.length, 3, 'constructPath 내부의 PDF.js OPS 경로를 선분으로 변환해야 합니다.')
} finally {
  await viteServer.close()
}

console.log(JSON.stringify({
  signedLevels: [upperLevel?.valueMm, lowerLevel?.valueMm],
  derivedSignedHeightMm: derivedSignedHeight?.valueMm,
  repeatedUnits: repeatedDimensions.map((item) => `${item.valueMm}mm`),
  targetedOpenings: targetedWalls.map((wall) => ({ wall: wall.wallNumber, openings: wall.openings.map((opening) => opening.label) })),
  ambiguousOpeningReviews: ambiguousWalls.map((wall) => wall.reviewStatus),
  clippedOpeningAreaM2: clippedTakeoff?.openingAreaM2,
  costTotal: costSummary.totalAmount,
  constructPath: 'passed',
}, null, 2))
