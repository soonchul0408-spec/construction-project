<script setup lang="ts">
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { BuildingGeometry, Opening } from '../types/domain'

const props = defineProps<{
  model: BuildingGeometry
  selectedWallId: string
  mode?: 'actual' | 'partial' | 'test' | 'failed' | 'review' | 'empty'
  sourceLabel?: string
}>()

const emit = defineEmits<{
  select: [wallId: string]
}>()

const containerRef = ref<HTMLElement | null>(null)
const viewMode = ref<'iso' | 'top' | 'front' | 'side'>('iso')
const renderError = ref('')

const modeLabel = computed(() => {
  if (props.mode === 'test') return '테스트 모델'
  if (props.mode === 'failed') return '분석 실패'
  if (props.mode === 'partial') return '부분 모델'
  if (props.mode === 'review') return '확인 필요'
  if (props.mode === 'actual') return '실제 분석 모델'
  return '3차원 생성 대기'
})

const unplacedOpeningCount = computed(() => props.model.walls.reduce((count, wall) => count + wall.openings.filter((opening) => !canCutOpening(opening, wall.lengthMm, wall.heightMm)).length, 0))
const usesSchematicCoordinates = computed(() => props.model.walls.some((wall) => wall.geometrySource === 'dimension-layout'))

let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera | undefined
let renderer: THREE.WebGLRenderer | undefined
let controls: OrbitControls | undefined
let modelGroup: THREE.Group | undefined
let resizeObserver: ResizeObserver | undefined
let animationFrame = 0
let pointerDown = { x: 0, y: 0 }
let hasDragged = false

const EPSILON = 0.0001

function rendererFailureMessage(error?: unknown) {
  if (error instanceof Error && error.message.includes('2D 도면과 표')) return error.message
  return '브라우저가 3D 기능을 지원하지 않습니다. 브라우저 설정 또는 그래픽 가속을 확인하세요. 2D 도면과 표로 계속 확인할 수 있습니다.'
}

function meters(valueMm: number) {
  return valueMm / 1000
}

function canCutOpening(opening: Opening, lengthMm: number, heightMm: number) {
  if (opening.widthMm === null || opening.heightMm === null || opening.offsetMm === null) return false
  if (opening.widthMm <= 0 || opening.heightMm <= 0) return false
  if (opening.offsetMm < 0 || opening.offsetMm + opening.widthMm > lengthMm) return false
  if (opening.type !== 'door' && opening.sillHeightMm === null) return false
  const sill = opening.type === 'door' ? 0 : opening.sillHeightMm || 0
  return sill >= 0 && sill + opening.heightMm <= heightMm
}

function validationColor(status?: BuildingGeometry['walls'][number]['validationStatus']) {
  if (status === '일부 검증 완료') return '#d39a35'
  if (status === '확인 필요') return '#c44c5c'
  if (status === '계산 불가' || status === '분석 실패') return '#87928c'
  return null
}

function createMaterial(color: string, selected: boolean, validationStatus?: BuildingGeometry['walls'][number]['validationStatus']) {
  const base = new THREE.Color(validationColor(validationStatus) || color || '#2f6fed')
  if (selected) base.lerp(new THREE.Color('#ffad5b'), 0.55)
  return new THREE.MeshStandardMaterial({
    color: base,
    roughness: 0.78,
    metalness: 0.04,
  })
}

function directionForWall(wall: BuildingGeometry['walls'][number]) {
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.z - wall.start.z
  const length = Math.hypot(dx, dz) || meters(wall.lengthMm)
  return {
    dx: dx / length,
    dz: dz / length,
    length,
    angle: Math.atan2(dz, dx),
  }
}

