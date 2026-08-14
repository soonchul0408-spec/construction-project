import type {
  ConfidenceLevel,
  DimensionSourceType,
  DimensionValue,
  Evidence,
  HeightRole,
  NormalizedUnit,
  SourcePosition,
} from '../types/domain'

export interface NumericToken {
  raw: string
  context: string
  evidence: Evidence
  /** Unit attached to this exact numeric match. */
  unitHint?: string
  /** Text local to this exact match, before callers add neighbouring labels. */
  localContext?: string
}

export interface NormalizedDimension {
  raw: string
  value: number | null
  valueMm: number | null
  unit: NormalizedUnit
  confidence: ConfidenceLevel
  label: string
  context: string
  evidence: Evidence
  heightRole: HeightRole
  levelDatum?: {
    marker: string
    role: 'upper' | 'lower' | 'unknown'
    referencePlane: string | null
  }
}

function cleanNumeric(raw: string) {
  return raw.replace(/,/g, '').replace(/−/g, '-').replace(/\s+/g, '').trim().replace(/^±(?=0+(?:\.0+)?$)/, '')
}

function numericValue(raw: string) {
  const value = Number(cleanNumeric(raw))
  return Number.isFinite(value) ? value : null
}

function normalizedUnit(value: string | undefined): NormalizedUnit | null {
  if (!value) return null
  const unit = value.toLowerCase()
  if (unit === '㎜') return 'mm'
  if (unit === '㎝') return 'cm'
  if (unit === '미터') return 'm'
  return unit as NormalizedUnit
}

function unitFromContext(raw: string, context: string, unitHint?: string) {
  const unitPattern = /(mm|㎜|cm|㎝|m\b|미터)/i
  const hintedUnit = normalizedUnit(unitHint)
  if (hintedUnit) return hintedUnit
  const directUnit = raw.match(unitPattern)
  const rawNumber = numericValue(raw)
  const attachedUnits = [...context.matchAll(/([+−-]?\s*\d{1,7}(?:[.,]\d{1,3})?)\s*(mm|㎜|cm|㎝|m|미터)/gi)]
    .filter((match) => numericValue(match[1] || '') === rawNumber)
  const attachedUnit = attachedUnits.length === 1 ? attachedUnits[0]?.[2] : undefined
  const declaredUnit = context.match(/(?:단위|unit)\s*[:=]?\s*(mm|㎜|cm|㎝|m\b|미터)/i)
  const unitMatch = directUnit || (attachedUnit ? [attachedUnit, attachedUnit] : null) || declaredUnit
  if (!unitMatch) return null
  return normalizedUnit(unitMatch[1])
}

function parseToMm(raw: string, context: string, unitHint?: string): { value: number | null; valueMm: number | null; unit: NormalizedUnit; confidence: ConfidenceLevel } {
  const number = numericValue(raw)
  const isLevelDatum = Boolean(levelDatumFromContext(context))
  if (number === null || (number <= 0 && !isLevelDatum)) return { value: null, valueMm: null, unit: 'mm', confidence: 'low' }

  const unit = unitFromContext(raw, context, unitHint)
  if (unit === 'm') return { value: number, valueMm: number * 1000, unit, confidence: 'high' }
  if (unit === 'cm') return { value: number, valueMm: number * 10, unit, confidence: 'high' }
  if (unit === 'mm') return { value: number, valueMm: number, unit, confidence: 'high' }

  const normalized = cleanNumeric(raw)
  if (normalized.includes('.')) {
    const decimals = normalized.split('.')[1]?.length || 0
    if (decimals === 3 && number < 200) {
      return { value: number, valueMm: number * 1000, unit: 'm', confidence: 'medium' }
    }
    return { value: number, valueMm: number * 1000, unit: 'm', confidence: 'low' }
  }

  if (number >= 500) return { value: number, valueMm: number, unit: 'mm', confidence: 'medium' }
  return { value: number, valueMm: number, unit: 'mm', confidence: 'low' }
}

function levelDatumFromContext(context: string) {
  const markerMatch = context.match(/(?:\b(EL|LEVEL)\b|(T\.?O\.?S\.?|T\.?O\.?F\.?|\bFFL\b|\bGL\b))/i)
  const markerText = markerMatch?.[1] || markerMatch?.[2]
  if (!markerText) return undefined
  const marker = markerText.toUpperCase().replace(/\s+/g, '')
  const role = /T\.?O\.?S|TOP|UPPER|천장|상부/i.test(context)
    ? 'upper' as const
    : /T\.?O\.?F|FFL|GL|BOTTOM|LOWER|바닥|하부/i.test(context)
      ? 'lower' as const
      : 'unknown' as const
  const referencePlane = context.match(/(?:T\.?O\.?S\.?|T\.?O\.?F\.?|FFL|GL|기준면|기준 레벨)\s*[:=]?\s*([^,;]+)/i)?.[1]?.trim() || null
  return { marker, role, referencePlane }
}

