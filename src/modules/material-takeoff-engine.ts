import type { MaterialSettings, MaterialTakeoff, Opening, Wall } from '../types/domain'

function openingArea(openings: Opening[]) {
  const valid = openings.filter((opening) => !opening.excludedFromAutomaticTakeoff && opening.areaM2 !== null)
  const positioned = valid.filter((opening) => opening.widthMm !== null && opening.heightMm !== null && opening.offsetMm !== null)
  if (positioned.length !== valid.length || !positioned.length) {
    return valid.reduce((sum, opening) => sum + (opening.areaM2 || 0), 0)
  }
  // Union the rectangular opening cells instead of summing them blindly. This
  // prevents an overlapping door/window pair from being deducted twice.
  const xBreaks = [...new Set([0, ...positioned.flatMap((opening) => [opening.offsetMm as number, (opening.offsetMm as number) + (opening.widthMm as number)])])].sort((a, b) => a - b)
  const yBreaks = [...new Set([0, ...positioned.flatMap((opening) => [opening.type === 'door' ? 0 : (opening.sillHeightMm || 0), (opening.type === 'door' ? 0 : (opening.sillHeightMm || 0)) + (opening.heightMm as number)])])].sort((a, b) => a - b)
  let areaMm2 = 0
  for (let xIndex = 0; xIndex < xBreaks.length - 1; xIndex += 1) {
    const xStart = xBreaks[xIndex] as number
    const xEnd = xBreaks[xIndex + 1] as number
    for (let yIndex = 0; yIndex < yBreaks.length - 1; yIndex += 1) {
      const yStart = yBreaks[yIndex] as number
      const yEnd = yBreaks[yIndex + 1] as number
      const centerX = (xStart + xEnd) / 2
      const centerY = (yStart + yEnd) / 2
      const covered = positioned.some((opening) => {
        const bottom = opening.type === 'door' ? 0 : opening.sillHeightMm || 0
        return centerX > (opening.offsetMm as number) && centerX < (opening.offsetMm as number) + (opening.widthMm as number) && centerY > bottom && centerY < bottom + (opening.heightMm as number)
      })
      if (covered) areaMm2 += (xEnd - xStart) * (yEnd - yStart)
    }
  }
  return areaMm2 / 1_000_000
}

function openingPerimeterM(openings: Opening[]) {
  return openings.reduce((sum, opening) => {
    if (opening.excludedFromAutomaticTakeoff || opening.widthMm === null || opening.heightMm === null) return sum
    return sum + ((opening.widthMm + opening.heightMm) * 2) / 1000
  }, 0)
}

function positionedOpening(opening: Opening) {
  if (opening.excludedFromAutomaticTakeoff || opening.widthMm === null || opening.heightMm === null || opening.offsetMm === null) return false
  if (opening.type !== 'door' && opening.sillHeightMm === null) return false
  return opening.widthMm > 0 && opening.heightMm > 0 && opening.offsetMm >= 0
}

function openingsOverlap(openings: Opening[]) {
  const positioned = openings.filter(positionedOpening)
  for (let first = 0; first < positioned.length; first += 1) {
    const a = positioned[first]
    if (!a) continue
    const aBottom = a.type === 'door' ? 0 : a.sillHeightMm || 0
    for (let second = first + 1; second < positioned.length; second += 1) {
      const b = positioned[second]
      if (!b) continue
      const bBottom = b.type === 'door' ? 0 : b.sillHeightMm || 0
      if ((a.offsetMm as number) < (b.offsetMm as number) + (b.widthMm as number) && (a.offsetMm as number) + (a.widthMm as number) > (b.offsetMm as number) && aBottom < bBottom + (b.heightMm as number) && aBottom + (a.heightMm as number) > bBottom) return true
    }
  }
  return false
}

function roundM2(value: number) {
  return Math.round(value * 100) / 100
}

function breaksFor(maxMm: number, stepMm: number, extra: number[]) {
  const values = [0, maxMm, ...extra.filter((value) => value > 0 && value < maxMm)]
  for (let value = stepMm; stepMm > 0 && value < maxMm; value += stepMm) values.push(value)
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))].sort((a, b) => a - b)
}