function placeLocalBox(
  wall: BuildingGeometry['walls'][number],
  group: THREE.Group,
  material: THREE.Material,
  localStartMm: number,
  localEndMm: number,
  bottomMm: number,
  topMm: number,
) {
  const direction = directionForWall(wall)
  const segmentLength = meters(localEndMm - localStartMm)
  const centerDistance = meters((localStartMm + localEndMm) / 2)
  const center = {
    x: wall.start.x + direction.dx * centerDistance,
    z: wall.start.z + direction.dz * centerDistance,
  }
  const height = meters(topMm - bottomMm)
  if (segmentLength <= EPSILON || height <= EPSILON) return
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(segmentLength, height, meters(wall.thicknessMm)),
    material,
  )
  mesh.position.set(center.x, meters(bottomMm + (topMm - bottomMm) / 2), center.z)
  mesh.rotation.y = -direction.angle
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.wallId = wall.wallId
  group.add(mesh)
}

function cuttableOpenings(wall: BuildingGeometry['walls'][number]) {
  return wall.openings
    .filter((opening) => canCutOpening(opening, wall.lengthMm, wall.heightMm))
    .map((opening) => ({
      opening,
      startMm: opening.offsetMm as number,
      endMm: (opening.offsetMm as number) + (opening.widthMm as number),
      bottomMm: opening.type === 'door' ? 0 : (opening.sillHeightMm as number),
      topMm: (opening.type === 'door' ? 0 : (opening.sillHeightMm as number)) + (opening.heightMm as number),
    }))
    .sort((a, b) => a.startMm - b.startMm)
}

function addWallGeometry(wall: BuildingGeometry['walls'][number], group: THREE.Group) {
  const selected = wall.wallId === props.selectedWallId
  const material = createMaterial(wall.color, selected, wall.validationStatus)
  const openings = cuttableOpenings(wall)
  const xBreaks = [...new Set([0, wall.lengthMm, ...openings.flatMap((item) => [item.startMm, item.endMm])])].sort((a, b) => a - b)
  const yBreaks = [...new Set([0, wall.heightMm, ...openings.flatMap((item) => [item.bottomMm, item.topMm])])].sort((a, b) => a - b)

  for (let xIndex = 0; xIndex < xBreaks.length - 1; xIndex += 1) {
    const localStartMm = xBreaks[xIndex]
    const localEndMm = xBreaks[xIndex + 1]
    if (localStartMm === undefined || localEndMm === undefined) continue
    for (let yIndex = 0; yIndex < yBreaks.length - 1; yIndex += 1) {
      const bottomMm = yBreaks[yIndex]
      const topMm = yBreaks[yIndex + 1]
      if (bottomMm === undefined || topMm === undefined) continue
      const centerX = (localStartMm + localEndMm) / 2
      const centerY = (bottomMm + topMm) / 2
      const insideOpening = openings.some((item) => centerX > item.startMm + EPSILON && centerX < item.endMm - EPSILON && centerY > item.bottomMm + EPSILON && centerY < item.topMm - EPSILON)
      if (!insideOpening) placeLocalBox(wall, group, material, localStartMm, localEndMm, bottomMm, topMm)
    }
  }

  for (const item of openings) addOpeningFrame(wall, group, item.opening)
}

