<script setup lang="ts">
import { ref } from 'vue'

import Building3DViewer from './Building3DViewer.vue'
import type { BuildingGeometry, Opening } from '../types/domain'

defineEmits<{ close: [] }>()

type DemoStep = 1 | 2 | 3 | 4 | 5
const step = ref<DemoStep>(1)
const opinion = ref<'yes' | 'simple' | ''>('')
const uploaded = ref(false)
const checkStates = ref<Record<string, 'confirmed' | 'needs-change' | ''>>({ height: '', window: '' })
const orderAction = ref('')
const demoOpening = (id: string, type: Opening['type'], offsetMm: number, widthMm: number, heightMm: number, sillHeightMm: number | null): Opening => ({
  id,
  type,
  label: id,
  widthMm,
  heightMm,
  sillHeightMm,
  offsetMm,
  areaM2: (widthMm * heightMm) / 1_000_000,
  confidence: 'high',
  evidence: [],
  excludedFromAutomaticTakeoff: false,
})

const demoBuildingModel: BuildingGeometry = {
  walls: [
    { wallId: 'demo-front', zone: '시연 건물', zoneName: '시연 건물', number: '외벽 1', wallNumber: 'DEMO-W1', start: { x: 0, y: 0, z: 0 }, end: { x: 8, y: 0, z: 0 }, lengthMm: 8000, heightMm: 2800, thicknessMm: 150, openings: [demoOpening('정면 창호 1', 'window', 900, 1200, 1100, 900), demoOpening('정면 출입문', 'door', 3350, 1200, 2200, 0), demoOpening('정면 창호 2', 'window', 5900, 1200, 1100, 900)], color: '#e4e4e4', confidence: 'high', sourceReferences: [], geometrySource: 'dimension-layout' },
    { wallId: 'demo-right', zone: '시연 건물', zoneName: '시연 건물', number: '외벽 2', wallNumber: 'DEMO-W2', start: { x: 8, y: 0, z: 0 }, end: { x: 8, y: 0, z: 6 }, lengthMm: 6000, heightMm: 2800, thicknessMm: 150, openings: [demoOpening('측면 창호 1', 'window', 1000, 1200, 1100, 900), demoOpening('측면 창호 2', 'window', 3500, 1200, 1100, 900)], color: '#d7d7d7', confidence: 'high', sourceReferences: [], geometrySource: 'dimension-layout' },
    { wallId: 'demo-back', zone: '시연 건물', zoneName: '시연 건물', number: '외벽 3', wallNumber: 'DEMO-W3', start: { x: 8, y: 0, z: 6 }, end: { x: 0, y: 0, z: 6 }, lengthMm: 8000, heightMm: 2800, thicknessMm: 150, openings: [], color: '#e4e4e4', confidence: 'high', sourceReferences: [], geometrySource: 'dimension-layout' },
    { wallId: 'demo-left', zone: '시연 건물', zoneName: '시연 건물', number: '외벽 4', wallNumber: 'DEMO-W4', start: { x: 0, y: 0, z: 6 }, end: { x: 0, y: 0, z: 0 }, lengthMm: 6000, heightMm: 2800, thicknessMm: 150, openings: [], color: '#d7d7d7', confidence: 'high', sourceReferences: [], geometrySource: 'dimension-layout' },
  ],
  footprint: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 6 }, { x: 0, z: 6 }],
  roof: { isReady: true, kind: 'flat', heightMm: 2800, pitchDeg: 0, evidence: [], blockedReason: '' },
  isReady: true,
  blockedReason: '',
}

const labels = ['도면 올리기', '도면 확인', '발주 물량', '절단 계획', '3D 보기']

