/*
 * The two shared UI primitives the check-in needs, ported from bauhly-v3
 * components/ui/index.jsx: an auto-growing textarea and a body-scroll lock.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/* `placeholderGrows` (bauhly-v3): `scrollHeight` counts the PLACEHOLDER when the box is
 * empty, so a long hint would set the height of a field with nothing in it. With it off,
 * an empty field is exactly one measured row. Consumed here so it never reaches the DOM. */
export function AutoTextarea({ value, className = '', minHeight = 64, placeholderGrows = true, ...props }) {
  const ref = useRef(null);
  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const empty = !String(value ?? '').length && !el.value;
    if (empty && !placeholderGrows) {
      const cs = getComputedStyle(el);
      const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const bord = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      el.style.height = `${Math.max(minHeight, Math.ceil(line + pad + bord))}px`;
      return;
    }
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
