import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/*
 * Lets a page render its primary actions into the application top bar,
 * so page-level buttons sit with the page title instead of duplicating a
 * toolbar underneath it.
 */

const SlotContext = createContext<{
  node: HTMLElement | null
  setNode: (el: HTMLElement | null) => void
}>({ node: null, setNode: () => {} })

export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  return <SlotContext.Provider value={{ node, setNode }}>{children}</SlotContext.Provider>
}

/** Rendered once by the shell; receives whatever the active page provides. */
export function PageActionsSlot() {
  const { setNode } = useContext(SlotContext)
  return <div className="topbar-actions" ref={setNode} />
}

export function PageActions({ children }: { children: ReactNode }) {
  const { node } = useContext(SlotContext)
  if (!node) return null
  return createPortal(children, node)
}
