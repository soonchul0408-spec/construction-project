import axios from 'axios'

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')
const legislationApiFlag = import.meta.env.VITE_LEGISLATION_API_ENABLED

export const isLegislationApiEnabled =
  legislationApiFlag === undefined
    ? import.meta.env.VITE_API_ENABLED === 'true'
    : legislationApiFlag === 'true'

const legislationClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Accept: 'application/json',
  },
  timeout: 10000,
})

export async function fetchLegislationSnapshot() {
  try {
    const response = await legislationClient.get('/legislation/bills')
    return response.data
  } catch (error) {
    const status = error.response?.status
    const message = error.response?.data?.message

    throw new Error(message ?? `법안 API 요청에 실패했습니다.${status ? ` (${status})` : ''}`, {
      cause: error,
    })
  }
}
