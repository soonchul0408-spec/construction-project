export type DrawingKind =
  | 'floor-plan'
  | 'elevation'
  | 'section'
  | 'detail'
  | 'structural'
  | 'material-schedule'
  | 'cost-summary'
  | 'unknown'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export type ConsistencyStatus = '검증 완료' | '일부 검증 완료' | '확인 필요' | '계산 불가' | '분석 실패' | '테스트 데이터'

export type ConsistencyComparisonResult = '일치' | '허용 오차' | '표시 반올림 차이' | '계산 불일치' | '값 없음' | '사용자 확인값'

export interface ConsistencyComparison {
  id: string
  label: string
  originalValue: number | null
  currentValue: number | null
  difference: number | null
  unit: 'mm' | '㎡' | '개' | '원'
  result: ConsistencyComparisonResult
  formula: string
  note: string
  sourceReferences: Evidence[]
}

export interface ConsistencyIssue {
  id: string
  category: 'source' | 'dimension' | 'height' | 'model' | 'takeoff' | 'opening' | 'duplicate' | 'cutting' | 'catalog' | 'test-data' | 'analysis'
  severity: 'blocking' | 'warning'
  status: Exclude<ConsistencyStatus, '검증 완료' | '일부 검증 완료' | '테스트 데이터'>
  message: string
  action: string
  wallId?: string
  zone?: string
  wallNumber?: string
  sourceReferences: Evidence[]
  originalValue?: number | null
  currentValue?: number | null
  unit?: 'mm' | '㎡' | '개' | '원'
  formula?: string
}

export interface WallConsistencyResult {
  wallId: string
  zone: string
  wallNumber: string
  status: ConsistencyStatus
  sourceLengthMm: number | null
  wallLengthMm: number | null
  modelLengthMm: number | null
  takeoffLengthMm: number | null
  sourceHeightMm: number | null
  approvedHeightMm: number | null
  modelHeightMm: number | null
  takeoffHeightMm: number | null
  comparisons: ConsistencyComparison[]
  issues: ConsistencyIssue[]
}

export interface TakeoffConsistencyResult {
  wallId: string
  zone: string
  wallNumber: string
  status: ConsistencyStatus
  netAreaM2: number | null
  openingAreaM2: number | null
  panelsWithWaste: number | null
  comparisons: ConsistencyComparison[]
  issues: ConsistencyIssue[]
}

export interface ZoneConsistencyResult {
  zone: string
  status: ConsistencyStatus
  wallIds: string[]
  netAreaM2: number
  panelsWithWaste: number
  issues: ConsistencyIssue[]
}

export interface CuttingMemberConsistencyResult {
  memberId: string
  status: ConsistencyStatus
  issues: ConsistencyIssue[]
}

export interface CuttingConsistencyResult {
  status: ConsistencyStatus
  selectedScenarioId: string | null
  memberResults: CuttingMemberConsistencyResult[]
  issues: ConsistencyIssue[]
  assignedMemberCount: number
  requiredMemberCount: number
  unplacedMemberIds: string[]
}

export type ConsistencyStageId = 'drawing' | 'walls' | 'model' | 'takeoff' | 'cutting'

export interface ConsistencyStageResult {
  id: ConsistencyStageId
  label: string
  status: ConsistencyStatus
  message: string
  issueCount: number
}

export interface ConsistencyValidation {
  status: ConsistencyStatus
  canFinalize: boolean
  actualData: boolean
  testData: boolean
  checkedAt: string
  tolerances: {
    normalizedMm: number
    displayRoundingMm: number
    areaM2: number
  }
  stages: ConsistencyStageResult[]
  issues: ConsistencyIssue[]
  wallResults: WallConsistencyResult[]
  takeoffResults: TakeoffConsistencyResult[]
  zoneResults: ZoneConsistencyResult[]
  cutting: CuttingConsistencyResult
  blockingReasons: string[]
  totals: {
    approvedWallCount: number
    modelWallCount: number
    takeoffWallCount: number
    netAreaM2: number
    panelsWithWaste: number
    fasteners: number
    sealantCartridges: number
    cornerPieces: number
    finishPieces: number
  }
}

