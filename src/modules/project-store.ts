import { emptyInventoryCuttingState, emptyOptimizationState, PROJECT_STATUS_DESCRIPTIONS } from '../types/domain'
import { emptyHeightDiagnostics } from './height-diagnostics'
import { emptyConsistencyValidation } from './consistency-validator'
import { isCostSummaryPage, maskSensitiveCostText } from './cost-summary-parser.ts'
import type { AnalysisStage, DimensionValue, ProjectState, ProjectStatus, ProjectWorkflow } from '../types/domain'

const STORAGE_KEY = 'drawing-material-calculator:project:v1'

function stageForStatus(status: string): AnalysisStage {
  if (status === 'complete') return 'complete'
  if (status === 'warning') return 'needs-review'
  if (status === 'failed') return 'failed'
  return 'uploading'
}

function migrateDimension(dimension: Partial<DimensionValue>): DimensionValue {
  const evidence = dimension.evidence?.[0]
  const unit = dimension.unit === 'cm' || dimension.unit === 'm' ? dimension.unit : 'mm'
  const valueMm = dimension.normalizedValueMm ?? dimension.valueMm ?? null
  return {
    ...dimension,
    id: dimension.id || `restored-dimension-${Math.random()}`,
    label: dimension.label || '추출 치수',
    value: dimension.value ?? valueMm,
    unit,
    normalizedValueMm: valueMm,
    sourceFile: dimension.sourceFile || evidence?.fileName || '',
    pageNumber: dimension.pageNumber || evidence?.pageNumber || 1,
    drawingType: dimension.drawingType || evidence?.drawingKind || 'unknown',
    sourceText: dimension.sourceText || dimension.displayValue || '',
    sourcePosition: dimension.sourcePosition || {
      x: evidence?.location?.x || 0,
      y: evidence?.location?.y || 0,
      width: evidence?.location?.width || 0,
      height: evidence?.location?.height || 0,
    },
    sourceType: dimension.sourceType || (evidence?.method === 'ocr' ? 'ocr' : 'pdf-text'),
    valueMm,
    displayValue: dimension.displayValue || String(dimension.value ?? valueMm ?? ''),
    confidence: dimension.confidence || 'low',
    source: dimension.source || 'extracted',
    evidence: dimension.evidence || [],
    context: dimension.context || '',
    userEdited: Boolean(dimension.userEdited),
    originalValueMm: dimension.originalValueMm ?? (dimension.userEdited ? null : valueMm),
    userValueMm: dimension.userValueMm ?? (dimension.userEdited ? valueMm : null),
  }
}

function migrateModel(model: ProjectState['model'] | undefined): ProjectState['model'] {
  const roof = model?.roof || {
    isReady: false,
    kind: 'unknown' as const,
    heightMm: null,
    pitchDeg: null,
    evidence: [],
    blockedReason: '지붕 정보가 있는 입면도·단면도·지붕 상세도를 확인하지 못했습니다.',
  }
  return {
    walls: (model?.walls || []).map((wall) => ({
      ...wall,
      zoneName: wall.zoneName || wall.zone,
      wallNumber: wall.wallNumber || wall.number,
      lengthMm: wall.lengthMm ?? Math.hypot((wall.end.x - wall.start.x) * 1000, (wall.end.z - wall.start.z) * 1000),
      thicknessMm: wall.thicknessMm || 75,
      confidence: wall.confidence || 'medium',
      sourceReferences: wall.sourceReferences || [],
      geometrySource: wall.geometrySource || 'dimension-layout',
    })),
    footprint: model?.footprint || [],
    roof,
    isReady: Boolean(model?.isReady),
    blockedReason: model?.blockedReason || '도면 파일을 올리면 geometry를 생성합니다.',
  }
}