export function classifyHeightRole(context: string, drawingKind?: string, valueMm?: number | null): HeightRole {
  if (levelDatumFromContext(context)) return 'level'
  if (/(벽체\s*높이|wall\s*height|층고|천장고|ceiling\s*height|높이|height|\bH\s*[:=]|\bHT\s*[:=]?)/i.test(context)) return 'direct'
  if (/(폭|width|길이|length|가로|offset|벽끝|기준선|시작점|창대|문턱|sill)/i.test(context)) return 'none'
  // Elevation/section dimensions can be vertical even when the nearby text
  // does not repeat the word “height”. Keep these candidates reviewable rather
  // than treating every large number as a height.
  if (['elevation', 'section'].includes((drawingKind || '').toLowerCase()) && valueMm !== null && valueMm !== undefined && valueMm >= 1800 && valueMm <= 20000) return 'direct'
  return 'none'
}

function labelFromContext(context: string, drawingKind?: string, valueMm?: number | null) {
  const role = classifyHeightRole(context, drawingKind, valueMm)
  if (role === 'level') return '레벨 후보'
  if (role === 'direct') return '높이 후보'
  if (/(문|door)/i.test(context)) return '문 치수 후보'
  if (/(창|window)/i.test(context)) return '창호 치수 후보'
  if (/(폭|길이|가로|세로|wall|벽)/i.test(context)) return '벽체 길이 후보'
  return '추출 치수'
}

function hasDimensionSemantics(context: string) {
  return /(?:\bEL\b|\bLEVEL\b|T\.?O\.?S\.?|T\.?O\.?F\.?|\bFFL\b|\bGL\b|벽체|WALL|천장고|층고|높이|HEIGHT|폭|WIDTH|길이|LENGTH|가로|세로|OFFSET|벽끝|기준선|시작점|창대|문턱|SILL|문|DOOR|창|WINDOW)/i.test(context)
}

export function normalizeNumericToken(token: NumericToken): NormalizedDimension {
  // PDF/OCR engines often split a label and its numeric value into separate
  // text items. A number-only local context must not hide the caller-provided
  // neighbouring label; use the local slice only when it is actually semantic.
  const semanticContext = token.localContext && hasDimensionSemantics(token.localContext) ? token.localContext : token.context
  const normalized = parseToMm(token.raw, semanticContext, token.unitHint)
  const heightRole = classifyHeightRole(semanticContext, token.evidence.drawingKind, normalized.valueMm)
  return {
    raw: token.raw,
    value: normalized.value,
    valueMm: normalized.valueMm,
    unit: normalized.unit,
    confidence: normalized.confidence,
    label: labelFromContext(semanticContext, token.evidence.drawingKind, normalized.valueMm),
    context: token.context,
    evidence: token.evidence,
    heightRole,
    levelDatum: heightRole === 'level' ? levelDatumFromContext(semanticContext) : undefined,
  }
}

function localContextForMatch(text: string, matchStart: number, matchEnd: number) {
  const windowStart = Math.max(0, matchStart - 36)
  const windowEnd = Math.min(text.length, matchEnd + 36)
  const windowText = text.slice(windowStart, windowEnd)
  const relativeStart = matchStart - windowStart
  const relativeEnd = matchEnd - windowStart
  const delimiters = /[,;|│\n]/g
  let segmentStart = 0
  let segmentEnd = windowText.length
  for (const delimiter of windowText.matchAll(delimiters)) {
    const delimiterIndex = delimiter.index || 0
    if (delimiterIndex < relativeStart) segmentStart = delimiterIndex + delimiter[0].length
    else if (delimiterIndex >= relativeEnd) {
      segmentEnd = delimiterIndex
      break
    }
  }

  const segment = windowText.slice(segmentStart, segmentEnd)
  const valueStart = relativeStart - segmentStart
  const valueEnd = relativeEnd - segmentStart
  const labels = [...segment.matchAll(/(?:벽체\s*높이|wall\s*height|천장고|층고|ceiling\s*height|높이|height|폭|width|길이|length|가로|세로|offset|벽끝|기준선|시작점|창대|문턱|sill|\bEL\b|\bLEVEL\b|T\.?O\.?S\.?|T\.?O\.?F\.?|\bFFL\b|\bGL\b)/gi)]
  const precedingLabel = labels.filter((label) => (label.index || 0) < valueStart).at(-1)
  const followingLabel = labels.find((label) => (label.index || 0) >= valueEnd)
  const semanticStart = precedingLabel?.index ?? 0
  const semanticEnd = followingLabel?.index ?? segment.length
  return segment.slice(semanticStart, semanticEnd).trim()
}

