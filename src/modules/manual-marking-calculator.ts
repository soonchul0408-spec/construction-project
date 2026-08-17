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

export interface MeasurementPoint { x: number; y: number }
export interface PageScale {
  start: MeasurementPoint
  end: MeasurementPoint
  referenceMm: number
  /** Normalized PDF-space pixels per mm; invariant when preview zoom changes. */
  normalizedPxPerMm: number
}

export interface PresetSnapshot {
  presetId: string
  presetName: string
  material: string
  heightMm: number
  effectiveWidthMm: number
  color: string
  status: '검토 필요' | '확인 완료'
}

/** Copy values so later preset edits/deletes never mutate completed markings. */
export function snapshotPreset(preset: PresetSnapshot): PresetSnapshot {
  return { ...preset }
}

export interface ReviewZoneTestItem { status: '검토 필요' | '확인 완료'; heightMm?: number; material?: string; kind?: 'wall' | 'opening'; linked?: boolean }
export function reviewZoneWarnings(items: ReviewZoneTestItem[], hasScale: boolean): string[] {
  const warnings: string[] = []
  if (!hasScale) warnings.push('축척 미설정')
  if (items.some((item) => item.kind !== 'opening' && !positive(item.heightMm))) warnings.push('높이 누락')
  if (items.some((item) => item.kind !== 'opening' && !item.material?.trim())) warnings.push('자재 누락')
  if (items.some((item) => item.kind === 'opening' && !item.linked)) warnings.push('개구부 미확인')
  return warnings
}

export function validatedOpeningAreaM2(widthMm: number, heightMm: number, quantity: number, wallAreaM2: number, linkedWallCount: number, status: '검토 필요' | '확인 완료') {
  const areaM2 = positive(widthMm) * positive(heightMm) * Math.max(1, positive(quantity)) / 1_000_000
  if (status !== '확인 완료') return { ready: false, areaM2: 0, reason: '검토 완료된 개구부만 차감합니다.' }
  if (!areaM2) return { ready: false, areaM2: 0, reason: '개구부 가로·세로·수량을 입력하세요.' }
  if (linkedWallCount !== 1) return { ready: false, areaM2: 0, reason: linkedWallCount ? '개구부가 여러 벽체에 중복 연결되었습니다.' : '연결된 벽체가 없습니다.' }
  if (areaM2 > positive(wallAreaM2)) return { ready: false, areaM2: 0, reason: '개구부 면적이 벽체 면적보다 큽니다.' }
  return { ready: true, areaM2: Number(areaM2.toFixed(3)), reason: null }
}

const distance = (a: MeasurementPoint, b: MeasurementPoint) => Math.hypot(a.x - b.x, a.y - b.y)

export function createPageScale(start: MeasurementPoint, end: MeasurementPoint, referenceMm: number): PageScale | null {
  const reference = positive(referenceMm)
  const normalizedDistance = distance(start, end)
  if (!reference || !normalizedDistance) return null
  return { start, end, referenceMm: reference, normalizedPxPerMm: normalizedDistance / reference }
}

export function measuredLengthMm(points: MeasurementPoint[], scale?: PageScale): number | null {
  if (!scale || points.length < 2 || !scale.normalizedPxPerMm) return null
  const normalizedLength = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0)
  if (!normalizedLength) return null
  return Number((normalizedLength / scale.normalizedPxPerMm).toFixed(1))
}

export function measuredAreaM2(points: MeasurementPoint[], scale?: PageScale): number | null {
  if (!scale || points.length < 3 || !scale.normalizedPxPerMm) return null
  const signedArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2
  const areaMm2 = Math.abs(signedArea) / (scale.normalizedPxPerMm ** 2)
  return Number((areaMm2 / 1_000_000).toFixed(3))
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
  if (openingAreaM2 > grossAreaM2) return { ready: false, grossAreaM2, netAreaM2: 0, panelCount: 0, reason: '개구부 면적이 벽체 면적보다 큽니다. 원본 도면을 다시 확인하세요.' }
  const netAreaM2 = Math.max(0, Number((grossAreaM2 - openingAreaM2).toFixed(3)))
  const panelAreaM2 = heightMm / 1000 * effectiveWidthMm / 1000
  return { ready: true, grossAreaM2, netAreaM2, panelCount: Math.ceil(netAreaM2 / panelAreaM2), reason: null }
}