function migrateProject(project: ProjectState): ProjectState {
  const workflow: ProjectWorkflow = {
    reviewConfirmed: Boolean(project.workflow?.reviewConfirmed),
    modelBuilt: Boolean(project.workflow?.modelBuilt || project.model?.isReady),
    takeoffCalculated: Boolean(project.workflow?.takeoffCalculated || project.takeoffs?.length),
    optimizationCalculated: Boolean(project.workflow?.optimizationCalculated && project.optimization?.sourceFingerprint),
  }
  const status: ProjectStatus = project.status || (workflow.takeoffCalculated ? 'partial' : project.files?.length ? 'needs-review' : 'empty')
  return {
    ...project,
    status,
    statusMessage: project.statusMessage || PROJECT_STATUS_DESCRIPTIONS[status],
    workflow,
    dimensions: (project.dimensions || []).map(migrateDimension),
    heightCandidates: project.heightCandidates || [],
    walls: (project.walls || []).map((wall) => ({
      ...wall,
      zoneName: wall.zoneName || wall.zone,
      wallNumber: wall.wallNumber || wall.number,
      sourceReferences: wall.sourceReferences || wall.evidence || [],
      geometrySource: wall.geometrySource || 'dimension-layout',
      conflicts: wall.conflicts || [],
    })),
    model: migrateModel(project.model),
    heightDiagnostics: project.heightDiagnostics
      ? { ...emptyHeightDiagnostics(), ...project.heightDiagnostics, stages: project.heightDiagnostics.stages || [], entries: project.heightDiagnostics.entries || [] }
      : emptyHeightDiagnostics(),
    consistencyValidation: project.consistencyValidation
      ? { ...emptyConsistencyValidation(), ...project.consistencyValidation, tolerances: { ...emptyConsistencyValidation().tolerances, ...project.consistencyValidation.tolerances } }
      : emptyConsistencyValidation(),
    manualReview: project.manualReview
      ? {
          storage: 'project-localStorage',
          migratedAt: project.manualReview.migratedAt || null,
          legacyReadAt: project.manualReview.legacyReadAt || null,
          drawings: project.manualReview.drawings || [],
        }
      : { storage: 'project-localStorage', migratedAt: null, legacyReadAt: null, drawings: [] },
    optimization: project.optimization
      ? {
          ...emptyOptimizationState(),
          ...project.optimization,
          catalog: project.optimization.catalog || [],
          members: project.optimization.members || [],
          reviews: project.optimization.reviews || [],
          scenarios: (project.optimization.scenarios || []).map((scenario) => ({
            ...scenario,
            stockLengthComparison: scenario.stockLengthComparison || [],
          })),
          scraps: (project.optimization.scraps || []).map((scrap) => ({
            ...scrap,
            xMm: scrap.xMm ?? null,
            yMm: scrap.yMm ?? null,
          })),
          inventory: project.optimization.inventory
            ? {
                ...emptyInventoryCuttingState(),
                ...project.optimization.inventory,
                settings: {
                  ...emptyInventoryCuttingState().settings,
                  ...project.optimization.inventory.settings,
                },
                requirements: (project.optimization.inventory.requirements || []).map((requirement) => ({
                  ...requirement,
                  sourceReferences: requirement.sourceReferences || [],
                  missingFields: requirement.missingFields || [],
                  notes: requirement.notes || [],
                })),
                ownedMaterials: (project.optimization.inventory.ownedMaterials || []).map((stock) => ({
                  ...stock,
                  reservedQuantity: stock.reservedQuantity || 0,
                  surfaceFinish: stock.surfaceFinish || '',
                  color: stock.color || '',
                })),
              }
            : emptyInventoryCuttingState(),
        }
      : emptyOptimizationState(),
    files: (project.files || []).map((file) => ({
      ...file,
      stage: file.stage || stageForStatus(file.status),
      pages: (file.pages || []).map((page) => ({
        ...page,
        dimensions: (page.dimensions || []).map(migrateDimension),
        zones: page.zones || [],
        roomNames: page.roomNames || [],
        axisLabels: page.axisLabels || [],
        scales: page.scales || [],
        unitCandidates: page.unitCandidates || [],
        vectorSegments: page.vectorSegments || [],
      })),
    })),
  }
}

