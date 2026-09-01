/*
 * App-wide toast for plan generation. Mounted in the dashboard shell so it
 * survives leaving Your Plans — the wait stage stays on that page; this is
 * the note that lands when they are somewhere else.
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../brand/Icon';
import { dismissPlanToast, usePlanGeneration } from '../lib/planGeneration';

const AUTO_MS = { error: 10000 };

export default function GenerationToast() {
  const gen = usePlanGeneration();
  const toast = gen.toast;
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!toast || toast.kind === 'busy') return undefined;
    const ms = AUTO_MS[toast.kind];
    if (!ms) return undefined;
    const t = window.setTimeout(() => dismissPlanToast(), ms);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  const icon = toast.kind === 'busy' ? 'refresh' : toast.kind === 'done' ? 'check' : 'info';

  function viewPlan() {
    dismissPlanToast();
    if (pathname !== '/dashboard') navigate('/dashboard');
  }

  return createPortal(
    <div
      key={toast.kind}
      className={`toast${toast.kind === 'busy' ? ' is-busy' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={toast.kind === 'busy' ? 'true' : undefined}
    >
      <span className="toast__row">
        <Icon name={icon} size={17} strokeWidth={2.25} />
        <span className="toast__text">
          {toast.kind === 'done' ? <b>{toast.text}</b> : toast.text}
        </span>
      </span>
      {toast.action === 'view' && (
        <button type="button" className="btn btn--primary btn--xs" onClick={viewPlan}>
          View plan
        </button>
      )}
      <button type="button" className="toast__x" aria-label="Dismiss" onClick={() => dismissPlanToast()}>
        <Icon name="x" size={14} strokeWidth={2.5} />
      </button>
    </div>,
    document.body,
  );
}
