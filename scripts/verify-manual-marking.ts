import assert from 'node:assert/strict'
import { calculateManualMarking, createPageScale, measuredAreaM2, measuredLengthMm, reviewZoneWarnings, snapshotPreset } from '../src/modules/manual-marking-calculator.ts'

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
console.log('Manual marking calculation verification passed.')
