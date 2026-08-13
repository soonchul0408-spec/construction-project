import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'

const REQUEST_TIMEOUT_MS = 10000
const DEFAULT_PAGE_SIZE = 100
const ASSEMBLY_SOURCE_URL = 'https://www.data.go.kr/data/15126134/openapi.do'

function createProviderError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function getConfiguredSourceUrl() {
  const sourceUrl = process.env.ASSEMBLY_BILL_API_URL
  const serviceKey = process.env.ASSEMBLY_BILL_API_KEY

  if (!sourceUrl || !serviceKey) {
    throw createProviderError(
      'CONFIGURATION',
      '국회 의안정보 API URL 또는 서버용 서비스키가 없어 샘플 데이터를 표시합니다.',
    )
  }

  let url
  try {
    url = new URL(sourceUrl)
  } catch {
    throw createProviderError('CONFIGURATION', '국회 의안정보 API URL 형식이 올바르지 않습니다.')
  }

  const keyParam = process.env.ASSEMBLY_BILL_KEY_PARAM || 'KEY'
  const responseType = process.env.ASSEMBLY_BILL_RESPONSE_TYPE || 'xml'
  const pageSize = process.env.ASSEMBLY_BILL_PAGE_SIZE || String(DEFAULT_PAGE_SIZE)

  url.searchParams.set(keyParam, serviceKey)
  if (!url.searchParams.has('Type')) url.searchParams.set('Type', responseType)
  if (!url.searchParams.has('pIndex')) url.searchParams.set('pIndex', '1')
  if (!url.searchParams.has('pSize')) url.searchParams.set('pSize', pageSize)

  if (process.env.ASSEMBLY_BILL_AGE && !url.searchParams.has('AGE')) {
    url.searchParams.set('AGE', process.env.ASSEMBLY_BILL_AGE)
  }

  return url
}

function parseResponseBody(value) {
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

export async function fetchAssemblyBillPayload() {
  const sourceUrl = getConfiguredSourceUrl()

  try {
    const response = await axios.get(sourceUrl.toString(), {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/xml, text/xml, application/json;q=0.9',
      },
      responseType: 'text',
    })

    return {
      provider: '국회 국회사무처_의안정보 통합 API',
      sourceUrl: ASSEMBLY_SOURCE_URL,
      retrievedAt: new Date().toISOString(),
      raw: parseResponseBody(response.data),
    }
  } catch (error) {
    if (error?.code === 'CONFIGURATION' || error?.code === 'UPSTREAM') throw error

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
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
