/*
 * The two shared UI primitives the check-in needs, ported from bauhly-v3
 * components/ui/index.jsx: an auto-growing textarea and a body-scroll lock.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function AutoTextarea({ value, className = '', minHeight = 64, ...props }) {
  const ref = useRef(null);
  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(grow, [value, minHeight]);
  return (
    <textarea
      ref={ref}
      value={value}
      className={`input autogrow ${className}`}
      style={{ minHeight, resize: 'none', overflow: 'hidden' }}
      onInput={grow}
      {...props}
    />
  );
}

export function useBodyScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.dataset.modals = String((+document.body.dataset.modals || 0) + 1);
    document.body.classList.add('has-modal');
    return () => {
      document.body.style.overflow = prev;
      const n = (+document.body.dataset.modals || 1) - 1;
      if (n > 0) document.body.dataset.modals = String(n);
      else {
        delete document.body.dataset.modals;
        document.body.classList.remove('has-modal');
      }
    };
  }, []);
}
