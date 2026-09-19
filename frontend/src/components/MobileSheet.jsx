import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../brand/Icon';
import { useBodyScrollLock } from '../pages/visualbrand/useBodyScrollLock';

const EXIT_MS = 190;

const reducedMotion = () => typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function ScrollLock() {
  useBodyScrollLock();
  return null;
}

/**
 * Phone action sheet from the bottom edge (bauhly-v3 MobileSheet).
 * Pointer surfaces keep pe-menu popovers; phones use this.
 */
export default function MobileSheet({
  open,
  title,
  onBack = null,
  onClose,
  children,
  foot = null,
  full = false,
  actions = null,
  nav = true,
  navIcon = null,
  exit = EXIT_MS,
  className = '',
}) {
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open && !shown) setShown(true);
  if (open && closing) setClosing(false);

  const last = useRef({ title, onBack, children, foot, full, actions, nav, navIcon });
  useEffect(() => {
    if (open) last.current = { title, onBack, children, foot, full, actions, nav, navIcon };
  });

  useEffect(() => {
    if (open) return;
    if (!shown) return;
    if (reducedMotion()) { setShown(false); return; }
    setClosing(true);
  }, [open, shown]);

  useEffect(() => {
    if (!closing) return undefined;
    const t = window.setTimeout(() => { setClosing(false); setShown(false); }, exit);
    return () => window.clearTimeout(t);
  }, [closing, exit]);

  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!shown) return null;
  const view = open ? { title, onBack, children, foot, full, actions, nav, navIcon } : last.current;
  return createPortal(
    <>
      {shown ? <ScrollLock /> : null}
      {!closing && <div className="msheet__scrim" onClick={onClose} />}
      <div
        className={`msheet ${className} ${closing ? 'is-closing' : ''} ${view.full ? 'is-full' : ''}`}
        style={{ '--msheet-exit': `${exit}ms` }}
        role="dialog"
        aria-modal="true"
        aria-label={view.title || 'Menu'}
        aria-hidden={closing ? 'true' : undefined}
      >
        <span className="msheet__grip" aria-hidden="true" />
        <div className="msheet__head">
          {view.nav !== false && (
            <button
              type="button"
              className="msheet__nav"
              onClick={view.onBack || onClose}
              aria-label={view.navIcon === 'x' || !view.onBack ? 'Close' : 'Back'}
            >
              <Icon name={view.navIcon || (view.onBack ? 'chevron-left' : 'x')} size={20} strokeWidth={2.25} />
            </button>
          )}
          {view.title ? <h2 className="msheet__title">{view.title}</h2> : <span className="msheet__title" />}
          {view.actions && <div className="msheet__acts">{view.actions}</div>}
        </div>
        <div className="msheet__body">{view.children}</div>
        {view.foot && <div className="msheet__foot">{view.foot}</div>}
      </div>
    </>,
    document.body,
  );
}
