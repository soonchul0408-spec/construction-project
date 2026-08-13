import {
  LEGISLATION_INDUSTRY_CATEGORIES,
  LEGISLATION_REGION_OPTIONS,
} from '@/data/legislationData'
import { DATA_ORIGINS, createSourceMetadata } from '@/data/sourceMetadata'

const ASSEMBLY_SOURCE_URL = 'https://www.data.go.kr/data/15126134/openapi.do'
const UNKNOWN_INDUSTRY_CATEGORY = '분류 미확인'

const BILL_FIELDS = {
  id: [
    'BILL_ID',
    'billId',
    'BILL_NO',
    'billNo',
    'billNumber',
    '의안ID',
    '의안번호',
  ],
  name: ['BILL_NAME', 'BILL_NM', 'billName', 'billNm', 'billTitle', '의안명', '법안명'],
  proposedAt: [
    'PROPOSE_DT',
    'PPSL_DT',
    'proposeDt',
    'proposalDate',
    'proposedAt',
    '제안일',
    '발의일',
  ],
  proposer: [
    'PROPOSER',
    'RST_PROPOSER',
    'PPSR_NM',
    'proposer',
    'proposerName',
    'representativeProposer',
    '대표발의자',
    '제안자',
  ],
  organization: [
    'COMMITTEE',
    'COMMITTEE_NM',
    'CURR_COMMITTEE',
    'committee',
    'responsibleOrg',
    'organization',
    '소관위원회',
    '소관기관',
    '제출기관',
  ],
  stage: [
    'PROC_RESULT_NM',
    'PROC_RESULT',
    'PROC_RESULT_DESC',
    'PROC_RESULT_CD',
    'processingStatus',
    'procedureStatus',
    'stage',
    '진행단계',
    '심사단계',
    '처리결과',
  ],
  region: ['REGION', 'RELATED_REGION', 'region', 'relatedRegion', '지역', '관련지역'],
  category: ['INDUSTRY', 'CATEGORY', 'industry', 'category', '산업', '산업분류'],
  description: [
    'BILL_SUMMARY',
    'PROPOSE_REASON',
    'BILL_DESC',
    'description',
    'summary',
    '제안이유',
    '주요내용',
  ],
  source: ['LINK_URL', 'DETAIL_LINK', 'detailUrl', 'sourceUrl', 'linkUrl', '원문URL', '상세URL'],
  committeeDate: [
    'COMMITTEE_DT',
    'COMMITTEE_DATE',
    'committeeDate',
    'committeeReviewDate',
    '상임위심사일',
    '위원회심사일',
  ],
  committeeResult: ['COMMITTEE_RESULT', 'committeeResult', '상임위심사결과', '위원회심사결과'],
  plenaryDate: ['PLENARY_DT', 'PLENARY_DATE', 'plenaryDate', '본회의심사일', '본회의처리일'],
  plenaryResult: ['PLENARY_RESULT', 'plenaryResult', '본회의심사결과', '본회의처리결과'],
  processedAt: ['PROC_DT', 'PROCESS_DT', 'processedAt', '처리일', '처리일자'],
}

const INDUSTRY_RULES = [
  {
    category: 'AI·데이터센터',
    keywords: ['ai', '인공지능', '데이터센터', '클라우드', '컴퓨팅', '서버'],
  },
  {
    category: '반도체',
    keywords: ['반도체', 'semiconductor', '파운드리', '웨이퍼'],
  },
  {
    category: '방산',
    keywords: ['방산', '국방', '무기', '군수', '항공엔진'],
  },
  {
    category: '이차전지',
    keywords: ['이차전지', '배터리', '전지', 'ess'],
  },
  {
    category: '전력·에너지',
    keywords: ['전력', '에너지', '전기', '태양광', '수소', '풍력', '전력망'],
  },
]

const REGION_RULES = [
  { value: '전남 해남군', keywords: ['해남'] },
  { value: '경기도 용인시', keywords: ['용인'] },
  { value: '울산광역시', keywords: ['울산'] },
  { value: '경상남도 창원시', keywords: ['창원'] },
  { value: '전북 군산시', keywords: ['군산', '새만금'] },
  { value: '경기도', keywords: ['경기도', '경기'] },
]

