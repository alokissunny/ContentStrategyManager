import { describe, expect, it } from 'vitest'
import {
  accountSnapshot,
  classification,
  competitorAccount,
  contentAdoptionRecord,
  customer,
  finding,
  post,
  postMetricSnapshot,
} from './index'

describe('entity schemas', () => {
  it('parses a competitor account', () => {
    const result = competitorAccount.safeParse({
      id: 'comp-1',
      platform: 'instagram',
      username: 'atelierdawn',
      displayName: 'Atelier Dawn',
      profileImageUrl: null,
      website: 'https://atelierdawn.es',
      location: { country: 'Spain', region: 'Catalonia', city: 'Barcelona' },
      language: 'es',
      niche: 'interior-design',
      services: ['residential', 'kitchens'],
      specialization: 'kitchen renovations',
      targetAudience: null,
      positioningNote: null,
      role: 'high-performing-peer',
      approvalStatus: 'included-in-benchmarks',
      groupIds: ['grp-comparable'],
      relevantCustomerIds: ['cust-1'],
      internalNotes: null,
      latestFollowerCount: 18700,
      lastSuccessfulCollectionAt: '2026-07-19T08:00:00Z',
      dataQuality: 'complete',
      addedAt: '2026-05-01T10:00:00Z',
      addedBy: 'manual',
    })
    expect(result.success).toBe(true)
  })

  it('accepts snapshots with missing external fields as nulls', () => {
    const result = accountSnapshot.safeParse({
      id: 'snap-1',
      accountId: 'comp-1',
      collectedAt: '2026-07-19T08:00:00Z',
      collectionSource: 'mock',
      collectionRunId: null,
      username: 'atelierdawn',
      displayName: null,
      biography: null,
      website: null,
      category: null,
      followerCount: null,
      followingCount: null,
      visiblePostCount: null,
      verified: null,
      missingFields: ['followerCount', 'biography'],
      warnings: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a post without a platform id', () => {
    const base = {
      id: 'post-1',
      accountId: 'comp-1',
      url: null,
      publishedAt: '2026-07-01T11:00:00Z',
      caption: 'Why we lowered this ceiling on purpose',
      hashtags: ['#interiordesign'],
      mentions: [],
      format: 'reel',
      carouselCount: null,
      videoDurationSeconds: 34,
      mediaRef: null,
      collaborators: [],
      firstCollectedAt: '2026-07-02T08:00:00Z',
      deleted: false,
      metricsHidden: false,
      classificationStatus: 'classified',
    }
    expect(post.safeParse(base).success).toBe(false)
    expect(post.safeParse({ ...base, platformPostId: 'IG123' }).success).toBe(true)
  })

  it('requires model provenance on classifications', () => {
    const valid = classification.safeParse({
      id: 'cls-1',
      postId: 'post-1',
      dimension: 'hook',
      value: 'design-decision',
      confidence: 0.86,
      model: 'haiku-tier',
      modelVersion: null,
      promptVersion: 'hook-v1',
      classifiedAt: '2026-07-02T09:00:00Z',
      inputRef: 'post-1:caption:v1',
      reviewStatus: 'unreviewed',
      correction: null,
      correctionAuthor: null,
      correctionAt: null,
    })
    expect(valid.success).toBe(true)

    const missingPrompt = classification.safeParse({
      ...(valid.success ? valid.data : {}),
      promptVersion: undefined,
    })
    expect(missingPrompt.success).toBe(false)
  })

  it('requires the full sample context and limitations on a finding', () => {
    const result = finding.safeParse({
      id: 'find-1',
      title: 'High-performing peers explain design decisions more often',
      explanation:
        'Posts explaining a specific design decision appear more often among high-performing comparable accounts.',
      kind: 'stronger-account-difference',
      dimension: 'content-type',
      authorityPillar: 'credibility',
      focusValue: 22,
      comparisonValue: 8,
      valueUnit: 'percent-of-posts',
      metricDefinition:
        'Percentage of relevant posts classified as design-decision within the selected account group.',
      sample: {
        accountsAnalyzed: 24,
        postsAnalyzed: 186,
        dateRange: { from: '2026-05-20', to: '2026-06-20' },
        locations: [{ country: 'Spain', region: null, city: null }],
        followerRange: { min: 5000, max: 20000 },
        comparisonGroupLabel: 'Comparable (20–30)',
        lastCollectionDate: '2026-06-21T06:00:00Z',
      },
      evidenceStrength: 'moderate',
      evidenceKinds: ['observed-public-fact', 'ai-classification', 'calculated-metric'],
      limitations: ['Private reach, saves, shares and advertising influence are unknown.'],
      paidDistributionUncertainty: true,
      exampleAccountIds: ['comp-1'],
      examplePostIds: ['post-1'],
      recommendationReady: true,
      recommendationReadyReasons: ['Supported by 9 accounts', 'Sample above minimum thresholds'],
      reproducibilityNote: 'Customers with completed projects can reproduce this format.',
      suggestedExperiment: 'Add one design-decision post per week for 4 weeks.',
      relevantCustomerIds: ['cust-1'],
      humanReviewed: false,
      detectedAt: '2026-06-21T06:30:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('parses customer and adoption records', () => {
    expect(
      customer.safeParse({
        id: 'cust-1',
        name: 'Atelier Dawn',
        instagramUsername: 'atelierdawn',
        email: null,
        location: { country: 'Spain', region: null, city: 'Barcelona' },
        plan: 'studio',
        peerGroupId: 'grp-comparable',
        connectionStatus: 'connected',
        onboardingStage: 'first-content-published',
        reviewModeStatus: 'completed',
        status: 'improving',
        statusReason: 'Reach and saves up vs previous 30 days; publishing consistent.',
        latestFollowerCount: 18700,
        authorityGap: { discovery: 65, credibility: 72, trust: 58 },
        lastActivityAt: '2026-07-19T06:00:00Z',
        dataQuality: 'complete',
        createdAt: '2026-04-01T09:00:00Z',
      }).success,
    ).toBe(true)

    expect(
      contentAdoptionRecord.safeParse({
        id: 'adopt-1',
        customerId: 'cust-1',
        recommendationId: 'rec-1',
        contentType: 'design-decision',
        authorityPillar: 'credibility',
        deliveredAt: '2026-07-10T08:00:00Z',
        reviewedAt: '2026-07-10T18:00:00Z',
        decidedAt: '2026-07-10T18:05:00Z',
        publishedAt: null,
        outcome: 'edited',
        editIntensity: 'light-edit',
        correctionCategories: ['tone', 'cta'],
      }).success,
    ).toBe(true)
  })

  it('rejects negative metric values', () => {
    expect(
      postMetricSnapshot.safeParse({
        id: 'pm-1',
        postId: 'post-1',
        collectedAt: '2026-07-02T08:00:00Z',
        collectionRunId: null,
        likes: -5,
        comments: 0,
        views: null,
      }).success,
    ).toBe(false)
  })
})
