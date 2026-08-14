import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

import { classifyDocument, classifyTextOrigin } from './document-classifier'
import { normalizeNumericToken, numericTokensFromText, toDimensionValue } from './dimension-normalizer'
import { extractDrawingMetadata } from './drawing-metadata-extractor'
import { recognizeCanvas, type RecognizedWord } from './ocr-analyzer'
import type { DrawingPage, Evidence, VectorSegment } from '../types/domain'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

interface PdfTextItem {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

export interface PdfExtractionResult {
  pages: DrawingPage[]
  text: string
}

function pageTextItems(items: unknown[]) {
  return items.filter((item): item is PdfTextItem => {
    return Boolean(item && typeof item === 'object' && 'str' in item)
  })
}

function itemLocation(item: PdfTextItem, pageWidth: number, pageHeight: number) {
  const transform = item.transform || []
  const x = Number(transform[4] || 0)
  const baselineY = Number(transform[5] || 0)
  const width = Math.max(Number(item.width || 0), 8)
  const height = Math.max(Math.abs(Number(transform[3] || item.height || 10)), 10)
  return {
    x: Math.min(1, Math.max(0, x / pageWidth)),
    y: Math.min(1, Math.max(0, 1 - ((baselineY + height) / pageHeight))),
    width: Math.min(1, width / pageWidth),
    height: Math.min(1, height / pageHeight),
    coordinateSystem: 'normalized' as const,
  }
}

type PdfPoint = { x: number; y: number }
type PdfMatrix = [number, number, number, number, number, number]

function numberArray(value: unknown) {
  if (Array.isArray(value)) return value.map(Number)
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>, Number)
  return []
}

function multiplyMatrix(left: PdfMatrix, right: PdfMatrix): PdfMatrix {
  const [a, b, c, d, e, f] = left
  const [g, h, i, j, k, l] = right
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ]
}

function transformPoint(matrix: PdfMatrix, point: PdfPoint): PdfPoint {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  }
}

