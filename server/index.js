import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAssemblyBillPayload } from './providers/assemblyBillProvider.js'
import { fetchDartCompanyPayload } from './providers/dartProvider.js'
import { fetchRegionalIndustryPayload } from './providers/regionalIndustryProvider.js'
import { getProviderStatus } from './providers/providerRegistry.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8787
const DEFAULT_CACHE_TTL_MS = 60_000
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60
const MAX_TRACKED_RATE_LIMIT_CLIENTS = 10_000
const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]']

function parseInteger(value, fallback, { label, min, max }) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}은 ${min}~${max} 범위의 정수여야 합니다.`)
  }
  return parsed
}

function parseHost(value) {
  const host = String(value || DEFAULT_HOST).trim()
  if (!host || !/^[A-Za-z0-9.:-]+$/.test(host)) {
    throw new Error('API_SERVER_HOST 형식이 올바르지 않습니다.')
  }
  return host
}

function parseAllowedOrigin(value) {
  const origin = String(value ?? '').trim()
  if (!origin) return ''

  try {
    const url = new URL(origin)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password
    ) {
      throw new Error()
    }
    return origin
  } catch {
    throw new Error('CORS_ORIGIN은 경로가 없는 http(s) origin이어야 합니다.')
  }
}

function parseAllowedHosts(value, bindHost, allowedOrigin) {
  const configured = String(value ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
  const rawCandidates = [...DEFAULT_ALLOWED_HOSTS, bindHost.toLowerCase(), ...configured]
  if (allowedOrigin) rawCandidates.push(new URL(allowedOrigin).hostname.toLowerCase())
  if (rawCandidates.length > 32) throw new Error('API_SERVER_ALLOWED_HOSTS는 32개 이하로 입력해야 합니다.')
  const candidates = new Set()
  for (const host of rawCandidates) {
    try {
      const urlHost = isIP(host) === 6 ? `[${host}]` : host
      const parsed = new URL(`http://${urlHost}`)
      if (
        parsed.hostname.toLowerCase() !== urlHost ||
        parsed.username ||
        parsed.password ||
        parsed.port ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      ) throw new Error()
      candidates.add(parsed.hostname.toLowerCase())
    } catch {
      throw new Error('API_SERVER_ALLOWED_HOSTS에는 포트·경로 없는 호스트명만 입력해야 합니다.')
    }
  }
  return [...candidates]
}

function parseTrustedProxyAddresses(value) {
  const addresses = String(value ?? '').split(',').map((address) => address.trim()).filter(Boolean)
  if (addresses.length > 16 || addresses.some((address) => !isIP(address))) {
    throw new Error('API_TRUSTED_PROXY_ADDRESSES에는 쉼표로 구분한 IP 주소를 16개 이하로 입력해야 합니다.')
  }
  return addresses
}

export function resolveServerConfig(env = process.env) {
  const host = parseHost(env.API_SERVER_HOST)
  const allowedOrigin = parseAllowedOrigin(env.CORS_ORIGIN)
  return {
    host,
    port: parseInteger(env.API_SERVER_PORT, DEFAULT_PORT, {
      label: 'API_SERVER_PORT',
      min: 1,
      max: 65535,
    }),
    allowedOrigin,
    allowedHosts: parseAllowedHosts(env.API_SERVER_ALLOWED_HOSTS, host, allowedOrigin),
    trustedProxyAddresses: parseTrustedProxyAddresses(env.API_TRUSTED_PROXY_ADDRESSES),
    cacheTtlMs: parseInteger(env.API_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS, {
      label: 'API_CACHE_TTL_MS',
      min: 0,
      max: 3_600_000,
    }),
    rateLimitWindowMs: parseInteger(env.API_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS, {
      label: 'API_RATE_LIMIT_WINDOW_MS',
      min: 1000,
      max: 3_600_000,
    }),
    rateLimitMaxRequests: parseInteger(
      env.API_RATE_LIMIT_MAX_REQUESTS,
      DEFAULT_RATE_LIMIT_MAX_REQUESTS,
      {
        label: 'API_RATE_LIMIT_MAX_REQUESTS',
        min: 1,
        max: 10_000,
      },
    ),
  }
}

function sendJson(response, statusCode, payload, headers = {}) {
  if (response.writableEnded) return

  const body = JSON.stringify(payload)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  Object.entries(headers).forEach(([name, value]) => response.setHeader(name, value))
  response.end(body)
}

function setCorsHeaders(request, response, allowedOrigin) {
  if (!allowedOrigin) return

  const requestOrigin = request.headers.origin
  if (requestOrigin === allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    response.setHeader('Vary', 'Origin')
  }
}