function addOpeningFrame(
  wall: BuildingGeometry['walls'][number],
  group: THREE.Group,
  opening: Opening,
) {
  if (opening.widthMm === null || opening.heightMm === null || opening.offsetMm === null) return
  const bottomMm = opening.type === 'door' ? 0 : opening.sillHeightMm || 0
  const frameMaterial = new THREE.MeshBasicMaterial({
    color: opening.type === 'window' ? '#62c5df' : '#f3f0d0',
    transparent: true,
    opacity: 0.88,
  })
  const borderMm = Math.min(75, Math.max(35, Math.min(opening.widthMm, opening.heightMm) * 0.08), Math.min(opening.widthMm, opening.heightMm) / 2)
  const openingStart = opening.offsetMm
  const openingEnd = opening.offsetMm + opening.widthMm
  const openingTop = bottomMm + opening.heightMm
  const addFramePart = (startMm: number, endMm: number, partBottomMm: number, partTopMm: number) => {
    const direction = directionForWall(wall)
    const segmentLength = meters(endMm - startMm)
    const centerDistance = meters((startMm + endMm) / 2)
    const height = meters(partTopMm - partBottomMm)
    if (segmentLength <= EPSILON || height <= EPSILON) return
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(segmentLength, height, Math.max(meters(wall.thicknessMm) * 1.08, 0.016)),
      frameMaterial,
    )
    frame.position.set(
      wall.start.x + direction.dx * centerDistance,
      meters(partBottomMm + (partTopMm - partBottomMm) / 2),
      wall.start.z + direction.dz * centerDistance,
    )
    frame.rotation.y = -direction.angle
    frame.userData.wallId = wall.wallId
    frame.userData.openingId = opening.id
    group.add(frame)
  }
  addFramePart(openingStart, openingStart + borderMm, bottomMm, openingTop)
  addFramePart(openingEnd - borderMm, openingEnd, bottomMm, openingTop)
  addFramePart(openingStart + borderMm, openingEnd - borderMm, openingTop - borderMm, openingTop)
  if (opening.type === 'window') addFramePart(openingStart + borderMm, openingEnd - borderMm, bottomMm, bottomMm + borderMm)
}

function addUnplacedOpeningMarkers(wall: BuildingGeometry['walls'][number], group: THREE.Group) {
  const needsReview = wall.openings.filter((opening) => !canCutOpening(opening, wall.lengthMm, wall.heightMm))
  if (!needsReview.length) return
  const direction = directionForWall(wall)
  for (const opening of needsReview) {
    if (opening.widthMm === null || opening.heightMm === null) continue
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: '#c97935',
      transparent: true,
      opacity: 0.18,
      wireframe: true,
      depthTest: false,
    })
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(meters(opening.widthMm), meters(opening.heightMm), Math.max(meters(wall.thicknessMm) * 1.12, 0.015)),
      markerMaterial,
    )
    // This marker intentionally does not claim a real position. It is kept at
    // the wall origin and hidden when it would obscure the geometry; the UI
    // reports the missing offset/sill evidence instead.
    marker.position.set(wall.start.x, meters(wall.heightMm / 2), wall.start.z)
    marker.rotation.y = -direction.angle
    marker.visible = false
    marker.userData.wallId = wall.wallId
    group.add(marker)
  }
}

function addWallLabelMarker(wall: BuildingGeometry['walls'][number], group: THREE.Group) {
  const direction = directionForWall(wall)
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: wall.wallId === props.selectedWallId ? '#ffad5b' : '#ffffff',
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  })
  const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.06, meters(wall.thicknessMm) * 0.72), 12, 8), markerMaterial)
  marker.position.set(
    wall.start.x + direction.dx * direction.length * 0.5,
    meters(wall.heightMm) + Math.max(0.12, meters(wall.thicknessMm)),
    wall.start.z + direction.dz * direction.length * 0.5,
  )
  marker.userData.wallId = wall.wallId
  marker.userData.wallLabel = wall.wallNumber
  group.add(marker)
}

function addRoof(model: BuildingGeometry, group: THREE.Group) {
  // A roof over a partial footprint would invent geometry for the missing
  // walls. Keep the roof out until the complete footprint is verified.
  if (!model.roof.isReady || model.partial || model.footprint.length < 3) return
  const points = model.footprint.map((point) => new THREE.Vector2(point.x, point.z))
  const shape = new THREE.Shape(points)
  const height = model.roof.heightMm === null
    ? Math.max(...model.walls.map((wall) => wall.heightMm)) / 1000
    : meters(model.roof.heightMm)
  const roofGeometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.04, meters(75)), bevelEnabled: false })
  roofGeometry.rotateX(-Math.PI / 2)
  roofGeometry.translate(0, height, 0)
  const roofMaterial = new THREE.MeshStandardMaterial({ color: '#7d8f87', roughness: 0.86, metalness: 0.02 })
  const roof = new THREE.Mesh(roofGeometry, roofMaterial)
  roof.castShadow = true
  roof.receiveShadow = true
  group.add(roof)
}

function clearObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => material.dispose())
    }
  })
}

function boundsForModel(model: BuildingGeometry) {
  const points = model.walls.flatMap((wall) => [wall.start, wall.end])
  if (!points.length) return { minX: -5, maxX: 5, minZ: -5, maxZ: 5, maxHeight: 3, center: new THREE.Vector3(0, 1, 0), size: 10 }
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.z))
  const maxZ = Math.max(...points.map((point) => point.z))
  const horizontalPadding = Math.max(...model.walls.map((wall) => meters(wall.thicknessMm)), 0.05) / 2
  const roofHeight = model.roof.heightMm === null ? 0 : meters(model.roof.heightMm)
  const maxHeight = Math.max(...model.walls.map((wall) => meters(wall.heightMm)), roofHeight, 1)
  const paddedMinX = minX - horizontalPadding
  const paddedMaxX = maxX + horizontalPadding
  const paddedMinZ = minZ - horizontalPadding
  const paddedMaxZ = maxZ + horizontalPadding
  const size = Math.max(paddedMaxX - paddedMinX, paddedMaxZ - paddedMinZ, maxHeight, 1)
  return {
    minX: paddedMinX,
    maxX: paddedMaxX,
    minZ: paddedMinZ,
    maxZ: paddedMaxZ,
    maxHeight,
    center: new THREE.Vector3((paddedMinX + paddedMaxX) / 2, maxHeight / 2, (paddedMinZ + paddedMaxZ) / 2),
    size,
  }
}

function addGround(model: BuildingGeometry, group: THREE.Group) {
  const bounds = boundsForModel(model)
  const groundSize = Math.max(bounds.size * 1.8, 12)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: '#edf4f0', roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set(bounds.center.x, -0.004, bounds.center.z)
  ground.receiveShadow = true
  group.add(ground)
  const divisions = Math.min(40, Math.max(10, Math.round(groundSize)))
  const grid = new THREE.GridHelper(groundSize, divisions, '#b7cbc1', '#d8e5df')
  grid.position.set(bounds.center.x, 0, bounds.center.z)
  group.add(grid)
}

function addAxes(model: BuildingGeometry, group: THREE.Group) {
  const bounds = boundsForModel(model)
  const axesLength = Math.max(bounds.size * 0.32, 1.8)
  const axes = new THREE.AxesHelper(axesLength)
  axes.position.set(bounds.minX, 0.012, bounds.minZ)
  axes.userData.isReference = true
  group.add(axes)
}

function rebuildModel() {
  if (!scene || !modelGroup) return
  clearObject(modelGroup)
  modelGroup.clear()
  addGround(props.model, modelGroup)
  addAxes(props.model, modelGroup)
  if (!props.model.isReady) {
    nextTick(() => {
      resizeRenderer()
      fitCamera()
    })
    return
  }
  for (const wall of props.model.walls) {
    const wallGroup = new THREE.Group()
    wallGroup.userData.wallId = wall.wallId
    addWallGeometry(wall, wallGroup)
    addUnplacedOpeningMarkers(wall, wallGroup)
    addWallLabelMarker(wall, wallGroup)
    modelGroup.add(wallGroup)
  }
  addRoof(props.model, modelGroup)
  nextTick(() => {
    resizeRenderer()
    fitCamera()
  })
}

