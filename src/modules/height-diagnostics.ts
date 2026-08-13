import { buildHeightCandidates, isDirectHeightDimension, isLevelDimension } from './height-candidate-extractor.ts'
import type {
  AnalyzedFile,
  BuildingGeometry,
  ConfidenceLevel,
  DimensionValue,
  HeightCandidate,
  HeightDiagnosticCause,
  HeightDiagnosticEntry,
  HeightDiagnostics,
  HeightDiagnosticStage,
  HeightDiagnosticStageId,
  HeightDiagnosticStageStatus,
  Wall,
} from '../types/domain'

export const HEIGHT_DIAGNOSTIC_STAGE_LABELS: Record<HeightDiagnosticStageId, string> = {
  upload: '도면 업로드',
  extraction: 'OCR·PDF 텍스트 추출',
  candidate: '높이 후보 추출',
  normalization: '단위 변환',
  linking: '벽체·구역 연결',
  confidence: '신뢰도 판정',
  model: '3차원 모델 생성',
}

export const HEIGHT_DIAGNOSTIC_STATUS_LABELS: Record<HeightDiagnosticStageStatus | HeightDiagnosticEntry['status'], string> = {
  pending: '대기',
  passed: '통과',
  'needs-review': '확인 필요',
  blocked: '차단',
  'not-started': '시작 전',
  extracted: '추출됨',
  converted: '변환됨',
  linked: '연결됨',
  modelled: '3D 반영됨',
}

export const HEIGHT_DIAGNOSTIC_CAUSE_LABELS: Record<Exclude<HeightDiagnosticCause, null>, string> = {
  'drawing-no-height': '도면에 높이 정보 자체가 없음',
  'ocr-no-height': 'OCR이 높이 숫자를 읽지 못함',
  'height-not-linked': '높이 숫자는 읽었지만 벽체·구역과 연결하지 못함',
  'unit-conversion-failed': '단위 변환에 실패함',
  'invalid-height': '높이가 null·0·NaN 또는 유효하지 않음',
  'low-confidence': '신뢰도가 낮아 3차원 생성을 차단함',
  'field-mismatch': '3차원 입력 필드와 분석 결과 필드가 맞지 않음',
  'height-conflict': '여러 높이 값이 서로 충돌함',
  'level-only': '기준 레벨만 확인됨',
  'handwriting-excluded': '손글씨 높이는 자동 계산에서 제외됨',
  'manual-excluded': '사용자가 제외한 높이 후보입니다',
  'ocr-unavailable': 'OCR 기능이 현재 환경에서 실행되지 않음',
  'drawing-type-unknown': '도면 종류가 불명확함',
}

const STAGE_ORDER: HeightDiagnosticStageId[] = ['upload', 'extraction', 'candidate', 'normalization', 'linking', 'confidence', 'model']

function confidenceRank(value: ConfidenceLevel) {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1
}

function lowerConfidence(left: ConfidenceLevel, right: ConfidenceLevel): ConfidenceLevel {
  return confidenceRank(left) <= confidenceRank(right) ? left : right
}

