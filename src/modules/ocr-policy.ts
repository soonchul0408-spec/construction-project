export function shouldRunTileOcr(text: string, words: Array<{ text: string }>) {
  const marker = String.raw`(?:높이|층고|천장고|height|\bH\b|\bHT\b|\bEL\b\.?|\bLEVEL\b|\bT\.?O\.?S\.?|\bT\.?O\.?F\.?|\bFFL\b|\bGL\b)`
  const numeric = String.raw`[+−±-]?\s*\d{1,7}(?:[.,]\d{1,3})?\s*(?:mm|㎜|cm|㎝|m\b|미터)?`
  const separator = String.raw`\s*(?:(?:[:=]|약)\s*)?`
  const markerWithValue = new RegExp(`(?:${marker}${separator}${numeric}|${numeric}${separator}${marker})`, 'i')
  return !text.trim() || !words.length || !markerWithValue.test(text)
}
