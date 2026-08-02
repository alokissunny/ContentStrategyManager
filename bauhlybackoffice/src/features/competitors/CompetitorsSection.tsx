import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addCompetitor,
  addCompetitorsBulk,
  getCollectionStatus,
  listSuggestions,
  resolveSuggestion,
  runCompetitorAnalysis,
  type BulkCompetitorInput,
  type NewCompetitorInput,
} from '../../services/competitors/repository'
import { IntelligencePage } from '../intelligence/IntelligencePage'
import { getAnalysisReportMarkdown } from '../../services/intelligence/repository'
import { defaultFilters, filterOptions, type FilterState } from '../../services/intelligence/filters'

import { periodToDays } from '../../services/intelligence/filterScope'
import { CompetitorsPage } from './CompetitorsPage'
import { AddCompetitorForm, Modal, SuggestionList } from './modals'
import { RefreshIcon } from '../../components/icons'
import { FilterActionsProvider, PageActions, PageCenterActions } from '../../app/shell/pageActions'
import { ApiError } from '../../services/api'
import './competitors.css'

const TABS = [
  { to: '/competitors-overview', label: 'Overview' },
  { to: '/competitors', label: 'Accounts' },
]

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return 'never'
  const hours = Math.max(1, Math.round((Date.now() - time) / 3_600_000))
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

