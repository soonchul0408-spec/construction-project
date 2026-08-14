import assert from 'node:assert/strict'

import { validateConsistency } from '../src/modules/consistency-validator.ts'
import { optimizeCuttingPlan } from '../src/modules/cutting-optimization-engine.ts'
import { inventoryCutPlanToCsv, inventoryOrderToCsv, optimizationOrderToCsv, takeoffsToCsv } from '../src/modules/export-report.ts'
import {
  approveInventoryCutPlan,
  calculateInventoryCutPlan,
  createInventorySampleData,
  mergeInventoryRequirements,
  releaseInventoryCutPlanReservation,
} from '../src/modules/inventory-cutting-engine.ts'
import { shouldRunTileOcr } from '../src/modules/ocr-policy.ts'
import { emptyOptimizationState } from '../src/types/domain.ts'
import type {
  AnalyzedFile,
  BuildingGeometry,
  CuttingMember,
  DimensionValue,
  Evidence,
  MaterialCatalogItem,
  MaterialTakeoff,
  Wall,
} from '../src/types/domain.ts'

const now = '2026-08-14T00:00:00.000Z'

assert.equal(shouldRunTileOcr('벽체 높이', [{ text: '높이', confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }]), true, '높이 숫자가 없으면 분할 OCR을 다시 실행해야 합니다.')
assert.equal(shouldRunTileOcr('벽체 높이 H=3000', [{ text: 'H=3000', confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }]), false, '높이 표기와 숫자가 모두 있으면 불필요한 분할 OCR을 반복하면 안 됩니다.')
assert.equal(shouldRunTileOcr('MODEL NO 1234', [{ text: 'MODEL', confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }]), true, 'MODEL 안의 EL을 레벨 표기로 오인하면 안 됩니다.')
assert.equal(shouldRunTileOcr('높이 미정 / 도면번호 1234', [{ text: '도면번호', confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }]), true, '높이 표기와 무관한 숫자를 완전한 높이 인식으로 처리하면 안 됩니다.')

function catalog(id: string, overrides: Partial<MaterialCatalogItem> = {}): MaterialCatalogItem {
  return {
    id,
    name: `시험 자재 ${id}`,
    materialType: 'panel',
    material: `시험 재질 ${id}`,
    thicknessMm: 50,
    stockWidthMm: 2000,
    stockLengthMm: 2000,
    stockLengthOptionsMm: [],
    unit: 'sheet',
    unitLabel: '장',
    unitPrice: 1000,
    minimumOrderQuantity: 1,
    cuttingFee: 10,
    cutCostPerCut: 2,
    kerfMm: 0,
    transportCost: 10,
    handlingCost: 10,
    disposalCostPerM2: 10,
    disposalCostPerM: null,
    temporaryStorageCostPerDay: 5,
    rotatable: false,
    grainDirection: 'fixed',
    lapAllowanceMm: 0,
    minimumReusableOffcutMm: 100,
    reworkRiskCost: 50,
    source: 'user',
    updatedAt: now,
    ...overrides,
  }
}

function member(id: string, materialId: string, quantity = 1, lengthMm = 1000, widthMm = 1000): CuttingMember {
  return {
    id,
    sourceWallId: null,
    zone: '시험 구역',
    location: `시험 구역 · ${id}`,
    wallNumber: id,
    requiredLengthMm: lengthMm,
    requiredWidthMm: widthMm,
    requiredHeightMm: widthMm,
    quantity,
    materialType: 'panel',
    materialId,
    materialSpec: '시험 규격',
    shape: 'rectangle',
    cuttingRequired: true,
    openingIds: [],
    installOrder: 1,
    plannedInstallAt: null,
    sourceReferences: [],
    confidence: 'high',
    reviewStatus: 'ready',
    notes: [],
  }
}

const materialA = catalog('material-a')
const materialB = catalog('material-b', { stockWidthMm: 1000, stockLengthMm: 1500 })
const multiMaterial = optimizeCuttingPlan({
  walls: [],
  members: [member('A', materialA.id, 2), member('B', materialB.id)],
  catalog: [materialA, materialB],
  now,
})
const multiCost = multiMaterial.scenarios.find((scenario) => scenario.id === 'cost')
assert.equal(multiMaterial.scenarios.length, 3, '복수 자재도 목적별 통합 시나리오 3개여야 합니다.')
assert.deepEqual(new Set(multiCost?.stockPlans.map((plan) => plan.materialId)), new Set([materialA.id, materialB.id]))
assert.equal(multiCost?.stockPlans.flatMap((plan) => plan.placements).filter((placement) => placement.memberId === 'A').length, 2)
assert.equal(multiCost?.validation.passed, true, '복수 자재의 모든 필요 수량이 한 시나리오에서 검증되어야 합니다.')
assert.equal(multiMaterial.status, 'calculated')

