import type { ReactNode } from 'react'
import './empty-state.css'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}
