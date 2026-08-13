import { REGIONAL_INDUSTRY_COMPANIES } from '@/data/regionalIndustryCompanies'
import { REGIONAL_INDUSTRY_ITEMS } from '@/data/regionalIndustryData'
import { DATA_ORIGINS, createSourceMetadata } from '@/data/sourceMetadata'

const DART_PROVIDER = '금융감독원 OpenDART'
const DART_COMPANY_GUIDE_URL =
  'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002'
const DART_DISCLOSURE_VIEWER_URL = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='
const DART_SEARCH_URL = 'https://dart.fss.or.kr/dsab001/main.do?autoSearch=true&textCrpNm='

const INDUSTRY_RULES = [
  { category: 'AI·데이터센터', keywords: ['ai', '인공지능', '데이터센터', '클라우드', '컴퓨팅'] },
  { category: '반도체', keywords: ['반도체', 'semiconductor', '파운드리', '웨이퍼'] },
  { category: '방산', keywords: ['방산', '국방', '무기', '군수', '항공엔진'] },
  { category: '이차전지', keywords: ['이차전지', '배터리', '전지', 'ess'] },
  { category: '전력·에너지', keywords: ['전력', '에너지', '전기', '태양광', '수소', '풍력'] },
]

function formatDisplayDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''

  const digits = text.replace(/\D/g, '')
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`
  }

  return text.replace(/-/g, '.')
}

function formatVerifiedDate(value) {
  return formatDisplayDate(value)?.slice(0, 10) || null
}

function inferIndustries(text) {
  const normalizedText = String(text ?? '').toLowerCase()
  return INDUSTRY_RULES.filter((rule) =>
    rule.keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase())),
  ).map((rule) => rule.category)
}

function normalizeDisclosure(disclosure, retrievedAt, viewerUrl) {
  const receiptNo = String(disclosure?.rcept_no ?? '').trim()
  if (!receiptNo) return null

  const receiptDate = formatDisplayDate(disclosure.rcept_dt)
  const reportName = String(disclosure.report_nm ?? '').trim() || 'DART 공시 원문'
  const url = `${viewerUrl || DART_DISCLOSURE_VIEWER_URL}${encodeURIComponent(receiptNo)}`
  const source = createSourceMetadata({
    provider: DART_PROVIDER,
    title: reportName,
    url,
    publishedAt: receiptDate || null,
    verifiedAt: formatVerifiedDate(retrievedAt),
    retrievedAt,
    role: 'official',
  })

  return {
    reportName,
    receiptNo,
    receiptDate: receiptDate || null,
    filerName: String(disclosure.flr_nm ?? '').trim(),
    url,
    source,
  }
}

function uniqueSources(sources) {
  const sourceMap = new Map()
  sources.filter((source) => source?.url).forEach((source) => {
    sourceMap.set(source.url, source)
  })
  return [...sourceMap.values()]
}

function createDartCompanySource({ url, title, retrievedAt, role = 'official' }) {
  return createSourceMetadata({
    provider: DART_PROVIDER,
    title,
    url,
    verifiedAt: formatVerifiedDate(retrievedAt),
    retrievedAt,
    role,
  })
}

function mapDartCompany(record, metadata) {
  const baseCompany = REGIONAL_INDUSTRY_COMPANIES.find(
    (company) => company.id === record.companyId,
  )
  const profile = record.company ?? {}
  const companyName = baseCompany?.companyName || profile.corp_name || record.requestedCompanyName
  const corpCode = String(profile.corp_code || record.corpCode || '').trim()
  const homepageUrl = String(profile.hm_url ?? '').trim()
  const companySearchUrl = `${DART_SEARCH_URL}${encodeURIComponent(companyName)}`
  const companySource = createDartCompanySource({
    url: metadata.companyGuideUrl || DART_COMPANY_GUIDE_URL,
    title: 'DART 기업개황 API 안내',
    retrievedAt: metadata.retrievedAt,
  })
  const disclosures = (Array.isArray(record.disclosures) ? record.disclosures : [])
    .map((disclosure) =>
      normalizeDisclosure(disclosure, metadata.retrievedAt, metadata.disclosureViewerUrl),
    )
    .filter(Boolean)
  const disclosureSources = disclosures.map((disclosure) => disclosure.source)
  const sourceList = uniqueSources([
    ...(baseCompany?.sources ?? []),
    companySource,
    ...disclosureSources,
  ])
  const verifiedAt = formatVerifiedDate(metadata.retrievedAt)
  const industries = [
    ...(baseCompany?.industries ?? []),
    ...(record.industries ?? []),
    ...inferIndustries(`${companyName} ${profile.induty_code ?? ''} ${baseCompany?.mainBusiness ?? ''}`),
  ].filter(Boolean)
  const uniqueIndustries = [...new Set(industries)]
  const projectIds = baseCompany?.projectIds ?? []
  const relatedProjectNames = projectIds
    .map((projectId) => REGIONAL_INDUSTRY_ITEMS.find((item) => item.id === projectId)?.projectName)
    .filter(Boolean)
  const latestDisclosure = disclosures[0]
  const dartBusinessSummary = profile.induty_code
    ? `DART 업종코드 ${profile.induty_code} · 상세 사업내용은 최근 공시 원문에서 확인하세요.`
    : 'DART 기업개황의 업종코드가 확인되지 않았습니다. 상세 사업내용은 공시 원문에서 확인하세요.'
  const fallbackMainBusiness =
    baseCompany?.mainBusiness ||
    `DART 기업개황 업종코드 ${profile.induty_code || '확인 필요'} 기준 기업입니다.`
  const fallbackEvidenceUrl = latestDisclosure?.url || metadata.disclosureGuideUrl || companySearchUrl

  return {
    ...baseCompany,
    id: baseCompany?.id || `dart-company-${corpCode || record.companyId}`,
    projectIds,
    relatedProjectNames,
    companyName,
    mainBusiness: fallbackMainBusiness,
    industries: uniqueIndustries,
    relationStatus: baseCompany?.relationStatus || '산업 관련 기업',
    relationReason:
      baseCompany?.relationReason ||
      'DART 기업개황의 기업 정보와 공개자료상 산업 분류를 기준으로 관련성을 정리했습니다.',
    directParticipation: baseCompany?.directParticipation || '확인되지 않음',
    connectionBasis:
      baseCompany?.connectionBasis ||
      'DART 기업개황과 공시 원문은 기업 정보 확인 자료이며, 지역 사업 직접 참여 여부를 단독으로 의미하지 않습니다.',
    officialUrl: baseCompany?.officialUrl || homepageUrl || companySearchUrl,
    officialLinkLabel: baseCompany?.officialLinkLabel || '기업 홈페이지',
    evidenceUrl: baseCompany?.evidenceUrl || fallbackEvidenceUrl,
    evidenceTitle: baseCompany?.evidenceTitle || 'DART 공시 원문',
    dataOrigin: baseCompany ? 'mixed' : DATA_ORIGINS.LIVE,
    relationDataOrigin: baseCompany ? DATA_ORIGINS.SAMPLE : DATA_ORIGINS.LIVE,
    dartDataOrigin: DATA_ORIGINS.LIVE,
    verifiedAt,
    sources: sourceList,
    source: companySource,
    dartBusinessSummary,
    dartDisclosures: disclosures,
    dartProfile: {
      corpCode,
      corpName: String(profile.corp_name ?? companyName).trim(),
      stockName: String(profile.stock_name ?? '').trim(),
      stockCode: String(profile.stock_code ?? '').trim(),
      ceoName: String(profile.ceo_nm ?? '').trim(),
      industryCode: String(profile.induty_code ?? '').trim(),
      address: String(profile.adres ?? '').trim(),
      homepageUrl,
      irUrl: String(profile.ir_url ?? '').trim(),
    },
    dartCompanySearchUrl: companySearchUrl,
    latestDisclosureDate: latestDisclosure?.receiptDate || null,
    latestDisclosureName: latestDisclosure?.reportName || '',
    provider: metadata.provider,
  }
}

export function normalizeDartCompaniesSnapshot(payload) {
  const body = payload?.data ?? payload ?? {}
  const retrievedAt = body.retrievedAt ?? new Date().toISOString()
  const records = Array.isArray(body.companies) ? body.companies : []

  return {
    dataOrigin: DATA_ORIGINS.LIVE,
    provider: body.provider ?? DART_PROVIDER,
    sourceUrl: body.sourceUrl ?? 'https://opendart.fss.or.kr/',
    retrievedAt,
    requestedCount: Number(body.requestedCount ?? records.length),
    companies: records.map((record) =>
      mapDartCompany(record, {
        provider: body.provider ?? DART_PROVIDER,
        retrievedAt,
        companyGuideUrl: body.companyGuideUrl,
        disclosureGuideUrl: body.disclosureGuideUrl,
        disclosureViewerUrl: body.disclosureViewerUrl,
      }),
    ),
  }
}
