import type {
  CuttingMember,
  MaterialCatalogItem,
  MaterialSettings,
  MaterialTakeoff,
  OptimizationScenario,
  ScrapPiece,
} from '../types/domain'

const CSV_HEADERS = [
  '구역',
  '벽체 번호',
  '도면 근거',
  '가로 길이(mm)',
  '높이(mm)',
  '개구부 면적(㎡)',
  '순 벽체 면적(㎡)',
  '판넬 규격',
  '기본 판넬 수량',
  '여유 포함 판넬 수량',
  '고정 피스',
  '실란트(본)',
  '코너재(본)',
  '마감재(본)',
  '절단 잔재(m)',
  '계산 근거',
  '도면 출처 위치',
  '신뢰도',
  '검토 상태',
  '확인 필요 여부',
]

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function confidenceLabel(confidence: string) {
  return confidence === 'high' ? '높은 신뢰도' : confidence === 'medium' ? '중간 신뢰도' : '낮은 신뢰도'
}

export function takeoffsToCsv(rows: MaterialTakeoff[]) {
  const values = rows.map((row) => [
    row.zone,
    row.wallNumber,
    row.evidenceLabel,
    row.lengthMm,
    row.heightMm,
    row.openingAreaM2.toFixed(2),
    row.netAreaM2 === null ? '' : row.netAreaM2.toFixed(2),
    row.panelSpec,
    row.basePanels,
    row.panelsWithWaste,
    row.fasteners,
    row.sealantCartridges,
    row.cornerPieces,
    row.finishPieces,
    row.offcutM === null ? '' : row.offcutM.toFixed(2),
    row.formula || '',
    row.sourceReferences?.map((reference) => `${reference.fileName} · ${reference.pageNumber}페이지${reference.location ? ` · ${(reference.location.x * 100).toFixed(0)}%, ${(reference.location.y * 100).toFixed(0)}%` : ''}`).join(' / ') || row.evidenceLabel,
    confidenceLabel(row.confidence),
    row.reviewStatus,
    row.reviewStatus === '확정' ? '아니오' : '예',
  ])
  return `\uFEFF${[CSV_HEADERS, ...values].map((row) => row.map(csvCell).join(',')).join('\n')}`
}

