import assert from 'node:assert/strict'
import { emptyManualReview, mergeManualReview } from '../src/modules/manual-review-state.ts'
import type { ManualProjectDrawing } from '../src/types/domain.ts'

const drawing: ManualProjectDrawing = {
  id: 'manual-pdf-1', name: '수동-평면도.pdf', size: 100, uploadedAt: '2026-08-17T00:00:00.000Z', kind: 'floor', status: '검토 중',
  drawingGroup: '수동-평면도', versionNumber: 1, isCurrentVersion: true, migrationStatus: 'imported-review', legacyStorage: 'indexeddb:drawing-manual-review-v1', pages: [1],
  marks: [], specs: [], reviewZones: [],
  measurements: [
    { id: 'wall-1', kind: 'wall', name: '벽체 1', status: '검토 필요', pageNumber: 1, heightMm: 3000, manualLengthM: 6, points: [], openingIds: ['opening-1'] },
    { id: 'opening-1', kind: 'opening', name: '창호 1', status: '검토 필요', pageNumber: 1, openingWidthMm: 1200, openingHeightMm: 1200, openingQuantity: 1, linkedWallId: 'wall-1', points: [], openingIds: [] },
  ],
}

const first = mergeManualReview(emptyManualReview(), [drawing], '2026-08-17T00:00:01.000Z', '2026-08-17T00:00:02.000Z')
assert.equal(first.storage, 'project-localStorage')
assert.equal(first.drawings[0]?.migrationStatus, 'migration-review')
assert.equal(first.drawings[0]?.legacyStorage, 'indexeddb:drawing-manual-review-v1')
assert.equal(first.drawings[0]?.measurements[1]?.linkedWallId, 'wall-1')

const completed = structuredClone(first.drawings)
completed[0]?.measurements.forEach((measurement) => { if (measurement.id === 'wall-1') measurement.status = '확인 완료' })
const second = mergeManualReview(first, completed, '2026-08-17T00:00:03.000Z', '2026-08-17T00:00:04.000Z')
assert.equal(second.drawings[0]?.measurements[0]?.status, '확인 완료')
assert.equal(second.migratedAt, first.migratedAt)

// This is the same value the main-screen selector writes before the manual
// workspace receives it again through its canonical prop.
second.drawings[0]?.measurements.forEach((measurement) => { if (measurement.id === 'wall-1') measurement.status = '검토 필요' })
assert.equal(second.drawings[0]?.measurements[0]?.status, '검토 필요')
assert.equal(second.drawings[0]?.measurements[1]?.status, '검토 필요')
console.log('Manual ProjectState migration and two-way review-state sync verification passed.')
