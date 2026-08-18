/*
 * One field per layout typography role (bauhly-v3 §852).
 *
 * Contenteditable so a word marked in the brand accent can be seen where it
 * will land. The DOM is the value while focused; the marked string is written
 * back on input. The colour bar exists only while there is a selection.
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../brand/Icon';
import {
  parseMarked, toMarked, hasMark, PALETTE_KEYS, COLOUR_VAR,
} from '../../lib/slidetext';

const COLOUR_LABEL = { fg: 'Primary', accent: 'Accent', ground: 'Neutral' };
const escapeHtml = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function htmlOf(value) {
  return parseMarked(value)
    .map((r) => (r.mark
      ? `<span data-mark="${r.mark}" style="color:${COLOUR_VAR[r.mark]}">${escapeHtml(r.text)}</span>`
      : escapeHtml(r.text)))
    .join('');
}

export default function RoleField({ role, value, onChange, autoFocus = false, faceName }) {
  const box = useRef(null);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.innerHTML = htmlOf(value);
    // seed once per role; while focused the browser owns the DOM
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.key]);

  // polish / Apply-adjacent updates land here when the field is not focused,
  // so the caret is not yanked mid-keystroke
  useEffect(() => {
    const el = box.current;
    if (!el || document.activeElement === el) return;
    const next = htmlOf(value);
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [autoFocus]);

  const read = () => {
    const el = box.current;
    if (!el) return;
    const runs = [];
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) runs.push({ text: n.textContent, mark: null });
      else runs.push({ text: n.textContent, mark: n.dataset?.mark || null });
    });
    onChange(toMarked(runs));
  };

  const track = () => {
    const el = box.current;
    const s = window.getSelection();
    if (!el || !s || s.isCollapsed || !el.contains(s.anchorNode)) { setSel(null); return; }
    const r = s.getRangeAt(0).getBoundingClientRect();
    const b = el.getBoundingClientRect();
    setSel({ x: Math.max(0, r.left - b.left + r.width / 2), y: r.top - b.top });
  };

  const paint = (mark) => {
    const el = box.current;
    const s = window.getSelection();
    if (!el || !s || s.isCollapsed) return;
    const range = s.getRangeAt(0);
    if (mark === null) {
      [...el.querySelectorAll('[data-mark]')].forEach((span) => {
        if (range.intersectsNode(span)) span.replaceWith(document.createTextNode(span.textContent));
      });
    } else {
      const span = document.createElement('span');
      span.dataset.mark = mark;
      span.style.color = COLOUR_VAR[mark];
      try { range.surroundContents(span); } catch {
        span.appendChild(range.extractContents());
        range.insertNode(span);
      }
    }
    el.normalize();
    read();
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="wv-role">
      <div className="wv-role__head">
        <span className="wv-role__name">{role.label}</span>
        {faceName && <span className="wv-role__face">Uses {faceName}</span>}
      </div>
      <div className="wv-role__box">
        <div
          ref={box}
          className={`wv-role__in${role.key === 'head' ? ' is-head' : ''}`}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={role.label}
          spellCheck
          onInput={read}
          onKeyUp={track}
          onMouseUp={track}
          onBlur={() => window.setTimeout(() => setSel(null), 120)}
        />
        {sel && (
          <span className="wv-role__bar" style={{ left: sel.x, top: sel.y }} onMouseDown={(e) => e.preventDefault()}>
            {PALETTE_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className="wv-role__sw"
                style={{ background: COLOUR_VAR[k] }}
                onClick={() => paint(k)}
                aria-label={`Use the ${COLOUR_LABEL[k]} colour`}
                title={COLOUR_LABEL[k]}
              />
            ))}
            {hasMark(value) && (
              <button type="button" className="wv-role__clear" onClick={() => paint(null)} title="Remove emphasis">
                <Icon name="x" size={13} strokeWidth={2.5} />
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