function normalizeFieldKey(value) {
  return String(value).replace(/[\s_()./-]/g, '').toLowerCase()
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function scalarValue(value) {
  if (Array.isArray(value)) return value[0]
  if (value && typeof value === 'object') {
    if (hasValue(value['#text'])) return value['#text']
    return ''
  }
  return value
}

function pickField(record, fieldNames) {
  if (!record || typeof record !== 'object') return ''

  for (const fieldName of fieldNames) {
    const value = scalarValue(record[fieldName])
    if (hasValue(value)) return String(value).trim()
  }

  const normalizedNames = fieldNames.map(normalizeFieldKey)
  const matchedEntry = Object.entries(record).find(([key, value]) => {
    const scalar = scalarValue(value)
    return hasValue(scalar) && normalizedNames.includes(normalizeFieldKey(key))
  })

  return matchedEntry ? String(scalarValue(matchedEntry[1])).trim() : ''
}

function toArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (Array.isArray(value.item)) return value.item
  if (Array.isArray(value.row)) return value.row
  if (value.item) return [value.item]
  if (value.row) return [value.row]
  return typeof value === 'object' ? [value] : []
}

function looksLikeBillRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false

  const normalizedKeys = Object.keys(record).map(normalizeFieldKey)
  const knownFields = Object.values(BILL_FIELDS).flat().map(normalizeFieldKey)
  const nameKey = BILL_FIELDS.name.map(normalizeFieldKey)
  return (
    normalizedKeys.some((field) => nameKey.includes(field)) &&
    normalizedKeys.some((field) => knownFields.includes(field))
  )
}

function collectBillRecords(value, records = [], depth = 0) {
  if (!value || depth > 8) return records

  if (Array.isArray(value)) {
    value.forEach((item) => collectBillRecords(item, records, depth + 1))
    return records
  }

  if (typeof value !== 'object') return records
  if (looksLikeBillRecord(value)) {
    records.push(value)
    return records
  }

  Object.values(value).forEach((child) => collectBillRecords(child, records, depth + 1))
  return records
}

function extractBillRecords(payload) {
  const root = payload?.raw ?? payload?.data ?? payload
  const candidates = [
    root?.response?.body?.items?.item,
    root?.response?.body?.items,
    root?.response?.body?.row,
    root?.body?.items?.item,
    root?.body?.items,
    root?.body?.row,
    root?.results?.result,
    root?.results?.item,
    root?.data?.items?.item,
    root?.data?.items,
    root?.data?.row,
    root?.items?.item,
    root?.items,
    root?.rows?.row,
    root?.row,
  ]

  const records = candidates.flatMap((candidate) =>
    toArray(candidate).filter((record) => looksLikeBillRecord(record)),
  )

  if (records.length) return records
  return collectBillRecords(root)
}

function createStableId(prefix, value) {
  let hash = 2166136261

  for (const character of String(value)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }

  return `${prefix}-${(hash >>> 0).toString(36)}`
}

function formatDisplayDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''

  const digits = text.replace(/\D/g, '')
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`
  }

  return text.replace(/-/g, '.')
}

function normalizeAbsoluteUrl(value, fallback) {
  const url = String(value ?? '').trim()
  if (/^https?:\/\//i.test(url)) return url
  return fallback
}

function inferCategory(record, text) {
  const explicitCategory = pickField(record, BILL_FIELDS.category)
  const knownCategory = LEGISLATION_INDUSTRY_CATEGORIES.find(
    (category) => category.value !== '전체' && explicitCategory.includes(category.value),
  )
  if (knownCategory) {
    return { value: knownCategory.value, basis: '원본 응답의 산업 분류 항목' }
  }

  const normalizedText = String(text ?? '').toLowerCase()
  const matchedRule = INDUSTRY_RULES.find((rule) =>
    rule.keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase())),
  )

  return matchedRule
    ? { value: matchedRule.category, basis: '법안명·공개 응답 키워드 분류' }
    : { value: UNKNOWN_INDUSTRY_CATEGORY, basis: '관련 산업 정보 미확인' }
}

function inferRegion(record, text) {
  const explicitRegion = pickField(record, BILL_FIELDS.region)
  if (explicitRegion) return { value: explicitRegion, basis: '원본 응답의 지역 항목' }

  const matchedRule = REGION_RULES.find((rule) =>
    rule.keywords.some((keyword) => String(text ?? '').includes(keyword)),
  )

  if (matchedRule) return { value: matchedRule.value, basis: '법안명·공개 응답 키워드 분류' }
  return { value: '전국', basis: '지역 정보 미기재' }
}

function normalizeStage(record, proposedAt) {
  const rawStage = [
    pickField(record, BILL_FIELDS.stage),
    pickField(record, BILL_FIELDS.committeeResult),
    pickField(record, BILL_FIELDS.plenaryResult),
  ]
    .filter(Boolean)
    .join(' · ')
  const normalizedStage = rawStage.toLowerCase()
  const committeeDate = formatDisplayDate(pickField(record, BILL_FIELDS.committeeDate))
  const plenaryDate = formatDisplayDate(pickField(record, BILL_FIELDS.plenaryDate))

  if (/폐기|철회|계류|보류|pending|withdraw|discard/.test(normalizedStage)) {
    return { value: '계류·폐기', rawStage, committeeDate, plenaryDate }
  }

  if (/가결|통과|공포|원안|수정가결|passed|promulg/.test(normalizedStage)) {
    return { value: '통과', rawStage, committeeDate, plenaryDate }
  }

  if (/본회의|본회|plenary|floor/.test(normalizedStage) || plenaryDate) {
    return { value: '본회의 심사', rawStage, committeeDate, plenaryDate }
  }

  if (/상임위|위원회 심사|소관위|committee/.test(normalizedStage) || committeeDate) {
    return { value: '상임위 심사', rawStage, committeeDate, plenaryDate }
  }

  if (/입법예고|예고|notice/.test(normalizedStage)) {
    return { value: '입법예고', rawStage, committeeDate, plenaryDate }
  }

  return {
    value: '발의',
    rawStage: rawStage || (proposedAt ? '제안일 기준 발의' : '진행 단계 미확인'),
    committeeDate,
    plenaryDate,
  }
}

function buildTimeline(proposedAt, stage, processedAt, description) {
  const timeline = []
  if (proposedAt) {
    timeline.push({
      date: proposedAt,
      title: '법안 제안',
      description: '국회 의안정보 응답의 제안일을 확인했습니다.',
      type: 'primary',
    })
  }

  if (stage.committeeDate) {
    timeline.push({
      date: stage.committeeDate,
      title: '상임위 심사',
      description: '원본 응답의 상임위원회 심사 일자를 확인했습니다.',
      type: 'warning',
    })
  }

  if (stage.plenaryDate) {
    timeline.push({
      date: stage.plenaryDate,
      title: '본회의 심사',
      description: '원본 응답의 본회의 처리 일자를 확인했습니다.',
      type: 'primary',
    })
  }

  if (processedAt && processedAt !== stage.committeeDate && processedAt !== stage.plenaryDate) {
    timeline.push({
      date: processedAt,
      title: stage.value,
      description: description || '원본 응답의 처리 일자를 확인했습니다.',
      type: stage.value === '통과' ? 'success' : 'info',
    })
  }

  return timeline
}

function normalizeBillRecord(record, index, metadata) {
  const billName = pickField(record, BILL_FIELDS.name)
  if (!billName) return null

  const billNumber = pickField(record, BILL_FIELDS.id)
  const proposedAt = formatDisplayDate(pickField(record, BILL_FIELDS.proposedAt))
  const proposer = pickField(record, BILL_FIELDS.proposer)
  const responsibleOrg = pickField(record, BILL_FIELDS.organization)
  const description = pickField(record, BILL_FIELDS.description)
  const text = [billName, description, proposer, responsibleOrg].filter(Boolean).join(' ')
  const region = inferRegion(record, text)
  const category = inferCategory(record, text)
  const stage = normalizeStage(record, proposedAt)
  const processedAt = formatDisplayDate(pickField(record, BILL_FIELDS.processedAt))
  const sourceUrl = normalizeAbsoluteUrl(pickField(record, BILL_FIELDS.source), metadata.sourceUrl)
  const verifiedAt = metadata.retrievedAt?.slice(0, 10) ?? null
  const recordId = createStableId(
    'assembly-bill',
    [billNumber, billName, proposedAt, proposer, responsibleOrg].join('|'),
  )
  const source = createSourceMetadata({
    provider: metadata.provider,
    title: sourceUrl === ASSEMBLY_SOURCE_URL ? '국회 국회사무처 의안정보 통합 API' : '국회 의안 원문',
    url: sourceUrl,
    publishedAt: proposedAt || null,
    verifiedAt,
    retrievedAt: metadata.retrievedAt,
  })
  const stageNote = stage.rawStage
    ? `원본 진행 상태: ${stage.rawStage}`
    : '원본 응답에서 진행 단계를 확인하지 못해 제안일 기준으로 표시합니다.'

  return {
    id: recordId,
    billNumber: billNumber || `응답 항목 ${index + 1}`,
    recordType: '법안',
    billName,
    proposedAt: proposedAt || '제안일 미확인',
    proposer: proposer || '제안자 정보 미확인',
    responsibleOrg: responsibleOrg || '소관기관 정보 미확인',
    stage: stage.value,
    rawStage: stage.rawStage,
    stageNote,
    region: region.value,
    category: category.value,
    regionBasis: region.basis,
    categoryBasis: category.basis,
    description:
      description ||
      '국회 의안정보 통합 API에서 확인한 법안 기본정보입니다. 상세 내용은 공식 출처에서 확인하세요.',
    sourceTitle: source.title,
    sourceDate: proposedAt || null,
    sourceUrl,
    verifiedAt,
    source,
    sources: [source],
    dataOrigin: DATA_ORIGINS.LIVE,
    timeline: buildTimeline(proposedAt, stage, processedAt, description),
  }
}

function normalizeExistingItem(item, metadata, index) {
  const record = {
    ...item,
    BILL_ID: item.billNumber ?? item.id,
    BILL_NAME: item.billName,
    PROPOSE_DT: item.proposedAt,
    PROPOSER: item.proposer,
    COMMITTEE: item.responsibleOrg,
    PROC_RESULT: item.rawStage ?? item.stage,
    REGION: item.region,
    CATEGORY: item.category,
    LINK_URL: item.sourceUrl,
    description: item.description,
  }
  return normalizeBillRecord(record, index, metadata)
}

export function normalizeLegislationSnapshot(payload) {
  const body = payload?.data ?? payload ?? {}
  const retrievedAt = body.retrievedAt ?? new Date().toISOString()
  const metadata = {
    provider: body.provider ?? '국회 국회사무처_의안정보 통합 API',
    sourceUrl: body.sourceUrl ?? ASSEMBLY_SOURCE_URL,
    retrievedAt,
  }
  const items = Array.isArray(body.items)
    ? body.items.map((item, index) => normalizeExistingItem(item, metadata, index)).filter(Boolean)
    : extractBillRecords(body.raw ?? body)
        .map((record, index) => normalizeBillRecord(record, index, metadata))
        .filter(Boolean)

  const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()]
  if (!uniqueItems.length) {
    throw new Error('국회 의안정보 API 응답에 법안 항목이 없습니다.')
  }

  return {
    dataOrigin: DATA_ORIGINS.LIVE,
    provider: metadata.provider,
    retrievedAt,
    items: uniqueItems,
  }
}

export const legislationUnknownIndustryCategory = UNKNOWN_INDUSTRY_CATEGORY
export const legislationRegionOptions = LEGISLATION_REGION_OPTIONS
