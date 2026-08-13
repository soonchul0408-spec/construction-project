import type {
  AnalyzedFile,
  BuildingGeometry,
  MaterialTakeoff,
  ProjectStatus,
  ProjectWorkflow,
  ConsistencyValidation,
} from '../types/domain'

export interface ProjectWorkflowAssessment {
  status: ProjectStatus
  blockers: string[]
  canIssue: boolean
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function allFilesFinished(files: AnalyzedFile[]) {
  return files.length > 0 && files.every((file) => ['complete', 'warning', 'failed'].includes(file.status))
}

function hasCriticalAnalysisFailure(files: AnalyzedFile[]) {
  const drawingFiles = files.filter((file) => file.kind !== 'cost-summary')
  return drawingFiles.length > 0 && drawingFiles.every((file) => file.status === 'failed')
}

export function assessProjectWorkflow(input: {
  files: AnalyzedFile[]
  workflow: ProjectWorkflow
  model: BuildingGeometry
  takeoffs: MaterialTakeoff[]
  missingItems: string[]
  reviewItems: string[]
  isAnalyzing: boolean
  currentStatus?: ProjectStatus
  consistency?: ConsistencyValidation
}): ProjectWorkflowAssessment {
  const { files, workflow, model, takeoffs, missingItems, reviewItems, isAnalyzing } = input
  if (!files.length) return { status: 'empty', blockers: [], canIssue: false }
  if (hasCriticalAnalysisFailure(files)) {
    return { status: 'failed', blockers: ['처리 가능한 설계도 파일이 없습니다.'], canIssue: false }
  }
  if (isAnalyzing || files.some((file) => file.status === 'analyzing' || file.status === 'queued')) {
    if (files.some((file) => file.stage === 'identifying')) return { status: 'classifying', blockers: [], canIssue: false }
    if (files.some((file) => file.stage === 'classifying')) return { status: 'classifying', blockers: [], canIssue: false }
    if (files.some((file) => file.stage === 'extracting' || file.stage === 'checking-height')) return { status: 'extracting', blockers: [], canIssue: false }
    return { status: 'uploading', blockers: [], canIssue: false }
  }
  if (!allFilesFinished(files)) return { status: 'linking', blockers: [], canIssue: false }

  const blockers = unique([...missingItems, ...reviewItems])
  if (!workflow.reviewConfirmed || reviewItems.length > 0 || blockers.some((item) => /높이|평면도|벽체|입면도|단면도/i.test(item))) {
    return { status: 'needs-review', blockers, canIssue: false }
  }
  if (!workflow.modelBuilt || !model.isReady) {
    return { status: input.currentStatus === 'building-3d' ? 'building-3d' : 'partial', blockers: unique([...blockers, model.blockedReason]), canIssue: false }
  }
  if (model.partial) {
    return { status: 'partial', blockers: unique([...blockers, model.blockedReason]), canIssue: false }
  }
  if (!workflow.takeoffCalculated || !takeoffs.length) {
    return { status: input.currentStatus === 'calculating' ? 'calculating' : 'partial', blockers: unique([...blockers, '벽체별 자재 계산이 아직 실행되지 않았습니다.']), canIssue: false }
  }
  const takeoffBlockers = takeoffs
    .filter((row) => row.reviewStatus !== '확정')
    .map((row) => `${row.zone} ${row.wallNumber}: ${row.reviewStatus}`)
  const allBlockers = unique([...blockers, ...takeoffBlockers])
  if (input.consistency && !input.consistency.canFinalize) {
    return { status: 'partial', blockers: unique([...allBlockers, ...input.consistency.blockingReasons]), canIssue: false }
  }
  if (allBlockers.length) return { status: 'partial', blockers: allBlockers, canIssue: false }
  return { status: 'completed', blockers: [], canIssue: true }
}

export function statusForAnalysisStage(stage: AnalyzedFile['stage']): ProjectStatus {
  if (stage === 'uploading') return 'uploading'
  if (stage === 'identifying' || stage === 'classifying') return 'classifying'
  if (stage === 'extracting' || stage === 'checking-height') return 'extracting'
  return 'linking'
}
