import { extensionOf, isFutureFile, unsupportedMessage } from './file-loader'

export interface CadAdapterResult {
  supported: false
  extension: string
  message: string
}

/**
 * Adapter boundary for a future DWG/DXF/IFC parser. It deliberately refuses to
 * pretend that CAD data was parsed until a real parser is connected.
 */
export function analyzeCadFile(file: File): CadAdapterResult {
  const extension = extensionOf(file.name)
  return {
    supported: false,
    extension,
    message: isFutureFile(file)
      ? unsupportedMessage(file.name)
      : '현재 이 파일 형식은 자동 분석을 지원하지 않습니다.',
  }
}
