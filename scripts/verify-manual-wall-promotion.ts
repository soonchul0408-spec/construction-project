import assert from 'node:assert/strict'
import { promotedManualWall, promotionReasons } from '../src/modules/manual-wall-promotion.ts'
import type { ManualProjectDrawing } from '../src/types/domain.ts'
const drawing = { id: 'd', name: 'manual.pdf', size: 1, uploadedAt: '', kind: 'floor', status: '검토 중', drawingGroup: 'd', versionNumber: 1, isCurrentVersion: true, migrationStatus: 'imported-review', legacyStorage: 'indexeddb:drawing-manual-review-v1', pages: [1], marks: [], reviewZones: [], specs: [], measurements: [{ id: 'w', kind: 'wall', name: 'W-M1', status: '확인 완료', pageNumber: 1, manualLengthM: 6, heightMm: 3000, material: '패널', points: [], openingIds: ['o'] }, { id: 'o', kind: 'opening', name: '창', status: '확인 완료', pageNumber: 1, linkedWallId: 'w', openingWidthMm: 1000, openingHeightMm: 1000, openingQuantity: 1, points: [], openingIds: [] }] } satisfies ManualProjectDrawing
assert.equal(promotionReasons(drawing, drawing.measurements[0]!).length, 0)
assert.equal(promotedManualWall(drawing, 'w')?.openings.length, 1)
const blocked = structuredClone(drawing); blocked.measurements[0]!.heightMm = 0
assert.ok(promotionReasons(blocked, blocked.measurements[0]!).includes('양수 높이 필요'))
console.log('Manual wall promotion verification passed.')
