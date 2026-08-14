import type { AnalyzedFile, CostSummary, CostSummaryRow, DrawingPage, Evidence } from '../types/domain'

function amountValues(text: string) {
  // Do not mistake the year in YYYY-MM for a monetary amount.
  const amountText = maskSensitiveCostText(text)
  return [...amountText.matchAll(/(?<![\w./-])(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?(?![\w./-])/g)]
    .map((match) => Number(match[0].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0)
}

export function maskSensitiveCostText(value: string) {
  return value
    .replace(/((?:사업자(?:등록)?번호|법인(?:등록)?번호|주민(?:등록)?번호))\s*[:：]?\s*[\d-]+/gi, '$1: [비식별화]')
    .replace(/\+82[-.\s]?(?:0)?(?:2|1[016789]|[3-8]\d|50\d)[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '+82-**-****-****')
    .replace(/\b(01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '$1-****-****')
    .replace(/\b(0(?:2|[3-6]\d|70|80|50\d))[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '$1-****-****')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일 비식별화]')
    .replace(/((?:담당자|대표자|담당)\s*[:：]?\s*)[가-힣A-Za-z]{2,30}/g, '$1[성명 비식별화]')
    .replace(/((?:업체(?:명)?|공급자|상호)\s*[:：]\s*)(?:(?:주식회사|㈜|\(주\))\s*)?[가-힣A-Za-z0-9&._-]{1,30}/gi, '$1[업체명 비식별화]')
    .replace(/(?:주식회사|㈜|\(주\))\s*[가-힣A-Za-z0-9&._-]{1,30}/g, '[업체명 비식별화]')
    .replace(/([가-힣A-Za-z0-9&._-]{1,30})(건설|건축|산업|종합건설|㈜|\(주\))/g, '$1***')
    .replace(/(?:주소|소재지)\s*[:：]?\s*[^,|\r\n]+/g, '주소: [비식별화]')
    .replace(/(?:계좌|account)\s*[:：]?\s*[\d-]+/gi, '계좌: [비식별화]')
}

export function isCostSummaryPage(file: AnalyzedFile, page: Pick<DrawingPage, 'kind'>) {
  if (page.kind === 'cost-summary') return true
  if ((page.kind && page.kind !== 'unknown') || file.kind !== 'cost-summary') return false
  const hasExplicitPageKind = file.pages.some((candidate) => candidate.kind && candidate.kind !== 'unknown')
  return !hasExplicitPageKind
}

function rowFromLine(line: string, fileId: string, fileName: string, pageNumber: number, index: number): CostSummaryRow | null {
  const amounts = amountValues(line)
  if (!amounts.length) return null
  const monthMatch = line.match(/(\d{1,2})\s*월|([12]\d{3})[./-](\d{1,2})/)
  const month = monthMatch ? (monthMatch[1] ? `${monthMatch[1]}월` : `${monthMatch[2]}-${monthMatch[3]}`) : '월 미확인'
  const isTotalRow = /(?:합계|총계|누계|total)/i.test(line)
  const evidence: Evidence = {
    fileId,
    fileName,
    pageNumber,
    drawingKind: 'cost-summary',
    method: 'pdf-text',
    rawText: maskSensitiveCostText(line.slice(0, 260)),
  }
  const withoutAmounts = line.replace(/(?<![\w./-])(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?(?![\w./-])/g, ' ').replace(/\s+/g, ' ').trim()
  const pieces = withoutAmounts.split(/[|│\t]+/).map((piece) => piece.trim()).filter(Boolean)
  const vendorSource = pieces.find((piece) => /업체|건설|건축|산업|주식|㈜|회사/i.test(piece)) || ''
  const item = pieces.find((piece) => piece !== vendorSource && !/월|합계|누계/i.test(piece)) || '품명 미확인'
  return {
    id: `cost-${fileId}-${pageNumber}-${index}`,
    month,
    vendor: '[업체명 비식별화]',
    item: maskSensitiveCostText(item),
    // A detail row can contain quantity/unit price before its row amount. The
    // last monetary value is the row amount; only an explicit total row may
    // populate `total` for the whole-table summary.
    amount: isTotalRow ? null : amounts[amounts.length - 1] || null,
    total: isTotalRow ? amounts[amounts.length - 1] || null : null,
    evidence: [evidence],
  }
}

export function parseCostSummaries(files: AnalyzedFile[]): CostSummary {
  const rows: CostSummaryRow[] = []
  const sourceFileIds: string[] = []
  for (const file of files) {
    const costPages = file.pages.filter((page) => isCostSummaryPage(file, page))
    if (!costPages.length) continue
    sourceFileIds.push(file.id)
    for (const page of costPages) {
      const lines = page.text.split(/\r?\n|(?=\d{1,2}\s*월)/).map((line) => line.trim()).filter(Boolean)
      lines.forEach((line, index) => {
        const row = rowFromLine(line, file.id, file.name, page.pageNumber, index)
        if (row) rows.push(row)
      })
    }
  }
  // Subtotals can precede the grand total, so the last explicit total row is
  // the authoritative table total. Without one, sum every detail-row amount.
  const explicitTotal = rows.map((row) => row.total).filter((value): value is number => Boolean(value)).at(-1) || null
  const totalAmount = explicitTotal || (rows.length ? rows.reduce((sum, row) => sum + (row.amount || 0), 0) : null)
  return {
    rows,
    totalAmount,
    sourceFileIds: [...new Set(sourceFileIds)],
    privacyNote: '공사비 집계표의 업체명·연락처·주소·계좌번호·등록번호 등은 결과와 로컬 저장본에서 비식별화합니다. 비용 분석에만 사용하며 3D·자재 산출에는 사용하지 않습니다.',
  }
}
