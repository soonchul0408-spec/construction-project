import axios from 'axios'
import {
  assertSuccessfulEnvelope,
  createProviderError,
  createRequestDeadline,
  isRequestTimeoutError,
  parseBoundedInteger,
  parseOfficialApiUrl,
  validateQueryParameterName,
} from './providerUtils.js'

const REQUEST_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_PAGE_SIZE = 100
const DATA_PORTAL_SOURCE_URL = 'https://www.data.go.kr/data/15118650/openapi.do'
const ALLOWED_API_DOMAINS = ['lofin365.go.kr', 'data.go.kr']
const MAX_FIELD_LENGTH = 5000

const CONTRACT_FIELD_NAMES = [
  'contractId',
  'contractNo',
  'contractNumber',
  'contractManagementNumber',
  'contractMngNo',
  'cntrctMngNo',
  '계약대장관리번호',
  '계약번호',
  'contractName',
  'contractTitle',
  'cntrctNm',
  '계약명',
  '계약명칭',
  '사업명',
  'contractAggregateAmount',
  'contractAmount',
  'contractSum',
  'cntrctAmt',
  '계약집계금액',
  '계약금액',
  'contractDate',
  'cntrctDate',
  '계약일자',
  '계약일',
  'contractMethod',
  'cntrctMethod',
  '계약방법',
  '계약방식',
  'contractType',
  'contractCategory',
  'cntrctType',
  'contractGbn',
  '계약종류',
  '계약구분',
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
  'sido',
  'siDo',
  '시도',
  '광역자치단체',
  'sigungu',
  'siGunGu',
  '시군구',
  '기초자치단체',
  'description',
  'contractContent',
  'contractDetails',
  'cntrctCn',
  '계약내용',
  '사업내용',
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
]

function normalizeFieldKey(value) {
  return String(value)
    .replace(/[\s_()./-]/g, '')
    .toLowerCase()
}

const ALLOWED_CONTRACT_FIELDS = new Set(CONTRACT_FIELD_NAMES.map(normalizeFieldKey))

function toArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (Array.isArray(value.item)) return value.item
  if (value.item) return [value.item]
  return typeof value === 'object' ? [value] : []
}

function extractContractRecords(payload) {
  const candidates = [
    payload?.response?.body?.items?.item,
    payload?.response?.body?.items,
    payload?.response?.items?.item,
    payload?.response?.items,
    payload?.data?.items?.item,
    payload?.data?.items,
    payload?.items?.item,
    payload?.items,
    payload?.contracts,
    payload?.data,
  ]

  for (const candidate of candidates) {
    const records = toArray(candidate).filter(
      (record) => record && typeof record === 'object' && !Array.isArray(record),
    )
    if (records.length) return records
  }

  return payload && typeof payload === 'object' && !Array.isArray(payload) ? [payload] : []
}

function sanitizeContractRecord(record) {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key, value]) => {
        return (
          ALLOWED_CONTRACT_FIELDS.has(normalizeFieldKey(key)) &&
          value !== undefined &&
          value !== null &&
          typeof value !== 'object'
        )
      })
      .map(([key, value]) => [key, String(value).slice(0, MAX_FIELD_LENGTH)]),
  )
}

export function sanitizeRegionalIndustryPayload(payload) {
  assertSuccessfulEnvelope(
    [
      payload,
      payload?.header,
      payload?.response,
      payload?.response?.header,
      payload?.response?.body,
      payload?.response?.body?.items,
    ],
    { provider: '지방재정365 API' },
  )

  const records = extractContractRecords(payload)
    .map(sanitizeContractRecord)
    .filter((record) => Object.keys(record).length)

  if (!records.length) {
    throw createProviderError('NO_DATA', '지방재정365 API 응답에 계약 항목이 없습니다.')
  }

  return { items: records }
}

function getConfiguredSourceUrl() {
  const sourceUrl = process.env.LOFIN_CONTRACT_API_URL
  const serviceKey = process.env.LOFIN_CONTRACT_API_KEY

  if (!sourceUrl || !serviceKey) {
    throw createProviderError(
      'CONFIGURATION',
      '지방재정365 API URL 또는 서버용 서비스키가 없어 샘플 데이터를 표시합니다.',
    )
  }

  const url = parseOfficialApiUrl(sourceUrl, {
    label: '지방재정365 API URL',
    allowedDomains: ALLOWED_API_DOMAINS,
  })

  const keyParam = validateQueryParameterName(
    process.env.LOFIN_CONTRACT_KEY_PARAM,
    'key',
    '지방재정365 API 키 파라미터',
  )
  const pageSize = parseBoundedInteger(process.env.LOFIN_CONTRACT_PAGE_SIZE, DEFAULT_PAGE_SIZE, {
    label: 'LOFIN_CONTRACT_PAGE_SIZE',
    max: 1000,
  })

  url.searchParams.set(keyParam, serviceKey)
  if (!url.searchParams.has('type')) url.searchParams.set('type', 'json')
  if (!url.searchParams.has('pindex')) url.searchParams.set('pindex', '1')
  if (!url.searchParams.has('psize')) url.searchParams.set('psize', pageSize)

  if (process.env.LOFIN_CONTRACT_YEAR && !url.searchParams.has('accnut_year')) {
    url.searchParams.set('accnut_year', process.env.LOFIN_CONTRACT_YEAR)
  }

  if (process.env.LOFIN_CONTRACT_DATE && !url.searchParams.has('date_want')) {
    url.searchParams.set('date_want', process.env.LOFIN_CONTRACT_DATE)
  }

  return url
}

export async function fetchRegionalIndustryPayload() {
  const sourceUrl = getConfiguredSourceUrl()

  try {
    const response = await axios.get(sourceUrl.toString(), {
      timeout: REQUEST_TIMEOUT_MS,
      signal: createRequestDeadline(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
      },
      responseType: 'json',
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
    })

    return {
      provider: '행정안전부 지방재정365 계약현황',
      sourceUrl: DATA_PORTAL_SOURCE_URL,
      retrievedAt: new Date().toISOString(),
      raw: sanitizeRegionalIndustryPayload(response.data),
    }
  } catch (error) {
    if (['CONFIGURATION', 'NO_DATA', 'UPSTREAM'].includes(error?.code)) throw error

    if (isRequestTimeoutError(error)) {
      throw createProviderError('TIMEOUT', '지방재정365 API 응답 시간이 초과되었습니다.')
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      throw createProviderError(
        'UPSTREAM',
        `지방재정365 API가 ${status ? `${status} ` : ''}상태를 반환했습니다.`,
      )
    }

    throw error
  }
}
