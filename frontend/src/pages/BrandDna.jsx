/*
 * Business memory — readable knowledge card + one composer to add/update.
 * Replaces per-field textareas: studios write a note; Bauhly merges it into
 * the right Brand DNA sections.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Glyph from '../components/Glyph';
import { getBrandDna, reviseBrandDna } from '../api/brandDna';
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

export default function BrandDna() {
  const [reportId, setReportId] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const inputRef = useRef(null);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitNote();
    }
  }

  return (
    <div className="bm">
      <Link className="bm-back" to="/dashboard/settings">← Settings</Link>
      <h1 className="bm-title">Business memory</h1>
      <p className="bm-sub">
        What Bauhly understands about your business. Every plan and every caption is written
        from this, and it keeps up to date on its own as you capture notes on your projects.
      </p>

      {loading ? (
        <BrandDnaSkeleton />
      ) : notFound ? (
        <div className="bm-card bm-card--empty">
          <p className="bm-empty">
            No business memory yet. Connect your Instagram from onboarding to generate one from your page.
          </p>
        </div>
      ) : (
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

          <form className="bm-composer" onSubmit={submitNote}>
            <input
              ref={inputRef}
              type="text"
              className="bm-composer__input"
              value={note}
              disabled={busy}
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

          {(error || flash) && (
            <p className={`bm-status${error ? ' is-err' : ''}`} role="status">
              {error || flash}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
