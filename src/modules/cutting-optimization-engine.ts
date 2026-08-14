import type {
  CuttingMember,
  CuttingPlacement,
  CuttingStockPlan,
  Evidence,
  MaterialCatalogItem,
  MaterialSettings,
  OptimizationCostBreakdown,
  OptimizationReviewItem,
  OptimizationScenario,
  OptimizationValidation,
  ScrapPiece,
  Wall,
} from '../types/domain'

const DRAWING_KIND_LABELS: Record<string, string> = {
  'floor-plan': '평면도',
  elevation: '입면도',
  section: '단면도',
  detail: '상세도',
  structural: '구조도',
  'material-schedule': '자재표',
  'cost-summary': '공사비 집계표',
  unknown: '알 수 없는 파일',
}

function emptyOptimizationValidation(): OptimizationValidation {
  return {
    passed: false,
    memberAssignmentErrors: [],
    oversizedMemberErrors: [],
    overlapErrors: [],
    kerfErrors: [],
    unitErrors: [],
    duplicateCalculationErrors: [],
    openingDoubleCountErrors: [],
    unsupportedShapeErrors: [],
  }
}

type Objective = 'cost' | 'waste' | 'simple'

interface FreeRectangle {
  xMm: number
  yMm: number
  lengthMm: number
  widthMm: number
}

interface PackedResult {
  stockPlans: CuttingStockPlan[]
  scraps: ScrapPiece[]
  unplacedMemberIds: string[]
  cutCount: number
}

export interface OptimizationBuildResult {
  members: CuttingMember[]
  reviews: OptimizationReviewItem[]
}

