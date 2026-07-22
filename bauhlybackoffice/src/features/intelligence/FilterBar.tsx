import { useQuery } from '@tanstack/react-query'
import { defaultFilters, filterOptions, type FilterState } from '../../services/intelligence/filters'
import { getCompetitorLocations } from '../../services/competitors/repository'

interface FilterBarProps {
  filters: FilterState
  onChange: (next: FilterState) => void
}

interface FilterSelectProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  const selectId = `filter-${label.toLowerCase().replace(/\s+/g, '-')}`
  // Keep the current value selectable even if it fell out of the live list
  // so the control stays valid; label it so the operator knows why.
  const optionsWithValue =
    value && !options.some((o) => o.value === value)
      ? [...options, { value, label: `${value} (no posts yet)` }]
      : options

  return (
    <div className="filter-field">
      <label htmlFor={selectId}>{label}</label>
      <select id={selectId} value={value} onChange={(e) => onChange(e.target.value)}>
        {optionsWithValue.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

const asOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }))

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const locations = useQuery({
    queryKey: ['competitor-locations'],
    queryFn: getCompetitorLocations,
    staleTime: 60_000,
  })

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value })
  const isDefault = (Object.keys(defaultFilters) as (keyof FilterState)[]).every(
    (key) => filters[key] === defaultFilters[key],
  )

  const locationOptions = ['Global', ...(locations.data ?? [])]

  return (
    <div className="filter-bar" role="group" aria-label="Dashboard filters">
      <FilterSelect
        label="Location"
        value={filters.location}
        options={asOptions(locationOptions)}
        onChange={(v) => set('location', v)}
      />
      <FilterSelect
        label="Follower Range"
        value={filters.followerRangeLabel}
        options={asOptions(filterOptions.followerRange)}
        onChange={(v) => set('followerRangeLabel', v)}
      />
      <FilterSelect
        label="Authority Pillar"
        value={filters.pillar}
        options={[...filterOptions.pillar]}
        onChange={(v) => set('pillar', v as FilterState['pillar'])}
      />
      <FilterSelect
        label="Time Period"
        value={filters.period}
        options={[...filterOptions.period]}
        onChange={(v) => set('period', v as FilterState['period'])}
      />
      {!isDefault && (
        <button type="button" className="filter-clear" onClick={() => onChange(defaultFilters)}>
          Clear all
        </button>
      )}
    </div>
  )
}
