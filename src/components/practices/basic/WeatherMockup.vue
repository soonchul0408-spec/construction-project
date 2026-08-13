<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useWeatherStore } from '@/stores/weather'
import WeatherDetail from './WeatherDetail.vue'

const weatherStore = useWeatherStore()
const selectedCityId = ref('seoul')
let refreshTimer

function selectCity(cityId) {
  selectedCityId.value = cityId
}

onMounted(async () => {
  await weatherStore.fetchWeather()
  refreshTimer = window.setInterval(weatherStore.fetchWeather, 10 * 60 * 1000)
})

onUnmounted(() => {
  window.clearInterval(refreshTimer)
})
</script>

<template>
  <div class="weather">
    <header class="weather-header">
      <div>
        <p class="eyebrow">LIVE WEATHER</p>
        <h1>대한민국 실시간 날씨</h1>
        <p class="subtitle">전국 주요 도시의 현재 날씨를 확인해 보세요.</p>
      </div>

      <div class="controls">
        <div class="unit-switch" aria-label="온도 단위 선택">
          <button :class="{ active: weatherStore.unit === 'C' }" @click="weatherStore.setUnit('C')">
            °C
          </button>
          <button :class="{ active: weatherStore.unit === 'F' }" @click="weatherStore.setUnit('F')">
            °F
          </button>
        </div>
        <button class="refresh-button" :disabled="weatherStore.loading" @click="weatherStore.fetchWeather">
          {{ weatherStore.loading ? '불러오는 중...' : '새로고침' }}
        </button>
      </div>
    </header>

    <p v-if="weatherStore.loading && !weatherStore.weatherList.length" class="message">
      실시간 날씨를 불러오는 중입니다...
    </p>
    <p v-else-if="weatherStore.error" class="message error">
      {{ weatherStore.error }}
      <button class="retry-button" @click="weatherStore.fetchWeather">다시 시도</button>
    </p>

    <template v-else>
      <div class="weather-list">
        <button
          v-for="weather in weatherStore.weatherList"
          :key="weather.id"
          class="weather-card"
          :class="{ selected: weather.id === selectedCityId }"
          @click="selectCity(weather.id)"
        >
          <span class="city-name">{{ weather.name }}</span>
          <strong>{{ weatherStore.formatTemperature(weather.temperature) }}</strong>
          <span>{{ weather.condition }}</span>
          <span class="humidity">습도 {{ weather.humidity }}%</span>
          <span class="detail-link">상세보기 →</span>
        </button>
      </div>

      <WeatherDetail :city-id="selectedCityId" />
    </template>

    <footer>
      <span v-if="weatherStore.lastUpdated">
        마지막 업데이트: {{ weatherStore.lastUpdated.replace('T', ' ') }}
      </span>
      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a>
    </footer>
  </div>
</template>

<style scoped>
.weather {
  max-width: 1180px;
  margin: 0 auto;
  padding: 48px 24px;
  color: #0f172a;
}

.weather-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 32px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #2563eb;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.14em;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3.4rem);
  letter-spacing: -0.06em;
}

.subtitle {
  margin: 10px 0 0;
  color: #64748b;
}

.controls,
.unit-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unit-switch {
  padding: 4px;
  border-radius: 10px;
  background: #e2e8f0;
}

button {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.unit-switch button,
.refresh-button,
.retry-button {
  padding: 9px 13px;
  border-radius: 8px;
  color: #475569;
  background: transparent;
  font-weight: 700;
}

.unit-switch button.active,
.refresh-button {
  color: #fff;
  background: #2563eb;
}

.refresh-button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.message {
  padding: 24px;
  border-radius: 14px;
  color: #475569;
  background: #f8fafc;
  text-align: center;
}

.message.error {
  color: #b91c1c;
  background: #fef2f2;
}

.retry-button {
  margin-left: 8px;
  color: #b91c1c;
  background: #fee2e2;
}

.weather-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 14px;
  margin-bottom: 28px;
}

.weather-card {
  display: grid;
  gap: 8px;
  min-height: 150px;
  padding: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  text-align: center;
  background: #fff;
  box-shadow: 0 8px 24px rgb(15 23 42 / 6%);
  transition: 0.2s ease;
}

.weather-card:hover,
.weather-card.selected {
  border-color: #2563eb;
  box-shadow: 0 12px 28px rgb(37 99 235 / 14%);
  transform: translateY(-2px);
}

.weather-card strong {
  color: #0f172a;
  font-size: 2rem;
}

.weather-card span {
  color: #475569;
}

.weather-card .city-name {
  color: #0f172a;
  font-size: 1.05rem;
  font-weight: 800;
}

.weather-card .humidity {
  color: #94a3b8;
  font-size: 0.82rem;
}

footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  color: #94a3b8;
  font-size: 0.8rem;
}

footer a {
  color: inherit;
}

@media (max-width: 700px) {
  .weather-header {
    display: grid;
    align-items: start;
  }

  .controls {
    justify-content: space-between;
  }

  footer {
    display: grid;
  }
}
</style>