function validMm(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

function sourcePositionFor(dimension: DimensionValue) {
  const location = dimension.sourcePosition || dimension.evidence[0]?.location
  return location
    ? {
        x: location.x,
        y: location.y,
        width: location.width,
        height: location.height,
      }
    : null
}

function sourceForWall(wall: Wall) {
  return wall.sourceReferences[0] || wall.evidence[0]
}

function noHeightCause(files: AnalyzedFile[], dimensions: DimensionValue[], candidates: HeightCandidate[]): Exclude<HeightDiagnosticCause, null> {
  if (candidates.some((candidate) => candidate.sourceType === 'HANDWRITING')) return 'handwriting-excluded'
  if (candidates.some((candidate) => dimensions.find((dimension) => dimension.id === candidate.candidateId)?.heightExcluded)) return 'manual-excluded'
  if (candidates.some((candidate) => candidate.sourceType === 'LEVEL_CALCULATION' || candidate.status === '기준 레벨만 확인됨')) return 'level-only'
  const drawingFiles = files.filter((file) => file.kind !== 'cost-summary')
  const ocrUnavailable = drawingFiles.some((file) => /OCR\s*(엔진|기능)|OCR.*(사용 불가|초기화|실행하지 못)/i.test([...file.warnings, ...file.pages.flatMap((page) => page.warnings)].join(' ')))
  if (ocrUnavailable) return 'ocr-unavailable'
  const ocrSignal = drawingFiles.some((file) => {
    const imageFile = ['jpg', 'jpeg', 'png'].includes(file.extension)
    return imageFile || file.pages.some((page) => page.dimensions.some((dimension) => dimension.sourceType === 'ocr') || page.warnings.some((warning) => /OCR|읽지 못|스캔/i.test(warning)))
  })
  if (ocrSignal) return 'ocr-no-height'
  if (dimensions.some((dimension) => dimension.heightRole === 'level')) return 'level-only'
  return 'drawing-no-height'
}

function invalidCause(dimension: DimensionValue): Exclude<HeightDiagnosticCause, null> | null {
  if (dimension.valueMm !== null && (!Number.isFinite(dimension.valueMm) || dimension.valueMm <= 0)) return 'invalid-height'
  if (dimension.valueMm === null) {
    if (dimension.value === null || !Number.isFinite(dimension.value) || dimension.value <= 0) return 'invalid-height'
    return 'unit-conversion-failed'
  }
  return null
}

function candidateEntry(
  dimension: DimensionValue,
  candidate: HeightCandidate,
  wall: Wall | undefined,
  modelWallIds: Set<string>,
): HeightDiagnosticEntry {
  const invalid = invalidCause(dimension)
  const source = dimension.evidence[0]
  const wallConfidence = wall ? lowerConfidence(dimension.confidence, wall.confidence) : dimension.confidence
  const fieldMismatch = Boolean(wall && validMm(wall.lengthMm) && validMm(wall.heightMm) && !modelWallIds.has(wall.id))
  const conflict = candidate.status === '높이 값 충돌' || Boolean(wall?.conflicts?.some((item) => item.kind === 'height'))
  const handwriting = candidate.sourceType === 'HANDWRITING' || dimension.handwritingStatus === 'handwriting'
  const uncertainPrint = dimension.handwritingStatus === 'uncertain' || source?.handwritingStatus === 'uncertain'
  const lowConfidence = dimension.confidence === 'low' || wallConfidence === 'low'
  const reviewConfidence = wallConfidence !== 'high'
  const levelOnly = isLevelDimension(dimension)
  const cause = invalid || handwriting
    ? (handwriting ? 'handwriting-excluded' : invalid)
    : dimension.heightExcluded
      ? 'manual-excluded'
    : levelOnly
      ? 'level-only'
      : conflict
        ? 'height-conflict'
        : fieldMismatch
          ? 'field-mismatch'
    : lowConfidence || uncertainPrint
            ? 'low-confidence'
            : wall
              ? null
              : 'height-not-linked'
  const status: HeightDiagnosticEntry['status'] = invalid || handwriting || dimension.heightExcluded || conflict || fieldMismatch
    ? 'blocked'
    : lowConfidence || uncertainPrint || levelOnly || !wall || reviewConfidence
      ? 'needs-review'
      : modelWallIds.has(wall.id)
        ? 'modelled'
        : 'linked'
  const message = cause
    ? HEIGHT_DIAGNOSTIC_CAUSE_LABELS[cause]
    : '높이 후보가 벽체·구역과 연결되어 3차원 입력으로 전달되었습니다.'
  return {
    id: `height-candidate-${dimension.id}`,
    kind: 'candidate',
    dimensionId: dimension.id,
    extractedValue: dimension.value,
    displayValue: dimension.displayValue,
    unit: dimension.unit || null,
    normalizedValueMm: dimension.valueMm,
    sourceFile: dimension.sourceFile || source?.fileName || '',
    pageNumber: dimension.pageNumber || source?.pageNumber || null,
    drawingType: dimension.drawingType || source?.drawingKind || 'unknown',
    sourcePosition: sourcePositionFor(dimension),
    evidenceText: candidate.evidenceText || dimension.context || source?.rawText || dimension.sourceText,
    sourceType: dimension.sourceType || (source?.method === 'ocr' ? 'ocr' : source?.method === 'vector' ? 'vector' : source ? 'pdf-text' : null),
    zone: candidate.relatedZone || wall?.zone || null,
    linkedWallId: wall?.id || null,
    linkedWallNumber: wall?.wallNumber || null,
    confidence: wallConfidence,
    status,
    cause,
    message: uncertainPrint && !handwriting ? '인쇄·손글씨 구분 불확실 · 원본 확인 필요' : message,
    candidateSourceType: candidate.sourceType,
    candidateStatus: candidate.status,
    evidenceImage: candidate.evidenceImage,
    originalText: candidate.originalText,
    upperLevelMm: candidate.upperLevelMm,
    lowerLevelMm: candidate.lowerLevelMm,
    calculation: candidate.calculation,
    referencePlane: candidate.referencePlane,
  }
}

function wallEntry(wall: Wall, cause: Exclude<HeightDiagnosticCause, null>, candidate?: HeightCandidate): HeightDiagnosticEntry {
  const source = sourceForWall(wall)
  return {
    id: `height-wall-${wall.id}`,
    kind: 'wall',
    dimensionId: wall.heightSourceDimensionId || null,
    extractedValue: null,
    displayValue: '높이 미연결',
    unit: null,
    normalizedValueMm: null,
    sourceFile: source?.fileName || candidate?.sourceFileName || '',
    pageNumber: source?.pageNumber || candidate?.pageNumber || null,
    drawingType: source?.drawingKind || 'unknown',
    sourcePosition: source?.location ? {
      x: source.location.x,
      y: source.location.y,
      width: source.location.width,
      height: source.location.height,
    } : candidate?.boundingBox || null,
    evidenceText: source?.rawText || candidate?.evidenceText || '이 벽체에 연결된 높이 근거가 없습니다.',
    sourceType: source?.method === 'ocr' ? 'ocr' : source?.method === 'vector' ? 'vector' : source?.method === 'user' ? 'calculated' : source ? 'pdf-text' : null,
    zone: wall.zone,
    linkedWallId: wall.id,
    linkedWallNumber: wall.wallNumber,
    confidence: wall.confidence,
    status: 'blocked',
    cause,
    message: HEIGHT_DIAGNOSTIC_CAUSE_LABELS[cause],
    candidateSourceType: candidate?.sourceType,
    candidateStatus: candidate?.status,
    evidenceImage: candidate?.evidenceImage || null,
    originalText: candidate?.originalText,
    upperLevelMm: candidate?.upperLevelMm,
    lowerLevelMm: candidate?.lowerLevelMm,
    calculation: candidate?.calculation,
    referencePlane: candidate?.referencePlane,
  }
}

function makeStage(
  id: HeightDiagnosticStageId,
  status: HeightDiagnosticStageStatus,
  message: string,
  cause: HeightDiagnosticCause,
  entryCount: number,
): HeightDiagnosticStage {
  return { id, label: HEIGHT_DIAGNOSTIC_STAGE_LABELS[id], status, message, cause, entryCount }
}

export function emptyHeightDiagnostics(): HeightDiagnostics {
  return {
    stages: STAGE_ORDER.map((id) => makeStage(id, 'pending', '아직 실행되지 않았습니다.', null, 0)),
    entries: [],
    candidates: [],
    overallStatus: 'not-started',
    currentStage: 'upload',
    message: '도면 파일을 올리면 높이 진단을 시작합니다.',
    floorPlanOnly: false,
    candidateCount: 0,
    validCandidateCount: 0,
    linkedWallCount: 0,
    wallCount: 0,
    modelWallCount: 0,
  }
}

export function buildHeightDiagnostics(
  files: AnalyzedFile[],
  dimensions: DimensionValue[],
  walls: Wall[],
  model: BuildingGeometry,
  suppliedCandidates?: HeightCandidate[],
): HeightDiagnostics {
  if (!files.length) return emptyHeightDiagnostics()
  const drawingFiles = files.filter((file) => file.kind !== 'cost-summary')
  const pages = drawingFiles.flatMap((file) => file.pages)
  const floorPlanOnly = pages.some((page) => page.kind === 'floor-plan') && !pages.some((page) => page.kind === 'elevation' || page.kind === 'section')
  const candidates = suppliedCandidates || buildHeightCandidates(files, dimensions, walls)
  const directCandidates = candidates.filter((candidate) => {
    const dimension = dimensions.find((item) => item.id === candidate.candidateId)
    return dimension && isDirectHeightDimension(dimension)
  })
  const levelCandidates = candidates.filter((candidate) => candidate.status === '기준 레벨만 확인됨')
  const validDirectCandidates = directCandidates.filter((candidate) => {
    const dimension = dimensions.find((item) => item.id === candidate.candidateId)
    return validMm(candidate.valueMm) && candidate.confidence !== 'low' && candidate.status !== '손글씨라 자동 계산 제외' && candidate.status !== '높이 값 충돌'
      && !dimension?.heightExcluded
  })
  const validCandidateIds = new Set(validDirectCandidates.map((candidate) => candidate.candidateId))
  const modelWallIds = new Set(model.walls.map((wall) => wall.wallId))
  const linkedWalls = walls.filter((wall) => Boolean(wall.heightSourceDimensionId && validCandidateIds.has(wall.heightSourceDimensionId)))
  const wallByDimension = new Map<string, Wall | undefined>()
  for (const candidate of candidates) {
    const candidateDimension = dimensions.find((dimension) => dimension.id === candidate.candidateId)
    if (candidateDimension?.heightExcluded) {
      wallByDimension.set(candidate.candidateId, undefined)
      continue
    }
    wallByDimension.set(candidate.candidateId, walls.find((wall) => wall.heightSourceDimensionId === candidate.candidateId || wall.sourceDimensionIds.includes(candidate.candidateId) || (candidateDimension && isDirectHeightDimension(candidateDimension) && validMm(candidateDimension.valueMm) && validMm(wall.heightMm) && candidate.relatedZone?.toLowerCase() === wall.zone.toLowerCase() && candidateDimension.valueMm === wall.heightMm)))
  }
  const entries = candidates.map((candidate) => {
    const dimension = dimensions.find((item) => item.id === candidate.candidateId)
    return dimension ? candidateEntry(dimension, candidate, wallByDimension.get(candidate.candidateId), modelWallIds) : null
  }).filter((entry): entry is HeightDiagnosticEntry => Boolean(entry))
  const noCandidate = noHeightCause(files, dimensions, candidates)

  for (const wall of walls) {
    if (wall.heightMm !== null && wall.heightSourceDimensionId && validCandidateIds.has(wall.heightSourceDimensionId)) continue
    const related = candidates.find((candidate) => wall.sourceDimensionIds.includes(candidate.candidateId))
    const conflict = wall.conflicts?.some((item) => item.kind === 'height')
    const cause: Exclude<HeightDiagnosticCause, null> = conflict
      ? 'height-conflict'
      : related?.sourceType === 'HANDWRITING'
        ? 'handwriting-excluded'
        : related && related.status === '기준 레벨만 확인됨'
          ? 'level-only'
          : related
            ? related.confidence === 'low' ? 'low-confidence' : 'height-not-linked'
            : noCandidate
    entries.push(wallEntry(wall, cause, related))
  }

  const hasExtractedData = pages.some((page) => page.text.trim() || page.dimensions.length || page.vectorSegments.length)
  const invalidCandidates = directCandidates.filter((candidate) => {
    const dimension = dimensions.find((item) => item.id === candidate.candidateId)
    return Boolean(dimension && invalidCause(dimension))
  })
  const extractionCause = candidates.length ? null : noCandidate
  const extractionStatus: HeightDiagnosticStageStatus = hasExtractedData ? 'passed' : 'needs-review'
  const candidateStatus: HeightDiagnosticStageStatus = candidates.length ? 'passed' : 'blocked'
  const normalizationStatus: HeightDiagnosticStageStatus = !directCandidates.length
    ? (levelCandidates.length ? 'needs-review' : 'blocked')
    : invalidCandidates.length ? 'blocked' : 'passed'
  const normalizationCause: HeightDiagnosticCause = invalidCandidates.length
    ? invalidCause(dimensions.find((item) => item.id === invalidCandidates[0]?.candidateId) as DimensionValue)
    : !directCandidates.length ? noCandidate : null
  const conflictCount = candidates.filter((candidate) => candidate.status === '높이 값 충돌').length
  const linkingStatus: HeightDiagnosticStageStatus = !walls.length || !linkedWalls.length
    ? 'blocked'
    : linkedWalls.length < walls.length ? 'needs-review' : 'passed'
  const linkingCause: HeightDiagnosticCause = conflictCount
    ? 'height-conflict'
    : !walls.length ? 'height-not-linked'
      : linkedWalls.length < walls.length ? (directCandidates.length ? 'height-not-linked' : noCandidate)
        : null
  const confidenceReview = candidates.filter((candidate) => candidate.confidence !== 'high' || candidate.status === '확인 필요')
  const lowConfidence = confidenceReview.filter((candidate) => candidate.confidence === 'low' || candidate.status === '확인 필요')
  const confidenceStatus: HeightDiagnosticStageStatus = confidenceReview.length || conflictCount
    ? 'needs-review'
    : linkedWalls.length ? 'passed' : 'blocked'
  const knownGeometryWalls = walls.filter((wall) => validMm(wall.lengthMm) && validMm(wall.heightMm))
  const fieldMismatch = knownGeometryWalls.some((wall) => !modelWallIds.has(wall.id))
  const modelStatus: HeightDiagnosticStageStatus = fieldMismatch || !model.isReady
    ? 'blocked'
    : model.partial || confidenceReview.length || conflictCount ? 'needs-review' : 'passed'
  const modelCause: HeightDiagnosticCause = fieldMismatch
    ? 'field-mismatch'
    : conflictCount
      ? 'height-conflict'
    : lowConfidence.length
        ? 'low-confidence'
        : !model.isReady
          ? (directCandidates.length && !linkedWalls.length ? 'height-not-linked' : noCandidate)
          : null

  const stages: HeightDiagnosticStage[] = [
    makeStage('upload', 'passed', `${drawingFiles.length}개 설계도 파일과 ${pages.length}개 페이지가 프로젝트에 들어왔습니다.`, null, drawingFiles.length),
    makeStage('extraction', extractionStatus, hasExtractedData ? `${pages.length}개 페이지에서 텍스트·OCR·벡터 데이터를 확인했습니다.` : 'PDF 텍스트와 OCR 결과에서 읽을 수 있는 도면 정보가 없습니다.', extractionStatus === 'passed' ? null : extractionCause, pages.length),
    makeStage('candidate', candidateStatus, candidates.length ? `${candidates.length}개의 높이·레벨 후보를 추출했습니다.` : HEIGHT_DIAGNOSTIC_CAUSE_LABELS[noCandidate], candidates.length ? null : noCandidate, candidates.length),
    makeStage('normalization', normalizationStatus, !directCandidates.length ? (levelCandidates.length ? '레벨 값은 확인했지만 두 기준의 높이 차이를 계산하지 못했습니다.' : '변환할 직접 높이 후보가 없습니다.') : invalidCandidates.length ? '높이 후보의 mm 변환 결과를 확인해야 합니다.' : `${validDirectCandidates.length}개 직접 높이 후보를 mm 기준으로 확인했습니다.`, normalizationCause, validDirectCandidates.length),
    makeStage('linking', linkingStatus, !walls.length ? '높이를 연결할 벽체가 생성되지 않았습니다.' : `${linkedWalls.length}/${walls.length}개 벽체에 높이 후보를 연결했습니다.`, linkingCause, linkedWalls.length),
    makeStage('confidence', confidenceStatus, conflictCount ? `${conflictCount}개 높이 후보가 서로 충돌합니다. 하나를 자동 선택하지 않았습니다.` : confidenceReview.length ? `${confidenceReview.length}개 높이 후보가 검토 상태입니다. 낮은 신뢰도는 3D 자동 연결에서 제외합니다.` : linkedWalls.length ? '연결된 높이 근거의 신뢰도를 확인했습니다.' : '신뢰도를 판정할 연결 높이가 없습니다.', conflictCount ? 'height-conflict' : lowConfidence.length ? 'low-confidence' : linkedWalls.length ? null : linkingCause, confidenceReview.length || conflictCount || linkedWalls.length),
    makeStage('model', modelStatus, fieldMismatch ? '벽체 높이는 있지만 3차원 입력 필드와 연결되지 않았습니다.' : model.isReady ? `${model.walls.length}개 벽체가 3차원 입력으로 전달되었습니다.${model.partial ? ' 일부 벽체는 높이 확인 후 추가됩니다.' : ''}` : model.blockedReason, modelCause, model.walls.length),
  ]

  const complete = model.isReady && !model.partial && walls.length > 0 && linkedWalls.length === walls.length && directCandidates.length > 0 && validDirectCandidates.length === directCandidates.length && directCandidates.every((candidate) => candidate.status === '벽체 연결 완료') && confidenceReview.length === 0 && conflictCount === 0 && !fieldMismatch
  const overallStatus: HeightDiagnostics['overallStatus'] = complete ? 'passed' : model.isReady || candidates.length || linkedWalls.length ? 'needs-review' : 'blocked'
  const currentStage = stages.find((stage) => stage.status === 'blocked' || stage.status === 'needs-review')?.id || 'model'
  const message = complete
    ? '높이 정보 확인 완료 · 높이 확인 후 3차원 모델과 자재 계산에 사용할 수 있습니다.'
    : floorPlanOnly && walls.some((wall) => wall.heightMm === null)
      ? '현재 파일에서 평면 치수는 확인했지만 벽체 높이를 확인할 수 없습니다. 입면도·단면도·층고표를 추가해 주세요.'
      : conflictCount
        ? '높이 값이 서로 충돌합니다. 두 출처를 비교해 사람이 하나를 확인한 뒤 다시 계산하세요.'
        : invalidCandidates.length
          ? `${HEIGHT_DIAGNOSTIC_CAUSE_LABELS[normalizationCause || 'invalid-height']} · 원본 숫자와 단위를 확인한 뒤 다시 분석하세요.`
          : lowConfidence.length
            ? '신뢰도가 낮거나 인쇄·손글씨 구분이 불확실한 높이는 자동 연결하지 않았습니다. 원본 도면을 확인하세요.'
        : levelCandidates.length && !directCandidates.length
          ? '레벨 정보만 확인됨 · 상부 레벨과 하부 레벨이 같은 기준으로 확인될 때만 벽 높이를 계산합니다.'
          : candidates.some((candidate) => candidate.sourceType === 'HANDWRITING')
            ? '손글씨로 보이는 높이는 자동 발주 계산에 사용하지 않았습니다. 원본 도면의 높이 정보 또는 담당자 확인이 필요합니다.'
            : directCandidates.length && !linkedWalls.length
              ? '높이 후보는 찾았지만 벽체와 연결하지 못했습니다. 같은 구역명·벽체 번호·축선이 있는 입면도 또는 단면도를 확인하세요.'
              : !candidates.length
                ? HEIGHT_DIAGNOSTIC_CAUSE_LABELS[noCandidate]
                : model.blockedReason

  return {
    stages,
    entries,
    candidates,
    overallStatus,
    currentStage,
    message,
    floorPlanOnly,
    candidateCount: candidates.length,
    validCandidateCount: validDirectCandidates.length,
    linkedWallCount: linkedWalls.length,
    wallCount: walls.length,
    modelWallCount: model.walls.length,
  }
}