const twoDimensionalCut = optimizeCuttingPlan({
  walls: [],
  members: [member('CUT-2D', materialA.id)],
  catalog: [materialA],
  now,
}).scenarios.find((scenario) => scenario.id === 'cost')
assert.equal(twoDimensionalCut?.cutCount, 2, '길이와 폭을 모두 줄이는 판재는 직교 절단 2회로 계산해야 합니다.')

const panelKerfMaterial = catalog('panel-kerf', {
  stockLengthMm: 1000,
  stockWidthMm: 1000,
  kerfMm: 5,
})
const insufficientEdgeKerf = optimizeCuttingPlan({
  walls: [],
  members: [member('PANEL-KERF-FAIL', panelKerfMaterial.id, 1, 999, 1000)],
  catalog: [panelKerfMaterial],
  now,
})
assert.equal(insufficientEdgeKerf.status, 'needs-review', '원자재 가장자리 잔량이 절단폭보다 작으면 확정 계획으로 만들면 안 됩니다.')
assert.ok(insufficientEdgeKerf.validation.memberAssignmentErrors.some((message) => message.includes('PANEL-KERF-FAIL')))
const exactPanelKerf = optimizeCuttingPlan({
  walls: [],
  members: [member('PANEL-KERF-PASS', panelKerfMaterial.id, 1, 995, 1000)],
  catalog: [panelKerfMaterial],
  now,
}).scenarios.find((scenario) => scenario.id === 'cost')
assert.equal(exactPanelKerf?.validation.passed, true, '필요 치수와 절단폭의 합이 원자재와 같으면 배치할 수 있어야 합니다.')
assert.equal(exactPanelKerf?.stockCount, 1)

const profileMaterial = catalog('profile-material', {
  materialType: 'profile',
  stockLengthMm: 1000,
  stockWidthMm: 50,
  kerfMm: 5,
  unit: 'bar',
  unitLabel: '본',
  disposalCostPerM: 10,
})
const profileMembers: CuttingMember[] = [400, 595].map((lengthMm, index) => ({
  ...member(`PROFILE-${index + 1}`, profileMaterial.id, 1, lengthMm, 1),
  materialType: 'profile' as const,
  requiredWidthMm: null,
  requiredHeightMm: null,
}))
const exactKerfProfile = optimizeCuttingPlan({ walls: [], members: profileMembers, catalog: [profileMaterial], now })
  .scenarios.find((scenario) => scenario.id === 'cost')
assert.equal(exactKerfProfile?.stockCount, 1, '프로파일 잔량에서 톱날 폭을 두 번 빼 과다 발주하면 안 됩니다.')

const panelOrderMaterial = catalog('panel-order-export', {
  stockLengthMm: 3000,
  stockLengthOptionsMm: [2500],
  stockWidthMm: 1200,
  minimumOrderQuantity: 3,
})
const panelOrderScenario = optimizeCuttingPlan({
  walls: [],
  members: [member('PANEL-ORDER', panelOrderMaterial.id, 2, 2400, 1000)],
  catalog: [panelOrderMaterial],
  now,
}).scenarios.find((scenario) => scenario.id === 'cost')
assert.ok(panelOrderScenario)
assert.ok(panelOrderScenario.stockPlans.filter((plan) => plan.source === 'raw-material').every((plan) => plan.stockLengthMm === 2500))
const panelOrderCsv = optimizationOrderToCsv(panelOrderScenario, [panelOrderMaterial])
const panelOrderLine = panelOrderCsv.split('\n').find((line) => line.includes(`"${panelOrderMaterial.name}"`))
assert.ok(panelOrderLine?.includes('"2500 × 1200mm","3","1000","3000","20"'), '판재 발주 행은 카탈로그 기본값이 아니라 실제 선택된 규격·MOQ 수량·비용을 사용해야 합니다.')
assert.equal(panelOrderLine?.includes('3000 × 1200mm'), false, '선택되지 않은 판재 기본 규격을 발주 행에 출력하면 안 됩니다.')