function isValidHostHeader(host, allowedHosts) {
  if (!host) return true

  try {
    const parsed = new URL(`http://${host}`)
    return (
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === '/' &&
      !parsed.search &&
      !parsed.hash &&
      allowedHosts.includes(parsed.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

function createRequestCoordinator(cacheTtlMs, now) {
  const cache = new Map()
  const inFlight = new Map()

  return {
    async load(key, loader) {
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now()) {
        return { payload: cached.payload, cacheStatus: 'HIT' }
      }
      if (cached) cache.delete(key)

      const existingRequest = inFlight.get(key)
      if (existingRequest) {
        return { payload: await existingRequest, cacheStatus: 'COALESCED' }
      }

      const requestPromise = Promise.resolve()
        .then(loader)
        .then((payload) => {
          if (cacheTtlMs > 0) {
            cache.set(key, { payload, expiresAt: now() + cacheTtlMs })
          }
          return payload
        })
        .finally(() => inFlight.delete(key))

      inFlight.set(key, requestPromise)
      return { payload: await requestPromise, cacheStatus: 'MISS' }
    },
  }
}

function createRateLimiter({ windowMs, maxRequests, now }) {
  const clients = new Map()
  let checksUntilCleanup = 1000
  let lastFullCleanupAt = Number.NEGATIVE_INFINITY

  function cleanup(expirationThreshold) {
    for (const [key, client] of clients) {
      if (client.windowStartedAt <= expirationThreshold) clients.delete(key)
    }
  }

  return {
    consume(clientKey) {
      const currentTime = now()
      let client = clients.get(clientKey)
      if (!client && clients.size >= MAX_TRACKED_RATE_LIMIT_CLIENTS) {
        if (currentTime - lastFullCleanupAt >= windowMs) {
          cleanup(currentTime - windowMs)
          lastFullCleanupAt = currentTime
        }
        if (clients.size >= MAX_TRACKED_RATE_LIMIT_CLIENTS) {
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
          }
        }
      }
      if (!client || currentTime - client.windowStartedAt >= windowMs) {
        client = { count: 0, windowStartedAt: currentTime }
        clients.set(clientKey, client)
      }

      checksUntilCleanup -= 1
      if (checksUntilCleanup <= 0) {
        cleanup(currentTime - windowMs)
        checksUntilCleanup = 1000
      }

      if (client.count >= maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((client.windowStartedAt + windowMs - currentTime) / 1000),
          ),
        }
      }

      client.count += 1
      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - client.count),
        retryAfterSeconds: 0,
      }
    },
  }
}

function clientKeyForRequest(request, trustedProxyAddresses) {
  const canonicalIp = (address) => String(address || '').replace(/^::ffff:/i, '')
  const remoteAddress = canonicalIp(request.socket.remoteAddress) || 'unknown'
  const trusted = new Set(trustedProxyAddresses.map(canonicalIp))
  if (!trusted.has(remoteAddress)) return remoteAddress
  const forwardedChain = String(request.headers['x-forwarded-for'] || '')
    .split(',')
    .map((address) => canonicalIp(address.trim()))
    .filter((address) => isIP(address))
  // Trusted proxies append the address they received the request from. Walk
  // from the right and ignore only explicitly trusted hops, so a client-added
  // leftmost spoof cannot create a fresh limiter key for every request.
  for (let index = forwardedChain.length - 1; index >= 0; index -= 1) {
    const address = forwardedChain[index]
    if (address && !trusted.has(address)) return address
  }
  return remoteAddress
}

function errorResponse(error, messages) {
  const code = error?.code
  if (code === 'CONFIGURATION') {
    return { status: 503, error: 'API_NOT_CONFIGURED', message: messages.configuration }
  }
  if (code === 'TIMEOUT') {
    return { status: 504, error: 'UPSTREAM_TIMEOUT', message: messages.upstream }
  }
  if (code === 'NO_DATA') {
    return { status: 404, error: 'UPSTREAM_NO_DATA', message: messages.noData ?? messages.upstream }
  }
  if (code === 'UPSTREAM') {
    return { status: 502, error: 'UPSTREAM_API_ERROR', message: messages.upstream }
  }
  return { status: 500, error: 'INTERNAL_SERVER_ERROR', message: messages.internal }
}

