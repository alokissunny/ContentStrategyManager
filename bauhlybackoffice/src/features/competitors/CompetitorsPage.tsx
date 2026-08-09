import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  defaultCompetitorQuery,
  enrichCompetitorAccounts,
  getCompetitorDetail,
  listCompetitorIds,
  listCompetitors,
  scrapeCompetitorPosts,
  updateCompetitorBusinessCategory,
  updateCompetitorCountry,
  type CompetitorQuery,
} from '../../services/competitors/repository'
import type { BusinessCategory } from '../../types'
import { EmptyState } from '../../components/EmptyState'
import { StatCard } from '../../components/StatCard'
import { Sparkline } from '../intelligence/bits'
import { periodMeta } from '../../services/period'
import { CompetitorsIcon, PostsIcon } from '../../components/icons'
import { CompetitorFilterRow, CompetitorTable } from './CompetitorTable'
import { CompetitorDetailPanel } from './CompetitorDetail'
import { DeleteCompetitorsModal } from './DeleteCompetitorsModal'
import { RawPostsModal } from './RawPostsModal'
import './competitors.css'

interface CompetitorsPageProps {
  /** Business category chosen in the section header; 'all' shows every category. */
  businessCategory?: string
}

export function CompetitorsPage({ businessCategory = 'all' }: CompetitorsPageProps) {
  const [query, setQuery] = useState<CompetitorQuery>(defaultCompetitorQuery)
  // The category filter is driven by the section header, not the in-page filter
  // row, so merge it into the query the list/stats actually run against.
  const listQuery = { ...query, businessCategory }
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  /** Ids awaiting delete confirmation; null = dialog closed. */
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const [rawJsonFor, setRawJsonFor] = useState<{ id: string; username: string } | null>(null)
  const [scrapeNotice, setScrapeNotice] = useState<string | null>(null)
  const [enrichNotice, setEnrichNotice] = useState<string | null>(null)
  const [selectAllPending, setSelectAllPending] = useState(false)
  const queryClient = useQueryClient()

  // Drop selection when filters change so bulk actions never span a stale set.
  useEffect(() => {
    setSelected(new Set())
  }, [listQuery.search, listQuery.country, listQuery.followerRange, listQuery.businessCategory])

  const list = useQuery({
    queryKey: ['competitors', listQuery],
    queryFn: () => listCompetitors(listQuery),
    placeholderData: (prev) => prev,
  })
  const detail = useQuery({
    queryKey: ['competitor-detail', activeId, query.period],
    queryFn: () => (activeId ? getCompetitorDetail(activeId, query.period) : null),
    enabled: activeId != null,
    // Keep the panel mounted while refetching the same account (e.g. after
    // country / category edits). Do not reuse another account's detail.
    placeholderData: (prev) =>
      prev && activeId && prev.account.id === activeId ? prev : undefined,
  })

  const activeRow = list.data?.rows.find((r) => r.id === activeId) ?? null
  /** Show the rail as soon as a row is clicked — don't wait on the detail fetch. */
  const displayDetail =
    detail.data && detail.data.account.id === activeId
      ? detail.data
      : activeRow
        ? {
            account: activeRow,
            followerChange: activeRow.followerChange30d,
            postsCollected: 0,
            postsPerWeek: 0,
            medianEngagementRate: 0,
            authorityMix: [],
            topFormats: [],
            topTopics: [],
            lastCollectionAt: activeRow.lastSuccessfulCollectionAt,
            followerSeries: [],
          }
        : null

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['competitors'] })
    queryClient.invalidateQueries({ queryKey: ['competitor-suggestions'] })
    queryClient.invalidateQueries({ queryKey: ['collection-status'] })
    queryClient.invalidateQueries({ queryKey: ['competitor-locations'] })
    queryClient.invalidateQueries({ queryKey: ['competitor-filter-count'] })
    if (activeId) queryClient.invalidateQueries({ queryKey: ['competitor-detail', activeId] })
  }

  const scrapePosts = useMutation({
    mutationFn: (ids: string[]) => scrapeCompetitorPosts(ids),
    onSuccess: (plan) => {
      const started = plan.started.length
      const skipped = plan.skipped.length
      const parts: string[] = []
      if (started > 0) {
        parts.push(
          `Scraped last ${plan.windowDays} days of posts for ${started} account${started === 1 ? '' : 's'}.`,
        )
      }
      if (skipped > 0) {
        const names = plan.skipped.map((s) => `@${s.username}`).join(', ')
        parts.push(
          `Skipped ${skipped} already scraped within ${plan.windowDays} days: ${names}.`,
        )
      }
      if (started === 0 && skipped === 0) {
        parts.push('No matching accounts to scrape.')
      }
      setScrapeNotice(parts.join(' '))
      setEnrichNotice(null)
      setSelected(new Set())
      invalidate()
    },
    onError: (err) => {
      setScrapeNotice(err instanceof Error ? err.message : 'Failed to scrape posts.')
    },
  })

  const updateCategory = useMutation({
    mutationFn: ({ id, businessCategory }: { id: string; businessCategory: BusinessCategory }) =>
      updateCompetitorBusinessCategory(id, businessCategory),
    onSuccess: () => invalidate(),
  })

  const updateCountry = useMutation({
    mutationFn: ({ id, country }: { id: string; country: string | null }) =>
      updateCompetitorCountry(id, country),
    onSuccess: () => invalidate(),
  })

  const enrichAccounts = useMutation({
    mutationFn: (ids: string[]) => enrichCompetitorAccounts(ids),
    onSuccess: (plan) => {
      const parts: string[] = []
      if (plan.enriched.length > 0) {
        parts.push(
          `Enriched ${plan.enriched.length} account${plan.enriched.length === 1 ? '' : 's'}.`,
        )
      }
      if (plan.skipped.length > 0) {
        const names = plan.skipped.map((s) => `@${s.username}`).join(', ')
        parts.push(
          `Skipped ${plan.skipped.length} already enriched within ${plan.windowDays} days: ${names}.`,
        )
      }
      if (plan.failed.length > 0) {
        const names = plan.failed.map((f) => `@${f.username} (${f.error})`).join('; ')
        parts.push(`Failed ${plan.failed.length}: ${names}.`)
      }
      if (parts.length === 0) parts.push('No matching accounts to enrich.')
      setEnrichNotice(parts.join(' '))
      setScrapeNotice(null)
      setSelected(new Set())
      invalidate()
    },
    onError: (err) => {
      setEnrichNotice(err instanceof Error ? err.message : 'Failed to run enrichment.')
    },
  })

  const scraping = scrapePosts.isPending || enrichAccounts.isPending

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /**
   * Select every account matching the current filters (all pages), not just
   * the visible page — so Scrape posts / Run enrichment cover the full set.
   * Backend still skips accounts scraped/enriched within 30 days.
   */
  const toggleSelectAll = async () => {
    const total = list.data?.total ?? 0
    if (total > 0 && selected.size === total) {
      setSelected(new Set())
      return
    }
    setSelectAllPending(true)
    try {
      const ids = await listCompetitorIds(listQuery)
      setSelected(new Set(ids))
    } catch (err) {
      setScrapeNotice(err instanceof Error ? err.message : 'Failed to select all competitors.')
    } finally {
      setSelectAllPending(false)
    }
  }

  if (list.isError) {
    return (
      <EmptyState
        title="Couldn't load competitors"
        description="Something went wrong loading the competitor list."
        action={<button type="button" className="filter-clear" onClick={() => list.refetch()}>Retry</button>}
      />
    )
  }

  const stats = list.data?.stats

  return (
    <>
      <CompetitorFilterRow query={query} onChange={setQuery} />
      <div className={`comp-layout${activeId ? ' comp-layout--detail' : ''}`}>
        <div className="comp-main">

        {stats && (
          <div className="comp-stats-row">
            <StatCard
              icon={<CompetitorsIcon />}
              tone="blue"
              label="Total Competitors"
              value={stats.total}
              detail="accounts in the register"
            >
              <Sparkline data={stats.series[0]} />
            </StatCard>
            <StatCard
              icon={<PostsIcon />}
              tone="orange"
              label="Collected Posts"
              value={stats.collectedPosts.toLocaleString('en-US')}
              detail={periodMeta(query.period).current}
            >
              <Sparkline data={stats.series[3]} />
            </StatCard>
          </div>
        )}

        <div className={`panel${scraping ? ' panel--scraping' : ''}`}>
          {scrapePosts.isPending && (
            <div className="scrape-overlay" role="status" aria-live="polite" aria-label="Scraping posts">
              <div className="scrape-overlay-card">
                <span className="scrape-spinner" aria-hidden="true" />
                <p className="scrape-overlay-title">Scraping posts…</p>
                <p className="scrape-overlay-detail">
                  Fetching the last 30 days for {scrapePosts.variables?.length ?? selected.size} selected
                  account{(scrapePosts.variables?.length ?? selected.size) === 1 ? '' : 's'}.
                  This can take a minute or two.
                </p>
              </div>
            </div>
          )}
          {enrichAccounts.isPending && (
            <div className="scrape-overlay" role="status" aria-live="polite" aria-label="Running enrichment">
              <div className="scrape-overlay-card">
                <span className="scrape-spinner" aria-hidden="true" />
                <p className="scrape-overlay-title">Running enrichment…</p>
                <p className="scrape-overlay-detail">
                  Analysing profile and last-30-day posts for{' '}
                  {enrichAccounts.variables?.length ?? selected.size} selected
                  account{(enrichAccounts.variables?.length ?? selected.size) === 1 ? '' : 's'}.
                  Accounts enriched within 30 days are skipped.
                </p>
              </div>
            </div>
          )}
          {scrapeNotice && !scraping && (
            <div className="bulk-bar bulk-bar--notice" role="status">
              <span>{scrapeNotice}</span>
              <button type="button" className="btn-secondary" onClick={() => setScrapeNotice(null)}>
                Dismiss
              </button>
            </div>
          )}
          {enrichNotice && !scraping && (
            <div className="bulk-bar bulk-bar--notice" role="status">
              <span>{enrichNotice}</span>
              <button type="button" className="btn-secondary" onClick={() => setEnrichNotice(null)}>
                Dismiss
              </button>
            </div>
          )}
          {selected.size > 0 && (
            <div className="bulk-bar">
              <span>{selected.size} selected</span>
              <button
                type="button"
                className="btn-primary"
                disabled={scraping || selectAllPending}
                onClick={() => scrapePosts.mutate([...selected])}
              >
                {scrapePosts.isPending ? 'Scraping…' : 'Scrape posts'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={scraping || selectAllPending}
                onClick={() => enrichAccounts.mutate([...selected])}
              >
                {enrichAccounts.isPending ? 'Enriching…' : 'Run enrichment'}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={scraping || selectAllPending}
                onClick={() => setDeleting([...selected])}
              >
                Delete
              </button>
            </div>
          )}
          {list.isPending || !list.data ? (
            <div className="dashboard-loading" role="status" aria-label="Loading competitors">
              {Array.from({ length: 3 }, (_, i) => (
                <div className="skeleton-card" key={i} />
              ))}
            </div>
          ) : list.data.rows.length === 0 ? (
            <p className="panel-empty">No competitors match these filters.</p>
          ) : (
            <CompetitorTable
              result={list.data}
              query={query}
              onChange={setQuery}
              selected={selected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              selectAllPending={selectAllPending}
              activeId={activeId}
              onSelectRow={(id) => setActiveId(activeId === id ? null : id)}
              onShowRawJson={setRawJsonFor}
            />
          )}
        </div>
      </div>

      {activeId && displayDetail && (
        <CompetitorDetailPanel
          detail={displayDetail}
          period={query.period}
          onClose={() => setActiveId(null)}
          categorySaving={updateCategory.isPending}
          countrySaving={updateCountry.isPending}
          onBusinessCategoryChange={(businessCategory) => {
            if (!activeId) return
            updateCategory.mutate({ id: activeId, businessCategory })
          }}
          onCountryChange={(country) => {
            if (!activeId) return
            updateCountry.mutate({ id: activeId, country })
          }}
        />
      )}
      {activeId && !displayDetail && (
        <aside className="cust-detail" aria-busy="true" aria-label="Loading competitor details">
          <div className="dashboard-loading" role="status">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
        </aside>
      )}

      {rawJsonFor && (
        <RawPostsModal
          id={rawJsonFor.id}
          username={rawJsonFor.username}
          onClose={() => setRawJsonFor(null)}
        />
      )}

      {deleting && (
        <DeleteCompetitorsModal
          ids={deleting}
          usernames={(list.data?.rows ?? [])
            .filter((r) => deleting.includes(r.id))
            .map((r) => r.username)}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            // A deleted account may be the one open in the detail panel.
            if (activeId && deleting.includes(activeId)) setActiveId(null)
            setSelected(new Set())
            invalidate()
          }}
        />
      )}

      </div>
    </>
  )
}
