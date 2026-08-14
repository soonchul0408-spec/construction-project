import type {
  DrawingPage,
  Evidence,
  InventoryCut,
  InventoryCutPlan,
  InventoryCuttingState,
  InventoryExcludedMaterial,
  InventoryNewOrder,
  InventoryRequirement,
  InventoryStockUsage,
  InventoryWorkflowStatus,
  OwnedMaterial,
  CuttingMember,
  MaterialCatalogItem,
} from '../types/domain'

function text(value: string | null | undefined) {
  return String(value || '').trim().toLocaleLowerCase('ko-KR')
}

function positive(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function nonNegative(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

const MAX_REQUIREMENT_QUANTITY = 10_000
const MAX_TOTAL_REQUIREMENT_UNITS = 50_000
const MAX_STOCK_QUANTITY = 1_000_000

function positiveInteger(value: number | null | undefined, max = MAX_REQUIREMENT_QUANTITY) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
}

function nonNegativeInteger(value: number | null | undefined) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function sameNumber(left: number | null | undefined, right: number | null | undefined) {
  return typeof left === 'number' && typeof right === 'number' && left === right
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function dateId(prefix: string, now: string, index: number) {
  return `${prefix}-${now.replace(/[^0-9]/g, '').slice(-14)}-${index}`
}

function evidenceForMember(member: CuttingMember) {
  return member.sourceReferences?.map((reference) => ({ ...reference })) || []
}

function scaleForMember(member: CuttingMember, pages: DrawingPage[]) {
  const reference = member.sourceReferences?.[0]
  if (!reference) return ''
  const page = pages.find((candidate) => candidate.pageNumber === reference.pageNumber && candidate.id.startsWith(reference.fileId))
    || pages.find((candidate) => candidate.pageNumber === reference.pageNumber)
  return page?.scales?.[0]?.ratio || ''
}

const GENERATED_REQUIREMENT_FIELDS: Array<keyof InventoryRequirement> = [
  'materialType', 'materialName', 'thicknessMm', 'widthMm', 'requiredLengthMm',
  'heightMm', 'quantity', 'surfaceFinish', 'color', 'drawingScale',
]

function requirementFingerprint(requirement: InventoryRequirement) {
  return JSON.stringify(GENERATED_REQUIREMENT_FIELDS.map((field) => {
    const value = requirement[field]
    return typeof value === 'string' ? value.trim() : value ?? null
  }))
}

export function getInventoryRequirementMissingFields(requirement: InventoryRequirement) {
  const missing: string[] = []
  if (!text(requirement.materialName)) missing.push('자재 종류')
  if (!positive(requirement.thicknessMm)) missing.push('두께')
  if (!positive(requirement.widthMm)) missing.push('폭')
  if (!positive(requirement.requiredLengthMm)) missing.push('필요 길이')
  if (!positive(requirement.heightMm)) missing.push('높이')
  if (!text(requirement.surfaceFinish)) missing.push('표면 마감')
  if (!text(requirement.color)) missing.push('색상')
  if (!text(requirement.drawingScale)) missing.push('도면 축척')
  if (!positiveInteger(requirement.quantity)) missing.push(`수량(1~${MAX_REQUIREMENT_QUANTITY.toLocaleString('ko-KR')}의 정수)`)
  return missing
}

export function normalizeInventoryRequirement(requirement: InventoryRequirement): InventoryRequirement {
  const missingFields = getInventoryRequirementMissingFields(requirement)
  return {
    ...requirement,
    materialName: requirement.materialName.trim(),
    surfaceFinish: requirement.surfaceFinish.trim(),
    color: requirement.color.trim(),
    drawingScale: requirement.drawingScale.trim(),
    missingFields,
    status: missingFields.length ? 'needs-review' : requirement.status,
  }
}

export function buildInventoryRequirementsFromMembers(
  members: CuttingMember[],
  catalog: MaterialCatalogItem[],
  pages: DrawingPage[] = [],
) {
  return members
    .filter((member) => member.materialType === 'panel')
    .map((member): InventoryRequirement => {
      const material = member.materialId ? catalog.find((candidate) => candidate.id === member.materialId) : null
      const drawingScale = scaleForMember(member, pages)
      const requirement: InventoryRequirement = {
        id: `drawing-requirement-${member.id}`,
        zone: member.zone || '구역 확인 필요',
        location: member.location || `${member.zone} · ${member.wallNumber}`,
        materialType: 'panel',
        materialName: material?.material || '',
        thicknessMm: material?.thicknessMm ?? null,
        widthMm: member.requiredWidthMm,
        requiredLengthMm: member.requiredLengthMm,
        heightMm: member.requiredHeightMm,
        quantity: member.quantity,
        surfaceFinish: material?.surfaceFinish || '',
        color: material?.color || '',
        drawingScale,
        sourceReferences: evidenceForMember(member),
        confidence: member.confidence,
        status: 'needs-review',
        confirmedAt: null,
        confirmedBy: null,
        missingFields: [],
        source: 'drawing',
        notes: [
          '도면에서 읽은 값입니다. 높이·폭·두께·표면 마감·축척을 사람이 확인하기 전에는 절단 계획에 사용하지 않습니다.',
          ...(member.notes || []),
        ],
      }
      const normalized = normalizeInventoryRequirement(requirement)
      normalized.generatedFingerprint = requirementFingerprint(normalized)
      if (!normalized.missingFields.length && member.reviewStatus === 'ready' && member.confidence === 'high') {
        // 값이 모두 추출됐더라도 자동 확정하지 않습니다. 사람이 확인 버튼을 눌러야 ready가 됩니다.
        normalized.status = 'needs-review'
      }
      return normalized
    })
}

export function mergeInventoryRequirements(
  existing: InventoryRequirement[],
  generated: InventoryRequirement[],
) {
  const existingById = new Map(existing.filter((item) => item.source === 'drawing').map((item) => [item.id, item]))
  const merged = generated.map((next) => {
    const previous = existingById.get(next.id)
    if (!previous) return next
    const nextFingerprint = next.generatedFingerprint || requirementFingerprint(next)
    const sourceChanged = previous.generatedFingerprint
      ? previous.generatedFingerprint !== nextFingerprint
      : GENERATED_REQUIREMENT_FIELDS.some((field) => {
          const previousValue = previous[field]
          const nextValue = next[field]
          const normalizedPrevious = typeof previousValue === 'string' ? previousValue.trim() : previousValue ?? null
          const normalizedNext = typeof nextValue === 'string' ? nextValue.trim() : nextValue ?? null
          return normalizedPrevious !== normalizedNext
        })
    if (sourceChanged) {
      return normalizeInventoryRequirement({
        ...next,
        status: 'needs-review',
        confirmedAt: null,
        confirmedBy: null,
        generatedFingerprint: nextFingerprint,
        notes: [...new Set([
          ...(next.notes || []),
          '도면 또는 자재 카탈로그의 원천 값이 변경되어 이전 사용자 확인을 무효화했습니다.',
        ])],
      })
    }
    const value: InventoryRequirement = {
      ...next,
      materialName: previous.materialName || next.materialName,
      thicknessMm: previous.thicknessMm ?? next.thicknessMm,
      widthMm: previous.widthMm ?? next.widthMm,
      requiredLengthMm: previous.requiredLengthMm ?? next.requiredLengthMm,
      heightMm: previous.heightMm ?? next.heightMm,
      quantity: previous.quantity || next.quantity,
      surfaceFinish: previous.surfaceFinish || next.surfaceFinish,
      color: previous.color || next.color,
      drawingScale: previous.drawingScale || next.drawingScale,
      generatedFingerprint: nextFingerprint,
      status: previous.status,
      confirmedAt: previous.confirmedAt,
      confirmedBy: previous.confirmedBy,
      notes: [...new Set([...(next.notes || []), ...(previous.notes || [])])],
    }
    return normalizeInventoryRequirement(value)
  })
  return [
    ...existing.filter((item) => item.source === 'manual'),
    ...merged,
  ]
}

function defaultSampleEvidence(): Evidence[] {
  return [{
    fileId: 'sample-inventory',
    fileName: '보유 자재 기반 절단 계획 MVP 예제',
    pageNumber: 1,
    drawingKind: 'floor-plan',
    method: 'user',
    rawText: '사용자 제공 기본 예제',
    note: '실제 도면을 수정하지 않는 계산 흐름 확인용 예제입니다.',
  }]
}

export function createInventorySampleData(now = new Date().toISOString()): InventoryCuttingState {
  const evidence = defaultSampleEvidence()
  const sampleRequirement = (id: string, lengthMm: number, unit: number): InventoryRequirement => ({
    id,
    zone: '예제 구역 A',
    location: `외벽 A-${String(unit).padStart(2, '0')}`,
    materialType: 'panel',
    materialName: '50T 샌드위치패널',
    thicknessMm: 50,
    widthMm: 1200,
    requiredLengthMm: lengthMm,
    heightMm: 1200,
    quantity: 1,
    surfaceFinish: '평판 도장',
    color: '아이보리',
    drawingScale: '1:50',
    sourceReferences: evidence,
    confidence: 'high',
    status: 'ready',
    confirmedAt: now,
    confirmedBy: 'MVP 기본 예제',
    missingFields: [],
    source: 'sample',
    notes: ['기본 예제 데이터입니다. 실제 도면·현장 재고로 바꾸기 전 계산 결과를 발주에 사용하지 마세요.'],
  })
  const owned = (id: string, lengthMm: number, quantity: number): OwnedMaterial => ({
    id,
    materialType: 'panel',
    materialName: '50T 샌드위치패널',
    thicknessMm: 50,
    widthMm: 1200,
    lengthMm,
    surfaceFinish: '평판 도장',
    color: '아이보리',
    quantity,
    reservedQuantity: 0,
    source: 'new',
    usable: true,
    location: '예제 현장 자재장',
    addedAt: now,
    note: 'MVP 기본 예제 보유 자재',
  })
  return {
    settings: {
      kerfMm: 5,
      minimumCutAllowanceMm: 0,
      minimumReusableOffcutMm: 100,
      baselineStockLengthMm: 3000,
    },
    requirements: [
      sampleRequirement('sample-requirement-2750-1', 2750, 1),
      sampleRequirement('sample-requirement-2750-2', 2750, 2),
      sampleRequirement('sample-requirement-1200', 1200, 3),
    ],
    ownedMaterials: [owned('sample-stock-3000', 3000, 2), owned('sample-stock-2800', 2800, 1)],
    plan: null,
    status: 'not-ready',
    missingFields: [],
    lastCalculatedAt: null,
  }
}

function specificationReasons(stock: OwnedMaterial, requirement: InventoryRequirement) {
  const reasons: string[] = []
  if (stock.materialType !== requirement.materialType) reasons.push('자재 종류가 다름')
  if (text(stock.materialName) !== text(requirement.materialName)) reasons.push('자재 이름이 다름')
  if (!sameNumber(stock.thicknessMm, requirement.thicknessMm)) reasons.push('두께가 다름')
  if (!sameNumber(stock.widthMm, requirement.widthMm)) reasons.push('폭이 다름')
  if (text(stock.surfaceFinish) !== text(requirement.surfaceFinish)) reasons.push('표면 마감이 다름')
  if (text(stock.color) !== text(requirement.color)) reasons.push('색상이 다름')
  return reasons
}

function pieceLengthFor(requirement: InventoryRequirement, allowanceMm: number) {
  return (requirement.requiredLengthMm || 0) + allowanceMm
}

function sameLength(left: number, right: number) {
  return Math.abs(left - right) <= 0.001
}

function canCutFromLength(stockLengthMm: number, requirement: InventoryRequirement, kerfMm: number, allowanceMm: number) {
  const pieceLengthMm = pieceLengthFor(requirement, allowanceMm)
  return sameLength(stockLengthMm, pieceLengthMm) || stockLengthMm >= pieceLengthMm + kerfMm
}

function consumedLengthFor(stockLengthMm: number, requirement: InventoryRequirement, kerfMm: number, allowanceMm: number) {
  const pieceLengthMm = pieceLengthFor(requirement, allowanceMm)
  return sameLength(stockLengthMm, pieceLengthMm) ? pieceLengthMm : pieceLengthMm + kerfMm
}

function materialCanMatch(stock: OwnedMaterial, requirement: InventoryRequirement) {
  return specificationReasons(stock, requirement).length === 0
}

function stockLabel(stock: OwnedMaterial) {
  const size = [stock.lengthMm ? `${stock.lengthMm.toLocaleString('ko-KR')}mm` : '길이 확인 필요', stock.widthMm ? `${stock.widthMm.toLocaleString('ko-KR')}mm 폭` : '폭 확인 필요'].join(' × ')
  return `${stock.materialName || '자재 종류 확인 필요'} · ${stock.thicknessMm || '두께 확인 필요'}T · ${size}`
}

function buildExcludedMaterials(
  ownedMaterials: OwnedMaterial[],
  requirements: InventoryRequirement[],
  kerfMm: number,
  allowanceMm: number,
) {
  return ownedMaterials.map((stock): InventoryExcludedMaterial | null => {
    const reasons: string[] = []
    const available = Math.max(0, stock.quantity - stock.reservedQuantity)
    if (!stock.usable) reasons.push('사용 가능 여부가 해제됨')
    if (available <= 0) reasons.push('예약 가능한 수량이 없음')
    if (!positive(stock.lengthMm)) reasons.push('보유 길이 확인 필요')
    if (!positive(stock.widthMm)) reasons.push('보유 폭 확인 필요')
    const readyRequirements = requirements.filter((requirement) => requirement.status === 'ready')
    if (!readyRequirements.length) reasons.push('필요 조각 확인 전')
    else if (!readyRequirements.some((requirement) => materialCanMatch(stock, requirement))) {
      const first = readyRequirements[0]
      reasons.push(...specificationReasons(stock, first))
    } else if (!readyRequirements.some((requirement) => materialCanMatch(stock, requirement) && stock.lengthMm !== null && canCutFromLength(stock.lengthMm, requirement, kerfMm, allowanceMm))) {
      reasons.push('필요 조각보다 보유 길이가 짧음')
    }
    if (!reasons.length) return null
    return {
      ownedMaterialId: stock.id,
      label: stockLabel(stock),
      reasons: [...new Set(reasons)],
    }
  }).filter((item): item is InventoryExcludedMaterial => Boolean(item))
}

function createUsage(stock: OwnedMaterial, unitIndex: number): InventoryStockUsage {
  return {
    id: `inventory-usage-${stock.id}-${unitIndex}`,
    ownedMaterialId: stock.id,
    unitIndex,
    source: stock.source,
    materialName: stock.materialName,
    thicknessMm: stock.thicknessMm as number,
    widthMm: stock.widthMm as number,
    lengthMm: stock.lengthMm as number,
    surfaceFinish: stock.surfaceFinish,
    color: stock.color,
    cuts: [],
    usedLengthMm: 0,
    remainingLengthMm: stock.lengthMm as number,
    reusableRemainingLengthMm: 0,
    wasteRemainingLengthMm: 0,
  }
}

function updateUsageRemainder(usage: InventoryStockUsage, minimumReusableOffcutMm: number) {
  usage.reusableRemainingLengthMm = usage.remainingLengthMm >= minimumReusableOffcutMm ? usage.remainingLengthMm : 0
  usage.wasteRemainingLengthMm = usage.remainingLengthMm < minimumReusableOffcutMm ? usage.remainingLengthMm : 0
}

function appendCut(
  usage: InventoryStockUsage,
  requirement: InventoryRequirement,
  requirementUnit: number,
  cutOrder: number,
  kerfMm: number,
  allowanceMm: number,
) {
  const before = usage.remainingLengthMm
  const pieceLengthMm = pieceLengthFor(requirement, allowanceMm)
  const appliedKerfMm = sameLength(before, pieceLengthMm) ? 0 : kerfMm
  const actualUsedLengthMm = consumedLengthFor(before, requirement, kerfMm, allowanceMm)
  const remainingLengthMm = round(Math.max(0, before - actualUsedLengthMm))
  const cut: InventoryCut = {
    id: `inventory-cut-${usage.id}-${cutOrder}`,
    requirementId: requirement.id,
    requirementUnit,
    zone: requirement.zone,
    location: requirement.location,
    cutOrder,
    requiredLengthMm: requirement.requiredLengthMm as number,
    kerfMm: appliedKerfMm,
    actualUsedLengthMm,
    stockLengthBeforeMm: before,
    remainingLengthMm,
  }
  usage.cuts.push(cut)
  usage.usedLengthMm = round(usage.usedLengthMm + actualUsedLengthMm)
  usage.remainingLengthMm = remainingLengthMm
  updateUsageRemainder(usage, 0)
  return cut
}

function finalizeUsages(usages: InventoryStockUsage[], minimumReusableOffcutMm: number) {
  for (const usage of usages) updateUsageRemainder(usage, minimumReusableOffcutMm)
}

export interface InventoryCalculationResult {
  status: InventoryWorkflowStatus
  plan: InventoryCutPlan | null
  missingFields: string[]
  excludedMaterials: InventoryExcludedMaterial[]
}

export function calculateInventoryCutPlan(input: {
  requirements: InventoryRequirement[]
  ownedMaterials: OwnedMaterial[]
  settings: InventoryCuttingState['settings']
  now?: string
}): InventoryCalculationResult {
  const now = input.now || new Date().toISOString()
  const requirements = input.requirements.map(normalizeInventoryRequirement)
  const missingFields: string[] = []
  if (!nonNegative(input.settings.kerfMm)) missingFields.push('톱날 절단폭')
  if (!nonNegative(input.settings.minimumCutAllowanceMm)) missingFields.push('최소 절단 여유')
  if (!positive(input.settings.minimumReusableOffcutMm)) missingFields.push('재사용 최소 잔량')
  for (const requirement of requirements) {
    const missing = getInventoryRequirementMissingFields(requirement)
    if (requirement.status !== 'ready') missing.push('사용자 확인')
    if (missing.length) missingFields.push(`${requirement.zone} · ${requirement.location}: ${[...new Set(missing)].join(', ')}`)
  }
  if (!requirements.length) missingFields.push('필요 조각 목록')
  if (!input.ownedMaterials.length) missingFields.push('보유 자재')
  for (const stock of input.ownedMaterials) {
    const label = stock.materialName || stock.id
    if (!positiveInteger(stock.quantity, MAX_STOCK_QUANTITY)) missingFields.push(`${label}: 보유 수량(1~${MAX_STOCK_QUANTITY.toLocaleString('ko-KR')}의 정수)`)
    if (!nonNegativeInteger(stock.reservedQuantity)) missingFields.push(`${label}: 예약 수량(0 이상의 정수)`)
    if (nonNegativeInteger(stock.reservedQuantity) && positiveInteger(stock.quantity, MAX_STOCK_QUANTITY) && stock.reservedQuantity > stock.quantity) {
      missingFields.push(`${label}: 예약 수량이 보유 수량보다 큼`)
    }
  }
  const kerfMm = input.settings.kerfMm ?? 0
  const allowanceMm = input.settings.minimumCutAllowanceMm ?? 0
  const minimumReusableOffcutMm = input.settings.minimumReusableOffcutMm ?? 0
  const excludedMaterials = buildExcludedMaterials(input.ownedMaterials, requirements, kerfMm, allowanceMm)
  const totalRequirementUnits = requirements.reduce((sum, requirement) => sum + (Number.isInteger(requirement.quantity) && requirement.quantity > 0 ? requirement.quantity : 0), 0)
  if (totalRequirementUnits > MAX_TOTAL_REQUIREMENT_UNITS) {
    missingFields.push(`전체 필요 조각 수는 ${MAX_TOTAL_REQUIREMENT_UNITS.toLocaleString('ko-KR')}개 이하여야 합니다.`)
  }
  if (missingFields.length) {
    return { status: 'needs-review', plan: null, missingFields: [...new Set(missingFields)], excludedMaterials }
  }

  const units = requirements.flatMap((requirement) => Array.from({ length: requirement.quantity }, (_, index) => ({ requirement, unit: index + 1 })))
    .sort((left, right) => (right.requirement.requiredLengthMm as number) - (left.requirement.requiredLengthMm as number))
  const usages: InventoryStockUsage[] = []
  const usageByStock = new Map<string, InventoryStockUsage[]>()
  const usedUnitsByStock = new Map<string, number>()
  const newOrderGroups = new Map<string, InventoryNewOrder>()
  let cutOrder = 0

  const stockCandidates = (requirement: InventoryRequirement) => input.ownedMaterials
    .filter((stock) => stock.usable && materialCanMatch(stock, requirement) && positive(stock.lengthMm) && positive(stock.widthMm))
    .filter((stock) => Math.max(0, stock.quantity - stock.reservedQuantity) > 0)
    .sort((left, right) => {
      const source = (left.source === 'scrap' ? 0 : 1) - (right.source === 'scrap' ? 0 : 1)
      if (source) return source
      return (left.lengthMm as number) - (right.lengthMm as number)
    })

  for (const item of units) {
    const requirement = item.requirement
    let selectedUsage: InventoryStockUsage | null = null
    for (const stock of stockCandidates(requirement)) {
      const existingUsages = usageByStock.get(stock.id) || []
      const reusableUsage = existingUsages
        .filter((usage) => canCutFromLength(usage.remainingLengthMm, requirement, kerfMm, allowanceMm))
        .sort((left, right) => left.remainingLengthMm - right.remainingLengthMm)[0]
      if (reusableUsage) {
        selectedUsage = reusableUsage
        break
      }
      if (!canCutFromLength(stock.lengthMm as number, requirement, kerfMm, allowanceMm)) continue
      const usedUnits = usedUnitsByStock.get(stock.id) || 0
      if (usedUnits < Math.max(0, stock.quantity - stock.reservedQuantity)) {
        selectedUsage = createUsage(stock, stock.reservedQuantity + usedUnits + 1)
        usages.push(selectedUsage)
        usageByStock.set(stock.id, [...existingUsages, selectedUsage])
        usedUnitsByStock.set(stock.id, usedUnits + 1)
        break
      }
    }
    if (selectedUsage) {
      appendCut(selectedUsage, requirement, item.unit, ++cutOrder, kerfMm, allowanceMm)
      continue
    }
    const orderLengthMm = pieceLengthFor(requirement, allowanceMm)
    const key = [requirement.materialType, text(requirement.materialName), requirement.thicknessMm, requirement.widthMm, text(requirement.surfaceFinish), text(requirement.color), orderLengthMm].join('|')
    const existingOrder = newOrderGroups.get(key)
    if (existingOrder) {
      existingOrder.quantity += 1
      existingOrder.requirementIds.push(requirement.id)
    } else {
      newOrderGroups.set(key, {
        id: `inventory-order-${newOrderGroups.size + 1}`,
        materialType: requirement.materialType,
        materialName: requirement.materialName,
        thicknessMm: requirement.thicknessMm as number,
        widthMm: requirement.widthMm as number,
        lengthMm: orderLengthMm,
        surfaceFinish: requirement.surfaceFinish,
        color: requirement.color,
        quantity: 1,
        requirementIds: [requirement.id],
        reason: '동일 자재·두께·폭·표면 마감·색상과 길이를 만족하는 보유 자재가 부족합니다.',
      })
    }
  }

  finalizeUsages(usages, minimumReusableOffcutMm)
  const newOrders = [...newOrderGroups.values()]
  const requiredPieceCount = units.length
  const ownedPieceCount = usages.reduce((sum, usage) => sum + (usage.cuts.length ? 1 : 0), 0)
  const newOrderPieceCount = newOrders.reduce((sum, order) => sum + order.quantity, 0)
  const baselineStockLengthMm = input.settings.baselineStockLengthMm && input.settings.baselineStockLengthMm > 0
    ? input.settings.baselineStockLengthMm
    : null
  const baselineOrderPieceCount = baselineStockLengthMm === null ? null : requiredPieceCount
  const plannedWasteLengthMm = round(usages.reduce((sum, usage) => sum + usage.wasteRemainingLengthMm, 0))
  const reusableLengthMm = round(usages.reduce((sum, usage) => sum + usage.reusableRemainingLengthMm, 0))
  const baselineWasteLengthMm = baselineStockLengthMm !== null
    ? round(Math.max(0, (baselineOrderPieceCount || 0) * baselineStockLengthMm - units.reduce((sum, item) => sum + (item.requirement.requiredLengthMm as number), 0)))
    : null
  const plan: InventoryCutPlan = {
    id: dateId('inventory-plan', now, 1),
    createdAt: now,
    status: 'calculated',
    usages,
    newOrders,
    excludedMaterials,
    requiredPieceCount,
    ownedPieceCount,
    newOrderPieceCount,
    baselineOrderPieceCount,
    orderReductionPieceCount: baselineOrderPieceCount === null ? null : Math.max(0, baselineOrderPieceCount - newOrderPieceCount),
    plannedWasteLengthMm,
    reusableLengthMm,
    baselineWasteLengthMm,
    wasteReductionLengthMm: baselineWasteLengthMm === null ? null : round(baselineWasteLengthMm - plannedWasteLengthMm),
    approvedAt: null,
    cancelledAt: null,
    sourceFingerprint: null,
  }
  return { status: 'calculated', plan, missingFields: [], excludedMaterials }
}

export function approveInventoryCutPlan(
  plan: InventoryCutPlan,
  ownedMaterials: OwnedMaterial[],
  now = new Date().toISOString(),
) {
  if (plan.status !== 'calculated') return { ok: false, message: '계산 완료 상태의 계획만 승인할 수 있습니다.', plan, ownedMaterials }
  const usageCounts = new Map<string, number>()
  for (const usage of plan.usages) usageCounts.set(usage.ownedMaterialId, (usageCounts.get(usage.ownedMaterialId) || 0) + 1)
  for (const [ownedMaterialId, count] of usageCounts) {
    const stock = ownedMaterials.find((item) => item.id === ownedMaterialId)
    if (!stock || stock.quantity - stock.reservedQuantity < count) {
      return { ok: false, message: '계산 이후 보유 자재 수량이 변경되었습니다. 다시 계산하세요.', plan, ownedMaterials }
    }
  }
  const nextOwnedMaterials = ownedMaterials.map((stock) => ({
    ...stock,
    reservedQuantity: stock.reservedQuantity + (usageCounts.get(stock.id) || 0),
  }))
  return {
    ok: true,
    message: '보유 자재를 예약 처리했습니다. 실제 수량은 예약 수량으로만 반영했습니다.',
    plan: { ...plan, status: 'approved' as const, approvedAt: now },
    ownedMaterials: nextOwnedMaterials,
  }
}

export function cancelInventoryCutPlan(plan: InventoryCutPlan, now = new Date().toISOString()) {
  if (plan.status !== 'calculated') return plan
  return { ...plan, status: 'cancelled' as const, cancelledAt: now }
}

export function releaseInventoryCutPlanReservation(
  plan: InventoryCutPlan,
  ownedMaterials: OwnedMaterial[],
  now = new Date().toISOString(),
) {
  if (plan.status !== 'approved') {
    return { ok: false, message: '승인되어 예약된 계획만 예약 해제할 수 있습니다.', plan, ownedMaterials }
  }
  const usageCounts = new Map<string, number>()
  for (const usage of plan.usages) {
    usageCounts.set(usage.ownedMaterialId, (usageCounts.get(usage.ownedMaterialId) || 0) + 1)
  }
  for (const [ownedMaterialId, count] of usageCounts) {
    const stock = ownedMaterials.find((item) => item.id === ownedMaterialId)
    if (!stock || stock.reservedQuantity < count) {
      return {
        ok: false,
        message: '승인 이후 예약 수량이 변경되어 자동으로 해제할 수 없습니다. 재고 이력을 확인하세요.',
        plan,
        ownedMaterials,
      }
    }
  }
  const nextOwnedMaterials = ownedMaterials.map((stock) => ({
    ...stock,
    reservedQuantity: Math.max(0, stock.reservedQuantity - (usageCounts.get(stock.id) || 0)),
  }))
  return {
    ok: true,
    message: '승인된 계획을 취소하고 보유 자재 예약을 해제했습니다.',
    plan: { ...plan, status: 'cancelled' as const, cancelledAt: now },
    ownedMaterials: nextOwnedMaterials,
  }
}
