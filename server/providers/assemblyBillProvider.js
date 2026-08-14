import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'
import {
  assertSuccessfulEnvelope,
  createRequestDeadline,
  createProviderError,
  isRequestTimeoutError,
  parseBoundedInteger,
  parseOfficialApiUrl,
  validateQueryParameterName,
} from './providerUtils.js'

const REQUEST_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_PAGE_SIZE = 100
const ASSEMBLY_SOURCE_URL = 'https://www.data.go.kr/data/15126134/openapi.do'
const ALLOWED_API_DOMAINS = ['assembly.go.kr', 'data.go.kr']
const ALLOWED_BILL_FIELDS = new Set([
  'BILL_ID', 'billId', 'BILL_NO', 'billNo', 'billNumber', '의안ID', '의안번호',
  'BILL_NAME', 'BILL_NM', 'billName', 'billNm', 'billTitle', '의안명', '법안명',
  'PROPOSE_DT', 'PPSL_DT', 'proposeDt', 'proposalDate', 'proposedAt', '제안일', '발의일',
  'PROPOSER', 'RST_PROPOSER', 'PPSR_NM', 'proposer', 'proposerName', 'representativeProposer', '대표발의자', '제안자',
  'COMMITTEE', 'COMMITTEE_NM', 'CURR_COMMITTEE', 'committee', 'responsibleOrg', 'organization', '소관위원회', '소관기관', '제출기관',
  'PROC_RESULT_NM', 'PROC_RESULT', 'PROC_RESULT_DESC', 'PROC_RESULT_CD', 'processingStatus', 'procedureStatus', 'stage', '진행단계', '심사단계', '처리결과',
  'REGION', 'RELATED_REGION', 'region', 'relatedRegion', '지역', '관련지역',
  'INDUSTRY', 'CATEGORY', 'industry', 'category', '산업', '산업분류',
  'BILL_SUMMARY', 'PROPOSE_REASON', 'BILL_DESC', 'description', 'summary', '제안이유', '주요내용',
  'LINK_URL', 'DETAIL_LINK', 'detailUrl', 'sourceUrl', 'linkUrl', '원문URL', '상세URL',
  'COMMITTEE_DT', 'COMMITTEE_DATE', 'committeeDate', 'committeeReviewDate', '상임위심사일', '위원회심사일',
  'COMMITTEE_RESULT', 'committeeResult', '상임위심사결과', '위원회심사결과',
  'PLENARY_DT', 'PLENARY_DATE', 'plenaryDate', '본회의심사일', '본회의처리일',
  'PLENARY_RESULT', 'plenaryResult', '본회의심사결과', '본회의처리결과',
  'PROC_DT', 'PROCESS_DT', 'processedAt', '처리일', '처리일자',
  'resultCode', 'result_code', 'RESULT_CODE', 'returnReasonCode', 'CODE',
  'resultMsg', 'resultMessage', 'result_msg', 'RESULT_MSG', 'returnAuthMsg', 'errMsg', 'MESSAGE',
  'list_total_count', 'totalCount', 'total_count',
])
const BILL_NAME_FIELDS = new Set(['BILL_NAME', 'BILL_NM', 'billName', 'billNm', 'billTitle', '의안명', '법안명'])
const ENVELOPE_FIELDS = new Set([
  'resultCode', 'result_code', 'RESULT_CODE', 'returnReasonCode', 'CODE',
  'resultMsg', 'resultMessage', 'result_msg', 'RESULT_MSG', 'returnAuthMsg', 'errMsg', 'MESSAGE',
  'list_total_count', 'totalCount', 'total_count',
])
const BILL_RECORD_FIELDS = new Set([...ALLOWED_BILL_FIELDS].filter((field) => !ENVELOPE_FIELDS.has(field)))

function getConfiguredSourceUrl() {
  const sourceUrl = process.env.ASSEMBLY_BILL_API_URL
  const serviceKey = process.env.ASSEMBLY_BILL_API_KEY

  if (!sourceUrl || !serviceKey) {
    throw createProviderError(
      'CONFIGURATION',
      '국회 의안정보 API URL 또는 서버용 서비스키가 없어 샘플 데이터를 표시합니다.',
    )
  }

  const url = parseOfficialApiUrl(sourceUrl, {
    label: '국회 의안정보 API URL',
    allowedDomains: ALLOWED_API_DOMAINS,
  })

  const keyParam = validateQueryParameterName(
    process.env.ASSEMBLY_BILL_KEY_PARAM,
    'KEY',
    '국회 의안정보 API 키 파라미터',
  )
  const responseType = String(process.env.ASSEMBLY_BILL_RESPONSE_TYPE || 'xml').toLowerCase()
  if (!['xml', 'json'].includes(responseType)) {
    throw createProviderError(
      'CONFIGURATION',
      'ASSEMBLY_BILL_RESPONSE_TYPE은 xml 또는 json이어야 합니다.',
    )
  }
  const pageSize = parseBoundedInteger(process.env.ASSEMBLY_BILL_PAGE_SIZE, DEFAULT_PAGE_SIZE, {
    label: 'ASSEMBLY_BILL_PAGE_SIZE',
    max: 1000,
  })

  url.searchParams.set(keyParam, serviceKey)
  if (!url.searchParams.has('Type')) url.searchParams.set('Type', responseType)
  if (!url.searchParams.has('pIndex')) url.searchParams.set('pIndex', '1')
  if (!url.searchParams.has('pSize')) url.searchParams.set('pSize', pageSize)

  if (process.env.ASSEMBLY_BILL_AGE && !url.searchParams.has('AGE')) {
    url.searchParams.set('AGE', process.env.ASSEMBLY_BILL_AGE)
  }

  return url
}