export function createApiServer({
  allowedOrigin = '',
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
  trustedProxyAddresses = [],
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  rateLimitWindowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests = DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  now = Date.now,
  providerStatus = getProviderStatus,
  providerFetchers = {},
} = {}) {
  const coordinator = createRequestCoordinator(cacheTtlMs, now)
  const rateLimiter = createRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMaxRequests,
    now,
  })
  const routes = new Map([
    [
      '/api/regional-industry/items',
      {
        label: 'regional-industry-api',
        loader: providerFetchers.regionalIndustry ?? fetchRegionalIndustryPayload,
        messages: {
          configuration: 'API 연결 설정이 없어 샘플 데이터로 대체합니다.',
          noData: '공개 API에 계약 항목이 없어 샘플 데이터로 대체합니다.',
          upstream: '공개 API를 불러오지 못해 샘플 데이터로 대체합니다.',
          internal: '지역산업 API 처리 중 오류가 발생해 샘플 데이터로 대체합니다.',
        },
      },
    ],
    [
      '/api/legislation/bills',
      {
        label: 'legislation-api',
        loader: providerFetchers.legislation ?? fetchAssemblyBillPayload,
        messages: {
          configuration: '국회 의안정보 API 연결 설정이 없어 샘플 데이터로 대체합니다.',
          noData: '국회 의안정보 API에 법안 항목이 없어 샘플 데이터로 대체합니다.',
          upstream: '국회 의안정보 API를 불러오지 못해 샘플 데이터로 대체합니다.',
          internal: '법안 API 처리 중 오류가 발생해 샘플 데이터로 대체합니다.',
        },
      },
    ],
    [
      '/api/dart/companies',
      {
        label: 'dart-api',
        loader: providerFetchers.dart ?? fetchDartCompanyPayload,
        messages: {
          configuration: 'DART API 설정이 없어 기존 샘플 기업 데이터를 표시합니다.',
          noData: 'DART 기업 응답이 없어 기존 샘플 기업 데이터를 표시합니다.',
          upstream: 'DART API를 불러오지 못해 기존 샘플 기업 데이터를 표시합니다.',
          internal: 'DART API 처리 중 오류가 발생해 기존 샘플 기업 데이터를 표시합니다.',
        },
      },
    ],
  ])

  async function handleRequest(request, response) {
    setCorsHeaders(request, response, allowedOrigin)

    if (!isValidHostHeader(request.headers.host, allowedHosts)) {
      sendJson(response, 400, {
        error: 'INVALID_HOST',
        message: '허용되지 않은 Host 헤더입니다.',
      })
      return
    }

    if (!String(request.url ?? '').startsWith('/')) {
      sendJson(response, 400, {
        error: 'INVALID_REQUEST_TARGET',
        message: '요청 경로 형식이 올바르지 않습니다.',
      })
      return
    }

    let requestUrl
    try {
      requestUrl = new URL(request.url ?? '/', 'http://localhost')
    } catch {
      sendJson(response, 400, {
        error: 'INVALID_REQUEST_URL',
        message: '요청 URL 형식이 올바르지 않습니다.',
      })
      return
    }

    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
      response.statusCode = 204
      response.end()
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      sendJson(response, 200, {
        status: 'ok',
        providers: providerStatus(),
      })
      return
    }

    const route = routes.get(requestUrl.pathname)
    if (route && request.method !== 'GET') {
      sendJson(
        response,
        405,
        { error: 'METHOD_NOT_ALLOWED', message: '이 API는 GET 요청만 지원합니다.' },
        { Allow: 'GET, OPTIONS' },
      )
      return
    }

    if (route) {
      const clientKey = clientKeyForRequest(request, trustedProxyAddresses)
      const rate = rateLimiter.consume(clientKey)
      const rateHeaders = {
        'X-RateLimit-Limit': String(rateLimitMaxRequests),
        'X-RateLimit-Remaining': String(rate.remaining),
      }

      if (!rate.allowed) {
        sendJson(
          response,
          429,
          {
            error: 'RATE_LIMITED',
            message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
          },
          { ...rateHeaders, 'Retry-After': String(rate.retryAfterSeconds) },
        )
        return
      }

      try {
        const { payload, cacheStatus } = await coordinator.load(requestUrl.pathname, route.loader)
        sendJson(
          response,
          200,
          { ...payload, dataOrigin: 'live' },
          { ...rateHeaders, 'X-Cache': cacheStatus },
        )
      } catch (error) {
        const mapped = errorResponse(error, route.messages)
        console.error(`[${route.label}]`, error?.code ?? 'UNKNOWN', error?.message ?? error)
        sendJson(
          response,
          mapped.status,
          { error: mapped.error, message: mapped.message },
          rateHeaders,
        )
      }
      return
    }

    sendJson(response, 404, { error: 'NOT_FOUND', message: '요청한 API 경로가 없습니다.' })
  }

  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error('[api-server]', error?.code ?? 'UNKNOWN', error?.message ?? error)
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: 'INTERNAL_SERVER_ERROR',
          message: 'API 요청 처리 중 오류가 발생했습니다.',
        })
      } else if (!response.writableEnded) {
        response.end()
      }
    })
  })

  server.on('clientError', (_error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    }
  })

  return server
}

export function startApiServer(env = process.env) {
  const config = resolveServerConfig(env)
  const server = createApiServer(config)

  server.on('error', (error) => {
    console.error('[api-server]', error?.code ?? 'LISTEN_ERROR', error?.message ?? error)
    process.exitCode = 1
  })

  server.listen(config.port, config.host, () => {
    console.log(`Public data API server listening on http://${config.host}:${config.port}`)
  })

  return server
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMainModule) {
  try {
    const server = startApiServer()
    const closeServer = () => server.close()
    process.once('SIGINT', closeServer)
    process.once('SIGTERM', closeServer)
  } catch (error) {
    console.error('[api-server]', error?.message ?? error)
    process.exitCode = 1
  }
}
