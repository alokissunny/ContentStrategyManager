/*
 * Business memory — readable knowledge card + one composer to add/update.
 * Replaces per-field textareas: studios write a note; Bauhly merges it into
 * the right Brand DNA sections.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Glyph from '../components/Glyph';
import { getBrandDna, reviseBrandDna, updateBrandDna } from '../api/brandDna';
import './brandDna.css';

/** Friendly groupings over the stored Brand DNA keys (screenshot layout). */
const MEMORY_GROUPS = [
  {
    id: 'about',
    title: 'About the business',
    keys: ['whatYouOffer', 'proof'],
    empty: 'What you offer, and what you can point to as proof.',
  },
  {
    id: 'customers',
    title: 'Customers & communication',
    keys: ['whoYouHelp', 'firstProblem', 'howYouSound'],
    empty: 'Who it’s for, the first problem you speak to, and how you sound.',
  },
  {
    id: 'focus',
    title: 'Current focus',
    keys: ['position'],
    empty: 'The one-line answer to why you — not the next account.',
  },
  {
    id: 'context',
    title: 'Important context',
    keys: ['neverDo', 'visualStyle'],
    empty: 'What never belongs in the plan, and your visual language.',
  },
];

const MEMORY_KEYS = [
  'whatYouOffer',
  'whoYouHelp',
  'firstProblem',
  'position',
  'proof',
  'howYouSound',
  'visualStyle',
  'neverDo',
];

const DOCUMENT_ITEMS = [
  {
    title: 'What you offer',
    why: 'So plans sell the real service, not a generic studio pitch.',
  },
  {
    title: 'Who you want to attract',
    why: 'So hooks speak to that person — their situation, not everyone.',
  },
  {
    title: 'How you want to sound',
    why: 'So captions keep your tone when you change direction.',
  },
  {
    title: 'What never belongs',
    why: 'So the strategist does not suggest work you would never publish.',
  },
];

const GENERIC_MEMORY = [
  /we'll sharpen as you post/i,
  /core product or service/i,
  /clear, consistent, and recognizable/i,
];

const GAPS = [
  {
    key: 'whatYouOffer',
    missing: 'what you offer',
    why: 'Without a clear offer, posts describe the work instead of selling it.',
    improves: 'Plans will name the service and the outcome, not a generic pitch.',
    prompt: 'We offer…',
  },
  {
    key: 'whoYouHelp',
    missing: 'who you want to attract',
    why: 'Hooks need a specific person. A vague audience reads as advertising.',
    improves: 'Captions will speak to that person — their situation, not a crowd.',
    prompt: 'We want to attract…',
  },
  {
    key: 'firstProblem',
    missing: 'the first problem you speak to',
    why: 'Discovery posts need a tension. Without it, the week opens soft.',
    improves: 'The opening slide can start on a real tension instead of a slogan.',
    prompt: 'The first problem we speak to is…',
  },
  {
    key: 'howYouSound',
    missing: 'how you want to sound',
    why: 'Tone drifts the moment you ask Bauhly to change direction.',
    improves: 'Every caption will keep the voice you set, including a new direction.',
    prompt: 'We want to sound…',
  },
];

function valueMap(sections) {
  const map = {};
  for (const s of sections || []) map[s.key] = String(s.value || '').trim();
  return map;
}

function proseFor(map, keys) {
  return keys
    .map((k) => map[k])
    .filter(Boolean)
    .join(' ');
}

function isUnclear(value) {
  const t = String(value || '').trim();
  if (!t) return true;
  if (t.length < 24) return true;
  return GENERIC_MEMORY.some((re) => re.test(t));
}

function emptyFields() {
  return Object.fromEntries(MEMORY_KEYS.map((key) => [key, '']));
}

function BrandDnaSkeleton() {
  return (
    <div className="bm-card" aria-busy="true" aria-label="Loading business memory">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="bm-skel-block" />
      ))}
      <div className="bm-skel-composer" />
    </div>
  );
}

function ClearConfirm({ busy, onCancel, onClear }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return createPortal(
    <>
      <div className="bm-dialog__scrim" onClick={busy ? undefined : onCancel} />
      <div className="bm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="bm-clear-t">
        <h2 id="bm-clear-t">Clear Business memory?</h2>
        <p>
          This empties everything Bauhly knows about this account — offer, who
          you want to attract, and how you sound. Plans and captions will be
          guessed from Instagram, and the output usually goes generic, until
          you write the direction again.
        </p>
        <div className="bm-dialog__acts">
          <button type="button" className="btn btn--tertiary btn--sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--sm bm-dialog__clear" onClick={onClear} disabled={busy}>
            {busy ? 'Clearing…' : 'Clear memory'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function EmptyMemory({ notFound, children }) {
  return (
    <div className="bm-card bm-card--empty-state">
      <p className="bm-empty-kicker">What to document</p>
      <h2 className="bm-empty-title">Write the direction Bauhly should keep.</h2>
      <p className="bm-empty-lead">
        This is the account’s offer, audience, and voice. Empty memory means
        every plan is a guess from Instagram — the wrong person, a generic tone,
        and posts that do not sell what you actually offer.
      </p>
      <ul className="bm-empty-list">
        {DOCUMENT_ITEMS.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.why}</span>
          </li>
        ))}
      </ul>
      {notFound ? (
        <p className="bm-empty">
          Connect your Instagram from onboarding first — Bauhly needs a page to start from.
          Then come back here and write the direction.
        </p>
      ) : children}
    </div>
  );
}

