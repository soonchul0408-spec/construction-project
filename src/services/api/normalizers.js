import { DATA_ORIGINS, createSourceMetadata } from '@/data/sourceMetadata'

const LOCAL_FINANCE_SOURCE_URL = 'https://www.data.go.kr/data/15118650/openapi.do'
const UNKNOWN_INDUSTRY_CATEGORY = '분류 미확인'

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
    keywords: ['전력', '에너지', '전기', '태양광', '수소', '풍력'],
  },
]

const CONTRACT_FIELDS = {
  id: [
    'contractId',
    'contractNo',
    'contractNumber',
    'contractManagementNumber',
    'contractMngNo',
    'cntrctMngNo',
    '계약대장관리번호',
    '계약번호',
  ],
  name: ['contractName', 'contractTitle', 'cntrctNm', '계약명', '계약명칭', '사업명'],
  amount: [
    'contractAggregateAmount',
    'contractAmount',
    'contractSum',
    'cntrctAmt',
    '계약집계금액',
    '계약금액',
  ],
  date: ['contractDate', 'cntrctDate', '계약일자', '계약일'],
  method: ['contractMethod', 'cntrctMethod', '계약방법', '계약방식'],
  type: ['contractType', 'contractCategory', 'cntrctType', 'contractGbn', '계약종류', '계약구분'],
  company: [
    'companyName',
    'supplierName',
    'contractCompanyName',
    'contractorName',
    'cntrctCorpNm',
    'cntrctCorpName',
    'contractor',
    '업체명',
    '계약상대자',
    '계약상대자명',
    '계약업체',
  ],
  region: [
    'region',
    'localGovernment',
    'localGovernmentName',
    'organizationName',
    'localGovName',
    'lclGovNm',
    '자치단체명',
    '자치단체',
    '지자체명',
    '발주기관명',
    '발주기관',
    '기관명',
  ],
  province: ['sido', 'siDo', '시도', '광역자치단체'],
  city: ['sigungu', 'siGunGu', '시군구', '기초자치단체'],
  content: ['description', 'contractContent', 'contractDetails', 'cntrctCn', '계약내용', '사업내용'],
  source: [
    'sourceUrl',
    'detailUrl',
    'detailLink',
    'contractUrl',
    'link',
    'url',
    '원문URL',
    '원문링크',
    '계약상세URL',
    '계약정보URL',
  ],
}

function normalizeFieldKey(value) {
  return String(value).replace(/[\s_()./-]/g, '').toLowerCase()
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function pickField(record, fieldNames) {
  if (!record || typeof record !== 'object') return ''

  for (const fieldName of fieldNames) {
    if (hasValue(record[fieldName])) return String(record[fieldName]).trim()
  }

  const normalizedNames = fieldNames.map(normalizeFieldKey)
  const matchedEntry = Object.entries(record).find(([key, value]) => {
    return hasValue(value) && normalizedNames.includes(normalizeFieldKey(key))
  })

  return matchedEntry ? String(matchedEntry[1]).trim() : ''
}

function toArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (Array.isArray(value.item)) return value.item
  if (value.item) return [value.item]
  return typeof value === 'object' ? [value] : []
}

function looksLikeContractRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false

  const normalizedKeys = Object.keys(record).map(normalizeFieldKey)
  const knownFields = Object.values(CONTRACT_FIELDS).flat().map(normalizeFieldKey)
  return knownFields.some((field) => normalizedKeys.includes(field))
}

function extractContractRecords(payload) {
  const root = payload?.raw ?? payload?.data ?? payload
  const candidates = [
    root?.response?.body?.items?.item,
    root?.response?.body?.items,
    root?.response?.items?.item,
    root?.response?.items,
    root?.data?.items?.item,
    root?.data?.items,
    root?.items?.item,
    root?.items,
    root?.contracts,
    root?.data,
  ]

  for (const candidate of candidates) {
    const records = toArray(candidate).filter(
      (record) => record && typeof record === 'object' && !Array.isArray(record),
    )
    if (records.length) return records
  }

  return looksLikeContractRecord(root) ? [root] : []
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

function formatAmount(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''

  const numericValue = Number(text.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(numericValue)) return text

  return `${numericValue.toLocaleString('ko-KR')}원`
}

function inferIndustryCategory(text) {
  const normalizedText = String(text ?? '').toLowerCase()
  const matchedRule = INDUSTRY_RULES.find((rule) =>
    rule.keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase())),
  )

  return matchedRule?.category ?? UNKNOWN_INDUSTRY_CATEGORY
}

