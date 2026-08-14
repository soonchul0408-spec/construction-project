import assert from 'node:assert/strict'
import { once } from 'node:events'
import net from 'node:net'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { createApiServer, resolveServerConfig } from '../server/index.js'
import { sanitizeAssemblyPayload, validateAssemblyPayload } from '../server/providers/assemblyBillProvider.js'
import { sanitizeDartCompanyProfile } from '../server/providers/dartProvider.js'
import { normalizePublicHttpUrl, parseOfficialApiUrl } from '../server/providers/providerUtils.js'
import { sanitizeRegionalIndustryPayload } from '../server/providers/regionalIndustryProvider.js'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const results = []

async function test(name, callback) {
  try {
    await callback()
    results.push({ name, passed: true })
  } catch (error) {
    results.push({ name, passed: false, error })
  }
}

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function close(server) {
  if (!server.listening) return
  server.close()
  await once(server, 'close')
}

async function rawHttpRequest(port, request) {
  return await new Promise((resolveResponse, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let response = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.end(request))
    socket.on('data', (chunk) => {
      response += chunk
    })
    socket.on('end', () => resolveResponse(response))
    socket.on('error', reject)
  })
}

await test('서버 기본 바인딩은 127.0.0.1이고 정책 값은 경계 검증된다', () => {
  const config = resolveServerConfig({})
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.port, 8787)
  const ipv6Config = resolveServerConfig({ API_SERVER_HOST: '::1' })
  assert.equal(ipv6Config.host, '::1')
  assert.ok(ipv6Config.allowedHosts.includes('[::1]'))
  assert.throws(() => resolveServerConfig({ API_SERVER_PORT: '70000' }), /API_SERVER_PORT/)
  assert.throws(() => resolveServerConfig({ CORS_ORIGIN: 'javascript:alert(1)' }), /CORS_ORIGIN/)
})

await test('원천 API URL은 HTTPS 공식 호스트만 허용한다', () => {
  const options = { label: '테스트 API URL', allowedDomains: ['lofin365.go.kr'] }
  assert.equal(
    parseOfficialApiUrl('https://openapi.lofin365.go.kr/contracts', options).hostname,
    'openapi.lofin365.go.kr',
  )
  assert.throws(
    () => parseOfficialApiUrl('http://openapi.lofin365.go.kr/contracts', options),
    /HTTPS/,
  )
  assert.throws(
    () => parseOfficialApiUrl('https://lofin365.go.kr.attacker.example/contracts', options),
    /공식 제공기관/,
  )
  assert.equal(normalizePublicHttpUrl('javascript:alert(1)'), '')
})

await test('지방재정 오류 envelope를 거부하고 허용 필드만 남긴다', () => {
  assert.throws(
    () =>
      sanitizeRegionalIndustryPayload({
        response: { body: { items: { resultCode: '99', resultMsg: 'INVALID KEY' } } },
      }),
    (error) => error?.code === 'UPSTREAM',
  )

  const sanitized = sanitizeRegionalIndustryPayload({
    response: {
      body: {
        items: {
          item: {
            contractName: '테스트 공사',
            contractDate: '20260814',
            companyName: '테스트건설',
            businessRegistrationNumber: '000-00-00000',
            nested: { secret: true },
          },
        },
      },
    },
  })
  assert.deepEqual(sanitized, {
    items: [
      {
        contractName: '테스트 공사',
        contractDate: '20260814',
        companyName: '테스트건설',
      },
    ],
  })
})

await test('국회 API 의미 오류를 거부한다', () => {
  assert.doesNotThrow(() =>
    validateAssemblyPayload({ head: [{ RESULT: { CODE: 'INFO-000', MESSAGE: '정상' } }] }),
  )
  assert.throws(
    () =>
      validateAssemblyPayload({ head: [{ RESULT: { CODE: 'ERROR-300', MESSAGE: '키 오류' } }] }),
    (error) => error?.code === 'UPSTREAM',
  )
  const sanitized = sanitizeAssemblyPayload({
    response: { body: { items: [{ BILL_ID: '1', BILL_NAME: '건설 법안', residentRegistrationNumber: 'secret' }] } },
    apiEcho: 'secret',
    debug: { description: '주민번호 900101-1234567', MESSAGE: 'echo: SECRET-KEY' },
  })
  assert.equal(sanitized.items[0].BILL_NAME, '건설 법안')
  assert.equal('residentRegistrationNumber' in sanitized.items[0], false)
  assert.equal('apiEcho' in sanitized, false)
  assert.equal('debug' in sanitized, false)
})

await test('DART 응답은 사용 필드와 안전한 URL만 남긴다', () => {
  const profile = sanitizeDartCompanyProfile({
    corp_code: '00126186',
    corp_name: '테스트 기업',
    bizr_no: '0000000000',
    jurir_no: '0000000000000',
    hm_url: 'javascript:alert(1)',
    ir_url: 'https://example.com/ir',
  })
  assert.equal(profile.hm_url, '')
  assert.equal(profile.ir_url, 'https://example.com/ir')
  assert.equal('bizr_no' in profile, false)
  assert.equal('jurir_no' in profile, false)
})