function GapWarning({ gaps, onAnswer, onDismiss }) {
  if (!gaps.length) return null;
  return (
    <aside className="bm-warn" role="status">
      <div className="bm-warn__head">
        <p className="bm-warn__kicker">Needs a clearer picture</p>
        <button type="button" className="bm-warn__dismiss" onClick={onDismiss}>
          Not now
        </button>
      </div>
      <p className="bm-warn__lead">
        A few important things are still unclear. Answering them here is enough —
        we do not ask this during onboarding on purpose.
      </p>
      <ul className="bm-warn__list">
        {gaps.map((g) => (
          <li key={g.key}>
            <strong>Missing: {g.missing}.</strong>
            {' '}{g.why}{' '}
            <em>{g.improves}</em>
            {onAnswer ? (
              <button type="button" className="bm-warn__ask" onClick={() => onAnswer(g)}>
                Answer this
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function BrandDna() {
  const [reportId, setReportId] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [hideGaps, setHideGaps] = useState(false);
  const inputRef = useRef(null);
  const COMPOSER_MIN = 72;
  const COMPOSER_MAX = 180;

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(COMPOSER_MAX, Math.max(COMPOSER_MIN, el.scrollHeight))}px`;
  }, [note]);

  useEffect(() => {
    let cancelled = false;
    getBrandDna()
      .then((data) => {
        if (cancelled) return;
        setReportId(data.reportId);
        setSections(data.sections || []);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.response?.status === 404) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const map = useMemo(() => valueMap(sections), [sections]);
  const groups = useMemo(
    () =>
      MEMORY_GROUPS.map((g) => ({
        ...g,
        text: proseFor(map, g.keys),
      })),
    [map],
  );
  const hasMemory = groups.some((g) => g.text);
  const gaps = useMemo(
    () => (notFound ? [] : GAPS.filter((g) => isUnclear(map[g.key]))),
    [map, notFound],
  );

  async function clearMemory() {
    if (!reportId || clearing) return;
    setClearing(true);
    setError('');
    setFlash('');
    try {
      const data = await updateBrandDna(reportId, emptyFields());
      setSections(data.sections || []);
      setNote('');
      setHideGaps(false);
      setConfirming(false);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not clear memory just now.');
      setConfirming(false);
    } finally {
      setClearing(false);
    }
  }

  function answerGap(gap) {
    setNote((prev) => (prev.trim() ? prev : gap.prompt));
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }

  async function submitNote(e) {
    e?.preventDefault?.();
    const text = note.trim();
    if (!text || !reportId || busy) return;
    setBusy(true);
    setError('');
    setFlash('');
    try {
      const data = await reviseBrandDna(reportId, text);
      setSections(data.sections || []);
      setNote('');
      setFlash('Updated.');
      inputRef.current?.focus();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not update just now.');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitNote();
    }
  }

  const composer = !notFound && reportId ? (
    <form className="bm-composer" onSubmit={submitNote}>
      <textarea
        ref={inputRef}
        className="bm-composer__input"
        value={note}
        disabled={busy}
        rows={3}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Add or update what Bauhly should know…"
        aria-label="Add or update business memory"
        autoComplete="off"
      />
      <button
        type="submit"
        className="bm-composer__send"
        disabled={busy || !note.trim()}
        aria-label={busy ? 'Updating' : 'Send'}
        title="Update memory"
      >
        <Glyph name={busy ? 'loader' : 'arrow-up'} size={18} strokeWidth={2.25} />
      </button>
    </form>
  ) : null;

  const status = (error || flash) ? (
    <p className={`bm-status${error ? ' is-err' : ''}`} role="status">
      {error || flash}
    </p>
  ) : null;

  return (
    <div className="bm">
      <Link className="bm-back" to="/dashboard/settings">← Settings</Link>
      <div className="bm-head">
        <div>
          <h1 className="bm-title">Business memory</h1>
          <p className="bm-sub">
            What Bauhly understands about this account. Every plan and caption
            is written from this.
          </p>
        </div>
        {hasMemory && (
          <button
            type="button"
            className="btn btn--tertiary bm-clear-btn"
            onClick={() => setConfirming(true)}
          >
            Clear memory
          </button>
        )}
      </div>

      {loading ? (
        <BrandDnaSkeleton />
      ) : notFound || !hasMemory ? (
        <EmptyMemory notFound={notFound}>
          {composer}
          {status}
        </EmptyMemory>
      ) : (
        <>
          {!hideGaps && gaps.length > 0 && (
            <GapWarning
              gaps={gaps}
              onAnswer={answerGap}
              onDismiss={() => setHideGaps(true)}
            />
          )}
          <div className="bm-card">
            {groups.map((g) => (
              <section className="bm-block" key={g.id}>
                <h2 className="bm-block__title">{g.title}</h2>
                {g.text ? (
                  <p className="bm-block__body">{g.text}</p>
                ) : (
                  <p className="bm-block__body is-empty">{g.empty}</p>
                )}
              </section>
            ))}
            {composer}
            {status}
          </div>
        </>
      )}

      {confirming && (
        <ClearConfirm
          busy={clearing}
          onCancel={() => setConfirming(false)}
          onClear={clearMemory}
        />
      )}
    </div>
  );
}