function fitCamera() {
  if (!camera || !controls) return
  const bounds = boundsForModel(props.model)
  const target = bounds.center.clone()
  const rect = containerRef.value?.getBoundingClientRect()
  const aspect = rect && rect.height > 0 ? rect.width / rect.height : 1.5
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const fitDistance = bounds.size / (2 * Math.tan(verticalFov / 2))
  const distance = Math.max(fitDistance * (aspect < 1 ? 1.5 : 1.28), 5)
  const direction = viewMode.value === 'top'
    ? new THREE.Vector3(0, 1, 0.001)
    : viewMode.value === 'front'
      ? new THREE.Vector3(0, 0.38, 1)
      : viewMode.value === 'side'
        ? new THREE.Vector3(1, 0.38, 0)
        : new THREE.Vector3(1, 0.72, 1)
  camera.position.copy(target).add(direction.normalize().multiplyScalar(distance))
  camera.near = Math.max(0.01, distance / 1000)
  camera.far = Math.max(1000, distance * 100)
  camera.updateProjectionMatrix()
  controls.target.copy(target)
  controls.update()
}

function resizeRenderer() {
  if (!containerRef.value || !renderer || !camera) return
  const rect = containerRef.value.getBoundingClientRect()
  const width = Math.max(1, rect.width)
  const height = Math.max(360, rect.height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function pointerToNdc(event: MouseEvent | PointerEvent) {
  if (!renderer) return null
  const rect = renderer.domElement.getBoundingClientRect()
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
}

function onPointerDown(event: PointerEvent) {
  pointerDown = { x: event.clientX, y: event.clientY }
  hasDragged = false
}

function onPointerMove(event: PointerEvent) {
  if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) hasDragged = true
}

function onCanvasClick(event: MouseEvent) {
  if (hasDragged || !camera || !renderer || !modelGroup || !props.model.isReady) return
  const ndc = pointerToNdc(event)
  if (!ndc) return
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, camera)
  const hit = raycaster.intersectObjects(modelGroup.children, true).find((item) => typeof item.object.userData.wallId === 'string')
  if (hit?.object.userData.wallId) emit('select', hit.object.userData.wallId as string)
}

function setView(mode: typeof viewMode.value) {
  viewMode.value = mode
  fitCamera()
}

function resetView() {
  viewMode.value = 'iso'
  fitCamera()
}

function startRenderer() {
  const container = containerRef.value
  if (!container) return
  renderError.value = ''
  try {
    const probeCanvas = document.createElement('canvas')
    const webglContext = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl') || probeCanvas.getContext('experimental-webgl')
    if (!webglContext) throw new Error('브라우저가 3D 기능을 지원하지 않습니다. 브라우저 설정 또는 그래픽 가속을 확인하세요. 2D 도면과 표로 계속 확인할 수 있습니다.')
    scene = new THREE.Scene()
    scene.background = new THREE.Color('#f3f8f5')
    camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000)
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.className = 'building-canvas'
    renderer.domElement.setAttribute('role', 'img')
  renderer.domElement.setAttribute('aria-label', '도면 정보를 기반으로 만든 자재 산출용 3차원 건축물 모델')
    container.appendChild(renderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 0.2
    controls.maxDistance = 10000
    controls.enablePan = true

    const hemisphere = new THREE.HemisphereLight('#ffffff', '#aec3b8', 1.8)
    scene.add(hemisphere)
    const keyLight = new THREE.DirectionalLight('#ffffff', 2.4)
    keyLight.position.set(30, 50, 25)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(2048, 2048)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight('#cce7ff', 0.8)
    fillLight.position.set(-25, 18, -20)
    scene.add(fillLight)

    modelGroup = new THREE.Group()
    scene.add(modelGroup)
    resizeRenderer()
    rebuildModel()
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('click', onCanvasClick)
    const renderLoop = () => {
      if (!renderer || !scene || !camera) return
      animationFrame = window.requestAnimationFrame(renderLoop)
      controls?.update()
      try {
        renderer.render(scene, camera)
      } catch (error) {
        window.cancelAnimationFrame(animationFrame)
        renderError.value = rendererFailureMessage(error)
      }
    }
    renderLoop()
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resizeRenderer)
      resizeObserver.observe(container)
    }
    window.addEventListener('resize', resizeRenderer)
    window.requestAnimationFrame(() => {
      resizeRenderer()
      fitCamera()
    })
  } catch (error) {
    renderError.value = rendererFailureMessage(error)
  }
}