export interface OptimizationPlanResult {
  members: CuttingMember[]
  reviews: OptimizationReviewItem[]
  scenarios: OptimizationScenario[]
  selectedScenarioId: 'cost' | 'waste' | 'simple'
  recommendedScenarioId: 'cost' | 'waste' | 'simple'
  scraps: ScrapPiece[]
  status: 'needs-review' | 'calculated' | 'blocked'
  validation: OptimizationValidation
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function evidenceLabel(wall: Wall) {
  const evidence = wall.evidence[0]
  if (!evidence) return '도면 근거 미확인'
  return `${evidence.fileName} · ${DRAWING_KIND_LABELS[evidence.drawingKind]} · ${evidence.pageNumber}페이지`
}

function makeReview(
  id: string,
  category: OptimizationReviewItem['category'],
  problem: string,
  sourceLabel: string,
  currentValue: string,
  reason: string,
  severity: OptimizationReviewItem['severity'] = 'blocked',
  targetId?: string,
  sourceReferences: Evidence[] = [],
  confidence?: OptimizationReviewItem['confidence'],
  targetField?: keyof MaterialCatalogItem,
): OptimizationReviewItem {
  const source = sourceReferences[0]
  const sourceWithLocation = source?.location
    ? `${sourceLabel} · 위치 ${(source.location.x * 100).toFixed(0)}%, ${(source.location.y * 100).toFixed(0)}%`
    : sourceLabel
  return {
    id,
    category,
    problem,
    sourceLabel: sourceWithLocation,
    currentValue,
    editableValue: '',
    reason,
    severity,
    targetId,
    targetField,
    resolved: false,
    sourceReferences,
    confidence,
  }
}

function makeMember(
  wall: Wall,
  id: string,
  xStartMm: number,
  xEndMm: number,
  yStartMm: number,
  yEndMm: number,
  settings: MaterialSettings,
  materialId: string,
  openingIds: string[],
  installOrder: number,
): CuttingMember {
  const alongWallMm = xEndMm - xStartMm
  const verticalMm = yEndMm - yStartMm
  const horizontal = settings.panelDirection === 'horizontal'
  return {
    id,
    sourceWallId: wall.id,
    zone: wall.zone,
    location: `${wall.zone} · ${wall.number}`,
    wallNumber: wall.number,
    requiredLengthMm: horizontal ? alongWallMm : verticalMm,
    requiredWidthMm: horizontal ? verticalMm : alongWallMm,
    requiredHeightMm: verticalMm,
    quantity: 1,
    materialType: 'panel',
    materialId: materialId || null,
    materialSpec: materialId ? '선택한 자재 카탈로그 규격' : '자재 종류 확인 필요',
    shape: 'rectangle',
    cuttingRequired: true,
    openingIds,
    installOrder,
    plannedInstallAt: null,
    sourceReferences: wall.evidence,
    confidence: wall.confidence,
    reviewStatus: wall.confidence === 'high' ? 'ready' : 'needs-review',
    notes: [],
  }
}

function breaksFor(maxMm: number, stepMm: number, extra: number[]) {
  const values = [0, maxMm, ...extra.filter((value) => value > 0 && value < maxMm)]
  if (stepMm > 0) {
    for (let value = stepMm; value < maxMm; value += stepMm) values.push(value)
  }
  return [...new Set(values.map((value) => round(value, 3)))].sort((a, b) => a - b)
}

function openingIsValid(wall: Wall, opening: Wall['openings'][number]) {
  if (opening.widthMm === null || opening.heightMm === null || opening.offsetMm === null) return false
  if (opening.widthMm <= 0 || opening.heightMm <= 0 || opening.offsetMm < 0) return false
  if (opening.offsetMm + opening.widthMm > (wall.lengthMm || 0)) return false
  const sill = opening.type === 'door' ? 0 : opening.sillHeightMm
  return sill !== null && sill >= 0 && sill + opening.heightMm <= (wall.heightMm || 0)
}

function cellIsOpening(xStartMm: number, xEndMm: number, yStartMm: number, yEndMm: number, openings: Wall['openings']) {
  const centerX = (xStartMm + xEndMm) / 2
  const centerY = (yStartMm + yEndMm) / 2
  return openings.some((opening) => {
    if (opening.widthMm === null || opening.heightMm === null || opening.offsetMm === null) return false
    const sill = opening.type === 'door' ? 0 : opening.sillHeightMm || 0
    return centerX > opening.offsetMm && centerX < opening.offsetMm + opening.widthMm && centerY > sill && centerY < sill + opening.heightMm
  })
}

export function createCatalogItem(input: Partial<MaterialCatalogItem> = {}): MaterialCatalogItem {
  const now = new Date().toISOString()
  return {
    id: input.id || `material-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name || '',
    materialType: input.materialType || 'panel',
    material: input.material || '',
    thicknessMm: input.thicknessMm ?? null,
    stockWidthMm: input.stockWidthMm ?? null,
    stockLengthMm: input.stockLengthMm ?? null,
    stockLengthOptionsMm: input.stockLengthOptionsMm || [],
    unit: input.unit || (input.materialType === 'profile' ? 'bar' : 'sheet'),
    unitLabel: input.unitLabel || (input.materialType === 'profile' ? '본' : '장'),
    unitPrice: input.unitPrice ?? null,
    minimumOrderQuantity: input.minimumOrderQuantity ?? null,
    cuttingFee: input.cuttingFee ?? null,
    cutCostPerCut: input.cutCostPerCut ?? null,
    kerfMm: input.kerfMm ?? null,
    transportCost: input.transportCost ?? null,
    handlingCost: input.handlingCost ?? null,
    disposalCostPerM2: input.disposalCostPerM2 ?? null,
    disposalCostPerM: input.disposalCostPerM ?? null,
    temporaryStorageCostPerDay: input.temporaryStorageCostPerDay ?? null,
    rotatable: input.rotatable ?? false,
    grainDirection: input.grainDirection || 'fixed',
    lapAllowanceMm: input.lapAllowanceMm ?? null,
    minimumReusableOffcutMm: input.minimumReusableOffcutMm ?? null,
    reworkRiskCost: input.reworkRiskCost ?? null,
    surfaceFinish: input.surfaceFinish || '',
    color: input.color || '',
    source: input.source || 'user',
    updatedAt: input.updatedAt || now,
  }
}

export function buildOptimizationMembers(
  walls: Wall[],
  settings: MaterialSettings,
  panelMaterialId: string,
  panelMaterial?: MaterialCatalogItem | null,
): OptimizationBuildResult {
  const members: CuttingMember[] = []
  const reviews: OptimizationReviewItem[] = []
  for (const [wallIndex, wall] of walls.entries()) {
    const source = evidenceLabel(wall)
    if (wall.lengthMm === null || wall.heightMm === null) {
      reviews.push(makeReview(
        `height-${wall.id}`,
        'height',
        '벽체 높이를 확인할 수 없어 절단 부재를 만들지 않았습니다.',
        source,
        '높이 정보 없음',
        '입면도·단면도 또는 같은 구역의 높이 근거를 확인해야 합니다.',
        'blocked',
        wall.id,
        wall.sourceReferences,
        wall.confidence,
      ))
      continue
    }
    const invalidOpenings = wall.openings.filter((opening) => !openingIsValid(wall, opening))
    if (invalidOpenings.length) {
      reviews.push(makeReview(
        `opening-${wall.id}`,
        'dimension',
        '문·창호의 폭·높이·위치가 모두 확인되지 않아 벽체 절단을 확정하지 않았습니다.',
        source,
        `${invalidOpenings.length}개 개구부 확인 필요`,
        '개구부를 임의의 사각형이나 위치로 바꾸지 않고 원본 근거를 먼저 확인해야 합니다.',
        'blocked',
        wall.id,
        wall.sourceReferences,
        wall.confidence,
      ))
      continue
    }
    if (wall.confidence !== 'high') {
      reviews.push(makeReview(
        `confidence-${wall.id}`,
        'dimension',
        '벽체 치수 또는 높이 신뢰도가 높지 않습니다.',
        source,
        `${wall.lengthMm}mm × ${wall.heightMm}mm · ${wall.confidence}`,
        '분석 결과의 원본 위치를 확인하고 필요한 값을 사용자 확인값으로 반영해야 합니다.',
        'warning',
        wall.id,
        wall.sourceReferences,
        wall.confidence,
      ))
    }
    const openings = wall.openings
    const xExtra = openings.flatMap((opening) => [opening.offsetMm || 0, (opening.offsetMm || 0) + (opening.widthMm || 0)])
    const yExtra = openings.flatMap((opening) => {
      const bottom = opening.type === 'door' ? 0 : opening.sillHeightMm || 0
      return [bottom, bottom + (opening.heightMm || 0)]
    })
    // 입력된 자재 카탈로그가 있으면 실제 절단 규격을 사용합니다.
    // 규격이 비어 있는 동안에는 도면 기반 부재 목록만 기존 산출 기준으로 만듭니다.
    const effectiveWidthMm = panelMaterial?.stockWidthMm || settings.panelEffectiveWidthMm
    const standardLengthMm = panelMaterial?.stockLengthMm || settings.panelStandardLengthMm
    const xStep = settings.panelDirection === 'vertical' ? effectiveWidthMm : standardLengthMm
    const yStep = settings.panelDirection === 'vertical' ? standardLengthMm : effectiveWidthMm
    const xBreaks = breaksFor(wall.lengthMm, xStep, xExtra)
    const yBreaks = breaksFor(wall.heightMm, yStep, yExtra)
    let pieceIndex = 0
    for (let xIndex = 0; xIndex < xBreaks.length - 1; xIndex += 1) {
      const xStart = xBreaks[xIndex]
      const xEnd = xBreaks[xIndex + 1]
      if (xStart === undefined || xEnd === undefined || xEnd - xStart <= 0) continue
      for (let yIndex = 0; yIndex < yBreaks.length - 1; yIndex += 1) {
        const yStart = yBreaks[yIndex]
        const yEnd = yBreaks[yIndex + 1]
        if (yStart === undefined || yEnd === undefined || yEnd - yStart <= 0) continue
        if (cellIsOpening(xStart, xEnd, yStart, yEnd, openings)) continue
        const openingIds = openings
          .filter((opening) => {
            if (opening.offsetMm === null || opening.widthMm === null || opening.heightMm === null) return false
            const sill = opening.type === 'door' ? 0 : opening.sillHeightMm || 0
            return xStart < opening.offsetMm + opening.widthMm && xEnd > opening.offsetMm && yStart < sill + opening.heightMm && yEnd > sill
          })
          .map((opening) => opening.id)
        const member = makeMember(
          wall,
          `member-${wall.id}-${pieceIndex + 1}`,
          xStart,
          xEnd,
          yStart,
          yEnd,
          settings,
          panelMaterialId,
          openingIds,
          wallIndex * 10000 + pieceIndex,
        )
        members.push(member)
        pieceIndex += 1
      }
    }
    if (!pieceIndex) {
      reviews.push(makeReview(
        `empty-${wall.id}`,
        'fit',
        '개구부를 제외하고 계산할 수 있는 직사각형 부재가 없습니다.',
        source,
        '부재 0개',
        '원본 도면의 벽체와 개구부 형상을 검토해야 합니다.',
        'blocked',
        wall.id,
        wall.sourceReferences,
        wall.confidence,
      ))
    }
  }
  if (!panelMaterialId && members.length) {
    reviews.push(makeReview(
      'material-panel-selection',
      'material',
      '판넬 부재에 연결할 자재가 선택되지 않았습니다.',
      '자재 카탈로그',
      '자재 종류 미지정',
      '자재 카탈로그에서 판넬 자재를 선택해야 절단 배치와 발주 수량을 계산할 수 있습니다.',
    ))
  }
  return { members, reviews }
}

function candidateLengths(material: MaterialCatalogItem) {
  return [...new Set([...(material.stockLengthOptionsMm || []), material.stockLengthMm].filter((value): value is number => value !== null && value > 0))].sort((a, b) => a - b)
}

const CUT_TOLERANCE_MM = 0.001

function fitsCutAxis(requiredMm: number, availableMm: number, kerfMm: number) {
  const remainderMm = availableMm - requiredMm
  return remainderMm >= -CUT_TOLERANCE_MM
    && (Math.abs(remainderMm) <= CUT_TOLERANCE_MM || remainderMm + CUT_TOLERANCE_MM >= kerfMm)
}

function orientationOptions(member: CuttingMember, material: MaterialCatalogItem, stockLengthMm: number, stockWidthMm: number) {
  const original = { lengthMm: member.requiredLengthMm, widthMm: member.requiredWidthMm || 0, rotated: false }
  const values = [original]
  const canRotate = material.rotatable && material.grainDirection === 'free'
  if (canRotate && original.widthMm > 0 && original.lengthMm !== original.widthMm) {
    values.push({ lengthMm: original.widthMm, widthMm: original.lengthMm, rotated: true })
  }
  const kerfMm = material.kerfMm || 0
  return values.filter((value) => fitsCutAxis(value.lengthMm, stockLengthMm, kerfMm) && fitsCutAxis(value.widthMm, stockWidthMm, kerfMm))
}

function fitOrientation(member: CuttingMember, material: MaterialCatalogItem, stockLengthMm: number, stockWidthMm: number) {
  return orientationOptions(member, material, stockLengthMm, stockWidthMm)[0] || null
}

function rectangleOverlap(a: { xMm: number; yMm: number; lengthMm: number; widthMm: number }, b: { xMm: number; yMm: number; lengthMm: number; widthMm: number }, inflateMm = 0) {
  return a.xMm - inflateMm < b.xMm + b.lengthMm && a.xMm + a.lengthMm + inflateMm > b.xMm && a.yMm - inflateMm < b.yMm + b.widthMm && a.yMm + a.widthMm + inflateMm > b.yMm
}

function chooseFreePlacement(freeRects: FreeRectangle[], member: CuttingMember, material: MaterialCatalogItem) {
  const options: Array<{ freeIndex: number; option: { lengthMm: number; widthMm: number; rotated: boolean }; score: number }> = []
  freeRects.forEach((free, freeIndex) => {
    for (const option of orientationOptions(member, material, free.lengthMm, free.widthMm)) {
      const remaining = free.lengthMm * free.widthMm - option.lengthMm * option.widthMm
      const score = remaining + Math.min(free.lengthMm - option.lengthMm, free.widthMm - option.widthMm) * 0.001 + freeIndex * 0.000001
      options.push({ freeIndex, option, score })
    }
  })
  return options.sort((a, b) => a.score - b.score)[0] || null
}

function splitFreeRectangle(free: FreeRectangle, placed: { lengthMm: number; widthMm: number }, kerfMm: number) {
  const consumedLength = placed.lengthMm + (free.lengthMm - placed.lengthMm > 0.001 ? kerfMm : 0)
  const consumedWidth = placed.widthMm + (free.widthMm - placed.widthMm > 0.001 ? kerfMm : 0)
  const result: FreeRectangle[] = []
  const rightLength = free.lengthMm - consumedLength
  const topWidth = free.widthMm - consumedWidth
  if (rightLength > 0.001) result.push({ xMm: free.xMm + consumedLength, yMm: free.yMm, lengthMm: rightLength, widthMm: placed.widthMm })
  if (topWidth > 0.001) result.push({ xMm: free.xMm, yMm: free.yMm + consumedWidth, lengthMm: free.lengthMm, widthMm: topWidth })
  return result
}

function panelCutCount(free: FreeRectangle, placed: { lengthMm: number; widthMm: number }) {
  return Number(free.lengthMm - placed.lengthMm > 0.001)
    + Number(free.widthMm - placed.widthMm > 0.001)
}

const MAX_MEMBER_QUANTITY = 10_000
const MAX_EXPANDED_MEMBER_UNITS = 50_000

function expandMemberUnits(members: CuttingMember[]) {
  const totalUnits = members.reduce((sum, member) => sum + (Number.isInteger(member.quantity) && member.quantity > 0 ? member.quantity : 0), 0)
  if (totalUnits > MAX_EXPANDED_MEMBER_UNITS) return []
  return members.flatMap((member) => Number.isInteger(member.quantity) && member.quantity > 0 && member.quantity <= MAX_MEMBER_QUANTITY
    ? Array.from({ length: member.quantity }, () => member)
    : [])
}

function storageForScrap(scrap: ScrapPiece, member: CuttingMember, material: MaterialCatalogItem, now: string) {
  const generatedAt = scrap.generatedAt || now
  const plannedUseAt = scrap.plannedUseAt || member.plannedInstallAt
  const storageDays = plannedUseAt
    ? Math.max(0, Math.ceil((new Date(plannedUseAt).getTime() - new Date(generatedAt).getTime()) / 86_400_000))
    : null
  return {
    plannedUseMemberId: member.id,
    plannedUseAt,
    storageDays,
    temporaryStorageCost: storageDays !== null && material.temporaryStorageCostPerDay !== null ? storageDays * material.temporaryStorageCostPerDay : null,
  }
}

function normalizedMaterialSpec(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function sameKnownDimension(left: number | null, right: number | null) {
  return left !== null
    && right !== null
    && Number.isFinite(left)
    && Number.isFinite(right)
    && left > 0
    && right > 0
    && Math.abs(left - right) <= CUT_TOLERANCE_MM
}

function canUseScrap(scrap: ScrapPiece, member: CuttingMember, material: MaterialCatalogItem) {
  if (!scrap.available || scrap.status !== 'reuse-planned' || scrap.materialId !== material.id) return false
  if (member.materialId !== material.id || member.materialType !== material.materialType || member.shape !== 'rectangle') return false
  const catalogMaterial = normalizedMaterialSpec(material.material)
  if (!catalogMaterial || normalizedMaterialSpec(scrap.material) !== catalogMaterial) return false
  // A catalog row can retain its id while its physical specification is edited.
  // Reject an older remnant unless its recorded thickness still matches exactly.
  if (!sameKnownDimension(scrap.thicknessMm, material.thicknessMm)) return false
  if (!Number.isFinite(scrap.lengthMm) || scrap.lengthMm <= 0 || !Number.isFinite(member.requiredLengthMm) || member.requiredLengthMm <= 0) return false
  // 목적 부재와 사용 예정 시점이 모두 정해진 자투리만 현장 재사용으로 씁니다.
  if (!scrap.plannedUseMemberId || scrap.plannedUseMemberId !== member.id || !scrap.plannedUseAt) return false
  if (scrap.usableZones.length && !scrap.usableZones.includes(member.zone)) return false
  if (material.materialType === 'panel') {
    if (scrap.widthMm === null || !Number.isFinite(scrap.widthMm) || scrap.widthMm <= 0) return false
    if (member.requiredWidthMm === null || !Number.isFinite(member.requiredWidthMm) || member.requiredWidthMm <= 0) return false
    return Boolean(fitOrientation(member, material, scrap.lengthMm, scrap.widthMm))
  }
  // A profile remnant's recorded width represents its section width. Do not
  // substitute a remnant from an older section specification under the same id.
  if (material.stockWidthMm === null ? scrap.widthMm !== null : !sameKnownDimension(scrap.widthMm, material.stockWidthMm)) return false
  if (member.requiredWidthMm !== null) return false
  const kerfMm = material.kerfMm || 0
  return Math.abs(scrap.lengthMm - member.requiredLengthMm) <= CUT_TOLERANCE_MM
    || scrap.lengthMm + CUT_TOLERANCE_MM >= member.requiredLengthMm + kerfMm
}

function makePlacement(
  member: CuttingMember,
  stockPlanId: string,
  xMm: number,
  yMm: number,
  lengthMm: number,
  widthMm: number | null,
  rotated: boolean,
  cutOrder: number,
  source: CuttingPlacement['source'],
  kerfMm: number,
): CuttingPlacement {
  return {
    id: `placement-${member.id}-${cutOrder}-${Math.random().toString(36).slice(2, 6)}`,
    memberId: member.id,
    label: `${member.wallNumber} · ${member.id.split('-').pop()}`,
    zone: member.zone,
    stockPlanId,
    xMm,
    yMm,
    lengthMm,
    widthMm,
    rotated,
    cutOrder,
    source,
    kerfMm,
  }
}

function newScrap(
  material: MaterialCatalogItem,
  source: ScrapPiece['source'],
  sourceStockPlanId: string | null,
  lengthMm: number,
  widthMm: number | null,
  originZone: string,
  now: string,
  xMm: number | null = null,
  yMm: number | null = null,
): ScrapPiece {
  const minimum = material.minimumReusableOffcutMm
  const largeEnough = minimum !== null && lengthMm >= minimum && (widthMm === null || widthMm >= minimum)
  return {
    id: `scrap-${sourceStockPlanId || 'existing'}-${Math.random().toString(36).slice(2, 8)}`,
    source,
    sourceStockPlanId,
    materialId: material.id,
    material: material.material,
    thicknessMm: material.thicknessMm,
    widthMm,
    lengthMm,
    xMm,
    yMm,
    currentLocation: source === 'existing' ? '현장 보관 위치 확인 필요' : '현장 절단 구역',
    originZone,
    usableZones: [],
    plannedUseMemberId: null,
    generatedAt: now,
    plannedUseAt: null,
    storageDays: null,
    temporaryStorageCost: null,
    available: largeEnough,
    status: largeEnough ? 'reuse-unavailable' : 'waste',
    disposalCategory: '폐기',
    note: largeEnough ? '사용처와 사용 시점이 정해지기 전에는 재사용하지 않습니다. 현장 기준에 따라 고철 또는 업체 반납으로 바꿀 수 있습니다.' : '최소 재사용 자투리 기준보다 작습니다.',
  }
}

function cloneScrap(scrap: ScrapPiece): ScrapPiece {
  return { ...scrap, usableZones: [...scrap.usableZones] }
}

function buildPersistentScrapState(existingScraps: ScrapPiece[], scenarioScraps: ScrapPiece[]) {
  return [
    ...existingScraps.filter((scrap) => scrap.source === 'existing').map(cloneScrap),
    ...scenarioScraps.filter((scrap) => scrap.source === 'generated').map(cloneScrap),
  ]
}

function finalizeExistingScraps(scraps: ScrapPiece[], plans: CuttingStockPlan[]) {
  const usedScrapIds = new Set(plans.flatMap((plan) => plan.scrapIds))
  for (const scrap of scraps) {
    if (scrap.source !== 'existing') continue
    if (scrap.status === 'reuse-planned' && !usedScrapIds.has(scrap.id)) {
      scrap.available = false
      scrap.status = 'reuse-unavailable'
      scrap.disposalCategory = '업체 반납'
      scrap.note = '지정한 부재와 재질·규격·구역 조건이 맞지 않아 이번 계산에서 사용하지 못했습니다.'
    } else if (scrap.status === 'reuse-unavailable') {
      scrap.available = false
      scrap.disposalCategory = scrap.disposalCategory || '업체 반납'
      scrap.note = scrap.note || '사용처 또는 사용 시점이 정해지지 않아 현장 재사용 대상으로 배정하지 않았습니다.'
    }
  }
}

function packPanels(material: MaterialCatalogItem, members: CuttingMember[], existingScraps: ScrapPiece[], stockLengthMm: number, objective: Objective, now: string): PackedResult {
  const stockWidthMm = material.stockWidthMm || 0
  if (stockWidthMm <= 0) return { stockPlans: [], scraps: [], unplacedMemberIds: members.map((member) => member.id), cutCount: 0 }
  const plans: CuttingStockPlan[] = []
  const scraps = existingScraps.map(cloneScrap)
  const unplaced: CuttingMember[] = []
  let cutOrder = 0
  const ordered = [...members].sort((a, b) => {
    const areaDiff = (b.requiredLengthMm * (b.requiredWidthMm || 0)) - (a.requiredLengthMm * (a.requiredWidthMm || 0))
    if (areaDiff !== 0) return areaDiff
    return a.installOrder - b.installOrder
  })
  for (const member of ordered) {
    const scrapIndex = scraps.findIndex((scrap) => canUseScrap(scrap, member, material))
    if (scrapIndex >= 0) {
      const scrap = scraps[scrapIndex]
      if (!scrap) continue
      const orientation = scrap.widthMm === null
        ? { lengthMm: member.requiredLengthMm, widthMm: member.requiredWidthMm || null, rotated: false }
        : fitOrientation(member, material, scrap.lengthMm, scrap.widthMm)
      if (!orientation) {
        unplaced.push(member)
        continue
      }
      const planId = `scrap-plan-${scrap.id}`
      const placement = makePlacement(member, planId, 0, 0, orientation.lengthMm, orientation.widthMm, orientation.rotated, ++cutOrder, 'onsite-scrap', material.kerfMm || 0)
      plans.push({
        id: planId,
        materialId: material.id,
        materialType: 'panel',
        source: 'onsite-scrap',
        stockIndex: plans.length + 1,
        stockLengthMm: scrap.lengthMm,
        stockWidthMm: scrap.widthMm,
        placements: [placement],
        remainingLengthMm: scrap.lengthMm - orientation.lengthMm,
        remainingAreaM2: scrap.widthMm === null || orientation.widthMm === null ? null : round((scrap.lengthMm * scrap.widthMm - orientation.lengthMm * orientation.widthMm) / 1_000_000),
        wasteLengthMm: null,
        wasteAreaM2: scrap.widthMm === null || orientation.widthMm === null ? null : round((scrap.lengthMm * scrap.widthMm - orientation.lengthMm * orientation.widthMm) / 1_000_000),
        cutCount: scrap.widthMm === null || orientation.widthMm === null
          ? Number(orientation.lengthMm < scrap.lengthMm)
          : panelCutCount(
              { xMm: 0, yMm: 0, lengthMm: scrap.lengthMm, widthMm: scrap.widthMm },
              orientation,
            ),
        scrapIds: [scrap.id],
      })
      const storage = storageForScrap(scrap, member, material, now)
      Object.assign(scrap, storage, { available: false, status: 'reuse-planned', note: `즉시 현장 재사용 · ${member.zone} · ${member.id}` })
      if (scrap.widthMm !== null) {
        const plan = plans.find((candidate) => candidate.id === planId)
        const remainderRects = splitFreeRectangle(
          { xMm: 0, yMm: 0, lengthMm: scrap.lengthMm, widthMm: scrap.widthMm },
          orientation,
          material.kerfMm || 0,
        )
        for (const remainder of remainderRects) {
          const remainderScrap = newScrap(material, 'generated', planId, remainder.lengthMm, remainder.widthMm, member.zone, now, remainder.xMm, remainder.yMm)
          plan?.scrapIds.push(remainderScrap.id)
          scraps.push(remainderScrap)
        }
        if (plan) {
          const reusableRemainderAreaM2 = round(remainderRects.reduce(
            (sum, remainder) => sum + remainder.lengthMm * remainder.widthMm / 1_000_000,
            0,
          ))
          plan.remainingAreaM2 = reusableRemainderAreaM2
          plan.wasteAreaM2 = reusableRemainderAreaM2
        }
      }
      continue
    }
    let best: { plan: CuttingStockPlan; freeIndex: number; option: { lengthMm: number; widthMm: number; rotated: boolean }; score: number } | null = null
    const freeByPlan = new Map<string, FreeRectangle[]>()
    for (const plan of plans.filter((item) => item.source === 'raw-material')) {
      const freeRects = (plan as CuttingStockPlan & { freeRects?: FreeRectangle[] }).freeRects || []
      freeByPlan.set(plan.id, freeRects)
      const choice = chooseFreePlacement(freeRects, member, material)
      if (choice && (!best || choice.score < best.score)) best = { plan, freeIndex: choice.freeIndex, option: choice.option, score: choice.score }
    }
    if (!best) {
      const rawStockIndex = plans.filter((plan) => plan.source === 'raw-material').length + 1
      const planId = `sheet-${material.id}-${rawStockIndex}-${stockLengthMm}`
      const freeRects: FreeRectangle[] = [{ xMm: 0, yMm: 0, lengthMm: stockLengthMm, widthMm: stockWidthMm }]
      const choice = chooseFreePlacement(freeRects, member, material)
      if (!choice) {
        unplaced.push(member)
        continue
      }
      const placement = makePlacement(member, planId, 0, 0, choice.option.lengthMm, choice.option.widthMm, choice.option.rotated, ++cutOrder, 'raw-material', material.kerfMm || 0)
      const nextFree = splitFreeRectangle(freeRects[0] as FreeRectangle, choice.option, material.kerfMm || 0)
      const plan = {
        id: planId,
        materialId: material.id,
        materialType: 'panel' as const,
        source: 'raw-material' as const,
        stockIndex: rawStockIndex,
        stockLengthMm,
        stockWidthMm,
        placements: [placement],
        remainingLengthMm: null,
        remainingAreaM2: null,
        wasteLengthMm: null,
        wasteAreaM2: null,
        cutCount: panelCutCount(freeRects[0] as FreeRectangle, choice.option),
        scrapIds: [],
        freeRects: nextFree,
      }
      plans.push(plan)
      continue
    }
    const freeRects = freeByPlan.get(best.plan.id) || []
    const free = freeRects[best.freeIndex]
    if (!free) {
      unplaced.push(member)
      continue
    }
    const placement = makePlacement(member, best.plan.id, free.xMm, free.yMm, best.option.lengthMm, best.option.widthMm, best.option.rotated, ++cutOrder, 'raw-material', material.kerfMm || 0)
    best.plan.placements.push(placement)
    best.plan.cutCount += panelCutCount(free, best.option)
    const nextFree = splitFreeRectangle(free, best.option, material.kerfMm || 0)
    freeRects.splice(best.freeIndex, 1, ...nextFree)
    ;(best.plan as CuttingStockPlan & { freeRects?: FreeRectangle[] }).freeRects = freeRects
    void objective
  }
  for (const plan of plans.filter((item) => item.source === 'raw-material')) {
    const rawPlan = plan as CuttingStockPlan & { freeRects?: FreeRectangle[] }
    const freeRects = rawPlan.freeRects || []
    const planScraps: ScrapPiece[] = []
    for (const free of freeRects) {
      const scrap = newScrap(material, 'generated', plan.id, free.lengthMm, free.widthMm, plan.placements[0]?.zone || '구역 미확인', now, free.xMm, free.yMm)
      planScraps.push(scrap)
      plan.scrapIds.push(scrap.id)
    }
    planScraps.forEach((scrap) => scraps.push(scrap))
    plan.remainingAreaM2 = round(planScraps.reduce((sum, scrap) => sum + (scrap.widthMm === null ? 0 : scrap.lengthMm * scrap.widthMm / 1_000_000), 0))
    plan.wasteAreaM2 = plan.remainingAreaM2
    delete rawPlan.freeRects
  }
  finalizeExistingScraps(scraps, plans)
  return { stockPlans: plans, scraps, unplacedMemberIds: unplaced.map((member) => member.id), cutCount: plans.reduce((sum, plan) => sum + plan.cutCount, 0) }
}

function packProfiles(material: MaterialCatalogItem, members: CuttingMember[], existingScraps: ScrapPiece[], stockLengthMm: number, now: string): PackedResult {
  const plans: CuttingStockPlan[] = []
  const scraps = existingScraps.map(cloneScrap)
  const remaining = [...members].sort((a, b) => b.requiredLengthMm - a.requiredLengthMm || a.installOrder - b.installOrder)
  const unplaced: string[] = []
  let cutOrder = 0
  const kerfMm = material.kerfMm || 0
  const exactFit = (availableLengthMm: number, requiredLengthMm: number) => Math.abs(availableLengthMm - requiredLengthMm) <= 0.001
  const canFit = (availableLengthMm: number, requiredLengthMm: number) => exactFit(availableLengthMm, requiredLengthMm) || availableLengthMm >= requiredLengthMm + kerfMm
  for (const member of remaining) {
    const scrapIndex = scraps.findIndex((scrap) => canUseScrap(scrap, member, material))
    if (scrapIndex >= 0) {
      const scrap = scraps[scrapIndex]
      if (!scrap) continue
      const planId = `scrap-profile-${scrap.id}`
      const appliedKerfMm = exactFit(scrap.lengthMm, member.requiredLengthMm) ? 0 : kerfMm
      const placement = makePlacement(member, planId, 0, 0, member.requiredLengthMm, scrap.widthMm, false, ++cutOrder, 'onsite-scrap', kerfMm)
      plans.push({
        id: planId,
        materialId: material.id,
        materialType: 'profile',
        source: 'onsite-scrap',
        stockIndex: plans.length + 1,
        stockLengthMm: scrap.lengthMm,
        stockWidthMm: scrap.widthMm,
        placements: [placement],
        remainingLengthMm: Math.max(0, scrap.lengthMm - member.requiredLengthMm - appliedKerfMm),
        remainingAreaM2: null,
        wasteLengthMm: Math.max(0, scrap.lengthMm - member.requiredLengthMm - appliedKerfMm),
        wasteAreaM2: null,
        cutCount: appliedKerfMm > 0 ? 1 : 0,
        scrapIds: [scrap.id],
      })
      const storage = storageForScrap(scrap, member, material, now)
      Object.assign(scrap, storage, { available: false, status: 'reuse-planned', note: `즉시 현장 재사용 · ${member.zone} · ${member.id}` })
      const remainingLengthMm = Math.max(0, scrap.lengthMm - member.requiredLengthMm - appliedKerfMm)
      if (remainingLengthMm > 0) {
        const remainderScrap = newScrap(material, 'generated', planId, remainingLengthMm, scrap.widthMm, member.zone, now, member.requiredLengthMm + appliedKerfMm, 0)
        plans.find((candidate) => candidate.id === planId)?.scrapIds.push(remainderScrap.id)
        scraps.push(remainderScrap)
      }
      continue
    }
    const candidate = plans.find((plan) => plan.source === 'raw-material' && canFit(plan.remainingLengthMm || 0, member.requiredLengthMm))
    if (candidate) {
      const availableLengthMm = candidate.remainingLengthMm || 0
      const appliedKerfMm = exactFit(availableLengthMm, member.requiredLengthMm) ? 0 : kerfMm
      const used = candidate.stockLengthMm - availableLengthMm
      const placement = makePlacement(member, candidate.id, used, 0, member.requiredLengthMm, material.stockWidthMm, false, ++cutOrder, 'raw-material', kerfMm)
      candidate.placements.push(placement)
      candidate.remainingLengthMm = Math.max(0, availableLengthMm - member.requiredLengthMm - appliedKerfMm)
      candidate.wasteLengthMm = candidate.remainingLengthMm
      candidate.cutCount += appliedKerfMm > 0 ? 1 : 0
      continue
    }
    if (!canFit(stockLengthMm, member.requiredLengthMm)) {
      unplaced.push(member.id)
      continue
    }
    const rawStockIndex = plans.filter((plan) => plan.source === 'raw-material').length + 1
    const planId = `bar-${material.id}-${rawStockIndex}-${stockLengthMm}`
    const appliedKerfMm = exactFit(stockLengthMm, member.requiredLengthMm) ? 0 : kerfMm
    const placement = makePlacement(member, planId, 0, 0, member.requiredLengthMm, material.stockWidthMm, false, ++cutOrder, 'raw-material', kerfMm)
    const remainingLengthMm = Math.max(0, stockLengthMm - member.requiredLengthMm - appliedKerfMm)
    plans.push({
      id: planId,
      materialId: material.id,
      materialType: 'profile',
      source: 'raw-material',
      stockIndex: rawStockIndex,
      stockLengthMm,
      stockWidthMm: material.stockWidthMm,
      placements: [placement],
      remainingLengthMm,
      remainingAreaM2: null,
      wasteLengthMm: remainingLengthMm,
      wasteAreaM2: null,
      cutCount: appliedKerfMm > 0 ? 1 : 0,
      scrapIds: [],
    })
  }
  for (const plan of plans.filter((item) => item.source === 'raw-material')) {
    const remainingLengthMm = plan.remainingLengthMm || 0
    if (remainingLengthMm > 0) {
      const scrap = newScrap(material, 'generated', plan.id, remainingLengthMm, material.stockWidthMm, plan.placements[0]?.zone || '구역 미확인', now, plan.stockLengthMm - remainingLengthMm, 0)
      plan.scrapIds.push(scrap.id)
      scraps.push(scrap)
    }
  }
  finalizeExistingScraps(scraps, plans)
  return { stockPlans: plans, scraps, unplacedMemberIds: unplaced, cutCount: plans.reduce((sum, plan) => sum + plan.cutCount, 0) }
}

function missingCatalogInputs(material: MaterialCatalogItem, objective: Objective, hasWaste: boolean, hasStorage: boolean, hasReview: boolean) {
  const missing: string[] = []
  if (!material.name || !material.material) missing.push('자재 종류·재질')
  if (material.minimumOrderQuantity === null) missing.push('최소 주문 수량')
  if (material.unitPrice === null) missing.push('단가')
  if (material.cuttingFee === null) missing.push('절단비')
  if (material.cutCostPerCut === null) missing.push('절단 1회 비용')
  if (material.transportCost === null) missing.push('운반비')
  if (material.handlingCost === null) missing.push('현장 취급비')
  if (hasWaste && material.materialType === 'panel' && material.disposalCostPerM2 === null) missing.push('판재 폐기·고철 처리비')
  if (hasWaste && material.materialType === 'profile' && material.disposalCostPerM === null) missing.push('프로파일 폐기·고철 처리비')
  if (hasStorage && material.temporaryStorageCostPerDay === null) missing.push('임시 보관비')
  if (hasReview && material.reworkRiskCost === null) missing.push('재작업 위험 비용')
  if (objective === 'cost' && missing.length) return [...new Set(missing)]
  return [...new Set(missing)]
}

function calculateCost(
  material: MaterialCatalogItem,
  plans: CuttingStockPlan[],
  scraps: ScrapPiece[],
  reviews: OptimizationReviewItem[],
  orderQuantity: number,
): OptimizationCostBreakdown {
  const stockCount = plans.filter((plan) => plan.source === 'raw-material').length
  const cutCount = plans.reduce((sum, plan) => sum + plan.cutCount, 0)
  // Existing site stock that was not selected is still inventory, not waste
  // produced by this cutting plan. Only newly generated remnants belong in
  // this scenario's waste and disposal totals.
  const wasteScraps = scraps.filter((scrap) => scrap.source === 'generated' && scrap.status !== 'reuse-planned')
  const wasteArea = wasteScraps.reduce((sum, scrap) => sum + (scrap.widthMm === null ? 0 : scrap.lengthMm * scrap.widthMm / 1_000_000), 0)
  const wasteLength = wasteScraps.reduce((sum, scrap) => sum + scrap.lengthMm, 0)
  const hasStorage = scraps.some((scrap) => (scrap.storageDays || 0) > 0)
  const missingInputs = missingCatalogInputs(material, 'cost', wasteArea > 0 || wasteLength > 0, hasStorage, reviews.length > 0)
  const purchaseCost = material.unitPrice === null ? null : orderQuantity * material.unitPrice
  const cuttingCost = material.cuttingFee === null ? null : stockCount * material.cuttingFee
  const cutCountCost = material.cutCostPerCut === null ? null : cutCount * material.cutCostPerCut
  const transportCost = material.transportCost
  const handlingCost = material.handlingCost
  const storageCost = hasStorage && material.temporaryStorageCostPerDay !== null
    ? scraps.reduce((sum, scrap) => sum + (scrap.storageDays || 0) * material.temporaryStorageCostPerDay!, 0)
    : hasStorage ? null : 0
  const disposalCost = material.materialType === 'panel'
    ? wasteArea > 0 && material.disposalCostPerM2 !== null ? wasteArea * material.disposalCostPerM2 : wasteArea > 0 ? null : 0
    : wasteLength > 0 && material.disposalCostPerM !== null ? (wasteLength / 1000) * material.disposalCostPerM : wasteLength > 0 ? null : 0
  const riskCost = reviews.length > 0 && material.reworkRiskCost !== null ? material.reworkRiskCost : reviews.length > 0 ? null : 0
  const values = [purchaseCost, cuttingCost, cutCountCost, transportCost, handlingCost, storageCost, disposalCost, riskCost]
  const complete = values.every((value) => value !== null) && missingInputs.length === 0
  return {
    purchaseCost,
    cuttingCost,
    cutCountCost,
    transportCost,
    handlingCost,
    storageCost,
    disposalCost,
    riskCost,
    totalCost: complete ? values.reduce((sum, value) => sum + (value || 0), 0) : null,
    missingInputs,
    status: missingInputs.length ? 'price-missing' : reviews.length ? 'review-required' : complete ? 'complete' : 'price-missing',
  }
}

function validateScenario(members: CuttingMember[], plans: CuttingStockPlan[], walls: Wall[]): OptimizationValidation {
  const validation = emptyOptimizationValidation()
  const expected = new Map(members.map((member) => [member.id, member.quantity]))
  const actual = new Map<string, number>()
  for (const plan of plans) {
    for (const placement of plan.placements) {
      actual.set(placement.memberId, (actual.get(placement.memberId) || 0) + 1)
      if (placement.lengthMm <= 0 || (placement.widthMm !== null && placement.widthMm <= 0)) validation.unitErrors.push(`${placement.label}: 0보다 큰 치수가 필요합니다.`)
      if (plan.materialType === 'panel' && plan.stockWidthMm !== null && (placement.xMm + placement.lengthMm > plan.stockLengthMm + 0.001 || placement.yMm + (placement.widthMm || 0) > plan.stockWidthMm + 0.001)) {
        validation.oversizedMemberErrors.push(`${placement.label}: 원자재 바깥으로 배치되었습니다.`)
      }
      if (plan.materialType === 'panel' && plan.stockWidthMm !== null && placement.widthMm !== null && placement.kerfMm > 0) {
        const edgeGaps = [
          placement.xMm,
          plan.stockLengthMm - placement.xMm - placement.lengthMm,
          placement.yMm,
          plan.stockWidthMm - placement.yMm - placement.widthMm,
        ]
        if (edgeGaps.some((gapMm) => gapMm > CUT_TOLERANCE_MM && gapMm + CUT_TOLERANCE_MM < placement.kerfMm)) {
          validation.kerfErrors.push(`${placement.label}: 원자재 외곽과 부재 사이 절단폭이 부족합니다.`)
        }
      }
      if (plan.materialType === 'profile' && placement.xMm + placement.lengthMm > plan.stockLengthMm + 0.001) validation.oversizedMemberErrors.push(`${placement.label}: 원자재 길이를 초과했습니다.`)
    }
    for (let first = 0; first < plan.placements.length; first += 1) {
      for (let second = first + 1; second < plan.placements.length; second += 1) {
        const a = plan.placements[first]
        const b = plan.placements[second]
        if (!a || !b) continue
        if (plan.materialType === 'panel' && a.widthMm !== null && b.widthMm !== null) {
          if (rectangleOverlap(a, b)) validation.overlapErrors.push(`${plan.id}: ${a.label}와 ${b.label}가 겹칩니다.`)
          if (rectangleOverlap(a, b, Math.max(a.kerfMm, b.kerfMm) / 2)) validation.kerfErrors.push(`${plan.id}: ${a.label}와 ${b.label} 사이 절단폭이 부족합니다.`)
        } else if (a.xMm < b.xMm + b.lengthMm && a.xMm + a.lengthMm > b.xMm) {
          validation.overlapErrors.push(`${plan.id}: ${a.label}와 ${b.label}의 길이가 겹칩니다.`)
        }
      }
    }
  }
  for (const member of members) {
    if (!Number.isInteger(member.quantity) || member.quantity <= 0 || member.quantity > MAX_MEMBER_QUANTITY) {
      validation.unitErrors.push(`${member.id}: 수량은 1~${MAX_MEMBER_QUANTITY.toLocaleString('ko-KR')}의 정수여야 합니다.`)
    }
    const count = actual.get(member.id) || 0
    if (count !== member.quantity) {
      validation.memberAssignmentErrors.push(count === 0
        ? `${member.id}: 배치되지 않았습니다.`
        : `${member.id}: 필요 수량 ${member.quantity}개와 실제 배정 ${count}개가 다릅니다.`)
    }
  }
  for (const memberId of actual.keys()) {
    if (!expected.has(memberId)) validation.duplicateCalculationErrors.push(`${memberId}: 목록에 없는 부재가 배치되었습니다.`)
  }
  for (const member of members) {
    if (member.shape !== 'rectangle') validation.unsupportedShapeErrors.push(`${member.id}: 직사각형 이외 형상은 지원하지 않습니다.`)
    if (member.requiredLengthMm <= 0 || (member.requiredWidthMm !== null && member.requiredWidthMm <= 0)) validation.unitErrors.push(`${member.id}: 치수가 올바르지 않습니다.`)
  }
  for (const wall of walls) {
    const wallMembers = members.filter((member) => member.sourceWallId === wall.id)
    if (!wallMembers.length || wall.lengthMm === null || wall.heightMm === null) continue
    const expectedArea = (wall.lengthMm * wall.heightMm - wall.openings.reduce((sum, opening) => sum + (opening.areaM2 || 0) * 1_000_000, 0)) / 1_000_000
    const actualArea = wallMembers.reduce((sum, member) => sum + member.requiredLengthMm * (member.requiredWidthMm || 0) * member.quantity / 1_000_000, 0)
    if (Math.abs(expectedArea - actualArea) > 0.01) validation.openingDoubleCountErrors.push(`${wall.number}: 개구부 차감 면적과 절단 부재 면적이 맞지 않습니다.`)
  }
  validation.passed = [
    validation.memberAssignmentErrors,
    validation.oversizedMemberErrors,
    validation.overlapErrors,
    validation.kerfErrors,
    validation.unitErrors,
    validation.duplicateCalculationErrors,
    validation.openingDoubleCountErrors,
    validation.unsupportedShapeErrors,
  ].every((items) => items.length === 0)
  return validation
}

function aggregateScenario(
  id: Objective,
  material: MaterialCatalogItem,
  members: CuttingMember[],
  reviews: OptimizationReviewItem[],
  packed: PackedResult,
  walls: Wall[],
  stockLengthComparison: OptimizationScenario['stockLengthComparison'] = [],
): OptimizationScenario {
  const rawPlans = packed.stockPlans.filter((plan) => plan.source === 'raw-material')
  const stockCount = rawPlans.length
  const orderQuantity = stockCount === 0 ? 0 : material.minimumOrderQuantity === null ? null : Math.max(stockCount, material.minimumOrderQuantity)
  const wasteScraps = packed.scraps.filter((scrap) => scrap.source === 'generated' && scrap.status !== 'reuse-planned')
  const wasteAreaM2 = material.materialType === 'panel'
    ? round(wasteScraps.reduce((sum, scrap) => sum + (scrap.widthMm === null ? 0 : scrap.lengthMm * scrap.widthMm / 1_000_000), 0))
    : null
  const wasteLengthMm = material.materialType === 'profile'
    ? round(wasteScraps.reduce((sum, scrap) => sum + scrap.lengthMm, 0), 2)
    : null
  const stockArea = material.materialType === 'panel' && material.stockWidthMm
    ? rawPlans.reduce((sum, plan) => sum + plan.stockLengthMm * material.stockWidthMm!, 0) / 1_000_000
    : null
  const wasteRate = stockArea && wasteAreaM2 !== null && stockArea > 0 ? round((wasteAreaM2 / stockArea) * 100, 2) : null
  const validation = validateScenario(members, packed.stockPlans, walls)
  const cost = calculateCost(material, packed.stockPlans, packed.scraps, reviews, orderQuantity || 0)
  const available = packed.unplacedMemberIds.length === 0 && validation.passed && reviews.length === 0 && cost.status === 'complete'
  const description = id === 'cost'
    ? '구매·절단·운반·보관·폐기 비용을 합산해 비교합니다.'
    : id === 'waste'
      ? '남는 면적 또는 남는 길이가 가장 작은 배치를 비교합니다.'
      : '원자재 개수와 절단 작업 수가 적은 배치를 비교합니다.'
  return {
    id,
    label: id === 'cost' ? '총비용 최소안' : id === 'waste' ? '폐기량 최소안' : '작업 단순안',
    description,
    available,
    recommendation: cost.totalCost === null && id === 'cost' ? '가격 정보가 없어 총비용을 확정할 수 없습니다.' : available ? '현재 입력으로 발주 검토 가능한 안입니다.' : '검토 항목을 해결해야 발주에 사용할 수 있습니다.',
    stockPlans: packed.stockPlans,
    scraps: packed.scraps,
    unplacedMemberIds: packed.unplacedMemberIds,
    stockCount,
    orderQuantity,
    cutCount: packed.cutCount,
    wasteAreaM2,
    wasteLengthMm,
    wasteRate,
    cost,
    validation,
    stockLengthComparison,
  }
}

function scenarioScore(scenario: OptimizationScenario, objective: Objective) {
  if (objective === 'cost') return [scenario.cost.totalCost === null ? Number.POSITIVE_INFINITY : scenario.cost.totalCost, scenario.stockCount, scenario.cutCount, scenario.wasteAreaM2 ?? scenario.wasteLengthMm ?? Number.POSITIVE_INFINITY]
  if (objective === 'waste') return [scenario.wasteAreaM2 ?? scenario.wasteLengthMm ?? Number.POSITIVE_INFINITY, scenario.stockCount, scenario.cutCount]
  return [scenario.stockCount, scenario.cutCount, scenario.wasteAreaM2 ?? scenario.wasteLengthMm ?? Number.POSITIVE_INFINITY]
}

function compareScores(a: number[], b: number[]) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? Number.POSITIVE_INFINITY
    const right = b[index] ?? Number.POSITIVE_INFINITY
    if (left !== right) return left - right
  }
  return 0
}

function packForObjective(material: MaterialCatalogItem, members: CuttingMember[], existingScraps: ScrapPiece[], objective: Objective, walls: Wall[], reviews: OptimizationReviewItem[], now: string) {
  const lengths = candidateLengths(material)
  const packingMembers = expandMemberUnits(members)
  const candidates = lengths.map((length) => {
    const packed = material.materialType === 'panel'
      ? packPanels(material, packingMembers, existingScraps, length, objective, now)
      : packProfiles(material, packingMembers, existingScraps, length, now)
    return aggregateScenario(objective, material, members, reviews, packed, walls)
  })
  if (!candidates.length) {
    const packed: PackedResult = { stockPlans: [], scraps: [], unplacedMemberIds: packingMembers.map((member) => member.id), cutCount: 0 }
    return aggregateScenario(objective, material, members, reviews, packed, walls)
  }
  const selected = [...candidates].sort((a, b) => compareScores(scenarioScore(a, objective), scenarioScore(b, objective)))[0] as OptimizationScenario
  selected.stockLengthComparison = candidates.map((candidate) => ({
    stockLengthMm: candidate.stockPlans.find((plan) => plan.source === 'raw-material')?.stockLengthMm || candidate.stockPlans[0]?.stockLengthMm || 0,
    stockCount: candidate.stockCount,
    wasteAreaM2: candidate.wasteAreaM2,
    wasteLengthMm: candidate.wasteLengthMm,
    totalCost: candidate.cost.totalCost,
    selected: candidate === selected,
  }))
  return selected
}

function catalogReviews(material: MaterialCatalogItem | null, members: CuttingMember[]) {
  const reviews: OptimizationReviewItem[] = []
  if (!material) {
    reviews.push(makeReview('catalog-selection', 'material', '계산에 사용할 자재 카탈로그가 선택되지 않았습니다.', '자재 카탈로그', '선택 안 함', '자재 종류와 규격을 먼저 연결해야 합니다.'))
    return reviews
  }
  if (!material.name || !material.material) reviews.push(makeReview(`catalog-name-${material.id}`, 'material', '자재 종류와 재질이 비어 있습니다.', '자재 카탈로그', `${material.name || '종류 없음'} · ${material.material || '재질 없음'}`, '발주서에 표시할 자재 정보를 입력해야 합니다.', 'blocked', material.id))
  if (material.kerfMm === null) reviews.push(makeReview(`catalog-kerf-${material.id}`, 'fit', '톱날 절단폭이 입력되지 않았습니다.', '자재 카탈로그', '절단폭 없음', '절단폭을 반영하지 않으면 배치가 실제보다 넓게 계산될 수 있습니다.', 'blocked', material.id, [], undefined, 'kerfMm'))
  if (material.materialType === 'panel' && material.stockWidthMm === null) reviews.push(makeReview(`catalog-sheet-width-${material.id}`, 'fit', '판재 폭이 입력되지 않았습니다.', '자재 카탈로그', '폭 없음', '판재 폭을 입력해야 2차원 배치가 원자재 밖으로 나가지 않는지 확인할 수 있습니다.', 'blocked', material.id, [], undefined, 'stockWidthMm'))
  if (material.materialType === 'panel' && !candidateLengths(material).length) reviews.push(makeReview(`catalog-sheet-length-${material.id}`, 'fit', '판재 원자재 길이가 입력되지 않았습니다.', '자재 카탈로그', '길이 없음', '판재 원자재 길이 또는 비교할 길이를 입력해야 절단 배치를 계산할 수 있습니다.', 'blocked', material.id, [], undefined, 'stockLengthMm'))
  if (material.materialType === 'profile' && !candidateLengths(material).length) reviews.push(makeReview(`catalog-bar-size-${material.id}`, 'fit', '프로파일 원자재 길이가 없습니다.', '자재 카탈로그', '원자재 길이 없음', '6,000·9,000·12,000mm 등 비교할 원자재 길이를 입력해야 합니다.', 'blocked', material.id, [], undefined, 'stockLengthMm'))
  if (candidateLengths(material).length > 1) reviews.push(makeReview(`catalog-length-price-${material.id}`, 'price', '원자재 길이별 단가가 없어 총비용 최소안을 확정할 수 없습니다.', '자재 카탈로그', candidateLengths(material).map((length) => `${length}mm`).join(', '), '비교 길이마다 실제 단가가 다를 수 있습니다. 발주 확정 전에는 한 가지 원자재 길이만 남기거나 길이별 견적을 별도로 확인하세요.', 'blocked', material.id, [], undefined, 'stockLengthOptionsMm'))
  if (material.minimumReusableOffcutMm === null) reviews.push(makeReview(`catalog-scrap-${material.id}`, 'scrap', '재사용 가능한 최소 자투리 크기가 없습니다.', '자재 카탈로그', '최소 자투리 기준 없음', '현장 내 재사용과 폐기 대상을 구분하려면 기준을 입력해야 합니다.', 'warning', material.id, [], undefined, 'minimumReusableOffcutMm'))
  if (material.lapAllowanceMm !== null && material.lapAllowanceMm > 0) reviews.push(makeReview(`catalog-lap-${material.id}`, 'fit', '허용 이음·겹침 길이는 절단 치수에 자동 적용하지 않았습니다.', '자재 카탈로그', `${material.lapAllowanceMm}mm`, '제조사 시공 방향과 이음 상세가 확인되지 않은 상태에서 겹침을 더하면 실제 부재를 임의 변경할 수 있어 사람 확인이 필요합니다.', 'warning', material.id))
  const positiveDimensions: Array<{ field: keyof MaterialCatalogItem; label: string; value: number | null }> = [
    { field: 'thicknessMm', label: '두께', value: material.thicknessMm },
    ...(material.materialType === 'panel'
      ? [{ field: 'stockWidthMm' as const, label: '원자재 폭', value: material.stockWidthMm }]
      : []),
  ]
  for (const field of positiveDimensions.filter(({ value }) => value !== null && (!Number.isFinite(value) || (value as number) <= 0))) {
    reviews.push(makeReview(`catalog-invalid-${material.id}-${String(field.field)}`, 'fit', `${field.label}가 올바르지 않습니다.`, '자재 카탈로그', String(field.value), `${field.label}는 0보다 큰 숫자여야 합니다.`, 'blocked', material.id, [], undefined, field.field))
  }
  if (material.stockLengthMm !== null && (!Number.isFinite(material.stockLengthMm) || material.stockLengthMm <= 0)) {
    reviews.push(makeReview(`catalog-invalid-${material.id}-stockLengthMm`, 'fit', '원자재 길이가 올바르지 않습니다.', '자재 카탈로그', String(material.stockLengthMm), '원자재 길이는 0보다 큰 숫자여야 합니다.', 'blocked', material.id, [], undefined, 'stockLengthMm'))
  }
  if (material.stockLengthOptionsMm.some((value) => !Number.isFinite(value) || value <= 0)) {
    reviews.push(makeReview(`catalog-invalid-${material.id}-stockLengthOptionsMm`, 'fit', '비교 원자재 길이에 올바르지 않은 값이 있습니다.', '자재 카탈로그', material.stockLengthOptionsMm.join(', '), '모든 비교 길이는 0보다 큰 숫자여야 합니다.', 'blocked', material.id))
  }
  if (material.minimumOrderQuantity !== null && (!Number.isInteger(material.minimumOrderQuantity) || material.minimumOrderQuantity <= 0)) {
    reviews.push(makeReview(`catalog-invalid-${material.id}-minimumOrderQuantity`, 'price', '최소 주문 수량이 올바르지 않습니다.', '자재 카탈로그', String(material.minimumOrderQuantity), '최소 주문 수량은 1 이상의 정수여야 합니다.', 'blocked', material.id, [], undefined, 'minimumOrderQuantity'))
  }
  const nonNegativeFields: Array<{ field: keyof MaterialCatalogItem; label: string; value: number | null }> = [
    { field: 'unitPrice', label: '단가', value: material.unitPrice },
    { field: 'cuttingFee', label: '절단비', value: material.cuttingFee },
    { field: 'cutCostPerCut', label: '절단 1회 비용', value: material.cutCostPerCut },
    { field: 'kerfMm', label: '톱날 절단폭', value: material.kerfMm },
    { field: 'transportCost', label: '운반비', value: material.transportCost },
    { field: 'handlingCost', label: '현장 취급비', value: material.handlingCost },
    { field: 'disposalCostPerM2', label: '면적당 폐기비', value: material.disposalCostPerM2 },
    { field: 'disposalCostPerM', label: '길이당 폐기비', value: material.disposalCostPerM },
    { field: 'temporaryStorageCostPerDay', label: '일일 임시 보관비', value: material.temporaryStorageCostPerDay },
    { field: 'lapAllowanceMm', label: '이음·겹침 길이', value: material.lapAllowanceMm },
    { field: 'minimumReusableOffcutMm', label: '최소 재사용 자투리', value: material.minimumReusableOffcutMm },
    { field: 'reworkRiskCost', label: '재작업 위험 비용', value: material.reworkRiskCost },
  ]
  for (const field of nonNegativeFields.filter(({ value }) => value !== null && (!Number.isFinite(value) || (value as number) < 0))) {
    reviews.push(makeReview(`catalog-invalid-${material.id}-${String(field.field)}`, field.field === 'kerfMm' ? 'fit' : 'price', `${field.label}가 올바르지 않습니다.`, '자재 카탈로그', String(field.value), `${field.label}는 0 이상의 숫자여야 합니다.`, 'blocked', material.id, [], undefined, field.field))
  }
  const costFields: Array<{ field: keyof MaterialCatalogItem; label: string }> = [
    { field: 'unitPrice', label: '단가' },
    { field: 'minimumOrderQuantity', label: '최소 주문 수량' },
    { field: 'cuttingFee', label: '절단비' },
    { field: 'cutCostPerCut', label: '절단 1회 비용' },
    { field: 'transportCost', label: '운반비' },
    { field: 'handlingCost', label: '현장 취급비' },
  ]
  for (const field of costFields.filter((candidate) => material[candidate.field] === null)) {
    reviews.push(makeReview(`catalog-price-${material.id}-${String(field.field)}`, 'price', `${field.label}가 입력되지 않았습니다.`, '자재 카탈로그', `${field.label} 없음`, '가격이 없는 상태에서는 가짜 총액을 만들지 않고 비용 계산을 보류합니다.', 'blocked', material.id, [], undefined, field.field))
  }
  if (members.some((member) => member.shape !== 'rectangle')) reviews.push(makeReview(`shape-${material.id}`, 'shape', '직사각형 이외 형상이 포함되어 있습니다.', '도면 부재 목록', '지원되지 않는 형상', '불규칙 형상을 임의의 사각형으로 바꾸지 않습니다.', 'blocked', material.id))
  for (const member of members.filter((candidate) => candidate.materialType !== material.materialType)) {
    reviews.push(makeReview(
      `material-type-${member.id}`,
      'material',
      '부재 형태와 자재 카탈로그 형태가 일치하지 않습니다.',
      member.location || member.id,
      `부재 ${member.materialType} · 자재 ${material.materialType}`,
      '판재 부재는 판재 자재에, 프로파일 부재는 프로파일 자재에 다시 연결해야 합니다.',
      'blocked',
      member.id,
      member.sourceReferences,
      member.confidence,
    ))
  }
  for (const member of members.filter((candidate) => !Number.isInteger(candidate.quantity) || candidate.quantity <= 0 || candidate.quantity > MAX_MEMBER_QUANTITY)) {
    reviews.push(makeReview(
      `quantity-${member.id}`,
      'dimension',
      '부재 수량이 올바른 정수가 아닙니다.',
      member.location || member.id,
      String(member.quantity),
      `수량은 1~${MAX_MEMBER_QUANTITY.toLocaleString('ko-KR')}의 정수로 확인해야 하며 범위를 벗어난 값을 임의로 반올림하지 않습니다.`,
      'blocked',
      member.id,
      member.sourceReferences,
      member.confidence,
    ))
  }
  return reviews
}

function mergeCostBreakdowns(scenarios: OptimizationScenario[]): OptimizationCostBreakdown {
  const sumWhenComplete = (field: keyof Omit<OptimizationCostBreakdown, 'missingInputs' | 'status'>) => {
    const values = scenarios.map((scenario) => scenario.cost[field] as number | null)
    return values.every((value) => value !== null)
      ? values.reduce<number>((sum, value) => sum + (value || 0), 0)
      : null
  }
  const missingInputs = [...new Set(scenarios.flatMap((scenario) => scenario.cost.missingInputs))]
  const status = scenarios.some((scenario) => scenario.cost.status === 'price-missing')
    ? 'price-missing' as const
    : scenarios.some((scenario) => scenario.cost.status === 'review-required')
      ? 'review-required' as const
      : 'complete' as const
  return {
    purchaseCost: sumWhenComplete('purchaseCost'),
    cuttingCost: sumWhenComplete('cuttingCost'),
    cutCountCost: sumWhenComplete('cutCountCost'),
    transportCost: sumWhenComplete('transportCost'),
    handlingCost: sumWhenComplete('handlingCost'),
    storageCost: sumWhenComplete('storageCost'),
    disposalCost: sumWhenComplete('disposalCost'),
    riskCost: sumWhenComplete('riskCost'),
    totalCost: sumWhenComplete('totalCost'),
    missingInputs,
    status,
  }
}

function combineMaterialScenarios(
  objective: Objective,
  materialScenarios: OptimizationScenario[],
  members: CuttingMember[],
  walls: Wall[],
  reviews: OptimizationReviewItem[],
): OptimizationScenario {
  const stockPlans = materialScenarios.flatMap((scenario) => scenario.stockPlans)
  const scraps = materialScenarios.flatMap((scenario) => scenario.scraps)
  const unplacedMemberIds = materialScenarios.flatMap((scenario) => scenario.unplacedMemberIds)
  const validation = validateScenario(members, stockPlans, walls)
  const cost = mergeCostBreakdowns(materialScenarios)
  const stockCount = materialScenarios.reduce((sum, scenario) => sum + scenario.stockCount, 0)
  const cutCount = materialScenarios.reduce((sum, scenario) => sum + scenario.cutCount, 0)
  const orderQuantity = materialScenarios.every((scenario) => scenario.orderQuantity !== null)
    ? materialScenarios.reduce((sum, scenario) => sum + (scenario.orderQuantity || 0), 0)
    : null
  const areaValues = materialScenarios.map((scenario) => scenario.wasteAreaM2).filter((value): value is number => value !== null)
  const lengthValues = materialScenarios.map((scenario) => scenario.wasteLengthMm).filter((value): value is number => value !== null)
  const wasteAreaM2 = areaValues.length ? round(areaValues.reduce((sum, value) => sum + value, 0)) : null
  const wasteLengthMm = lengthValues.length ? round(lengthValues.reduce((sum, value) => sum + value, 0), 2) : null
  const panelStockAreaM2 = stockPlans
    .filter((plan) => plan.source === 'raw-material' && plan.materialType === 'panel' && plan.stockWidthMm !== null)
    .reduce((sum, plan) => sum + plan.stockLengthMm * (plan.stockWidthMm || 0) / 1_000_000, 0)
  const wasteRate = wasteAreaM2 !== null && panelStockAreaM2 > 0
    ? round((wasteAreaM2 / panelStockAreaM2) * 100, 2)
    : null
  const available = unplacedMemberIds.length === 0
    && validation.passed
    && reviews.length === 0
    && cost.status === 'complete'
  const description = objective === 'cost'
    ? '모든 자재의 구매·절단·운반·보관·폐기 비용을 합산해 비교합니다.'
    : objective === 'waste'
      ? '모든 자재에서 남는 면적 또는 길이가 가장 작은 배치를 비교합니다.'
      : '모든 자재의 원자재 개수와 절단 작업 수가 적은 배치를 비교합니다.'
  return {
    id: objective,
    label: objective === 'cost' ? '총비용 최소안' : objective === 'waste' ? '폐기량 최소안' : '작업 단순안',
    description,
    available,
    recommendation: cost.totalCost === null && objective === 'cost'
      ? '가격 정보가 없어 총비용을 확정할 수 없습니다.'
      : available
        ? '현재 입력으로 발주 검토 가능한 안입니다.'
        : '검토 항목을 해결해야 발주에 사용할 수 있습니다.',
    stockPlans,
    scraps,
    unplacedMemberIds,
    stockCount,
    orderQuantity,
    cutCount,
    wasteAreaM2,
    wasteLengthMm,
    wasteRate,
    cost,
    validation,
    stockLengthComparison: materialScenarios.length === 1
      ? materialScenarios[0]?.stockLengthComparison || []
      : [],
  }
}

export function optimizeCuttingPlan(input: {
  walls: Wall[]
  members: CuttingMember[]
  catalog: MaterialCatalogItem[]
  existingScraps?: ScrapPiece[]
  now?: string
}): OptimizationPlanResult {
  const now = input.now || new Date().toISOString()
  const selectedMaterialIds = [...new Set(input.members.map((member) => member.materialId).filter((id): id is string => Boolean(id)))]
  const selectedMaterials = selectedMaterialIds.map((id) => input.catalog.find((item) => item.id === id)).filter((item): item is MaterialCatalogItem => Boolean(item))
  const reviews = input.members.filter((member) => member.reviewStatus !== 'ready').map((member) => makeReview(
    `member-confidence-${member.id}`,
    'dimension',
    member.notes[0] || '부재의 신뢰도를 확인해야 합니다.',
    member.sourceReferences[0] ? `${member.sourceReferences[0].fileName} · ${member.sourceReferences[0].pageNumber}페이지` : '도면 근거 미확인',
    `${member.requiredLengthMm}mm × ${member.requiredWidthMm || '—'}mm`,
    '검토가 끝난 값만 발주 계산에 확정 반영합니다.',
    'warning',
    member.id,
    member.sourceReferences,
    member.confidence,
  ))
  if (!selectedMaterials.length) reviews.push(makeReview('material-selection', 'material', '도면 부재와 연결된 자재가 없습니다.', '자재 카탈로그', '자재 선택 필요', '자재를 선택하고 다시 계산해야 합니다.'))
  const totalMemberUnits = input.members.reduce((sum, member) => sum + (Number.isInteger(member.quantity) && member.quantity > 0 ? member.quantity : 0), 0)
  if (totalMemberUnits > MAX_EXPANDED_MEMBER_UNITS) {
    reviews.push(makeReview('member-quantity-total-limit', 'dimension', '전체 절단 부재 수가 계산 상한을 초과했습니다.', '도면 부재 목록', `${totalMemberUnits.toLocaleString('ko-KR')}개`, `한 번에 계산할 수 있는 전체 부재는 ${MAX_EXPANDED_MEMBER_UNITS.toLocaleString('ko-KR')}개 이하입니다.`, 'blocked'))
  }
  for (const materialId of selectedMaterialIds.filter((id) => !selectedMaterials.some((material) => material.id === id))) {
    reviews.push(makeReview(
      `material-missing-${materialId}`,
      'material',
      '부재에 연결된 자재 카탈로그 항목을 찾을 수 없습니다.',
      '자재 카탈로그',
      materialId,
      '삭제되거나 변경된 자재 연결을 다시 확인해야 합니다.',
      'blocked',
      materialId,
    ))
  }
  const scenariosByObjective = new Map<Objective, OptimizationScenario[]>([
    ['cost', []],
    ['waste', []],
    ['simple', []],
  ])
  for (const material of selectedMaterials) {
    const linkedMaterialMembers = input.members.filter((member) => member.materialId === material.id)
    const materialMembers = linkedMaterialMembers.filter((member) => member.materialType === material.materialType)
    const catalogReviewItems = catalogReviews(material, linkedMaterialMembers)
    const materialReviews = [
      ...reviews.filter((review) => !review.targetId || materialMembers.some((member) => member.id === review.targetId)),
      ...catalogReviewItems,
    ]
    reviews.push(...catalogReviewItems)
    const materialScraps = (input.existingScraps || []).filter((scrap) => scrap.materialId === material.id)
    for (const objective of ['cost', 'waste', 'simple'] as Objective[]) {
      const scenario = packForObjective(material, materialMembers, materialScraps, objective, input.walls, materialReviews, now)
      scenariosByObjective.get(objective)?.push(scenario)
    }
  }
  const uniqueReviews = [...new Map(reviews.map((review) => [review.id, review])).values()]
  const scenarios = selectedMaterials.length
    ? (['cost', 'waste', 'simple'] as Objective[]).map((objective) => combineMaterialScenarios(
        objective,
        scenariosByObjective.get(objective) || [],
        input.members,
        input.walls,
        uniqueReviews,
      ))
    : []
  const selectedScenario = scenarios.find((scenario) => scenario.id === 'cost') || scenarios[0]
  const validation = selectedScenario?.validation || emptyOptimizationValidation()
  const status = !scenarios.length
    ? 'blocked'
    : uniqueReviews.some((review) => review.severity === 'blocked' || !review.resolved) || !validation.passed || scenarios.some((scenario) => scenario.unplacedMemberIds.length || scenario.cost.status !== 'complete')
      ? 'needs-review'
      : 'calculated'
  const persistentScraps = buildPersistentScrapState(input.existingScraps || [], selectedScenario?.scraps || [])
  return {
    members: input.members,
    reviews: uniqueReviews,
    scenarios,
    selectedScenarioId: 'cost',
    recommendedScenarioId: 'cost',
    // Scenario scraps describe what happened in this run (a consumed onsite
    // scrap is unavailable there). The top-level collection is persisted by
    // the app and becomes the next run's input, so keep the user-entered
    // existing-scrap state intact and only add newly generated remnants.
    scraps: persistentScraps,
    status,
    validation,
  }
}

export function createProfileMembersForTest(input: Array<{ id: string; zone: string; lengthMm: number; materialId: string; installOrder?: number }>): CuttingMember[] {
  return input.map((item, index) => ({
    id: item.id,
    sourceWallId: null,
    zone: item.zone,
    location: item.zone,
    wallNumber: item.id,
    requiredLengthMm: item.lengthMm,
    requiredWidthMm: null,
    requiredHeightMm: null,
    quantity: 1,
    materialType: 'profile',
    materialId: item.materialId,
    materialSpec: '시험용 프로파일',
    shape: 'rectangle',
    cuttingRequired: true,
    openingIds: [],
    installOrder: item.installOrder ?? index,
    plannedInstallAt: null,
    sourceReferences: [],
    confidence: 'high',
    reviewStatus: 'ready',
    notes: [],
  }))
}
