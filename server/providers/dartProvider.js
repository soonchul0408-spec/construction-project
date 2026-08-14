import axios from 'axios'
import { DART_COMPANY_REGISTRY } from './dartCompanyRegistry.js'
import {
  createRequestDeadline,
  createProviderError,
  isRequestTimeoutError,
  normalizePublicHttpUrl,
  parseBoundedInteger,
} from './providerUtils.js'

const REQUEST_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 1024 * 1024
const DART_API_BASE_URL = 'https://opendart.fss.or.kr/api'
const DART_SOURCE_URL = 'https://opendart.fss.or.kr/'
const DART_COMPANY_GUIDE_URL =
  'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002'
const DART_DISCLOSURE_GUIDE_URL =
  'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001'
const DART_DISCLOSURE_VIEWER_URL = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='
const DEFAULT_DISCLOSURE_PAGE_SIZE = 10
const MAX_TEXT_LENGTH = 2000

function safeText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength)
}

export function sanitizeDartCompanyProfile(payload) {
  return {
    corp_code: safeText(payload?.corp_code, 16),
    corp_name: safeText(payload?.corp_name, 200),
    stock_name: safeText(payload?.stock_name, 200),
    stock_code: safeText(payload?.stock_code, 16),
    ceo_nm: safeText(payload?.ceo_nm, 200),
    induty_code: safeText(payload?.induty_code, 32),
    adres: safeText(payload?.adres),
    hm_url: normalizePublicHttpUrl(payload?.hm_url),
    ir_url: normalizePublicHttpUrl(payload?.ir_url),
  }
}

function sanitizeDartDisclosure(disclosure) {
  const receiptNo = safeText(disclosure?.rcept_no, 20)
  if (!/^\d{8,20}$/.test(receiptNo)) return null

  return {
    rcept_no: receiptNo,
    rcept_dt: safeText(disclosure?.rcept_dt, 16),
    report_nm: safeText(disclosure?.report_nm, 500),
    flr_nm: safeText(disclosure?.flr_nm, 200),
  }
}

function getDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function getDisclosureStartDate() {
  const date = new Date()
  date.setDate(date.getDate() - 365)
  return getDateString(date)
}

function getConfiguredKey() {
  const apiKey = String(process.env.DART_API_KEY ?? '').trim()

  if (!apiKey) {
    throw createProviderError(
      'CONFIGURATION',
      'DART_API_KEY가 없어 기존 샘플 기업 데이터를 표시합니다.',
    )
  }

  return apiKey
}

function buildUrl(pathname, params) {
  const url = new URL(`${DART_API_BASE_URL}/${pathname}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return url
}

function getDartStatusMessage(payload, fallback) {
  const status = String(payload?.status ?? '').trim()
  const message = String(payload?.message ?? '').trim()
  return message || (status ? `${fallback} (코드 ${status})` : fallback)
}

async function requestDartJson(pathname, params, fallbackMessage, signal) {
  const url = buildUrl(pathname, params)

  try {
    const response = await axios.get(url.toString(), {
      timeout: REQUEST_TIMEOUT_MS,
      signal,
      headers: {
        Accept: 'application/json',
      },
      responseType: 'json',
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
    })
    const payload = response.data

    if (String(payload?.status ?? '') !== '000') {
      const errorCode = String(payload?.status ?? '') === '013' ? 'NO_DATA' : 'UPSTREAM'
      throw createProviderError(errorCode, getDartStatusMessage(payload, fallbackMessage))
    }

    return payload
  } catch (error) {
    if (
      error?.code === 'CONFIGURATION' ||
      error?.code === 'NO_DATA' ||
      error?.code === 'UPSTREAM'
    ) {
      throw error
    }

    if (isRequestTimeoutError(error)) {
      throw createProviderError('TIMEOUT', 'DART API 응답 시간이 초과되었습니다.')
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      throw createProviderError(
        'UPSTREAM',
        `DART API가 ${status ? `${status} ` : ''}상태를 반환했습니다.`,
      )
    }

    throw error
  }
}

async function fetchDartCompany(registry, apiKey, disclosurePageSize, signal) {
  const companyPayload = await requestDartJson(
    'company.json',
    {
      crtfc_key: apiKey,
      corp_code: registry.corpCode,
    },
    `${registry.companyName} 기업개황을 확인하지 못했습니다.`,
    signal,
  )

  let disclosurePayload = { list: [] }
  const warnings = []
  try {
    disclosurePayload = await requestDartJson(
      'list.json',
      {
        crtfc_key: apiKey,
        corp_code: registry.corpCode,
        bgn_de: getDisclosureStartDate(),
        end_de: getDateString(new Date()),
        page_no: 1,
        page_count: disclosurePageSize,
        sort: 'DATE',
        sort_mth: 'DESC',
      },
      `${registry.companyName} 공시 목록을 확인하지 못했습니다.`,
      signal,
    )
  } catch (error) {
    if (!['NO_DATA', 'TIMEOUT', 'UPSTREAM'].includes(error?.code)) throw error
    if (error?.code !== 'NO_DATA') {
      warnings.push({
        code: error.code,
        message: '최근 공시 목록을 불러오지 못해 기업개황만 표시합니다.',
      })
    }
  }

  return {
    companyId: registry.companyId,
    requestedCompanyName: registry.companyName,
    corpCode: registry.corpCode,
    industries: registry.industries,
    company: sanitizeDartCompanyProfile(companyPayload),
    disclosures: (Array.isArray(disclosurePayload.list) ? disclosurePayload.list : [])
      .map(sanitizeDartDisclosure)
      .filter(Boolean),
    warnings,
  }
}

export async function fetchDartCompanyPayload() {
  const apiKey = getConfiguredKey()
  const disclosurePageSize = parseBoundedInteger(
    process.env.DART_DISCLOSURE_PAGE_SIZE,
    DEFAULT_DISCLOSURE_PAGE_SIZE,
    { label: 'DART_DISCLOSURE_PAGE_SIZE', max: 100 },
  )
  const retrievedAt = new Date().toISOString()
  const signal = createRequestDeadline(REQUEST_TIMEOUT_MS)
  const results = await Promise.allSettled(
    DART_COMPANY_REGISTRY.map((registry) => fetchDartCompany(registry, apiKey, disclosurePageSize, signal)),
  )
  const companies = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
  const failures = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return []
    return [
      {
        companyId: DART_COMPANY_REGISTRY[index].companyId,
        companyName: DART_COMPANY_REGISTRY[index].companyName,
        code: result.reason?.code ?? 'UNKNOWN',
      },
    ]
  })

  if (!companies.length) {
    const firstFailure = results.find((result) => result.status === 'rejected')
    throw firstFailure?.reason ?? createProviderError('NO_DATA', 'DART 기업 데이터가 없습니다.')
  }

  return {
    provider: '금융감독원 OpenDART',
    sourceUrl: DART_SOURCE_URL,
    companyGuideUrl: DART_COMPANY_GUIDE_URL,
    disclosureGuideUrl: DART_DISCLOSURE_GUIDE_URL,
    disclosureViewerUrl: DART_DISCLOSURE_VIEWER_URL,
    retrievedAt,
    requestedCount: DART_COMPANY_REGISTRY.length,
    failedCount: failures.length,
    failures,
    companies,
  }
}
