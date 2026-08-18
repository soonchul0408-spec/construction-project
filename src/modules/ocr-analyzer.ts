import { classifyDocument, classifyTextOrigin } from './document-classifier'
import { extractDrawingMetadata, type TextEvidenceItem } from './drawing-metadata-extractor'
import { normalizeNumericToken, numericTokensFromText, toDimensionValue } from './dimension-normalizer'
import { readAsDataUrl } from './file-loader'
import { shouldRunTileOcr } from './ocr-policy'
import type { DrawingPage, Evidence, HandwritingStatus } from '../types/domain'

export interface ImageAnalysisResult {
  page: DrawingPage
  text: string
  ocrConfidence: number
  engineWarning: string
}

interface PreprocessedImage {
  sourceImage: HTMLImageElement
  canvas: HTMLCanvasElement
  previewUrl: string
  tiles: OcrTile[]
  orientationCanvases: Array<{ canvas: HTMLCanvasElement; rotation: number }>
  processingNotes: string[]
}

interface OcrTile {
  canvas: HTMLCanvasElement
  offsetX: number
  offsetY: number
  scale: number
  label: string
}

export interface RecognizedWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('이미지를 열지 못했습니다.'))
    image.src = dataUrl
  })
}

function createEnhancedCanvas(image: HTMLImageElement, rotationDegrees = 0) {
  const quarterTurn = rotationDegrees === 90 || rotationDegrees === 270
  const naturalWidth = image.naturalWidth || image.width
  const naturalHeight = image.naturalHeight || image.height
  const maxWidth = 2200
  const baseScale = Math.min(1, maxWidth / Math.max(naturalWidth, naturalHeight))
  const sourceWidth = Math.max(1, Math.round(naturalWidth * baseScale))
  const sourceHeight = Math.max(1, Math.round(naturalHeight * baseScale))
  const canvas = document.createElement('canvas')
  canvas.width = quarterTurn ? sourceHeight : sourceWidth
  canvas.height = quarterTurn ? sourceWidth : sourceHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('이미지 전처리 캔버스를 만들지 못했습니다.')
  context.save()
  if (rotationDegrees === 90) {
    context.translate(canvas.width, 0)
    context.rotate(Math.PI / 2)
  } else if (rotationDegrees === 180) {
    context.translate(canvas.width, canvas.height)
    context.rotate(Math.PI)
  } else if (rotationDegrees === 270) {
    context.translate(0, canvas.height)
    context.rotate(-Math.PI / 2)
  }
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight)
  context.restore()
  return { canvas, context }
}

function enhanceCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('이미지 보정 캔버스를 만들지 못했습니다.')
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const grayscale = new Uint8ClampedArray(canvas.width * canvas.height)
  for (let index = 0; index < pixels.data.length; index += 4) {
    const red = pixels.data[index]
    const green = pixels.data[index + 1]
    const blue = pixels.data[index + 2]
    // Grayscale + contrast normalization makes printed dimension text easier
    // to recognize without fabricating a missing stroke.
    const gray = Math.min(255, Math.max(0, (0.299 * red + 0.587 * green + 0.114 * blue - 128) * 1.28 + 128))
    grayscale[index / 4] = gray
  }
  const at = (x: number, y: number) => grayscale[y * canvas.width + x] || 0
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4
      const center = at(x, y)
      const sharpened = y === 0 || x === 0 || y === canvas.height - 1 || x === canvas.width - 1
        ? center
        : Math.min(255, Math.max(0, center * 5 - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1)))
      pixels.data[index] = sharpened
      pixels.data[index + 1] = sharpened
      pixels.data[index + 2] = sharpened
    }
  }
  context.putImageData(pixels, 0, 0)
}

function createTiles(canvas: HTMLCanvasElement): OcrTile[] {
  const tiles: OcrTile[] = []
  const tileWidth = Math.ceil(canvas.width / 2)
  const tileHeight = Math.ceil(canvas.height / 2)
  const overlap = Math.round(Math.min(tileWidth, tileHeight) * 0.08)
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const offsetX = Math.max(0, column * tileWidth - overlap)
      const offsetY = Math.max(0, row * tileHeight - overlap)
      const right = Math.min(canvas.width, (column + 1) * tileWidth + overlap)
      const bottom = Math.min(canvas.height, (row + 1) * tileHeight + overlap)
      const tile = document.createElement('canvas')
      tile.width = Math.max(1, right - offsetX)
      tile.height = Math.max(1, bottom - offsetY)
      tile.getContext('2d')?.drawImage(canvas, offsetX, offsetY, tile.width, tile.height, 0, 0, tile.width, tile.height)
      tiles.push({ canvas: tile, offsetX, offsetY, scale: 1, label: `도면 ${row * 2 + column + 1}분할 영역` })
    }
  }
  return tiles
}

