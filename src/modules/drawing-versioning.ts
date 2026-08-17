export interface VersionedMark { status: '검토 필요' | '확인 완료'; memo: string }
export interface VersionedDrawing<T extends VersionedMark = VersionedMark> { id: string; group: string; version: number; current: boolean; marks: T[]; printedAt?: string }
export function activateVersion<T extends VersionedMark>(drawings: VersionedDrawing<T>[], nextId: string, copyFromId?: string) {
  const next = drawings.find((drawing) => drawing.id === nextId)
  if (!next) return { drawings, reprintRecommended: false }
  const previous = drawings.find((drawing) => drawing.group === next.group && drawing.current)
  drawings.forEach((drawing) => { if (drawing.group === next.group) drawing.current = drawing.id === nextId })
  if (copyFromId) { const source = drawings.find((drawing) => drawing.id === copyFromId); if (source) next.marks = source.marks.map((mark) => ({ ...mark, status: '검토 필요', memo: `${mark.memo ? `${mark.memo} · ` : ''}이전 도면에서 가져온 값 / 재확인 필요` })) as T[] }
  return { drawings, reprintRecommended: Boolean(previous?.printedAt) }
}
