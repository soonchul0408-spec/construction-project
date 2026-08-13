import { emptyInventoryCuttingState, emptyOptimizationState, PROJECT_STATUS_DESCRIPTIONS } from '../types/domain'
import { emptyHeightDiagnostics } from './height-diagnostics'
import { emptyConsistencyValidation } from './consistency-validator'
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
    optimizationCalculated: Boolean(project.workflow?.optimizationCalculated || project.optimization?.scenarios?.length),
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
      ? { ...emptyConsistencyValidation(), ...project.consistencyValidation, tolerances: { ...emptyConsistencyValidation().tolerances, ...(project.consistencyValidation.tolerances || {}) } }
      : emptyConsistencyValidation(),
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
                  ...(project.optimization.inventory.settings || {}),
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

export function saveProject(project: ProjectState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, restoredFromStorage: false }))
  } catch (error) {
    // Large multi-page scans can exceed browser quota. Preserve the structured
    // analysis and evidence even when thumbnails have to be omitted.
    try {
      const compact = {
        ...project,
        files: project.files.map((file) => ({
          ...file,
          previewUrl: '',
          pages: file.pages.map((page) => ({ ...page, previewUrl: '' })),
        })),
        restoredFromStorage: false,
      }
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