function createNumericFocusTiles(canvas: HTMLCanvasElement, words: RecognizedWord[]) {
  return words
    .filter((word) => /\d/.test(word.text))
    .slice(0, 16)
    .map((word, index) => {
      const padding = 24
      const x = Math.max(0, Math.floor(word.bbox.x0 - padding))
      const y = Math.max(0, Math.floor(word.bbox.y0 - padding))
      const right = Math.min(canvas.width, Math.ceil(word.bbox.x1 + padding))
      const bottom = Math.min(canvas.height, Math.ceil(word.bbox.y1 + padding))
      const sourceWidth = Math.max(1, right - x)
      const sourceHeight = Math.max(1, bottom - y)
      const scale = 2
      const focus = document.createElement('canvas')
      focus.width = sourceWidth * scale
      focus.height = sourceHeight * scale
      focus.getContext('2d')?.drawImage(canvas, x, y, sourceWidth, sourceHeight, 0, 0, focus.width, focus.height)
      return { canvas: focus, offsetX: x, offsetY: y, scale, label: `숫자 확대 영역 ${index + 1}` }
    })
}

async function preprocessImage(file: File): Promise<PreprocessedImage> {
  const dataUrl = await readAsDataUrl(file)
  const image = await loadImage(dataUrl)
  const { canvas } = createEnhancedCanvas(image)
  enhanceCanvas(canvas)
  const orientationCanvases = [90, 180, 270].map((rotation) => {
    const rotated = createEnhancedCanvas(image, rotation).canvas
    enhanceCanvas(rotated)
    return { canvas: rotated, rotation }
  })
  return {
    sourceImage: image,
    canvas,
    previewUrl: canvas.toDataURL('image/jpeg', 0.88),
    tiles: createTiles(canvas),
    orientationCanvases,
    processingNotes: [
      '이미지 방향과 EXIF 회전 정보를 반영해 읽었습니다.',
      '밝기·대비·선명도 보정을 적용했습니다.',
      '전체 도면 OCR 후 필요하면 4분할 타일 OCR을 추가합니다.',
      '사진의 원근 왜곡은 기준점이 확인되지 않으면 자동으로 바로잡지 않고 확인 필요로 남깁니다.',
    ],
  }
}

interface RecognitionInput {
  canvas: HTMLCanvasElement
  offsetX?: number
  offsetY?: number
  scale?: number
}

interface OcrOrientation {
  canvas: HTMLCanvasElement
  rotation: 0 | 90 | 180 | 270
}

async function recognizeCanvases(inputs: RecognitionInput[], onProgress?: (progress: number) => void) {
  // Tesseract is loaded only when an image is uploaded so the first screen remains light.
  const { createWorker } = await import('tesseract.js')
  // Korean drawing labels and English CAD notation commonly coexist.
  // Tesseract downloads these language models on first use and caches them.
  const worker = await createWorker('kor+eng', 1, {
    logger: (message: { status?: string; progress?: number }) => {
      if (typeof message.progress === 'number') onProgress?.(Math.round(message.progress * 88) + 8)
    },
  })
  try {
    const results: Array<{ text: string; confidence: number; words: RecognizedWord[] }> = []
    for (const [index, input] of inputs.entries()) {
      const result = await worker.recognize(input.canvas)
      const resultData = result.data as unknown as {
        text?: string
        confidence?: number
        words?: Array<{ text?: string; confidence?: number; bbox?: { x0?: number; y0?: number; x1?: number; y1?: number } }>
      }
      const scale = input.scale || 1
      results.push({
        text: resultData.text || '',
        confidence: Number(resultData.confidence || 0),
        words: Array.isArray(resultData.words)
          ? resultData.words.map((word) => ({
            text: word.text || '',
            confidence: Number(word.confidence || 0),
            bbox: {
              x0: (Number(word.bbox?.x0 || 0) / scale) + (input.offsetX || 0),
              y0: (Number(word.bbox?.y0 || 0) / scale) + (input.offsetY || 0),
              x1: (Number(word.bbox?.x1 || 0) / scale) + (input.offsetX || 0),
              y1: (Number(word.bbox?.y1 || 0) / scale) + (input.offsetY || 0),
            },
          }))
          : [],
      })
      onProgress?.(Math.round(((index + 1) / inputs.length) * 100))
    }
    return results
  } finally {
    await worker.terminate()
  }
}