watch(() => [props.model, props.selectedWallId], () => nextTick(rebuildModel), { deep: true })

onMounted(() => startRenderer())

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', resizeRenderer)
  if (renderer) {
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('click', onCanvasClick)
    renderer.dispose()
    renderer.domElement.remove()
  }
  controls?.dispose()
  if (modelGroup) clearObject(modelGroup)
})
</script>

<template>
  <div ref="containerRef" class="viewer-shell">
    <div class="viewer-status" :class="`viewer-status--${mode || 'actual'}`" aria-live="polite">
      <strong>{{ modeLabel }}</strong>
      <span v-if="sourceLabel">{{ sourceLabel }}</span>
    </div>
    <div class="viewer-toolbar" aria-label="3차원 보기 도구">
      <div class="viewer-modes" role="group" aria-label="보기 방향">
        <button type="button" :class="{ active: viewMode === 'iso' }" @click="setView('iso')">등각</button>
        <button type="button" :class="{ active: viewMode === 'top' }" @click="setView('top')">위</button>
        <button type="button" :class="{ active: viewMode === 'front' }" @click="setView('front')">앞</button>
        <button type="button" :class="{ active: viewMode === 'side' }" @click="setView('side')">옆</button>
      </div>
      <div class="viewer-actions">
        <button type="button" class="fit-button" @click="fitCamera">전체 맞춤</button>
        <button type="button" class="reset-button" @click="resetView">↺ 초기화</button>
      </div>
    </div>
    <div class="viewer-axis-legend" aria-label="XYZ 축 안내">
      <span class="axis-x">X 가로</span><span class="axis-y">Y 높이</span><span class="axis-z">Z 깊이</span>
    </div>
    <div v-if="!renderError && !model.isReady" class="viewer-empty">
      <strong>{{ modeLabel }}</strong>
      <span>{{ model.blockedReason || '도면 분석이 끝나면 실제 벽체가 이 화면에 표시됩니다.' }}</span>
    </div>
    <div v-if="renderError" class="viewer-empty viewer-error" role="alert">
      <strong>3차원 화면을 시작하지 못했습니다.</strong>
      <span>{{ renderError }}</span>
    </div>
    <div v-if="model.isReady && (usesSchematicCoordinates || unplacedOpeningCount || !model.roof.isReady)" class="viewer-notes">
      <span v-if="usesSchematicCoordinates">벽체 좌표 근거 없음 · 치수 순서 기반 개략 배치</span>
      <span v-if="unplacedOpeningCount">개구부 정보 확인 필요 · 위치 또는 문턱 근거가 없는 {{ unplacedOpeningCount }}개는 형상에서 확정하지 않았습니다.</span>
      <span v-if="!model.roof.isReady">지붕 입체 형상 보류 · {{ model.roof.blockedReason }}</span>
    </div>
    <div class="viewer-hint">드래그로 회전 · 휠로 확대/축소 · 오른쪽 버튼으로 이동 · 벽체를 클릭해 상세 보기</div>
  </div>
</template>

<style scoped>
.viewer-shell {
  position: relative;
  width: 100%;
  height: min(68vh, 720px);
  min-height: 600px;
  overflow: hidden;
  border: 1px solid #d9e8e0;
  border-radius: 16px;
  background: #f3f8f5;
}

.viewer-status {
  position: absolute;
  z-index: 3;
  top: 76px;
  left: 14px;
  display: grid;
  gap: 2px;
  max-width: min(48%, 360px);
  padding: 9px 12px;
  border: 1px solid rgb(210 226 218 / 92%);
  border-radius: 10px;
  background: rgb(255 255 255 / 90%);
  color: #2f5647;
  box-shadow: 0 5px 18px rgb(38 74 57 / 8%);
  pointer-events: none;
}

.viewer-status strong {
  font-size: 16px;
}

