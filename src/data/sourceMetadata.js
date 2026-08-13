export const DATA_ORIGINS = {
  SAMPLE: 'sample',
  LIVE: 'live',
}

export const SAMPLE_VERIFIED_AT = '2026-08-05'

export function createSourceMetadata({
  provider,
  title,
  url,
  publishedAt = null,
  verifiedAt = null,
  retrievedAt = null,
  role = 'official',
}) {
  return {
    role,
    provider: provider ?? '공개자료',
    title: title ?? '공식 출처',
    url: url ?? '',
    publishedAt,
    verifiedAt,
    retrievedAt,
  }
}

export function withSampleProjectMetadata(item) {
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

export function withSampleCompanyMetadata(company) {
  const sources = [
    createSourceMetadata({
      provider: company.companyName,
      title: company.officialLinkLabel,
      url: company.officialUrl,
      verifiedAt: SAMPLE_VERIFIED_AT,
      role: 'official',
    }),
    createSourceMetadata({
      provider: company.evidenceTitle,
      title: company.evidenceTitle,
      url: company.evidenceUrl,
      verifiedAt: SAMPLE_VERIFIED_AT,
      role: 'evidence',
    }),
  ].filter((source) => source.url)

  return {
    ...company,
    dataOrigin: DATA_ORIGINS.SAMPLE,
    verifiedAt: SAMPLE_VERIFIED_AT,
    sources,
  }
}
