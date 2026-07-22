/*
 * Integration catalogue.
 *
 * Modelled on how analytics tools present integrations: a searchable
 * catalogue grouped by what the integration is *for*, each entry stating what
 * it brings into the product, its connection status, and who owns it. Adding
 * a future integration means appending one entry here — the page needs no
 * changes.
 */

export type IntegrationStatus = 'connected' | 'not-connected' | 'coming-soon'

export type IntegrationCategory = 'Competitor data' | 'Market signals'

export interface Integration {
  id: string
  name: string
  vendor: string
  category: IntegrationCategory
  /** One line: what this brings into Bauhly. */
  summary: string
  /** What the backoffice does with it, in plain language. */
  provides: string[]
  status: IntegrationStatus
  /** Shown when connected. */
  lastSyncAt: string | null
  /** What the engineer needs to supply; never the secret itself. */
  requires: string
  docsLabel: string
}

export const integrations: Integration[] = [
  {
    id: 'apify',
    name: 'Apify',
    vendor: 'apify.com',
    category: 'Competitor data',
    summary: 'Collects public competitor profiles and posts from Instagram.',
    provides: [
      'Profile snapshots (followers, biography, category)',
      'Recent posts with captions, format and public metrics',
      'Scheduled refreshes for approved competitors',
    ],
    status: 'not-connected',
    lastSyncAt: null,
    requires: 'An Apify API token, stored server-side',
    docsLabel: 'How competitor collection works',
  },
  {
    id: 'google-trends',
    name: 'Google Trends',
    vendor: 'trends.google.com',
    category: 'Market signals',
    summary: 'Search interest for the topics competitors post about.',
    provides: [
      'Relative search interest per topic and region',
      'Rising and falling queries alongside post-share data',
      'A demand-side check on what competitors publish',
    ],
    status: 'not-connected',
    lastSyncAt: null,
    requires: 'A Google Trends data source or approved third-party API',
    docsLabel: 'Reading search interest vs post share',
  },
]

export const integrationCategories: IntegrationCategory[] = ['Competitor data', 'Market signals']
