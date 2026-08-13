# 실제 파일 검증 fixture

이 폴더는 자동 도면 분석 파이프라인의 회귀 테스트용 실제 파일을 둡니다.

- `drawings/plan`: 평면도 PDF/JPG/PNG와 2페이지 PDF
- `drawings/elevation`: 입면도
- `drawings/section`: 단면도
- `drawings/detail`: 문·창호 상세도
- `drawings/cost-table`: 공사비 집계표. geometry와 자재 산출에서 제외
- `expected/integration.json`: 통합 테스트 기준값
- `scripts/verify-drawing-pipeline.ts`: PDF.js 텍스트 추출부터 geometry·산출표까지 실행하는 통합 검증

`source/*.svg`는 동일한 테스트 도면의 사람이 읽을 수 있는 원본입니다. `drawings/plan/test-floor-plan.jpg`와 `.png`는 실제 래스터 이미지 fixture이며, 브라우저 업로드 시 전처리·Tesseract OCR 경로로 처리됩니다. PDF fixture는 PDF.js 살아있는 텍스트와 다중 페이지 경로를 검증합니다.

실행:

```bash
npm run verify:drawing-pipeline
```
