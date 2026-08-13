import axios from 'axios'
import { DART_COMPANY_REGISTRY } from './dartCompanyRegistry.js'

const REQUEST_TIMEOUT_MS = 10000
const DART_API_BASE_URL = 'https://opendart.fss.or.kr/api'
const DART_SOURCE_URL = 'https://opendart.fss.or.kr/'
const DART_COMPANY_GUIDE_URL =
  'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002'
const DART_DISCLOSURE_GUIDE_URL =
  'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001'
const DART_DISCLOSURE_VIEWER_URL = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='
const DEFAULT_DISCLOSURE_PAGE_SIZE = 10

function createProviderError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
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

async function requestDartJson(pathname, params, fallbackMessage) {
  const url = buildUrl(pathname, params)

  try {
    const response = await axios.get(url.toString(), {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
      },
      responseType: 'json',
    })
    const payload = response.data

    if (String(payload?.status ?? '') !== '000') {
      const errorCode = String(payload?.status ?? '') === '013' ? 'NO_DATA' : 'UPSTREAM'
      throw createProviderError(errorCode, getDartStatusMessage(payload, fallbackMessage))
    }

    return payload
  } catch (error) {
    if (error?.code === 'CONFIGURATION' || error?.code === 'NO_DATA' || error?.code === 'UPSTREAM') {
      throw error
    }

    if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
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

async function fetchDartCompany(registry, apiKey) {
  const companyPayload = await requestDartJson(
    'company.json',
    {
      crtfc_key: apiKey,
      corp_code: registry.corpCode,
    },
    `${registry.companyName} 기업개황을 확인하지 못했습니다.`,
  )

  let disclosurePayload = { list: [] }
  try {
    disclosurePayload = await requestDartJson(
      'list.json',
      {
        crtfc_key: apiKey,
        corp_code: registry.corpCode,
        bgn_de: getDisclosureStartDate(),
        end_de: getDateString(new Date()),
        page_no: 1,
        page_count: Number(process.env.DART_DISCLOSURE_PAGE_SIZE || DEFAULT_DISCLOSURE_PAGE_SIZE),
        sort: 'DATE',
        sort_mth: 'DESC',
      },
      `${registry.companyName} 공시 목록을 확인하지 못했습니다.`,
    )
  } catch (error) {
    if (error?.code !== 'NO_DATA') throw error
  }

  return {
    companyId: registry.companyId,
    requestedCompanyName: registry.companyName,
    corpCode: registry.corpCode,
    industries: registry.industries,
    company: companyPayload,
    disclosures: disclosurePayload.list ?? [],
  }
}

export async function fetchDartCompanyPayload() {
  const apiKey = getConfiguredKey()
  const retrievedAt = new Date().toISOString()
  const results = await Promise.allSettled(
    DART_COMPANY_REGISTRY.map((registry) => fetchDartCompany(registry, apiKey)),
  )
  const companies = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)

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
    companies,
  }
}