export type ExtractionSource = 'extracted' | 'calculated' | 'user'

export type FileAnalysisStatus = 'queued' | 'analyzing' | 'complete' | 'warning' | 'failed'

export type ProjectStatus =
  | 'empty'
  | 'uploading'
  | 'classifying'
  | 'extracting'
  | 'linking'
  | 'needs-review'
  | 'building-3d'
  | 'calculating'
  | 'completed'
  | 'partial'
  | 'failed'

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  empty: '파일 대기',
  uploading: '업로드 중',
  classifying: '파일 종류 분류 중',
  extracting: '치수·높이 추출 중',
  linking: '도면 간 정보 연결 중',
  'needs-review': '신뢰도 검토 필요',
  'building-3d': '3차원 모델 생성 중',
  calculating: '자재 수량 계산 중',
  completed: '발주 가능 산출 완료',
  partial: '부분 완료 · 확인 필요',
  failed: '분석 실패',
}

export const PROJECT_STATUS_DESCRIPTIONS: Record<ProjectStatus, string> = {
  empty: '도면 파일을 올려 작업을 시작하세요.',
  uploading: '파일을 프로젝트에 등록하고 있습니다.',
  classifying: '파일 종류와 도면 페이지를 분류하고 있습니다.',
  extracting: '도면의 텍스트·벡터·OCR에서 치수와 높이를 읽고 있습니다.',
  linking: '평면도·입면도·단면도의 같은 구역과 층 정보를 연결하고 있습니다.',
  'needs-review': '낮은 신뢰도 값과 누락된 근거를 확인한 뒤 다음 단계로 진행하세요.',
  'building-3d': '확인된 길이·높이·개구부로 계산 가능한 3차원 모델을 만들고 있습니다.',
  calculating: '벽체별 배치 기준으로 판넬과 부자재 수량을 계산하고 있습니다.',
  completed: '필수 근거와 검토 상태가 확인되어 산출표를 다운로드할 수 있습니다.',
  partial: '일부 결과는 준비됐지만 발주 전 확인이 필요한 항목이 있습니다.',
  failed: '처리할 수 있는 설계도 결과가 없어 다시 확인이 필요합니다.',
}

export interface ProjectWorkflow {
  reviewConfirmed: boolean
  modelBuilt: boolean
  takeoffCalculated: boolean
  optimizationCalculated: boolean
}

export type AnalysisStage =
  | 'uploading'
  | 'identifying'
  | 'classifying'
  | 'extracting'
  | 'checking-height'
  | 'complete'
  | 'needs-review'
  | 'failed'

export const ANALYSIS_STAGE_LABELS: Record<AnalysisStage, string> = {
  uploading: '업로드 중',
  identifying: '파일 종류 확인 중',
  classifying: '도면 유형 분석 중',
  extracting: '치수 추출 중',
  'checking-height': '높이 정보 확인 중',
  complete: '분석 완료',
  'needs-review': '일부 정보 확인 필요',
  failed: '분석 실패',
}

export type NormalizedUnit = 'mm' | 'cm' | 'm'
export type DimensionSourceType = 'pdf-text' | 'vector' | 'ocr' | 'calculated'
export type GeometrySource = 'drawing-vector' | 'dimension-layout'
export type HandwritingStatus = 'printed' | 'handwriting' | 'uncertain'
export type HeightRole = 'direct' | 'level' | 'level-calculated' | 'none'
export type HeightCandidateSourceType = 'PDF_TEXT' | 'PRINTED_OCR' | 'HANDWRITING' | 'LEVEL_CALCULATION'
export type HeightCandidateStatus =
  | '높이 확인됨'
  | '높이 후보 발견'
  | '벽체 연결 완료'
  | '높이 연결 필요'
  | 'OCR 읽기 실패'
  | '도면에 높이 없음'
  | '높이 값 충돌'
  | '기준 레벨만 확인됨'
  | '손글씨라 자동 계산 제외'
  | '확인 필요'

