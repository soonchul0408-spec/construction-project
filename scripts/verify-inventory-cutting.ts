import assert from 'node:assert/strict'

import {
  approveInventoryCutPlan,
  calculateInventoryCutPlan,
  cancelInventoryCutPlan,
  createInventorySampleData,
} from '../src/modules/inventory-cutting-engine.ts'
import type { InventoryCuttingState } from '../src/types/domain.ts'

const now = '2026-08-13T00:00:00.000Z'

function calculatedState(overrides: Partial<InventoryCuttingState> = {}) {
  const sample = createInventorySampleData(now)
  return {
    ...sample,
    ...overrides,
    settings: { ...sample.settings, ...overrides.settings },
    requirements: overrides.requirements || sample.requirements,
    ownedMaterials: overrides.ownedMaterials || sample.ownedMaterials,
  }
}

const sample = calculatedState()
const sampleResult = calculateInventoryCutPlan({
  requirements: sample.requirements,
  ownedMaterials: sample.ownedMaterials,
  settings: sample.settings,
  now,
})
assert.equal(sampleResult.status, 'calculated')
assert.ok(sampleResult.plan)
assert.equal(sampleResult.plan?.newOrderPieceCount, 0)
assert.equal(sampleResult.plan?.ownedPieceCount, 3)
assert.equal(sampleResult.plan?.orderReductionPieceCount, 3)
assert.equal(sampleResult.plan?.usages[0]?.lengthMm, 2800, '2,800mm 자재를 먼저 선택해야 합니다.')
assert.equal(sampleResult.plan?.usages[0]?.cuts[0]?.requiredLengthMm, 2750)
assert.equal(sampleResult.plan?.usages[1]?.lengthMm, 3000)
assert.equal(sampleResult.plan?.usages[1]?.cuts[0]?.requiredLengthMm, 2750)
assert.equal(sampleResult.plan?.usages[2]?.lengthMm, 3000)
assert.equal(sampleResult.plan?.usages[2]?.cuts[0]?.requiredLengthMm, 1200)
assert.equal(sampleResult.plan?.usages[0]?.cuts[0]?.actualUsedLengthMm, 2755, '톱날 폭을 실제 사용 길이에 포함해야 합니다.')
assert.equal(sampleResult.plan?.usages[0]?.remainingLengthMm, 45)
assert.equal(sampleResult.plan?.usages[0]?.wasteRemainingLengthMm, 45)
assert.equal(sampleResult.plan?.usages[1]?.reusableRemainingLengthMm, 245)
assert.equal(sampleResult.plan?.wasteReductionLengthMm, 2255)

const scrapFirst = calculatedState({
  ownedMaterials: sample.ownedMaterials.map((stock) => stock.id === 'sample-stock-2800' ? { ...stock, source: 'scrap' as const } : stock),
})
const scrapFirstResult = calculateInventoryCutPlan({ requirements: scrapFirst.requirements, ownedMaterials: scrapFirst.ownedMaterials, settings: scrapFirst.settings, now })
assert.equal(scrapFirstResult.plan?.usages[0]?.source, 'scrap', '자투리 자재를 신규 보유 자재보다 먼저 검토해야 합니다.')

const beforeApproval = sample.ownedMaterials.map((stock) => stock.reservedQuantity)
const approval = approveInventoryCutPlan(sampleResult.plan!, sample.ownedMaterials, now)
assert.equal(approval.ok, true)
assert.deepEqual(sample.ownedMaterials.map((stock) => stock.reservedQuantity), beforeApproval, '계산만으로 실제 재고를 예약하면 안 됩니다.')
assert.deepEqual(approval.ownedMaterials.map((stock) => stock.reservedQuantity), [2, 1])
assert.equal(approval.plan.status, 'approved')

const cancelled = cancelInventoryCutPlan(sampleResult.plan!, now)
assert.equal(cancelled.status, 'cancelled')
assert.deepEqual(sample.ownedMaterials.map((stock) => stock.reservedQuantity), beforeApproval, '계획 취소는 실제 재고를 바꾸면 안 됩니다.')

const missing = calculatedState({
  requirements: sample.requirements.map((requirement, index) => index === 0 ? { ...requirement, surfaceFinish: '', status: 'needs-review' as const } : requirement),
})
const missingResult = calculateInventoryCutPlan({ requirements: missing.requirements, ownedMaterials: missing.ownedMaterials, settings: missing.settings, now })
assert.equal(missingResult.status, 'needs-review')
assert.equal(missingResult.plan, null, '확인 전 필요 조각을 계산에 넣으면 안 됩니다.')
assert.ok(missingResult.missingFields.some((item) => item.includes('표면 마감')))

const missingHeight = calculatedState({
  requirements: sample.requirements.map((requirement, index) => index === 0 ? { ...requirement, heightMm: null, status: 'needs-review' as const } : requirement),
})
const missingHeightResult = calculateInventoryCutPlan({ requirements: missingHeight.requirements, ownedMaterials: missingHeight.ownedMaterials, settings: missingHeight.settings, now })
assert.equal(missingHeightResult.plan, null, '높이가 없으면 임의의 기본 높이로 계산하지 않아야 합니다.')
assert.ok(missingHeightResult.missingFields.some((item) => item.includes('높이')))

const mismatch = calculatedState({
  ownedMaterials: [{
    ...sample.ownedMaterials[0],
    id: 'wrong-thickness',
    thicknessMm: 75,
    quantity: 10,
  }],
})
const mismatchResult = calculateInventoryCutPlan({ requirements: mismatch.requirements, ownedMaterials: mismatch.ownedMaterials, settings: mismatch.settings, now })
assert.equal(mismatchResult.plan?.newOrderPieceCount, 3)
assert.ok(mismatchResult.plan?.excludedMaterials.some((item) => item.ownedMaterialId === 'wrong-thickness' && item.reasons.includes('두께가 다름')))

const tooShort = calculatedState({
  requirements: [sample.requirements[0]],
  ownedMaterials: [{ ...sample.ownedMaterials[0], id: 'too-short', lengthMm: 2754, quantity: 1 }],
})
const tooShortResult = calculateInventoryCutPlan({ requirements: tooShort.requirements, ownedMaterials: tooShort.ownedMaterials, settings: tooShort.settings, now })
assert.equal(tooShortResult.plan?.newOrderPieceCount, 1, '톱날 폭을 고려해 부족한 자재는 신규 발주해야 합니다.')
assert.ok(tooShortResult.plan?.excludedMaterials.some((item) => item.reasons.includes('필요 조각보다 보유 길이가 짧음')))

console.log(JSON.stringify({
  sample: {
    orderCount: sampleResult.plan?.newOrderPieceCount,
    usedLengths: sampleResult.plan?.usages.map((usage) => usage.lengthMm),
    cuts: sampleResult.plan?.usages.flatMap((usage) => usage.cuts.map((cut) => cut.requiredLengthMm)),
    wasteMm: sampleResult.plan?.plannedWasteLengthMm,
    reusableMm: sampleResult.plan?.reusableLengthMm,
  },
  mismatchExcluded: mismatchResult.plan?.excludedMaterials,
  tooShortNewOrder: tooShortResult.plan?.newOrderPieceCount,
}))