const mixedPanelPlans = panelOrderScenario.stockPlans.map((plan, index) => (
  plan.source === 'raw-material' && index === panelOrderScenario.stockPlans.length - 1
    ? { ...plan, stockLengthMm: 3000 }
    : plan
))
const mixedPanelCsv = optimizationOrderToCsv({ ...panelOrderScenario, stockPlans: mixedPanelPlans }, [panelOrderMaterial])
const mixedPanelLines = mixedPanelCsv.split('\n').filter((line) => line.includes(`"${panelOrderMaterial.name}"`))
assert.equal(mixedPanelLines.length, 2, '같은 자재라도 실제 원자재 길이가 다르면 발주 행을 규격별로 분리해야 합니다.')
assert.ok(mixedPanelLines.some((line) => line.includes('"2500 × 1200mm","2","1000","2000","10"')))
assert.ok(mixedPanelLines.some((line) => line.includes('"3000 × 1200mm","1","1000","1000","10"')))

const profileOrderMaterial = catalog('profile-order-export', {
  materialType: 'profile',
  stockLengthMm: 2000,
  stockLengthOptionsMm: [1500],
  stockWidthMm: 50,
  unit: 'bar',
  unitLabel: '본',
  disposalCostPerM: 10,
})
const profileOrderScenario = optimizeCuttingPlan({
  walls: [],
  members: [{
    ...member('PROFILE-ORDER', profileOrderMaterial.id, 2, 1400, 1),
    materialType: 'profile' as const,
    requiredWidthMm: null,
    requiredHeightMm: null,
  }],
  catalog: [profileOrderMaterial],
  now,
}).scenarios.find((scenario) => scenario.id === 'cost')
assert.ok(profileOrderScenario)
const profileOrderCsv = optimizationOrderToCsv(profileOrderScenario, [profileOrderMaterial])
const profileOrderLine = profileOrderCsv.split('\n').find((line) => line.includes(`"${profileOrderMaterial.name}"`))
assert.ok(profileOrderLine?.includes('"1500mm","2","1000","2000","20"'), '프로파일 발주 행도 실제 선택된 길이와 수량·비용만 출력해야 합니다.')
assert.equal(profileOrderLine?.includes('2000 · 1500mm'), false, '선택되지 않은 프로파일 후보 길이를 실제 발주 규격처럼 함께 출력하면 안 됩니다.')

const invalidQuantity = optimizeCuttingPlan({
  walls: [],
  members: [member('FRACTIONAL', materialA.id, 1.5)],
  catalog: [materialA],
  now,
})
assert.equal(invalidQuantity.status, 'needs-review')
assert.ok(invalidQuantity.validation.unitErrors.some((message) => message.includes('정수')))
const excessiveQuantity = optimizeCuttingPlan({
  walls: [],
  members: [member('EXCESSIVE', materialA.id, 1_000_000_000)],
  catalog: [materialA],
  now,
})
assert.equal(excessiveQuantity.status, 'needs-review')
assert.ok(excessiveQuantity.reviews.some((review) => review.id === 'member-quantity-total-limit'))

const invalidCatalog = catalog('invalid-catalog', { unitPrice: -1, minimumOrderQuantity: 1.5 })
const invalidCatalogPlan = optimizeCuttingPlan({
  walls: [],
  members: [member('INVALID-CATALOG-MEMBER', invalidCatalog.id)],
  catalog: [invalidCatalog],
  now,
})
assert.equal(invalidCatalogPlan.status, 'needs-review')
assert.ok(invalidCatalogPlan.reviews.some((review) => review.id.includes('unitPrice')))
assert.ok(invalidCatalogPlan.reviews.some((review) => review.id.includes('minimumOrderQuantity')))

const ambiguousLengthPricePlan = optimizeCuttingPlan({
  walls: [],
  members: [member('AMBIGUOUS-LENGTH-PRICE', materialA.id)],
  catalog: [{ ...materialA, stockLengthOptionsMm: [3000] }],
  now,
})
assert.equal(ambiguousLengthPricePlan.status, 'needs-review')
assert.ok(ambiguousLengthPricePlan.reviews.some((review) => review.id === `catalog-length-price-${materialA.id}`))