export type HeightReviewAction = 'approved' | 'excluded' | 'edited' | 'linked' | 'marked-handwriting' | 'needs-review'

export interface HeightReviewRecord {
  action: HeightReviewAction
  beforeValueMm: number | null
  afterValueMm: number | null
  reason: string
  reviewedAt: string
  reviewedBy: string
  recalculatedAt: string | null
}

export interface SourcePosition {
  x: number
  y: number
  width: number
  height: number
}

export interface EvidenceLocation {
  x: number
  y: number
  width: number
  height: number
  coordinateSystem: 'normalized' | 'pdf-points' | 'image-pixels'
}

export interface Evidence {
  fileId: string
  fileName: string
  pageNumber: number
  drawingKind: DrawingKind
  location?: EvidenceLocation
  method: 'pdf-text' | 'vector' | 'ocr' | 'derived' | 'user'
  rawText?: string
  note?: string
  imageDataUrl?: string
  handwritingStatus?: HandwritingStatus
}

export interface DimensionValue {
  id: string
  label: string
  /** Raw numeric value in the unit printed in the drawing. */
  value: number | null
  unit: NormalizedUnit
  normalizedValueMm: number | null
  sourceFile: string
  pageNumber: number
  drawingType: string
  sourceText: string
  sourcePosition: SourcePosition
  sourceType: DimensionSourceType
  valueMm: number | null
  displayValue: string
  confidence: ConfidenceLevel
  source: ExtractionSource
  evidence: Evidence[]
  context: string
  userEdited: boolean
  /** First value extracted from the drawing. Kept when a user confirms a correction. */
  originalValueMm?: number | null
  /** Value explicitly confirmed by a user, if different from the extracted value. */
  userValueMm?: number | null
  /** Semantic role used to keep levels out of direct wall-height linking. */
  heightRole?: HeightRole
  /** Optional level datum parsed from EL/LEVEL/T.O.S./T.O.F. notation. */
  levelDatum?: {
    marker: string
    role: 'upper' | 'lower' | 'unknown'
    referencePlane: string | null
  }
  handwritingStatus?: HandwritingStatus
  upperLevelMm?: number | null
  lowerLevelMm?: number | null
  calculation?: string
  referencePlane?: string | null
  /** A reviewed height can be kept visible in the evidence list while being
   * excluded from geometry until a person approves or replaces it. */
  heightExcluded?: boolean
  heightReviewAction?: HeightReviewAction
  heightReview?: HeightReviewRecord
  /** Manual linkage is stored by stable drawing labels, not generated wall ids. */
  manualWallNumber?: string | null
  manualZone?: string | null
}

export interface HeightCandidate {
  candidateId: string
  valueMm: number | null
  originalText: string
  unit: NormalizedUnit | null
  sourceFileName: string
  pageNumber: number | null
  sourceType: HeightCandidateSourceType
  boundingBox: SourcePosition | null
  drawingType: 'PLAN' | 'ELEVATION' | 'SECTION' | 'DETAIL' | 'TABLE' | 'UNKNOWN'
  nearbyLabel: string
  relatedZone: string | null
  relatedWallId: string | null
  confidence: ConfidenceLevel
  status: HeightCandidateStatus
  evidenceImage: string | null
  evidenceText: string
  upperLevelMm?: number | null
  lowerLevelMm?: number | null
  calculation?: string
  referencePlane?: string | null
}

export interface ExtractedLabel {
  id: string
  value: string
  sourceText: string
  sourceFile: string
  pageNumber: number
  drawingType: string
  sourcePosition: SourcePosition
  confidence: ConfidenceLevel
  sourceType: DimensionSourceType
  evidence: Evidence[]
}

export interface ScaleFinding extends ExtractedLabel {
  ratio: string
  numericRatio: number | null
}

export type OpeningType = 'door' | 'window' | 'opening'