function normalizeRegion(record) {
  const region = pickField(record, CONTRACT_FIELDS.region)
  if (region) return region

  const province = pickField(record, CONTRACT_FIELDS.province)
  const city = pickField(record, CONTRACT_FIELDS.city)
  return [province, city].filter(Boolean).join(' ') || '전국'
}

function normalizeContractRecord(record, index, metadata) {
  const contractId = pickField(record, CONTRACT_FIELDS.id)
  const projectName = pickField(record, CONTRACT_FIELDS.name) || `지방자치단체 계약 정보 ${index + 1}`
  const contractType = pickField(record, CONTRACT_FIELDS.type)
  const contractMethod = pickField(record, CONTRACT_FIELDS.method)
  const contractDate = formatDisplayDate(pickField(record, CONTRACT_FIELDS.date))
  const companyName = pickField(record, CONTRACT_FIELDS.company)
  const contractContent = pickField(record, CONTRACT_FIELDS.content)
  const category = inferIndustryCategory(
    [projectName, contractType, contractContent].filter(Boolean).join(' '),
  )
  const sourceUrl = pickField(record, CONTRACT_FIELDS.source) || metadata.sourceUrl || LOCAL_FINANCE_SOURCE_URL
  const verifiedAt = metadata.retrievedAt?.slice(0, 10) ?? null
  const recordId = createStableId(
    'lofin-contract',
    [contractId, normalizeRegion(record), projectName, contractDate, companyName].join('|'),
  )
  const contractAmount = formatAmount(pickField(record, CONTRACT_FIELDS.amount))
  const contractTypeLabel = contractType || '공공계약'
  const contractDetails = [
    `${contractTypeLabel} 공개자료`,
    contractMethod ? `계약방법 ${contractMethod}` : '',
    contractDate ? `계약일 ${contractDate}` : '',
  ].filter(Boolean)
  const source = createSourceMetadata({
    provider: metadata.provider,
    title: sourceUrl === LOCAL_FINANCE_SOURCE_URL ? '행정안전부 지방재정365 계약현황' : '지방재정365 계약 원문',
    url: sourceUrl,
    publishedAt: contractDate || null,
    verifiedAt,
    retrievedAt: metadata.retrievedAt,
  })

  const item = {
    id: recordId,
    region: normalizeRegion(record),
    recordType: '계약 정보',
    projectName,
    category,
    scale: contractAmount ? `계약금액 ${contractAmount}` : '계약금액 공개자료 확인 필요',
    stage: '사업자 선정',
    stageNote: contractDetails.join(' · '),
    description:
      contractContent ||
      `지방자치단체가 공개한 ${contractTypeLabel} 계약 기록입니다. 계약 업체와 계약금액은 공개 응답에 포함된 항목만 표시합니다.`,
    relatedCompanies: companyName ? [companyName] : [],
    relatedCompanyIds: companyName ? [createStableId('lofin-company', companyName)] : [],
    sourceTitle: source.title,
    sourceDate: contractDate || null,
    sourceUrl,
    verifiedAt,
    source,
    sources: [source],
    dataOrigin: DATA_ORIGINS.LIVE,
    timeline: [
      {
        date: contractDate || verifiedAt || '확인일 미상',
        title: '계약현황 공개자료 확인',
        description: '행정안전부 지방재정365 계약현황에서 공개된 계약 기록을 확인했습니다.',
        type: 'success',
      },
    ],
  }

  if (!companyName) return { item, company: null }

  const relationStatus = /물품|구매|납품|공급/.test(`${contractType} ${projectName}`)
    ? '공급계약 확인 기업'
    : '수주 공시 확인 기업'
  const companySource = createSourceMetadata({
    provider: metadata.provider,
    title: '행정안전부 지방재정365 계약현황',
    url: sourceUrl,
    publishedAt: contractDate || null,
    verifiedAt,
    retrievedAt: metadata.retrievedAt,
    role: 'evidence',
  })
  const companyId = createStableId('lofin-company', companyName)
  const company = {
    id: companyId,
    projectIds: [recordId],
    companyName,
    mainBusiness: '공개 계약 데이터상 계약 상대방이며, 주요 사업은 기업 공식 소개에서 별도 확인이 필요합니다.',
    industries: category === UNKNOWN_INDUSTRY_CATEGORY ? [] : [category],
    relationStatus,
    relationReason: '지방재정365 계약현황에서 해당 사업의 계약 상대방으로 공개되어 직접 연결됩니다.',
    directParticipation: '확인됨',
    connectionBasis: `지방재정365 계약현황의 계약명·계약일자·업체명 항목에서 ${companyName}의 계약 기록을 확인했습니다.`,
    officialUrl: sourceUrl,
    officialLinkLabel: '지방재정365 계약 공개자료',
    evidenceUrl: sourceUrl,
    evidenceTitle: '행정안전부 지방재정365 계약현황',
    dataOrigin: DATA_ORIGINS.LIVE,
    verifiedAt,
    sources: [source, companySource],
  }

  return { item, company }
}

