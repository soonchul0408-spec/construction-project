import { INDUSTRY_CATEGORIES, REGION_OPTIONS } from './regionalIndustryData'
import { DATA_ORIGINS, SAMPLE_VERIFIED_AT, createSourceMetadata } from './sourceMetadata'

export const LEGISLATION_STAGES = [
  { value: '전체', label: '전체' },
  { value: '발의', label: '발의' },
  { value: '입법예고', label: '입법예고' },
  { value: '상임위 심사', label: '상임위 심사' },
  { value: '본회의 심사', label: '본회의 심사' },
  { value: '통과', label: '통과' },
  { value: '계류·폐기', label: '계류·폐기' },
]

export const LEGISLATION_INDUSTRY_CATEGORIES = INDUSTRY_CATEGORIES
export const LEGISLATION_REGION_OPTIONS = REGION_OPTIONS
export const SAVED_REGION_FILTER = '__saved_regions__'

const ASSEMBLY_SOURCE_URL = 'https://www.data.go.kr/data/15126134/openapi.do'

const SAMPLE_LEGISLATION_ITEMS = [
  {
    id: 'sample-assembly-ai-infrastructure-bill',
    billNumber: '2200001',
    recordType: '법안',
    billName: '국가 인공지능 기반시설 확충을 위한 특별법안',
    proposedAt: '2026.02.14',
    proposer: '국회의원 공동발의 예시',
    responsibleOrg: '국회 과학기술정보방송통신위원회',
    stage: '입법예고',
    rawStage: '입법예고 예시',
    region: '전국',
    category: 'AI·데이터센터',
    regionBasis: '법안 적용 범위 공개자료 기준',
    categoryBasis: '법안명·제안 취지의 키워드 분류 예시',
    description:
      'AI 연구·서비스에 필요한 컴퓨팅 인프라와 데이터센터 지원 체계를 마련하는 내용을 담은 법안 예시입니다.',
    stageNote: '입법예고 단계의 샘플 기록입니다. 후속 심사·예산 여부는 별도 확인이 필요합니다.',
    sourceTitle: '국회 국회사무처 의안정보 통합 API',
    sourceDate: '2026.02.14',
    sourceUrl: ASSEMBLY_SOURCE_URL,
    timeline: [
      {
        date: '2026.02.14',
        title: '법안 제안',
        description: '공개자료 기반 샘플 법안의 제안일을 표시합니다.',
        type: 'primary',
      },
      {
        date: '2026.03.04',
        title: '입법예고',
        description: '입법예고 단계로 분류한 샘플 상태입니다.',
        type: 'warning',
      },
    ],
  },
  {
    id: 'sample-assembly-semiconductor-bill',
    billNumber: '2200002',
    recordType: '법안',
    billName: '국가첨단전략산업 경쟁력 강화법 일부개정법률안',
    proposedAt: '2025.11.21',
    proposer: '국회의원 공동발의 예시',
    responsibleOrg: '국회 산업통상자원중소벤처기업위원회',
    stage: '상임위 심사',
    rawStage: '소관위원회 심사 예시',
    region: '경기도 용인시',
    category: '반도체',
    regionBasis: '용인 국가산업단지 관련 공개자료 연결 예시',
    categoryBasis: '법안명·산업 분야 키워드 분류 예시',
    description:
      '첨단전략산업의 기반시설과 소재·부품·장비 생태계 지원을 강화하는 내용을 담은 법안 예시입니다.',
    stageNote: '상임위원회 심사 단계의 샘플 기록입니다.',
    sourceTitle: '국회 국회사무처 의안정보 통합 API',
    sourceDate: '2025.11.21',
    sourceUrl: ASSEMBLY_SOURCE_URL,
    timeline: [
      {
        date: '2025.11.21',
        title: '법안 제안',
        description: '공개자료 기반 샘플 법안의 제안일을 표시합니다.',
        type: 'primary',
      },
      {
        date: '2026.01.22',
        title: '상임위 심사',
        description: '소관 상임위원회 심사 단계로 분류한 샘플 상태입니다.',
        type: 'warning',
      },
    ],
  },
  {
    id: 'sample-assembly-defense-bill',
    billNumber: '2200003',
    recordType: '법안',
    billName: '지역 방위산업 혁신생태계 조성에 관한 법률안',
    proposedAt: '2025.08.09',
    proposer: '국회의원 공동발의 예시',
    responsibleOrg: '국회 국방위원회',
    stage: '본회의 심사',
    rawStage: '본회의 심사 예시',
    region: '경상남도 창원시',
    category: '방산',
    regionBasis: '창원 방산혁신클러스터 공개자료 연결 예시',
    categoryBasis: '법안명·산업 분야 키워드 분류 예시',
    description:
      '방산 소재·부품과 지역 기업, 연구기관의 협력 기반을 지원하는 내용을 담은 법안 예시입니다.',
    stageNote: '본회의 심사 단계의 샘플 기록입니다.',
    sourceTitle: '국회 국회사무처 의안정보 통합 API',
    sourceDate: '2025.08.09',
    sourceUrl: ASSEMBLY_SOURCE_URL,
    timeline: [
      {
        date: '2025.08.09',
        title: '법안 제안',
        description: '공개자료 기반 샘플 법안의 제안일을 표시합니다.',
        type: 'primary',
      },
      {
        date: '2026.05.18',
        title: '본회의 심사',
        description: '본회의 심사 단계로 분류한 샘플 상태입니다.',
        type: 'primary',
      },
    ],
  },
  {
    id: 'sample-assembly-battery-bill',
    billNumber: '2200004',
    recordType: '법안',
    billName: '이차전지 소재·부품·장비 산업 지원법안',
    proposedAt: '2026.06.03',
    proposer: '국회의원 공동발의 예시',
    responsibleOrg: '국회 산업통상자원중소벤처기업위원회',
    stage: '발의',
    rawStage: '발의 예시',
    region: '울산광역시',
    category: '이차전지',
    regionBasis: '울산 이차전지 특화단지 공개자료 연결 예시',
    categoryBasis: '법안명·산업 분야 키워드 분류 예시',
    description:
      '이차전지 소재·부품·장비 기업의 연구개발과 공급망 협력을 지원하는 내용을 담은 법안 예시입니다.',
    stageNote: '제안일을 기준으로 발의 단계에 둔 샘플 기록입니다.',
    sourceTitle: '국회 국회사무처 의안정보 통합 API',
    sourceDate: '2026.06.03',
    sourceUrl: ASSEMBLY_SOURCE_URL,
    timeline: [
      {
        date: '2026.06.03',
        title: '법안 제안',
        description: '공개자료 기반 샘플 법안의 제안일을 표시합니다.',
        type: 'primary',
      },
    ],
  },
  {
    id: 'sample-assembly-power-bill',
    billNumber: '2200005',
    recordType: '법안',
    billName: '지역 전력망 확충 및 에너지전환 지원 특별법안',
    proposedAt: '2024.04.17',
    proposer: '국회의원 공동발의 예시',
    responsibleOrg: '국회 산업통상자원중소벤처기업위원회',
    stage: '통과',
    rawStage: '가결·통과 예시',
    region: '전남 해남군',
    category: '전력·에너지',
    regionBasis: '해남 재생에너지·AI컴퓨팅센터 공개자료 연결 예시',
    categoryBasis: '법안명·산업 분야 키워드 분류 예시',
    description:
      '지역 전력망과 재생에너지 기반시설 확충을 지원하는 내용을 담은 법안 예시입니다.',
    stageNote: '통과로 표시된 샘플 상태이며, 개별 사업과 예산 편성 여부는 별도 자료입니다.',
    sourceTitle: '국회 국회사무처 의안정보 통합 API',
    sourceDate: '2024.04.17',
    sourceUrl: ASSEMBLY_SOURCE_URL,
    timeline: [
      {
        date: '2024.04.17',
        title: '법안 제안',
        description: '공개자료 기반 샘플 법안의 제안일을 표시합니다.',
        type: 'primary',
      },
      {
        date: '2025.12.19',
        title: '통과',
        description: '통과 단계로 분류한 샘플 상태입니다.',
        type: 'success',
      },
    ],
  },
  {
    id: 'sample-assembly-gunsan-battery-bill',
    billNumber: '2200006',
    recordType: '법안',
    billName: '지역 이차전지 투자촉진 특별법안',
    proposedAt: '2023.09.12',
    proposer: '국회의원 공동발의 예시',
    responsibleOrg: '국회 기획재정위원회',
    stage: '계류·폐기',
    rawStage: '계류·폐기 예시',
    region: '전북 군산시',
    category: '이차전지',
    regionBasis: '새만금 이차전지 산업 관련 공개자료 연결 예시',
    categoryBasis: '법안명·산업 분야 키워드 분류 예시',
    description:
      '지역 이차전지 산업단지에 대한 투자와 기반시설 지원을 다루는 법안 예시입니다.',
    stageNote: '원본 처리 상태를 함께 확인해야 하는 샘플 단계입니다.',
    sourceTitle: '국회 국회사무처 의안정보 통합 API',
    sourceDate: '2023.09.12',
    sourceUrl: ASSEMBLY_SOURCE_URL,
    timeline: [
      {
        date: '2023.09.12',
        title: '법안 제안',
        description: '공개자료 기반 샘플 법안의 제안일을 표시합니다.',
        type: 'primary',
      },
      {
        date: '2026.01.30',
        title: '계류·폐기',
        description: '계류 또는 폐기 상태를 함께 확인해야 하는 샘플입니다.',
        type: 'danger',
      },
    ],
  },
]

function withSampleMetadata(item) {
  const source = createSourceMetadata({
    provider: item.sourceTitle,
    title: item.sourceTitle,
    url: item.sourceUrl,
    publishedAt: item.sourceDate,
    verifiedAt: SAMPLE_VERIFIED_AT,
  })

  return {
    ...item,
    dataOrigin: DATA_ORIGINS.SAMPLE,
    verifiedAt: SAMPLE_VERIFIED_AT,
    source,
    sources: [source],
  }
}

export const LEGISLATION_ITEMS = SAMPLE_LEGISLATION_ITEMS.map(withSampleMetadata)