export interface DimensionConflict {
  id: string
  kind: 'length' | 'height' | 'opening'
  reason: string
  values: Array<{
    dimensionId: string
    valueMm: number
    displayValue: string
    confidence: ConfidenceLevel
    evidence: Evidence[]
  }>
}

export interface Opening {
  id: string
  type: OpeningType
  label: string
  zone?: string
  widthMm: number | null
  heightMm: number | null
  sillHeightMm: number | null
  offsetMm: number | null
  areaM2: number | null
  sourcePosition?: SourcePosition
  confidence: ConfidenceLevel
  evidence: Evidence[]
  excludedFromAutomaticTakeoff: boolean
  conflict?: DimensionConflict
}

export interface Wall {
  id: string
  zone: string
  zoneName: string
  number: string
  wallNumber: string
  lengthMm: number | null
  heightMm: number | null
  heightStatus: 'known' | 'missing'
  openings: Opening[]
  confidence: ConfidenceLevel
  evidence: Evidence[]
  sourceReferences: Evidence[]
  sourceDimensionIds: string[]
  reviewStatus: 'verified' | 'review' | 'blocked'
  geometryStart: { x: number; z: number }
  geometryEnd: { x: number; z: number }
  geometrySource: GeometrySource
  color: string
  /** Exact height dimension selected for this wall, when one was safely linked. */
  heightSourceDimensionId?: string
  conflicts?: DimensionConflict[]
  validationStatus?: ConsistencyStatus
}

export interface VectorSegment {
  id: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  lengthPageUnits: number
  sourcePosition: SourcePosition
  confidence: ConfidenceLevel
  sourceType: 'vector'
  evidence: Evidence[]
}

export interface DrawingPage {
  id: string
  pageNumber: number
  width: number
  height: number
  text: string
  previewUrl: string
  kind: DrawingKind
  kindConfidence: ConfidenceLevel
  dimensions: DimensionValue[]
  zones: ExtractedLabel[]
  roomNames: ExtractedLabel[]
  axisLabels: ExtractedLabel[]
  scales: ScaleFinding[]
  unitCandidates: NormalizedUnit[]
  vectorSegments: VectorSegment[]
  warnings: string[]
  handWritingDetected: boolean
  handwritingStatus?: HandwritingStatus
  processingNotes?: string[]
}

export interface AnalyzedFile {
  id: string
  name: string
  extension: string
  mimeType: string
  size: number
  status: FileAnalysisStatus
  stage: AnalysisStage
  progress: number
  kind: DrawingKind
  kindConfidence: ConfidenceLevel
  pages: DrawingPage[]
  previewUrl: string
  warnings: string[]
  error: string
  uploadedAt: string
  canReanalyze: boolean
  externalProcessing: boolean
}

export type HeightDiagnosticStageId = 'upload' | 'extraction' | 'candidate' | 'normalization' | 'linking' | 'confidence' | 'model'
export type HeightDiagnosticStageStatus = 'pending' | 'passed' | 'needs-review' | 'blocked'
export type HeightDiagnosticStatus = 'not-started' | 'extracted' | 'converted' | 'linked' | 'modelled' | 'needs-review' | 'blocked'
export type HeightDiagnosticCause =
  | 'drawing-no-height'
  | 'ocr-no-height'
  | 'height-not-linked'
  | 'unit-conversion-failed'
  | 'invalid-height'
  | 'low-confidence'
  | 'field-mismatch'
  | 'height-conflict'
  | 'level-only'
  | 'handwriting-excluded'
  | 'manual-excluded'
  | 'ocr-unavailable'
  | 'drawing-type-unknown'
  | null

export interface HeightDiagnosticEntry {
  id: string
  kind: 'candidate' | 'wall'
  dimensionId: string | null
  extractedValue: number | null
  displayValue: string
  unit: NormalizedUnit | null
  normalizedValueMm: number | null
  sourceFile: string
  pageNumber: number | null
  drawingType: string
  sourcePosition: SourcePosition | null
  evidenceText: string
  sourceType: DimensionSourceType | null
  zone: string | null
  linkedWallId: string | null
  linkedWallNumber: string | null
  confidence: ConfidenceLevel
  status: HeightDiagnosticStatus
  cause: HeightDiagnosticCause
  message: string
  candidateSourceType?: HeightCandidateSourceType
  candidateStatus?: HeightCandidateStatus
  evidenceImage?: string | null
  originalText?: string
  upperLevelMm?: number | null
  lowerLevelMm?: number | null
  calculation?: string
  referencePlane?: string | null
}