const mismatchedProfileCatalog = catalog('profile-mismatch', {
  materialType: 'profile',
  stockLengthMm: 2000,
  stockWidthMm: 50,
  unit: 'bar',
  unitLabel: '본',
  disposalCostPerM: 10,
})
const mismatchedMaterialPlan = optimizeCuttingPlan({
  walls: [],
  members: [member('PANEL-AS-PROFILE', mismatchedProfileCatalog.id)],
  catalog: [mismatchedProfileCatalog],
  now,
})
assert.equal(mismatchedMaterialPlan.status, 'needs-review')
assert.equal(mismatchedMaterialPlan.validation.passed, false)
assert.ok(mismatchedMaterialPlan.reviews.some((review) => review.id === 'material-type-PANEL-AS-PROFILE'))
assert.equal(mismatchedMaterialPlan.scenarios[0]?.stockPlans.length, 0)

const existingScrap = {
  id: 'existing-scrap',
  source: 'existing' as const,
  sourceStockPlanId: null,
  materialId: materialA.id,
  material: materialA.material,
  thicknessMm: materialA.thicknessMm,
  widthMm: 1000,
  lengthMm: 1000,
  xMm: null,
  yMm: null,
  currentLocation: '자재장',
  originZone: '시험 구역',
  usableZones: ['시험 구역'],
  plannedUseMemberId: 'SCRAP-MEMBER',
  generatedAt: now,
  plannedUseAt: now,
  storageDays: null,
  temporaryStorageCost: null,
  available: true,
  status: 'reuse-planned' as const,
  disposalCategory: null,
  note: '',
}
const scrapMember = member('SCRAP-MEMBER', materialA.id)
const scrapOptimization = optimizeCuttingPlan({
  walls: [],
  members: [scrapMember],
  catalog: [materialA],
  existingScraps: [existingScrap],
  now,
})
const selectedScrapScenario = scrapOptimization.scenarios.find((scenario) => scenario.id === scrapOptimization.selectedScenarioId)
assert.equal(selectedScrapScenario?.scraps.find((scrap) => scrap.id === existingScrap.id)?.available, false, '시나리오에는 기존 자투리가 이번 계산에서 소비된 상태로 기록되어야 합니다.')
assert.equal(scrapOptimization.scraps.find((scrap) => scrap.id === existingScrap.id)?.available, true, '다음 계산 입력으로 저장하는 기존 자투리 원본은 소비 상태로 덮어쓰면 안 됩니다.')

function assertScrapRejected(
  message: string,
  currentMaterial: MaterialCatalogItem,
  targetMember: CuttingMember,
  staleScrap: typeof existingScrap,
) {
  const result = optimizeCuttingPlan({
    walls: [],
    members: [targetMember],
    catalog: [currentMaterial],
    existingScraps: [staleScrap],
    now,
  })
  const scenario = result.scenarios.find((candidate) => candidate.id === 'cost')
  assert.equal(scenario?.stockPlans.filter((plan) => plan.source === 'onsite-scrap').length, 0, message)
  assert.equal(scenario?.stockPlans.filter((plan) => plan.source === 'raw-material').length, 1, `${message} 호환되지 않는 자투리 대신 신규 원자재를 배정해야 합니다.`)
  assert.equal(scenario?.scraps.find((scrap) => scrap.id === staleScrap.id)?.status, 'reuse-unavailable', `${message} 해당 자투리를 사용 불가 상태로 표시해야 합니다.`)
}

assertScrapRejected(
  '같은 카탈로그 ID라도 재질명이 바뀌면 이전 자투리를 재사용하면 안 됩니다.',
  { ...materialA, material: '변경된 시험 재질' },
  scrapMember,
  { ...existingScrap, id: 'stale-material-scrap' },
)
assertScrapRejected(
  '같은 카탈로그 ID라도 두께가 바뀌면 이전 자투리를 재사용하면 안 됩니다.',
  { ...materialA, thicknessMm: (materialA.thicknessMm || 0) + 25 },
  scrapMember,
  { ...existingScrap, id: 'stale-thickness-scrap' },
)
assertScrapRejected(
  '필요 폭보다 좁은 판재 자투리를 길이만 보고 재사용하면 안 됩니다.',
  materialA,
  scrapMember,
  { ...existingScrap, id: 'narrow-panel-scrap', widthMm: 999, lengthMm: 2000 },
)
const irregularScrapMember = { ...scrapMember, id: 'IRREGULAR-SCRAP-MEMBER', shape: 'irregular' as const }
assertScrapRejected(
  '지원하지 않는 불규칙 형상을 직사각형 자투리에 자동 배정하면 안 됩니다.',
  materialA,
  irregularScrapMember,
  { ...existingScrap, id: 'irregular-member-scrap', plannedUseMemberId: irregularScrapMember.id },
)

