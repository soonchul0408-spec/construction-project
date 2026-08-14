const DEFAULT_SUCCESS_CODES = new Set([
  '0',
  '00',
  '000',
  '0000',
  'INFO-000',
  'NORMAL_SERVICE',
  'NORMAL SERVICE',
  'NORMAL SERVICE.',
])

export function createProviderError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function createRequestDeadline(timeoutMs) {
  return AbortSignal.timeout(timeoutMs)
}

export function isRequestTimeoutError(error) {
  return ['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error?.code)
    || ['AbortError', 'CanceledError'].includes(error?.name)
}

function hostnameMatches(hostname, allowedDomain) {
  return hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`)
}

export function parseOfficialApiUrl(value, { label, allowedDomains }) {
  let url
  try {
    url = new URL(String(value ?? '').trim())
  } catch {
    throw createProviderError('CONFIGURATION', `${label} 형식이 올바르지 않습니다.`)
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !allowedDomains.some((domain) => hostnameMatches(url.hostname, domain))
  ) {
    throw createProviderError(
      'CONFIGURATION',
      `${label}은 HTTPS 기반 공식 제공기관 주소만 사용할 수 있습니다.`,
    )
  }

  url.hash = ''
  return url
}

export function parseBoundedInteger(value, fallback, { label, min = 1, max }) {
  const normalized =
    value === undefined || value === null || value === '' ? fallback : Number(value)

  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw createProviderError('CONFIGURATION', `${label}은 ${min}~${max} 범위의 정수여야 합니다.`)
  }

  return normalized
}

export function validateQueryParameterName(value, fallback, label) {
  const parameterName = String(value || fallback).trim()
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(parameterName)) {
    throw createProviderError('CONFIGURATION', `${label} 형식이 올바르지 않습니다.`)
  }
  return parameterName
}

export function normalizePublicHttpUrl(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''

  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function getFirstScalar(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return ''
  for (const key of keys) {
    const value = object[key]
    if (value !== undefined && value !== null && typeof value !== 'object') {
      const text = String(value).trim()
      if (text) return text
    }
  }
  return ''
}

export function assertSuccessfulEnvelope(
  envelopes,
  {
    provider,
    codeKeys = ['resultCode', 'result_code', 'RESULT_CODE', 'returnReasonCode', 'CODE'],
    messageKeys = [
      'resultMsg',
      'resultMessage',
      'result_msg',
      'RESULT_MSG',
      'returnAuthMsg',
      'errMsg',
      'MESSAGE',
    ],
    successCodes = DEFAULT_SUCCESS_CODES,
  },
) {
  for (const envelope of envelopes) {
    const code = getFirstScalar(envelope, codeKeys)
    if (!code) continue

    const normalizedCode = code.toUpperCase()
    if (successCodes.has(normalizedCode)) continue

    const message = getFirstScalar(envelope, messageKeys)
    throw createProviderError(
      'UPSTREAM',
      `${provider}가 오류 응답을 반환했습니다. (${code}${message ? `: ${message}` : ''})`,
    )
  }
}
