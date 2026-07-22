import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addCompetitor,
  getCollectionStatus,
  listSuggestions,
  resolveSuggestion,
  runCompetitorAnalysis,
  type NewCompetitorInput,
} from '../../services/competitors/repository'
import { IntelligencePage } from '../intelligence/IntelligencePage'
import { defaultFilters, type FilterState } from '../../services/intelligence/filters'
import { periodToDays } from '../../services/intelligence/filterScope'
import { CompetitorsPage } from './CompetitorsPage'
import { AddCompetitorForm, Modal, SuggestionList } from './modals'
import { RefreshIcon } from '../../components/icons'
import { PageActions } from '../../app/shell/pageActions'
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
  const [modal, setModal] = useState<'add' | 'discover' | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const queryClient = useQueryClient()

  const suggestions = useQuery({ queryKey: ['competitor-suggestions'], queryFn: listSuggestions })
  const collection = useQuery({ queryKey: ['collection-status'], queryFn: getCollectionStatus })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['competitors'] })
    queryClient.invalidateQueries({ queryKey: ['competitor-suggestions'] })
    queryClient.invalidateQueries({ queryKey: ['competitor-locations'] })
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
      period: f.period,
      windowDays: periodToDays(f.period),
    })

  return (
    <div>
      {collection.data && (
        <PageActions>
          <span
            className="collection-status"
            title={`${collection.data.accountsProcessed} accounts processed, ${collection.data.postsCollected.toLocaleString('en-US')} posts collected, ${collection.data.failures} failed`}
          >
            <RefreshIcon width={14} height={14} />
            Last scrape {relativeTime(collection.data.lastRunAt)} · {collection.data.source}
          </span>
        </PageActions>
      )}

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
          {!onAccounts && (
            <button
              type="button"
              className="btn-primary"
              disabled={analysisMutation.isPending}
              onClick={() => runAnalysis(filters)}
            >
              {analysisMutation.isPending ? 'Analysing…' : 'Run analysis'}
            </button>
          )}
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
            + Add Competitor
          </button>
        </div>
      </div>

      {analysisError && !onAccounts && !analysisMutation.isPending && (
        <div className="bulk-bar bulk-bar--notice" role="alert">
          <span>{analysisError}</span>
          <button type="button" className="btn-secondary" onClick={() => setAnalysisError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {onAccounts ? (
        <CompetitorsPage />
      ) : (
        <IntelligencePage
          filters={filters}
          onFiltersChange={setFilters}
          running={analysisMutation.isPending}
          onRun={runAnalysis}
        />
      )}

      {modal === 'add' && (
        <Modal
          title="Add Competitor"
          onClose={() => {
            setModal(null)
            setAddError(null)
          }}
        >
          <AddCompetitorForm
            onSubmit={(input) => addMutation.mutate(input)}
            submitting={addMutation.isPending}
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
  )
}
