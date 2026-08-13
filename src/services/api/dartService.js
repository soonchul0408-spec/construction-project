import axios from 'axios'

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')
const dartApiFlag = import.meta.env.VITE_DART_API_ENABLED

// DART 키는 서버에만 두므로, 별도 클라이언트 키 없이 내부 프록시를 호출합니다.
// 설정을 생략하면 서버가 키 유무를 확인하고 샘플 데이터 대체 응답을 반환합니다.
export const isDartApiEnabled =
  dartApiFlag === undefined ? true : dartApiFlag === 'true'

const dartClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Accept: 'application/json',
  },
  timeout: 10000,
})

export async function fetchDartCompaniesSnapshot() {
  try {
    const response = await dartClient.get('/dart/companies')
    return response.data
  } catch (error) {
    const status = error.response?.status
    const message = error.response?.data?.message

    throw new Error(message ?? `DART API 요청에 실패했습니다.${status ? ` (${status})` : ''}`, {
      cause: error,
    })
  }
}

