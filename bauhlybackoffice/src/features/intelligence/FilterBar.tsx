import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { defaultFilters, filterOptions, type FilterState } from '../../services/intelligence/filters'
import { UNASSIGNED_LOCATION } from '../../services/intelligence/filterScope'
import {
  getCompetitorFilterCount,
  getCompetitorLocations,
} from '../../services/competitors/repository'
import { FilterIcon } from '../../components/icons'
import { FilterActionsSlot } from '../../app/shell/pageActions'

interface FilterBarProps {
  filters: FilterState
  onChange: (next: FilterState) => void
  /**
   * Overview locks the follower range to the "All sizes" default and hides the
   * control, so the tab always analyses the full register regardless of size.
   */
  hideFollowerRange?: boolean
}

interface FilterSelectProps {
  label: string
  value: string
  options: { value: string; label: string; disabled?: boolean }[]
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
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

const asOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }))

/** Sentinel for the "type your own range" option in the follower dropdown. */
const CUSTOM = 'Custom range…'

/** 12000 → "12K"; keeps the label in the same shape as the preset ranges. */
function compact(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}K`.replace('.0K', 'K') : String(n)
}

/** The filter-bar fields that Clear all / the active-count badge consider. */
const FILTER_BAR_KEYS = ['location', 'followerRangeLabel', 'pillar', 'period'] as const

export function FilterBar({ filters, onChange, hideFollowerRange = false }: FilterBarProps) {
  const locations = useQuery({
    queryKey: ['competitor-locations'],
    queryFn: getCompetitorLocations,
    staleTime: 60_000,
  })

  const matchCount = useQuery({
    queryKey: [
      'competitor-filter-count',
      filters.location,
      filters.followerRangeLabel,
      filters.businessCategory,
      filters.period,
    ],
    queryFn: () =>
      getCompetitorFilterCount({
        location: filters.location,
        followerRangeLabel: filters.followerRangeLabel,
        businessCategory: filters.businessCategory,
        period: filters.period,
      }),
    staleTime: 30_000,
  })

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value })

  // Business type lives in the top bar — Clear all only resets Overview filter-bar fields.
  // When the follower range is hidden it stays pinned to its default, so it never
  // counts toward the active-filter badge or the Clear all affordance.
  const activeKeys = hideFollowerRange
    ? FILTER_BAR_KEYS.filter((key) => key !== 'followerRangeLabel')
    : FILTER_BAR_KEYS
  const isDefault = activeKeys.every((key) => filters[key] === defaultFilters[key])
  const activeCount = activeKeys.filter((key) => filters[key] !== defaultFilters[key]).length

  // Phones collapse the whole bar behind a button; the toggle is hidden by CSS
  // at wider widths, where the fields are always shown.
  const [open, setOpen] = useState(false)

  // A follower range the user typed rather than picked from the presets.
  const presets = filterOptions.followerRange as readonly string[]
  const [customOpen, setCustom] = useState(false)
  const [customMin, setCustomMin] = useState('')
  const [customMax, setCustomMax] = useState('')
  const isCustom = customOpen || !presets.includes(filters.followerRangeLabel)
  const min = Number(customMin)
  const max = Number(customMax)
  const customRangeLabel =
    customMin && customMax && min >= 0 && max > min ? `${compact(min)} – ${compact(max)}` : null

  const locationOptions = ['Global', UNASSIGNED_LOCATION, ...(locations.data ?? [])]
  const matching = matchCount.data?.matching
  const total = matchCount.data?.total

  return (
    <>
      <div className="filter-row">
        <button
          type="button"
          className="filter-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <FilterIcon />
          Filters
          {activeCount > 0 && <span className="count-pill">{activeCount}</span>}
        </button>
        <FilterActionsSlot />
      </div>
      <div
        className={`filter-bar${open ? ' filter-bar--open' : ''}`}
        role="group"
        aria-label="Dashboard filters"
      >
        <FilterSelect
          label="Location"
          value={filters.location}
          options={asOptions(locationOptions)}
          onChange={(v) => set('location', v)}
        />
        {!hideFollowerRange && (
        <div className="filter-field">
          <label htmlFor="filter-follower-range">Follower Range</label>
          <select
            id="filter-follower-range"
            value={isCustom ? CUSTOM : filters.followerRangeLabel}
            onChange={(e) => {
              if (e.target.value === CUSTOM) {
                setCustom(true)
                return
              }
              setCustom(false)
              set('followerRangeLabel', e.target.value)
            }}
          >
            {filterOptions.followerRange.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
            <option value={CUSTOM}>{CUSTOM}</option>
          </select>
          {isCustom && (
            <div className="filter-custom-range">
              <input
                type="number"
                min={0}
                step={100}
                aria-label="Minimum followers"
                placeholder="Min"
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
              />
              <span aria-hidden="true">–</span>
              <input
                type="number"
                min={0}
                step={100}
                aria-label="Maximum followers"
                placeholder="Max"
                value={customMax}
                onChange={(e) => setCustomMax(e.target.value)}
              />
              <button
                type="button"
                className="filter-custom-apply"
                disabled={!customRangeLabel}
                onClick={() => customRangeLabel && set('followerRangeLabel', customRangeLabel)}
              >
                Apply
              </button>
            </div>
          )}
        </div>
        )}
        <FilterSelect
          label="Authority Pillar"
          value={filters.pillar}
          options={filterOptions.pillar.map((p) => ({
            value: p.value,
            label: p.value === 'all' ? 'All pillars' : p.label,
          }))}
          onChange={(v) => set('pillar', v as FilterState['pillar'])}
        />
        <FilterSelect
          label="Time Period"
          value={filters.period}
          // Last 30 days and All time are selectable; the intermediate windows
          // stay disabled until the register carries enough history to trust them.
          options={filterOptions.period.map((p) => ({
            ...p,
            disabled: p.value !== 'last-30' && p.value !== 'all',
          }))}
          onChange={(v) => set('period', v as FilterState['period'])}
        />
        <p className="filter-match-count" aria-live="polite">
          {matchCount.isPending || matching == null
            ? 'Counting accounts…'
            : matching === 0
              ? '0 accounts match these filters'
              : matching === 1
                ? '1 account matches these filters'
                : `${matching.toLocaleString('en-US')} accounts match these filters`}
          {total != null && matching != null && matching !== total ? (
            <span className="filter-match-total"> of {total.toLocaleString('en-US')}</span>
          ) : null}
        </p>
        {!isDefault && (
          <button
            type="button"
            className="filter-clear"
            onClick={() =>
              onChange({
                ...filters,
                location: defaultFilters.location,
                followerRangeLabel: defaultFilters.followerRangeLabel,
                pillar: defaultFilters.pillar,
                period: defaultFilters.period,
              })
            }
          >
            Clear all
          </button>
        )}
      </div>
    </>
  )
}
