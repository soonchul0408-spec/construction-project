# 공개 API 프록시

이 서버는 지방재정365 계약현황 API, 국회 의안정보 API, 금융감독원 OpenDART API의 인증키를 브라우저에 전달하지 않고 `/api` 경로로 공개자료를 중계합니다.

## 로컬 실행

1. `.env.example`을 복사해 `.env.local`을 만들고 사용할 제공기관의 서버 환경변수를 입력합니다.
2. 지역 계약 API는 `VITE_API_ENABLED=true`, 법안 API는 `VITE_LEGISLATION_API_ENABLED=true`, DART API는 `VITE_DART_API_ENABLED=true`로 각각 켭니다. 예제의 기본값은 연결 실패를 반복하지 않도록 모두 `false`입니다.
3. `npm run api`로 API 서버를 실행합니다.
4. 별도 터미널에서 `npm run dev`를 실행합니다.

서버는 기본적으로 `127.0.0.1:8787`에만 바인딩됩니다. Host 헤더도 `localhost`, `127.0.0.1`, `[::1]`과 명시한 호스트만 허용합니다. 컨테이너나 별도 호스트에서 외부 바인딩이 꼭 필요할 때만 `API_SERVER_HOST=0.0.0.0`처럼 설정하고, `API_SERVER_ALLOWED_HOSTS=construction.example.com`, 정확한 `CORS_ORIGIN`, 방화벽·리버스 프록시·TLS를 함께 구성하세요.

성공한 제공기관 응답은 기본 60초 동안 메모리에 캐시되고, 같은 경로의 동시 요청은 하나의 원천 호출로 합쳐집니다. 소켓 IP당 기본 분당 60회 제한이며 다음 값으로 조정할 수 있습니다.

- `API_CACHE_TTL_MS`: 성공 응답 캐시 시간, `0`이면 비활성화
- `API_RATE_LIMIT_WINDOW_MS`: 요청 제한 윈도우
- `API_RATE_LIMIT_MAX_REQUESTS`: 윈도우당 최대 요청 수
- `API_SERVER_ALLOWED_HOSTS`: 포트 없는 허용 Host 이름 목록
- `API_TRUSTED_PROXY_ADDRESSES`: 실제로 신뢰하는 리버스 프록시의 소켓 IP 목록

기본값에서는 전달 헤더를 신뢰하지 않습니다. 리버스 프록시 뒤에서 사용자별 제한이 필요하면 프록시가 `X-Forwarded-For`에 실제 연결 IP를 append하도록 설정한 뒤 그 프록시 IP만 `API_TRUSTED_PROXY_ADDRESSES`에 넣으세요. 서버는 오른쪽부터 신뢰 hop을 제거해 첫 비신뢰 IP를 사용하므로 클라이언트가 앞에 붙인 위조 값은 키로 쓰지 않습니다. 운영 환경에서는 프록시 계층에도 별도 요청 제한을 두세요.

## 제공기관 설정

`LOFIN_CONTRACT_API_URL`은 공공데이터포털의 「행정안전부_지방재정365_계약현황」 활용 안내에서 확인한 공식 HTTPS API URL을 사용합니다. `*.lofin365.go.kr` 또는 `*.data.go.kr` 주소만 허용되며 서비스키는 `LOFIN_CONTRACT_API_KEY`에만 입력합니다.

국회 의안정보 API는 공공데이터포털의 「국회 국회사무처_의안정보 통합 API」 활용신청 후 공식 HTTPS URL을 `ASSEMBLY_BILL_API_URL`에 입력합니다. `*.assembly.go.kr` 또는 `*.data.go.kr` 주소만 허용됩니다. 서비스키는 `ASSEMBLY_BILL_API_KEY`에만 입력하고 `ASSEMBLY_BILL_KEY_PARAM`은 API 가이드의 키 파라미터 이름에 맞춥니다. XML 응답은 서버에서 JSON으로 변환한 뒤 법안 표시용 허용 필드만 `items`로 반환합니다.

세 제공기관 요청은 redirect를 따라가지 않고, 연결의 개별 timeout뿐 아니라 전체 8초 deadline과 1~2MB 응답 상한을 함께 적용합니다.

DART 기업정보는 `DART_API_KEY`를 서버 환경변수로만 읽습니다. 기업 고유번호 매핑은 `server/providers/dartCompanyRegistry.js`에서 관리합니다. 브라우저에는 기업명·종목코드·업종·주소·안전한 웹 URL과 최근 공시에 필요한 필드만 반환하며 법인등록번호, 사업자등록번호, 전화·팩스 등 사용하지 않는 원천 필드는 전달하지 않습니다.

지역 계약 응답도 화면 정규화에 필요한 계약명, 금액, 날짜, 업체, 지역, 설명, 출처 필드만 반환합니다. 오류 코드가 든 제공기관 응답은 실제 자료로 취급하지 않습니다. 프론트엔드는 `src/services/api/normalizers.js`, `src/services/api/legislationMappers.js`, `src/services/api/dartMappers.js`에서 반환값을 화면 구조로 변환하며, 키 누락·빈 응답·원천 장애 시 기존 샘플 데이터를 표시합니다.
