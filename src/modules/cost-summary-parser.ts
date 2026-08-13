import type { AnalyzedFile, CostSummary, CostSummaryRow, Evidence } from '../types/domain'

function amountValues(text: string) {
  // Do not mistake the year in YYYY-MM for a monetary amount.
  return [...text.matchAll(/(?<![\w./-])(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?(?![\w./-])/g)]
    .map((match) => Number(match[0].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0)
}

function maskSensitive(value: string) {
  return value
    .replace(/(01[016789])[\s-]?\d{3,4}[\s-]?\d{4}/g, '$1-****-****')
    .replace(/\b\d{2,3}-\d{3,4}-\d{4}\b/g, '***-****-****')
    .replace(/([가-힣A-Za-z]{1,8})(건설|건축|산업|주식회사|㈜)/g, '$1***')
    .replace(/(?:주소|소재지)\s*[:：]?\s*[^,|]+/g, '주소: [비식별화]')
    .replace(/(?:계좌|account)\s*[:：]?\s*[\d-]+/gi, '계좌: [비식별화]')
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
    rawText: line.slice(0, 260),
  }
  const withoutAmounts = line.replace(/(?<![\w./-])(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?(?![\w./-])/g, ' ').replace(/\s+/g, ' ').trim()
  const pieces = withoutAmounts.split(/[|│\t]+/).map((piece) => piece.trim()).filter(Boolean)
  const vendor = pieces.find((piece) => /업체|건설|주식|㈜|회사/i.test(piece)) || '[업체명 비식별화]'
  const item = pieces.find((piece) => piece !== vendor && !/월|합계|누계/i.test(piece)) || '품명 미확인'
  return {
    id: `cost-${fileId}-${pageNumber}-${index}`,
    month,
    vendor: maskSensitive(vendor),
    item: maskSensitive(item),
    amount: isTotalRow ? null : amounts[0] || null,
    total: isTotalRow ? amounts[amounts.length - 1] || null : amounts.length > 1 ? amounts[amounts.length - 1] : null,
    evidence: [evidence],
  }
}

export function parseCostSummaries(files: AnalyzedFile[]): CostSummary {
  const rows: CostSummaryRow[] = []
  const sourceFileIds: string[] = []
  for (const file of files) {
    if (file.kind !== 'cost-summary') continue
    sourceFileIds.push(file.id)
    for (const page of file.pages) {
      const lines = page.text.split(/\r?\n|(?=\d{1,2}\s*월)/).map((line) => line.trim()).filter(Boolean)
      lines.forEach((line, index) => {
        const row = rowFromLine(line, file.id, file.name, page.pageNumber, index)
        if (row) rows.push(row)
      })
    }
  }
  const explicitTotal = rows.map((row) => row.total).find((value) => Boolean(value)) || null
  const totalAmount = explicitTotal || (rows.length ? rows.reduce((sum, row) => sum + (row.amount || 0), 0) : null)
  return {
    rows,
    totalAmount,
    sourceFileIds: [...new Set(sourceFileIds)],
    privacyNote: '공사비 집계표의 업체명·연락처·주소·계좌번호 등은 결과 화면에서 비식별화했습니다. 비용 분석만 저장하며 3D·자재 산출에는 사용하지 않습니다.',
  }
}
