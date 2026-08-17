export interface InventoryAudit { ledgerQty: number; actualDraftQty: number; appliedQty: number; reservedQty: number; reason: string; auditedAt?: string }
export interface Offcut { id: string; material: string; thicknessMm: number; widthMm: number; lengthMm: number; quantity: number; grain: 'vertical' | 'horizontal'; location: string; photoNote: boolean; approved: boolean }
const valid = (value: number) => Number.isFinite(value) && value >= 0
export function applyInventoryAudit(audit: InventoryAudit, now = new Date().toISOString()) {
  if (!valid(audit.actualDraftQty)) return { applied: false, reason: '실사 수량은 0 이상이어야 합니다.', next: audit }
  if (audit.actualDraftQty < audit.reservedQty) return { applied: false, reason: '승인 예약 수량보다 적습니다. 절단 계획을 먼저 확인하세요.', next: audit }
  return { applied: true, reason: null, next: { ...audit, appliedQty: audit.actualDraftQty, auditedAt: now } }
}
export function offcutCandidate(offcut: Offcut, material: string, thicknessMm: number, widthMm: number, lengthMm: number, direction: 'vertical' | 'horizontal') {
  if (!offcut.approved) return '사람 확인 필요'
  if (!offcut.material || !offcut.thicknessMm || !offcut.widthMm || !offcut.lengthMm || !offcut.location) return '사람 확인 필요'
  return offcut.material === material && offcut.thicknessMm === thicknessMm && offcut.widthMm >= widthMm && offcut.lengthMm >= lengthMm && offcut.grain === direction ? '사용 가능' : '조건 불일치'
}
