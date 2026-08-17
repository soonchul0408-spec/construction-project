export interface MarkingCalculationInput {
  lengthM: number
  heightMm: number
  openingAreaM2: number
  effectiveWidthMm: number
  status: '검토 필요' | '확인 완료'
}

export interface MarkingCalculation {
  ready: boolean
  grossAreaM2: number
  netAreaM2: number
  panelCount: number
  reason: string | null
}

const positive = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * A drawing mark only identifies a zone visually. Quantities deliberately use
 * user-confirmed dimensions rather than the pixel area of the mark.
 */
export function calculateManualMarking(input: MarkingCalculationInput): MarkingCalculation {
  const lengthM = positive(input.lengthM)
  const heightMm = positive(input.heightMm)
  const effectiveWidthMm = positive(input.effectiveWidthMm)
  const openingAreaM2 = Math.max(0, Number(input.openingAreaM2) || 0)
  if (input.status !== '확인 완료') return { ready: false, grossAreaM2: 0, netAreaM2: 0, panelCount: 0, reason: '검토 완료된 마킹만 산출에 반영합니다.' }
  if (!lengthM || !heightMm || !effectiveWidthMm) return { ready: false, grossAreaM2: 0, netAreaM2: 0, panelCount: 0, reason: '벽체 길이·높이·판넬 유효 폭을 입력하세요.' }
  const grossAreaM2 = Number((lengthM * heightMm / 1000).toFixed(3))
  const netAreaM2 = Math.max(0, Number((grossAreaM2 - openingAreaM2).toFixed(3)))
  const panelAreaM2 = heightMm / 1000 * effectiveWidthMm / 1000
  return { ready: true, grossAreaM2, netAreaM2, panelCount: Math.ceil(netAreaM2 / panelAreaM2), reason: null }
}
