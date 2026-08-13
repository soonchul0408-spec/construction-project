import assert from 'node:assert/strict'

import { buildHeightCandidates, deriveLevelHeightDimensions } from '../src/modules/height-candidate-extractor.ts'
import { buildBuildingGeometry, buildWalls } from '../src/modules/drawing-geometry-model.ts'
import { buildHeightDiagnostics } from '../src/modules/height-diagnostics.ts'
import { applyHeightReview, markHeightReviewRecalculated } from '../src/modules/height-review.ts'
import { calculateTakeoffs } from '../src/modules/material-takeoff-engine.ts'
import { normalizeNumericToken, numericTokensFromText, toDimensionValue } from '../src/modules/dimension-normalizer.ts'
import { DEFAULT_MATERIAL_SETTINGS } from '../src/types/domain.ts'
import type { AnalyzedFile, DimensionValue, DrawingKind, Evidence, DrawingPage } from '../src/types/domain.ts'

let dimensionSequence = 0

function evidence(fileId: string, fileName: string, kind: DrawingKind, method: Evidence['method'] = 'pdf-text', handwritingStatus?: Evidence['handwritingStatus']): Evidence {
  return {
    fileId,
    fileName,
    pageNumber: 1,
    drawingKind: kind,
    method,
    rawText: '',
    handwritingStatus,
    location: { x: 0.2, y: 0.2, width: 0.2, height: 0.04, coordinateSystem: 'normalized' },
  }
}

function dimension(text: string, kind: DrawingKind, fileId: string, method: Evidence['method'] = 'pdf-text', handwritingStatus?: Evidence['handwritingStatus']) {
  const itemEvidence = evidence(fileId, `${fileId}.pdf`, kind, method, handwritingStatus)
  const token = numericTokensFromText(text, itemEvidence)[0]
  assert.ok(token, `숫자 토큰을 읽어야 합니다: ${text}`)
  const normalized = normalizeNumericToken({ ...token, evidence: { ...itemEvidence, rawText: text } })
  const result = toDimensionValue(normalized, dimensionSequence++)
  if (handwritingStatus) result.handwritingStatus = handwritingStatus
  return result
}

function file(fileId: string, kind: DrawingKind, dimensions: DimensionValue[]): AnalyzedFile {
  const page: DrawingPage = {
    id: `${fileId}-page-1`,
    pageNumber: 1,
    width: 1000,
    height: 1000,
    text: dimensions.map((item) => item.context).join('\n'),
    previewUrl: '',
    kind,
    kindConfidence: 'high',
    dimensions,
    zones: [],
    roomNames: [],
    axisLabels: [],
    scales: [],
    unitCandidates: ['mm'],
    vectorSegments: [],
    warnings: [],
    handWritingDetected: false,
    handwritingStatus: 'printed',
  }
  return {
    id: fileId,
    name: `${fileId}.pdf`,
    extension: 'pdf',
    mimeType: 'application/pdf',
    size: 1,
    status: 'complete',
    stage: 'complete',
    progress: 100,
    kind,
    kindConfidence: 'high',
    pages: [page],
    previewUrl: '',
    warnings: [],
    error: '',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    canReanalyze: true,
    externalProcessing: false,
  }
}

const h2800 = dimension('H=2800 mm', 'elevation', 'h2800')
assert.equal(h2800.valueMm, 2800)
assert.equal(h2800.heightRole, 'direct')

const h28m = dimension('높이 2.8m', 'section', 'h28m')
assert.equal(h28m.valueMm, 2800)
assert.equal(h28m.unit, 'm')

const planLength = dimension('ZONE A WALL W-01 평면 길이 3000 mm', 'floor-plan', 'classification')
const wallHeight = dimension('ZONE A WALL W-01 높이 3000 mm', 'elevation', 'classification-height')
assert.equal(planLength.heightRole, 'none')
assert.equal(wallHeight.heightRole, 'direct')

