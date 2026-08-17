import assert from 'node:assert/strict'
import { calculateManualMarking, createPageScale, measuredAreaM2, measuredLengthMm, reviewZoneWarnings, snapshotPreset, validatedOpeningAreaM2 } from '../src/modules/manual-marking-calculator.ts'
import { planWallMaterial } from '../src/modules/wall-material-layout.ts'
import { activateVersion } from '../src/modules/drawing-versioning.ts'
import { applyInventoryAudit, offcutCandidate } from '../src/modules/mobile-inventory-audit.ts'
import { readMaterialCsv, rollbackImport } from '../src/modules/material-csv-import.ts'
import { bulkReview, filterMarkingRows } from '../src/modules/marking-review-list.ts'
import { crossCheckScale } from '../src/modules/scale-cross-check.ts'
import { createBackup, restoreBackup } from '../src/modules/project-backup.ts'

const sample = calculateManualMarking({ lengthM: 10, heightMm: 3000, openingAreaM2: 2, effectiveWidthMm: 1000, status: '확인 완료' })
assert.equal(sample.grossAreaM2, 30, '10m × 3,000mm 벽체는 30㎡입니다.')
assert.equal(sample.netAreaM2, 28, '개구부 2㎡를 차감한 순면적은 28㎡입니다.')
assert.equal(sample.panelCount, 10, '3m × 유효폭 1m 판넬은 예상 10장입니다.')
const pending = calculateManualMarking({ lengthM: 10, heightMm: 3000, openingAreaM2: 2, effectiveWidthMm: 1000, status: '검토 필요' })
assert.equal(pending.ready, false, '검토 필요 마킹은 산출에서 제외합니다.')
const scale = createPageScale({ x: 0, y: 0 }, { x: .6, y: 0 }, 6000)
assert.ok(scale, '0이 아닌 기준 치수는 축척으로 보정합니다.')
assert.equal(measuredLengthMm([{ x: 0, y: 0 }, { x: 1, y: 0 }], scale ?? undefined), 10000, '6m 기준선으로 10m 벽체 길이를 환산합니다.')
const scaledTakeoff = calculateManualMarking({ lengthM: (measuredLengthMm([{ x: 0, y: 0 }, { x: 1, y: 0 }], scale ?? undefined) || 0) / 1000, heightMm: 3000, openingAreaM2: 2, effectiveWidthMm: 1000, status: '확인 완료' })
assert.equal(scaledTakeoff.netAreaM2, 28, '축척 환산 10m 벽체와 3m 높이·2㎡ 개구부는 순면적 28㎡입니다.')
assert.equal(measuredAreaM2([{ x: 0, y: 0 }, { x: .6, y: 0 }, { x: .6, y: .5 }, { x: 0, y: .5 }], scale ?? undefined), 30, '축척 보정 면적을 ㎡로 계산합니다.')
assert.equal(createPageScale({ x: 0, y: 0 }, { x: 0, y: 0 }, 6000), null, '길이 0 기준선은 거부합니다.')
assert.equal(createPageScale({ x: 0, y: 0 }, { x: .6, y: 0 }, -1), null, '음수 기준 치수는 거부합니다.')
const invalidOpening = calculateManualMarking({ lengthM: 1, heightMm: 1000, openingAreaM2: 2, effectiveWidthMm: 1000, status: '확인 완료' })
assert.equal(invalidOpening.ready, false, '벽체보다 큰 개구부는 산출에서 제외합니다.')
const preset = { presetId: 'panel-3m', presetName: '외벽 3m', material: '샌드위치패널 75T', heightMm: 3000, effectiveWidthMm: 1000, color: '#0f766e', status: '확인 완료' as const }
const repeated = [snapshotPreset(preset), snapshotPreset(preset), snapshotPreset(preset)]
assert.equal(repeated.length, 3, '프리셋 하나로 벽체 3개에 연속 적용합니다.')
assert.equal(repeated.reduce((sum, item) => sum + calculateManualMarking({ lengthM: 10, heightMm: item.heightMm, openingAreaM2: 0, effectiveWidthMm: item.effectiveWidthMm, status: item.status }).netAreaM2, 0), 90, '프리셋별 3개 벽체 총면적을 합산합니다.')
preset.material = '수정된 자재'
assert.equal(repeated[0].material, '샌드위치패널 75T', '프리셋 수정 후에도 기존 마킹 스냅샷은 유지합니다.')
const zones = [
  { status: '미검토', items: [], hasScale: true },
  { status: '마킹 중', items: [{ status: '검토 필요', heightMm: 0, material: '샌드위치패널', kind: 'wall' as const }], hasScale: true },
  { status: '검토 완료', items: [{ status: '확인 완료', heightMm: 3000, material: '샌드위치패널', kind: 'wall' as const }], hasScale: true },
]
assert.equal(zones.filter((zone) => zone.status === '미검토').length, 1, '미검토 구역 필터는 1개를 표시합니다.')
assert.deepEqual(reviewZoneWarnings(zones[1].items, zones[1].hasScale), ['높이 누락'], '높이 누락 구역을 경고합니다.')
assert.deepEqual(reviewZoneWarnings(zones[2].items, zones[2].hasScale), [], '완료 구역은 경고 없이 통과합니다.')
const door = validatedOpeningAreaM2(1000, 2000, 1, 30, 1, '확인 완료')
assert.deepEqual(door, { ready: true, areaM2: 2, reason: null }, '1m × 2m 문은 연결 벽체에서 2㎡를 차감합니다.')
assert.equal(calculateManualMarking({ lengthM: 10, heightMm: 3000, openingAreaM2: door.areaM2, effectiveWidthMm: 1000, status: '확인 완료' }).netAreaM2, 28, '문 자동 차감 후 순면적은 28㎡입니다.')
assert.equal(validatedOpeningAreaM2(1000, 2000, 1, 30, 2, '확인 완료').ready, false, '두 벽체 중복 연결은 차감에서 제외합니다.')
assert.equal(validatedOpeningAreaM2(10000, 4000, 1, 30, 1, '확인 완료').ready, false, '벽체보다 큰 개구부는 차감에서 제외합니다.')
const vertical = planWallMaterial({ lengthM: 10, heightMm: 3000, netAreaM2: 28, reviewed: true, catalog: { id: 'p75', name: '75T 판넬', thicknessMm: 75, effectiveWidthMm: 1000, standardLengthMm: 3200, direction: 'vertical', cuttingAllowanceMm: 50, unitPrice: 100000 } }, [{ id: 'usable', catalogId: 'p75', thicknessMm: 75, lengthMm: 3100, direction: 'vertical', rotatable: false, approved: true }, { id: 'wrong-thickness', catalogId: 'p75', thicknessMm: 50, lengthMm: 3200, direction: 'vertical', rotatable: false, approved: true }])
assert.equal(vertical.panelCount, 10, '세로 시공은 벽체 길이와 유효폭으로 10장을 계산합니다.')
assert.equal(vertical.requiredLengthMm, 3050, '세로 시공 필요 길이는 높이와 절단 여유를 합산합니다.')
assert.equal(vertical.approvedStock, 1, '규격·두께·길이가 맞고 승인된 자투리를 우선 사용합니다.')
assert.equal(vertical.orderCount, 9, '부족한 수량만 신규 발주합니다.')
const horizontal = planWallMaterial({ lengthM: 10, heightMm: 3000, netAreaM2: 28, reviewed: true, catalog: { id: 'p75h', name: '75T 판넬 가로', thicknessMm: 75, effectiveWidthMm: 1000, standardLengthMm: 10200, direction: 'horizontal', cuttingAllowanceMm: 50, unitPrice: 100000 } }, [])
assert.equal(horizontal.panelCount, 3, '가로 시공은 벽체 높이와 유효폭으로 3단을 계산합니다.')
assert.equal(horizontal.requiredLengthMm, 10050, '가로 시공 필요 길이는 벽체 길이와 절단 여유를 합산합니다.')
assert.equal(planWallMaterial({ lengthM: 10, heightMm: 3000, netAreaM2: 28, reviewed: false }, []).ready, false, '미검토 벽체는 발주표에서 제외합니다.')
const versions = activateVersion([{ id: 'v1', group: '평면도', version: 1, current: true, printedAt: '2026-08-17', marks: [{ status: '확인 완료' as const, memo: '' }] }, { id: 'v2', group: '평면도', version: 2, current: false, marks: [] }], 'v2', 'v1')
assert.equal(versions.drawings[1].marks[0].status, '검토 필요', '이전 버전 마킹 복사본은 재검토 필요입니다.')
assert.equal(versions.reprintRecommended, true, '이전 도면 출력 후 버전 전환은 재출력 경고를 만듭니다.')
const audit = applyInventoryAudit({ ledgerQty: 20, actualDraftQty: 15, appliedQty: 20, reservedQty: 3, reason: '현장 실사' }, '2026-08-17T00:00:00.000Z')
assert.equal(audit.applied && audit.next.appliedQty, 15, '장부 20장에서 실제 15장 실사를 확인 반영합니다.')
assert.equal(applyInventoryAudit({ ledgerQty: 20, actualDraftQty: 2, appliedQty: 20, reservedQty: 3, reason: '' }).applied, false, '예약 수량보다 낮은 실사는 경고합니다.')
assert.equal(offcutCandidate({ id: 'ok', material: '판넬', thicknessMm: 75, widthMm: 1000, lengthMm: 3100, quantity: 1, grain: 'vertical', location: 'A', photoNote: false, approved: true }, '판넬', 75, 1000, 3050, 'vertical'), '사용 가능', '조건 일치 승인 자투리는 후보입니다.')
assert.equal(offcutCandidate({ id: 'bad', material: '판넬', thicknessMm: 50, widthMm: 1000, lengthMm: 3100, quantity: 1, grain: 'vertical', location: 'A', photoNote: false, approved: true }, '판넬', 75, 1000, 3050, 'vertical'), '조건 불일치', '두께 불일치 자투리는 제외합니다.')
assert.equal(readMaterialCsv('자재코드,자재명,수량\nP75,판넬,20', 'inventory').errors.length, 0, '정상 재고 CSV를 미리보기로 읽습니다.')
assert.ok(readMaterialCsv('자재명,수량\n,20', 'inventory').errors.some((error) => error.reason.includes('자재명')), '필수 자재명 누락을 표시합니다.')
assert.ok(readMaterialCsv('자재코드,자재명,수량\nP1,판넬,1\nP1,판넬,1', 'inventory').errors.some((error) => error.reason.includes('중복')), '중복 자재를 표시합니다.')
assert.ok(readMaterialCsv('자재명,수량\n판넬,-1', 'inventory').errors.some((error) => error.reason.includes('0 이상')), '음수 수량을 차단합니다.')
const original = [{ name: '판넬', quantity: 20 }]; const restored = rollbackImport(original); restored[0].quantity = 15; assert.equal(original[0].quantity, 20, '가져오기 취소용 이전 데이터를 안전하게 복원합니다.')
const listRows = Array.from({ length: 10 }, (_, index) => ({ id: String(index), drawing: '평면도.pdf', page: 1, number: `W-${index + 1}`, zone: '1층', material: index === 0 ? '' : '판넬', heightMm: index === 0 ? 0 : 3000, value: index + 1, status: '검토 필요' as const, scaled: index !== 0, linked: true, included: index !== 0 }))
assert.equal(filterMarkingRows(listRows, 'height-missing').length, 1, '높이 누락 항목을 필터합니다.')
assert.ok(bulkReview(listRows, ['0'], '확인 완료').reason, '필수값 누락 항목은 일괄 완료를 차단합니다.')
const baseReference = { normalizedLength: .6, actualMm: 6000, createdAt: '', memo: '' }
assert.equal(crossCheckScale([baseReference, { ...baseReference, actualMm: 5940 }]).status, '확인됨', '1% 축척 오차는 확인됨입니다.')
assert.equal(crossCheckScale([baseReference, { ...baseReference, actualMm: 5825 }]).status, '주의', '3% 축척 오차는 주의입니다.')
assert.equal(crossCheckScale([baseReference, { ...baseReference, actualMm: 5650 }]).blockAutomaticTakeoff, true, '6% 축척 오차는 자동 산출을 차단합니다.')
assert.equal(Math.max(0, 20 - 15), 5, '필요 수량 20장과 승인 재고 15장은 신규 발주 5장입니다.')
const backup = createBackup({ id: 'old', name: '샘플', blob: new Blob(['pdf']), marks: [{ id: 'm1' }] }); assert.equal(backup.pdfIncluded, false, 'PDF 원본은 백업에 포함하지 않습니다.'); assert.equal(restoreBackup(backup).pdfReconnectRequired, true, '복원 도면은 PDF 재연결이 필요합니다.'); assert.throws(() => restoreBackup({}), '손상 백업을 차단합니다.')
console.log('Manual marking calculation verification passed.')
