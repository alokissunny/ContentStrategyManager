import type { ReactNode } from 'react'
import './stat-card.css'

/*
 * Summary stat card matching the reference mockups: colored icon chip +
 * label on one row, large value, small detail line. Fixed internal heights
 * so a value or detail change never shifts neighboring cards.
 */

export type StatTone = 'blue' | 'green' | 'purple' | 'orange' | 'teal' | 'red' | 'slate'

interface StatCardProps {
  icon: ReactNode
  tone: StatTone
  label: string
  value: ReactNode
  detail?: ReactNode
  warn?: boolean
  /** Progress toward a target, e.g. sample size vs the 20–30 account target. */
  progress?: { value: number; max: number }
  children?: ReactNode
}

export function StatCard({ icon, tone, label, value, detail, warn, progress, children }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card-head">
        <span className={`stat-chip stat-chip--${tone}`} aria-hidden="true">
          {icon}
        </span>
        <span className="stat-label">{label}</span>
      </div>
      <p className="stat-value">{value}</p>
      {progress && (
        <div className="stat-progress" aria-hidden="true">
          <div
            className={`stat-progress-fill${warn ? ' stat-progress-fill--warn' : ''}`}
            style={{ width: `${Math.min(100, Math.round((progress.value / progress.max) * 100))}%` }}
          />
        </div>
      )}
      <p className={`stat-detail${warn ? ' stat-detail--warn' : ''}`}>{detail ?? ' '}</p>
      {children}
    </div>
  )
}
