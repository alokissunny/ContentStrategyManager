import { comparisonPeriods, type ComparisonPeriod, type CustomRange } from '../services/period'

/**
 * Comparison-window selector. Scoped per page to whatever that page
 * measures over time — the label says which comparison is active so a
 * number is never shown without its window.
 */
export function PeriodFilter({
  value,
  onChange,
  id = 'period-filter',
  label = 'Compare',
  range,
  onRangeChange,
}: {
  value: ComparisonPeriod
  onChange: (next: ComparisonPeriod) => void
  id?: string
  label?: string
  range?: CustomRange
  onRangeChange?: (next: CustomRange) => void
}) {
  const showCustom = value === 'custom' && onRangeChange
  return (
    <>
      <div className="filter-field filter-field--period">
        <label htmlFor={id}>{label}</label>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as ComparisonPeriod)}>
          {comparisonPeriods.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {showCustom && (
        <div className="filter-field filter-field--range">
          <label htmlFor={`${id}-from`}>Range</label>
          <div className="range-inputs">
            <input
              id={`${id}-from`}
              type="date"
              value={range?.from ?? ''}
              max={range?.to || undefined}
              onChange={(e) => onRangeChange({ from: e.target.value, to: range?.to ?? '' })}
            />
            <span aria-hidden="true">→</span>
            <input
              id={`${id}-to`}
              type="date"
              aria-label="Range end"
              value={range?.to ?? ''}
              min={range?.from || undefined}
              onChange={(e) => onRangeChange({ from: range?.from ?? '', to: e.target.value })}
            />
          </div>
        </div>
      )}
    </>
  )
}
