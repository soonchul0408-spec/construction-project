<script setup>
import { ref } from 'vue'
let normalCount = 0
const vueCount = ref(0)
</script>

<template>
  <div class="practice-section">
    <h2>Hello Skala_Vue</h2>
    <h3>일반 변수 클릭: {{ normalCount }}</h3>
    <button @click="normalCount++">일반 변수 증가</button>"
    <br />
    <h3>Vue 반응성 변수 클릭: {{ vueCount }}</h3>
    <button @click="vueCount++">Vue 변수 증가</button>"
  </div>
</template>
