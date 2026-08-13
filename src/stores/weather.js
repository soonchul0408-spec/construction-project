import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { KOREAN_CITIES } from '@/data/koreanCities'

const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast'

const WEATHER_DESCRIPTIONS = {
  0: '맑음',
  1: '대체로 맑음',
  2: '부분적으로 흐림',
  3: '흐림',
  45: '안개',
  48: '짙은 안개',
  51: '이슬비',
  53: '이슬비',
  55: '강한 이슬비',
  56: '어는 이슬비',
  57: '강한 어는 이슬비',
  61: '약한 비',
  63: '비',
  65: '강한 비',
  66: '어는 비',
  67: '강한 어는 비',
  71: '약한 눈',
  73: '눈',
  75: '강한 눈',
  77: '싸락눈',
  80: '약한 소나기',
  81: '소나기',
  82: '강한 소나기',
  85: '약한 눈보라',
  86: '강한 눈보라',
  95: '천둥번개',
  96: '우박을 동반한 천둥번개',
  99: '강한 우박을 동반한 천둥번개',
}

function readSavedUnit() {
  if (typeof window === 'undefined') return 'C'

  return window.localStorage.getItem('weather-unit') === 'F' ? 'F' : 'C'
}

export const useWeatherStore = defineStore('weather', () => {
  const unit = ref(readSavedUnit())
  const weatherList = ref([])
  const loading = ref(false)
  const error = ref('')
  const lastUpdated = ref('')
  const unitLabel = computed(() => `°${unit.value}`)

  function setUnit(nextUnit) {
    unit.value = nextUnit
    window.localStorage.setItem('weather-unit', nextUnit)
  }

  function formatTemperature(celsius) {
    if (celsius === null || celsius === undefined) return '--'

    const temperature = unit.value === 'F' ? (celsius * 9) / 5 + 32 : celsius
    return `${Math.round(temperature)}${unitLabel.value}`
  }

  function getWeatherDescription(code) {
    return WEATHER_DESCRIPTIONS[code] ?? '날씨 정보 없음'
  }

  function createWeatherRecord(city, result) {
    const current = result.current

    return {
      ...city,
      time: current.time,
      temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      weatherCode: current.weather_code,
      condition: getWeatherDescription(current.weather_code),
    }
  }

  async function fetchWeather() {
    loading.value = true
    error.value = ''

    const params = new URLSearchParams({
      latitude: KOREAN_CITIES.map((city) => city.latitude).join(','),
      longitude: KOREAN_CITIES.map((city) => city.longitude).join(','),
      current:
        'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      timezone: 'Asia/Seoul',
      forecast_days: '1',
    })

    try {
      const response = await fetch(`${WEATHER_API_URL}?${params}`)
      if (!response.ok) {
        throw new Error(`날씨 API 요청 실패 (${response.status})`)
      }

      const payload = await response.json()
      const results = Array.isArray(payload) ? payload : [payload]

      weatherList.value = results.map((result, index) =>
        createWeatherRecord(KOREAN_CITIES[index], result),
      )

      lastUpdated.value = weatherList.value[0]?.time ?? ''
    } catch (requestError) {
      error.value =
        requestError instanceof TypeError
          ? '인터넷 연결을 확인해 주세요.'
          : requestError.message
    } finally {
      loading.value = false
    }
  }

  async function fetchCityWeather(cityId) {
    const city = KOREAN_CITIES.find((item) => item.id === cityId)
    if (!city) return

    loading.value = true
    error.value = ''

    const params = new URLSearchParams({
      latitude: String(city.latitude),
      longitude: String(city.longitude),
      current:
        'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      timezone: 'Asia/Seoul',
      forecast_days: '1',
    })

    try {
      const response = await fetch(`${WEATHER_API_URL}?${params}`)
      if (!response.ok) {
        throw new Error(`상세 날씨 API 요청 실패 (${response.status})`)
      }

      const result = createWeatherRecord(city, await response.json())
      const index = weatherList.value.findIndex((weather) => weather.id === cityId)

      if (index === -1) {
        weatherList.value.push(result)
      } else {
        weatherList.value[index] = result
      }

      lastUpdated.value = result.time
    } catch (requestError) {
      error.value =
        requestError instanceof TypeError
          ? '인터넷 연결을 확인해 주세요.'
          : requestError.message
    } finally {
      loading.value = false
    }
  }

  return {
    unit,
    unitLabel,
    weatherList,
    loading,
    error,
    lastUpdated,
    setUnit,
    formatTemperature,
    fetchWeather,
    fetchCityWeather,
  }
})
