import axios from 'axios'

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

export const isApiEnabled = import.meta.env.VITE_API_ENABLED === 'true'

const regionalIndustryClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Accept: 'application/json',
  },
  timeout: 10000,
})

export async function fetchRegionalIndustrySnapshot() {
  try {
    const response = await regionalIndustryClient.get('/regional-industry/items')
    return response.data
  } catch (error) {
    const status = error.response?.status
    const message = error.response?.data?.message

    throw new Error(message ?? `API 요청에 실패했습니다.${status ? ` (${status})` : ''}`, {
      cause: error,
    })
  }
}
