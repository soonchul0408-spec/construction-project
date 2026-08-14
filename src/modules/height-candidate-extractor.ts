import type {
  AnalyzedFile,
  ConfidenceLevel,
  DimensionValue,
  Evidence,
  HeightCandidate,
  HeightCandidateSourceType,
  HeightCandidateStatus,
  HeightRole,
  SourcePosition,
  Wall,
} from '../types/domain'

function confidenceRank(value: ConfidenceLevel) {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1
}

function lowerConfidence(left: ConfidenceLevel, right: ConfidenceLevel): ConfidenceLevel {
  return confidenceRank(left) <= confidenceRank(right) ? left : right
}

function roleOf(dimension: DimensionValue): HeightRole {
  if (isOpeningDimension(dimension)) return 'none'
  // A PDF text item can inherit a nearby "floor to ceiling" label while the
  // actual number is an EL/LEVEL datum. Treat explicit level markers first so
  // +0.000 remains a valid datum rather than an invalid direct height.
  if (dimension.heightRole === 'level-calculated') return 'level-calculated'
  if (/\b(EL|LEVEL)\b|T\.?O\.?S|T\.?O\.?F|FFL|GL/i.test(dimension.context)) return 'level'
  if (dimension.heightRole) return dimension.heightRole
  if (/(벽체\s*높이|wall\s*height|층고|천장고|ceiling\s*height|높이|height|\bH\s*[:=]|\bHT\s*[:=]?)/i.test(dimension.context)) return 'direct'
  if (['elevation', 'section'].includes(dimension.drawingType.toLowerCase()) && validMm(dimension.valueMm) && (dimension.valueMm as number) >= 1800 && (dimension.valueMm as number) <= 20000) return 'direct'
  return 'none'
}