export function downloadCsv(rows: MaterialTakeoff[], fileName = '자재-발주-산출표.csv') {
  const blob = new Blob([takeoffsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function downloadText(text: string, fileName: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function csvRows(headers: string[], rows: unknown[][]) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}`
}

export function downloadCuttingMembersCsv(members: CuttingMember[]) {
  const rows = members.map((member) => [
    member.id,
    member.zone,
    member.wallNumber,
    member.requiredLengthMm,
    member.requiredWidthMm,
    member.requiredHeightMm,
    member.quantity,
    member.materialType === 'panel' ? '판재' : '프로파일',
    member.materialSpec,
    member.shape === 'rectangle' ? '직사각형' : '지원되지 않는 형상',
    member.openingIds.join(' · '),
    member.installOrder,
    member.sourceReferences.map((reference) => `${reference.fileName} · ${reference.pageNumber}페이지${reference.location ? ` · ${(reference.location.x * 100).toFixed(0)}%, ${(reference.location.y * 100).toFixed(0)}%` : ''}`).join(' / '),
    member.confidence,
    member.reviewStatus,
  ])
  downloadText(csvRows(['부재 ID', '구역', '벽체', '필요 길이(mm)', '필요 폭(mm)', '필요 높이(mm)', '수량', '자재 종류', '자재 규격', '형상', '개구부', '설치 순서', '도면 근거', '신뢰도', '검토 상태'], rows), '부재별-절단-목록.csv')
}

export function downloadCuttingPlansCsv(scenario: OptimizationScenario) {
  const rows = scenario.stockPlans.flatMap((plan) => plan.placements.map((placement) => [
    scenario.label,
    plan.id,
    plan.source === 'raw-material' ? '원자재' : '현장 자투리',
    plan.stockIndex,
    plan.stockLengthMm,
    plan.stockWidthMm,
    placement.cutOrder,
    placement.label,
    placement.zone,
    placement.lengthMm,
    placement.widthMm,
    placement.xMm,
    placement.yMm,
    placement.rotated ? '회전' : '방향 유지',
    placement.source === 'onsite-scrap' ? '현장 재사용' : '원자재 사용',
    placement.kerfMm,
  ]))
  downloadText(csvRows(['안', '배치 ID', '원천', '원자재 순번', '원자재 길이(mm)', '원자재 폭(mm)', '절단 순서', '부재', '사용 구역', '부재 길이(mm)', '부재 폭(mm)', '배치 X(mm)', '배치 Y(mm)', '회전', '사용 구분', '절단폭(mm)'], rows), '원자재별-절단-배치.csv')
}

export function downloadScrapsCsv(scraps: ScrapPiece[]) {
  const rows = scraps.map((scrap) => [
    scrap.id,
    scrap.source === 'generated' ? '이번 계산에서 발생' : '기존 현장 자투리',
    scrap.material,
    scrap.thicknessMm,
    scrap.lengthMm,
    scrap.widthMm,
    scrap.xMm,
    scrap.yMm,
    scrap.currentLocation,
    scrap.originZone,
    scrap.usableZones.join(' · '),
    scrap.plannedUseMemberId || '',
    scrap.generatedAt || '',
    scrap.plannedUseAt || '',
    scrap.storageDays,
    scrap.temporaryStorageCost,
    scrap.status === 'reuse-planned' ? '현장 재사용 예정' : scrap.status === 'reuse-unavailable' ? '현장 재사용 불가' : scrap.disposalCategory || '폐기',
    scrap.note,
  ])
  downloadText(csvRows(['자투리 ID', '발생 원천', '재질', '두께(mm)', '길이(mm)', '폭(mm)', '배치 X(mm)', '배치 Y(mm)', '보관 위치', '발생 구역', '사용 가능 구역', '사용 예정 부재', '발생 시점', '사용 예정 시점', '임시 보관 일수', '임시 보관비', '처리 상태', '비고'], rows), '현장-자투리-목록.csv')
}

export function downloadOptimizationOrderCsv(scenario: OptimizationScenario, catalog: MaterialCatalogItem[]) {
  const materialIds = [...new Set(scenario.stockPlans.map((plan) => plan.materialId))]
  const rows = materialIds.map((materialId) => {
    const item = catalog.find((candidate) => candidate.id === materialId)
    const plans = scenario.stockPlans.filter((plan) => plan.materialId === materialId)
    const zones = [...new Set(plans.flatMap((plan) => plan.placements.map((placement) => placement.zone)))].join(' · ')
    const stockSize = item?.materialType === 'panel'
      ? `${item.stockLengthMm ?? '확인 필요'} × ${item.stockWidthMm ?? '확인 필요'}mm`
      : (item?.stockLengthOptionsMm || []).length
        ? `${(item?.stockLengthOptionsMm || []).join(' · ')}mm`
        : `${item?.stockLengthMm ?? '확인 필요'}mm`
    return [
      item?.name || '자재 이름 확인 필요',
      item?.materialType === 'profile' ? '프로파일' : '판재',
      item?.material || '재질 확인 필요',
      item?.thicknessMm ?? '',
      stockSize,
      scenario.orderQuantity,
      item?.unitPrice,
      scenario.cost.purchaseCost,
      scenario.cost.cuttingCost,
      scenario.cost.cutCountCost,
      scenario.cost.transportCost,
      scenario.cost.handlingCost,
      scenario.cost.storageCost,
      scenario.cost.disposalCost,
      scenario.cost.riskCost,
      scenario.cost.totalCost,
      zones,
      scenario.cost.status,
      scenario.available ? '아니오' : '예',
    ]
  })
  downloadText(csvRows(['자재 종류', '자재 형태', '재질', '두께(mm)', '원자재 크기', '주문 수량', '단가', '구매비', '절단비', '절단 횟수 비용', '운반비', '현장 취급비', '임시 보관비', '폐기비', '재작업 위험 비용', '총비용', '사용 구역', '계산 상태', '확인 필요 여부'], rows), '자재-발주서.csv')
}

export function downloadScenarioComparisonCsv(scenarios: OptimizationScenario[]) {
  const rows = scenarios.map((scenario) => [
    scenario.label,
    scenario.description,
    scenario.cost.totalCost,
    scenario.cost.purchaseCost,
    scenario.cost.cuttingCost,
    scenario.cost.cutCountCost,
    scenario.cost.transportCost,
    scenario.cost.handlingCost,
    scenario.cost.storageCost,
    scenario.cost.disposalCost,
    scenario.cost.riskCost,
    scenario.stockCount,
    scenario.orderQuantity,
    scenario.cutCount,
    scenario.wasteAreaM2,
    scenario.wasteLengthMm,
    scenario.wasteRate,
    scenario.cost.status,
    scenario.cost.missingInputs.join(' · '),
    scenario.available ? '발주 검토 가능' : '확인 필요',
  ])
  downloadText(csvRows(['비교안', '설명', '총비용', '원자재 구매비', '절단비', '절단 횟수 비용', '운반비', '현장 취급비', '임시 보관비', '폐기비', '재작업 위험 비용', '원자재 수', '주문 수량', '절단 횟수', '폐기 면적(㎡)', '폐기 길이(mm)', '폐기율(%)', '비용 상태', '부족한 입력값', '발주 상태'], rows), '절단-비용-비교표.csv')
}

export function downloadOptimizationInputsCsv(catalog: MaterialCatalogItem[], members: CuttingMember[]) {
  const rows = [
    ...catalog.map((item) => [
      '자재 기준', item.id, item.name, item.materialType === 'panel' ? '판재' : '프로파일', item.material, item.thicknessMm, item.stockLengthMm, item.stockWidthMm, item.stockLengthOptionsMm.join(' · '), item.unitPrice, item.minimumOrderQuantity, item.cuttingFee, item.cutCostPerCut, item.kerfMm, item.transportCost, item.handlingCost, item.disposalCostPerM2, item.disposalCostPerM, item.temporaryStorageCostPerDay, item.rotatable ? '회전 가능' : '회전 불가', item.grainDirection === 'free' ? '방향 자유' : '방향 고정', item.lapAllowanceMm, item.minimumReusableOffcutMm, item.reworkRiskCost,
    ]),
    ...members.map((member) => [
      '도면 부재', member.id, member.location, member.materialType === 'panel' ? '판재' : '프로파일', member.materialSpec, member.requiredHeightMm, member.requiredLengthMm, member.requiredWidthMm, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', member.sourceReferences.map((reference) => `${reference.fileName} · ${reference.pageNumber}페이지${reference.location ? ` · ${(reference.location.x * 100).toFixed(0)}%, ${(reference.location.y * 100).toFixed(0)}%` : ''}`).join(' / '),
    ]),
  ]
  downloadText(csvRows(['입력 구분', 'ID', '이름·위치', '종류', '재질·규격', '높이/두께(mm)', '길이(mm)', '폭(mm)', '원자재 길이 비교', '단가', '최소 주문', '절단비', '절단 1회', '절단폭', '운반비', '취급비', '판재 폐기비', '프로파일 폐기비', '보관비', '회전', '방향', '이음·겹침', '최소 자투리', '위험 비용', '도면 근거'], rows), '최적화-입력값-도면근거.csv')
}

function printPlanMarkup(scenario: OptimizationScenario) {
  return scenario.stockPlans.map((plan) => {
    const width = plan.stockWidthMm || 1
    const pieces = plan.placements.map((placement) => {
      const left = (placement.xMm / plan.stockLengthMm) * 100
      const top = (placement.yMm / width) * 100
      const pieceWidth = Math.max((placement.lengthMm / plan.stockLengthMm) * 100, 1)
      const pieceHeight = Math.max(((placement.widthMm || width) / width) * 100, 4)
      return `<div class="piece" style="left:${left}%;top:${top}%;width:${pieceWidth}%;height:${pieceHeight}%"><b>${htmlText(placement.label)}</b><small>${placement.lengthMm} × ${placement.widthMm || '길이'}mm</small><i>${placement.cutOrder}번</i></div>`
    }).join('')
    const title = `${plan.source === 'raw-material' ? '원자재' : '현장 자투리'} ${plan.stockIndex} · ${plan.stockLengthMm.toLocaleString('ko-KR')}mm${plan.stockWidthMm ? ` × ${plan.stockWidthMm.toLocaleString('ko-KR')}mm` : ''}`
    return `<section class="plan"><h2>${title}</h2><div class="stock">${pieces || '<span class="empty">배치된 부재 없음</span>'}</div><p>절단 순서: ${plan.placements.map((placement) => `${placement.cutOrder}번 ${placement.label}`).join(' → ') || '없음'}<br>남는 면적: ${plan.wasteAreaM2 === null ? '—' : `${plan.wasteAreaM2.toFixed(2)}㎡`} · 남는 길이: ${plan.wasteLengthMm === null ? '—' : `${plan.wasteLengthMm.toLocaleString('ko-KR')}mm`}</p></section>`
  }).join('')
}

export function printCuttingPlans(projectName: string, scenario: OptimizationScenario) {
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=1280,height=900')
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${projectName} 절단 배치도</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,"Noto Sans KR",sans-serif;color:#17221f;font-size:11px}h1{font-size:22px;margin:0 0 6px}p{color:#536861;line-height:1.6}.notice{padding:10px;background:#eef5f1;border:1px solid #d5e7df;margin:12px 0}.plan{break-inside:avoid;margin:18px 0}.plan h2{font-size:15px;margin:0 0 7px}.stock{position:relative;width:700px;height:260px;border:2px solid #7fa595;background:#f7fbf8}.piece{position:absolute;overflow:hidden;padding:4px;border:1px solid #216fca;color:#083b73;background:#9fd5ff;line-height:1.2}.piece b,.piece small,.piece i{display:block;white-space:nowrap}.piece i{font-style:normal;font-size:9px}.empty{display:grid;place-items:center;height:100%;color:#8a9892}.footer{margin-top:18px;color:#697a74}</style></head><body><h1>${projectName} · 절단 배치도</h1><p>선택 기준: ${scenario.label} · 출력 시각: ${new Date().toLocaleString('ko-KR')}</p><div class="notice">설계 치수는 변경하지 않았습니다. 파란색은 사용할 부재이며, 가격·규격·도면 신뢰도가 부족한 항목은 발주 전에 확인해야 합니다. 브라우저 인쇄 메뉴에서 PDF로 저장할 수 있습니다.</div>${printPlanMarkup(scenario)}<p class="footer">총비용: ${scenario.cost.totalCost === null ? '계산 불가' : `${scenario.cost.totalCost.toLocaleString('ko-KR')}원`} · 폐기율: ${scenario.wasteRate === null ? '계산 불가' : `${scenario.wasteRate}%`}</p><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),220));</script></body></html>`
  if (popup) {
    popup.document.write(html)
    popup.document.close()
  } else {
    window.print()
  }
}

function htmlCell(value: unknown) {
  return `<td>${htmlText(value)}</td>`
}

function htmlText(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] || character)
}

