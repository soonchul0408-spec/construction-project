<script setup>
import { ref } from 'vue'

const weatherList = ref([
  { city: '서울', temperature: 25, condition: '맑음' },
  { city: '수원', temperature: 23, condition: '흐림' },
  { city: '부산', temperature: 27, condition: '비' },
  { city: '제주', temperature: 26, condition: '바람' },
])
</script>

<template>
  <div class="weather">
    <h1>Weather App</h1>
    <div class="weather-list">
      <div v-for="weather in weatherList" :key="weather.city" class="weather-card">
        <h2>{{ weather.city }}</h2>
        <p>{{ weather.temperature }}°C</p>
        <p>{{ weather.condition }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.weather {
  text-align: center;
  margin-top: 40px;
}
button {
  margin-left: 8px;
}
.weather-list {
  display: flex;
  gap: 16px;
}
.weather-card {
  flex: 1;
  padding: 16px;
  border: 1px solid #ccc;
  border-radius: 8px;
  text-align: center;
}
</style>
