import axios from 'axios'

const REQUEST_TIMEOUT_MS = 10000
const DEFAULT_PAGE_SIZE = 100
const DATA_PORTAL_SOURCE_URL = 'https://www.data.go.kr/data/15118650/openapi.do'

function createProviderError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
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

  let url
  try {
    url = new URL(sourceUrl)
  } catch {
    throw createProviderError('CONFIGURATION', '지방재정365 API URL 형식이 올바르지 않습니다.')
  }

  const keyParam = process.env.LOFIN_CONTRACT_KEY_PARAM || 'key'
  const pageSize = process.env.LOFIN_CONTRACT_PAGE_SIZE || String(DEFAULT_PAGE_SIZE)

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
      headers: {
        Accept: 'application/json',
      },
      responseType: 'json',
    })

    return {
      provider: '행정안전부 지방재정365 계약현황',
      sourceUrl: DATA_PORTAL_SOURCE_URL,
      retrievedAt: new Date().toISOString(),
      raw: response.data,
    }
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
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
