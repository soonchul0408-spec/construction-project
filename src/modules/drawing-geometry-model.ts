import type {
  AnalyzedFile,
  BuildingGeometry,
  ConfidenceLevel,
  DimensionValue,
  DimensionConflict,
  Opening,
  Wall,
} from '../types/domain'
import { isCostSummaryPage } from './cost-summary-parser.ts'

const ZONE_COLORS = ['#2f6fed', '#c97935', '#16836d', '#9b59b6', '#bb4d70', '#3c8799']

function confidenceRank(confidence: ConfidenceLevel) {
  return confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1
}

function lowerConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return confidenceRank(a) <= confidenceRank(b) ? a : b
}

function dimensionKind(dimension: DimensionValue) {
  return dimension.evidence[0]?.drawingKind || 'unknown'
}

function openingTokenFromDimension(dimension: DimensionValue) {
  const sourceIndex = dimension.context.lastIndexOf(dimension.sourceText)
  const matches = [...dimension.context.matchAll(/\b([DW]\s*[-#]?\s*\d+)\b/gi)]
    .map((match) => ({ token: match[1]?.replace(/\s+/g, '').toUpperCase() || '', index: match.index || 0 }))
    .filter((match) => match.token && !/(?:\bWALL(?:\s+NO\.?)?|\b벽체(?:\s+번호)?|\bAXIS|\bGRID|\b축|\b그리드)\s*$/i.test(dimension.context.slice(0, match.index)))
  if (!matches.length) return null
  return [...matches].sort((a, b) => Math.abs(a.index - sourceIndex) - Math.abs(b.index - sourceIndex))[0]?.token || null
}

function openingTypeFromText(dimension: DimensionValue) {
  const sourceIndex = dimension.context.lastIndexOf(dimension.sourceText)
  const nearbyText = sourceIndex >= 0
    ? dimension.context.slice(Math.max(0, sourceIndex - 20), sourceIndex + dimension.sourceText.length + 20)
    : dimension.context
  if (/(문|door)/i.test(nearbyText)) return 'door' as const
  if (/(창|window)/i.test(nearbyText)) return 'window' as const
  return null
}

function isOpeningDimension(dimension: DimensionValue) {
  return Boolean(openingTokenFromDimension(dimension) || openingTypeFromText(dimension))
}

function isHeightDimension(dimension: DimensionValue) {
  if (isOpeningDimension(dimension)) return false
  if (dimension.heightRole === 'level') return false
  return dimension.heightRole === 'direct' || dimension.heightRole === 'level-calculated' || dimension.label === '높이 후보' ||
    /(벽체\s*높이|wall\s*height|층고|천장고|height|\bH\s*[:=]|\bHT\s*[:=]?)/i.test(dimension.context) ||
    (['elevation', 'section'].includes(dimensionKind(dimension)) && dimension.valueMm !== null && dimension.valueMm >= 1800 && dimension.valueMm <= 20000)
}

/** Shared with the height diagnostic panel so extraction and linking use the
 * same definition of a height candidate. */
export function isHeightDimensionCandidate(dimension: DimensionValue) {
  return isHeightDimension(dimension)
}

function isLengthDimension(dimension: DimensionValue) {
  return dimension.valueMm !== null &&
    dimension.valueMm >= 500 &&
    !isOpeningDimension(dimension) &&
    !isHeightDimension(dimension) &&
    !['cost-summary', 'material-schedule'].includes(dimensionKind(dimension))
}

function isUsableHeightDimension(dimension: DimensionValue) {
  return isHeightDimension(dimension) &&
    !dimension.heightExcluded &&
    dimension.valueMm !== null &&
    dimension.valueMm >= 1800 &&
    dimension.valueMm <= 20000
}

function isSafeHeightDimension(dimension: DimensionValue) {
  return isUsableHeightDimension(dimension) &&
    dimension.confidence !== 'low' &&
    dimension.handwritingStatus !== 'handwriting' &&
    dimension.handwritingStatus !== 'uncertain' &&
    dimension.evidence[0]?.handwritingStatus !== 'handwriting' &&
    dimension.evidence[0]?.handwritingStatus !== 'uncertain'
}

function zoneMatches(context: string) {
  const pattern = /((?:[A-Z가-힣]?\s*[-\d]+\s*)?구역|ZONE\s*[A-Z0-9-]+|[1-9]\s*층)/gi
  return [...context.matchAll(pattern)].map((match) => ({
    value: match[1]?.replace(/\s+/g, ' ').trim() || '',
    index: match.index || 0,
  })).filter((match) => match.value)
}

function zoneFromContext(context: string, sourceText?: string) {
  const matches = zoneMatches(context)
  if (!matches.length) return '구역 미확인'
  // Text extraction often puts the next zone in the same nearby context. The
  // zone immediately before the number is the reliable association for both
  // a wall dimension and a zone-specific elevation/section height.
  const valueIndex = sourceText ? context.lastIndexOf(sourceText) : context.search(/\d[\d.,]*(?:\s*(?:mm|㎜|cm|㎝|m|미터))?/i)
  const preceding = valueIndex >= 0 ? matches.filter((match) => match.index < valueIndex) : []
  return (preceding[preceding.length - 1] || matches[0]).value
}

function wallNumberFromContext(context: string, index: number) {
  return explicitWallNumberFromContext(context) || `W-${String(index + 1).padStart(2, '0')}`
}

function labeledWallNumberFromContext(context: string) {
  const tokenWithDigit = '((?=[A-Z0-9-]*\\d)[A-Z0-9]+(?:-[A-Z0-9]+)*)'
  const labeled = context.match(new RegExp(`(?:벽체|WALL)\\s*(?:NO\\.?|번호)?\\s*[-#:]?\\s*(?:W\\s*[-#]?\\s*)?${tokenWithDigit}`, 'i'))
  const value = labeled?.[1]?.toUpperCase()
  return value ? `W-${value.replace(/^W-?/, '')}` : null
}

function explicitWallNumberFromContext(context: string) {
  const labeled = labeledWallNumberFromContext(context)
  if (labeled) return labeled
  const tokenWithDigit = '((?=[A-Z0-9-]*\\d)[A-Z0-9]+(?:-[A-Z0-9]+)*)'
  const bare = context.match(new RegExp(`\\bW\\s*[-#]?\\s*${tokenWithDigit}\\b`, 'i'))
  const value = bare?.[1]?.toUpperCase()
  return value ? `W-${value.replace(/^W-?/, '')}` : null
}

function dimensionSourceContext(dimension: DimensionValue) {
  const evidenceText = dimension.evidence
    .map((item) => item.rawText || '')
    .find((text) => text.includes(dimension.sourceText) && /(?:ZONE|구역|벽체|WALL|축|AXIS|GRID|문|DOOR|창|WINDOW|폭|WIDTH|높이|HEIGHT|OFFSET|창대|SILL)/i.test(text))
  if (evidenceText) return evidenceText
  const sourceIndex = dimension.context.lastIndexOf(dimension.sourceText)
  if (sourceIndex < 0) return dimension.context
  const precedingZones = zoneMatches(dimension.context).filter((match) => match.index < sourceIndex)
  const latestZone = precedingZones.at(-1)
  return latestZone ? dimension.context.slice(latestZone.index) : dimension.context
}

function openingWallNumberFromDimension(dimension: DimensionValue) {
  const sourceContext = dimensionSourceContext(dimension)
  // A bare W-1 beside WINDOW is the opening label, not a wall target. Only an
  // explicit WALL/벽체 label can constrain an opening to a wall number.
  return labeledWallNumberFromContext(sourceContext)
}

function axisFromDimension(dimension: DimensionValue) {
  const sourceContext = dimensionSourceContext(dimension)
  const sourceIndex = sourceContext.lastIndexOf(dimension.sourceText)
  const matches = [...sourceContext.matchAll(/(?:축|AXIS|GRID)\s*[:#]?\s*([A-Z0-9]+(?:\s*[-/]\s*[A-Z0-9]+)?)/gi)]
    .map((match) => ({ value: (match[1] || '').replace(/\s+/g, '').toUpperCase(), index: match.index || 0 }))
    .filter((match) => match.value)
  if (!matches.length) return null
  return [...matches].sort((a, b) => Math.abs(a.index - sourceIndex) - Math.abs(b.index - sourceIndex))[0]?.value || null
}

function openingTypeFromDimension(dimension: DimensionValue) {
  const token = openingTokenFromDimension(dimension)
  if (token?.startsWith('D')) return 'door' as const
  if (token?.startsWith('W')) return 'window' as const
  return openingTypeFromText(dimension)
}

function valueFollowsKeyword(dimension: DimensionValue, keywordPattern: RegExp) {
  const valueIndex = dimension.context.indexOf(dimension.sourceText)
  if (valueIndex < 0) return false
  const keywordMatch = keywordPattern.exec(dimension.context)
  keywordPattern.lastIndex = 0
  return Boolean(keywordMatch && keywordMatch.index < valueIndex && valueIndex - keywordMatch.index < 24)
}

function preferredHeightCandidates(wallDimension: DimensionValue, dimensions: DimensionValue[], wallNumber: string) {
  const allCandidates = dimensions.filter(isUsableHeightDimension)
  if (!allCandidates.length) return []
  const wallZone = zoneFromContext(wallDimension.context, wallDimension.sourceText)
  const manual = allCandidates.filter((candidate) => {
    const candidateZone = candidate.manualZone || zoneFromContext(candidate.context, candidate.sourceText)
    return candidate.manualWallNumber?.toLowerCase() === wallNumber.toLowerCase() &&
      candidateZone.toLowerCase() === wallZone.toLowerCase()
  })
  if (manual.length) return [...manual].sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
  const explicitlyLinked = allCandidates.filter((candidate) => explicitWallNumberFromContext(candidate.context)?.toLowerCase() === wallNumber.toLowerCase())
  if (explicitlyLinked.length) return [...explicitlyLinked].sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
  const candidates = allCandidates.filter((candidate) => !explicitWallNumberFromContext(candidate.context))
  const samePage = candidates.filter((candidate) => {
    const wallEvidence = wallDimension.evidence[0]
    const heightEvidence = candidate.evidence[0]
    return wallEvidence?.fileId === heightEvidence?.fileId && wallEvidence?.pageNumber === heightEvidence?.pageNumber
  })
  const sameZone = candidates.filter((candidate) => {
    return wallZone !== '구역 미확인' && zoneFromContext(candidate.context, candidate.sourceText).toLowerCase() === wallZone.toLowerCase()
  })
  const samePageSameZone = samePage.filter((candidate) => wallZone !== '구역 미확인' && zoneFromContext(candidate.context, candidate.sourceText).toLowerCase() === wallZone.toLowerCase())
  const sameZoneElevation = sameZone.filter((candidate) => dimensionKind(candidate) === 'elevation')
  const sameZoneSection = sameZone.filter((candidate) => dimensionKind(candidate) === 'section')
  const preferred = samePageSameZone.length
    ? samePageSameZone
    : samePage.length === 1
      ? samePage
      : sameZoneElevation.length
        ? sameZoneElevation
        : sameZoneSection.length
          ? sameZoneSection
          : sameZone.length
            ? sameZone
            : []
  return [...preferred].sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
}

function significantValueDifference(values: DimensionValue[]) {
  const numeric = values.map((value) => value.valueMm).filter((value): value is number => value !== null)
  if (numeric.length < 2) return false
  const minimum = Math.min(...numeric)
  const maximum = Math.max(...numeric)
  return maximum - minimum > Math.max(5, maximum * 0.005)
}

function makeDimensionConflict(kind: DimensionConflict['kind'], id: string, values: DimensionValue[], reason: string): DimensionConflict | undefined {
  const usable = values.filter((value) => value.valueMm !== null)
  if (!significantValueDifference(usable)) return undefined
  return {
    id,
    kind,
    reason,
    values: usable.map((value) => ({
      dimensionId: value.id,
      valueMm: value.valueMm as number,
      displayValue: value.displayValue,
      confidence: value.confidence,
      evidence: value.evidence,
    })),
  }
}

function sourcePageForDimension(files: AnalyzedFile[], dimension: DimensionValue) {
  const evidence = dimension.evidence[0]
  if (!evidence) return null
  return files.find((file) => file.id === evidence.fileId)?.pages.find((page) => page.pageNumber === evidence.pageNumber) || null
}

function vectorScaleMmPerPageUnit(page: NonNullable<ReturnType<typeof sourcePageForDimension>>) {
  const scale = (page.scales || []).find((finding) => finding.numericRatio && finding.numericRatio > 0)?.numericRatio
  return scale ? (25.4 / 72) / scale : null
}

function vectorBounds(page: NonNullable<ReturnType<typeof sourcePageForDimension>>) {
  const points = (page.vectorSegments || []).flatMap((segment) => [segment.start, segment.end])
  return {
    minX: Math.min(...points.map((point) => point.x), 0),
    maxY: Math.max(...points.map((point) => point.y), page.height),
  }
}

function vectorForDimension(
  files: AnalyzedFile[],
  dimension: DimensionValue,
  usedVectorIds: Set<string>,
) {
  const page = sourcePageForDimension(files, dimension)
  const scaleMmPerUnit = page ? vectorScaleMmPerPageUnit(page) : null
  const segments = page?.vectorSegments || []
  if (!page || !scaleMmPerUnit || dimension.valueMm === null || segments.length === 0) return null
  const expectedPageLength = dimension.valueMm / scaleMmPerUnit
  return [...segments]
    .filter((segment) => !usedVectorIds.has(segment.id))
    .filter((segment) => segment.lengthPageUnits >= expectedPageLength * 0.65 && segment.lengthPageUnits <= expectedPageLength * 1.35)
    .sort((a, b) => Math.abs(a.lengthPageUnits - expectedPageLength) - Math.abs(b.lengthPageUnits - expectedPageLength))[0] || null
}

function geometryFromVector(
  files: AnalyzedFile[],
  dimension: DimensionValue,
  vector: NonNullable<ReturnType<typeof vectorForDimension>>,
) {
  const page = sourcePageForDimension(files, dimension)
  const scaleMmPerUnit = page ? vectorScaleMmPerPageUnit(page) : null
  if (!page || !scaleMmPerUnit || dimension.valueMm === null) return null
  const bounds = vectorBounds(page)
  const rawLength = vector.lengthPageUnits || 1
  const directionX = (vector.end.x - vector.start.x) / rawLength
  const directionZ = -(vector.end.y - vector.start.y) / rawLength
  const start = {
    x: ((vector.start.x - bounds.minX) * scaleMmPerUnit) / 1000,
    z: ((bounds.maxY - vector.start.y) * scaleMmPerUnit) / 1000,
  }
  const lengthM = dimension.valueMm / 1000
  return {
    start,
    end: {
      x: start.x + directionX * lengthM,
      z: start.z + directionZ * lengthM,
    },
  }
}

interface OpeningAssignment {
  zone?: string
  wallNumber?: string
  axis?: string
  pageKeys: Set<string>
  ambiguous: boolean
}

function buildOpenings(files: AnalyzedFile[], dimensions: DimensionValue[]) {
  const groups = new Map<string, { type: Opening['type']; token?: string; dimensions: DimensionValue[]; pageKeys: Set<string> }>()
  for (const dimension of dimensions) {
    const type = openingTypeFromDimension(dimension)
    const evidence = dimension.evidence[0]
    if (!type || !evidence) continue
    const token = openingTokenFromDimension(dimension) || undefined
    const pageKey = `${evidence.fileId}-${evidence.pageNumber}`
    // The opening label is the cross-document join key. A keyword-only
    // opening has no safe join key, so keep it local to its source page.
    const groupKey = token ? `${type}-${token}` : `${type}-default-${pageKey}`
    const group = groups.get(groupKey) || { type, token, dimensions: [], pageKeys: new Set<string>() }
    group.dimensions.push(dimension)
    group.pageKeys.add(pageKey)
    groups.set(groupKey, group)
  }
  const openings: Opening[] = []
  const assignments = new Map<string, OpeningAssignment>()
  for (const [groupKey, group] of groups.entries()) {
    const values = group.dimensions.filter((item) => item.valueMm !== null)
      .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
    const widthCandidates = values.filter((item) => valueFollowsKeyword(item, /(폭|\bwidth\b)/i))
    const widthValue = widthCandidates[0] || values[0]
    const heightCandidates = values.filter((item) => valueFollowsKeyword(item, /(높이|\bheight\b)/i) && item.id !== widthValue?.id)
    const heightValue = heightCandidates[0] || values.find((item) => item.id !== widthValue?.id)
    const offsetCandidates = values.filter((item) => valueFollowsKeyword(item, /(offset|벽끝|기준선|시작점|from|거리)/i))
    const sillCandidates = values.filter((item) => valueFollowsKeyword(item, /(창대|문턱|sill)/i))
    const offsetValue = offsetCandidates[0]
    const sillValue = sillCandidates[0]
    const widthMm = widthValue?.valueMm || null
    const heightMm = heightValue?.valueMm || null
    const widthConflict = makeDimensionConflict('opening', `opening-width-${groupKey}`, widthCandidates.length ? widthCandidates : (widthValue ? [widthValue] : []), '같은 개구부의 폭 치수가 서로 다릅니다.')
    const heightConflict = makeDimensionConflict('opening', `opening-height-${groupKey}`, heightCandidates.length ? heightCandidates : (heightValue ? [heightValue] : []), '같은 개구부의 높이 치수가 서로 다릅니다.')
    const offsetConflict = makeDimensionConflict('opening', `opening-offset-${groupKey}`, offsetCandidates, '같은 개구부 표기가 서로 다른 위치에 반복됩니다. 개구부 인스턴스 수와 각 offset을 확인해야 합니다.')
    const sillConflict = makeDimensionConflict('opening', `opening-sill-${groupKey}`, sillCandidates, '같은 개구부의 창대·문턱 높이가 서로 다릅니다.')
    const conflict = widthConflict || heightConflict || offsetConflict || sillConflict
    const evidence = values.flatMap((item) => item.evidence)
    const zones = group.dimensions
      .map((item) => zoneFromContext(item.context, item.sourceText))
      .filter((zone) => zone !== '구역 미확인')
    const uniqueZones = [...new Set(zones.map((value) => value.toLowerCase()))]
    const zone = uniqueZones.length === 1 ? zones[0] : undefined
    const wallNumbers = [...new Set(group.dimensions.map(openingWallNumberFromDimension).filter((value): value is string => Boolean(value)))]
    const axes = [...new Set(group.dimensions.map(axisFromDimension).filter((value): value is string => Boolean(value)))]
    const opening: Opening = {
      id: `opening-${groupKey}`,
      type: group.type,
      label: group.token || group.type,
      zone,
      widthMm,
      heightMm,
      sillHeightMm: sillValue?.valueMm || null,
      offsetMm: offsetValue?.valueMm || null,
      areaM2: widthMm && heightMm ? (widthMm * heightMm) / 1_000_000 : null,
      sourcePosition: widthValue?.sourcePosition || heightValue?.sourcePosition,
      confidence: conflict ? 'low' : values.length >= 2 ? values.reduce((current, item) => lowerConfidence(current, item.confidence), 'high' as ConfidenceLevel) : 'low',
      evidence,
      excludedFromAutomaticTakeoff: !widthMm || !heightMm || Boolean(conflict),
      conflict,
    }
    openings.push(opening)
    assignments.set(opening.id, {
      zone,
      wallNumber: wallNumbers.length === 1 ? wallNumbers[0] : undefined,
      axis: axes.length === 1 ? axes[0] : undefined,
      pageKeys: group.pageKeys,
      ambiguous: uniqueZones.length > 1 || wallNumbers.length > 1 || axes.length > 1,
    })
  }
  // Keep the argument in the adapter contract so a future vector parser can
  // contribute opening targets without changing the caller contract.
  void files
  return { openings, assignments }
}

export function buildWalls(files: AnalyzedFile[], dimensions: DimensionValue[]): Wall[] {
  const geometryDimensions = dimensions.filter((dimension) => !dimension.evidence.some((item) => item.drawingKind === 'cost-summary'))
  const builtOpenings = buildOpenings(files, geometryDimensions)
  const lengthDimensions = geometryDimensions.filter((dimension) => isLengthDimension(dimension))
  const planDimensions = lengthDimensions.filter((dimension) => dimensionKind(dimension) === 'floor-plan')
  const rawCandidates = planDimensions.length ? planDimensions : lengthDimensions
  // The same wall dimension is commonly repeated in a plan, elevation and a
  // detail page. A wall with an explicit W-xx label is one construction target,
  // not one target per occurrence. Keep every occurrence as evidence and only
  // create a conflict when the normalized values disagree.
  const candidateGroups = new Map<string, DimensionValue[]>()
  for (const dimension of rawCandidates) {
    const zone = zoneFromContext(dimension.context, dimension.sourceText)
    const explicitNumber = explicitWallNumberFromContext(dimension.context)
    const key = explicitNumber ? `${zone.toLowerCase()}|${explicitNumber}` : `dimension|${dimension.id}`
    const group = candidateGroups.get(key) || []
    group.push(dimension)
    candidateGroups.set(key, group)
  }
  const candidates = [...candidateGroups.values()].map((group) => [...group].sort((a, b) => {
    const kindScore = (dimensionKind(b) === 'floor-plan' ? 2 : 0) - (dimensionKind(a) === 'floor-plan' ? 2 : 0)
    return kindScore || confidenceRank(b.confidence) - confidenceRank(a.confidence)
  }))
  const wallCandidates = candidates.map((group, index) => {
    const dimension = group[0]
    const evidence = dimension?.evidence[0]
    if (!dimension || !evidence) return null
    return {
      index,
      pageKey: `${evidence.fileId}-${evidence.pageNumber}`,
      zone: zoneFromContext(dimension.context, dimension.sourceText),
      wallNumber: wallNumberFromContext(dimension.context, index),
      axis: axisFromDimension(dimension),
    }
  }).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
  const walls: Wall[] = []
  const zoneIndex = new Map<string, number>()
  const usedVectorIds = new Set<string>()
  let cursorX = 0
  let cursorZ = 0

  for (const [index, group] of candidates.entries()) {
    const dimension = group[0]
    if (!dimension) continue
    if (dimension.valueMm === null) continue
    const evidence = dimension.evidence[0]
    if (!evidence || evidence.drawingKind === 'cost-summary') continue
    const zone = zoneFromContext(dimension.context, dimension.sourceText)
    if (!zoneIndex.has(zone)) zoneIndex.set(zone, zoneIndex.size)
    const zoneColor = ZONE_COLORS[(zoneIndex.get(zone) || 0) % ZONE_COLORS.length]
    const wallNumber = wallNumberFromContext(dimension.context, index)
    const heightCandidates = preferredHeightCandidates(dimension, geometryDimensions, wallNumber)
    const safeHeightCandidates = heightCandidates.filter(isSafeHeightDimension)
    const lengthConflict = makeDimensionConflict('length', `wall-length-${zone}-${wallNumberFromContext(dimension.context, index)}`, group, '같은 벽체의 길이 치수가 서로 다릅니다.')
    const heightConflict = makeDimensionConflict('height', `wall-height-${zone}-${wallNumberFromContext(dimension.context, index)}`, heightCandidates, '연결된 입면도·단면도의 높이 치수가 서로 다릅니다.')
    // Never choose one side of a real height conflict. The wall remains
    // unmodelled until a person confirms which source is correct.
    const height = heightConflict ? null : safeHeightCandidates[0] || null
    const openings: Opening[] = []
    let openingAssignmentNeedsReview = false
    for (const opening of builtOpenings.openings) {
      const assignment = builtOpenings.assignments.get(opening.id)
      if (!assignment) continue
      const pageScopedCandidates = wallCandidates.filter((candidate) => assignment.pageKeys.has(candidate.pageKey))
      const zoneScopedCandidates = assignment.zone
        ? wallCandidates.filter((candidate) => candidate.zone.toLowerCase() === assignment.zone?.toLowerCase())
        : []
      // An explicit zone is a constraint, not a hint. Falling back to another
      // zone on the same page would subtract the opening from the wrong wall.
      const scopedCandidates = assignment.zone ? zoneScopedCandidates : pageScopedCandidates
      let targetCandidates = scopedCandidates
      if (assignment.wallNumber) {
        const wallNumberCandidates = wallCandidates.filter((candidate) => candidate.wallNumber.toLowerCase() === assignment.wallNumber?.toLowerCase())
        targetCandidates = scopedCandidates.filter((candidate) => candidate.wallNumber.toLowerCase() === assignment.wallNumber?.toLowerCase())
        if (!targetCandidates.length && !assignment.zone) targetCandidates = wallNumberCandidates
      }
      if (assignment.axis) {
        const axisCandidates = targetCandidates.filter((candidate) => candidate.axis === assignment.axis)
        targetCandidates = axisCandidates.length || assignment.wallNumber || assignment.zone
          ? axisCandidates
          : wallCandidates.filter((candidate) => candidate.axis === assignment.axis)
      }
      const currentIsScoped = scopedCandidates.some((candidate) => candidate.index === index)
      const unresolvedExplicitTarget = Boolean(assignment.zone || assignment.wallNumber || assignment.axis) && targetCandidates.length === 0
      if (assignment.ambiguous || targetCandidates.length !== 1) {
        if (currentIsScoped || (unresolvedExplicitTarget && pageScopedCandidates.some((candidate) => candidate.index === index))) openingAssignmentNeedsReview = true
        continue
      }
      if (targetCandidates[0]?.index === index) openings.push(opening)
    }
    const lengthM = dimension.valueMm / 1000
    const vector = vectorForDimension(files, dimension, usedVectorIds)
    const vectorGeometry = vector ? geometryFromVector(files, dimension, vector) : null
    if (vectorGeometry) usedVectorIds.add(vector.id)
    const start = vectorGeometry?.start || { x: cursorX, z: cursorZ }
    const end = vectorGeometry?.end || (index % 2 === 0
      ? { x: cursorX + lengthM, z: cursorZ }
      : { x: cursorX, z: cursorZ + lengthM })
    if (!vectorGeometry) {
      cursorX = end.x
      cursorZ = end.z
    }
    const confidenceFromDuplicate = group.reduce((current, item) => lowerConfidence(current, item.confidence), dimension.confidence)
    const confidence = height ? lowerConfidence(confidenceFromDuplicate, height.confidence) : confidenceFromDuplicate
    const openingConflicts = openings.flatMap((opening) => opening.conflict ? [opening.conflict] : [])
    const conflicts = [lengthConflict, heightConflict, ...openingConflicts].filter((item): item is DimensionConflict => Boolean(item))
    const sourceReferences = [
      ...group.flatMap((item) => item.evidence),
      ...(vector?.evidence || []),
      ...(height?.evidence || []).map((item) => ({ ...item, note: `높이 근거: ${height.displayValue}` })),
    ].filter((item, itemIndex, items) => items.findIndex((candidate) => candidate.fileId === item.fileId && candidate.pageNumber === item.pageNumber && candidate.method === item.method && candidate.rawText === item.rawText) === itemIndex)
    walls.push({
      id: `wall-${evidence.fileId}-${evidence.pageNumber}-${index}`,
      zone,
      zoneName: zone,
      number: wallNumber,
      wallNumber,
      lengthMm: dimension.valueMm,
      heightMm: height?.valueMm || null,
      heightStatus: height?.valueMm ? 'known' : 'missing',
      openings,
      confidence,
      evidence: sourceReferences,
      sourceReferences,
      sourceDimensionIds: [...group.map((item) => item.id), ...heightCandidates.map((item) => item.id)],
      reviewStatus: !height?.valueMm ? 'blocked' : conflicts.length || openingAssignmentNeedsReview || confidence !== 'high' ? 'review' : 'verified',
      geometryStart: start,
      geometryEnd: end,
      geometrySource: vectorGeometry ? 'drawing-vector' : 'dimension-layout',
      color: zoneColor,
      heightSourceDimensionId: height?.id,
      conflicts,
    })
  }
  return walls
}

function emptyRoof(): BuildingGeometry['roof'] {
  return {
    isReady: false,
    kind: 'unknown',
    heightMm: null,
    pitchDeg: null,
    evidence: [],
    blockedReason: '지붕 정보가 있는 입면도·단면도·지붕 상세도를 확인하지 못했습니다.',
  }
}

export function extractRoofGeometry(files: AnalyzedFile[], walls: Wall[]): BuildingGeometry['roof'] {
  const candidates = files.flatMap((file) => file.pages.map((page) => ({ file, page })))
    .filter(({ file, page }) => ['elevation', 'section', 'detail'].includes(page.kind) || /지붕|roof/i.test(`${file.name} ${page.text}`))
  const flat = candidates.find(({ file, page }) => /평지붕|flat\s*roof/i.test(`${file.name} ${page.text}`))
  const pitched = candidates.find(({ file, page }) => /박공지붕|경사지붕|gable\s*roof|shed\s*roof/i.test(`${file.name} ${page.text}`))
  if (!flat && !pitched) return emptyRoof()
  if (pitched) {
    return {
      isReady: false,
      kind: /박공지붕|gable\s*roof/i.test(`${pitched.file.name} ${pitched.page.text}`) ? 'gable' : 'shed',
      heightMm: null,
      pitchDeg: null,
      evidence: [{
        fileId: pitched.file.id,
        fileName: pitched.file.name,
        pageNumber: pitched.page.pageNumber,
        drawingKind: pitched.page.kind,
        method: pitched.page.dimensions.some((dimension) => dimension.sourceType === 'ocr') ? 'ocr' : 'pdf-text',
        rawText: pitched.page.text.match(/박공지붕|경사지붕|gable\s*roof|shed\s*roof/i)?.[0],
        note: '지붕 형태는 읽었지만 경사도·능선 위치가 없어 3D 생성에서 보류했습니다.',
      }],
      blockedReason: '지붕 형태는 확인했지만 경사도·능선 위치가 없어 지붕 geometry를 확정하지 않았습니다.',
    }
  }
  const heightDimension = flat?.page.dimensions.find((dimension) => /(지붕|roof|eave|처마)/i.test(`${dimension.label} ${dimension.context}`) && dimension.valueMm !== null)
  return {
    isReady: walls.length > 0 && heightDimension?.valueMm !== null && heightDimension?.valueMm !== undefined,
    kind: 'flat',
    heightMm: heightDimension?.valueMm || null,
    pitchDeg: 0,
    evidence: flat ? [{
      fileId: flat.file.id,
      fileName: flat.file.name,
      pageNumber: flat.page.pageNumber,
      drawingKind: flat.page.kind,
      method: flat.page.dimensions.some((dimension) => dimension.sourceType === 'ocr') ? 'ocr' : 'pdf-text',
      rawText: flat.page.text.match(/평지붕|flat\s*roof/i)?.[0],
      note: heightDimension ? '평지붕 표기와 지붕 높이 치수를 사용했습니다.' : '평지붕 표기는 확인했지만 별도 지붕 높이 치수를 찾지 못했습니다. 지붕 geometry를 만들지 않습니다.',
    }] : [],
    blockedReason: heightDimension ? '명시된 평지붕 높이와 도면 근거로 slab을 생성했습니다.' : '평지붕 표기는 확인했지만 별도 지붕 높이 치수가 없어 지붕 geometry를 보류했습니다.',
  }
}

export function buildBuildingGeometry(walls: Wall[], wallThicknessMm = 75, roof: BuildingGeometry['roof'] = emptyRoof()): BuildingGeometry {
  const thicknessMm = Number.isFinite(wallThicknessMm) && wallThicknessMm > 0 ? wallThicknessMm : 75
  const missingHeight = walls.filter((wall) => wall.heightMm === null)
  if (!walls.length) {
    return {
      walls: [],
      footprint: [],
      roof,
      isReady: false,
      blockedReason: '평면도에서 벽체 길이를 읽지 못했습니다. 치수선이 포함된 평면도가 필요합니다.',
      partial: false,
      blockedWallIds: [],
    }
  }
  const modelableWalls = walls.filter((wall) => wall.lengthMm !== null && wall.heightMm !== null)
  if (!modelableWalls.length) {
    return {
      walls: [],
      footprint: [],
      roof,
      isReady: false,
      blockedReason: '높이 정보 없음 — 입면도 또는 단면도를 추가해야 자재 산출용 3D 모델을 만들 수 있습니다.',
      partial: false,
      blockedWallIds: missingHeight.map((wall) => wall.id),
    }
  }
  const footprint = modelableWalls.flatMap((wall) => [wall.geometryStart, wall.geometryEnd])
    .filter((point, index, points) => points.findIndex((item) => item.x === point.x && item.z === point.z) === index)
  return {
    walls: modelableWalls.map((wall) => ({
      wallId: wall.id,
      zone: wall.zone,
      zoneName: wall.zoneName,
      number: wall.number,
      wallNumber: wall.wallNumber,
      start: { x: wall.geometryStart.x, y: 0, z: wall.geometryStart.z },
      end: { x: wall.geometryEnd.x, y: 0, z: wall.geometryEnd.z },
      lengthMm: wall.lengthMm as number,
      heightMm: wall.heightMm as number,
      thicknessMm,
      openings: wall.openings,
      color: wall.color,
      confidence: wall.confidence,
      sourceReferences: wall.sourceReferences,
      geometrySource: wall.geometrySource,
    })),
    footprint,
    roof,
    isReady: true,
    partial: missingHeight.length > 0,
    blockedWallIds: missingHeight.map((wall) => wall.id),
    blockedReason: missingHeight.length
      ? `높이 정보가 확인된 ${modelableWalls.length}개 벽체만 부분 모델로 표시했습니다. ${missingHeight.length}개 벽체는 높이 확인 후 추가됩니다.`
      : '도면 치수와 높이 근거를 사용해 생성한 개략 배치입니다. 벽체 좌표가 없는 문서에서는 길이 순서로 배치됩니다.',
  }
}

export function listMissingGeometryItems(files: AnalyzedFile[], walls: Wall[]) {
  const missing: string[] = []
  const kinds = new Set(files.flatMap((file) => file.pages.filter((page) => !isCostSummaryPage(file, page)).map((page) => page.kind)))
  if (!kinds.has('floor-plan')) missing.push('평면도 필요')
  if (!kinds.has('elevation') && !kinds.has('section')) missing.push('입면도 또는 단면도 필요 — 높이 정보 없음')
  if (!walls.length) missing.push('벽체 길이 또는 치수선 미확인')
  if (walls.some((wall) => wall.heightMm === null)) missing.push('높이 정보 없음')
  if (walls.some((wall) => wall.reviewStatus === 'review')) missing.push('벽체별 개구부 위치 또는 중간 신뢰도 확인 필요')
  if (walls.some((wall) => (wall.conflicts || []).length)) missing.push('같은 위치의 치수 충돌 확인 필요')
  return [...new Set(missing)]
}
