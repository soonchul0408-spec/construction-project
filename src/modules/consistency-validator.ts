import { isHeightDimensionCandidate } from './drawing-geometry-model.ts'
import type {
  AnalyzedFile,
  BuildingGeometry,
  ConsistencyComparison,
  ConsistencyComparisonResult,
  ConsistencyIssue,
  ConsistencyStatus,
  ConsistencyValidation,
  CuttingMember,
  CuttingMemberConsistencyResult,
  CuttingPlacement,
  CuttingStockPlan,
  DimensionValue,
  MaterialCatalogItem,
  MaterialTakeoff,
  OptimizationState,
  ProjectWorkflow,
  Wall,
  WallConsistencyResult,
  Opening,
} from '../types/domain'

/**
 * All internal comparisons use millimetres. These limits are deliberately
 * small and centralized: they only cover unit normalization and display
 * rounding, never a design change.
 */
export const CONSISTENCY_TOLERANCES = {
  normalizedMm: 0.5,
  displayRoundingMm: 1,
  areaM2: 0.01,
}

function valid(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

function positive(value: number | null | undefined): value is number {
  return valid(value) && value > 0
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function issue(
  id: string,
  category: ConsistencyIssue['category'],
  status: Exclude<ConsistencyStatus, '검증 완료' | '일부 검증 완료' | '테스트 데이터'>,
  message: string,
  action: string,
  sourceReferences: ConsistencyIssue['sourceReferences'] = [],
  extra: Partial<ConsistencyIssue> = {},
): ConsistencyIssue {
  return {
    id,
    category,
    severity: status === '확인 필요' ? 'blocking' : 'blocking',
    status,
    message,
    action,
    sourceReferences,
    ...extra,
  }
}

function warningIssue(
  id: string,
  category: ConsistencyIssue['category'],
  message: string,
  action: string,
  sourceReferences: ConsistencyIssue['sourceReferences'] = [],
  extra: Partial<ConsistencyIssue> = {},
): ConsistencyIssue {
  return {
    id,
    category,
    severity: 'warning',
    status: '확인 필요',
    message,
    action,
    sourceReferences,
    ...extra,
  }
}

function sourceReferencesFor(dimension?: DimensionValue | null, wall?: Wall | null) {
  return dimension?.evidence?.length ? dimension.evidence : wall?.sourceReferences || wall?.evidence || []
}

function sourceLengthDimension(wall: Wall, dimensions: DimensionValue[]) {
  const sourceIds = new Set(wall.sourceDimensionIds)
  return dimensions.find((dimension) => {
    if (!sourceIds.has(dimension.id) || !positive(dimension.valueMm) || isHeightDimensionCandidate(dimension)) return false
    const context = dimension.context
    const openingToken = /(문|door|창|window|\bD\s*[-#]?\d+\b)/i.test(context) || (/\bW\s*[-#]?\d+\b/i.test(context) && !/(?:WALL|벽체)\s+W\s*[-#]?\d+/i.test(context))
    return !openingToken
  }) || null
}

function sourceHeightDimension(wall: Wall, dimensions: DimensionValue[]) {
  const selected = wall.heightSourceDimensionId
    ? dimensions.find((dimension) => dimension.id === wall.heightSourceDimensionId)
    : null
  if (selected) return selected
  const sourceIds = new Set(wall.sourceDimensionIds)
  return dimensions.find((dimension) => sourceIds.has(dimension.id) && isHeightDimensionCandidate(dimension)) || null
}

function originalValueOf(dimension: DimensionValue | null) {
  if (!dimension) return null
  return dimension.originalValueMm ?? dimension.valueMm
}

function approvedValueOf(dimension: DimensionValue | null) {
  if (!dimension || dimension.heightExcluded) return null
  return dimension.userEdited ? (dimension.userValueMm ?? dimension.valueMm) : dimension.valueMm
}

function compare(
  id: string,
  label: string,
  originalValue: number | null,
  currentValue: number | null,
  unit: ConsistencyComparison['unit'],
  formula: string,
  sourceReferences: ConsistencyComparison['sourceReferences'],
  note = '',
  userConfirmed = false,
  tolerance = unit === 'mm' ? CONSISTENCY_TOLERANCES.normalizedMm : CONSISTENCY_TOLERANCES.areaM2,
): ConsistencyComparison {
  let result: ConsistencyComparisonResult = '값 없음'
  let difference: number | null = null
  if (valid(originalValue) && valid(currentValue)) {
    difference = Math.abs(originalValue - currentValue)
    if (difference === 0) result = userConfirmed ? '사용자 확인값' : '일치'
    else if (difference <= tolerance) result = '허용 오차'
    else if (unit === 'mm' && difference <= CONSISTENCY_TOLERANCES.displayRoundingMm) result = '표시 반올림 차이'
    else result = userConfirmed ? '사용자 확인값' : '계산 불일치'
  }
  return { id, label, originalValue, currentValue, difference, unit, result, formula, note, sourceReferences }
}

function comparisonIssue(
  comparison: ConsistencyComparison,
  wall: Wall,
  category: ConsistencyIssue['category'],
  userConfirmed = false,
) {
  if (comparison.result === '일치' || comparison.result === '허용 오차' || comparison.result === '표시 반올림 차이' || (comparison.result === '사용자 확인값' && userConfirmed)) return null
  if (comparison.result === '값 없음') {
    return issue(
      `missing-${comparison.id}`,
      category,
      '계산 불가',
      `${wall.zone} ${wall.wallNumber}: ${comparison.label} 값이 단계 사이에 없습니다.`,
      '원본 도면 근거와 연결 필드를 확인한 뒤 다시 계산하세요.',
      comparison.sourceReferences,
      { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber, originalValue: comparison.originalValue, currentValue: comparison.currentValue, unit: comparison.unit, formula: comparison.formula },
    )
  }
  return issue(
    `mismatch-${comparison.id}`,
    category,
    '확인 필요',
    `${wall.zone} ${wall.wallNumber}: ${comparison.label}이(가) 단계 사이에서 달라졌습니다. 원래 ${comparison.originalValue}${comparison.unit} · 현재 ${comparison.currentValue}${comparison.unit}.`,
    '원본 위치를 확인하고 사용자 확인값으로 승인한 뒤 다시 계산하세요.',
    comparison.sourceReferences,
    { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber, originalValue: comparison.originalValue, currentValue: comparison.currentValue, unit: comparison.unit, formula: comparison.formula },
  )
}

function rectangleForOpening(opening: Opening) {
  if (opening.excludedFromAutomaticTakeoff || opening.widthMm === null || opening.heightMm === null || opening.offsetMm === null) return null
  const bottom = opening.type === 'door' ? 0 : opening.sillHeightMm
  if (bottom === null) return null
  return { x: opening.offsetMm, y: bottom, width: opening.widthMm, height: opening.heightMm }
}

function rectanglesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function unionOpeningArea(openings: Opening[]) {
  const rectangles = openings.map(rectangleForOpening).filter((item): item is NonNullable<ReturnType<typeof rectangleForOpening>> => Boolean(item))
  if (!rectangles.length) return 0
  const xBreaks = unique([0, ...rectangles.flatMap((item) => [item.x, item.x + item.width])]).sort((a, b) => a - b)
  const yBreaks = unique([0, ...rectangles.flatMap((item) => [item.y, item.y + item.height])]).sort((a, b) => a - b)
  let area = 0
  for (let x = 0; x < xBreaks.length - 1; x += 1) {
    for (let y = 0; y < yBreaks.length - 1; y += 1) {
      const xStart = xBreaks[x] as number
      const xEnd = xBreaks[x + 1] as number
      const yStart = yBreaks[y] as number
      const yEnd = yBreaks[y + 1] as number
      const center = { x: (xStart + xEnd) / 2, y: (yStart + yEnd) / 2 }
      if (rectangles.some((item) => center.x > item.x && center.x < item.x + item.width && center.y > item.y && center.y < item.y + item.height)) area += (xEnd - xStart) * (yEnd - yStart)
    }
  }
  return area / 1_000_000
}

function checkOpenings(wall: Wall, takeoff: MaterialTakeoff | null, modelWall: BuildingGeometry['walls'][number] | null) {
  const issues: ConsistencyIssue[] = []
  const seen = new Set<string>()
  const validOpenings: Array<{ opening: Opening; rectangle: NonNullable<ReturnType<typeof rectangleForOpening>> }> = []
  for (const opening of wall.openings) {
    if (seen.has(opening.id)) {
      issues.push(issue(`duplicate-opening-${wall.id}-${opening.id}`, 'duplicate', '확인 필요', `${wall.zone} ${wall.wallNumber}: 개구부 ${opening.label}이 중복 계산될 수 있습니다.`, '중복 개구부 근거를 하나로 정리한 뒤 다시 계산하세요.', opening.evidence, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    }
    seen.add(opening.id)
    const rectangle = rectangleForOpening(opening)
    if (opening.excludedFromAutomaticTakeoff || !rectangle) {
      issues.push(issue(`opening-missing-${wall.id}-${opening.id}`, 'opening', '계산 불가', `${wall.zone} ${wall.wallNumber}: ${opening.label}의 폭·높이·위치 근거가 부족합니다.`, '원본 상세도에서 개구부 정보를 확인하세요.', opening.evidence, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
      continue
    }
    if (!positive(wall.lengthMm) || !positive(wall.heightMm) || rectangle.x < 0 || rectangle.x + rectangle.width > (wall.lengthMm || 0) || rectangle.y < 0 || rectangle.y + rectangle.height > (wall.heightMm || 0)) {
      issues.push(issue(`opening-outside-${wall.id}-${opening.id}`, 'opening', '확인 필요', `${wall.zone} ${wall.wallNumber}: ${opening.label}이 벽체 범위를 벗어났습니다.`, '개구부 위치와 벽체 치수를 원본 도면에서 대조하세요.', opening.evidence, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    }
    for (const prior of validOpenings) {
      if (rectanglesOverlap(prior.rectangle, rectangle)) issues.push(issue(`opening-overlap-${wall.id}-${prior.opening.id}-${opening.id}`, 'opening', '확인 필요', `${wall.zone} ${wall.wallNumber}: ${prior.opening.label}과 ${opening.label}이 겹칩니다.`, '개구부 중복 차감을 방지하도록 원본 위치를 확인하세요.', [...prior.opening.evidence, ...opening.evidence], { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    }
    validOpenings.push({ opening, rectangle })
  }
  const expectedArea = unionOpeningArea(wall.openings)
  if (takeoff && valid(takeoff.openingAreaM2) && Math.abs(expectedArea - takeoff.openingAreaM2) > CONSISTENCY_TOLERANCES.areaM2) {
    issues.push(issue(`opening-area-${wall.id}`, 'opening', '확인 필요', `${wall.zone} ${wall.wallNumber}: 개구부 면적이 원본 geometry와 자재 산출에서 다릅니다.`, '개구부 중복·누락 차감 여부를 확인한 뒤 다시 계산하세요.', wall.sourceReferences, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber, originalValue: expectedArea, currentValue: takeoff.openingAreaM2, unit: '㎡', formula: '개구부 직사각형 합집합 면적' }))
  }
  if (modelWall && modelWall.openings.length !== wall.openings.length) {
    issues.push(issue(`model-openings-${wall.id}`, 'model', '확인 필요', `${wall.zone} ${wall.wallNumber}: 3D 모델의 개구부 수가 벽체 데이터와 다릅니다.`, '3D 개구부 연결 결과를 원본 도면과 대조하세요.', wall.sourceReferences, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
  }
  return issues
}

function statusForWall(issues: ConsistencyIssue[], hasData: boolean): ConsistencyStatus {
  if (!hasData) return '계산 불가'
  if (issues.some((item) => item.status === '분석 실패')) return '분석 실패'
  if (issues.some((item) => item.status === '계산 불가')) return '계산 불가'
  if (issues.length) return '확인 필요'
  return '검증 완료'
}

function modelWallFor(wall: Wall, model: BuildingGeometry) {
  return model.walls.find((candidate) => candidate.wallId === wall.id) || null
}

function takeoffFor(wall: Wall, takeoffs: MaterialTakeoff[]) {
  return takeoffs.find((candidate) => candidate.wallId === wall.id) || null
}

function validateWalls(files: AnalyzedFile[], dimensions: DimensionValue[], walls: Wall[], model: BuildingGeometry, takeoffs: MaterialTakeoff[]) {
  const issues: ConsistencyIssue[] = []
  const results: WallConsistencyResult[] = []
  const modelIds = new Set<string>()
  for (const modelWall of model.walls) {
    if (modelIds.has(modelWall.wallId)) issues.push(issue(`duplicate-model-wall-${modelWall.wallId}`, 'duplicate', '확인 필요', `3D 모델에 벽체 ${modelWall.wallId}가 중복 생성되었습니다.`, '중복 geometry를 제거한 뒤 다시 생성하세요.', modelWall.sourceReferences))
    modelIds.add(modelWall.wallId)
  }
  const drawingFiles = files.filter((file) => file.kind !== 'cost-summary')
  if (!drawingFiles.length) issues.push(issue('no-drawing-source', 'source', '분석 실패', '3D·자재 계산에 사용할 설계도 파일이 없습니다.', 'PDF·JPG·PNG 설계도를 업로드하세요.'))
  for (const file of files.filter((candidate) => candidate.status === 'failed')) issues.push(issue(`file-failed-${file.id}`, 'analysis', '분석 실패', `${file.name}: 파일 분석에 실패했습니다.`, '파일을 다시 분석하거나 원본 형식을 확인하세요.'))
  for (const wall of walls) {
    const sourceLength = sourceLengthDimension(wall, dimensions)
    const sourceHeight = sourceHeightDimension(wall, dimensions)
    const modelWall = modelWallFor(wall, model)
    const takeoff = takeoffFor(wall, takeoffs)
    const wallIssues: ConsistencyIssue[] = []
    const refs = sourceReferencesFor(sourceLength || sourceHeight, wall)
    if (!refs.length) wallIssues.push(issue(`source-${wall.id}`, 'source', '계산 불가', `${wall.zone} ${wall.wallNumber}: 원본 도면 근거가 없습니다.`, '원본 도면 페이지와 치수 위치를 확인하세요.', refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    if (!positive(sourceLength?.valueMm)) wallIssues.push(issue(`source-length-${wall.id}`, 'dimension', '계산 불가', `${wall.zone} ${wall.wallNumber}: 원본 길이를 찾지 못했습니다.`, '평면도의 벽체 길이 치수를 확인하세요.', refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    if (!positive(wall.lengthMm)) wallIssues.push(issue(`wall-length-${wall.id}`, 'dimension', '계산 불가', `${wall.zone} ${wall.wallNumber}: 벽체 길이가 없습니다.`, '원본 평면도 치수를 확인하세요.', refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    if (!positive(sourceHeight?.valueMm) || !positive(wall.heightMm)) wallIssues.push(issue(`height-${wall.id}`, 'height', '계산 불가', `${wall.zone} ${wall.wallNumber}: 높이가 확인되지 않았습니다.`, '입면도·단면도·층고표에서 높이를 확인하고 승인하세요.', sourceHeight?.evidence || refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    if ((wall.conflicts || []).length) wallIssues.push(issue(`conflict-${wall.id}`, 'dimension', '확인 필요', `${wall.zone} ${wall.wallNumber}: 원본 치수 충돌이 있습니다.`, '충돌한 출처를 비교하고 하나를 사용자 확인값으로 승인하세요.', refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    if (wall.confidence !== 'high' && !sourceHeight?.heightReviewAction) wallIssues.push(warningIssue(`confidence-${wall.id}`, 'dimension', `${wall.zone} ${wall.wallNumber}: 벽체 신뢰도가 ${wall.confidence}입니다.`, '원본 위치를 확인한 뒤 승인하세요.', refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    if (modelWall === null && positive(wall.lengthMm) && positive(wall.heightMm)) wallIssues.push(issue(`model-missing-${wall.id}`, 'model', '확인 필요', `${wall.zone} ${wall.wallNumber}: 승인된 벽체가 3D 모델에 없습니다.`, '3D 모델을 다시 생성하세요.', refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    if (modelWall && positive(wall.lengthMm)) {
      const modelLength = modelWall.lengthMm
      const lengthComparison = compare(`wall-model-length-${wall.id}`, '벽체 길이', wall.lengthMm, modelLength, 'mm', '3D 길이 = 벽체 데이터 길이', refs)
      const lengthIssue = comparisonIssue(lengthComparison, wall, 'model')
      if (lengthIssue) wallIssues.push(lengthIssue)
      if (modelWall.heightMm !== wall.heightMm) {
        const heightComparison = compare(`wall-model-height-${wall.id}`, '벽체 높이', wall.heightMm, modelWall.heightMm, 'mm', '3D 높이 = 벽체 데이터 높이', refs)
        const heightIssue = comparisonIssue(heightComparison, wall, 'model')
        if (heightIssue) wallIssues.push(heightIssue)
      }
    }
    if (takeoff === null) wallIssues.push(issue(`takeoff-missing-${wall.id}`, 'takeoff', '계산 불가', `${wall.zone} ${wall.wallNumber}: 자재 산출 행이 없습니다.`, '벽체별 자재 수량을 다시 계산하세요.', refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    if (takeoff && positive(wall.lengthMm)) {
      const takeoffLength = compare(`wall-takeoff-length-${wall.id}`, '자재 계산 길이', wall.lengthMm, takeoff.lengthMm, 'mm', '자재 계산 길이 = 벽체 데이터 길이', refs)
      const lengthIssue = comparisonIssue(takeoffLength, wall, 'takeoff')
      if (lengthIssue) wallIssues.push(lengthIssue)
    }
    if (takeoff && positive(wall.heightMm)) {
      const takeoffHeight = compare(`wall-takeoff-height-${wall.id}`, '자재 계산 높이', wall.heightMm, takeoff.heightMm, 'mm', '자재 계산 높이 = 벽체 데이터 높이', refs)
      const heightIssue = comparisonIssue(takeoffHeight, wall, 'takeoff')
      if (heightIssue) wallIssues.push(heightIssue)
    }
    wallIssues.push(...checkOpenings(wall, takeoff, modelWall))
    if (takeoff && takeoff.reviewStatus !== '확정') wallIssues.push(issue(`takeoff-review-${wall.id}`, 'takeoff', takeoff.reviewStatus === '높이 정보 없음' ? '계산 불가' : '확인 필요', `${wall.zone} ${wall.wallNumber}: 자재 계산 상태가 ${takeoff.reviewStatus}입니다.`, '검토 항목을 해결한 뒤 자재를 다시 계산하세요.', takeoff.sourceReferences || refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    if (takeoff && !takeoff.formula) wallIssues.push(issue(`takeoff-formula-${wall.id}`, 'takeoff', '확인 필요', `${wall.zone} ${wall.wallNumber}: 계산식 근거가 없습니다.`, '계산 근거를 보존하도록 다시 계산하세요.', takeoff.sourceReferences || refs, { wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber }))
    const approvedHeight = approvedValueOf(sourceHeight)
    const sourceHeightValue = originalValueOf(sourceHeight)
    const heightUserConfirmed = Boolean(sourceHeight?.heightReviewAction && ['approved', 'edited', 'linked'].includes(sourceHeight.heightReviewAction))
    const comparisons = [
      compare(`source-wall-length-${wall.id}`, '원본 길이 → 벽체 길이', sourceLength?.valueMm ?? null, wall.lengthMm, 'mm', '벽체 길이 = 원본 치수의 mm 정규화값', refs, sourceLength && sourceLength.unit !== 'mm' ? `원본 단위 ${sourceLength.unit}를 mm로 변환했습니다.` : ''),
      compare(`wall-model-length-chain-${wall.id}`, '벽체 길이 → 3D 길이', wall.lengthMm, modelWall?.lengthMm ?? null, 'mm', '3D 길이 = 벽체 길이', refs),
      compare(`model-takeoff-length-${wall.id}`, '3D 길이 → 자재 계산 길이', modelWall?.lengthMm ?? null, takeoff?.lengthMm ?? null, 'mm', '자재 계산 길이 = 3D 입력 길이', refs),
      compare(`source-wall-height-${wall.id}`, '원본 높이 → 승인 높이', sourceHeightValue, approvedHeight, 'mm', '승인 높이 = 원본 높이 또는 사용자 확인값', refs, sourceHeight?.userEdited ? '사용자가 원본 높이를 수정했습니다.' : '', heightUserConfirmed),
      compare(`approved-wall-height-${wall.id}`, '승인 높이 → 벽체 높이', approvedHeight, wall.heightMm, 'mm', '벽체 높이 = 승인 높이', refs, '', heightUserConfirmed),
      compare(`wall-model-height-chain-${wall.id}`, '벽체 높이 → 3D 높이', wall.heightMm, modelWall?.heightMm ?? null, 'mm', '3D 높이 = 벽체 높이', refs),
      compare(`model-takeoff-height-${wall.id}`, '3D 높이 → 자재 계산 높이', modelWall?.heightMm ?? null, takeoff?.heightMm ?? null, 'mm', '자재 계산 높이 = 3D 입력 높이', refs),
    ]
    const comparisonsWithIssues = comparisons.flatMap((comparison) => {
      const confirmed = comparison.label.includes('원본 높이') && heightUserConfirmed
      const found = comparisonIssue(comparison, wall, comparison.label.includes('높이') ? 'height' : 'dimension', confirmed)
      return found ? [found] : []
    })
    wallIssues.push(...comparisonsWithIssues)
    const status = statusForWall(wallIssues, Boolean(sourceLength && wall.lengthMm !== null))
    issues.push(...wallIssues)
    results.push({
      wallId: wall.id,
      zone: wall.zone,
      wallNumber: wall.wallNumber,
      status,
      sourceLengthMm: sourceLength?.valueMm ?? null,
      wallLengthMm: wall.lengthMm,
      modelLengthMm: modelWall?.lengthMm ?? null,
      takeoffLengthMm: takeoff?.lengthMm ?? null,
      sourceHeightMm: sourceHeightValue,
      approvedHeightMm: approvedHeight,
      modelHeightMm: modelWall?.heightMm ?? null,
      takeoffHeightMm: takeoff?.heightMm ?? null,
      comparisons,
      issues: wallIssues,
    })
  }
  const duplicateWallIds = walls.map((wall) => wall.id).filter((id, index, values) => values.indexOf(id) !== index)
  for (const wallId of unique(duplicateWallIds)) issues.push(issue(`duplicate-wall-${wallId}`, 'duplicate', '확인 필요', `벽체 ${wallId}가 중복 계산될 수 있습니다.`, '동일 벽체의 원본 치수 연결을 하나로 정리하세요.'))
  return { results, issues }
}

function compareZoneTotals(walls: Wall[], takeoffs: MaterialTakeoff[]) {
  const groups = new Map<string, MaterialTakeoff[]>()
  for (const row of takeoffs) groups.set(row.zone, [...(groups.get(row.zone) || []), row])
  const results: import('../types/domain').ZoneConsistencyResult[] = []
  const issues: ConsistencyIssue[] = []
  for (const [zone, rows] of groups) {
    const wallIds = rows.map((row) => row.wallId)
    const netAreaM2 = rows.reduce((sum, row) => sum + (row.netAreaM2 || 0), 0)
    const panelsWithWaste = rows.reduce((sum, row) => sum + (row.panelsWithWaste || 0), 0)
    const zoneIssues = rows.filter((row) => row.reviewStatus !== '확정').map((row) => issue(`zone-row-${row.wallId}`, 'takeoff', '확인 필요', `${zone}: ${row.wallNumber} 산출 행이 확정 상태가 아닙니다.`, '해당 벽체 검토 후 다시 계산하세요.', row.sourceReferences || [], { wallId: row.wallId, zone, wallNumber: row.wallNumber }))
    issues.push(...zoneIssues)
    results.push({ zone, status: zoneIssues.length ? '확인 필요' : '검증 완료', wallIds, netAreaM2, panelsWithWaste, issues: zoneIssues })
  }
  const expectedWallIds = walls.filter((wall) => positive(wall.lengthMm) && positive(wall.heightMm)).map((wall) => wall.id)
  const actualWallIds = takeoffs.map((row) => row.wallId)
  for (const wallId of expectedWallIds.filter((id) => !actualWallIds.includes(id))) issues.push(issue(`zone-missing-${wallId}`, 'takeoff', '계산 불가', `구역 소계에서 벽체 ${wallId}가 누락되었습니다.`, '자재 산출을 다시 실행하세요.'))
  return { results, issues }
}

function rectangleOverlap(a: CuttingPlacement, b: CuttingPlacement) {
  if (a.widthMm === null || b.widthMm === null) return a.xMm < b.xMm + b.lengthMm && a.xMm + a.lengthMm > b.xMm
  return a.xMm < b.xMm + b.lengthMm && a.xMm + a.lengthMm > b.xMm && a.yMm < b.yMm + b.widthMm && a.yMm + a.widthMm > b.yMm
}

function validateCutting(optimization: OptimizationState, walls: Wall[], actualData: boolean, testData: boolean): { result: ConsistencyValidation['cutting']; issues: ConsistencyIssue[] } {
  const issues: ConsistencyIssue[] = []
  if (testData) issues.push(issue('cutting-test-data', 'test-data', '확인 필요', '절단 계획이 테스트 데이터에 기반합니다.', '실제 도면 분석 결과와 실제 자재 카탈로그로 다시 계산하세요.'))
  if (!actualData) issues.push(issue('cutting-no-actual-data', 'analysis', '분석 실패', '실제 설계도 분석 결과가 없어 절단 계획을 검증할 수 없습니다.', '실제 설계도 파일을 업로드하세요.'))
  const scenario = optimization.scenarios.find((candidate) => candidate.id === optimization.selectedScenarioId) || optimization.scenarios[0]
  if (!scenario) {
    const missing = issue('cutting-no-scenario', 'cutting', '계산 불가', '선택된 절단 계획이 없습니다.', '자재 규격과 부재 목록을 확인한 뒤 절단 계획을 계산하세요.')
    issues.push(missing)
    return { result: { status: '계산 불가', selectedScenarioId: null, memberResults: [], issues: [missing], assignedMemberCount: 0, requiredMemberCount: optimization.members.reduce((sum, member) => sum + member.quantity, 0), unplacedMemberIds: optimization.members.map((member) => member.id) }, issues }
  }
  if (optimization.status !== 'calculated' || !scenario.available) issues.push(issue('cutting-status', 'cutting', '확인 필요', '절단 계획이 발주 확정 상태가 아닙니다.', '배치 실패·가격·규격 검토 항목을 해결하고 다시 계산하세요.'))
  const usedMaterialIds = unique(optimization.members.map((member) => member.materialId).filter((id): id is string => Boolean(id)))
  for (const materialId of usedMaterialIds) {
    const material = optimization.catalog.find((candidate) => candidate.id === materialId)
    if (!material) {
      issues.push(issue(`catalog-missing-${materialId}`, 'catalog', '계산 불가', `자재 ${materialId}의 카탈로그 기준이 없습니다.`, '자재 종류·규격·가격을 입력한 뒤 다시 계산하세요.'))
      continue
    }
    const sourceReferences: ConsistencyIssue['sourceReferences'] = []
    if (material.source === 'sample') issues.push(issue(`catalog-sample-${material.id}`, 'test-data', '확인 필요', `${material.name || material.id}: 샘플 자재 기준은 발주 확정에 사용할 수 없습니다.`, '실제 업체 자재 규격과 가격으로 교체하세요.', sourceReferences))
    const missingSpec = material.materialType === 'panel'
      ? [material.stockWidthMm, material.stockLengthMm].some((value) => !positive(value))
      : !positive(material.stockLengthMm) && !material.stockLengthOptionsMm.some((value) => positive(value))
    if (missingSpec) issues.push(issue(`catalog-spec-${material.id}`, 'catalog', '계산 불가', `${material.name || material.id}: 원자재 규격이 없습니다.`, '판재 폭·길이 또는 프로파일 원자재 길이를 입력하세요.', sourceReferences))
    if (!positive(material.kerfMm) && material.kerfMm !== 0) issues.push(issue(`catalog-kerf-${material.id}`, 'catalog', '계산 불가', `${material.name || material.id}: 톱날 절단폭이 없습니다.`, '실제 절단폭을 입력하세요.', sourceReferences))
    if (!valid(material.unitPrice)) issues.push(issue(`catalog-price-${material.id}`, 'catalog', '확인 필요', `${material.name || material.id}: 가격 입력이 없어 총비용을 확정할 수 없습니다.`, '실제 단가를 입력한 뒤 비용과 발주량을 다시 계산하세요.', sourceReferences))
    if (!positive(material.minimumOrderQuantity)) issues.push(issue(`catalog-minimum-order-${material.id}`, 'catalog', '확인 필요', `${material.name || material.id}: 최소 주문 수량이 없습니다.`, '업체의 최소 주문 수량을 입력하세요.', sourceReferences))
  }
  for (const message of [
    ...optimization.validation.memberAssignmentErrors,
    ...optimization.validation.oversizedMemberErrors,
    ...optimization.validation.overlapErrors,
    ...optimization.validation.kerfErrors,
    ...optimization.validation.unitErrors,
    ...optimization.validation.duplicateCalculationErrors,
    ...optimization.validation.openingDoubleCountErrors,
    ...optimization.validation.unsupportedShapeErrors,
  ]) issues.push(issue(`optimization-validation-${issues.length}`, message.includes('원자재') || message.includes('절단') ? 'cutting' : 'duplicate', '확인 필요', message, '절단 배치와 부재 목록을 확인한 뒤 다시 계산하세요.'))
  const memberMap = new Map(optimization.members.map((member) => [member.id, member]))
  const counts = new Map<string, number>()
  const memberIssues = new Map<string, ConsistencyIssue[]>()
  const planScraps = new Map<string, { areaM2: number; lengthMm: number }>()
  for (const plan of scenario.stockPlans) {
    const scrapTotals = scenario.scraps.filter((scrap) => plan.scrapIds.includes(scrap.id)).reduce((sum, scrap) => ({ areaM2: sum.areaM2 + (scrap.widthMm === null ? 0 : scrap.lengthMm * scrap.widthMm / 1_000_000), lengthMm: sum.lengthMm + scrap.lengthMm }), { areaM2: 0, lengthMm: 0 })
    planScraps.set(plan.id, scrapTotals)
    if (plan.materialType === 'panel' && (plan.stockWidthMm === null || plan.stockWidthMm <= 0)) issues.push(issue(`plan-width-${plan.id}`, 'cutting', '계산 불가', `${plan.id}: 판재 원자재 폭이 없습니다.`, '자재 카탈로그의 원자재 폭을 입력하세요.'))
    for (const placement of plan.placements) {
      counts.set(placement.memberId, (counts.get(placement.memberId) || 0) + 1)
      const member = memberMap.get(placement.memberId)
      if (!member) {
        issues.push(issue(`unknown-placement-${placement.id}`, 'duplicate', '확인 필요', `${placement.label}: 부재 목록에 없는 부재가 배치되었습니다.`, '절단 부재와 배치를 다시 연결하세요.'))
        continue
      }
      const memberIssue = (item: ConsistencyIssue) => {
        const list = memberIssues.get(member.id) || []
        list.push(item)
        memberIssues.set(member.id, list)
        issues.push(item)
      }
      if (placement.lengthMm <= 0 || (placement.widthMm !== null && placement.widthMm <= 0)) memberIssue(issue(`placement-unit-${placement.id}`, 'cutting', '계산 불가', `${placement.label}: 절단 치수가 올바르지 않습니다.`, '부재 치수 단위를 확인하세요.'))
      if (plan.materialType === 'panel') {
        if (plan.stockWidthMm === null || placement.xMm + placement.lengthMm > plan.stockLengthMm + CONSISTENCY_TOLERANCES.normalizedMm || placement.yMm + (placement.widthMm || 0) > (plan.stockWidthMm || 0) + CONSISTENCY_TOLERANCES.normalizedMm) memberIssue(issue(`placement-bound-${placement.id}`, 'cutting', '확인 필요', `${placement.label}: 원자재 밖으로 배치되었습니다.`, '원자재 크기와 회전 여부를 확인하세요.'))
      } else if (placement.xMm + placement.lengthMm > plan.stockLengthMm + CONSISTENCY_TOLERANCES.normalizedMm) memberIssue(issue(`profile-bound-${placement.id}`, 'cutting', '확인 필요', `${placement.label}: 프로파일 원자재 길이를 초과했습니다.`, '원자재 길이와 절단폭을 확인하세요.'))
      if (placement.kerfMm < 0) memberIssue(issue(`placement-kerf-${placement.id}`, 'cutting', '계산 불가', `${placement.label}: 톱날 절단폭이 음수입니다.`, '자재 카탈로그의 절단폭을 확인하세요.'))
      if (member.shape !== 'rectangle') memberIssue(issue(`placement-shape-${placement.id}`, 'cutting', '계산 불가', `${member.id}: 지원되지 않는 형상입니다.`, '불규칙 형상을 사각형으로 바꾸지 말고 확인 필요로 유지하세요.'))
    }
    for (let first = 0; first < plan.placements.length; first += 1) {
      for (let second = first + 1; second < plan.placements.length; second += 1) {
        const a = plan.placements[first]
        const b = plan.placements[second]
        if (a && b && rectangleOverlap(a, b)) issues.push(issue(`overlap-${plan.id}-${a.id}-${b.id}`, 'cutting', '확인 필요', `${plan.id}: ${a.label}과 ${b.label}이 겹칩니다.`, '절단 배치를 수정한 뒤 다시 검증하세요.'))
      }
    }
    const calculatedWaste = plan.materialType === 'panel' ? scrapTotals.areaM2 : scrapTotals.lengthMm
    const reportedWaste = plan.materialType === 'panel' ? plan.wasteAreaM2 : plan.wasteLengthMm
    if (valid(reportedWaste) && Math.abs((reportedWaste || 0) - calculatedWaste) > (plan.materialType === 'panel' ? CONSISTENCY_TOLERANCES.areaM2 : CONSISTENCY_TOLERANCES.normalizedMm)) issues.push(issue(`waste-${plan.id}`, 'cutting', '확인 필요', `${plan.id}: 남는 자투리 계산이 배치와 다릅니다.`, '자투리 면적·길이를 다시 계산하세요.'))
  }
  const memberResults: CuttingMemberConsistencyResult[] = optimization.members.map((member) => {
    const assigned = counts.get(member.id) || 0
    const currentIssues = memberIssues.get(member.id) || []
    if (assigned !== member.quantity) {
      const missing = issue(`member-count-${member.id}`, 'duplicate', '확인 필요', `${member.id}: 필요 ${member.quantity}개인데 ${assigned}개가 배치되었습니다.`, '누락·중복 부재를 확인한 뒤 다시 계산하세요.')
      currentIssues.push(missing)
      issues.push(missing)
    }
    return { memberId: member.id, status: currentIssues.length ? '확인 필요' : '검증 완료', issues: currentIssues }
  })
  const requiredMemberCount = optimization.members.reduce((sum, member) => sum + member.quantity, 0)
  const assignedMemberCount = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const unplacedMemberIds = optimization.members.filter((member) => (counts.get(member.id) || 0) < member.quantity).map((member) => member.id)
  const status: ConsistencyStatus = issues.some((item) => item.status === '계산 불가') ? '계산 불가' : issues.length ? '확인 필요' : '검증 완료'
  return { result: { status, selectedScenarioId: scenario.id, memberResults, issues, assignedMemberCount, requiredMemberCount, unplacedMemberIds }, issues }
}

function stage(id: ConsistencyValidation['stages'][number]['id'], label: string, status: ConsistencyStatus, message: string, issues: ConsistencyIssue[]): ConsistencyValidation['stages'][number] {
  return { id, label, status, message, issueCount: issues.length }
}

export function emptyConsistencyValidation(): ConsistencyValidation {
  return {
    status: '분석 실패',
    canFinalize: false,
    actualData: false,
    testData: false,
    checkedAt: new Date(0).toISOString(),
    tolerances: { ...CONSISTENCY_TOLERANCES },
    stages: [
      stage('drawing', '원본 도면', '분석 실패', '검증 전입니다.', []),
      stage('walls', '벽체·구역', '계산 불가', '검증 전입니다.', []),
      stage('model', '3D 모델', '계산 불가', '검증 전입니다.', []),
      stage('takeoff', '자재 수량', '계산 불가', '검증 전입니다.', []),
      stage('cutting', '절단 계획', '계산 불가', '검증 전입니다.', []),
    ],
    issues: [],
    wallResults: [],
    takeoffResults: [],
    zoneResults: [],
    cutting: { status: '계산 불가', selectedScenarioId: null, memberResults: [], issues: [], assignedMemberCount: 0, requiredMemberCount: 0, unplacedMemberIds: [] },
    blockingReasons: [],
    totals: { approvedWallCount: 0, modelWallCount: 0, takeoffWallCount: 0, netAreaM2: 0, panelsWithWaste: 0, fasteners: 0, sealantCartridges: 0, cornerPieces: 0, finishPieces: 0 },
  }
}

export function validateConsistency(input: {
  files: AnalyzedFile[]
  dimensions: DimensionValue[]
  walls: Wall[]
  model: BuildingGeometry
  takeoffs: MaterialTakeoff[]
  optimization: OptimizationState
  workflow: ProjectWorkflow
  actualData?: boolean
  testData?: boolean
  checkedAt?: string
}): ConsistencyValidation {
  const actualData = input.actualData ?? input.files.some((file) => file.pages.length > 0 && file.kind !== 'cost-summary')
  const testData = Boolean(input.testData)
  const wallValidation = validateWalls(input.files, input.dimensions, input.walls, input.model, input.takeoffs)
  const zoneValidation = compareZoneTotals(input.walls, input.takeoffs)
  const cuttingValidation = validateCutting(input.optimization, input.walls, actualData, testData)
  const issues = [...wallValidation.issues, ...zoneValidation.issues, ...cuttingValidation.issues]
  if (testData) issues.push(issue('test-data-project', 'test-data', '확인 필요', '현재 화면의 결과는 테스트 데이터입니다.', '실제 설계도를 업로드한 뒤 다시 계산하세요.'))
  const hasSources = actualData && input.files.some((file) => file.pages.some((page) => page.dimensions.length || page.text.trim()))
  const drawingIssues = issues.filter((item) => ['source', 'analysis', 'dimension', 'height'].includes(item.category))
  const modelIssues = issues.filter((item) => item.category === 'model')
  const takeoffIssues = issues.filter((item) => ['takeoff', 'opening', 'duplicate'].includes(item.category))
  const drawingStatus: ConsistencyStatus = testData ? '테스트 데이터' : !hasSources ? '분석 실패' : drawingIssues.length ? (drawingIssues.some((item) => item.status === '계산 불가' || item.status === '분석 실패') ? '계산 불가' : '확인 필요') : '검증 완료'
  const modelStatus: ConsistencyStatus = testData ? '테스트 데이터' : modelIssues.length ? (modelIssues.some((item) => item.status === '계산 불가') ? '계산 불가' : '확인 필요') : input.model.isReady ? (input.model.partial ? '일부 검증 완료' : '검증 완료') : '계산 불가'
  const takeoffStatus: ConsistencyStatus = testData ? '테스트 데이터' : !input.workflow.takeoffCalculated || !input.takeoffs.length ? '계산 불가' : takeoffIssues.length ? (takeoffIssues.some((item) => item.status === '계산 불가') ? '계산 불가' : '확인 필요') : '검증 완료'
  const cuttingStatus = testData ? '테스트 데이터' : cuttingValidation.result.status
  const stages = [
    stage('drawing', '원본 도면', drawingStatus, drawingStatus === '검증 완료' ? '원본 치수·높이 근거가 연결되었습니다.' : '원본 근거와 추출값을 확인해야 합니다.', drawingIssues),
    stage('walls', '벽체·구역', wallValidation.results.every((result) => result.status === '검증 완료') && wallValidation.results.length ? '검증 완료' : wallValidation.results.some((result) => result.status === '계산 불가') ? '계산 불가' : '확인 필요', `${wallValidation.results.filter((result) => result.status === '검증 완료').length}/${input.walls.length}개 벽체 검증 완료`, wallValidation.issues),
    stage('model', '3D 모델', modelStatus, modelStatus === '검증 완료' ? '벽체 길이·높이와 3D geometry가 일치합니다.' : '3D geometry와 벽체 데이터를 확인해야 합니다.', modelIssues),
    stage('takeoff', '자재 수량', takeoffStatus, takeoffStatus === '검증 완료' ? '벽체별 자재 계산이 원본 geometry와 일치합니다.' : '벽체별 자재 계산과 개구부 차감을 확인해야 합니다.', takeoffIssues),
    stage('cutting', '절단 계획', cuttingStatus, cuttingStatus === '검증 완료' ? '모든 부재가 절단 배치에 정확히 배정되었습니다.' : '절단 배치와 원자재 규격을 확인해야 합니다.', cuttingValidation.issues),
  ]
  const blockingReasons = unique(issues.filter((item) => item.severity === 'blocking').map((item) => item.message))
  const completed = !testData && actualData && stages.every((item) => item.status === '검증 완료') && input.walls.length > 0 && input.model.isReady && !input.model.partial && input.workflow.takeoffCalculated && input.workflow.optimizationCalculated && input.optimization.status === 'calculated' && input.optimization.scenarios.some((scenario) => scenario.id === input.optimization.selectedScenarioId && scenario.available)
  const status: ConsistencyStatus = testData ? '테스트 데이터' : completed ? '검증 완료' : issues.some((item) => item.status === '분석 실패') ? '분석 실패' : issues.some((item) => item.status === '계산 불가') ? '계산 불가' : issues.length ? '확인 필요' : '일부 검증 완료'
  const approvedWallCount = input.walls.filter((wall) => positive(wall.lengthMm) && positive(wall.heightMm) && wall.confidence === 'high' && !(wall.conflicts || []).length).length
  return {
    status,
    canFinalize: completed && blockingReasons.length === 0,
    actualData,
    testData,
    checkedAt: input.checkedAt || new Date().toISOString(),
    tolerances: { ...CONSISTENCY_TOLERANCES },
    stages,
    issues,
    wallResults: wallValidation.results,
    takeoffResults: input.takeoffs.map((takeoff) => {
      const wall = input.walls.find((candidate) => candidate.id === takeoff.wallId)
      const rowIssues = issues.filter((item) => item.wallId === takeoff.wallId)
      return {
        wallId: takeoff.wallId,
        zone: takeoff.zone,
        wallNumber: takeoff.wallNumber,
        status: rowIssues.length ? (rowIssues.some((item) => item.status === '계산 불가') ? '계산 불가' : '확인 필요') : takeoff.reviewStatus === '확정' ? '검증 완료' : '확인 필요',
        netAreaM2: takeoff.netAreaM2,
        openingAreaM2: takeoff.openingAreaM2,
        panelsWithWaste: takeoff.panelsWithWaste,
        comparisons: wall ? [compare(`takeoff-net-area-${takeoff.wallId}`, '순 벽체 면적', takeoff.netAreaM2, takeoff.netAreaM2, '㎡', '순면적 = 길이 × 높이 − 개구부 면적', takeoff.sourceReferences || [])] : [],
        issues: rowIssues,
      }
    }),
    zoneResults: zoneValidation.results,
    cutting: cuttingValidation.result,
    blockingReasons,
    totals: {
      approvedWallCount,
      modelWallCount: input.model.walls.length,
      takeoffWallCount: unique(input.takeoffs.map((takeoff) => takeoff.wallId)).length,
      netAreaM2: input.takeoffs.reduce((sum, row) => sum + (row.netAreaM2 || 0), 0),
      panelsWithWaste: input.takeoffs.reduce((sum, row) => sum + (row.panelsWithWaste || 0), 0),
      fasteners: input.takeoffs.reduce((sum, row) => sum + (row.fasteners || 0), 0),
      sealantCartridges: input.takeoffs.reduce((sum, row) => sum + (row.sealantCartridges || 0), 0),
      cornerPieces: input.takeoffs.reduce((sum, row) => sum + (row.cornerPieces || 0), 0),
      finishPieces: input.takeoffs.reduce((sum, row) => sum + (row.finishPieces || 0), 0),
    },
  }
}