const upperLevel = dimension('ZONE A EL.+4,200', 'section', 'levels')
const lowerLevel = dimension('ZONE A EL.+2,800', 'section', 'levels')
const calculatedLevelHeight = deriveLevelHeightDimensions([upperLevel, lowerLevel])
assert.equal(calculatedLevelHeight.length, 1)
assert.equal(calculatedLevelHeight[0]?.valueMm, 1400)
assert.match(calculatedLevelHeight[0]?.calculation || '', /4,?200.*2,?800.*1400/)
assert.equal(deriveLevelHeightDimensions([upperLevel]).length, 0, '레벨 하나만으로 벽 높이를 만들면 안 됩니다.')

const handwrittenHeight = dimension('H=2800', 'elevation', 'handwritten', 'ocr', 'handwriting')
const handwrittenCandidates = buildHeightCandidates([file('handwritten', 'elevation', [handwrittenHeight])], [handwrittenHeight])
assert.equal(handwrittenCandidates[0]?.sourceType, 'HANDWRITING')
assert.equal(handwrittenCandidates[0]?.status, '손글씨라 자동 계산 제외')

const length = dimension('ZONE A WALL W-01 길이 5000 mm', 'floor-plan', 'link-plan')
const linkedHeight = dimension('ZONE A WALL W-01 H=2800 mm', 'elevation', 'link-elevation')
const linkedFiles = [file('link-plan', 'floor-plan', [length]), file('link-elevation', 'elevation', [linkedHeight])]
const linkedWalls = buildWalls(linkedFiles, [length, linkedHeight])
assert.equal(linkedWalls[0]?.heightMm, 2800)
assert.equal(linkedWalls[0]?.heightSourceDimensionId, linkedHeight.id)
const linkedModel = buildBuildingGeometry(linkedWalls)
assert.equal(linkedModel.walls[0]?.heightMm, 2800)
const linkedTakeoff = calculateTakeoffs(linkedWalls, DEFAULT_MATERIAL_SETTINGS)
assert.equal(linkedTakeoff[0]?.heightMm, 2800)

const approvedHeight = applyHeightReview(linkedHeight, {
  action: 'approved',
  reason: '입면도 원본의 인쇄 치수와 대조',
  reviewedAt: '2026-08-13T00:00:00.000Z',
})
assert.equal(approvedHeight.heightExcluded, false)
assert.equal(approvedHeight.heightReview?.beforeValueMm, 2800)
assert.equal(approvedHeight.heightReview?.afterValueMm, 2800)
const editedHeight = applyHeightReview(approvedHeight, {
  action: 'edited',
  valueMm: 4200,
  reason: '단면도와 대조 후 사용자 확인',
  reviewedAt: '2026-08-13T00:01:00.000Z',
})
const editedWalls = buildWalls(linkedFiles, [length, editedHeight])
assert.equal(editedWalls[0]?.heightMm, 4200)
assert.equal(calculateTakeoffs(editedWalls, DEFAULT_MATERIAL_SETTINGS)[0]?.heightMm, 4200)
assert.equal(markHeightReviewRecalculated(editedHeight, '2026-08-13T00:02:00.000Z').heightReview?.recalculatedAt, '2026-08-13T00:02:00.000Z')
const excludedHeight = applyHeightReview(linkedHeight, {
  action: 'marked-handwriting',
  reason: '펜 표기로 판단되어 자동 계산 제외',
  reviewedAt: '2026-08-13T00:03:00.000Z',
})
assert.equal(buildWalls(linkedFiles, [length, excludedHeight])[0]?.heightMm, null)

const unlinkedHeight = dimension('OTHER ZONE WALL W-X H=3500 mm', 'section', 'unlinked-section')
const unlinkedFiles = [file('link-plan', 'floor-plan', [length]), file('unlinked-section', 'section', [unlinkedHeight])]
const unlinkedWalls = buildWalls(unlinkedFiles, [length, unlinkedHeight])
assert.equal(unlinkedWalls[0]?.heightMm, null)
const unlinkedModel = buildBuildingGeometry(unlinkedWalls)
const unlinkedDiagnostics = buildHeightDiagnostics(unlinkedFiles, [length, unlinkedHeight], unlinkedWalls, unlinkedModel)
assert.equal(unlinkedDiagnostics.entries.some((entry) => entry.cause === 'height-not-linked'), true)
assert.notEqual(unlinkedDiagnostics.overallStatus, 'passed')
const manualLinkedHeight = applyHeightReview(unlinkedHeight, {
  action: 'linked',
  wallNumber: 'W-01',
  zone: 'ZONE A',
  reason: '사용자가 같은 벽체를 선택함',
  reviewedAt: '2026-08-13T00:04:00.000Z',
})
assert.equal(buildWalls(unlinkedFiles, [length, manualLinkedHeight])[0]?.heightMm, 3500)

