import type { ManualProjectDrawing, ManualReviewState } from '../types/domain'

export function emptyManualReview(): ManualReviewState {
  return { storage: 'project-localStorage', migratedAt: null, legacyReadAt: null, drawings: [] }
}

/**
 * Retains the legacy IndexedDB reference while making the serializable review
 * record in ProjectState the canonical value. New or incomplete migrations are
 * deliberately left in migration-review rather than auto-confirmed.
 */
export function mergeManualReview(
  previous: ManualReviewState,
  drawings: ManualProjectDrawing[],
  legacyReadAt: string,
  now = new Date().toISOString(),
): ManualReviewState {
  const known = new Map(previous.drawings.map((drawing) => [drawing.id, drawing]))
  return {
    storage: 'project-localStorage',
    migratedAt: previous.migratedAt || now,
    legacyReadAt,
    drawings: drawings.map((drawing) => ({
      ...drawing,
      migrationStatus: known.has(drawing.id) ? known.get(drawing.id)?.migrationStatus || 'imported-review' : 'migration-review',
    })),
  }
}
