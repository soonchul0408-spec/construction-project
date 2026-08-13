// DART 기업 고유번호는 비밀값이 아니므로 서버 설정 파일에만 보관합니다.
// 기업별 지역·사업 연결 정보는 src/data/regionalIndustryCompanies.js가 계속 관리합니다.
export const DART_COMPANY_REGISTRY = Object.freeze([
  {
    companyId: 'samsung-sds',
    companyName: '삼성SDS',
    corpCode: '00126186',
    industries: ['AI·데이터센터'],
  },
  {
    companyId: 'samsung-electronics',
    companyName: '삼성전자',
    corpCode: '00126380',
    industries: ['반도체', 'AI·데이터센터'],
  },
  {
    companyId: 'samsung-sdi',
    companyName: '삼성SDI',
    corpCode: '00126362',
    industries: ['이차전지', '전력·에너지'],
  },
  {
    companyId: 'hanwha-aerospace',
    companyName: '한화에어로스페이스',
    corpCode: '00126566',
    industries: ['방산'],
  },
])