const repeatedScrapOptimization = optimizeCuttingPlan({
  walls: [],
  members: [scrapMember],
  catalog: [materialA],
  existingScraps: scrapOptimization.scraps.filter((scrap) => scrap.source === 'existing'),
  now,
})
const repeatedScrapScenario = repeatedScrapOptimization.scenarios.find((scenario) => scenario.id === repeatedScrapOptimization.selectedScenarioId)
assert.equal(selectedScrapScenario?.stockPlans.filter((plan) => plan.source === 'onsite-scrap').length, 1)
assert.equal(repeatedScrapScenario?.stockPlans.filter((plan) => plan.source === 'onsite-scrap').length, 1, '저장된 동일 입력으로 재계산해도 기존 자투리를 다시 배정해야 합니다.')
assert.equal(repeatedScrapScenario?.stockPlans.filter((plan) => plan.source === 'raw-material').length, selectedScrapScenario?.stockPlans.filter((plan) => plan.source === 'raw-material').length, '동일 입력 재계산에서 원자재 발주 수량이 달라지면 안 됩니다.')
const onsiteScrapPlan = scrapOptimization.scenarios
  .find((scenario) => scenario.id === 'cost')
  ?.stockPlans.find((plan) => plan.source === 'onsite-scrap')
const onsiteGeneratedAreaM2 = scrapOptimization.scenarios
  .find((scenario) => scenario.id === 'cost')
  ?.scraps
  .filter((scrap) => scrap.source === 'generated' && scrap.sourceStockPlanId === onsiteScrapPlan?.id)
  .reduce((sum, scrap) => sum + scrap.lengthMm * (scrap.widthMm || 0) / 1_000_000, 0)
assert.equal(onsiteScrapPlan?.wasteAreaM2, onsiteGeneratedAreaM2, '현장 판재 자투리의 재사용 잔량은 절단폭을 반영한 생성 자투리 면적과 일치해야 합니다.')
const kerfScrapMember = member('KERF-SCRAP-MEMBER', panelKerfMaterial.id, 1, 1000, 1000)
const kerfScrapOptimization = optimizeCuttingPlan({
  walls: [],
  members: [kerfScrapMember],
  catalog: [panelKerfMaterial],
  existingScraps: [{
    ...existingScrap,
    id: 'existing-kerf-scrap',
    materialId: panelKerfMaterial.id,
    material: panelKerfMaterial.material,
    thicknessMm: panelKerfMaterial.thicknessMm,
    widthMm: 1200,
    lengthMm: 3000,
    plannedUseMemberId: kerfScrapMember.id,
  }],
  now,
})
const kerfScrapScenario = kerfScrapOptimization.scenarios.find((scenario) => scenario.id === 'cost')
const kerfScrapPlan = kerfScrapScenario?.stockPlans.find((plan) => plan.source === 'onsite-scrap')
const kerfScrapRemainderAreaM2 = kerfScrapScenario?.scraps
  .filter((scrap) => scrap.source === 'generated' && scrap.sourceStockPlanId === kerfScrapPlan?.id)
  .reduce((sum, scrap) => sum + scrap.lengthMm * (scrap.widthMm || 0) / 1_000_000, 0)
