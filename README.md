# drawing-material-calculator

도면 파일에서 치수·높이·구역·개구부 근거를 추출하고, 벽체별 자재 산출표와 계산 가능한 개략 3D geometry를 만드는 Vue 3 + TypeScript 웹앱입니다.

## 통합 작업 흐름

프로젝트는 `empty → uploading → classifying → extracting → linking → needs-review → building-3d → calculating → completed/partial` 상태를 저장합니다. 검토가 끝나기 전에는 3D 모델을 확정하지 않고, 3D 모델 검토가 끝나기 전에는 자재 산출표와 CSV/PDF 다운로드를 열지 않습니다. 높이 누락, 신뢰도 미확인, 개구부 위치 미확인, 벽체별 검토 상태가 남아 있으면 `partial`로 유지되어 발주 가능으로 표시하지 않습니다.

## 실행

```sh
npm install
npm run dev
```

검증 명령:

```sh
npm run check
```

`npm run check`는 TypeScript, ESLint/Oxlint, 도면·높이·3D·자재·절단·재고 회귀검사, API 서버 경계검사, 프로덕션 빌드를 순서대로 실행합니다. 개별 검사는 `npm run verify:all`, `npm run lint:check`, `npm run typecheck`로 나눠 실행할 수 있습니다.

공개자료 API 프록시는 기본적으로 꺼져 있습니다. 필요한 경우 [.env.example](./.env.example)과 [서버 실행 안내](./server/README.md)를 참고해 `.env.local`을 만든 뒤, 별도 터미널에서 `npm run api`와 `npm run dev`를 실행합니다. API 서버는 별도 설정이 없으면 `127.0.0.1:8787`에만 바인딩됩니다.

이번 전수 점검의 수정 근거, 회귀검사, 남은 제한사항은 [2026-08-14 코드 감사 보고서](./AUDIT-2026-08-14.md)에 정리했습니다.

## 현재 자동 분석 지원

- PDF: 페이지별 PDF.js 텍스트 추출, 숫자·단위 정규화, 텍스트 위치 보존, 스캔 페이지의 로컬 OCR fallback
- JPG / JPEG / PNG: 브라우저 전처리(그레이스케일·선명도 보정) 후 한국어+영어 Tesseract.js OCR, 단어별 위치와 신뢰도 보존
- 여러 파일 및 여러 페이지 PDF: 프로젝트 단위로 묶어 평면도·입면도·단면도 근거 연결
- 공사비 집계표: 월별 금액·합계 추출 및 개인정보 비식별화 후 비용 참고자료로만 저장

파일별 분석 단계는 `업로드 중 → 파일 종류 확인 중 → 도면 유형 분석 중 → 치수 추출 중 → 높이 정보 확인 중 → 분석 완료/일부 정보 확인 필요/분석 실패`로 표시됩니다.

추출 치수는 `value`, `unit`, `normalizedValueMm`, `sourceFile`, `pageNumber`, `drawingType`, `sourceText`, `sourcePosition`, `confidence`, `sourceType` 필드를 가지며, PDF 텍스트와 OCR 모두 원본 위치를 근거로 남깁니다. PDF 텍스트에 단위가 없으면 숫자 형식만으로 단위를 확정하지 않고 중간/낮은 신뢰도로 남깁니다.

도면 페이지에는 구역명, 방 이름, 축 번호, 축척, 단위 후보도 별도 메타데이터로 저장합니다. 인식되지 않은 항목은 성공으로 위장하지 않고 검토 필요 상태로 유지합니다.

DWG, DXF, IFC는 `src/modules/cad-parser-adapter.ts`에 어댑터 경계를 준비했지만 현재 파서는 연결하지 않았습니다. 업로드 시 성공으로 처리하지 않고 “현재 이 파일 형식은 자동 분석을 지원하지 않습니다.”라고 표시합니다.

## 구조

