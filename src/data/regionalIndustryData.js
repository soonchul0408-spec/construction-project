import { withSampleProjectMetadata } from './sourceMetadata'

export const REGION_OPTIONS = [
  { value: '전체', label: '전체 지역' },
  { value: '전남 해남군', label: '전남 해남군' },
  { value: '경기도 용인시', label: '경기도 용인시' },
  { value: '울산광역시', label: '울산광역시' },
  { value: '경상남도 창원시', label: '경남 창원시' },
  { value: '경기도', label: '경기도' },
]

export const INDUSTRY_CATEGORIES = [
  { value: '전체', label: '전체' },
  { value: 'AI·데이터센터', label: 'AI·데이터센터' },
  { value: '반도체', label: '반도체' },
  { value: '방산', label: '방산' },
  { value: '이차전지', label: '이차전지' },
  { value: '전력·에너지', label: '전력·에너지' },
]

export const POLICY_STAGES = [
  { value: '전체', label: '전체' },
  { value: '발의', label: '발의' },
  { value: '심사 중', label: '심사 중' },
  { value: '예산안', label: '예산안' },
  { value: '사업 공고', label: '사업 공고' },
  { value: '사업자 선정', label: '사업자 선정' },
  { value: '착공', label: '착공' },
]

// 화면은 이 배열을 사용하지만, 이후 공공 API 응답을 같은 필드로 매핑해 교체할 수 있습니다.
const SAMPLE_REGIONAL_INDUSTRY_ITEMS = [
  {
    id: 'haenam-national-ai-computing-center',
    region: '전남 해남군',
    recordType: '사업',
    projectName: '해남 국가 AI컴퓨팅센터',
    category: 'AI·데이터센터',
    scale: '약 2조 9천억 원 · 40MW',
    stage: '사업자 선정',
    stageNote: '우선협상대상자 선정 공개자료',
    description:
      '해남 솔라시도에 AI 연구·서비스 개발을 위한 국가 AI컴퓨팅센터를 구축하는 사업입니다.',
    relatedCompanies: ['삼성SDS 컨소시엄'],
    relatedCompanyIds: ['samsung-sds', 'naver-cloud'],
    sourceTitle: '전라남도 보도자료',
    sourceDate: '2026.03.10',
    sourceUrl: 'https://www.jeonnam.go.kr/M7116/boardView.do?menuId=jeonnam0202000000&seq=1961088',
    timeline: [
      {
        date: '2026.03.10',
        title: '우선협상대상자 선정',
        description: '전라남도 보도자료에서 국가 AI컴퓨팅센터 관련 선정 내용을 확인했습니다.',
        type: 'success',
      },
    ],
  },
  {
    id: 'yongin-semiconductor-national-industrial-complex',
    region: '경기도 용인시',
    recordType: '정책·사업',
    projectName: '용인 반도체 국가산업단지 조성',
    category: '반도체',
    scale: '728만㎡ · 민간투자 최대 360조 원',
    stage: '착공',
    stageNote: '2026년 부지 착공 목표 공개자료',
    description:
      '산업단지계획 승인과 관계기관·기업 협약을 바탕으로 대규모 팹과 소재·부품·장비 생태계를 조성합니다.',
    relatedCompanies: ['삼성전자', '소부장 협력기업'],
    relatedCompanyIds: ['samsung-electronics'],
    sourceTitle: '국토교통부 정책뉴스',
    sourceDate: '2024.12.26',
    sourceUrl: 'https://www.korea.kr/news/policyNewsView.do?newsId=148937933',
    timeline: [
      {
        date: '2024.12.26',
        title: '산업단지계획 승인',
        description:
          '국토교통부 자료에서 국가산업단지 지정과 관계기관·기업 협약 내용을 확인했습니다.',
        type: 'success',
      },
      {
        date: '2026년 목표',
        title: '부지 착공 목표',
        description: '공개자료에 제시된 부지 착공 목표를 현재 진행 단계로 표시합니다.',
        type: 'warning',
      },
    ],
  },
  {
    id: 'ulsan-secondary-battery-specialized-complex',
    region: '울산광역시',
    recordType: '정책',
    projectName: '울산 국가첨단전략산업 이차전지 특화단지',
    category: '이차전지',
    scale: '6개 산업단지 기반 전주기 거점',
    stage: '사업 공고',
    stageNote: '특화단지 지원사업 공고 확인',
    description:
      '소재·셀·재활용을 잇는 이차전지 전주기 산업 기반을 지역에 조성하고 기업 지원사업을 연계합니다.',
    relatedCompanies: ['삼성SDI 등 공개자료 언급 기업'],
    relatedCompanyIds: ['samsung-sdi'],
    sourceTitle: '울산 국가첨단전략산업 이차전지 특화단지',
    sourceDate: '2026.07.13',
    sourceUrl: 'https://battery.utp.or.kr/business/program.php?id=22',
    timeline: [
      {
        date: '2023.07.20',
        title: '이차전지 특화단지 지정',
        description: '울산 국가첨단전략산업 이차전지 특화단지 지정 관련 공개자료를 확인했습니다.',
        type: 'success',
      },
      {
        date: '2026.07.13',
        title: '지원사업 공고 확인',
        description: '특화단지 지원사업 공고를 기준으로 관련 정보를 연결했습니다.',
        type: 'primary',
      },
    ],
  },
  {
    id: 'changwon-defense-innovation-cluster',
    region: '경상남도 창원시',
    recordType: '사업',
    projectName: '경남·창원 방산혁신클러스터',
    category: '방산',
    scale: '총사업비 490억 원 · 2020~2024 시범사업',
    stage: '사업자 선정',
    stageNote: '시범사업 지역 선정 공개자료',
    description:
      '지역의 산·학·연·군과 기업이 참여해 방산 소재·부품 개발, 시험평가와 기업 지원을 연결하는 사업입니다.',
    relatedCompanies: ['지역 방산 중소·벤처기업'],
    relatedCompanyIds: ['hanwha-aerospace'],
    sourceTitle: '방위사업청 보도자료',
    sourceDate: '2021.06.25',
    sourceUrl: 'https://www.dapa.go.kr/dapa/doc/selectDoc.do?bbsSeq=326&docSeq=13214&menuSeq=3069',
    timeline: [
      {
        date: '2020년',
        title: '시범사업 지역 선정',
        description: '경남·창원 지역이 방산혁신클러스터 시범사업 지역으로 선정되었습니다.',
        type: 'success',
      },
      {
        date: '2021.06.25',
        title: '성과 공개',
        description: '방위사업청이 지역 기반 방산혁신클러스터의 성과와 추진 내용을 공개했습니다.',
        type: 'primary',
      },
    ],
  },
  {
    id: 'gyeonggi-energy-data-pilot',
    region: '경기도',
    recordType: '사업 공고',
    projectName: '경기지역 민·관·공 에너지협의체 에너지데이터 분석 서비스 시범사업',
    category: '전력·에너지',
    scale: '지역 에너지 데이터 기반 시범사업',
    stage: '사업 공고',
    stageNote: '수행기관 모집 공개자료',
    description:
      '연료비와 전력요금 등 공개 데이터를 활용해 산업계의 에너지 대응을 돕는 지역 기반 분석 서비스 시범사업입니다.',
    relatedCompanies: ['지역 에너지 수요기업', '공공기관'],
    relatedCompanyIds: ['kepco-kdn'],
    sourceTitle: '한국에너지공단 공지사항',
    sourceDate: '2026.05.20',
    sourceUrl: 'https://www.energy.or.kr/front/board/View2.do?boardMngNo=2&boardNo=24567',
    timeline: [
      {
        date: '2026.05.20',
        title: '수행기관 모집 공개',
        description: '경기지역 에너지데이터 분석 서비스 시범사업 관련 공개자료를 확인했습니다.',
        type: 'primary',
      },
    ],
  },
]

export const REGIONAL_INDUSTRY_ITEMS = SAMPLE_REGIONAL_INDUSTRY_ITEMS.map(withSampleProjectMetadata)
