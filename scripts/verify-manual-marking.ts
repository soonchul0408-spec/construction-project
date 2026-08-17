import assert from 'node:assert/strict'
import { calculateManualMarking } from '../src/modules/manual-marking-calculator.ts'

const sample = calculateManualMarking({ lengthM: 10, heightMm: 3000, openingAreaM2: 2, effectiveWidthMm: 1000, status: '확인 완료' })
assert.equal(sample.grossAreaM2, 30, '10m × 3,000mm 벽체는 30㎡입니다.')
assert.equal(sample.netAreaM2, 28, '개구부 2㎡를 차감한 순면적은 28㎡입니다.')
assert.equal(sample.panelCount, 10, '3m × 유효폭 1m 판넬은 예상 10장입니다.')
const pending = calculateManualMarking({ lengthM: 10, heightMm: 3000, openingAreaM2: 2, effectiveWidthMm: 1000, status: '검토 필요' })
assert.equal(pending.ready, false, '검토 필요 마킹은 산출에서 제외합니다.')
console.log('Manual marking calculation verification passed.')