assert.equal(kerfScrapPlan?.wasteAreaM2, kerfScrapRemainderAreaM2, '톱날 폭이 있는 현장 판재도 보고 잔량과 생성 자투리 면적이 일치해야 합니다.')
assert.notEqual(kerfScrapPlan?.wasteAreaM2, 2.6, '현장 판재의 재사용 잔량에서 톱날 손실 면적을 누락하면 안 됩니다.')
const cuttingOnlyValidation = validateConsistency({
  files: [],
  dimensions: [],
  walls: [],
  model: {
    walls: [], footprint: [], isReady: false, blockedReason: '',
    roof: { isReady: false, kind: 'unknown', heightMm: null, pitchDeg: null, evidence: [], blockedReason: '' },
  },
  takeoffs: [],
  optimization: {
    ...emptyOptimizationState(),
    catalog: [materialA],
    members: scrapOptimization.members,
    reviews: scrapOptimization.reviews,
    scenarios: scrapOptimization.scenarios,
    selectedScenarioId: scrapOptimization.selectedScenarioId,
    recommendedScenarioId: scrapOptimization.recommendedScenarioId,
    status: scrapOptimization.status,
    validation: scrapOptimization.validation,
    scraps: scrapOptimization.scraps,
    lastCalculatedAt: now,
  },
  workflow: { reviewConfirmed: true, modelBuilt: true, takeoffCalculated: true, optimizationCalculated: true },
  actualData: true,
  checkedAt: now,
})
assert.equal(cuttingOnlyValidation.issues.some((item) => item.id.startsWith('waste-')), false, '사용한 기존 자투리 전체 면적을 새 폐기물로 중복 집계하면 안 됩니다.')

const evidence: Evidence = {
  fileId: 'file-1', fileName: 'test.pdf', pageNumber: 1, drawingKind: 'floor-plan', method: 'user', rawText: 'W-01 4000 H=3000',
}
const lengthDimension: DimensionValue = {
  id: 'length-1', label: 'W-01 길이', value: 4000, unit: 'mm', normalizedValueMm: 4000,
  sourceFile: 'test.pdf', pageNumber: 1, drawingType: '평면도', sourceText: 'W-01 4000',
  sourcePosition: { x: 0, y: 0, width: 10, height: 10 }, sourceType: 'pdf-text', valueMm: 4000,
  displayValue: '4000mm', confidence: 'high', source: 'extracted', evidence: [evidence], context: 'WALL W-01 4000', userEdited: false,
}
const heightDimension: DimensionValue = {
  ...lengthDimension,
  id: 'height-1', label: 'W-01 높이', value: 3000, normalizedValueMm: 3000, valueMm: 3000,
  sourceText: 'W-01 H=3000', displayValue: '3000mm', context: 'WALL W-01 H=3000',
  originalValueMm: 3000, userValueMm: 3000, userEdited: true, heightRole: 'direct', heightReviewAction: 'approved',
}
const wall: Wall = {
  id: 'wall-1', zone: 'ZONE A', zoneName: 'ZONE A', number: 'W-01', wallNumber: 'W-01',
  lengthMm: 4000, heightMm: 3000, heightStatus: 'known', openings: [], confidence: 'high', evidence: [evidence], sourceReferences: [evidence],
  sourceDimensionIds: [lengthDimension.id, heightDimension.id], heightSourceDimensionId: heightDimension.id,
  reviewStatus: 'verified', geometryStart: { x: 0, z: 0 }, geometryEnd: { x: 4, z: 0 }, geometrySource: 'dimension-layout', color: '#000',
}
const model: BuildingGeometry = {
  walls: [{
    wallId: wall.id, zone: wall.zone, zoneName: wall.zoneName, number: wall.number, wallNumber: wall.wallNumber,
    start: { x: 0, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 }, lengthMm: 4000, heightMm: 3000,
    thicknessMm: 50, openings: [], color: '#000', confidence: 'high', sourceReferences: [evidence], geometrySource: 'dimension-layout',
  }],
  footprint: [{ x: 0, z: 0 }, { x: 4, z: 0 }], isReady: true, blockedReason: '', partial: false,
  roof: { isReady: false, kind: 'unknown', heightMm: null, pitchDeg: null, evidence: [], blockedReason: '' },
}
const takeoff: MaterialTakeoff = {
  wallId: wall.id, zone: wall.zone, wallNumber: wall.wallNumber, evidenceLabel: 'test.pdf · 1p',
  lengthMm: 4000, heightMm: 3000, openingAreaM2: 0, netAreaM2: 999,
  panelSpec: '시험', basePanels: 4, panelsWithWaste: 4, fasteners: 24, sealantCartridges: 1,
  cornerPieces: 1, finishPieces: 1, offcutM: 0, confidence: 'high', reviewStatus: '확정', notes: [],
  formula: '4m × 3m', sourceReferences: [evidence],
}
const formulaSafeCsv = takeoffsToCsv([{ ...takeoff, zone: '=HYPERLINK("https://example.invalid")' }])
assert.ok(formulaSafeCsv.includes("'=HYPERLINK"), '사용자 문자열이 스프레드시트 수식으로 실행되지 않게 이스케이프해야 합니다.')
const file: AnalyzedFile = {
  id: 'file-1', name: 'test.pdf', extension: 'pdf', mimeType: 'application/pdf', size: 1,
  status: 'complete', stage: 'complete', progress: 100, kind: 'floor-plan', kindConfidence: 'high',
  pages: [{
    id: 'file-1-page-1', pageNumber: 1, width: 100, height: 100, text: 'W-01 4000 H=3000', previewUrl: '',
    kind: 'floor-plan', kindConfidence: 'high', dimensions: [lengthDimension, heightDimension], zones: [], roomNames: [],
    axisLabels: [], scales: [], unitCandidates: ['mm'], vectorSegments: [], warnings: [], handWritingDetected: false,
  }],
  previewUrl: '', warnings: [], error: '', uploadedAt: now, canReanalyze: true, externalProcessing: false,
}
const tamperedTakeoffValidation = validateConsistency({
  files: [file], dimensions: [lengthDimension, heightDimension], walls: [wall], model, takeoffs: [takeoff],
  optimization: emptyOptimizationState(),
  workflow: { reviewConfirmed: true, modelBuilt: true, takeoffCalculated: true, optimizationCalculated: false },
  actualData: true,
  checkedAt: now,
})
assert.ok(tamperedTakeoffValidation.issues.some((item) => item.id === `mismatch-wall-takeoff-net-area-${wall.id}`), '변조된 순면적은 계산 불일치로 차단해야 합니다.')
assert.equal(tamperedTakeoffValidation.issues.some((item) => item.id === `mismatch-approved-wall-height-${wall.id}`), false, '동일한 사용자 승인 높이를 불일치로 오판하면 안 됩니다.')
const downstreamHeightMismatch = validateConsistency({
  files: [file],
  dimensions: [lengthDimension, heightDimension],
  walls: [{ ...wall, heightMm: 2800 }],
  model: { ...model, walls: model.walls.map((modelWall) => ({ ...modelWall, heightMm: 2800 })) },
  takeoffs: [{ ...takeoff, heightMm: 2800, netAreaM2: 11.2 }],
  optimization: emptyOptimizationState(),
  workflow: { reviewConfirmed: true, modelBuilt: true, takeoffCalculated: true, optimizationCalculated: false },
  actualData: true,
  checkedAt: now,
})
assert.ok(downstreamHeightMismatch.issues.some((item) => item.id === `mismatch-approved-wall-height-${wall.id}`), '사용자 승인 높이와 downstream 벽 높이가 다르면 반드시 차단해야 합니다.')

