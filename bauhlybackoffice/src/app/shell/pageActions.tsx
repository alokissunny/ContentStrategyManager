import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/*
 * Lets a page render into the application top bar: primary actions on the
 * right (with the page title) and an optional centered control.
 */

const SlotContext = createContext<{
  node: HTMLElement | null
  setNode: (el: HTMLElement | null) => void
  centerNode: HTMLElement | null
  setCenterNode: (el: HTMLElement | null) => void
}>({ node: null, setNode: () => {}, centerNode: null, setCenterNode: () => {} })

export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [centerNode, setCenterNode] = useState<HTMLElement | null>(null)
  return (
    <SlotContext.Provider value={{ node, setNode, centerNode, setCenterNode }}>
      {children}
    </SlotContext.Provider>
  )
}

/** Rendered once by the shell; receives whatever the active page provides. */
export function PageActionsSlot() {
  const { setNode } = useContext(SlotContext)
  return <div className="topbar-actions" ref={setNode} />
}

/** Center of the top bar — for a single primary control like Business type. */
export function PageCenterSlot() {
  const { setCenterNode } = useContext(SlotContext)
  return <div className="topbar-center" ref={setCenterNode} />
}

export function PageActions({ children }: { children: ReactNode }) {
  const { node } = useContext(SlotContext)
  if (!node) return null
  return createPortal(children, node)
}

export function PageCenterActions({ children }: { children: ReactNode }) {
  const { centerNode } = useContext(SlotContext)
  if (!centerNode) return null
  return createPortal(children, centerNode)
}
