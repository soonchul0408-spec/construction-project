import type { ManualProjectDrawing, Opening, Wall } from '../types/domain'

const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0

export function promotionReasons(drawing: ManualProjectDrawing, wall: ManualProjectDrawing['measurements'][number]) {
  const reasons: string[] = []
  if (wall.status !== '확인 완료') reasons.push('검토 완료되지 않음')
  if (!positive(wall.manualLengthM)) reasons.push('양수 길이 필요')
  if (!positive(wall.heightMm)) reasons.push('양수 높이 필요')
  if (!String(wall.material || '').trim()) reasons.push('자재 지정 필요')
  if (!drawing.pages.includes(wall.pageNumber)) reasons.push('축척 설정 필요')
  const openings = drawing.measurements.filter((item) => item.kind === 'opening' && item.linkedWallId === wall.id)
  if (openings.some((item) => item.status !== '확인 완료' || !positive(item.openingWidthMm) || !positive(item.openingHeightMm))) reasons.push('연결 개구부 검토·규격 확인 필요')
  return reasons
}

export function promotedManualWall(drawing: ManualProjectDrawing, measurementId: string): Wall | null {
  const wall = drawing.measurements.find((item) => item.id === measurementId && item.kind === 'wall')
  if (!wall || promotionReasons(drawing, wall).length) return null
  const evidence = { fileId: drawing.id, fileName: drawing.name, pageNumber: wall.pageNumber, drawingKind: 'unknown' as const, method: 'user' as const, note: '검토 완료 수동 벽체 승격' }
  const openings: Opening[] = drawing.measurements.filter((item) => item.kind === 'opening' && item.linkedWallId === wall.id).map((item) => ({ id: `manual-opening-${item.id}`, type: 'opening', label: item.name, widthMm: Number(item.openingWidthMm), heightMm: Number(item.openingHeightMm), sillHeightMm: 0, offsetMm: 0, areaM2: Number((Number(item.openingWidthMm) * Number(item.openingHeightMm) * Math.max(1, Number(item.openingQuantity || 1)) / 1e6).toFixed(3)), confidence: 'medium', evidence: [evidence], excludedFromAutomaticTakeoff: false }))
  return { id: `manual-wall-${drawing.id}-${wall.id}`, zone: '수동 검토', zoneName: '수동 검토', number: wall.name, wallNumber: wall.name, lengthMm: Number(wall.manualLengthM) * 1000, heightMm: Number(wall.heightMm), heightStatus: 'known', openings, confidence: 'medium', evidence: [evidence], sourceReferences: [evidence], sourceDimensionIds: [], reviewStatus: 'verified', geometryStart: { x: 0, z: 0 }, geometryEnd: { x: Number(wall.manualLengthM), z: 0 }, geometrySource: 'dimension-layout', color: '#0f766e', conflicts: [], manualSource: { drawingId: drawing.id, measurementId: wall.id, versionNumber: drawing.versionNumber, pageNumber: wall.pageNumber, material: String(wall.material), stale: false } }
}