function go(next: DemoStep) {
  if (next > unlockedStep()) return
  step.value = next
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function unlockedStep(): DemoStep {
  if (!uploaded.value) return 1
  if (!checksComplete()) return 2
  if (!orderAction.value) return 3
  if (step.value >= 4) return 5
  return 4
}

function checksComplete() {
  return Object.values(checkStates.value).every(Boolean)
}

function uploadDemoFiles() {
  uploaded.value = true
}

function setCheck(id: 'height' | 'window', state: 'confirmed' | 'needs-change') {
  checkStates.value = { ...checkStates.value, [id]: state }
}

function finishOrder(action: string) {
  orderAction.value = action
}

function restartDemo() {
  step.value = 1
  uploaded.value = false
  checkStates.value = { height: '', window: '' }
  orderAction.value = ''
  opinion.value = ''
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function choose(value: 'yes' | 'simple') {
  opinion.value = value
  window.localStorage.setItem('drawing-material-demo-opinion', value === 'yes' ? 'interested' : 'simpler')
}

</script>

<template>
  <main class="demo-page">
    <header class="demo-page__topbar">
      <div class="demo-page__topbar-inner">
        <div class="demo-page__brand"><span class="demo-page__brand-mark">▦</span><span><b>설계 자재 계산기</b><small>아버님께 보여드리는 시연</small></span></div>
        <button type="button" class="demo-page__exit" @click="$emit('close')">실제 화면으로 돌아가기</button>
      </div>
    </header>

    <div class="demo-page__wrap">
      <section class="demo-page__intro">
        <span>시연용 화면 · 실제 파일과 연결되지 않습니다</span>
        <h1>도면을 올리면<br><em>발주 준비가 이렇게 진행됩니다.</em></h1>
        <p>복잡한 설정이나 오류 메시지 없이, 아버님이 보게 될 핵심 화면만 순서대로 보여드립니다.</p>
      </section>

      <nav class="demo-page__steps" aria-label="시연 순서">
        <button v-for="(label, index) in labels" :key="label" type="button" :disabled="index + 1 > unlockedStep()" :class="{ active: step === index + 1, done: step > index + 1 }" @click="go((index + 1) as DemoStep)"><i>{{ index + 1 }}</i><span>{{ label }}</span></button>
      </nav>

      <section v-if="step === 1" class="demo-screen">
        <span class="demo-screen__eyebrow">첫째 단계</span>
        <h2>도면은 한 번에 올립니다.</h2>
        <p class="demo-screen__lead">평면도, 입면도, 창호표처럼 가지고 있는 PDF를 함께 넣습니다.</p>
        <div class="demo-upload-box" :class="{ complete: uploaded }"><div class="demo-upload-box__icon">{{ uploaded ? '✓' : '↑' }}</div><strong>{{ uploaded ? '도면 3장을 올렸습니다.' : '설계도 파일을 여기에 놓으세요' }}</strong><span>{{ uploaded ? '도면 종류를 자동으로 구분했습니다.' : '또는 파일 선택을 누르세요' }}</span><button v-if="!uploaded" type="button" @click="uploadDemoFiles">시연 도면 3장 올리기</button><button v-else type="button" @click="go(2)">도면 확인하기</button></div>
        <div v-if="uploaded" class="demo-file-list"><article><b>✓</b><span><strong>평면도.pdf</strong><small>건물의 가로·세로 길이를 찾았습니다</small></span><em>분석 완료</em></article><article><b>✓</b><span><strong>정면도.pdf</strong><small>벽체 높이를 찾았습니다</small></span><em>분석 완료</em></article><article><b>✓</b><span><strong>창호표.pdf</strong><small>문과 창 면적을 찾았습니다</small></span><em>분석 완료</em></article></div>
        <div class="demo-screen__footnote">실제 서비스에서는 파일을 올린 뒤 자동으로 도면 종류를 구분합니다.</div>
      </section>

      <section v-else-if="step === 2" class="demo-screen">
        <span class="demo-screen__eyebrow">둘째 단계</span>
        <h2>확인이 필요한 값만 크게 보여줍니다.</h2>
        <p class="demo-screen__lead">AI가 읽은 결과 중 발주에 중요한 두 가지만 확인하는 모습입니다.</p>
        <div class="demo-check-layout"><div class="demo-drawing"><span>평면도</span><div class="demo-drawing__house"><i /><i /><i /><i /><b>8,000</b><em>6,000</em></div><small>도면에서 벽 길이를 읽은 위치</small></div><div class="demo-check-card"><span>확인할 것 2개</span><article :class="checkStates.height"><small>외벽 높이</small><strong>2,800 mm</strong><div class="demo-check-actions"><button type="button" :class="{ selected: checkStates.height === 'confirmed' }" @click="setCheck('height', 'confirmed')">{{ checkStates.height === 'confirmed' ? '✓ 확인됨' : '맞습니다' }}</button><button type="button" :class="{ selected: checkStates.height === 'needs-change' }" @click="setCheck('height', 'needs-change')">다릅니다</button></div><em v-if="checkStates.height === 'needs-change'">수정 요청됨 · 실제 화면에서는 올바른 값을 입력합니다.</em></article><article :class="checkStates.window"><small>창호 차감</small><strong>창문 4개</strong><div class="demo-check-actions"><button type="button" :class="{ selected: checkStates.window === 'confirmed' }" @click="setCheck('window', 'confirmed')">{{ checkStates.window === 'confirmed' ? '✓ 확인됨' : '맞습니다' }}</button><button type="button" :class="{ selected: checkStates.window === 'needs-change' }" @click="setCheck('window', 'needs-change')">다릅니다</button></div><em v-if="checkStates.window === 'needs-change'">수정 요청됨 · 실제 화면에서는 올바른 값을 입력합니다.</em></article><p>{{ checksComplete() ? '두 항목을 처리했습니다. 발주 물량을 볼 수 있습니다.' : '값이 맞으면 “맞습니다”, 다르면 “다릅니다”를 누르세요.' }}</p></div></div>
        <div class="demo-next" :class="{ ready: checksComplete() }"><span>{{ checksComplete() ? '도면 확인이 끝났습니다.' : `처리 ${Object.values(checkStates).filter(Boolean).length} / 2개` }}</span><button type="button" :disabled="!checksComplete()" @click="go(3)">발주 물량 보기</button></div>
      </section>

      <section v-else-if="step === 3" class="demo-screen">
        <span class="demo-screen__eyebrow">셋째 단계</span>
        <h2>필요한 자재와 수량을 바로 봅니다.</h2>
        <p class="demo-screen__lead">발주할 때 필요한 항목을 큰 글씨로 한 장에 정리합니다.</p>
        <div class="demo-order-summary"><div><small>벽체 면적</small><strong>72.8㎡</strong></div><div><small>판넬</small><strong>32장</strong></div><div><small>고정 피스</small><strong>256개</strong></div><div><small>실란트</small><strong>8본</strong></div></div>
        <div class="demo-order-table"><div><b>발주 항목</b><b>규격</b><b>수량</b></div><div><span>외벽 판넬</span><span>75T · 1,000 × 6,000mm</span><strong>32장</strong></div><div><span>고정 피스</span><span>판넬용</span><strong>256개</strong></div><div><span>실란트</span><span>외벽용</span><strong>8본</strong></div></div>
        <div class="demo-order-actions"><button type="button" :class="{ selected: orderAction === '인쇄용 발주표를 준비했습니다.' }" @click="finishOrder('인쇄용 발주표를 준비했습니다.')">발주표 인쇄</button><button type="button" :class="{ selected: orderAction === '표 파일을 준비했습니다.' }" @click="finishOrder('표 파일을 준비했습니다.')">표 파일 저장</button></div>
        <div class="demo-next" :class="{ ready: orderAction }"><span>{{ orderAction || '인쇄 또는 파일 저장을 눌러 발주표를 준비하세요.' }}</span><button type="button" :disabled="!orderAction" @click="go(4)">절단 계획도 보기</button></div>
      </section>

      <section v-else-if="step === 4" class="demo-screen">
        <span class="demo-screen__eyebrow">넷째 단계</span>
        <h2>자재를 어떻게 자를지도 확인합니다.</h2>
        <p class="demo-screen__lead">6m 판넬을 어떤 길이로 자르면 자투리가 적은지 보여주는 예시입니다.</p>
        <div class="demo-cut-stats"><div><small>권장 발주</small><strong>6m 판넬 32장</strong></div><div><small>예상 필요</small><strong>30장</strong></div><div><small>발주 여유</small><strong>2장</strong></div></div>
        <div class="demo-cut-card"><div class="demo-cut-row"><b>1번 판넬 · 6,000mm</b><span class="use">2,800</span><span class="use">2,800</span><span class="scrap">400 · 폐기</span></div><div class="demo-cut-row"><b>2번 판넬 · 6,000mm</b><span class="use">2,800</span><span class="use">2,800</span><span class="scrap">400 · 폐기</span></div><div class="demo-cut-row"><b>마지막 판넬 · 6,000mm</b><span class="use">2,800</span><span class="reuse">3,200 · 재사용 예정</span></div></div><p class="demo-cut-note">2장은 운반·시공 중 여유분으로 발주합니다. 3,200mm 조각 1개는 다른 벽체에 재사용할 수 있습니다.</p>
        <div class="demo-next ready"><span>절단 계획까지 확인했습니다.</span><button type="button" @click="go(5)">예시 3D 보기</button></div>
      </section>

      <section v-else class="demo-screen demo-model-screen">
        <span class="demo-screen__eyebrow">다섯째 단계 · 참고 화면</span>
        <h2>완성 모습을 미리 보는 예시 3D입니다.</h2>
        <p class="demo-screen__lead">도면의 길이·높이·지붕 정보가 충분할 때, 발주 전에 전체 형태를 이렇게 확인할 수 있습니다.</p>
        <div class="demo-model-viewer"><Building3DViewer :model="demoBuildingModel" selected-wall-id="" mode="test" source-label="시연 도면 설정값 · 8m × 6m · 높이 2.8m" /></div>
        <div class="demo-model-note"><b>실제 서비스에서는</b><span>벽체·창호·지붕 정보가 충분한 도면만 3D 초안을 만들고, 부족한 부분은 “확인 필요”로 표시합니다.</span></div>
        <div class="demo-opinion"><div><strong>{{ opinion === 'yes' ? '시연이 끝났습니다. 사용해 보고 싶다고 선택하셨습니다.' : opinion === 'simple' ? '시연이 끝났습니다. 더 단순해야 한다고 선택하셨습니다.' : '발주표와 3D 참고 화면까지 포함한 이 흐름은 어떠신가요?' }}</strong><small>{{ opinion ? '처음부터 다시 보거나 실제 화면으로 돌아갈 수 있습니다.' : '의견을 남기면 다음 화면을 더 쉽게 다듬을 수 있습니다.' }}</small></div><div v-if="!opinion"><button type="button" :class="{ selected: opinion === 'yes' }" @click="choose('yes')">이렇게 쓰고 싶어요</button><button type="button" :class="{ selected: opinion === 'simple' }" @click="choose('simple')">더 간단해야 해요</button></div><div v-else><button type="button" class="demo-restart" @click="restartDemo">처음부터 다시 보기</button></div></div>
      </section>

      <p class="demo-page__notice">모든 숫자와 도면은 기능 설명을 위한 예시입니다. 실제 서비스에서는 올린 도면을 기준으로 계산합니다.</p>
    </div>
  </main>
</template>

<style scoped>
.demo-page { background: #f6faf7; color: #183b2b; min-height: 100vh; }
.demo-page__topbar { background: #fff; border-bottom: 1px solid #d8e7dd; }
.demo-page__topbar-inner, .demo-page__wrap { margin: 0 auto; max-width: 1080px; padding-left: 28px; padding-right: 28px; }
.demo-page__topbar-inner { align-items: center; display: flex; height: 84px; justify-content: space-between; }
.demo-page__brand { align-items: center; display: flex; gap: 11px; }.demo-page__brand span:last-child { display: grid; gap: 3px; }.demo-page__brand b { font-size: 19px; }.demo-page__brand small { color: #71887d; font-size: 12px; }.demo-page__brand-mark { align-items: center; background: #207350; border-radius: 10px; color: #fff; display: grid; font-size: 24px; height: 42px; justify-content: center; width: 42px; }
.demo-page__exit, .demo-screen button, .demo-next button, .demo-opinion button { border: 1px solid #9bc6ad; border-radius: 10px; background: #fff; color: #236b4a; cursor: pointer; font: inherit; font-weight: 800; padding: 12px 16px; }.demo-page__exit:hover, .demo-screen button:hover, .demo-next button:hover, .demo-opinion button:hover { background: #e7f4eb; }
.demo-page__intro { padding: 64px 0 34px; }.demo-page__intro > span, .demo-screen__eyebrow { color: #277551; font-size: 14px; font-weight: 800; }.demo-page__intro h1 { font-size: clamp(34px, 5vw, 58px); letter-spacing: -0.07em; line-height: 1.12; margin: 13px 0; }.demo-page__intro em { color: #287a54; font-style: normal; }.demo-page__intro p { color: #637a6e; font-size: 18px; line-height: 1.65; margin: 0; max-width: 650px; }
.demo-page__steps { border-bottom: 1px solid #d5e4da; display: grid; grid-template-columns: repeat(4, 1fr); }.demo-page__steps button { align-items: center; background: transparent; border: 0; border-bottom: 4px solid transparent; color: #7d9186; cursor: pointer; display: flex; font: inherit; font-weight: 800; gap: 10px; padding: 16px 8px; }.demo-page__steps button:disabled { cursor: not-allowed; opacity: .45; }.demo-page__steps i { align-items: center; background: #e3eee7; border-radius: 50%; display: grid; font-style: normal; height: 28px; justify-content: center; width: 28px; }.demo-page__steps .active { border-color: #207350; color: #1c6544; }.demo-page__steps .active i, .demo-page__steps .done i { background: #207350; color: #fff; }.demo-page__steps .done { color: #3d795c; }
.demo-screen { background: #fff; border: 1px solid #d3e5d9; border-radius: 22px; margin: 34px 0 22px; padding: clamp(24px, 4vw, 46px); }.demo-screen h2 { font-size: clamp(27px, 4vw, 39px); letter-spacing: -0.06em; margin: 8px 0; }.demo-screen__lead { color: #687f73; font-size: 18px; line-height: 1.6; margin: 0 0 28px; }
.demo-upload-box { align-items: center; background: #eff8f2; border: 2px dashed #9dcab0; border-radius: 18px; display: flex; flex-direction: column; gap: 8px; padding: 31px; text-align: center; }.demo-upload-box.complete { background: #e6f5ea; border-style: solid; }.demo-upload-box__icon { align-items: center; background: #d1ead9; border-radius: 50%; color: #23734e; display: grid; font-size: 29px; height: 52px; justify-content: center; width: 52px; }.demo-upload-box.complete .demo-upload-box__icon { background: #207350; color: #fff; }.demo-upload-box strong { font-size: 21px; }.demo-upload-box span { color: #668074; }.demo-upload-box button, .demo-next button { background: #207350; border-color: #207350; color: #fff; margin-top: 6px; }
.demo-file-list { display: grid; gap: 10px; margin-top: 18px; }.demo-file-list article { align-items: center; background: #fbfdfb; border: 1px solid #dceae0; border-radius: 12px; display: flex; gap: 12px; padding: 13px 15px; }.demo-file-list article > b { color: #278157; font-size: 20px; }.demo-file-list span { display: grid; gap: 3px; }.demo-file-list small { color: #778d82; }.demo-file-list em { color: #277551; font-size: 13px; font-style: normal; font-weight: 800; margin-left: auto; }.demo-screen__footnote, .demo-page__notice { color: #758a80; font-size: 13px; line-height: 1.55; margin: 18px 0 0; }
.demo-check-layout { display: grid; gap: 20px; grid-template-columns: 1.1fr .9fr; }.demo-drawing { background: #f5faf6; border: 1px solid #dbe9df; border-radius: 15px; min-height: 290px; padding: 20px; }.demo-drawing > span { color: #5d766a; font-weight: 800; }.demo-drawing__house { border: 4px solid #2a7752; height: 150px; margin: 42px auto 20px; position: relative; width: 75%; }.demo-drawing__house i { background: #bde1c9; height: 26px; position: absolute; width: 26px; }.demo-drawing__house i:nth-child(1) { left: 16%; top: 18%; }.demo-drawing__house i:nth-child(2) { right: 16%; top: 18%; }.demo-drawing__house i:nth-child(3) { bottom: 18%; left: 16%; }.demo-drawing__house i:nth-child(4) { bottom: 18%; right: 16%; }.demo-drawing__house b { left: 40%; position: absolute; top: -35px; }.demo-drawing__house em { font-style: normal; position: absolute; right: -47px; top: 45%; }.demo-drawing small { color: #788e83; }.demo-check-card { background: #eff8f2; border-radius: 15px; padding: 20px; }.demo-check-card > span { color: #277551; font-weight: 800; }.demo-check-card article { background: #fff; border: 1px solid #cde3d4; border-radius: 12px; display: grid; gap: 7px; margin-top: 12px; padding: 15px; transition: background .2s, border-color .2s; }.demo-check-card article.confirmed { background: #e8f6ed; border-color: #53a877; }.demo-check-card article.needs-change { background: #fff5df; border-color: #d8a34b; }.demo-check-card small { color: #6d8579; }.demo-check-card strong { font-size: 23px; }.demo-check-actions { display: flex; flex-wrap: wrap; gap: 7px; }.demo-check-card button { justify-self: start; padding: 7px 11px; }.demo-check-card button.selected { background: #207350; border-color: #207350; color: #fff; }.demo-check-card article.needs-change button.selected { background: #b77b20; border-color: #b77b20; }.demo-check-card article em { color: #9a691b; font-size: 12px; font-style: normal; }.demo-check-card p { color: #667d71; font-size: 13px; line-height: 1.5; }.demo-next { align-items: center; background: #e5f3e9; border-radius: 14px; display: flex; gap: 15px; justify-content: space-between; margin-top: 20px; padding: 15px; }.demo-next.ready { background: #d9f0e0; }.demo-next span { color: #38684e; font-weight: 700; }.demo-next button:disabled { background: #b5c7bb; border-color: #b5c7bb; cursor: not-allowed; opacity: .75; }
.demo-order-summary, .demo-cut-stats { display: grid; gap: 12px; grid-template-columns: repeat(4, 1fr); }.demo-order-summary > div, .demo-cut-stats > div { background: #eff8f2; border: 1px solid #d0e5d7; border-radius: 14px; display: grid; gap: 5px; padding: 17px; }.demo-order-summary small, .demo-cut-stats small { color: #688176; }.demo-order-summary strong, .demo-cut-stats strong { color: #1f704c; font-size: 23px; }.demo-order-table { border: 1px solid #d8e7dd; border-radius: 14px; margin-top: 20px; overflow: hidden; }.demo-order-table > div { display: grid; grid-template-columns: 1fr 1.5fr .4fr; gap: 10px; padding: 14px 16px; }.demo-order-table > div:first-child { background: #eaf5ed; color: #416e57; font-size: 13px; }.demo-order-table > div + div { border-top: 1px solid #e4eee7; }.demo-order-table span { color: #5d7569; }.demo-order-table strong { color: #216f4c; text-align: right; }
.demo-order-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 20px; }.demo-order-actions button { border: 1px solid #9bc6ad; border-radius: 9px; background: #fff; color: #236b4a; cursor: pointer; font: inherit; font-weight: 800; padding: 11px 15px; }.demo-order-actions button.selected { background: #207350; border-color: #207350; color: #fff; }.demo-cut-stats { grid-template-columns: repeat(3, 1fr); }.demo-cut-card { background: #f8fbf8; border: 1px solid #d6e6db; border-radius: 14px; display: grid; gap: 11px; margin-top: 20px; padding: 18px; }.demo-cut-row { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }.demo-cut-row b { min-width: 175px; }.demo-cut-row span { border-radius: 8px; font-size: 14px; font-weight: 800; padding: 10px 14px; }.demo-cut-row .use { background: #bee5ca; color: #175837; }.demo-cut-row .scrap { background: #f6e6b8; color: #755719; }.demo-cut-row .reuse { background: #c9dff3; color: #295b7b; }.demo-cut-note { color: #60766a; font-size: 14px; line-height: 1.55; margin: 15px 0 0; }.demo-opinion { align-items: center; border-top: 1px solid #dce9e0; display: flex; gap: 18px; justify-content: space-between; margin-top: 23px; padding-top: 20px; }.demo-opinion > div:first-child { display: grid; gap: 5px; }.demo-opinion small { color: #71887c; }.demo-opinion > div:last-child { display: flex; gap: 8px; }.demo-opinion .selected, .demo-opinion .demo-restart { background: #207350; border-color: #207350; color: #fff; }.demo-page__notice { margin: 0 0 42px; text-align: center; }
.demo-model-viewer { margin-top: 8px; }

/* 시연은 작업자용 화면처럼 흑백을 기본으로 하고, 행동·확인 상태만 색으로 남긴다. */
.demo-page { background: #f5f5f5; color: #111; font-family: Arial, "Apple SD Gothic Neo", sans-serif; }.demo-page__topbar, .demo-screen { background: #fff; border-color: #d2d2d2; }.demo-page__brand-mark, .demo-upload-box button, .demo-next button, .demo-opinion .selected, .demo-opinion .demo-restart { background: #111; border-color: #111; color: #fff; }.demo-page__brand b, .demo-screen h2, .demo-page__intro h1, .demo-file-list strong, .demo-order-summary strong, .demo-cut-stats strong { color: #111; }.demo-page__intro em, .demo-screen__eyebrow { color: #174ea6; }.demo-page__intro p, .demo-screen__lead, .demo-page__notice { color: #555; }.demo-page__steps { border-color: #cfcfcf; }.demo-page__steps .active { border-color: #111; color: #111; }.demo-page__steps .active i, .demo-page__steps .done i { background: #111; }.demo-upload-box, .demo-check-card, .demo-order-summary > div, .demo-cut-stats > div { background: #f7f7f7; border-color: #d3d3d3; }.demo-upload-box.complete { background: #f0f0f0; }.demo-upload-box__icon { background: #e3e3e3; color: #111; }.demo-upload-box.complete .demo-upload-box__icon { background: #111; }.demo-file-list article, .demo-order-table { background: #fff; border-color: #d7d7d7; }.demo-file-list article > b, .demo-file-list em { color: #174ea6; }.demo-check-card article.confirmed { background: #f2f6ff; border-color: #174ea6; }.demo-check-card button.selected, .demo-order-actions button.selected { background: #174ea6; border-color: #174ea6; }.demo-check-card article.needs-change { background: #fff4f4; border-color: #bf1e2e; }.demo-check-card article.needs-change button.selected { background: #bf1e2e; border-color: #bf1e2e; }.demo-next.ready { background: #f2f6ff; }.demo-order-table > div:first-child { background: #f0f0f0; color: #222; }.demo-order-table strong { color: #174ea6; }.demo-cut-card { background: #fafafa; border-color: #d5d5d5; }.demo-cut-row .use { background: #e7e7e7; color: #111; }.demo-cut-row .scrap { background: #fff0f0; color: #bf1e2e; }.demo-cut-row .reuse { background: #e8f0ff; color: #174ea6; }.demo-model-note { background: #f6f6f6; border-color: #174ea6; color: #333; }.demo-model-note b { color: #174ea6; }.demo-opinion { border-color: #d5d5d5; }
.demo-model-viewer :deep(.viewer-shell) { border-color: #cfcfcf; border-radius: 12px; background: #f6f6f6; min-height: 520px; }.demo-model-viewer :deep(.viewer-status), .demo-model-viewer :deep(.viewer-modes), .demo-model-viewer :deep(.viewer-toolbar button) { border-color: #cfcfcf; color: #111; }.demo-model-viewer :deep(.viewer-modes button.active) { background: #174ea6; }.demo-model-viewer :deep(.viewer-hint), .demo-model-viewer :deep(.viewer-notes) { color: #333; }
@media (max-width: 700px) { .demo-page__topbar-inner, .demo-page__wrap { padding-left: 16px; padding-right: 16px; }.demo-page__topbar-inner { height: 70px; }.demo-page__exit { font-size: 12px; padding: 9px; }.demo-page__brand b { font-size: 15px; }.demo-page__steps { overflow-x: auto; }.demo-page__steps button { min-width: 105px; }.demo-page__steps span { font-size: 13px; }.demo-check-layout, .demo-model-layout { grid-template-columns: 1fr; }.demo-order-summary { grid-template-columns: repeat(2, 1fr); }.demo-order-table > div { font-size: 13px; grid-template-columns: .9fr 1.35fr .45fr; padding: 12px; }.demo-cut-stats { grid-template-columns: 1fr; }.demo-next, .demo-opinion { align-items: stretch; flex-direction: column; }.demo-next button { width: 100%; }.demo-opinion > div:last-child { flex-direction: column; }.demo-opinion button { width: 100%; }.demo-cut-row b { min-width: 100%; }.demo-model-stage { min-height: 285px; }.demo-model-ground { transform: scale(.82); transform-origin: center; } }
</style>
