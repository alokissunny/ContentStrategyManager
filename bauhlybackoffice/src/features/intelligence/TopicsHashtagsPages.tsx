import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { defaultFilters, type FilterState } from '../../services/intelligence/filters'
import { getDashboard, type DashboardData } from '../../services/intelligence/repository'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { EmptyState } from '../../components/EmptyState'
import { FilterBar } from './FilterBar'
import { HashtagsSection, HooksSection, TopicsSection } from './sections'
import './intelligence.css'

/*
 * Full-page views of the topics and hashtags lists — reached from the overview
 * via "View all". Each reuses the same section component with no row cap, and
 * carries its own filter bar so the segment can be changed here.
 */

function FullPageShell({
  back,
  filters,
  setFilters,
  query,
  render,
}: {
  back: string
  filters: FilterState
  setFilters: (f: FilterState) => void
  query: UseQueryResult<DashboardData>
  render: (data: DashboardData) => React.ReactNode
}) {
  return (
    <div className="intelligence-main">
      <Link to="/competitors-overview" className="cap-back-link">
        ← Back to Competitors overview
      </Link>
      <FilterBar filters={filters} onChange={setFilters} />
      {query.isError ? (
        <EmptyState title={`Couldn't load ${back}`} description="Something went wrong. Try again." />
      ) : query.isPending || !query.data ? (
        <div className="dashboard-loading" role="status" aria-label={`Loading ${back}`}>
          <div className="skeleton-card" />
        </div>
      ) : (
        render(query.data)
      )}
    </div>
  )
}

export function TopicsFullPage() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const query = useQuery({ queryKey: ['dashboard', filters], queryFn: () => getDashboard(filters) })
  const key = useMemo(() => JSON.stringify(filters), [filters])
  return (
    <FullPageShell
      back="topics"
      filters={filters}
      setFilters={setFilters}
      query={query}
      render={(data) => (
        <TopicsSection key={key} topics={data.topics} />
      )}
    />
  )
}

export function HashtagsFullPage() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const query = useQuery({ queryKey: ['dashboard', filters], queryFn: () => getDashboard(filters) })
  return (
    <FullPageShell
      back="hashtags"
      filters={filters}
      setFilters={setFilters}
      query={query}
      render={(data) => <HashtagsSection hashtags={data.hashtags} basis={data.hashtagBasis} />}
    />
  )
}

export function HooksFullPage() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const query = useQuery({ queryKey: ['dashboard', filters], queryFn: () => getDashboard(filters) })
  return (
    <FullPageShell
      back="hooks"
      filters={filters}
      setFilters={setFilters}
      query={query}
      render={(data) => <HooksSection hooks={data.hooks} />}
    />
  )
}