function rotateCanvas(source: HTMLCanvasElement, rotation: 90 | 180 | 270): HTMLCanvasElement {
  const quarterTurn = rotation === 90 || rotation === 270
  const canvas = document.createElement('canvas')
  canvas.width = quarterTurn ? source.height : source.width
  canvas.height = quarterTurn ? source.width : source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('회전 OCR용 캔버스를 만들지 못했습니다.')
  if (rotation === 90) {
    context.translate(canvas.width, 0)
    context.rotate(Math.PI / 2)
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height)
    context.rotate(Math.PI)
  } else {
    context.translate(0, canvas.height)
    context.rotate(-Math.PI / 2)
  }
  context.drawImage(source, 0, 0)
  return canvas
}

function originalPoint(point: { x: number; y: number }, sourceWidth: number, sourceHeight: number, rotation: OcrOrientation['rotation']) {
  if (rotation === 90) return { x: point.y, y: sourceHeight - point.x }
  if (rotation === 180) return { x: sourceWidth - point.x, y: sourceHeight - point.y }
  if (rotation === 270) return { x: sourceWidth - point.y, y: point.x }
  return point
}

function mapWordsToOriginal(words: RecognizedWord[], sourceWidth: number, sourceHeight: number, rotation: OcrOrientation['rotation']) {
  if (rotation === 0) return words
  return words.map((word) => {
    const corners = [
      originalPoint({ x: word.bbox.x0, y: word.bbox.y0 }, sourceWidth, sourceHeight, rotation),
      originalPoint({ x: word.bbox.x1, y: word.bbox.y0 }, sourceWidth, sourceHeight, rotation),
      originalPoint({ x: word.bbox.x0, y: word.bbox.y1 }, sourceWidth, sourceHeight, rotation),
      originalPoint({ x: word.bbox.x1, y: word.bbox.y1 }, sourceWidth, sourceHeight, rotation),
    ]
    return {
      ...word,
      bbox: {
        x0: Math.max(0, Math.min(...corners.map((point) => point.x))),
        y0: Math.max(0, Math.min(...corners.map((point) => point.y))),
        x1: Math.min(sourceWidth, Math.max(...corners.map((point) => point.x))),
        y1: Math.min(sourceHeight, Math.max(...corners.map((point) => point.y))),
      },
    }
  })
}

export async function recognizeCanvas(canvas: HTMLCanvasElement, onProgress?: (progress: number) => void) {
  // Architectural drawings are often plotted sideways. Try the original first,
  // then select the best free local OCR orientation before splitting it into tiles.
  const originalWidth = canvas.width
  const originalHeight = canvas.height
  let selected: OcrOrientation & { result: ReturnType<typeof mergeRecognizedResults> } = {
    canvas,
    rotation: 0,
    result: mergeRecognizedResults(await recognizeCanvases([{ canvas }], (progress) => onProgress?.(Math.round(progress * 0.42)))),
  }
  if (ocrQuality(selected.result) < 1120) {
    const rotations: Array<90 | 180 | 270> = [90, 180, 270]
    for (const [index, rotation] of rotations.entries()) {
      const rotated = rotateCanvas(canvas, rotation)
      const result = mergeRecognizedResults(await recognizeCanvases([{ canvas: rotated }], (progress) => onProgress?.(42 + Math.round(index * 19 + progress * 0.19))))
      if (ocrQuality(result) > ocrQuality(selected.result)) selected = { canvas: rotated, rotation, result }
    }
  }
  let result = selected.result
  if (shouldRunTileOcr(result.text, result.words)) {
    const tileResults = await recognizeCanvases(createTiles(selected.canvas), (progress) => onProgress?.(80 + Math.round(progress * 0.12)))
    result = mergeRecognizedResults([result, ...tileResults])
  }
  const focusTiles = createNumericFocusTiles(selected.canvas, result.words)
  if (focusTiles.length) {
    const focusResults = await recognizeCanvases(focusTiles, (progress) => onProgress?.(92 + Math.round(progress * 0.08)))
    result = mergeRecognizedResults([result, ...focusResults])
  }
  return { ...result, words: mapWordsToOriginal(result.words, originalWidth, originalHeight, selected.rotation) }
}