export function extractPdfVectorSegments(
  operatorList: { fnArray?: number[]; argsArray?: unknown[][] },
  pageWidth: number,
  pageHeight: number,
  fileId: string,
  fileName: string,
  pageNumber: number,
  drawingKind: DrawingPage['kind'],
): VectorSegment[] {
  const fnArray = operatorList.fnArray || []
  const argsArray = operatorList.argsArray || []
  const identity: PdfMatrix = [1, 0, 0, 1, 0, 0]
  let matrix: PdfMatrix = identity
  let current: PdfPoint | null = null
  let pathStart: PdfPoint | null = null
  const stack: PdfMatrix[] = []
  const rawSegments: Array<{ start: PdfPoint; end: PdfPoint }> = []
  const opCodes = pdfjsLib.OPS

  const addSegment = (start: PdfPoint | null, end: PdfPoint | null) => {
    if (!start || !end) return
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (!Number.isFinite(length) || length < 4 || length > Math.max(pageWidth, pageHeight) * 1.6) return
    rawSegments.push({ start, end })
  }

  const moveTo = (x: unknown, y: unknown) => {
    const point = transformPoint(matrix, { x: Number(x), y: Number(y) })
    current = point
    pathStart = point
  }

  const lineTo = (x: unknown, y: unknown) => {
    const point = transformPoint(matrix, { x: Number(x), y: Number(y) })
    addSegment(current, point)
    current = point
  }

  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index]
    const args = argsArray[index] || []
    if (fn === opCodes.save) {
      stack.push([...matrix])
    } else if (fn === opCodes.restore) {
      matrix = stack.pop() || identity
    } else if (fn === opCodes.transform) {
      const next = args as number[]
      if (next.length >= 6) matrix = multiplyMatrix(matrix, [next[0] || 0, next[1] || 0, next[2] || 0, next[3] || 0, next[4] || 0, next[5] || 0])
    } else if (fn === opCodes.moveTo) {
      moveTo(args[0], args[1])
    } else if (fn === opCodes.lineTo) {
      lineTo(args[0], args[1])
    } else if (fn === opCodes.curveTo || fn === opCodes.curveTo2 || fn === opCodes.curveTo3) {
      const lastX = fn === opCodes.curveTo ? args[4] : args[2]
      const lastY = fn === opCodes.curveTo ? args[5] : args[3]
      lineTo(lastX, lastY)
    } else if (fn === opCodes.closePath) {
      addSegment(current, pathStart)
      current = pathStart
    } else if (fn === opCodes.rectangle) {
      const x = Number(args[0] || 0)
      const y = Number(args[1] || 0)
      const width = Number(args[2] || 0)
      const height = Number(args[3] || 0)
      const points = [
        transformPoint(matrix, { x, y }),
        transformPoint(matrix, { x: x + width, y }),
        transformPoint(matrix, { x: x + width, y: y + height }),
        transformPoint(matrix, { x, y: y + height }),
      ]
      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) addSegment(points[pointIndex], points[(pointIndex + 1) % points.length])
      current = points[3] || null
      pathStart = points[0] || null
    } else if (fn === opCodes.constructPath) {
      const pathOps = numberArray(args[0])
      const coordinates = numberArray(args[1])
      let coordinateIndex = 0
      for (const pathOp of pathOps) {
        if (pathOp === opCodes.moveTo) {
          moveTo(coordinates[coordinateIndex], coordinates[coordinateIndex + 1])
          coordinateIndex += 2
        } else if (pathOp === opCodes.lineTo) {
          lineTo(coordinates[coordinateIndex], coordinates[coordinateIndex + 1])
          coordinateIndex += 2
        } else if (pathOp === opCodes.curveTo) {
          lineTo(coordinates[coordinateIndex + 4], coordinates[coordinateIndex + 5])
          coordinateIndex += 6
        } else if (pathOp === opCodes.curveTo2 || pathOp === opCodes.curveTo3) {
          lineTo(coordinates[coordinateIndex + 2], coordinates[coordinateIndex + 3])
          coordinateIndex += 4
        } else if (pathOp === opCodes.rectangle) {
          const x = Number(coordinates[coordinateIndex] || 0)
          const y = Number(coordinates[coordinateIndex + 1] || 0)
          const width = Number(coordinates[coordinateIndex + 2] || 0)
          const height = Number(coordinates[coordinateIndex + 3] || 0)
          const points = [
            transformPoint(matrix, { x, y }),
            transformPoint(matrix, { x: x + width, y }),
            transformPoint(matrix, { x: x + width, y: y + height }),
            transformPoint(matrix, { x, y: y + height }),
          ]
          for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) addSegment(points[pointIndex], points[(pointIndex + 1) % points.length])
          current = points[3] || null
          pathStart = points[0] || null
          coordinateIndex += 4
        } else if (pathOp === opCodes.closePath) {
          addSegment(current, pathStart)
          current = pathStart
        }
      }
    }
  }

  const seen = new Set<string>()
  return rawSegments.map((segment, index) => {
    const start = segment.start
    const end = segment.end
    const forward = `${Math.round(start.x * 10)}:${Math.round(start.y * 10)}:${Math.round(end.x * 10)}:${Math.round(end.y * 10)}`
    const reverse = `${Math.round(end.x * 10)}:${Math.round(end.y * 10)}:${Math.round(start.x * 10)}:${Math.round(start.y * 10)}`
    const key = forward < reverse ? forward : reverse
    if (seen.has(key)) return null
    seen.add(key)
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    const evidence: Evidence = {
      fileId,
      fileName,
      pageNumber,
      drawingKind,
      method: 'vector',
      rawText: 'PDF vector path',
      location: {
        x: Math.min(1, Math.max(0, minX / pageWidth)),
        y: Math.min(1, Math.max(0, 1 - maxY / pageHeight)),
        width: Math.min(1, Math.max(0, (maxX - minX) / pageWidth)),
        height: Math.min(1, Math.max(0, (maxY - minY) / pageHeight)),
        coordinateSystem: 'normalized',
      },
    }
    return {
      id: `vector-${fileId}-${pageNumber}-${index}`,
      start,
      end,
      lengthPageUnits: Math.hypot(end.x - start.x, end.y - start.y),
      sourcePosition: {
        x: evidence.location?.x || 0,
        y: evidence.location?.y || 0,
        width: evidence.location?.width || 0,
        height: evidence.location?.height || 0,
      },
      confidence: 'high',
      sourceType: 'vector' as const,
      evidence: [evidence],
    }
  }).filter((segment): segment is VectorSegment => Boolean(segment)).slice(0, 2000)
}