.viewer-status span {
  overflow: hidden;
  color: #71877d;
  font-size: 13px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-status--test {
  border-color: #e4c99f;
  color: #8c5c28;
}

.viewer-status--failed,
.viewer-status--review,
.viewer-status--empty {
  border-color: #edc3b5;
  color: #a54c35;
}

.viewer-status--partial {
  border-color: #e6d1a6;
  color: #8b6b31;
}

.viewer-toolbar {
  position: absolute;
  z-index: 3;
  top: 14px;
  right: 14px;
  left: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
}

.viewer-toolbar button {
  border: 1px solid #d3e2db;
  background: rgb(255 255 255 / 88%);
  color: #476058;
  font: inherit;
  min-height: 48px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  pointer-events: auto;
}

.viewer-modes {
  display: flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid #d3e2db;
  border-radius: 10px;
  background: rgb(255 255 255 / 88%);
}

.viewer-modes button {
  border: 0;
  border-radius: 7px;
  padding: 9px 13px;
}

.viewer-modes button.active {
  color: #fff;
  background: #1b765f;
}

.reset-button {
  border-radius: 9px;
  padding: 9px 13px;
}

.viewer-actions {
  display: flex;
  gap: 6px;
}

:deep(.building-canvas) {
  position: absolute;
  z-index: 0;
  inset: 0;
  display: block;
  width: 100% !important;
  height: 100% !important;
  cursor: grab;
  touch-action: none;
}

:deep(.building-canvas:active) {
  cursor: grabbing;
}

.viewer-empty {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: 50%;
  display: grid;
  gap: 8px;
  width: min(78%, 440px);
  padding: 22px;
  border: 1px solid rgb(211 226 219 / 86%);
  border-radius: 14px;
  background: rgb(255 255 255 / 88%);
  box-shadow: 0 10px 32px rgb(38 74 57 / 10%);
  transform: translate(-50%, -50%);
  color: #536861;
  text-align: center;
  pointer-events: none;
}

.viewer-empty strong {
  font-size: 19px;
}

.viewer-empty span {
  color: #82938d;
  font-size: 16px;
  line-height: 1.65;
}

.viewer-error {
  color: #a54c35;
}

.viewer-notes {
  position: absolute;
  z-index: 3;
  right: 14px;
  bottom: 38px;
  left: 14px;
  display: grid;
  gap: 3px;
  color: #88613e;
  font-size: 15px;
  line-height: 1.55;
  pointer-events: none;
}

.viewer-hint {
  position: absolute;
  z-index: 3;
  right: 16px;
  bottom: 13px;
  left: 16px;
  color: #6e837a;
  font-size: 15px;
  text-align: center;
  pointer-events: none;
}

 .viewer-axis-legend {
  position: absolute;
  z-index: 3;
  top: 78px;
  right: 14px;
  display: flex;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid rgb(211 226 219 / 86%);
  border-radius: 9px;
  background: rgb(255 255 255 / 88%);
  color: #60776d;
  font-size: 12px;
  pointer-events: none;
}

.axis-x { color: #bd4a46; }
.axis-y { color: #328c5c; }
.axis-z { color: #3f6bb0; }

@media (max-width: 900px) {
  .viewer-shell {
    height: min(62vh, 600px);
    min-height: 450px;
  }
}

@media (max-width: 640px) {
  .viewer-shell {
    min-height: 360px;
    height: 360px;
  }

  .viewer-status {
    top: 68px;
    left: 9px;
    max-width: 52%;
    padding: 7px 9px;
  }

  .viewer-status strong { font-size: 14px; }
  .viewer-status span { font-size: 11px; }

  .viewer-toolbar {
    top: 9px;
    right: 9px;
    left: 9px;
  }

  .viewer-modes button {
    padding: 5px 7px;
  }

  .viewer-axis-legend {
    top: 68px;
    right: 9px;
    gap: 4px;
    padding: 6px;
    font-size: 10px;
  }

  .viewer-notes {
    right: 9px;
    bottom: 36px;
    left: 9px;
  }
}
</style>