export function projectForStorage(project: ProjectState, compact = false) {
  const costPageKeys = new Set(project.files.flatMap((file) => file.pages
    .filter((page) => isCostSummaryPage(file, page))
    .map((page) => `${file.id}:${page.pageNumber}`)))
  const costSourcePageKeys = new Set(project.files.flatMap((file) => file.pages
    .filter((page) => isCostSummaryPage(file, page))
    .map((page) => `${file.name}:${page.pageNumber}`)))
  const costFileNames = new Set(project.files.filter((file) => file.pages.some((page) => isCostSummaryPage(file, page))).map((file) => file.name))
  const maskKnownFileNames = (value: string) => [...costFileNames].reduce(
    (masked, fileName) => masked.replaceAll(fileName, maskSensitiveCostText(fileName)),
    value,
  )
  const sanitizeStoredValue = <T>(value: T): T => {
    if (typeof value === 'string') return maskKnownFileNames(value) as T
    if (Array.isArray(value)) return value.map((item) => sanitizeStoredValue(item)) as T
    if (!value || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    const costEvidence = typeof record.fileId === 'string' && typeof record.pageNumber === 'number'
      && (record.drawingKind === 'cost-summary' || costPageKeys.has(`${record.fileId}:${record.pageNumber}`))
    const sanitized: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) {
      if (key === 'imageDataUrl' && (compact || costEvidence)) continue
      if (costEvidence && typeof item === 'string' && ['rawText', 'note', 'fileName'].includes(key)) {
        sanitized[key] = maskSensitiveCostText(maskKnownFileNames(item))
      } else {
        sanitized[key] = sanitizeStoredValue(item)
      }
    }
    return sanitized as T
  }
  const scrubDimension = (dimension: DimensionValue, force = false) => {
    const costDimension = force || costSourcePageKeys.has(`${dimension.sourceFile}:${dimension.pageNumber}`) || dimension.evidence.some((evidence) => costPageKeys.has(`${evidence.fileId}:${evidence.pageNumber}`) || evidence.drawingKind === 'cost-summary')
    const sourceFileNeedsMasking = costFileNames.has(dimension.sourceFile)
    if (!costDimension && !sourceFileNeedsMasking && !compact) return dimension
    return {
      ...dimension,
      sourceFile: sourceFileNeedsMasking ? maskSensitiveCostText(dimension.sourceFile) : dimension.sourceFile,
      label: costDimension ? maskSensitiveCostText(dimension.label) : dimension.label,
      sourceText: costDimension ? maskSensitiveCostText(dimension.sourceText) : dimension.sourceText,
      displayValue: costDimension ? maskSensitiveCostText(dimension.displayValue) : dimension.displayValue,
      context: costDimension ? maskSensitiveCostText(dimension.context) : dimension.context,
      calculation: costDimension && dimension.calculation ? maskSensitiveCostText(dimension.calculation) : dimension.calculation,
      referencePlane: costDimension && dimension.referencePlane ? maskSensitiveCostText(dimension.referencePlane) : dimension.referencePlane,
      levelDatum: dimension.levelDatum
        ? {
            ...dimension.levelDatum,
            marker: costDimension ? maskSensitiveCostText(dimension.levelDatum.marker) : dimension.levelDatum.marker,
            referencePlane: costDimension && dimension.levelDatum.referencePlane ? maskSensitiveCostText(dimension.levelDatum.referencePlane) : dimension.levelDatum.referencePlane,
          }
        : dimension.levelDatum,
      evidence: dimension.evidence.map((evidence) => ({
        ...evidence,
        fileName: costDimension || costFileNames.has(evidence.fileName) ? maskSensitiveCostText(evidence.fileName) : evidence.fileName,
        rawText: costDimension && evidence.rawText ? maskSensitiveCostText(evidence.rawText) : evidence.rawText,
        note: costDimension && evidence.note ? maskSensitiveCostText(evidence.note) : evidence.note,
        imageDataUrl: costDimension || compact ? undefined : evidence.imageDataUrl,
      })),
    }
  }
  const scrubHeightCandidate = (candidate: ProjectState['heightCandidates'][number]) => {
    const costCandidate = candidate.pageNumber !== null && costSourcePageKeys.has(`${candidate.sourceFileName}:${candidate.pageNumber}`)
    const sourceFileNeedsMasking = costFileNames.has(candidate.sourceFileName)
    if (!costCandidate && !sourceFileNeedsMasking && !compact) return candidate
    return {
      ...candidate,
      sourceFileName: sourceFileNeedsMasking ? maskSensitiveCostText(candidate.sourceFileName) : candidate.sourceFileName,
      originalText: costCandidate ? maskSensitiveCostText(candidate.originalText) : candidate.originalText,
      nearbyLabel: costCandidate ? maskSensitiveCostText(candidate.nearbyLabel) : candidate.nearbyLabel,
      evidenceText: costCandidate ? maskSensitiveCostText(candidate.evidenceText) : candidate.evidenceText,
      evidenceImage: costCandidate || compact ? null : candidate.evidenceImage,
    }
  }
  const storageProject = {
    ...project,
    dimensions: project.dimensions.map((dimension) => scrubDimension(dimension)),
    heightCandidates: project.heightCandidates.map(scrubHeightCandidate),
    heightDiagnostics: {
      ...project.heightDiagnostics,
      candidates: project.heightDiagnostics.candidates.map(scrubHeightCandidate),
      entries: project.heightDiagnostics.entries.map((entry) => costSourcePageKeys.has(`${entry.sourceFile}:${entry.pageNumber}`) || compact
        ? {
            ...entry,
            sourceFile: costFileNames.has(entry.sourceFile) ? maskSensitiveCostText(entry.sourceFile) : entry.sourceFile,
            displayValue: costSourcePageKeys.has(`${entry.sourceFile}:${entry.pageNumber}`) ? maskSensitiveCostText(entry.displayValue) : entry.displayValue,
            evidenceText: costSourcePageKeys.has(`${entry.sourceFile}:${entry.pageNumber}`) ? maskSensitiveCostText(entry.evidenceText) : entry.evidenceText,
            originalText: costSourcePageKeys.has(`${entry.sourceFile}:${entry.pageNumber}`) && entry.originalText ? maskSensitiveCostText(entry.originalText) : entry.originalText,
            evidenceImage: null,
          }
        : entry),
    },
    costSummary: {
      ...project.costSummary,
      rows: project.costSummary.rows.map((row) => ({
        ...row,
        vendor: '[업체명 비식별화]',
        item: maskSensitiveCostText(row.item),
        evidence: row.evidence.map((evidence) => ({
          ...evidence,
          fileName: maskSensitiveCostText(evidence.fileName),
          rawText: evidence.rawText ? maskSensitiveCostText(evidence.rawText) : evidence.rawText,
          imageDataUrl: undefined,
        })),
      })),
    },
    files: project.files.map((file) => ({
      ...file,
      name: costFileNames.has(file.name) ? maskSensitiveCostText(file.name) : file.name,
      previewUrl: compact || (file.pages[0] ? isCostSummaryPage(file, file.pages[0]) : file.kind === 'cost-summary') ? '' : file.previewUrl,
      pages: file.pages.map((page) => {
        const costPage = isCostSummaryPage(file, page)
        return {
          ...page,
          text: costPage ? maskSensitiveCostText(page.text) : page.text,
          previewUrl: compact || costPage ? '' : page.previewUrl,
          dimensions: page.dimensions.map((dimension) => scrubDimension(dimension, costPage)),
          zones: costPage ? [] : page.zones,
          roomNames: costPage ? [] : page.roomNames,
          axisLabels: costPage ? [] : page.axisLabels,
          scales: costPage ? [] : page.scales,
          vectorSegments: costPage ? [] : page.vectorSegments,
          processingNotes: costPage ? [] : page.processingNotes,
        }
      }),
    })),
    restoredFromStorage: false,
  }
  return sanitizeStoredValue(storageProject)
}

export function saveProject(project: ProjectState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projectForStorage(project)))
  } catch (error) {
    // Large multi-page scans can exceed browser quota. Preserve the structured
    // analysis and evidence even when thumbnails have to be omitted.
    try {
      const compact = projectForStorage(project, true)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compact))
    } catch (compactError) {
      console.warn('분석 결과를 로컬 저장소에 저장하지 못했습니다.', error, compactError)
    }
  }
}

export function loadProject(): ProjectState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as ProjectState
    if (!parsed || !Array.isArray(parsed.files) || !Array.isArray(parsed.walls)) return null
    return { ...migrateProject(parsed), restoredFromStorage: true }
  } catch (error) {
    console.warn('저장된 프로젝트를 복원하지 못했습니다.', error)
    return null
  }
}

export function clearProject() {
  localStorage.removeItem(STORAGE_KEY)
}