const inventory = createInventorySampleData(now)
const exactRequirement = {
  ...inventory.requirements[0]!,
  requiredLengthMm: 1000,
  quantity: 1,
  status: 'ready' as const,
  confirmedAt: now,
  confirmedBy: '사용자 확인',
}
const matchingStock = {
  ...inventory.ownedMaterials[0]!,
  materialType: exactRequirement.materialType,
  materialName: exactRequirement.materialName,
  thicknessMm: exactRequirement.thicknessMm,
  widthMm: exactRequirement.widthMm,
  surfaceFinish: exactRequirement.surfaceFinish,
  color: exactRequirement.color,
  lengthMm: 1005,
  quantity: 1,
  reservedQuantity: 0,
  usable: true,
}
const kerfExactInventory = calculateInventoryCutPlan({
  requirements: [exactRequirement],
  ownedMaterials: [matchingStock],
  settings: { ...inventory.settings, kerfMm: 5, minimumCutAllowanceMm: 0 },
  now,
})
assert.equal(kerfExactInventory.plan?.ownedPieceCount, 1)
assert.equal(kerfExactInventory.plan?.newOrderPieceCount, 0)
assert.equal(kerfExactInventory.plan?.usages[0]?.remainingLengthMm, 0)
const noCutInventory = calculateInventoryCutPlan({
  requirements: [exactRequirement],
  ownedMaterials: [{ ...matchingStock, lengthMm: 1000 }],
  settings: { ...inventory.settings, kerfMm: 5, minimumCutAllowanceMm: 0 },
  now,
})
assert.equal(noCutInventory.plan?.usages[0]?.cuts[0]?.kerfMm, 0)
const allowanceOrder = calculateInventoryCutPlan({
  requirements: [exactRequirement],
  ownedMaterials: [],
  settings: { ...inventory.settings, kerfMm: 5, minimumCutAllowanceMm: 50 },
  now,
})
assert.equal(allowanceOrder.plan, null, '보유 자재 목록 자체가 없으면 입력 확인 상태를 유지해야 합니다.')
const allowanceWithUnmatchedStock = calculateInventoryCutPlan({
  requirements: [exactRequirement],
  ownedMaterials: [{ ...matchingStock, materialName: '다른 자재' }],
  settings: { ...inventory.settings, kerfMm: 5, minimumCutAllowanceMm: 50 },
  now,
})
assert.equal(allowanceWithUnmatchedStock.plan?.newOrders[0]?.lengthMm, 1050)

