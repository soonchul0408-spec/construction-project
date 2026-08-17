export type ImportKind = 'catalog' | 'inventory' | 'offcut'
export interface CsvImportResult { headers: string[]; rows: Record<string, string>[]; errors: Array<{ row: number; reason: string }> }
const aliases: Record<string, string[]> = { name: ['자재명', '자재', 'name'], code: ['자재코드', '코드', 'code'], quantity: ['수량', '재고수량', 'quantity'], thicknessMm: ['두께', '두께mm'], widthMm: ['폭', '유효폭', '폭mm'], lengthMm: ['길이', '길이mm'], location: ['보관위치', '위치'] }
export const csvTemplates: Record<ImportKind, string> = { catalog: '자재코드,자재명,두께mm,유효폭mm,표준길이mm,단가\nP75,샌드위치패널 75T,75,1000,3200,100000', inventory: '자재코드,자재명,수량,보관위치\nP75,샌드위치패널 75T,20,A동 자재창고', offcut: '자재명,두께mm,폭mm,길이mm,수량,결방향,보관위치\n샌드위치패널 75T,75,1000,3100,1,세로,A동 자재창고' }
const parse = (line: string) => line.split(',').map((value) => value.trim().replace(/^"|"$/g, ''))
export function readMaterialCsv(text: string, kind: ImportKind): CsvImportResult {
  const lines = text.trim().split(/\r?\n/).filter(Boolean); const headers = parse(lines[0] || ''); const rows = lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, parse(line)[index] || '']))); const errors: CsvImportResult['errors'] = []
  const field = (row: Record<string, string>, target: string) => aliases[target].map((name) => row[name]).find(Boolean) || ''
  const seen = new Set<string>()
  rows.forEach((row, index) => { const name = field(row, 'name'); const quantity = field(row, 'quantity'); if (!name) errors.push({ row: index + 2, reason: '자재명이 필요합니다.' }); if (kind !== 'catalog' && (!quantity || Number(quantity) < 0 || !Number.isFinite(Number(quantity)))) errors.push({ row: index + 2, reason: '수량은 0 이상의 숫자여야 합니다.' }); const key = field(row, 'code') || name; if (key && seen.has(key)) errors.push({ row: index + 2, reason: '중복 자재 코드 또는 자재명입니다.' }); seen.add(key); if (kind === 'offcut' && (!field(row, 'lengthMm') || !field(row, 'location'))) errors.push({ row: index + 2, reason: '자투리 길이와 보관 위치가 필요합니다.' }) })
  return { headers, rows, errors }
}
export function rollbackImport<T>(before: T[]): T[] { return structuredClone(before) }
