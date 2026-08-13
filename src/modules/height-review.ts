import type { DimensionValue, HeightReviewAction } from '../types/domain'

export interface HeightReviewInput {
  action: HeightReviewAction
  valueMm?: number | null
  reason: string
  wallNumber?: string | null
  zone?: string | null
  reviewedBy?: string
  reviewedAt?: string
}

/**
 * Applies one human decision to a height dimension without changing the
 * drawing geometry. The original extraction remains in the dimension and the
 * audit record is persisted with the project.
 */
export function applyHeightReview(dimension: DimensionValue, input: HeightReviewInput): DimensionValue {
  const reviewedAt = input.reviewedAt || new Date().toISOString()
  const beforeValueMm = dimension.valueMm
  const hasReplacement = input.valueMm !== undefined && input.valueMm !== null && Number.isFinite(input.valueMm) && input.valueMm > 0
  const afterValueMm = hasReplacement ? input.valueMm as number : beforeValueMm
  const isIncluded = input.action === 'approved' || input.action === 'edited' || input.action === 'linked'
  const isHandwriting = input.action === 'marked-handwriting'
  const review: NonNullable<DimensionValue['heightReview']> = {
    action: input.action,
    beforeValueMm,
    afterValueMm,
    reason: input.reason.trim() || '사용자가 높이 후보를 확인했습니다.',
    reviewedAt,
    reviewedBy: input.reviewedBy || '현재 사용자',
    recalculatedAt: null,
  }

  const next: DimensionValue = {
    ...dimension,
    value: afterValueMm,
    normalizedValueMm: afterValueMm,
    valueMm: afterValueMm,
    displayValue: afterValueMm === null ? dimension.displayValue : String(afterValueMm),
    unit: 'mm',
    source: 'user',
    userEdited: true,
    originalValueMm: dimension.originalValueMm ?? beforeValueMm,
    userValueMm: afterValueMm,
    heightExcluded: !isIncluded,
    heightReviewAction: input.action,
    heightReview: review,
    manualWallNumber: input.wallNumber === undefined ? dimension.manualWallNumber || null : input.wallNumber,
    manualZone: input.zone === undefined ? dimension.manualZone || null : input.zone,
  }

  if (isHandwriting) {
    next.handwritingStatus = 'handwriting'
  }
  if (input.action === 'edited' && hasReplacement) {
    next.sourceType = 'calculated'
  }
  return next
}

export function markHeightReviewRecalculated(dimension: DimensionValue, recalculatedAt = new Date().toISOString()): DimensionValue {
  if (!dimension.heightReview) return dimension
  return {
    ...dimension,
    heightReview: {
      ...dimension.heightReview,
      recalculatedAt,
    },
  }
}