function mergeRecognizedResults(results: Array<{ text: string; confidence: number; words: RecognizedWord[] }>) {
  const words = results.flatMap((result) => result.words).filter((word) => word.text.trim())
    .filter((word, index, values) => values.findIndex((candidate) => {
      return candidate.text === word.text && Math.abs(candidate.bbox.x0 - word.bbox.x0) < 5 && Math.abs(candidate.bbox.y0 - word.bbox.y0) < 5
    }) === index)
  const text = results.map((result) => result.text.trim()).filter(Boolean).join('\n')
  const confidenceValues = results.map((result) => result.confidence).filter((value) => value > 0)
  return {
    text,
    confidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0,
    words,
  }
}

function ocrQuality(result: { text: string; confidence: number; words: RecognizedWord[] }) {
  return (result.words.some((word) => /\d/.test(word.text)) ? 1000 : 0) + result.confidence * 2 + Math.min(result.text.length, 160)
}

function evidenceCrop(canvas: HTMLCanvasElement, bbox: RecognizedWord['bbox']) {
  const padding = 18
  const x = Math.max(0, Math.floor(bbox.x0 - padding))
  const y = Math.max(0, Math.floor(bbox.y0 - padding))
  const right = Math.min(canvas.width, Math.ceil(bbox.x1 + padding))
  const bottom = Math.min(canvas.height, Math.ceil(bbox.y1 + padding))
  if (right <= x || bottom <= y) return undefined
  const crop = document.createElement('canvas')
  crop.width = Math.max(1, right - x)
  crop.height = Math.max(1, bottom - y)
  crop.getContext('2d')?.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  return crop.toDataURL('image/jpeg', 0.78)
}