function isOpeningDimension(dimension: DimensionValue) {
  const sourceIndex = dimension.context.lastIndexOf(dimension.sourceText)
  const nearbyText = sourceIndex >= 0
    ? dimension.context.slice(Math.max(0, sourceIndex - 24), sourceIndex + dimension.sourceText.length + 24)
    : dimension.context
  const tokenMatches = [...nearbyText.matchAll(/\b([DW]\s*[-#]?\s*\d+)\b/gi)]
    .filter((match) => !/(?:\bWALL(?:\s+NO\.?)?|\b벽체(?:\s+번호)?|\bAXIS|\bGRID|\b축|\b그리드)\s*$/i.test(nearbyText.slice(0, match.index || 0)))
  return Boolean(tokenMatches.length || /(문|door|창|window)/i.test(nearbyText))
}

export function isLevelDimension(dimension: DimensionValue) {
  return roleOf(dimension) === 'level'
}

export function isDirectHeightDimension(dimension: DimensionValue) {
  const role = roleOf(dimension)
  return role === 'direct' || role === 'level-calculated'
}

function validMm(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

function finiteLevelMm(value: number | null): value is number {
  return value !== null && Number.isFinite(value)
}

function zoneFromText(text: string) {
  const matches = [...text.matchAll(/ZONE\s*[A-Z0-9-]+|[A-Z가-힣0-9-]+\s*구역|구역\s*[A-Z가-힣0-9-]+|[1-9]\s*층/gi)]
  return matches.at(-1)?.[0]?.replace(/\s+/g, ' ').trim() || null
}

function primaryEvidence(dimension: DimensionValue) {
  return dimension.evidence[0]
}

function levelRole(dimension: DimensionValue) {
  return dimension.levelDatum?.role || (/(T\.?O\.?S|TOP|상부|천장)/i.test(dimension.context)
    ? 'upper'
    : /(T\.?O\.?F|FFL|GL|BOTTOM|하부|바닥)/i.test(dimension.context)
      ? 'lower'
      : 'unknown') as 'upper' | 'lower' | 'unknown'
}

function levelGroupKey(dimension: DimensionValue) {
  const evidence = primaryEvidence(dimension)
  if (!evidence) return null
  const zone = zoneFromText(dimension.context)
  return `${evidence.fileId}:${evidence.pageNumber}:${zone || 'no-zone'}`
}

function drawingType(kind: string): HeightCandidate['drawingType'] {
  const map: Record<string, HeightCandidate['drawingType']> = {
    'floor-plan': 'PLAN',
    elevation: 'ELEVATION',
    section: 'SECTION',
    detail: 'DETAIL',
    'material-schedule': 'TABLE',
    'cost-summary': 'TABLE',
  }
  return map[kind] || 'UNKNOWN'
}

function positionOf(dimension: DimensionValue): SourcePosition | null {
  if (dimension.sourcePosition && (dimension.sourcePosition.width || dimension.sourcePosition.height || dimension.sourcePosition.x || dimension.sourcePosition.y)) return dimension.sourcePosition
  const location = primaryEvidence(dimension)?.location
  return location ? { x: location.x, y: location.y, width: location.width, height: location.height } : null
}

function sourceTypeOf(dimension: DimensionValue): HeightCandidateSourceType {
  if (dimension.source === 'calculated' || dimension.sourceType === 'calculated') return 'LEVEL_CALCULATION'
  if (dimension.handwritingStatus === 'handwriting' || primaryEvidence(dimension)?.handwritingStatus === 'handwriting') return 'HANDWRITING'
  if (dimension.sourceType === 'ocr') return 'PRINTED_OCR'
  return 'PDF_TEXT'
}

function handwritingOf(dimension: DimensionValue) {
  return dimension.handwritingStatus || primaryEvidence(dimension)?.handwritingStatus || (dimension.sourceType === 'ocr' ? 'uncertain' : 'printed')
}

function sourceStatus(
  dimension: DimensionValue,
  wall: Wall | undefined,
  conflict: boolean,
): HeightCandidateStatus {
  const role = roleOf(dimension)
  const handwriting = handwritingOf(dimension)
  if (handwriting === 'handwriting') return '손글씨라 자동 계산 제외'
  if (dimension.heightExcluded) return '확인 필요'
  if (handwriting === 'uncertain') return '확인 필요'
  if (role === 'level') return '기준 레벨만 확인됨'
  if (!validMm(dimension.valueMm)) return dimension.valueMm === null && dimension.value !== null ? '확인 필요' : '확인 필요'
  if (conflict) return '높이 값 충돌'
  if (wall && (wall.heightSourceDimensionId === dimension.id || dimensionMatchesWall(dimension, wall))) return '벽체 연결 완료'
  return wall ? '높이 연결 필요' : '높이 후보 발견'
}

function dimensionMatchesWall(dimension: DimensionValue, wall: Wall) {
  if (wall.heightSourceDimensionId === dimension.id) return true
  const zone = zoneFromText(dimension.context)
  const manualMatches = dimension.manualWallNumber?.toLowerCase() === wall.wallNumber.toLowerCase() &&
    (dimension.manualZone || zone || '').toLowerCase() === wall.zone.toLowerCase()
  return isDirectHeightDimension(dimension) && validMm(dimension.valueMm) && validMm(wall.heightMm) &&
    (manualMatches || (Boolean(zone) && zone?.toLowerCase() === wall.zone.toLowerCase() && dimension.valueMm === wall.heightMm))
}

export function deriveLevelHeightDimensions(dimensions: DimensionValue[]) {
  // Elevation datums are signed coordinates, not physical lengths. Negative
  // and zero datums are valid inputs; the derived wall height must still pass
  // the positive-length validation below.
  const levels = dimensions.filter((dimension) => isLevelDimension(dimension) && finiteLevelMm(dimension.valueMm) && primaryEvidence(dimension))
  const groups = new Map<string, DimensionValue[]>()
  for (const level of levels) {
    const key = levelGroupKey(level)
    if (!key) continue
    const group = groups.get(key) || []
    group.push(level)
    groups.set(key, group)
  }
  const derived: DimensionValue[] = []
  for (const group of groups.values()) {
    const uppers = group.filter((level) => levelRole(level) === 'upper')
    const lowers = group.filter((level) => levelRole(level) === 'lower')
    const unknown = group.filter((level) => levelRole(level) === 'unknown')
    // A page can contain several floor/roof datums. Guessing the first upper
    // and lower value can silently create the wrong wall height, so automatic
    // derivation is limited to an unambiguous 1:1 pair.
    const pair = uppers.length === 1 && lowers.length === 1 && unknown.length === 0
      ? [uppers[0], lowers[0]] as const
      : uppers.length === 0 && lowers.length === 0 && unknown.length === 2
        ? [...unknown].sort((left, right) => (right.valueMm as number) - (left.valueMm as number)) as [DimensionValue, DimensionValue]
        : null
    if (!pair) continue
    const [upperLevel, lowerLevel] = pair
    const difference = (upperLevel.valueMm as number) - (lowerLevel.valueMm as number)
    if (!validMm(difference)) continue
    const upperEvidence = primaryEvidence(upperLevel) as Evidence
    const lowerEvidence = primaryEvidence(lowerLevel) as Evidence
    const context = `${zoneFromText(upperLevel.context) || ''} 레벨 계산 ${upperLevel.displayValue} - ${lowerLevel.displayValue}`.trim()
    const calculation = `${upperLevel.displayValue}mm - ${lowerLevel.displayValue}mm = ${difference}mm`
    const evidence: Evidence = {
      ...upperEvidence,
      method: 'derived',
      rawText: `${upperLevel.sourceText} - ${lowerLevel.sourceText}`,
      note: `상부 레벨과 하부 레벨의 차이로 계산: ${calculation}`,
      handwritingStatus: handwritingOf(upperLevel) === 'printed' && handwritingOf(lowerLevel) === 'printed' ? 'printed' : 'uncertain',
    }
    derived.push({
      id: `level-height-${upperLevel.id}-${lowerLevel.id}`,
      label: '높이 후보',
      value: difference,
      unit: 'mm',
      normalizedValueMm: difference,
      sourceFile: upperLevel.sourceFile,
      pageNumber: upperLevel.pageNumber,
      drawingType: upperLevel.drawingType,
      sourceText: calculation,
      sourcePosition: upperLevel.sourcePosition,
      sourceType: 'calculated',
      valueMm: difference,
      displayValue: String(difference),
      confidence: lowerConfidence(upperLevel.confidence, lowerLevel.confidence),
      source: 'calculated',
      evidence: [evidence, lowerEvidence],
      context,
      userEdited: false,
      originalValueMm: difference,
      userValueMm: null,
      heightRole: 'level-calculated',
      handwritingStatus: evidence.handwritingStatus,
      upperLevelMm: upperLevel.valueMm,
      lowerLevelMm: lowerLevel.valueMm,
      calculation,
      referencePlane: upperLevel.levelDatum?.referencePlane || lowerLevel.levelDatum?.referencePlane || null,
    })
  }
  return derived
}

function candidateFromDimension(dimension: DimensionValue, walls: Wall[]): HeightCandidate {
  const wall = walls.find((item) => item.heightSourceDimensionId === dimension.id || item.sourceDimensionIds.includes(dimension.id) || dimensionMatchesWall(dimension, item))
  const conflict = walls.some((item) => item.sourceDimensionIds.includes(dimension.id) && item.conflicts?.some((entry) => entry.kind === 'height'))
  const evidence = primaryEvidence(dimension)
  const status = sourceStatus(dimension, wall, conflict)
  return {
    candidateId: dimension.id,
    valueMm: dimension.valueMm,
    originalText: dimension.sourceText || dimension.displayValue,
    unit: dimension.unit || null,
    sourceFileName: dimension.sourceFile || evidence?.fileName || '',
    pageNumber: dimension.pageNumber || evidence?.pageNumber || null,
    sourceType: sourceTypeOf(dimension),
    boundingBox: positionOf(dimension),
    drawingType: drawingType(dimension.drawingType || evidence?.drawingKind || ''),
    nearbyLabel: dimension.context || dimension.label,
    relatedZone: dimension.manualZone || zoneFromText(dimension.context),
    relatedWallId: wall?.id || null,
    confidence: dimension.confidence,
    status,
    evidenceImage: evidence?.imageDataUrl || null,
    evidenceText: dimension.context || evidence?.rawText || dimension.sourceText,
    upperLevelMm: dimension.upperLevelMm,
    lowerLevelMm: dimension.lowerLevelMm,
    calculation: dimension.calculation,
    referencePlane: dimension.referencePlane || dimension.levelDatum?.referencePlane || null,
  }
}

export function buildHeightCandidates(
  files: AnalyzedFile[],
  dimensions: DimensionValue[],
  walls: Wall[] = [],
): HeightCandidate[] {
  void files
  return dimensions
    .filter((dimension) => isDirectHeightDimension(dimension) || isLevelDimension(dimension))
    .filter((dimension) => dimension.evidence[0]?.drawingKind !== 'cost-summary')
    .map((dimension) => candidateFromDimension(dimension, walls))
}