export interface HeightDiagnosticStage {
  id: HeightDiagnosticStageId
  label: string
  status: HeightDiagnosticStageStatus
  message: string
  cause: HeightDiagnosticCause
  entryCount: number
}

export interface HeightDiagnostics {
  stages: HeightDiagnosticStage[]
  entries: HeightDiagnosticEntry[]
  candidates: HeightCandidate[]
  overallStatus: 'not-started' | 'passed' | 'needs-review' | 'blocked'
  currentStage: HeightDiagnosticStageId
  message: string
  floorPlanOnly: boolean
  candidateCount: number
  validCandidateCount: number
  linkedWallCount: number
  wallCount: number
  modelWallCount: number
}

export interface MaterialSettings {
  panelEffectiveWidthMm: number
  panelStandardLengthMm: number
  panelThicknessMm: number
  panelDirection: 'vertical' | 'horizontal'
  panelWasteRate: number
  fastenersPerPanel: number
  sealantLengthM: number
  cornerLengthM: number
  finishLengthM: number
  reuseOffcuts: boolean
}

export interface MaterialTakeoff {
  wallId: string
  zone: string
  wallNumber: string
  evidenceLabel: string
  lengthMm: number | null
  heightMm: number | null
  openingAreaM2: number
  netAreaM2: number | null
  panelSpec: string
  basePanels: number | null
  panelsWithWaste: number | null
  fasteners: number | null
  sealantCartridges: number | null
  cornerPieces: number | null
  finishPieces: number | null
  offcutM: number | null
  confidence: ConfidenceLevel
  reviewStatus: '확정' | '검토 필요' | '높이 정보 없음'
  notes: string[]
  formula?: string
  sourceReferences?: Evidence[]
  validationStatus?: ConsistencyStatus
}

export type OptimizationMaterialType = 'panel' | 'profile'
export type CatalogUnit = 'sheet' | 'bar'
export type GrainDirection = 'free' | 'fixed'
export type MemberShape = 'rectangle' | 'irregular'
export type OptimizationStatus = 'not-ready' | 'needs-review' | 'calculated' | 'blocked'
export type ScrapStatus = 'reuse-planned' | 'reuse-unavailable' | 'waste' | 'scrap'

export interface MaterialCatalogItem {
  id: string
  name: string
  materialType: OptimizationMaterialType
  material: string
  thicknessMm: number | null
  stockWidthMm: number | null
  stockLengthMm: number | null
  stockLengthOptionsMm: number[]
  unit: CatalogUnit
  unitLabel: string
  unitPrice: number | null
  minimumOrderQuantity: number | null
  cuttingFee: number | null
  cutCostPerCut: number | null
  kerfMm: number | null
  transportCost: number | null
  handlingCost: number | null
  disposalCostPerM2: number | null
  disposalCostPerM: number | null
  temporaryStorageCostPerDay: number | null
  rotatable: boolean
  grainDirection: GrainDirection
  lapAllowanceMm: number | null
  minimumReusableOffcutMm: number | null
  reworkRiskCost: number | null
  source: 'user' | 'sample'
  updatedAt: string
}

export interface CuttingMember {
  id: string
  sourceWallId: string | null
  zone: string
  location: string
  wallNumber: string
  requiredLengthMm: number
  requiredWidthMm: number | null
  requiredHeightMm: number | null
  quantity: number
  materialType: OptimizationMaterialType
  materialId: string | null
  materialSpec: string
  shape: MemberShape
  cuttingRequired: boolean
  openingIds: string[]
  installOrder: number
  plannedInstallAt: string | null
  sourceReferences: Evidence[]
  confidence: ConfidenceLevel
  reviewStatus: 'ready' | 'needs-review' | 'unsupported'
  notes: string[]
  validationStatus?: ConsistencyStatus
}