const previousRequirement = {
  ...inventory.requirements[0]!,
  source: 'drawing' as const,
  status: 'ready' as const,
  confirmedAt: now,
  confirmedBy: '사용자 확인',
}
const refreshedRequirement = { ...previousRequirement, widthMm: (previousRequirement.widthMm || 0) + 100, status: 'needs-review' as const, confirmedAt: null, confirmedBy: null }
const mergedRequirements = mergeInventoryRequirements([previousRequirement], [refreshedRequirement])
assert.equal(mergedRequirements[0]?.widthMm, refreshedRequirement.widthMm)
assert.equal(mergedRequirements[0]?.status, 'needs-review')
assert.equal(mergedRequirements[0]?.confirmedAt, null)
const disappearedSourceRequirements = mergeInventoryRequirements(
  [previousRequirement],
  [{ ...previousRequirement, thicknessMm: null, status: 'needs-review', confirmedAt: null, confirmedBy: null }],
)
assert.equal(disappearedSourceRequirements[0]?.thicknessMm, null)
assert.equal(disappearedSourceRequirements[0]?.status, 'needs-review')

const fractionalInventory = calculateInventoryCutPlan({
  requirements: [{ ...inventory.requirements[0]!, quantity: 1.5 }],
  ownedMaterials: inventory.ownedMaterials,
  settings: inventory.settings,
  now,
})
assert.equal(fractionalInventory.plan, null)
assert.ok(fractionalInventory.missingFields.some((field) => field.includes('정수')))
const excessiveInventory = calculateInventoryCutPlan({
  requirements: [{ ...inventory.requirements[0]!, quantity: 1_000_000_000 }],
  ownedMaterials: inventory.ownedMaterials,
  settings: inventory.settings,
  now,
})
assert.equal(excessiveInventory.plan, null)
assert.ok(excessiveInventory.missingFields.some((field) => field.includes('10,000')))

const calculatedInventory = calculateInventoryCutPlan({
  requirements: inventory.requirements,
  ownedMaterials: inventory.ownedMaterials,
  settings: inventory.settings,
  now,
})
const approvedInventory = approveInventoryCutPlan(calculatedInventory.plan!, inventory.ownedMaterials, now)
assert.equal(approvedInventory.ok, true)
const approvedInventoryOrderCsv = inventoryOrderToCsv(approvedInventory.plan)
assert.match(approvedInventoryOrderCsv, /승인·재고 예약 반영/)
const approvedInventoryCutCsv = inventoryCutPlanToCsv(approvedInventory.plan)
assert.match(approvedInventoryCutCsv, /승인·재고 예약 반영/)
assert.match(approvedInventoryCutCsv, /보유 신규 자재|현장 자투리/)
const releasedInventory = releaseInventoryCutPlanReservation(approvedInventory.plan, approvedInventory.ownedMaterials, now)
assert.equal(releasedInventory.ok, true)
assert.equal(releasedInventory.plan.status, 'cancelled')
assert.deepEqual(releasedInventory.ownedMaterials.map((stock) => stock.reservedQuantity), [0, 0])

console.log(JSON.stringify({
  multiMaterialPlans: multiCost?.stockPlans.length,
  multiMaterialPlacements: multiCost?.stockPlans.flatMap((plan) => plan.placements).length,
  twoDimensionalCutCount: twoDimensionalCut?.cutCount,
  fractionalQuantityBlocked: invalidQuantity.status,
  tamperedNetAreaBlocked: true,
  approvedReservationReleased: releasedInventory.ok,
}, null, 2))