const conflictOne = dimension('ZONE A WALL W-01 H=2800 mm', 'elevation', 'conflict-a')
const conflictTwo = dimension('ZONE A WALL W-01 H=3000 mm', 'elevation', 'conflict-b')
const conflictFiles = [file('link-plan', 'floor-plan', [length]), file('conflict-a', 'elevation', [conflictOne]), file('conflict-b', 'elevation', [conflictTwo])]
const conflictWalls = buildWalls(conflictFiles, [length, conflictOne, conflictTwo])
assert.equal(conflictWalls[0]?.heightMm, null, '충돌한 높이를 임의로 선택하면 안 됩니다.')
const conflictDiagnostics = buildHeightDiagnostics(conflictFiles, [length, conflictOne, conflictTwo], conflictWalls, buildBuildingGeometry(conflictWalls))
assert.equal(conflictDiagnostics.entries.some((entry) => entry.cause === 'height-conflict'), true)

const noHeightFiles = [file('only-plan', 'floor-plan', [length])]
const noHeightWalls = buildWalls(noHeightFiles, [length])
const noHeightDiagnostics = buildHeightDiagnostics(noHeightFiles, [length], noHeightWalls, buildBuildingGeometry(noHeightWalls))
assert.equal(noHeightDiagnostics.floorPlanOnly, true)
assert.match(noHeightDiagnostics.message, /평면 치수는 확인했지만 벽체 높이를 확인할 수 없습니다/)

const ocrUnavailableFile = file('ocr-unavailable', 'floor-plan', [])
ocrUnavailableFile.warnings = ['OCR 기능이 현재 환경에서 실행되지 않았습니다.']
ocrUnavailableFile.pages[0]!.warnings = [...ocrUnavailableFile.pages[0]!.warnings, ...ocrUnavailableFile.warnings]
const ocrUnavailableDiagnostics = buildHeightDiagnostics([ocrUnavailableFile], [], [], buildBuildingGeometry([]))
assert.equal(ocrUnavailableDiagnostics.stages.find((stage) => stage.id === 'candidate')?.cause, 'ocr-unavailable')

const heightA = dimension('ZONE A WALL W-01 H=2800 mm', 'elevation', 'different-height-a')
const lengthA = dimension('ZONE A WALL W-01 길이 5000 mm', 'floor-plan', 'different-height-plan')
const lengthB = dimension('ZONE B WALL W-02 길이 4000 mm', 'floor-plan', 'different-height-plan')
const heightB = dimension('ZONE B WALL W-02 H=4200 mm', 'section', 'different-height-b')
const differentWalls = buildWalls([file('different-height-plan', 'floor-plan', [lengthA, lengthB]), file('different-height-a', 'elevation', [heightA]), file('different-height-b', 'section', [heightB])], [lengthA, lengthB, heightA, heightB])
const differentModel = buildBuildingGeometry(differentWalls)
assert.deepEqual(differentModel.walls.map((wall) => wall.heightMm), [2800, 4200])

console.log(JSON.stringify({
  direct: { h2800: h2800.valueMm, h28m: h28m.valueMm },
  levelCalculation: calculatedLevelHeight[0]?.calculation,
  handwriting: handwrittenCandidates[0]?.status,
  linkedWallHeight: linkedWalls[0]?.heightMm,
  approvedThenEdited: calculateTakeoffs(editedWalls, DEFAULT_MATERIAL_SETTINGS)[0]?.heightMm,
  unlinked: unlinkedDiagnostics.message,
  conflict: conflictDiagnostics.message,
  ocrUnavailable: ocrUnavailableDiagnostics.message,
  differentHeights: differentModel.walls.map((wall) => wall.heightMm),
}, null, 2))
