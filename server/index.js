import { createServer } from 'node:http'
import { fetchAssemblyBillPayload } from './providers/assemblyBillProvider.js'
import { fetchDartCompanyPayload } from './providers/dartProvider.js'
import { fetchRegionalIndustryPayload } from './providers/regionalIndustryProvider.js'
import { getProviderStatus } from './providers/providerRegistry.js'

const port = Number(process.env.API_SERVER_PORT || 8787)
const allowedOrigin = process.env.CORS_ORIGIN || ''

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

function setCorsHeaders(request, response) {
  if (!allowedOrigin) return

  const requestOrigin = request.headers.origin
  if (requestOrigin === allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    response.setHeader('Vary', 'Origin')
  }
}

const server = createServer(async (request, response) => {
  setCorsHeaders(request, response)

  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
    response.statusCode = 204
    response.end()
    return
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    sendJson(response, 200, {
      status: 'ok',
      providers: getProviderStatus(),
    })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/regional-industry/items') {
    try {
      const payload = await fetchRegionalIndustryPayload()
      sendJson(response, 200, { ...payload, dataOrigin: 'live' })
    } catch (error) {
      const isConfigurationError = error?.code === 'CONFIGURATION'
      console.error('[regional-industry-api]', error?.code ?? 'UNKNOWN', error?.message ?? error)
      sendJson(response, isConfigurationError ? 503 : 502, {
        error: isConfigurationError ? 'API_NOT_CONFIGURED' : 'UPSTREAM_API_ERROR',
        message: isConfigurationError
          ? 'API 연결 설정이 없어 샘플 데이터로 대체합니다.'
          : '공개 API를 불러오지 못해 샘플 데이터로 대체합니다.',
      })
    }
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/legislation/bills') {
    try {
      const payload = await fetchAssemblyBillPayload()
      sendJson(response, 200, { ...payload, dataOrigin: 'live' })
    } catch (error) {
      const isConfigurationError = error?.code === 'CONFIGURATION'
      console.error('[legislation-api]', error?.code ?? 'UNKNOWN', error?.message ?? error)
      sendJson(response, isConfigurationError ? 503 : 502, {
        error: isConfigurationError ? 'API_NOT_CONFIGURED' : 'UPSTREAM_API_ERROR',
        message: isConfigurationError
          ? '국회 의안정보 API 연결 설정이 없어 샘플 데이터로 대체합니다.'
          : '국회 의안정보 API를 불러오지 못해 샘플 데이터로 대체합니다.',
      })
    }
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/dart/companies') {
    try {
      const payload = await fetchDartCompanyPayload()
      sendJson(response, 200, { ...payload, dataOrigin: 'live' })
    } catch (error) {
      const isConfigurationError = error?.code === 'CONFIGURATION'
      const isNoDataError = error?.code === 'NO_DATA'
      console.error('[dart-api]', error?.code ?? 'UNKNOWN', error?.message ?? error)
      sendJson(response, isConfigurationError ? 503 : 502, {
        error: isConfigurationError ? 'API_NOT_CONFIGURED' : 'UPSTREAM_API_ERROR',
        message: isConfigurationError || isNoDataError
          ? 'DART API 설정 또는 기업 응답이 없어 기존 샘플 기업 데이터를 표시합니다.'
          : 'DART API를 불러오지 못해 기존 샘플 기업 데이터를 표시합니다.',
      })
    }
    return
  }

  sendJson(response, 404, { error: 'NOT_FOUND', message: '요청한 API 경로가 없습니다.' })
})

server.listen(port, () => {
  console.log(`Regional industry API server listening on http://127.0.0.1:${port}`)
})