export function numericTokensFromText(text: string, evidence: Evidence): NumericToken[] {
  const tokens: NumericToken[] = []
  const matcher = /(?<![\w])(?:[+−±-]\s*)?\d{1,7}(?:[.,]\d{1,3})?\s*(?:mm|㎜|cm|㎝|m|미터)?/gi
  for (const match of text.matchAll(matcher)) {
    const raw = match[0].trim()
    const unitHint = raw.match(/(mm|㎜|cm|㎝|m|미터)$/i)?.[1]
    const numericOnly = raw.replace(/\s*(mm|㎜|cm|㎝|m|미터)$/i, '').trim()
    const numeric = numericValue(numericOnly)
    const matchIndex = match.index || 0
    const localContext = localContextForMatch(text, matchIndex, matchIndex + raw.length)
    const isLevel = Boolean(levelDatumFromContext(localContext))
    if (numeric === null || (numeric <= 0 && !isLevel) || (Math.abs(numeric) < 10 && !unitHint && !isLevel)) continue
    const beforeMatch = text.slice(Math.max(0, matchIndex - 28), matchIndex)
    // Scale denominators are metadata, not wall/opening dimensions. Keeping
    // them in the review list would block an otherwise fully evidenced model.
    if (/(?:축척|scale)\s*[:=]?\s*1\s*[:/]\s*$/i.test(beforeMatch)) continue
    const start = Math.max(0, matchIndex - 36)
    const end = Math.min(text.length, matchIndex + raw.length + 36)
    tokens.push({ raw: numericOnly, context: text.slice(start, end), evidence, unitHint, localContext })
  }
  return tokens
}

function sourceTypeFromEvidence(evidence: Evidence): DimensionSourceType {
  if (evidence.method === 'ocr') return 'ocr'
  if (evidence.method === 'vector') return 'vector'
  if (evidence.method === 'derived' || evidence.method === 'user') return 'calculated'
  return 'pdf-text'
}

function sourcePositionFromEvidence(evidence: Evidence): SourcePosition {
  return {
    x: evidence.location?.x || 0,
    y: evidence.location?.y || 0,
    width: evidence.location?.width || 0,
    height: evidence.location?.height || 0,
  }
}

export function toDimensionValue(normalized: NormalizedDimension, index: number): DimensionValue {
  const rounded = normalized.valueMm === null ? null : Math.round(normalized.valueMm * 100) / 100
  const primaryEvidence = normalized.evidence
  return {
    id: `dimension-${primaryEvidence.fileId}-${primaryEvidence.pageNumber}-${index}`,
    label: normalized.label,
    value: normalized.value,
    unit: normalized.unit,
    normalizedValueMm: rounded,
    sourceFile: primaryEvidence.fileName,
    pageNumber: primaryEvidence.pageNumber,
    drawingType: primaryEvidence.drawingKind,
    sourceText: normalized.raw,
    sourcePosition: sourcePositionFromEvidence(primaryEvidence),
    sourceType: sourceTypeFromEvidence(primaryEvidence),
    valueMm: rounded,
    displayValue: normalized.raw,
    confidence: normalized.confidence,
    source: primaryEvidence.method === 'user' ? 'user' : 'extracted',
    evidence: [normalized.evidence],
    context: normalized.context.replace(/\s+/g, ' ').trim(),
    userEdited: false,
    originalValueMm: rounded,
    userValueMm: null,
    heightRole: normalized.heightRole,
    levelDatum: normalized.levelDatum,
    handwritingStatus: normalized.evidence.handwritingStatus || (normalized.evidence.method === 'ocr' ? 'uncertain' : 'printed'),
  }
}

export function formatMm(valueMm: number | null) {
  if (valueMm === null || !Number.isFinite(valueMm)) return '—'
  return `${(valueMm / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} m`
}