function collectStatusEnvelopes(value, envelopes = [], depth = 0) {
  if (!value || depth > 8) return envelopes

  if (Array.isArray(value)) {
    value.forEach((item) => collectStatusEnvelopes(item, envelopes, depth + 1))
    return envelopes
  }

  if (typeof value !== 'object') return envelopes
  if (
    ['resultCode', 'result_code', 'RESULT_CODE', 'returnReasonCode', 'CODE'].some(
      (key) => value[key] !== undefined,
    )
  ) {
    envelopes.push(value)
  }

  Object.values(value).forEach((child) => collectStatusEnvelopes(child, envelopes, depth + 1))
  return envelopes
}

export function parseAssemblyResponseBody(value) {
  if (value && typeof value === 'object') return value

  const text = String(value ?? '').trim()
  if (!text) throw createProviderError('UPSTREAM', '국회 의안정보 API 응답이 비어 있습니다.')

  if (text.startsWith('<')) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: true,
      trimValues: true,
    })

    try {
      return parser.parse(text)
    } catch {
      throw createProviderError('UPSTREAM', '국회 의안정보 API XML 응답을 해석하지 못했습니다.')
    }
  }

  try {
    return JSON.parse(text)
  } catch {
    throw createProviderError('UPSTREAM', '국회 의안정보 API 응답 형식이 올바르지 않습니다.')
  }
}

export function validateAssemblyPayload(payload) {
  assertSuccessfulEnvelope(collectStatusEnvelopes(payload), {
    provider: '국회 의안정보 API',
  })
  return payload
}

export function sanitizeAssemblyPayload(payload) {
  validateAssemblyPayload(payload)
  const records = []
  const collect = (value, depth = 0) => {
    if (!value || depth > 8 || records.length >= 1000) return
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, depth + 1))
      return
    }
    if (typeof value !== 'object') return
    const entries = Object.entries(value)
    const hasBillName = entries.some(([key, item]) => BILL_NAME_FIELDS.has(key) && item !== null && typeof item !== 'object' && String(item).trim())
    const billFields = entries.filter(([key, item]) => BILL_RECORD_FIELDS.has(key) && item !== null && ['string', 'number', 'boolean'].includes(typeof item))
    if (hasBillName && billFields.length >= 2) {
      records.push(Object.fromEntries(billFields.map(([key, item]) => [key, typeof item === 'string' ? item.slice(0, 4000) : item])))
      return
    }
    entries.forEach(([, child]) => collect(child, depth + 1))
  }
  collect(payload)
  if (!records.length) throw createProviderError('NO_DATA', '국회 의안정보 API 응답에 법안 항목이 없습니다.')
  return { items: records }
}

export async function fetchAssemblyBillPayload() {
  const sourceUrl = getConfiguredSourceUrl()

  try {
    const response = await axios.get(sourceUrl.toString(), {
      timeout: REQUEST_TIMEOUT_MS,
      signal: createRequestDeadline(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/xml, text/xml, application/json;q=0.9',
      },
      responseType: 'text',
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
    })
    const payload = sanitizeAssemblyPayload(parseAssemblyResponseBody(response.data))

    return {
      provider: '국회 국회사무처_의안정보 통합 API',
      sourceUrl: ASSEMBLY_SOURCE_URL,
      retrievedAt: new Date().toISOString(),
      raw: payload,
    }
  } catch (error) {
    if (error?.code === 'CONFIGURATION' || error?.code === 'UPSTREAM') throw error

    if (isRequestTimeoutError(error)) {
      throw createProviderError('TIMEOUT', '국회 의안정보 API 응답 시간이 초과되었습니다.')
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      throw createProviderError(
        'UPSTREAM',
        `국회 의안정보 API가 ${status ? `${status} ` : ''}상태를 반환했습니다.`,
      )
    }

    throw error
  }
}
