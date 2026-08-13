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
  return raw.replace(/,/g, '').trim()
}

function numericValue(raw: string) {
  const value = Number(cleanNumeric(raw))
  return Number.isFinite(value) ? value : null
}

function unitFromContext(raw: string, context: string) {
  const unitPattern = /(mm|㎜|cm|㎝|m\b|미터)/i
  const directUnit = raw.match(unitPattern)
  const rawPosition = context.indexOf(raw)
  const nearbyText = rawPosition >= 0 ? context.slice(rawPosition, rawPosition + raw.length + 10) : ''
  const nearbyUnit = nearbyText.match(unitPattern)
  const declaredUnit = context.match(/(?:단위|unit)\s*[:=]?\s*(mm|㎜|cm|㎝|m\b|미터)/i)
  const unitMatch = directUnit || nearbyUnit || declaredUnit
  if (!unitMatch) return null
  const unit = unitMatch[1].toLowerCase()
  if (unit === '㎜') return 'mm'
  if (unit === '㎝') return 'cm'
  if (unit === '미터') return 'm'
  return unit as NormalizedUnit
}

function parseToMm(raw: string, context: string): { value: number | null; valueMm: number | null; unit: NormalizedUnit; confidence: ConfidenceLevel } {
  const number = numericValue(raw)
  if (number === null || number <= 0) return { value: null, valueMm: null, unit: 'mm', confidence: 'low' }

  const unit = unitFromContext(raw, context)
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
  const markerMatch = context.match(/\b(EL|LEVEL)\s*[.+−+-]?\s*|\b(T\.?O\.?S\.?|T\.?O\.?F\.?|FFL|GL)\b/i)
  if (!markerMatch?.[1]) return undefined
  const marker = markerMatch[1].toUpperCase().replace(/\s+/g, '')
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

export function normalizeNumericToken(token: NumericToken): NormalizedDimension {
  const normalized = parseToMm(token.raw, token.context)
  const heightRole = classifyHeightRole(token.context, token.evidence.drawingKind, normalized.valueMm)
  return {
    raw: token.raw,
    value: normalized.value,
    valueMm: normalized.valueMm,
    unit: normalized.unit,
    confidence: normalized.confidence,
    label: labelFromContext(token.context, token.evidence.drawingKind, normalized.valueMm),
    context: token.context,
    evidence: token.evidence,
    heightRole,
    levelDatum: heightRole === 'level' ? levelDatumFromContext(token.context) : undefined,
  }
}

export function numericTokensFromText(text: string, evidence: Evidence): NumericToken[] {
  const tokens: NumericToken[] = []
  const matcher = /(?<![\w])\d{1,7}(?:[.,]\d{1,3})?\s*(?:mm|㎜|cm|㎝|m|미터)?/gi
  for (const match of text.matchAll(matcher)) {
    const raw = match[0].trim()
    const numericOnly = raw.replace(/\s*(mm|㎜|cm|㎝|m|미터)$/i, '').trim()
    const numeric = numericValue(numericOnly)
    if (numeric === null || numeric <= 0 || (numeric < 10 && !raw.match(/[m㎝㎜]|cm|mm/i))) continue
    const matchIndex = match.index || 0
    const beforeMatch = text.slice(Math.max(0, matchIndex - 28), matchIndex)
    // Scale denominators are metadata, not wall/opening dimensions. Keeping
    // them in the review list would block an otherwise fully evidenced model.
    if (/(?:축척|scale)\s*[:=]?\s*1\s*[:/]\s*$/i.test(beforeMatch)) continue
    const start = Math.max(0, matchIndex - 36)
    const end = Math.min(text.length, matchIndex + raw.length + 36)
    tokens.push({ raw: numericOnly, context: text.slice(start, end), evidence })
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