function normalizeContractSnapshot(payload, body, retrievedAt) {
  const records = extractContractRecords(payload)
  const metadata = {
    provider: body.provider ?? '행정안전부 지방재정365 계약현황',
    sourceUrl: body.sourceUrl ?? LOCAL_FINANCE_SOURCE_URL,
    retrievedAt,
  }
  const companies = new Map()
  const items = records
    .map((record, index) => normalizeContractRecord(record, index, metadata))
    .filter(Boolean)
    .map(({ item, company }) => {
      if (company) {
        const existingCompany = companies.get(company.id)
        if (existingCompany) {
          existingCompany.projectIds = [...new Set([...existingCompany.projectIds, ...company.projectIds])]
        } else {
          companies.set(company.id, company)
        }
      }

      return item
    })

  if (!items.length) {
    throw new Error('지방재정365 API 응답에 계약 항목이 없습니다.')
  }

  return {
    dataOrigin: DATA_ORIGINS.LIVE,
    provider: metadata.provider,
    retrievedAt,
    items,
    companies: [...companies.values()],
  }
}

function normalizeSource(source, fallback = {}) {
  return createSourceMetadata({
    provider: source?.provider ?? fallback.provider,
    title: source?.title ?? fallback.sourceTitle,
    url: source?.url ?? fallback.sourceUrl,
    publishedAt: source?.publishedAt ?? fallback.sourceDate ?? null,
    verifiedAt: source?.verifiedAt ?? fallback.verifiedAt ?? null,
    retrievedAt: source?.retrievedAt ?? fallback.retrievedAt ?? null,
    role: source?.role ?? fallback.role ?? 'official',
  })
}

function normalizeProject(item, retrievedAt) {
  const source = normalizeSource(item.source ?? item.sources?.[0], {
    provider: item.provider,
    sourceTitle: item.sourceTitle,
    sourceUrl: item.sourceUrl,
    sourceDate: item.sourceDate,
    verifiedAt: item.verifiedAt,
    retrievedAt,
  })
  const sources = (item.sources ?? [source]).map((sourceItem) =>
    normalizeSource(sourceItem, { ...item, retrievedAt }),
  )

  return {
    ...item,
    dataOrigin: DATA_ORIGINS.LIVE,
    source,
    sources,
    sourceTitle: item.sourceTitle ?? source.title,
    sourceDate: item.sourceDate ?? source.publishedAt,
    sourceUrl: item.sourceUrl ?? source.url,
    verifiedAt: item.verifiedAt ?? source.verifiedAt,
  }
}

function normalizeCompany(company, retrievedAt) {
  const sources = (company.sources ?? [])
    .map((sourceItem) => normalizeSource(sourceItem, { ...company, retrievedAt }))
    .filter((source) => source.url)

  if (!sources.length && company.officialUrl) {
    sources.push(
      normalizeSource(
        {
          provider: company.companyName,
          title: company.officialLinkLabel,
          url: company.officialUrl,
          role: 'official',
        },
        { ...company, retrievedAt },
      ),
    )
  }

  return {
    ...company,
    dataOrigin: DATA_ORIGINS.LIVE,
    sources,
    verifiedAt: company.verifiedAt ?? sources[0]?.verifiedAt ?? null,
  }
}

export function normalizeRegionalIndustrySnapshot(payload) {
  const body = payload?.data ?? payload ?? {}
  const retrievedAt = body.retrievedAt ?? new Date().toISOString()
  const normalizedItems = Array.isArray(body.items)
    ? body.items.filter((item) => item?.projectName).map((item) => normalizeProject(item, retrievedAt))
    : []

  if (normalizedItems.length) {
    const companies = Array.isArray(body.companies)
      ? body.companies.map((company) => normalizeCompany(company, retrievedAt))
      : []

    return {
      dataOrigin: DATA_ORIGINS.LIVE,
      provider: body.provider ?? '공개 API',
      retrievedAt,
      items: normalizedItems,
      companies,
    }
  }

  return normalizeContractSnapshot(body.raw ?? body, body, retrievedAt)
}
