import { withSampleCompanyMetadata } from './sourceMetadata'

export const COMPANY_RELATION_STATUSES = [
  {
    value: '산업 관련 기업',
    type: 'info',
    description: '사업의 산업 분야와 주요 사업이 연결되는 기업',
  },
  {
    value: '컨소시엄 참여 기업',
    type: 'success',
    description: '공개자료에서 컨소시엄 또는 협약 참여가 확인된 기업',
  },
  {
    value: '공급계약 확인 기업',
    type: 'warning',
    description: '공식 자료에서 관련 제품·서비스 공급계약이 확인된 기업',
  },
  {
    value: '수주 공시 확인 기업',
    type: 'danger',
    description: '공식 자료에서 관련 산업의 수주·계약 발표가 확인된 기업',
  },
  {
    value: '관련성만 확인된 기업',
    type: '',
    description: '산업 연결성은 확인되지만 해당 사업 직접 참여는 확인되지 않은 기업',
  },
]

// 기업 데이터는 이후 DART API 응답을 같은 필드로 매핑해 교체할 수 있습니다.
const SAMPLE_REGIONAL_INDUSTRY_COMPANIES = [
  {
    id: 'samsung-sds',
    projectIds: ['haenam-national-ai-computing-center'],
    companyName: '삼성SDS',
    mainBusiness: 'AI 클라우드·데이터센터·디지털 물류',
    industries: ['AI·데이터센터'],
    relationStatus: '컨소시엄 참여 기업',
    relationReason:
      'AI 클라우드와 데이터센터 설계·구축·운영 역량을 보유하고 있으며, 해남 국가 AI컴퓨팅센터 공개자료에서 컨소시엄으로 언급되었습니다.',
    directParticipation: '확인됨',
    connectionBasis:
      '전라남도 보도자료에 삼성SDS 컨소시엄의 국가 AI컴퓨팅센터 우선협상대상자 선정 내용이 기재되어 있습니다.',
    officialUrl: 'https://www.samsungsds.com/kr/company/overview/about_comp_over.html',
    officialLinkLabel: '삼성SDS 회사소개',
    evidenceUrl:
      'https://www.jeonnam.go.kr/M7116/boardView.do?menuId=jeonnam0202000000&seq=1961088',
    evidenceTitle: '전라남도 보도자료',
  },
  {
    id: 'naver-cloud',
    projectIds: ['haenam-national-ai-computing-center'],
    companyName: '네이버클라우드',
    mainBusiness: '클라우드 플랫폼·AI 서비스·데이터 인프라',
    industries: ['AI·데이터센터'],
    relationStatus: '관련성만 확인된 기업',
    relationReason:
      'AI·클라우드 플랫폼과 대규모 인프라 사업을 운영해 산업 연관성이 확인되지만, 해남 사업 직접 참여는 공개자료에서 확인되지 않았습니다.',
    directParticipation: '확인되지 않음',
    connectionBasis:
      '네이버클라우드 공식 소개에서 AI·클라우드 플랫폼 사업이 확인되며, 해당 사업 참여 여부는 별도 공개자료 확인이 필요합니다.',
    officialUrl: 'https://www.navercloudcorp.com/ko/info/',
    officialLinkLabel: '네이버클라우드 소개',
    evidenceUrl:
      'https://www.jeonnam.go.kr/M7116/boardView.do?menuId=jeonnam0202000000&seq=1961088',
    evidenceTitle: '전라남도 보도자료',
  },
  {
    id: 'samsung-electronics',
    projectIds: ['yongin-semiconductor-national-industrial-complex'],
    companyName: '삼성전자',
    mainBusiness: '메모리·파운드리·시스템반도체',
    industries: ['반도체', 'AI·데이터센터'],
    relationStatus: '컨소시엄 참여 기업',
    relationReason:
      '용인 반도체 국가산업단지의 입주기업·관계기관 협약과 대규모 반도체 생산 거점 조성에 연결됩니다.',
    directParticipation: '확인됨',
    connectionBasis:
      '국토교통부 자료에 삼성전자와 LH 간 입주 실시협약 및 용인 반도체 국가산업단지 조성 내용이 기재되어 있습니다.',
    officialUrl: 'https://semiconductor.samsung.com/about-us/',
    officialLinkLabel: '삼성반도체 회사소개',
    evidenceUrl: 'https://www.korea.kr/news/policyNewsView.do?newsId=148937933',
    evidenceTitle: '국토교통부 정책뉴스',
  },
  {
    id: 'samsung-sdi',
    projectIds: ['ulsan-secondary-battery-specialized-complex'],
    companyName: '삼성SDI',
    mainBusiness: '전기차·ESS·IT 배터리·전자재료',
    industries: ['이차전지', '전력·에너지'],
    relationStatus: '공급계약 확인 기업',
    relationReason:
      '울산 이차전지 특화단지의 산업 분야와 배터리 사업이 연결되며, 공식 자료에서 배터리 공급계약이 확인됩니다.',
    directParticipation: '확인되지 않음',
    connectionBasis:
      '울산 이차전지 산업 공개자료에서 삼성SDI 등 관련 기업의 투자·산업 연계가 언급되고, 삼성SDI 공식 자료에서 배터리 공급계약이 확인됩니다. 울산 사업 직접 참여 여부는 별도 공개자료 확인이 필요합니다.',
    officialUrl: 'https://samsungsdi.com/about-sdi/index.html',
    officialLinkLabel: '삼성SDI 회사소개',
    evidenceUrl: 'https://www.samsungsdi.com/sdi-now/sdi-news/3442.html?idx=3442',
    evidenceTitle: '삼성SDI 공급계약 자료',
  },
  {
    id: 'hanwha-aerospace',
    projectIds: ['changwon-defense-innovation-cluster'],
    companyName: '한화에어로스페이스',
    mainBusiness: '지상·항공·해양 방산·항공엔진',
    industries: ['방산'],
    relationStatus: '수주 공시 확인 기업',
    relationReason:
      '창원 생산 거점과 방산 체계·엔진 사업을 보유해 경남·창원 방산 산업과 연결됩니다.',
    directParticipation: '확인되지 않음',
    connectionBasis:
      '한화에어로스페이스 공식 자료에서 창원공장 1의 KF-21 엔진 생산 및 방산 계약이 확인됩니다. 경남·창원 방산혁신클러스터 사업의 직접 참여는 공개자료에서 확인되지 않았습니다.',
    officialUrl: 'https://www.hanwhaaerospace.com/eng/whoweare/about.do',
    officialLinkLabel: '한화에어로스페이스 기업소개',
    evidenceUrl: 'https://www.hanwhaaerospace.com/eng/media/newsroom/view.do?seq=413',
    evidenceTitle: '한화에어로스페이스 공식 계약 자료',
  },
  {
    id: 'kepco-kdn',
    projectIds: ['gyeonggi-energy-data-pilot'],
    companyName: '한전KDN',
    mainBusiness: '에너지ICT·전력계통·에너지 데이터 서비스',
    industries: ['전력·에너지'],
    relationStatus: '산업 관련 기업',
    relationReason:
      '전력·에너지 데이터와 ICT 기반 서비스를 제공해 경기지역 에너지데이터 분석 사업과 산업적으로 연결됩니다.',
    directParticipation: '확인되지 않음',
    connectionBasis:
      '한전KDN 공식 자료에서 에너지ICT, 전력정보 효율화와 에너지 빅데이터 서비스가 확인됩니다. 해당 시범사업 수행기관 또는 직접 계약은 공개자료에서 확인되지 않았습니다.',
    officialUrl: 'https://www.kdn.com/menu.kdn?mid=a10100000000',
    officialLinkLabel: '한전KDN 회사소개',
    evidenceUrl: 'https://kdn.com/menu.kdn?mid=a10208000000',
    evidenceTitle: '한전KDN 에너지ICT 소개',
  },
]

export const REGIONAL_INDUSTRY_COMPANIES = SAMPLE_REGIONAL_INDUSTRY_COMPANIES.map(
  withSampleCompanyMetadata,
)
