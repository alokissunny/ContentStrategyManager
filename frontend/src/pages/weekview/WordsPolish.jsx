/*
 * The instruction field under Edit text (bauhly-v3 PolishField, words subject).
 * Make-it chips and the ask field rewrite through the same Claude/OpenAI
 * endpoint as the caption — kind: 'words' so the model treats this as
 * on-image display type. Apply on the editor is still what files the draft.
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../brand/Icon';
import { polishCaption } from '../../api/routes';
import { POLISH_PLACEHOLDER_WORDS } from '../../lib/polish';

const MAKE_IT = [
  { id: 'shorter', icon: 'crop', label: 'Shorter', instruction: 'Tighten it — shorter, punchier' },
  { id: 'clearer', icon: 'sparkle', label: 'Clearer', instruction: 'Simplify the wording' },
  { id: 'expert', icon: 'brief', label: 'More expert', instruction: 'Make it read more professional' },
  { id: 'human', icon: 'heart', label: 'More human', instruction: 'Warmer, more like you' },
];

function MakeRow({ children }) {
  const ref = useRef(null);
  const [reach, setReach] = useState({ back: false, on: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setReach({
      back: el.scrollLeft > 1,
      on: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
    read();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    el.addEventListener('scroll', read, { passive: true });
    return () => { ro?.disconnect(); el.removeEventListener('scroll', read); };
  }, [children]);
  const go = (d) => ref.current?.scrollBy({ left: d * 160, behavior: 'smooth' });
  return (
    <div className="wv-makerow">
      <button
        type="button"
        className="wv-makerow__go"
        disabled={!reach.back}
        aria-label="Previous suggestions"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => go(-1)}
      >
        <Icon name="chevron-left" size={15} strokeWidth={2.5} />
      </button>
      <div
        className={`wv-make__row${reach.back ? ' is-back' : ''}${reach.on ? ' is-on' : ''}`}
        ref={ref}
      >
        {children}
      </div>
      <button
        type="button"
        className="wv-makerow__go wv-makerow__go--on"
        disabled={!reach.on}
        aria-label="More suggestions"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => go(1)}
      >
        <Icon name="chevron-right" size={15} strokeWidth={2.5} />
      </button>
    </div>
  );
}

export default function WordsPolish({
  routeId,
  dayIndex,
  caption,
  onCaption,
  onBusy,
  fills = [],
  role,
}) {
  const [ask, setAsk] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  const run = async (instruction) => {
    const next = String(instruction || '').trim();
    if (!next || busy || !routeId) return;
    setBusy(true);
    onBusy?.(true);
    setNote('');
    try {
      const result = await polishCaption(routeId, dayIndex, {
        caption,
        instruction: next,
        kind: 'words',
        role,
        fills,
      });
      if (result.unchanged) {
        setNote(result.message || 'That would leave the text exactly as it is.');
      } else if (result.caption != null) {
        onCaption(result.caption);
        setAsk('');
      }
    } catch (err) {
      setNote(err.response?.data?.message || err.message || 'Could not rewrite the text.');
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };

  const commit = () => {
    if (!ask.trim()) return;
    run(ask);
  };

  const can = Boolean(String(caption || '').trim()) && !busy && Boolean(routeId);
  const showMake = (focused || ask.trim()) && Boolean(String(caption || '').trim());

  return (
    <div className="wv-polish wv-capask">
      {showMake && (
        <div className="wv-make is-arriving">
          <span className="wv-make__label">Make it:</span>
          <MakeRow>
            {MAKE_IT.map((m) => (
              <button
                key={m.id}
                type="button"
                className="wv-make__chip"
                disabled={!can}
                title={can ? m.instruction : 'Write some text first'}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(m.instruction)}
              >
                <Icon name={m.icon} size={14} strokeWidth={2} />
                {m.label}
              </button>
            ))}
          </MakeRow>
        </div>
      )}
      {note ? <p className="wv-make__note">{note}</p> : null}
      {busy ? <p className="wv-make__note">Rewriting…</p> : null}
      <div className="wv-polish__row">
        <input
          className="wv-polish__input"
          value={ask}
          placeholder={POLISH_PLACEHOLDER_WORDS}
          aria-label="What should change about these words?"
          disabled={busy}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onChange={(e) => { setAsk(e.target.value); setNote(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        />
        <button
          type="button"
          className="wv-polish__send"
          disabled={busy || !ask.trim() || !routeId}
          onClick={commit}
          aria-label="Apply this change"
          title="Apply this change"
        >
          <Icon name="arrow-up" size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