export interface OptimizationReviewItem {
  id: string
  category: 'height' | 'material' | 'price' | 'shape' | 'scrap' | 'dimension' | 'fit' | 'duplicate'
  problem: string
  sourceLabel: string
  currentValue: string
  editableValue: string
  reason: string
  severity: 'warning' | 'blocked'
  targetId?: string
  targetField?: keyof MaterialCatalogItem
  resolved: boolean
  confidence?: ConfidenceLevel
  sourceReferences?: Evidence[]
}

export interface CuttingPlacement {
  id: string
  memberId: string
  label: string
  zone: string
  stockPlanId: string
  xMm: number
  yMm: number
  lengthMm: number
  widthMm: number | null
  rotated: boolean
  cutOrder: number
  source: 'raw-material' | 'onsite-scrap'
  kerfMm: number
}

export interface ScrapPiece {
  id: string
  source: 'generated' | 'existing'
  sourceStockPlanId: string | null
  materialId: string
  material: string
  thicknessMm: number | null
  widthMm: number | null
  lengthMm: number
  xMm: number | null
  yMm: number | null
  currentLocation: string
  originZone: string
  usableZones: string[]
  plannedUseMemberId: string | null
  generatedAt: string | null
  plannedUseAt: string | null
  storageDays: number | null
  temporaryStorageCost: number | null
  available: boolean
  status: ScrapStatus
  disposalCategory: '폐기' | '고철' | '업체 반납' | null
  note: string
}

export interface CuttingStockPlan {
  id: string
  materialId: string
  materialType: OptimizationMaterialType
  source: 'raw-material' | 'onsite-scrap'
  stockIndex: number
  stockLengthMm: number
  stockWidthMm: number | null
  placements: CuttingPlacement[]
  remainingLengthMm: number | null
  remainingAreaM2: number | null
  wasteLengthMm: number | null
  wasteAreaM2: number | null
  cutCount: number
  scrapIds: string[]
}

export interface OptimizationCostBreakdown {
  purchaseCost: number | null
  cuttingCost: number | null
  cutCountCost: number | null
  transportCost: number | null
  handlingCost: number | null
  storageCost: number | null
  disposalCost: number | null
  riskCost: number | null
  totalCost: number | null
  missingInputs: string[]
  status: 'complete' | 'price-missing' | 'review-required'
}

export interface OptimizationValidation {
  passed: boolean
  memberAssignmentErrors: string[]
  oversizedMemberErrors: string[]
  overlapErrors: string[]
  kerfErrors: string[]
  unitErrors: string[]
  duplicateCalculationErrors: string[]
  openingDoubleCountErrors: string[]
  unsupportedShapeErrors: string[]
}

export interface OptimizationScenario {
  id: 'cost' | 'waste' | 'simple'
  label: string
  description: string
  available: boolean
  recommendation: string
  stockPlans: CuttingStockPlan[]
  scraps: ScrapPiece[]
  unplacedMemberIds: string[]
  stockCount: number
  orderQuantity: number | null
  cutCount: number
  wasteAreaM2: number | null
  wasteLengthMm: number | null
  wasteRate: number | null
  cost: OptimizationCostBreakdown
  validation: OptimizationValidation
  stockLengthComparison: Array<{
    stockLengthMm: number
    stockCount: number
    wasteAreaM2: number | null
    wasteLengthMm: number | null
    totalCost: number | null
    selected: boolean
  }>
}

export interface OptimizationState {
  catalog: MaterialCatalogItem[]
  selectedPanelMaterialId: string
  selectedProfileMaterialId: string
  members: CuttingMember[]
  reviews: OptimizationReviewItem[]
  scenarios: OptimizationScenario[]
  selectedScenarioId: 'cost' | 'waste' | 'simple'
  recommendedScenarioId: 'cost' | 'waste' | 'simple'
  status: OptimizationStatus
  validation: OptimizationValidation
  scraps: ScrapPiece[]
  lastCalculatedAt: string | null
}