function cellIsOpening(xStartMm: number, xEndMm: number, yStartMm: number, yEndMm: number, openings: Opening[]) {
  const centerX = (xStartMm + xEndMm) / 2
  const centerY = (yStartMm + yEndMm) / 2
  return openings.some((opening) => {
    if (!positionedOpening(opening)) return false
    const bottom = opening.type === 'door' ? 0 : opening.sillHeightMm || 0
    return centerX > (opening.offsetMm as number) && centerX < (opening.offsetMm as number) + (opening.widthMm as number) && centerY > bottom && centerY < bottom + (opening.heightMm as number)
  })
}

function actualPanelPieceCount(wall: Wall, settings: MaterialSettings, openings: Opening[]) {
  const xStep = settings.panelDirection === 'vertical' ? settings.panelEffectiveWidthMm : settings.panelStandardLengthMm
  const yStep = settings.panelDirection === 'vertical' ? settings.panelStandardLengthMm : settings.panelEffectiveWidthMm
  const xBreaks = breaksFor(wall.lengthMm as number, xStep, openings.flatMap((opening) => [opening.offsetMm as number, (opening.offsetMm as number) + (opening.widthMm as number)]))
  const yBreaks = breaksFor(wall.heightMm as number, yStep, openings.flatMap((opening) => {
    const bottom = opening.type === 'door' ? 0 : opening.sillHeightMm as number
    return [bottom, bottom + (opening.heightMm as number)]
  }))
  let count = 0
  for (let xIndex = 0; xIndex < xBreaks.length - 1; xIndex += 1) {
    for (let yIndex = 0; yIndex < yBreaks.length - 1; yIndex += 1) {
      const xStart = xBreaks[xIndex] as number
      const xEnd = xBreaks[xIndex + 1] as number
      const yStart = yBreaks[yIndex] as number
      const yEnd = yBreaks[yIndex + 1] as number
      if (xEnd > xStart && yEnd > yStart && !cellIsOpening(xStart, xEnd, yStart, yEnd, openings)) count += 1
    }
  }
  return count
}

function cornerCountForWall(wall: Wall, walls: Wall[]) {
  const pointKey = (point: { x: number; z: number }) => `${Math.round(point.x * 1000)}:${Math.round(point.z * 1000)}`
  const owners = new Map<string, string>()
  for (const candidate of walls) {
    for (const point of [candidate.geometryStart, candidate.geometryEnd]) {
      const key = pointKey(point)
      if (!owners.has(key)) owners.set(key, candidate.id)
    }
  }
  return [wall.geometryStart, wall.geometryEnd]
    .map(pointKey)
    .filter((key, index, keys) => keys.indexOf(key) === index && owners.get(key) === wall.id)
    .length
}

