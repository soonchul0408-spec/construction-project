import assert from 'node:assert/strict'

import { buildOptimizationMembers, createProfileMembersForTest, optimizeCuttingPlan } from '../src/modules/cutting-optimization-engine.ts'
import { DEFAULT_MATERIAL_SETTINGS } from '../src/types/domain.ts'
import type { CuttingMember, MaterialCatalogItem, Wall } from '../src/types/domain.ts'

function catalog(overrides: Partial<MaterialCatalogItem> = {}): MaterialCatalogItem {
  return {
    id: 'panel-a',
    name: '시험 판재',
    materialType: 'panel',
    material: '시험 재질',
    thicknessMm: 50,
    stockWidthMm: 1000,
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
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function member(id: string, lengthMm: number, widthMm: number, materialId = 'panel-a', zone = '구역 A', installOrder = 0): CuttingMember {
  return {
    id,
    sourceWallId: null,
    zone,
    location: zone,
    wallNumber: id,
    requiredLengthMm: lengthMm,
    requiredWidthMm: widthMm,
    requiredHeightMm: widthMm,
    quantity: 1,
    materialType: 'panel',
    materialId,
    materialSpec: '시험 규격',
    shape: 'rectangle',
    cuttingRequired: true,
    openingIds: [],
    installOrder,
    plannedInstallAt: null,
    sourceReferences: [],
    confidence: 'high',
    reviewStatus: 'ready',
    notes: [],
  }
}

function wall(id: string, lengthMm: number, heightMm: number | null): Wall {
  return {
    id,
    zone: '구역 A',
    zoneName: '구역 A',
    number: id,
    wallNumber: id,
    lengthMm,
    heightMm,
    heightStatus: heightMm === null ? 'missing' : 'known',
    openings: [],
    confidence: 'high',
    evidence: [],
    sourceReferences: [],
    sourceDimensionIds: [],
    reviewStatus: heightMm === null ? 'blocked' : 'verified',
    geometryStart: { x: 0, z: 0 },
    geometryEnd: { x: lengthMm / 1000, z: 0 },
    geometrySource: 'dimension-layout',
    color: '#2f6fed',
  }
}

function optimize(members: CuttingMember[], item = catalog(), existingScraps = [], walls: Wall[] = []) {
  return optimizeCuttingPlan({ walls, members, catalog: [item], existingScraps, now: '2026-01-01T00:00:00.000Z' })
}

const exact = optimize([member('A-1', 1000, 1000), member('A-2', 1000, 1000)])
assert.equal(exact.scenarios.find((scenario) => scenario.id === 'cost')?.stockCount, 1, '2,000×1,000 원자재에 두 부재가 들어가야 합니다.')
assert.equal(exact.scenarios.find((scenario) => scenario.id === 'cost')?.validation.passed, true)

const rotated = optimize(
  [member('R-1', 1800, 1000), member('R-2', 1000, 1200)],
  catalog({ stockLengthMm: 3000, stockWidthMm: 1000, rotatable: true, grainDirection: 'free' }),
)
assert.equal(rotated.scenarios.find((scenario) => scenario.id === 'cost')?.stockCount, 1, '회전 가능한 부재는 회전 후 한 장에 배치되어야 합니다.')
assert.equal(rotated.scenarios.find((scenario) => scenario.id === 'cost')?.stockPlans[0]?.placements.find((placement) => placement.memberId === 'R-2')?.rotated, true)

const kerf = optimize([member('K-1', 1000, 1000), member('K-2', 1000, 1000)], catalog({ kerfMm: 1 }))
assert.equal(kerf.scenarios.find((scenario) => scenario.id === 'cost')?.stockCount, 2, '절단폭 때문에 정확히 맞던 두 부재가 분리되어야 합니다.')

const profileMaterial = catalog({ id: 'profile-a', name: '시험 프로파일', materialType: 'profile', unit: 'bar', unitLabel: '본', stockWidthMm: null, stockLengthMm: 6000, stockLengthOptionsMm: [6000, 9000, 12000], disposalCostPerM2: null, disposalCostPerM: 10 })
const profileMembers = createProfileMembersForTest([
  { id: 'P-1', zone: '구역 A', lengthMm: 2500, materialId: 'profile-a' },
  { id: 'P-2', zone: '구역 A', lengthMm: 2000, materialId: 'profile-a' },
  { id: 'P-3', zone: '구역 B', lengthMm: 1498, materialId: 'profile-a' },
])
const profile = optimize(profileMembers, profileMaterial)
assert.equal(profile.scenarios.find((scenario) => scenario.id === 'cost')?.stockCount, 1, '6,000mm 원자재에 절단폭을 포함해 여러 프로파일을 배치해야 합니다.')
assert.equal(profile.scenarios.find((scenario) => scenario.id === 'cost')?.validation.passed, true)

const reuseMember = member('REUSE-2', 1200, 1000, 'panel-a', '구역 B', 2)
const existingScrap = {
  id: 'existing-1', source: 'existing' as const, sourceStockPlanId: null, materialId: 'panel-a', material: '시험 재질', thicknessMm: 50, widthMm: 1000, lengthMm: 1200,
  xMm: null, yMm: null,
  currentLocation: '1층 자재장', originZone: '구역 A', usableZones: ['구역 B'], plannedUseMemberId: 'REUSE-2', generatedAt: '2026-01-01T00:00:00.000Z', plannedUseAt: '2026-01-02T00:00:00.000Z', storageDays: null, temporaryStorageCost: null, available: true, status: 'reuse-planned' as const, disposalCategory: null, note: '',
}
const reuse = optimize([member('REUSE-1', 1000, 1000, 'panel-a', '구역 A', 1), reuseMember], catalog(), [existingScrap])
assert.equal(reuse.scenarios.find((scenario) => scenario.id === 'cost')?.stockPlans.some((plan) => plan.source === 'onsite-scrap'), true, '다른 구역에서 사용할 자투리를 현장 재사용해야 합니다.')
assert.equal(reuse.scenarios.find((scenario) => scenario.id === 'cost')?.scraps.find((scrap) => scrap.id === 'existing-1')?.status, 'reuse-planned')

const storage = optimize([reuseMember], catalog(), [{ ...existingScrap, id: 'storage-1' }])
assert.equal(storage.scenarios.find((scenario) => scenario.id === 'cost')?.scraps.find((scrap) => scrap.id === 'storage-1')?.storageDays, 1)
assert.equal(storage.scenarios.find((scenario) => scenario.id === 'cost')?.cost.storageCost, 5)

const unused = optimize([member('UNUSED-1', 1000, 1000)], catalog(), [{ ...existingScrap, id: 'unused-1', plannedUseMemberId: null, plannedUseAt: null, available: false, status: 'reuse-unavailable' }])
assert.equal(unused.scenarios.find((scenario) => scenario.id === 'cost')?.scraps.find((scrap) => scrap.id === 'unused-1')?.status, 'reuse-unavailable')

const priceMissing = optimize([member('PRICE-1', 1000, 1000)], catalog({ unitPrice: null }))
assert.equal(priceMissing.scenarios.find((scenario) => scenario.id === 'cost')?.cost.totalCost, null, '가격이 없으면 가짜 총액을 표시하면 안 됩니다.')
assert.equal(priceMissing.scenarios.find((scenario) => scenario.id === 'cost')?.cost.status, 'price-missing')
assert.equal(priceMissing.reviews.find((review) => review.category === 'price')?.targetField, 'unitPrice', '가격 확인 항목은 자재 카탈로그의 수정 필드와 연결되어야 합니다.')

const before = member('FIXED-1', 1000, 1000)
const fixed = optimize([before])
assert.equal(fixed.members[0]?.requiredLengthMm, before.requiredLengthMm, '최적화가 설계 부재 길이를 바꾸면 안 됩니다.')
assert.equal(fixed.members[0]?.requiredWidthMm, before.requiredWidthMm)

const missingHeight = buildOptimizationMembers([wall('W-MISSING', 2000, null)], DEFAULT_MATERIAL_SETTINGS, 'panel-a')
assert.equal(missingHeight.members.length, 0, '높이 누락 부재는 임의의 높이로 만들면 안 됩니다.')
assert.equal(missingHeight.reviews.some((review) => review.category === 'height'), true)

const irregular = optimize([{ ...member('IRREGULAR-1', 1000, 1000), shape: 'irregular' }])
assert.equal(irregular.scenarios.find((scenario) => scenario.id === 'cost')?.validation.unsupportedShapeErrors.length, 1)

const duplicate = optimize([member('DUP-1', 1000, 1000), member('DUP-1', 1000, 1000)])
assert.equal(duplicate.scenarios.find((scenario) => scenario.id === 'cost')?.validation.memberAssignmentErrors.length > 0, true, '중복 부재 ID는 검증 오류가 되어야 합니다.')

console.log(JSON.stringify({
  exactSheet: exact.scenarios.find((scenario) => scenario.id === 'cost')?.stockCount,
  rotatedSheet: rotated.scenarios.find((scenario) => scenario.id === 'cost')?.stockCount,
  kerfSheet: kerf.scenarios.find((scenario) => scenario.id === 'cost')?.stockCount,
  profileBars: profile.scenarios.find((scenario) => scenario.id === 'cost')?.stockCount,
  reuse: reuse.scenarios.find((scenario) => scenario.id === 'cost')?.scraps.find((scrap) => scrap.id === 'existing-1')?.status,
  storageCost: storage.scenarios.find((scenario) => scenario.id === 'cost')?.cost.storageCost,
  priceStatus: priceMissing.scenarios.find((scenario) => scenario.id === 'cost')?.cost.status,
  missingHeight: missingHeight.reviews.length,
  irregular: irregular.scenarios.find((scenario) => scenario.id === 'cost')?.validation.unsupportedShapeErrors.length,
}, null, 2))