async function renderPage(page: any) {
  const unscaled = page.getViewport({ scale: 1 })
  const scale = Math.min(1.6, Math.max(0.9, 1400 / unscaled.width))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('도면 미리보기 캔버스를 만들지 못했습니다.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport }).promise
  return { canvas, previewUrl: canvas.toDataURL('image/jpeg', 0.86), width: unscaled.width, height: unscaled.height }
}

export async function extractPdfDocument(
  file: File,
  fileId: string,
  onProgress?: (progress: number) => void,
): Promise<PdfExtractionResult> {
  const buffer = await file.arrayBuffer()
  const documentTask = pdfjsLib.getDocument({ data: buffer })
  const pdf = await documentTask.promise
  const pages: DrawingPage[] = []
  const allText: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const [content, rendered, operatorList] = await Promise.all([
      page.getTextContent(),
      renderPage(page),
      page.getOperatorList().catch(() => ({ fnArray: [], argsArray: [] })),
    ])
    const items = pageTextItems(content.items as unknown[])
    // Keep PDF text-item line boundaries. They are useful for cost-table row
    // parsing and make nearby dimension evidence less ambiguous, while the
    // classifier still normalizes whitespace internally.
    let text = items.map((item) => item.str || '').join('\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
    let ocrConfidence = 0
    let usedOcr = false
    let ocrAttempted = false
    let ocrUnavailable = false
    let ocrWords: RecognizedWord[] = []
    if (!text) {
      ocrAttempted = true
      try {
        const ocrResult = await recognizeCanvas(rendered.canvas, (progress) => onProgress?.(Math.min(96, Math.round((pageNumber - 1) / pdf.numPages * 100 + progress / pdf.numPages))))
        text = ocrResult.text.replace(/\s+/g, ' ').trim()
        ocrConfidence = ocrResult.confidence
        ocrWords = ocrResult.words
        usedOcr = Boolean(text)
      } catch (error) {
        ocrUnavailable = true
        console.warn('스캔 PDF OCR을 건너뜁니다.', error)
      }
    }
    allText.push(text)
    const classification = classifyDocument(text, file.name)
    const handwritingStatus = classifyTextOrigin(text, ocrConfidence)
    const vectorSegments = extractPdfVectorSegments(operatorList, rendered.width, rendered.height, fileId, file.name, pageNumber, classification.kind)
    const pageEvidence = (rawText: string, location: Evidence['location'], method: Evidence['method']): Evidence => ({
      fileId,
      fileName: file.name,
      pageNumber,
      drawingKind: classification.kind,
      location,
      method,
      rawText,
      handwritingStatus,
    })
    const pdfEvidenceItems = items.map((item) => {
      const raw = item.str || ''
      return {
        text: raw,
        evidence: pageEvidence(raw, itemLocation(item, rendered.width, rendered.height), 'pdf-text'),
      }
    })
    const ocrEvidenceItems = ocrWords.filter((word) => word.text.trim()).map((word) => ({
      text: word.text,
      evidence: pageEvidence(word.text, {
        x: Math.min(1, Math.max(0, word.bbox.x0 / Math.max(1, rendered.canvas.width))),
        y: Math.min(1, Math.max(0, word.bbox.y0 / Math.max(1, rendered.canvas.height))),
        width: Math.min(1, Math.max(0, (word.bbox.x1 - word.bbox.x0) / Math.max(1, rendered.canvas.width))),
        height: Math.min(1, Math.max(0, (word.bbox.y1 - word.bbox.y0) / Math.max(1, rendered.canvas.height))),
        coordinateSystem: 'normalized',
      }, 'ocr'),
    }))
    const ocrEvidence = pageEvidence(text.slice(0, 500), {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      coordinateSystem: 'normalized',
    }, 'ocr')
    const metadata = extractDrawingMetadata(
      usedOcr && ocrEvidenceItems.length ? ocrEvidenceItems : usedOcr ? [{ text, evidence: ocrEvidence }] : pdfEvidenceItems,
      ocrEvidence,
    )
    let dimensionIndex = 0
    const dimensions = usedOcr
      ? (ocrEvidenceItems.length ? ocrEvidenceItems : [{ text, evidence: ocrEvidence }]).flatMap((item, index, evidenceItems) => {
        const nearbyText = evidenceItems.slice(Math.max(0, index - 1), Math.min(evidenceItems.length, index + 1)).map((candidate) => candidate.text).join(' ')
        return numericTokensFromText(item.text, item.evidence).map((token) => {
          const normalized = normalizeNumericToken({ ...token, context: nearbyText })
          const ocrWord = ocrWords[index]
          if (ocrWord?.confidence > 0 && ocrWord.confidence < 55) normalized.confidence = 'low'
          else if (normalized.confidence === 'high') normalized.confidence = 'medium'
          return toDimensionValue(normalized, dimensionIndex++)
        })
      })
      : pdfEvidenceItems.flatMap((item, index) => {
        const raw = item.text
        if (!raw.trim()) return []
      const nearbyText = items.slice(Math.max(0, index - 1), Math.min(items.length, index + 1))
        .map((nearbyItem) => nearbyItem.str || '')
        .join(' ')
      return numericTokensFromText(raw, {
        ...item.evidence,
        note: nearbyText.length > raw.length ? `치수선 주변 텍스트: ${nearbyText.slice(0, 180)}` : undefined,
      }).map((token) => toDimensionValue(normalizeNumericToken({ ...token, context: nearbyText }), dimensionIndex++))
      })

    const warnings: string[] = []
    if (ocrUnavailable) warnings.push('OCR 기능이 현재 환경에서 실행되지 않았습니다. 원본 이미지의 숫자를 자동 확정하지 않았습니다.')
    else if (ocrAttempted && !text) warnings.push('OCR이 실행됐지만 텍스트와 숫자를 읽지 못했습니다. 원본 이미지와 해상도를 확인하세요.')
    if (usedOcr) {
      warnings.push('살아있는 텍스트가 없어 페이지 이미지를 로컬 OCR로 읽었습니다. 숫자를 검토하세요.')
      if (handwritingStatus === 'handwriting') warnings.push('손글씨 또는 수기 표기 가능성이 있어 해당 높이를 자동 발주 계산에서 제외했습니다.')
      if (handwritingStatus === 'uncertain') warnings.push('인쇄·손글씨 구분이 불확실합니다. OCR 높이를 자동 확정하지 말고 원본을 확인하세요.')
    }
    if (classification.kind === 'cost-summary') {
      warnings.push('공사비 집계표는 비용 분석 자료로만 저장되며 3D 모델·자재 산출에서 제외됩니다.')
    }
    pages.push({
      id: `${fileId}-page-${pageNumber}`,
      pageNumber,
      width: rendered.width,
      height: rendered.height,
      text,
      previewUrl: rendered.previewUrl,
      kind: classification.kind,
      kindConfidence: classification.confidence,
      dimensions,
      zones: metadata.zones,
      roomNames: metadata.roomNames,
      axisLabels: metadata.axisLabels,
      scales: metadata.scales,
      unitCandidates: metadata.unitCandidates,
      vectorSegments,
      warnings,
      handWritingDetected: handwritingStatus === 'handwriting',
      handwritingStatus,
      processingNotes: usedOcr
        ? ['PDF 텍스트가 없어 페이지 이미지 OCR을 실행했습니다.']
        : ocrUnavailable
          ? ['PDF 텍스트가 없고 OCR 기능을 실행할 수 없었습니다.']
          : ocrAttempted
            ? ['PDF 텍스트가 없고 OCR에서 읽을 수 있는 문자가 없었습니다.']
            : ['PDF 살아있는 텍스트와 벡터 정보를 사용했습니다.'],
    })
    onProgress?.(Math.round((pageNumber / pdf.numPages) * 100))
  }

  return { pages, text: allText.join('\n') }
}