export function emptyOptimizationValidation(): OptimizationValidation {
  return {
    passed: false,
    memberAssignmentErrors: [],
    oversizedMemberErrors: [],
    overlapErrors: [],
    kerfErrors: [],
    unitErrors: [],
    duplicateCalculationErrors: [],
    openingDoubleCountErrors: [],
    unsupportedShapeErrors: [],
  }
}

export function emptyOptimizationState(): OptimizationState {
  return {
    catalog: [],
    selectedPanelMaterialId: '',
    selectedProfileMaterialId: '',
    members: [],
    reviews: [],
    scenarios: [],
    selectedScenarioId: 'cost',
    recommendedScenarioId: 'cost',
    status: 'not-ready',
    validation: emptyOptimizationValidation(),
    scraps: [],
    lastCalculatedAt: null,
  }
}

export interface CostSummaryRow {
  id: string
  month: string
  vendor: string
  item: string
  amount: number | null
  total: number | null
  evidence: Evidence[]
}

export interface CostSummary {
  rows: CostSummaryRow[]
  totalAmount: number | null
  sourceFileIds: string[]
  privacyNote: string
}

export interface RoofGeometry {
  isReady: boolean
  kind: 'flat' | 'gable' | 'shed' | 'unknown'
  heightMm: number | null
  pitchDeg: number | null
  evidence: Evidence[]
  blockedReason: string
}

export interface BuildingGeometry {
  walls: Array<{
    wallId: string
    zone: string
    zoneName: string
    number: string
    wallNumber: string
    start: { x: number; y: number; z: number }
    end: { x: number; y: number; z: number }
    lengthMm: number
    heightMm: number
    thicknessMm: number
    openings: Opening[]
    color: string
    confidence: ConfidenceLevel
    sourceReferences: Evidence[]
    geometrySource: GeometrySource
    validationStatus?: ConsistencyStatus
  }>
  footprint: Array<{ x: number; z: number }>
  roof: RoofGeometry
  isReady: boolean
  blockedReason: string
  /** True when only the subset with verified heights was modelled. */
  partial?: boolean
  /** Walls intentionally omitted from geometry because a required height is missing. */
  blockedWallIds?: string[]
}

export interface ProjectState {
  id: string
  status: ProjectStatus
  statusMessage: string
  workflow: ProjectWorkflow
  name: string
  buildingName: string
  createdAt: string
  updatedAt: string
  files: AnalyzedFile[]
  dimensions: DimensionValue[]
  heightCandidates: HeightCandidate[]
  walls: Wall[]
  takeoffs: MaterialTakeoff[]
  costSummary: CostSummary
  settings: MaterialSettings
  reviewItems: string[]
  missingItems: string[]
  heightDiagnostics: HeightDiagnostics
  model: BuildingGeometry
  optimization: OptimizationState
  consistencyValidation: ConsistencyValidation
  restoredFromStorage: boolean
}

export const DEFAULT_MATERIAL_SETTINGS: MaterialSettings = {
  panelEffectiveWidthMm: 1000,
  panelStandardLengthMm: 6000,
  panelThicknessMm: 75,
  panelDirection: 'vertical',
  panelWasteRate: 5,
  fastenersPerPanel: 6,
  sealantLengthM: 10,
  cornerLengthM: 3,
  finishLengthM: 3,
  reuseOffcuts: true,
}

export const DRAWING_KIND_LABELS: Record<DrawingKind, string> = {
  'floor-plan': '평면도',
  elevation: '입면도',
  section: '단면도',
  detail: '상세도',
  structural: '구조도',
  'material-schedule': '자재표',
  'cost-summary': '공사비 집계표',
  unknown: '알 수 없는 파일',
}

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  high: '높은 신뢰도',
  medium: '중간 신뢰도',
  low: '낮은 신뢰도',
}

export const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: '#147d67',
  medium: '#b7791f',
  low: '#c44c5c',
}