await test('클라이언트 정규화가 오류 envelope와 비-http(s) 링크를 차단한다', async () => {
  const vite = await createViteServer({
    root: projectRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  })

  try {
    const { normalizeRegionalIndustrySnapshot } = await vite.ssrLoadModule(
      '/src/services/api/normalizers.js',
    )

    assert.throws(
      () =>
        normalizeRegionalIndustrySnapshot({
          raw: {
            response: { body: { items: { resultCode: '99', resultMsg: 'INVALID KEY' } } },
          },
        }),
      /오류 응답/,
    )

    const snapshot = normalizeRegionalIndustrySnapshot({
      provider: '테스트 제공기관',
      sourceUrl: 'javascript:alert(1)',
      retrievedAt: '2026-08-14T00:00:00.000Z',
      raw: {
        items: [
          {
            contractName: '테스트 공사',
            contractDate: '20260814',
            companyName: '테스트건설',
            sourceUrl: 'data:text/html,unsafe',
          },
        ],
      },
    })

    assert.equal(snapshot.items.length, 1)
    assert.equal(snapshot.items[0].sourceUrl, 'https://www.data.go.kr/data/15118650/openapi.do')
    assert.equal(snapshot.companies[0].officialUrl, snapshot.items[0].sourceUrl)
    assert.match(snapshot.items[0].source.url, /^https?:\/\//)
  } finally {
    await vite.close()
  }
})

await test('잘못된 Host는 400이며 서버는 계속 응답한다', async () => {
  const server = createApiServer({ providerStatus: () => ({}) })
  const port = await listen(server)

  try {
    const rawResponse = await rawHttpRequest(
      port,
      'GET /api/health HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n',
    )
    assert.match(rawResponse, /^HTTP\/1\.1 400/)

    const rebindingResponse = await rawHttpRequest(
      port,
      'GET /api/health HTTP/1.1\r\nHost: attacker.example\r\nConnection: close\r\n\r\n',
    )
    assert.match(rebindingResponse, /^HTTP\/1\.1 400/)

    const health = await fetch(`http://127.0.0.1:${port}/api/health`)
    assert.equal(health.status, 200)
  } finally {
    await close(server)
  }
})

await test('성공 응답 캐시와 동일 요청 병합이 원천 호출을 줄인다', async () => {
  let calls = 0
  const server = createApiServer({
    cacheTtlMs: 60_000,
    rateLimitMaxRequests: 20,
    providerFetchers: {
      regionalIndustry: async () => {
        calls += 1
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
        return { provider: 'test', retrievedAt: '2026-08-14T00:00:00.000Z', raw: { items: [] } }
      },
    },
  })
  const port = await listen(server)

  try {
    const url = `http://127.0.0.1:${port}/api/regional-industry/items`
    const parallel = await Promise.all([fetch(url), fetch(url)])
    assert.deepEqual(
      parallel.map((response) => response.status),
      [200, 200],
    )
    assert.equal(calls, 1)
    assert.deepEqual(
      new Set(parallel.map((response) => response.headers.get('x-cache'))),
      new Set(['MISS', 'COALESCED']),
    )

    const cached = await fetch(url)
    assert.equal(cached.headers.get('x-cache'), 'HIT')
    assert.equal(calls, 1)
  } finally {
    await close(server)
  }
})

await test('IP 요청 제한은 초과 요청에 429와 Retry-After를 반환한다', async () => {
  let calls = 0
  const server = createApiServer({
    cacheTtlMs: 60_000,
    rateLimitMaxRequests: 2,
    providerFetchers: {
      regionalIndustry: async () => {
        calls += 1
        return { provider: 'test', raw: { items: [] } }
      },
    },
  })
  const port = await listen(server)

  try {
    const url = `http://127.0.0.1:${port}/api/regional-industry/items`
    assert.equal((await fetch(url)).status, 200)
    assert.equal((await fetch(url)).status, 200)
    const limited = await fetch(url)
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '60')
    assert.equal(calls, 1)
  } finally {
    await close(server)
  }
})

await test('명시적으로 신뢰한 프록시만 X-Forwarded-For를 요청 제한 키로 사용한다', async () => {
  const server = createApiServer({
    rateLimitMaxRequests: 1,
    trustedProxyAddresses: ['127.0.0.1'],
    providerFetchers: { regionalIndustry: async () => ({ provider: 'test', raw: { items: [] } }) },
  })
  const port = await listen(server)
  const url = `http://127.0.0.1:${port}/api/regional-industry/items`
  try {
    assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.10' } })).status, 200)
    assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.11' } })).status, 200)
    assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.10' } })).status, 429)
    assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': 'spoof-one, 203.0.113.12' } })).status, 200)
    assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': 'spoof-two, 203.0.113.12' } })).status, 429)
  } finally {
    await close(server)
  }
})

const failures = results.filter((result) => !result.passed)
results.forEach((result) => {
  if (result.passed) {
    console.log(`PASS ${result.name}`)
  } else {
    console.error(`FAIL ${result.name}`)
    console.error(result.error)
  }
})

if (failures.length) {
  process.exitCode = 1
} else {
  console.log(`\n서버 경계 검증 ${results.length}개 통과`)
}
