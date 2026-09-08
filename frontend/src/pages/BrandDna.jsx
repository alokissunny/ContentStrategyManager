/*
 * Business memory — readable knowledge card + one composer to add/update.
 * Replaces per-field textareas: studios write a note; Bauhly merges it into
 * the right Brand DNA sections.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Glyph from '../components/Glyph';
import { fillBrandDnaGaps, getBrandDna, getBrandDnaRaw, reviseBrandDna, updateBrandDna } from '../api/brandDna';
import { useAiDebug } from '../lib/aiDebug';
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

const DNA_LABELS = {
  whatYouOffer: 'What you offer',
  whoYouHelp: "Who it's for",
  firstProblem: 'Their first problem',
  position: 'Your position',
  proof: 'Your proof',
  howYouSound: 'Your voice',
  visualStyle: 'Visual language',
  neverDo: 'Never do',
};

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
        {gaps.length > 1
          ? 'A few important things are still unclear. Answer these here — we do not ask this during onboarding on purpose.'
          : 'One important thing is still unclear. Answer it here — we do not ask this during onboarding on purpose.'}
      </p>
      <ul className="bm-warn__list">
        {gaps.map((g) => (
          <li key={g.key}>
            <strong>Missing: {g.missing}.</strong>
            {g.why ? <> {g.why}</> : null}
            {g.improves ? <em>{g.improves}</em> : null}
          </li>
        ))}
      </ul>
      {onAnswer ? (
        <div className="bm-warn__acts">
          <button type="button" className="btn btn--primary btn--sm" onClick={onAnswer}>
            Answer this
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function GapInterview({ gaps, busy, error, onClose, onSave }) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [answers, setAnswers] = useState({});
  const answersRef = useRef({});
  const inputRef = useRef(null);
  const gap = gaps[index] || null;
  const last = index >= gaps.length - 1;
  const total = gaps.length;
  answersRef.current = answers;

  useEffect(() => {
    if (!gap) return;
    setDraft(answersRef.current[gap.key] || '');
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [index, gap?.key]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  if (!gap) return null;

  const canSave = Boolean(draft.trim()) || Object.keys(answers).some((k) => k !== gap.key && answers[k]);

  function withDraft(map) {
    const next = { ...map };
    const text = draft.trim();
    if (text) next[gap.key] = text;
    else delete next[gap.key];
    return next;
  }

  function payloadFrom(map) {
    return gaps
      .map((g) => ({
        key: g.key,
        question: g.question || g.missing || '',
        answer: String(map[g.key] || '').trim(),
      }))
      .filter((row) => row.answer);
  }

  function skip() {
    if (busy) return;
    const next = { ...answers };
    delete next[gap.key];
    if (last) {
      const rows = payloadFrom(next);
      if (!rows.length) {
        onClose();
        return;
      }
      onSave(rows);
      return;
    }
    setAnswers(next);
    setIndex((i) => i + 1);
  }

  function continueOrSave() {
    if (busy) return;
    const next = withDraft(answers);
    if (last) {
      const rows = payloadFrom(next);
      if (!rows.length) {
        onClose();
        return;
      }
      onSave(rows);
      return;
    }
    setAnswers(next);
    setIndex((i) => i + 1);
  }

  return createPortal(
    <>
      <div className="bm-dialog__scrim" onClick={busy ? undefined : onClose} />
      <div
        className="bm-dialog bm-dialog--interview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bm-interview-t"
      >
        <p className="bm-interview__step">Question {index + 1} of {total}</p>
        <h2 id="bm-interview-t">{gap.question || `What is ${gap.missing}?`}</h2>
        {gap.why ? <p className="bm-interview__why">{gap.why}</p> : null}
        <textarea
          ref={inputRef}
          className="bm-interview__input"
          value={draft}
          disabled={busy}
          rows={4}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={gap.prompt || 'In your own words…'}
          aria-label={gap.question || gap.missing}
        />
        {error ? <p className="bm-interview__err" role="alert">{error}</p> : null}
        <div className="bm-dialog__acts">
          <button type="button" className="btn btn--tertiary btn--sm" onClick={skip} disabled={busy}>
            Skip
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={continueOrSave} disabled={busy}>
            {busy ? 'Updating…' : last ? (canSave ? 'Update memory' : 'Done') : 'Continue'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function formatWhen(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
}

function RawInspect({ reportId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('dna');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getBrandDnaRaw(reportId)
      .then((raw) => {
        if (!cancelled) setData(raw);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.message || err.message || 'Could not load saved DNA.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const dna = data?.brandDna || {};
  const memoryBlocks = MEMORY_GROUPS.map((g) => ({
    ...g,
    text: proseFor(dna, g.keys),
  }));

  async function copyJson() {
    if (!data) return;
    const ok = await copyText(JSON.stringify(data, null, 2));
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return createPortal(
    <>
      <div className="bm-dialog__scrim" onClick={onClose} />
      <div
        className="bm-dialog bm-dialog--raw"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bm-raw-t"
      >
        <div className="bm-raw__head">
          <div>
            <p className="bm-raw__kicker">Debug</p>
            <h2 id="bm-raw-t">Saved Brand DNA</h2>
            <p className="bm-raw__meta">
              {[
                data?.instagramUsername ? `@${data.instagramUsername}` : '',
                data?.updatedAt ? `updated ${formatWhen(data.updatedAt)}` : '',
              ].filter(Boolean).join(' · ') || (loading ? 'Loading stored fields…' : '')}
            </p>
          </div>
          <div className="bm-raw__acts">
            <button type="button" className="btn btn--tertiary btn--sm" onClick={copyJson} disabled={!data}>
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button type="button" className="btn btn--tertiary btn--sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {error ? (
          <p className="bm-raw__err" role="alert">{error}</p>
        ) : null}

        {data ? (
          <div className="bm-raw__tabs" role="tablist" aria-label="Saved memory views">
            {[
              ['dna', 'Brand DNA'],
              ['memory', 'Business memory'],
              ['file', 'Saved file'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`bm-raw__tab${tab === id ? ' is-on' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="bm-raw__body">
          {loading ? (
            <p className="bm-raw__meta">Loading stored fields…</p>
          ) : data && tab === 'dna' ? (
            <section className="bm-raw__block">
              {MEMORY_KEYS.map((key) => {
                const value = String(dna[key] || '').trim();
                return (
                  <div className="bm-raw__field" key={key}>
                    <p className="bm-raw__key">
                      {DNA_LABELS[key] || key}
                      <code>{key}</code>
                    </p>
                    <p className={`bm-raw__val${value ? '' : ' is-empty'}`}>
                      {value || '(empty)'}
                    </p>
                  </div>
                );
              })}
            </section>
          ) : data && tab === 'memory' ? (
            <section className="bm-raw__block">
              {memoryBlocks.map((g) => (
                <div className="bm-raw__field" key={g.id}>
                  <p className="bm-raw__key">{g.title}</p>
                  <p className={`bm-raw__val${g.text ? '' : ' is-empty'}`}>
                    {g.text || '(empty)'}
                  </p>
                </div>
              ))}
            </section>
          ) : data ? (
            <>
              <section className="bm-raw__block">
                <h3>Gaps</h3>
                <pre className="bm-raw__pre">
                  {JSON.stringify(data.memoryGaps || [], null, 2)}
                </pre>
              </section>
              <section className="bm-raw__block">
                <h3>Analysis markdown</h3>
                <p className="bm-raw__meta">
                  {[data.reportId, data.s3Key].filter(Boolean).join(' · ')}
                </p>
                {data.markdown ? (
                  <pre className="bm-raw__pre bm-raw__pre--tall">{data.markdown}</pre>
                ) : (
                  <p className="bm-raw__val is-empty">No analysis file on S3.</p>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

export default function BrandDna() {
  const debug = useAiDebug();
  const [reportId, setReportId] = useState(null);
  const [sections, setSections] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [hideGaps, setHideGaps] = useState(false);
  const [interviewing, setInterviewing] = useState(false);
  const [interviewBusy, setInterviewBusy] = useState(false);
  const [interviewError, setInterviewError] = useState('');
  const [inspecting, setInspecting] = useState(false);
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
        setGaps(Array.isArray(data.gaps) ? data.gaps : []);
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
  const visibleGaps = notFound ? [] : gaps;

  async function clearMemory() {
    if (!reportId || clearing) return;
    setClearing(true);
    setError('');
    setFlash('');
    try {
      const data = await updateBrandDna(reportId, emptyFields());
      setSections(data.sections || []);
      setGaps(Array.isArray(data.gaps) ? data.gaps : []);
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

  async function saveGapAnswers(answers) {
    if (!reportId || interviewBusy) return;
    setInterviewBusy(true);
    setInterviewError('');
    setError('');
    setFlash('');
    try {
      const data = await fillBrandDnaGaps(reportId, answers);
      setSections(data.sections || []);
      setGaps(Array.isArray(data.gaps) ? data.gaps : []);
      setHideGaps(false);
      setInterviewing(false);
      setFlash('Updated.');
    } catch (err) {
      setInterviewError(err.response?.data?.message || err.message || 'Could not update just now.');
    } finally {
      setInterviewBusy(false);
    }
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
      setGaps(Array.isArray(data.gaps) ? data.gaps : []);
      setHideGaps(false);
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
        {(debug.enabled && reportId) || hasMemory ? (
          <div className="bm-head__acts">
            {debug.enabled && reportId ? (
              <button
                type="button"
                className="btn btn--tertiary bm-clear-btn"
                onClick={() => setInspecting(true)}
              >
                Raw DNA
              </button>
            ) : null}
            {hasMemory ? (
              <button
                type="button"
                className="btn btn--tertiary bm-clear-btn"
                onClick={() => setConfirming(true)}
              >
                Clear memory
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!loading && !hideGaps && visibleGaps.length > 0 && (
        <GapWarning
          gaps={visibleGaps}
          onAnswer={reportId ? () => { setInterviewError(''); setInterviewing(true); } : null}
          onDismiss={() => setHideGaps(true)}
        />
      )}

      {loading ? (
        <BrandDnaSkeleton />
      ) : notFound || !hasMemory ? (
        <EmptyMemory notFound={notFound}>
          {composer}
          {status}
        </EmptyMemory>
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
          {composer}
          {status}
        </div>
      )}

      {confirming && (
        <ClearConfirm
          busy={clearing}
          onCancel={() => setConfirming(false)}
          onClear={clearMemory}
        />
      )}
      {interviewing && visibleGaps.length > 0 && (
        <GapInterview
          gaps={visibleGaps}
          busy={interviewBusy}
          error={interviewError}
          onClose={() => { if (!interviewBusy) { setInterviewing(false); setInterviewError(''); } }}
          onSave={saveGapAnswers}
        />
      )}
      {inspecting && reportId && (
        <RawInspect
          reportId={reportId}
          onClose={() => setInspecting(false)}
        />
      )}
    </div>
  );
}