function layoutForWall(wall: Wall, settings: MaterialSettings, walls: Wall[]) {
  if (wall.lengthMm === null || wall.heightMm === null) return null
  if ((wall.conflicts || []).length) return null
  if (settings.panelEffectiveWidthMm <= 0 || settings.panelStandardLengthMm <= 0 || settings.sealantLengthM <= 0 || settings.cornerLengthM <= 0 || settings.finishLengthM <= 0) return null
  const lengthM = wall.lengthMm / 1000
  const heightM = wall.heightMm / 1000
  const effectiveWidthM = settings.panelEffectiveWidthMm / 1000
  const standardLengthM = settings.panelStandardLengthMm / 1000
  const openingAreaM2 = openingArea(wall.openings)
  const grossAreaM2 = lengthM * heightM
  const netAreaM2 = Math.max(0, grossAreaM2 - openingAreaM2)
  const panelAreaM2 = effectiveWidthM * standardLengthM
  const verticalColumns = Math.ceil(lengthM / effectiveWidthM)
  const verticalCourses = Math.ceil(heightM / standardLengthM)
  const horizontalRows = Math.ceil(heightM / effectiveWidthM)
  const horizontalPieces = Math.ceil(lengthM / standardLengthM)
  const placeableOpenings = wall.openings.filter((opening) => positionedOpening(opening) && (opening.offsetMm as number) + (opening.widthMm as number) <= wall.lengthMm && (opening.type === 'door' ? 0 : opening.sillHeightMm as number) + (opening.heightMm as number) <= wall.heightMm)
  const hasUnplacedOpening = wall.openings.some((opening) => !opening.excludedFromAutomaticTakeoff && !positionedOpening(opening))
  const cuttablePieceCount = hasUnplacedOpening || openingsOverlap(placeableOpenings)
    ? null
    : actualPanelPieceCount(wall, settings, placeableOpenings)
  const areaMinimumPanels = Math.ceil(netAreaM2 / panelAreaM2)
  // Procurement quantity is based on whole panel columns/courses. Opening
  // boundaries are retained for the cutting-member stage; they must not be
  // treated as a discount to the number of full panels ordered.
  const basePanels = hasUnplacedOpening || openingsOverlap(placeableOpenings)
    ? null
    : Math.max(areaMinimumPanels, settings.panelDirection === 'vertical' ? verticalColumns * verticalCourses : horizontalRows * horizontalPieces)
  const panelsWithWaste = Math.ceil(basePanels * (1 + settings.panelWasteRate / 100))
  const fasteners = panelsWithWaste * settings.fastenersPerPanel
  const seamLengthM = settings.panelDirection === 'vertical'
    ? Math.max(0, verticalColumns - 1) * heightM
    : Math.max(0, horizontalRows - 1) * lengthM
  const sealantRunM = seamLengthM + openingPerimeterM(wall.openings)
  const sealantCartridges = hasUnplacedOpening || openingsOverlap(placeableOpenings) ? null : Math.ceil(sealantRunM / settings.sealantLengthM)
  const finishRunM = lengthM * 2 + openingPerimeterM(wall.openings)
  const finishPieces = hasUnplacedOpening || openingsOverlap(placeableOpenings) ? null : Math.ceil(finishRunM / settings.finishLengthM)
  const cornerPieces = Math.ceil((heightM * cornerCountForWall(wall, walls)) / settings.cornerLengthM)
  const requiredLinearM = settings.panelDirection === 'vertical'
    ? verticalColumns * heightM
    : horizontalRows * lengthM
  // Actual offcuts depend on the chosen stock sheet and nesting plan. Do not
  // turn a linear approximation into a procurement result here; the cutting
  // optimizer is the source of truth for offcut quantities.
  const offcutM = null
  return {
    lengthM,
    heightM,
    openingAreaM2,
    netAreaM2,
    basePanels,
    panelsWithWaste: basePanels === null ? null : panelsWithWaste,
    fasteners: basePanels === null ? null : fasteners,
    sealantCartridges,
    finishPieces,
    cornerPieces,
    offcutM,
    seamLengthM,
    hasUnplacedOpening,
    hasOverlappingOpenings: openingsOverlap(placeableOpenings),
    areaMinimumPanels,
    grossPanelLayout: settings.panelDirection === 'vertical' ? verticalColumns * verticalCourses : horizontalRows * horizontalPieces,
    requiredLinearM,
    cuttablePieceCount,
  }
}

export function panelSpec(settings: MaterialSettings) {
  return `${settings.panelThicknessMm}T × 유효폭 ${settings.panelEffectiveWidthMm.toLocaleString('ko-KR')} × 표준 ${settings.panelStandardLengthMm.toLocaleString('ko-KR')} mm / ${settings.panelDirection === 'vertical' ? '세로' : '가로'} 시공`
}