```text
src/
  components/
    Building3DViewer.vue          # Three.js 기반 회전·확대·벽체 선택 뷰어
    ConfidenceReviewPanel.vue     # 신뢰도·근거·사용자 확인값
  modules/
    file-loader.ts                # 형식 판별 및 파일 상태
    document-classifier.ts        # 평면도/입면도/단면도/비용표 분류
    pdf-extractor.ts              # PDF 텍스트·페이지 렌더·OCR fallback
    ocr-analyzer.ts               # 이미지 전처리·Tesseract OCR
    cad-parser-adapter.ts         # DWG/DXF/IFC 미지원 경계
    dimension-normalizer.ts       # 숫자·단위 → mm와 근거
    drawing-geometry-model.ts     # 벽체·구역·높이·개구부·지붕 geometry
    material-takeoff-engine.ts    # 벽체별 배치 기반 자재 계산
    inventory-cutting-engine.ts   # 보유 자재 우선 동일 폭 길이 절단 MVP
    export-report.ts              # CSV 및 인쇄/PDF 보고서
    cost-summary-parser.ts        # 비용표 전용 추출·마스킹
    project-store.ts              # localStorage 복원
    project-workflow.ts           # 업로드부터 발주 가능 판정까지 단계 전이
  types/domain.ts                 # 분석·근거·프로젝트 타입
```

## 안전한 계산 원칙

3D 뷰어는 Three.js의 실제 `BoxGeometry`를 사용합니다. 벽체 시작점·끝점은 PDF에 축척과 벡터 선분이 함께 있으면 PDF 벡터에서 가져오고, 그렇지 않으면 추출된 치수의 실제 길이를 유지한 순차 배치로 생성합니다. 후자의 경우 화면에 `치수 순서 기반 개략 배치`를 명시하며, 임의의 도면 좌표인 것처럼 표시하지 않습니다. 벽체 두께는 프로젝트의 판넬 두께 기준을 사용합니다.

문·창호는 폭·높이·벽체 시작점으로부터의 offset·창대 높이가 모두 확인된 경우에만 벽체 geometry를 분할해 실제 개구부를 만듭니다. 위치 근거가 없는 개구부는 면적 산출에는 확인된 규격만 반영하고, 3D 벽체를 임의로 뚫지 않으며 검토 대상으로 표시합니다. 평지붕 표기가 확인된 경우에만 roof slab을 생성하고, 박공·경사지붕은 경사도와 능선 위치가 없으면 생성하지 않습니다.

- 높이는 같은 도면 → 입면도 → 단면도 → 다른 페이지의 같은 구역 순으로 연결하며, 찾지 못하면 임의의 숫자를 넣지 않습니다.
- 높이가 없으면 3D geometry와 발주 수량을 차단하고 “높이 정보 없음 / 입면도 또는 단면도 필요” 상태를 표시합니다.
- PDF 텍스트 직접 추출은 높은 신뢰도, OCR·단위 불명확 값은 중간/낮은 신뢰도로 표시합니다. 사용자가 확인한 값은 `사용자 확인값`으로 저장합니다.
- 판넬은 전체 면적 나눗셈만 쓰지 않고 벽체별 길이·높이, 시공 방향, 유효 폭, 표준 길이, 개구부, 여유율, 절단 잔재를 반영합니다.
- 입력 파일은 외부 AI API로 전송하지 않습니다. 현재 AI 서버 연동은 없으며, AI 분석을 사용하려면 별도 서버 환경변수가 필요하다는 안내만 표시합니다.

절단 최적화 화면에는 소규모 현장용 `보유 자재 기반 절단 계획 MVP`가 포함됩니다. 직사각형 샌드위치패널·보드처럼 폭이 동일한 자재를 길이 방향으로만 비교하며, 도면의 필요 조각을 수정하거나 2차원 네스팅·곡선 자재·손상 판정을 자동화하지 않습니다. 높이·폭·두께·표면 마감·색상·도면 축척을 사람이 확인하기 전에는 계획을 만들지 않고, 계산 중에는 보유 재고를 변경하지 않으며 승인 후 보유 수량을 예약합니다. 화면의 `기본 예제 불러오기`에서 2,800mm 자재 우선 절단 흐름을 확인할 수 있습니다.

프로파일 부재 자동 추출은 아직 연결하지 않았습니다. 또한 서로 다른 원자재 길이를 비교할 때 길이별 실제 단가가 없으면 총비용 최소안으로 확정하지 않으며, 실제 발주 CSV에는 선택된 계획의 원자재 규격만 기록합니다.

## 실제 발주 전 확인

원본 도면의 치수·축척·개구부 규격, 구역별 층고, 현장 실측, 제조사 판넬 규격·부속품 시방, 절단·운반·시공 상세와 구조검토를 사람이 확인해야 합니다. 이 결과는 자재 산출용 개략 결과이며 구조검토나 설계 승인을 대신하지 않습니다.