export function printReport(projectName: string, rows: MaterialTakeoff[], settings: MaterialSettings) {
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=1280,height=900')
  const contentRows = rows.map((row) => `<tr>${[
    row.zone,
    row.wallNumber,
    row.evidenceLabel,
    row.lengthMm === null ? '—' : row.lengthMm.toLocaleString('ko-KR'),
    row.heightMm === null ? '—' : row.heightMm.toLocaleString('ko-KR'),
    row.openingAreaM2.toFixed(2),
    row.netAreaM2 === null ? '—' : row.netAreaM2.toFixed(2),
    row.panelSpec,
    row.basePanels ?? '—',
    row.panelsWithWaste ?? '—',
    row.fasteners ?? '—',
    row.sealantCartridges ?? '—',
    row.cornerPieces ?? '—',
    row.finishPieces ?? '—',
    row.offcutM === null ? '—' : row.offcutM.toFixed(2),
    row.formula || '—',
    row.sourceReferences?.map((reference) => `${reference.fileName} · ${reference.pageNumber}페이지${reference.location ? ` · ${(reference.location.x * 100).toFixed(0)}%, ${(reference.location.y * 100).toFixed(0)}%` : ''}`).join(' / ') || row.evidenceLabel,
    confidenceLabel(row.confidence),
    row.reviewStatus,
    row.reviewStatus === '확정' ? '아니오' : '예',
  ].map(htmlCell).join('')}</tr>`).join('')
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${projectName} 자재 산출표</title><style>
    @page{size:A3 landscape;margin:12mm}body{font-family:Arial,"Noto Sans KR",sans-serif;color:#17221f;font-size:10px}h1{font-size:20px;margin:0 0 6px}p{margin:3px 0 14px;color:#4e625c}.notice{padding:8px;background:#eef5f1;border:1px solid #d5e7df;margin-bottom:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cddbd5;padding:5px;vertical-align:top}th{background:#eaf2ee;text-align:left;white-space:nowrap}tr:nth-child(even){background:#fafcfb}.footer{margin-top:14px;color:#5b6d67}
  </style></head><body><h1>${htmlText(projectName)} · 발주 산출표</h1><p>생성 시각: ${new Date().toLocaleString('ko-KR')}</p><div class="notice">판넬 기준: 유효폭 ${settings.panelEffectiveWidthMm.toLocaleString('ko-KR')}mm · 표준길이 ${settings.panelStandardLengthMm.toLocaleString('ko-KR')}mm · 두께 ${settings.panelThicknessMm}T · ${settings.panelDirection === 'vertical' ? '세로' : '가로'} 시공 · 여유율 ${settings.panelWasteRate}%</div><table><thead><tr>${CSV_HEADERS.map(htmlCell).join('')}</tr></thead><tbody>${contentRows || `<tr><td colspan="${CSV_HEADERS.length}">계산 가능한 벽체가 없습니다.</td></tr>`}</tbody></table><p class="footer">도면 정보를 기반으로 만든 자재 산출용 개략 결과입니다. 구조검토 및 설계 승인을 대신하지 않습니다. 브라우저 인쇄 대화상자에서 PDF로 저장할 수 있습니다.</p><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),220));</script></body></html>`
  if (popup) {
    popup.document.write(html)
    popup.document.close()
  } else {
    window.print()
  }
}