export function CompetitorsSection() {
  const { pathname } = useLocation()
  const onAccounts = pathname === '/competitors'
  const [modal, setModal] = useState<'add' | 'discover' | 'confirm-analysis' | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const queryClient = useQueryClient()

  const slug = (v: string) =>
    v.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'cohort'

  const downloadReport = async () => {
    setDownloading(true)
    setAnalysisError(null)
    try {
      const markdown = await getAnalysisReportMarkdown(filters)
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `analysis-${slug(filters.businessCategory)}-${slug(filters.location)}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setAnalysisError(
        err instanceof ApiError
          ? err.status === 404
            ? 'No saved report for this cohort yet — run analysis first.'
            : err.message
          : 'Could not download the report.',
      )
    } finally {
      setDownloading(false)
    }
  }

  const suggestions = useQuery({ queryKey: ['competitor-suggestions'], queryFn: listSuggestions })
  const collection = useQuery({ queryKey: ['collection-status'], queryFn: getCollectionStatus })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['competitors'] })
    queryClient.invalidateQueries({ queryKey: ['competitor-suggestions'] })
    queryClient.invalidateQueries({ queryKey: ['competitor-locations'] })
    queryClient.invalidateQueries({ queryKey: ['competitor-filter-count'] })
  }

  const addMutation = useMutation({
    mutationFn: (input: NewCompetitorInput) => addCompetitor(input),
    onSuccess: () => {
      setModal(null)
      setAddError(null)
      invalidate()
    },
    onError: (error: Error) => setAddError(error.message),
  })

  const bulkAddMutation = useMutation({
    mutationFn: (input: BulkCompetitorInput) => addCompetitorsBulk(input),
    onSuccess: () => {
      setAddError(null)
      invalidate()
    },
    onError: (error: Error) => setAddError(error.message),
  })

  const suggestionMutation = useMutation({
    mutationFn: ({
      id,
      resolution,
      reason,
    }: {
      id: string
      resolution: 'approved' | 'rejected' | 'saved-for-later'
      reason?: string
    }) => resolveSuggestion(id, resolution, reason),
    onSuccess: invalidate,
  })

  const analysisMutation = useMutation({
    mutationFn: (input: {
      location: string
      followerRangeLabel: string
      businessCategory: string
      period: string
      windowDays: number
    }) => runCompetitorAnalysis(input),
    onSuccess: (result) => {
      setAnalysisError(result.status === 'failed' ? result.error : null)
      queryClient.setQueryData(['competitor-analysis'], result)
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error: Error) => {
      setAnalysisError(error instanceof ApiError ? error.message : error.message)
      queryClient.invalidateQueries({ queryKey: ['competitor-analysis'] })
    },
  })

  const runAnalysis = (f: FilterState = filters) =>
    analysisMutation.mutate({
      location: f.location,
      followerRangeLabel: f.followerRangeLabel,
      businessCategory: f.businessCategory,
      period: f.period,
      windowDays: periodToDays(f.period),
    })

  const requestRunAnalysis = () => setModal('confirm-analysis')

  const confirmRunAnalysis = () => {
    setModal(null)
    runAnalysis(filters)
  }

  const businessTypeLabel =
    filterOptions.businessCategory.find((o) => o.value === filters.businessCategory)?.label ??
    filters.businessCategory
  const periodLabel =
    filterOptions.period.find((o) => o.value === filters.period)?.label ?? filters.period

  return (
    <FilterActionsProvider>
    <div>
      {/* Business type + Run analysis live in the header on both the Overview
          and Accounts tabs, so the register can be re-analysed from either. */}
      <PageCenterActions>
        <div className="topbar-field">
          <label htmlFor="overview-business-type">Business type</label>
          <select
            id="overview-business-type"
            value={filters.businessCategory}
            onChange={(e) => setFilters({ ...filters, businessCategory: e.target.value })}
          >
            {filterOptions.businessCategory.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </PageCenterActions>
      <PageActions>
        <span
          className="collection-status"
          title={
            collection.data
              ? `${collection.data.accountsProcessed} accounts processed, ${collection.data.postsCollected.toLocaleString('en-US')} posts collected, ${collection.data.failures} failed`
              : undefined
          }
        >
          <RefreshIcon width={14} height={14} />
          Last scrape {collection.data ? relativeTime(collection.data.lastRunAt) : '…'}
          {collection.data ? ` · ${collection.data.source}` : ''}
        </span>
        <button
          type="button"
          className="btn-secondary"
          disabled={downloading}
          onClick={downloadReport}
        >
          {downloading ? 'Preparing…' : 'Download report (.md)'}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={analysisMutation.isPending}
          onClick={requestRunAnalysis}
        >
          {analysisMutation.isPending ? 'Analysing…' : 'Run analysis'}
        </button>
      </PageActions>

      <div className="section-bar">
        <div className="review-tabs" role="tablist" aria-label="Competitor views">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              role="tab"
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {t.label}
            </NavLink>
          ))}
        </div>

        <div className="section-bar-actions">
          <button type="button" className="btn-secondary" onClick={() => setModal('discover')}>
            ✦ Discover
            {suggestions.data && suggestions.data.length > 0 && (
              <span className="count-pill">{suggestions.data.length}</span>
            )}
          </button>
          <button
            type="button"
            className={onAccounts ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setModal('add')}
          >
            + Add Competitors
          </button>
        </div>
      </div>

      {analysisError && !analysisMutation.isPending && (
        <div className="bulk-bar bulk-bar--notice" role="alert">
          <span>{analysisError}</span>
          <button type="button" className="btn-secondary" onClick={() => setAnalysisError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {onAccounts ? (
        <CompetitorsPage businessCategory={filters.businessCategory} />
      ) : (
        <IntelligencePage
          filters={filters}
          onFiltersChange={setFilters}
          running={analysisMutation.isPending}
          onRun={requestRunAnalysis}
        />
      )}

      {modal === 'confirm-analysis' && (
        <Modal title="Run analysis?" onClose={() => setModal(null)}>
          <p className="form-note" style={{ marginTop: 0 }}>
            Claude will condense matching competitors and analyse them in batches for the current
            Overview filters. This can take a few minutes and uses API credits.
          </p>
          <dl className="confirm-analysis-scope">
            <div>
              <dt>Business type</dt>
              <dd>{businessTypeLabel}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{filters.location}</dd>
            </div>
            <div>
              <dt>Follower range</dt>
              <dd>{filters.followerRangeLabel}</dd>
            </div>
            <div>
              <dt>Period</dt>
              <dd>{periodLabel}</dd>
            </div>
          </dl>
          <div className="confirm-analysis-actions">
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={confirmRunAnalysis}>
              Run analysis
            </button>
          </div>
        </Modal>
      )}

      {modal === 'add' && (
        <Modal
          title="Add Competitors"
          onClose={() => {
            setModal(null)
            setAddError(null)
            bulkAddMutation.reset()
          }}
        >
          <AddCompetitorForm
            onSubmit={(input) => addMutation.mutate(input)}
            onBulkSubmit={(input) => bulkAddMutation.mutateAsync(input)}
            submitting={addMutation.isPending}
            bulkSubmitting={bulkAddMutation.isPending}
            serverError={addError}
          />
        </Modal>
      )}
      {modal === 'discover' && (
        <Modal title="Discover Competitors" onClose={() => setModal(null)}>
          <p className="form-note">
            Automatic discovery is not implemented yet, so this list stays empty. Add competitors
            by handle from the Accounts tab.
          </p>
          <SuggestionList
            suggestions={suggestions.data ?? []}
            busyId={suggestionMutation.isPending ? (suggestionMutation.variables?.id ?? null) : null}
            onResolve={(id, resolution, reason) =>
              suggestionMutation.mutate({ id, resolution, reason })
            }
          />
        </Modal>
      )}
    </div>
    </FilterActionsProvider>
  )
}
