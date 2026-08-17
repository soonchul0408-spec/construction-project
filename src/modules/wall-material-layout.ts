export interface PanelCatalogItem { id: string; name: string; thicknessMm: number; effectiveWidthMm: number; standardLengthMm: number; direction: 'vertical' | 'horizontal'; cuttingAllowanceMm: number; unitPrice: number }
export interface StockPiece { id: string; catalogId: string; thicknessMm: number; lengthMm: number; direction: 'vertical' | 'horizontal'; rotatable: boolean; approved: boolean }
export interface WallLayoutInput { lengthM: number; heightMm: number; netAreaM2: number; reviewed: boolean; catalog?: PanelCatalogItem }

const positive = (value: number) => Number.isFinite(value) && value > 0 ? value : 0
export function planWallMaterial(input: WallLayoutInput, stock: StockPiece[]) {
  const catalog = input.catalog
  if (!input.reviewed || !catalog || !positive(input.lengthM) || !positive(input.heightMm) || !positive(input.netAreaM2)) return { ready: false, reason: '검토 완료·자재 규격·벽체 치수·순면적을 확인하세요.', panelCount: 0, requiredLengthMm: 0, stockCandidates: [], approvedStock: 0, orderCount: 0, wasteMm: 0, cost: 0 }
  const panelCount = catalog.direction === 'vertical' ? Math.ceil(input.lengthM * 1000 / catalog.effectiveWidthMm) : Math.ceil(input.heightMm / catalog.effectiveWidthMm)
  const requiredLengthMm = (catalog.direction === 'vertical' ? input.heightMm : input.lengthM * 1000) + catalog.cuttingAllowanceMm
  const stockCandidates = stock.map((piece) => ({ piece, status: piece.catalogId !== catalog.id || piece.thicknessMm !== catalog.thicknessMm || (piece.direction !== catalog.direction && !piece.rotatable) || piece.lengthMm < requiredLengthMm ? '조건 불일치' : piece.approved ? '사용 가능' : '사람 확인 필요' }))
  const approvedStock = stockCandidates.filter((candidate) => candidate.status === '사용 가능').slice(0, panelCount)
  const orderCount = Math.max(0, panelCount - approvedStock.length)
  return { ready: true, reason: null, panelCount, requiredLengthMm, stockCandidates, approvedStock: approvedStock.length, orderCount, wasteMm: approvedStock.reduce((sum, candidate) => sum + candidate.piece.lengthMm - requiredLengthMm, 0) + orderCount * Math.max(0, catalog.standardLengthMm - requiredLengthMm), cost: orderCount * catalog.unitPrice, newOrderOnlyCost: panelCount * catalog.unitPrice }
}
