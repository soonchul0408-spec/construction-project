import type {
  ConfidenceLevel,
  DimensionSourceType,
  Evidence,
  ExtractedLabel,
  NormalizedUnit,
  ScaleFinding,
  SourcePosition,
} from '../types/domain'

export interface TextEvidenceItem {
  text: string
  evidence: Evidence
}

export interface DrawingMetadataResult {
  zones: ExtractedLabel[]
  roomNames: ExtractedLabel[]
  axisLabels: ExtractedLabel[]
  scales: ScaleFinding[]
  unitCandidates: NormalizedUnit[]
}

function sourceTypeFromEvidence(evidence: Evidence): DimensionSourceType {
  if (evidence.method === 'ocr') return 'ocr'
  if (evidence.method === 'vector') return 'vector'
  if (evidence.method === 'derived' || evidence.method === 'user') return 'calculated'
  return 'pdf-text'
}

function sourcePosition(evidence: Evidence): SourcePosition {
  return {
    x: evidence.location?.x || 0,
    y: evidence.location?.y || 0,
    width: evidence.location?.width || 0,
    height: evidence.location?.height || 0,
  }
}

function confidenceFor(evidence: Evidence, value: string): ConfidenceLevel {
  if (evidence.method === 'ocr') return value.length > 1 ? 'medium' : 'low'
  return 'high'
}

function normalizeValue(value: string) {
  return value.replace(/\s+/g, ' ').replace(/[|│]+/g, ' ').trim()
}

function candidateItem(items: TextEvidenceItem[], value: string, fallback?: Evidence) {
  const item = items.find((entry) => entry.text.toLowerCase().includes(value.toLowerCase()))
  if (item) return item
  if (fallback) return { text: value, evidence: { ...fallback, rawText: value } }
  const first = items[0]
  return first || { text: value, evidence: { fileId: '', fileName: '', pageNumber: 1, drawingKind: 'unknown', method: 'derived', rawText: value } }
}

function makeFinding(
  kind: string,
  value: string,
  item: TextEvidenceItem,
  index: number,
): ExtractedLabel {
  const normalized = normalizeValue(value)
  const evidence = { ...item.evidence, rawText: item.evidence.rawText || item.text }
  return {
    id: `${kind}-${evidence.fileId}-${evidence.pageNumber}-${index}-${normalized}`,
    value: normalized,
    sourceText: item.text,
    sourceFile: evidence.fileName,
    pageNumber: evidence.pageNumber,
    drawingType: evidence.drawingKind,
    sourcePosition: sourcePosition(evidence),
    confidence: confidenceFor(evidence, normalized),
    sourceType: sourceTypeFromEvidence(evidence),
    evidence: [evidence],
  }
}

function uniqueFindings(findings: ExtractedLabel[]) {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = `${finding.value.toLowerCase()}-${finding.sourceFile}-${finding.pageNumber}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function findLabels(items: TextEvidenceItem[], text: string, pattern: RegExp, kind: string, fallback?: Evidence) {
  const findings: ExtractedLabel[] = []
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const value = match[0]
    const item = candidateItem(items, value, fallback)
    findings.push(makeFinding(kind, value, item, index))
    index += 1
  }
  return uniqueFindings(findings)
}

function extractScales(items: TextEvidenceItem[], text: string, fallback?: Evidence) {
  const scales: ScaleFinding[] = []
  const pattern = /(?:축척|scale|\bS)\s*[:=]?\s*(\d+)\s*[:/]\s*(\d+)|\b1\s*[:/]\s*(\d{2,5})\b/gi
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const left = Number(match[1] || 1)
    const right = Number(match[2] || match[3])
    const value = match[0].replace(/\s+/g, '')
    if (!Number.isFinite(right) || right <= 0) continue
    const item = candidateItem(items, match[0], fallback)
    const finding = makeFinding('scale', value, item, index)
    scales.push({
      ...finding,
      ratio: `${left}:${right}`,
      numericRatio: left / right,
    })
    index += 1
  }
  return scales.filter((scale, index, values) => values.findIndex((item) => item.ratio === scale.ratio && item.sourceFile === scale.sourceFile && item.pageNumber === scale.pageNumber) === index)
}

export function extractDrawingMetadata(items: TextEvidenceItem[], fallbackEvidence?: Evidence): DrawingMetadataResult {
  const text = items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim()
  const zones = findLabels(items, text, /(?:구역|zone|area)\s*[-:#]?\s*[A-Z가-힣0-9][A-Z가-힣0-9_-]*/gi, 'zone', fallbackEvidence)
  const roomNames = findLabels(items, text, /(?:[가-힣]{1,14}(?:실|룸|방|홀|창고|복도|계단실)|(?:room|office|storage|corridor|toilet|hall)\b(?:\s*[-#]?\s*[A-Z0-9-]{1,4}\b)?)/gi, 'room', fallbackEvidence)
  const axisLabels = findLabels(items, text, /(?<![A-Z0-9:-])(?:[A-Z]{1,2}\s*[-~]?\s*\d{1,3}|\d{1,3}\s*[-~]?\s*[A-Z]{1,2})(?![A-Z0-9])/g, 'axis', fallbackEvidence)
  const scales = extractScales(items, text, fallbackEvidence)
  const unitCandidates = [...new Set([...text.matchAll(/\b(mm|㎜|cm|㎝|m|미터)\b/gi)].map((match) => {
    const unit = match[1].toLowerCase()
    if (unit === '㎜') return 'mm'
    if (unit === '㎝') return 'cm'
    if (unit === '미터') return 'm'
    return unit as NormalizedUnit
  }))]

  return { zones, roomNames, axisLabels, scales, unitCandidates }
}
