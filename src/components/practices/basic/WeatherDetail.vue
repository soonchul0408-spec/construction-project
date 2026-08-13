<script setup>
import { computed, onMounted, watch } from 'vue'
import { useWeatherStore } from '@/stores/weather'

const props = defineProps({
  cityId: {
    type: String,
    required: true,
  },
})

const weatherStore = useWeatherStore()
const weather = computed(() =>
  weatherStore.weatherList.find((item) => item.id === props.cityId),
)

function refreshDetail() {
  return weatherStore.fetchCityWeather(props.cityId)
}

onMounted(refreshDetail)
watch(() => props.cityId, refreshDetail)
</script>

<template>
  <section v-if="weather" class="detail-card">
    <div class="detail-heading">
      <div>
        <p class="eyebrow">상세 날씨</p>
        <h2>{{ weather.name }}</h2>
      </div>
      <strong>{{ weatherStore.formatTemperature(weather.temperature) }}</strong>
    </div>

    <p class="condition">{{ weather.condition }}</p>

    <div class="detail-grid">
      <div>
        <span>체감 온도</span>
        <strong>{{ weatherStore.formatTemperature(weather.apparentTemperature) }}</strong>
      </div>
      <div>
        <span>습도</span>
        <strong>{{ weather.humidity }}%</strong>
      </div>
      <div>
        <span>바람</span>
        <strong>{{ Math.round(weather.windSpeed) }} km/h</strong>
      </div>
      <div>
        <span>측정 시각</span>
        <strong>{{ weather.time.replace('T', ' ') }}</strong>
      </div>
    </div>
  </section>
  <section v-else class="detail-card loading-detail">상세 날씨를 불러오는 중입니다...</section>
</template>

<style scoped>
.detail-card {
  padding: 24px;
  border-radius: 20px;
  color: #f8fafc;
  background: linear-gradient(135deg, #1d4ed8, #0f172a);
  box-shadow: 0 18px 40px rgb(15 23 42 / 18%);
}

.loading-detail {
  text-align: center;
}

.detail-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.detail-heading h2 {
  margin: 4px 0 0;
  font-size: 2rem;
}

.detail-heading strong {
  font-size: 2.2rem;
}

.eyebrow {
  margin: 0;
  color: #bfdbfe;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.condition {
  margin: 8px 0 24px;
  color: #dbeafe;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.detail-grid div {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 12px;
  background: rgb(255 255 255 / 8%);
}

.detail-grid span {
  color: #bfdbfe;
  font-size: 0.8rem;
}

.detail-grid strong {
  font-size: 0.95rem;
}

@media (max-width: 640px) {
  .detail-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
