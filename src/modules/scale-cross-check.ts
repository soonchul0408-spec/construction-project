export type ScaleStatus = '확인됨' | '주의' | '축척 재설정 필요'
export interface ScaleReference { normalizedLength: number; actualMm: number; createdAt: string; memo: string }
export function crossCheckScale(references: ScaleReference[], warningPercent = 2, resetPercent = 5) {
  const base = references[0]
  if (!base || base.normalizedLength <= 0 || base.actualMm <= 0) return { status: '축척 재설정 필요' as ScaleStatus, checks: [], blockAutomaticTakeoff: true }
  const mmPerUnit = base.actualMm / base.normalizedLength
  const checks = references.slice(1).map((reference) => { const expectedMm = reference.normalizedLength * mmPerUnit; const errorPercent = Math.abs(expectedMm - reference.actualMm) / reference.actualMm * 100; const status: ScaleStatus = errorPercent <= warningPercent ? '확인됨' : errorPercent <= resetPercent ? '주의' : '축척 재설정 필요'; return { expectedMm, errorPercent, status } })
  const status = checks.some((check) => check.status === '축척 재설정 필요') ? '축척 재설정 필요' : checks.some((check) => check.status === '주의') ? '주의' : '확인됨'
  return { status, checks, blockAutomaticTakeoff: status === '축척 재설정 필요' }
}
