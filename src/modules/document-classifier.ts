import type { ConfidenceLevel, DrawingKind, HandwritingStatus } from '../types/domain'

interface ClassificationResult {
  kind: DrawingKind
  confidence: ConfidenceLevel
  reasons: string[]
}

const RULES: Array<{ kind: DrawingKind; label: string; terms: string[] }> = [
  {
    kind: 'cost-summary',
    label: '공사비 집계표',
    terms: ['공사비', '집계', '누계', '월별', '업체명', '품명', '금액', '계약금액', '기성금'],
  },
  {
    kind: 'material-schedule',
    label: '자재표',
    terms: ['자재표', '자재 목록', 'panel', '판넬', '패널', '규격', '재료표', 'material schedule'],
  },
  {
    kind: 'elevation',
    label: '입면도',
    terms: ['입면도', 'elevation', 'facade', 'façade', '정면도', '측면도', '외벽 높이'],
  },
  {
    kind: 'floor-plan',
    label: '평면도',
    terms: ['평면도', 'floor plan', 'floorplan', '배치도', '구역', '실명', 'room', 'wall', '벽체'],
  },
  {
    kind: 'section',
    label: '단면도',
    terms: ['단면도', 'section', '층고', '레벨', 'level', '높이', 'h=', '±0.000'],
  },
  {
    kind: 'detail',
    label: '상세도',
    terms: ['상세도', 'detail', '창호상세', '접합부', '디테일', 'door detail', 'window detail'],
  },
  {
    kind: 'structural',
    label: '구조도',
    terms: ['구조도', 'structural', '철근', '기둥', '보', '슬래브', '구조 평면'],
  },
]

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ')
}

export function classifyDocument(text = '', fileName = ''): ClassificationResult {
  const haystack = normalizeText(`${fileName} ${text}`)
  const scored = RULES.map((rule) => {
    const matches = rule.terms.filter((term) => haystack.includes(normalizeText(term)))
    return { ...rule, matches, score: matches.length }
  }).sort((a, b) => b.score - a.score)

  const winner = scored[0]
  if (!winner || winner.score === 0) {
    return {
      kind: 'unknown',
      confidence: 'low',
      reasons: ['파일명과 추출 텍스트에서 도면 종류를 판별할 표식을 찾지 못했습니다.'],
    }
  }

  const second = scored[1]
  const confidence: ConfidenceLevel = winner.score >= 3 && winner.score > (second?.score || 0)
    ? 'high'
    : winner.score >= 2
      ? 'medium'
      : 'low'

  return {
    kind: winner.kind,
    confidence,
    reasons: [`${winner.label} 표식 ${winner.matches.slice(0, 3).join(', ')} 감지`],
  }
}

export function guessBuildingName(text: string, fileName: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const namedLine = lines.find((line) => /(?:건물명|공사명|프로젝트|project|building)\s*[:：]/i.test(line))
  if (namedLine) {
    return namedLine.split(/[:：]/).slice(1).join(':').trim() || '이름 미확인 프로젝트'
  }
  const baseName = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  return baseName || '이름 미확인 프로젝트'
}

export function detectHandwriting(text: string, ocrConfidence?: number) {
  return classifyTextOrigin(text, ocrConfidence) === 'handwriting'
}

/**
 * OCR confidence alone cannot prove that a mark is handwritten: a blurred
 * printed drawing can have the same score. Keep that case explicitly
 * uncertain so it is never silently used as an automatic height source.
 */
export function classifyTextOrigin(text: string, ocrConfidence?: number): HandwritingStatus {
  const normalized = text.toLowerCase()
  const handwritingTerms = ['손글씨', '수기', '메모', 'handwritten', 'hand writing', '펜 표기']
  if (handwritingTerms.some((term) => normalized.includes(term))) return 'handwriting'
  if (typeof ocrConfidence === 'number' && ocrConfidence > 0 && ocrConfidence < 48) return 'uncertain'
  return 'printed'
}

export function isCostSummary(kind: DrawingKind) {
  return kind === 'cost-summary'
}