export async function analyzeImage(
  file: File,
  fileId: string,
  onProgress?: (progress: number) => void,
): Promise<ImageAnalysisResult> {
  const preprocessed = await preprocessImage(file)
  onProgress?.(8)
  let text = ''
  let ocrConfidence = 0
  let ocrWords: RecognizedWord[] = []
  let engineWarning = ''
  try {
    let result = mergeRecognizedResults(await recognizeCanvases([{ canvas: preprocessed.canvas }], (progress) => onProgress?.(8 + Math.round(progress * 0.34))))
    const rotatedResults: Array<{ result: ReturnType<typeof mergeRecognizedResults>; canvas: HTMLCanvasElement; rotation: number }> = []
    if (ocrQuality(result) < 1120) {
      for (const orientation of preprocessed.orientationCanvases) {
        const [orientationResult] = await recognizeCanvases([{ canvas: orientation.canvas }], (progress) => onProgress?.(42 + Math.round(progress * 0.12)))
        const mergedOrientation = mergeRecognizedResults([orientationResult])
        rotatedResults.push({ result: mergedOrientation, canvas: orientation.canvas, rotation: orientation.rotation })
      }
      const bestRotation = rotatedResults.sort((left, right) => ocrQuality(right.result) - ocrQuality(left.result))[0]
      if (bestRotation && ocrQuality(bestRotation.result) > ocrQuality(result)) {
        result = bestRotation.result
        preprocessed.canvas = bestRotation.canvas
        preprocessed.tiles = createTiles(preprocessed.canvas)
        preprocessed.previewUrl = preprocessed.canvas.toDataURL('image/jpeg', 0.88)
        preprocessed.processingNotes.push(`${bestRotation.rotation}도 회전 후보가 원본보다 높은 OCR 품질을 보여 회전 보정했습니다.`)
      }
    }
    if (shouldRunTileOcr(result.text, result.words)) {
      const tileResults = await recognizeCanvases(preprocessed.tiles, (progress) => onProgress?.(60 + Math.round(progress * 0.16)))
      result = mergeRecognizedResults([result, ...tileResults])
      preprocessed.processingNotes.push('전체 OCR 결과가 부족해 4분할 타일 OCR을 추가했습니다.')
    }
    const numericFocusTiles = createNumericFocusTiles(preprocessed.canvas, result.words)
    if (numericFocusTiles.length) {
      const focusResults = await recognizeCanvases(numericFocusTiles, (progress) => onProgress?.(77 + Math.round(progress * 0.12)))
      result = mergeRecognizedResults([result, ...focusResults])
      preprocessed.processingNotes.push('숫자·단위가 있는 영역을 확대해 재확인했습니다.')
    }
    text = result.text
    ocrConfidence = result.confidence
    ocrWords = result.words
  } catch (error) {
    engineWarning = '로컬 OCR 엔진을 초기화하지 못했습니다. 미리보기는 저장했지만 숫자를 자동 확정하지 않았습니다.'
    console.warn(error)
  }

  const classification = classifyDocument(text, file.name)
  const handwritingStatus: HandwritingStatus = classifyTextOrigin(text, ocrConfidence)
  const evidence: Evidence = {
    fileId,
    fileName: file.name,
    pageNumber: 1,
    drawingKind: classification.kind,
    location: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      coordinateSystem: 'normalized',
    },
    method: 'ocr',
    rawText: text.slice(0, 500),
    note: [...preprocessed.processingNotes, '로컬 OCR 처리'].join(' · '),
    handwritingStatus,
  }
  const wordItems: TextEvidenceItem[] = ocrWords
    .filter((word) => word.text.trim())
    .map((word) => ({
      text: word.text,
      evidence: {
        ...evidence,
        rawText: word.text,
        location: {
          x: Math.min(1, Math.max(0, word.bbox.x0 / Math.max(1, preprocessed.canvas.width))),
          y: Math.min(1, Math.max(0, word.bbox.y0 / Math.max(1, preprocessed.canvas.height))),
          width: Math.min(1, Math.max(0, (word.bbox.x1 - word.bbox.x0) / Math.max(1, preprocessed.canvas.width))),
          height: Math.min(1, Math.max(0, (word.bbox.y1 - word.bbox.y0) / Math.max(1, preprocessed.canvas.height))),
          coordinateSystem: 'normalized',
        },
        imageDataUrl: /\d/.test(word.text) ? evidenceCrop(preprocessed.canvas, word.bbox) : undefined,
        handwritingStatus,
      },
    }))
  const metadata = extractDrawingMetadata(wordItems.length ? wordItems : [{ text, evidence }], evidence)
  const dimensions = wordItems.length
    ? wordItems.flatMap((item, index) => {
        const wordIndex = wordItems.findIndex((candidate) => candidate === item)
      const nearbyText = wordItems.slice(Math.max(0, wordIndex - 2), Math.min(wordItems.length, wordIndex + 3)).map((candidate) => candidate.text).join(' ')
      return numericTokensFromText(item.text, item.evidence).map((token) => {
        const normalized = normalizeNumericToken({ ...token, context: nearbyText })
        const wordConfidence = ocrWords[wordIndex]?.confidence || 0
        if (wordConfidence > 0 && wordConfidence < 55) normalized.confidence = 'low'
        else if (normalized.confidence === 'high') normalized.confidence = 'medium'
        return toDimensionValue(normalized, index)
      })
    })
    : numericTokensFromText(text, evidence).map((token, index) => {
      const normalized = normalizeNumericToken(token)
      if (normalized.confidence === 'high') normalized.confidence = 'medium'
      return toDimensionValue(normalized, index)
    })
  const warnings: string[] = []
  if (engineWarning) warnings.push(engineWarning)
  if (!text.trim()) warnings.push('OCR에서 텍스트를 읽지 못했습니다. 숫자와 단위가 선명한 원본을 확인하세요.')
  if (handwritingStatus === 'handwriting') {
    warnings.push('손글씨 또는 수기 표기 가능성이 있어 해당 값을 자동 발주 계산에서 제외했습니다.')
  } else if (handwritingStatus === 'uncertain') {
    warnings.push('인쇄·손글씨 구분이 불확실합니다. 높이 숫자는 자동 확정하지 말고 원본을 확인하세요.')
  }
  if (classification.kind === 'cost-summary') {
    warnings.push('공사비 집계표는 비용 분석 자료로만 저장되며 3D 모델·자재 산출에서 제외됩니다.')
  }

  return {
    text,
    ocrConfidence,
    engineWarning,
    page: {
      id: `${fileId}-page-1`,
      pageNumber: 1,
      width: preprocessed.canvas.width,
      height: preprocessed.canvas.height,
      text,
      previewUrl: preprocessed.previewUrl,
      kind: classification.kind,
      kindConfidence: classification.confidence,
      dimensions,
      zones: metadata.zones,
      roomNames: metadata.roomNames,
      axisLabels: metadata.axisLabels,
      scales: metadata.scales,
      unitCandidates: metadata.unitCandidates,
      vectorSegments: [],
      warnings,
      handWritingDetected: handwritingStatus === 'handwriting',
      handwritingStatus,
      processingNotes: preprocessed.processingNotes,
    },
  }
}