export function calculateTakeoffs(walls: Wall[], settings: MaterialSettings): MaterialTakeoff[] {
  const spec = panelSpec(settings)
  return walls.map((wall) => {
    const layout = layoutForWall(wall, settings, walls)
    const evidence = wall.evidence[0]
    const evidenceLabel = evidence
      ? `${evidence.fileName} · ${evidence.drawingKind} · ${evidence.pageNumber}페이지`
      : '도면 근거 미확인'
    const notes: string[] = []
    if (wall.heightMm === null) notes.push('높이 정보 없음. 입면도 또는 단면도 필요.')
    if (wall.openings.some((opening) => opening.excludedFromAutomaticTakeoff)) {
      notes.push('개구부 폭·높이가 모두 확인되지 않아 일부 개구부를 차감하지 않았습니다.')
    }
    if (wall.openings.some((opening) => opening.widthMm !== null && opening.heightMm !== null && (opening.offsetMm === null || (opening.type === 'window' && opening.sillHeightMm === null)))) {
      notes.push('개구부 위치 또는 창대 높이 근거가 없어 판넬 배치와 3D 개구부를 검토해야 합니다.')
    }
    if (wall.confidence !== 'high') notes.push('추출값 중간/낮은 신뢰도 검토 필요.')
    if ((wall.conflicts || []).length) notes.push(...(wall.conflicts || []).map((conflict) => `치수 충돌: ${conflict.reason}`))
    if (layout?.hasUnplacedOpening) notes.push('개구부 위치 또는 창대 높이가 확인되지 않아 실제 판넬 배치를 확정하지 않았습니다.')
    if (layout?.hasOverlappingOpenings) notes.push('개구부끼리 겹쳐 자동 부자재 수량을 확정하지 않았습니다.')
    if (layout && settings.reuseOffcuts) notes.push('절단 잔재는 원자재 규격을 반영한 절단 최적화 단계에서 확정합니다.')
    if (layout?.cuttablePieceCount !== null && layout?.cuttablePieceCount !== undefined && layout.cuttablePieceCount !== layout.basePanels) notes.push(`개구부 경계를 반영한 절단 부재 ${layout.cuttablePieceCount}개는 절단 최적화에서 원자재 배치로 검증합니다.`)
    const formula = wall.lengthMm !== null && wall.heightMm !== null
      ? `순면적 = ${wall.lengthMm}mm × ${wall.heightMm}mm − 확인된 개구부 ${openingArea(wall.openings).toFixed(2)}㎡; 판넬 부재 = 실제 벽체 격자 배치${layout?.hasUnplacedOpening ? ' (개구부 위치 확인 필요)' : ''}`
      : '높이 정보가 없어 계산할 수 없습니다.'
    return {
      wallId: wall.id,
      zone: wall.zone,
      wallNumber: wall.number,
      evidenceLabel,
      lengthMm: wall.lengthMm,
      heightMm: wall.heightMm,
      openingAreaM2: roundM2(openingArea(wall.openings)),
      netAreaM2: layout ? roundM2(layout.netAreaM2) : null,
      panelSpec: spec,
      basePanels: layout?.basePanels ?? null,
      panelsWithWaste: layout?.panelsWithWaste ?? null,
      fasteners: layout?.fasteners ?? null,
      sealantCartridges: layout?.sealantCartridges ?? null,
      cornerPieces: layout?.cornerPieces ?? null,
      finishPieces: layout?.finishPieces ?? null,
      offcutM: layout?.offcutM ?? null,
      confidence: wall.confidence,
      reviewStatus: wall.heightMm === null
        ? '높이 정보 없음'
        : wall.reviewStatus === 'verified' && !(wall.conflicts || []).length && !layout?.hasUnplacedOpening && !layout?.hasOverlappingOpenings && wall.openings.every((opening) => !opening.excludedFromAutomaticTakeoff && opening.offsetMm !== null && (opening.type !== 'window' || opening.sillHeightMm !== null))
          ? '확정'
          : '검토 필요',
      notes,
      formula,
      sourceReferences: wall.sourceReferences,
    }
  })
}

export function summarizeTakeoffs(takeoffs: MaterialTakeoff[]) {
  return {
    netAreaM2: takeoffs.reduce((sum, row) => sum + (row.netAreaM2 || 0), 0),
    panels: takeoffs.reduce((sum, row) => sum + (row.panelsWithWaste || 0), 0),
    fasteners: takeoffs.reduce((sum, row) => sum + (row.fasteners || 0), 0),
    sealant: takeoffs.reduce((sum, row) => sum + (row.sealantCartridges || 0), 0),
    corners: takeoffs.reduce((sum, row) => sum + (row.cornerPieces || 0), 0),
    finish: takeoffs.reduce((sum, row) => sum + (row.finishPieces || 0), 0),
  }
}

export const MATERIAL_FORMULAS = [
  '벽체 순면적 = 길이 × 높이 − 확인된 문·창호 면적',
  '판넬 부재 수량 = 실제 벽체 격자와 확인된 개구부 경계로 나눈 직사각형 부재 수',
  '여유 포함 판넬 = 올림(기본 판넬 × (1 + 여유율))',
  '고정 피스 = 여유 포함 판넬 × 판넬당 고정 피스',
  '실란트 = 올림((판넬 이음부 + 개구부 둘레) ÷ 1본당 시공 가능 길이)',
  '마감재 = 올림((상·하부 길이 + 개구부 둘레) ÷ 1본당 길이)',
]
