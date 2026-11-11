/*
 * Projects — Bauhly's long-term memory. A project holds the raw material the
 * studio gathers through the week; the weekly plan reads it back.
 *
 * Ported from the bauhly-v3 design (projects.css) and wired to a client-side
 * store (lib/projectsStore.js) — there is no projects backend yet, so it
 * persists to localStorage and starts empty. Capture is a streamlined modal
 * (a note + optional photos/clips) rather than the prototype's full voice
 * conversation + photo editor; the project detail is a read-only review of
 * everything captured, grouped by week, with a side panel + lightbox per entry.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { translate } from '../i18n';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../brand/Icon';
import { Mark } from '../brand/Logo';
import { AutoTextarea, useBodyScrollLock } from './checkin/ui';
import { RecordingSheet, useRecorder, refreshDraftIfUnedited, captureSttLanguages, AiProcessing } from './checkin/recorder';
import ScrollJump from './checkin/ScrollJump';
import {
  useProjects, useProjectsHydrated, createProject, renameProject, deleteProject,
  addEntry, addSession, resumeSession, updateEntry, deleteSession, moveSession,
  analyzeProjectAssets, analyzeAsset,
  coverOf, groupByWeek, groupCapturesIntoSessions, sessionCount, sessionDisplayText,
  sessionDisplayTitle, sessionConversationTurns, storiesFromConversationTurns, fmtWhen, uploadFiles,
} from '../lib/projectsStore';
import { listGeneratedImages, deleteGeneratedImage } from '../api/images';
import { understandCapture, transcribeCapture, clarificationQuestion, hasTranscriptGap, transcriptGapQuestion } from '../api/projects';
import { previewUrl } from '../api/media';
import { useAuth } from '../context/AuthContext';
import CaptureLogin from '../components/CaptureLogin';
import { ExamplePreview, ExampleEditor } from '../components/ExamplePost';
import { IG_ASK, questionById, instagramHandle, saysNo, nextQuestion, answerSay } from '../lib/discovery';
import { startVisitorRead, claimVisitorRead } from '../api/visitor';
import { useTypedPlaceholder } from '../components/ui/typing';
import { canTakeCaret, isCaptureOpen, CAPTURE_MORPH_MS, CAPTURE_HOLD_MS } from '../lib/captureUi';
import { ensureProjects, refreshProjects, projectsSnapshot } from '../lib/projectsStore';
import { startPlanGeneration, getPlanGeneration, openNextInEditor } from '../lib/planGeneration';
import './projects.css';

/* The generated-image list is fetched from the server, which takes a moment —
 * long enough that the "Generated" folder used to pop in a second after the page.
 * We cache the last list in localStorage (per Instagram handle, matching the
 * server's account scoping) so the card renders INSTANTLY from cache on mount,
 * then reconciles when the network list arrives. */
const GEN_CACHE_KEY = 'bauhly.genimages';
function genCacheKey() {
  try {
    const h = (localStorage.getItem('bauhly.currentHandle') || '').trim().toLowerCase();
    return h ? `${GEN_CACHE_KEY}::${h}` : GEN_CACHE_KEY;
  } catch { return GEN_CACHE_KEY; }
}
export function readGenCache() {
  try {
    const raw = localStorage.getItem(genCacheKey());
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
export function writeGenCache(list) {
  try { localStorage.setItem(genCacheKey(), JSON.stringify(list || [])); } catch { /* quota/private mode — cache is best-effort */ }
}
import './yourweek.css'; /* the shared .empty brand-moment styles */
import './checkin/checkin.css'; /* the conversation surface, shared with the check-in */

/* ── media strip — thumbnails with a +N overflow tile ───────────────────── */
function MediaStrip({ attachments, max = 4 }) {
  const shown = attachments.slice(0, max);
  const extra = attachments.length - shown.length;
  return (
    <div className="ms">
      {shown.map((a) => (
        <span className="ms__thumb" key={a.id}>
          <img src={previewUrl(a)} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
          {a.type === 'video' && <span className="ms__play"><Icon name="play" size={16} /></span>}
        </span>
      ))}
      {extra > 0 && <span className="ms__thumb ms__more">+{extra}</span>}
    </div>
  );
}

/* ── AI analysis — the metadata Bauhly reads off one asset ──────────────── */
const isHex = (c) => /^#?[0-9a-fA-F]{3,8}$/.test((c || '').trim());

// Compact token count (1,240 → "1.2k") and a cost that never rounds a real
// spend down to "$0.00" — tiny per-asset costs show more decimals instead.
function fmtTokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
function fmtUsd(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
function Chips({ items }) {
  return (
    <div className="aa__chips">
      {items.map((t, i) => <span className="aa__chip" key={i}>{t}</span>)}
    </div>
  );
}

/* The analysis of a single asset, shown when its "i" is tapped. Handles the
 * three states an asset can be in: never analysed, in flight, done/errored. */
function AssetAnalysis({ analysis, busy, onAnalyze, onClose }) {
  const a = analysis;
  const done = a && a.status === 'done';
  return (
    <div className="aa" role="dialog" aria-modal="true" aria-label="Asset analysis">
      <div className="aa__scrim" onClick={onClose} />
      <div className="aa__card">
        <header className="aa__head">
          <span className="aa__title"><Icon name="sparkle" size={15} /> AI analysis</span>
          <button className="np__close" onClick={onClose} aria-label="Close"><Icon name="x" size={15} strokeWidth={2.25} /></button>
        </header>

        <div className="aa__body">
          {busy && (
            <div className="aa__state"><span className="pj-spin pj-spin--lg" aria-hidden="true" /><span>Analysing this asset…</span></div>
          )}
          {!busy && !a && (
            <div className="aa__state aa__state--empty">
              <p>This asset hasn’t been analysed yet.</p>
              <button className="btn btn--primary btn--sm" onClick={onAnalyze}><Icon name="sparkle" size={15} /> Analyse now</button>
            </div>
          )}
          {!busy && a && a.status === 'error' && (
            <div className="aa__state aa__state--err">
              <p>{a.error || 'Analysis failed.'}</p>
              <button className="btn btn--tertiary btn--sm" onClick={onAnalyze}>Try again</button>
            </div>
          )}
          {!busy && done && (
            <>
              {a.summary && <p className="aa__summary">{a.summary}</p>}
              {a.description && <p className="aa__desc">{a.description}</p>}
              {a.mood && <div className="aa__row"><span className="aa__label">Mood</span><span>{a.mood}</span></div>}
              {a.subjects?.length > 0 && (
                <div className="aa__row aa__row--col">
                  <span className="aa__label">Subjects</span>
                  <Chips items={a.subjects.map((s) => {
                    if (typeof s === 'string') return s;
                    const name = s?.name || '';
                    const b = s?.box;
                    if (!name) return '';
                    if (!b || b.x == null || b.y == null) return name;
                    return `${name}  ${b.x},${b.y}  ${b.w}×${b.h}`;
                  }).filter(Boolean)} />
                </div>
              )}
              {a.tags?.length > 0 && <div className="aa__row aa__row--col"><span className="aa__label">Tags</span><Chips items={a.tags} /></div>}
              {a.colors?.length > 0 && (
                <div className="aa__row aa__row--col">
                  <span className="aa__label">Colours</span>
                  <div className="aa__chips">
                    {a.colors.map((c, i) => (
                      <span className="aa__chip aa__chip--color" key={i}>
                        {isHex(c) && <span className="aa__swatch" style={{ background: c.startsWith('#') ? c : `#${c}` }} />}
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {a.text && <div className="aa__row aa__row--col"><span className="aa__label">Text in image</span><span className="aa__text">“{a.text}”</span></div>}
              {(a.inputTokens > 0 || a.outputTokens > 0) && (
                <div className="aa__row aa__usage">
                  <span className="aa__label">Cost</span>
                  <span className="aa__usageval">
                    <b>~{fmtUsd(a.costUsd)}</b>
                    <span className="aa__usagesub">
                      {fmtTokens((a.inputTokens || 0) + (a.outputTokens || 0))} tokens
                      {' · '}{fmtTokens(a.inputTokens)} in / {fmtTokens(a.outputTokens)} out
                      {a.model ? ` · ${a.model}` : ''}
                    </span>
                  </span>
                </div>
              )}
              <div className="aa__foot">
                <button className="btn btn--quiet btn--sm" onClick={onAnalyze}><Icon name="refresh" size={14} /> Re-analyse</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── conversation thread in the session panel ───────────────────────────── */
function isSkipResponse(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return t === 'skip this question'
    || t.startsWith('skip this question.')
    || t.startsWith('skip this question. leave it unknown');
}

function displayTurnText(text) {
  if (isSkipResponse(text)) return 'Skipped — left unknown';
  return text;
}

function SessionConversation({
  turns,
  title,
  summary,
  editable,
  canEditResponses,
  summaryStale,
  summarizing,
  onSummaryBlur,
  onTitleBlur,
  onSaveTurn,
  onRegenerateSummary,
}) {
  const [editingIdx, setEditingIdx] = useState(null);
  const [draft, setDraft] = useState('');
  const [wasSkip, setWasSkip] = useState(false);
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const autoDraft = useRef('');
  const rec = useRecorder();
  const recording = editingIdx !== null && (rec.status === 'recording' || rec.status === 'done');

  useEffect(() => {
    if (editingIdx === null) return undefined;
    if (rec.status !== 'done') return undefined;
    const blob = rec.blob;
    const live = String(rec.liveText || '').trim();
    (async () => {
      setPolishing(true);
      try {
        let text = live;
        if (blob) {
          try {
            const result = await transcribeCapture(blob, {
              hint: live,
              languages: captureSttLanguages(rec.speechLang),
            });
            text = result.text || live;
          } catch {
            text = live;
          }
        }
        if (text) refreshDraftIfUnedited(setDraft, autoDraft, text);
      } finally {
        setPolishing(false);
        rec.reset();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.status, rec.blob]);

  const startEdit = (i, text) => {
    const skipped = isSkipResponse(text);
    setEditingIdx(i);
    setDraft(skipped ? '' : text);
    setWasSkip(skipped);
    autoDraft.current = '';
    setPolishing(false);
    rec.reset();
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setDraft('');
    setWasSkip(false);
    autoDraft.current = '';
    setPolishing(false);
    if (rec.status === 'recording') rec.stop();
    rec.reset();
  };

  const saveEdit = async () => {
    const next = draft.trim();
    if (!next || editingIdx === null || !onSaveTurn) return;
    setSaving(true);
    try {
      await onSaveTurn(editingIdx, next);
      cancelEdit();
    } finally {
      setSaving(false);
    }
  };

  const startVoice = () => {
    autoDraft.current = '';
    setPolishing(false);
    rec.reset();
    rec.start();
  };

  const hasTurns = turns.length > 0;
  return (
    <div className="sc">
      {hasTurns ? (
        <div className="sc__thread" aria-label="Conversation">
          {turns.map((t, i) => {
            const isUser = t.role !== 'assistant';
            const isEditing = canEditResponses && isUser && editingIdx === i;
            const skipped = isUser && isSkipResponse(t.text);
            return (
              <div
                key={`${t.role}-${i}`}
                className={`sc__turn sc__turn--${isUser ? 'user' : 'bauhly'}${isEditing ? ' is-editing' : ''}`}
              >
                {!isUser && (
                  <span className="sc__who" aria-hidden="true">
                    <Mark size={12} />
                  </span>
                )}
                {isEditing ? (
                  <div className="sc__edit">
                    {wasSkip && (
                      <span className="sc__edit-hint">Last response was skipped — add an answer if you have one.</span>
                    )}
                    <AutoTextarea
                      className="ctxf ctxf--panel sc__edit-field"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label="Edit response"
                      placeholder={wasSkip ? 'Type your answer…' : 'Your answer…'}
                      minHeight={72}
                      autoFocus
                    />
                    {polishing && <AiProcessing className="sc__edit-note" />}
                    <div className="sc__edit-acts">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={!draft.trim() || saving || polishing}
                        onClick={saveEdit}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--tertiary btn--sm"
                        disabled={saving || polishing || recording}
                        onClick={startVoice}
                      >
                        <Icon name="pulse" size={14} /> Record
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet btn--sm"
                        disabled={saving}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`sc__bubble${isUser ? ' sc__bubble--user' : ''}`}>
                    <p className={`sc__text${skipped ? ' sc__text--skip' : ''}`}>{displayTurnText(t.text)}</p>
                    {canEditResponses && isUser && (
                      <button
                        type="button"
                        className="sc__edit-btn"
                        onClick={() => startEdit(i, t.text)}
                      >
                        <Icon name="edit" size={13} strokeWidth={2} /> Edit
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {(title || summary || editable) && (
        <div className={`sc__summary${hasTurns ? ' sc__summary--after' : ''}`}>
          {(title || editable) && (
            editable ? (
              <input
                className="sc__title-field"
                key={`title-${title}`}
                defaultValue={title}
                aria-label="Session title"
                placeholder="Title for this conversation…"
                onBlur={onTitleBlur}
              />
            ) : (
              title ? <h3 className="sc__title">{title}</h3> : null
            )
          )}
          <div className="sc__summary-head">
            {hasTurns && <span className="sc__summary-label">Summary</span>}
            {summaryStale && (
              <button
                type="button"
                className="btn btn--tertiary btn--sm sc__regen-summary"
                disabled={summarizing || editingIdx !== null}
                onClick={onRegenerateSummary}
              >
                <Icon name="refresh" size={13} strokeWidth={2} />
                {summarizing ? 'Updating summary…' : 'Regenerate summary'}
              </button>
            )}
          </div>
          {editable ? (
            <textarea
              className="ctxf ctxf--panel"
              key={summary}
              defaultValue={summary}
              aria-label="Session summary"
              placeholder="Summary of this conversation…"
              onBlur={onSummaryBlur}
            />
          ) : (
            summary ? <p className="sc__summary-text">{summary}</p> : null
          )}
        </div>
      )}

      {recording && (
        <RecordingSheet
          rec={rec}
          note="Speak your answer — stop when you're done."
          label="Edit response"
        />
      )}
    </div>
  );
}

function EntryCard({ entry, others, regenerating, uploadingFiles, onOpen, onMove, onDelete, onRegenerate, onAddFiles }) {
  const [menu, setMenu] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const fileRef = useRef(null);
  const closeMenu = () => { setMenu(false); setMoveOpen(false); };
  const video = entry.type === 'video' ? (entry.attachments || [])[0] : null;
  const summary = sessionDisplayText(entry);
  const title = sessionDisplayTitle(entry);
  const atts = entry.attachments || [];
  const open = () => onOpen(entry);
  const pickFiles = () => fileRef.current?.click();
  const handleFiles = async (fileList) => {
    const list = [...(fileList || [])].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!list.length || !onAddFiles) return;
    closeMenu();
    await onAddFiles(entry, list);
  };
  return (
    <div
      className={`pe pe--${entry.type}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      <div className="pe__top">
        <div className="pe__toprow">
          <span className="pe__date">{fmtWhen(entry.createdAt)}</span>
          <span className="pe__spacer" />
          <button
            type="button"
            className="pe__regen"
            disabled={regenerating}
            aria-label="Regenerate plan from this conversation"
            onClick={(e) => {
              e.stopPropagation();
              if (!regenerating) onRegenerate?.(entry);
            }}
          >
            <Icon name="refresh" size={14} strokeWidth={2} />
            <span>{regenerating ? 'Regenerating…' : 'Regenerate plan'}</span>
          </button>
          <button className="pe__more" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu}
            onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}>
            <Icon name="more" size={18} />
          </button>
        </div>
      </div>

      {title && <h3 className="pe__title">{title}</h3>}
      {summary && <p className="pe__text">{summary}</p>}

      {video ? (
        <div className="pe__video" onClick={(e) => { e.stopPropagation(); onOpen(entry, 0); }}>
          <img src={video.thumbnailUrl} alt="" loading="lazy" />
          <span className="ms__play"><Icon name="play" size={16} /></span>
        </div>
      ) : atts.length > 0 ? (
        <MediaStrip attachments={atts} />
      ) : (
        <button
          type="button"
          className="pe__addfiles"
          disabled={uploadingFiles}
          onClick={(e) => { e.stopPropagation(); pickFiles(); }}
        >
          <Icon name="image" size={15} strokeWidth={2} />
          <span>{uploadingFiles ? 'Analysing…' : 'Add photos or clips'}</span>
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        disabled={uploadingFiles}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
      />

      {menu && (
        <>
          <div className="pe-menu__scrim" onClick={(e) => { e.stopPropagation(); closeMenu(); }} />
          <div className="pe-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            {!moveOpen ? (
              <>
                <button role="menuitem" disabled={uploadingFiles} onClick={() => pickFiles()}>
                  <Icon name="image" size={17} />
                  <span className="pe-menu__grow">{uploadingFiles ? 'Analysing…' : 'Add files'}</span>
                </button>
                <button role="menuitem" onClick={() => setMoveOpen(true)}>
                  <Icon name="plan" size={17} />
                  <span className="pe-menu__grow">Move to project</span>
                  <Icon name="chevron-right" size={16} />
                </button>
                <div className="pe-menu__sep" />
                <button role="menuitem" className="pe-menu__del" onClick={() => { closeMenu(); onDelete(entry.id); }}><Icon name="trash" size={17} /> Delete</button>
              </>
            ) : (
              <>
                <button role="menuitem" className="pe-menu__back" onClick={() => setMoveOpen(false)}>
                  <Icon name="arrow-left" size={16} />
                  <span className="pe-menu__grow">Move to project</span>
                </button>
                <div className="pe-menu__sep" />
                {others.length === 0 && <span className="pe-menu__label">No other projects</span>}
                {others.map((p) => (
                  <button key={p.id} role="menuitem" onClick={() => { closeMenu(); onMove(entry.id, p.id); }}><span className="pe-menu__grow">{p.name}</span></button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── the full entry, in a side panel with a lightbox ───────────────────── */
export function EntryPanel({ project, entry, week, regenerating, onClose, onRegenerate }) {
  const [light, setLight] = useState(null); // index into attachments, or null
  const [analysisFor, setAnalysisFor] = useState(null); // index whose analysis is open
  const [analyzingId, setAnalyzingId] = useState(null); // attachment id in flight
  const [summaryStale, setSummaryStale] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const atts = entry.attachments || [];
  const turns = sessionConversationTurns(entry);
  const summary = sessionDisplayText(entry);
  const title = sessionDisplayTitle(entry);
  const captureId = entry.id;

  useEffect(() => {
    setSummaryStale(false);
  }, [captureId]);

  useEffect(() => {
    if (light === null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setLight(null);
      else if (e.key === 'ArrowRight') setLight((i) => (i + 1) % atts.length);
      else if (e.key === 'ArrowLeft') setLight((i) => (i - 1 + atts.length) % atts.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [light, atts.length]);

  const [uploading, setUploading] = useState(false);
  const addFiles = async (files) => {
    setUploading(true);
    try {
      const added = await uploadFiles(files);
      await updateEntry(project.id, captureId, { attachments: [...atts, ...added] });
    } finally {
      setUploading(false);
    }
  };
  const current = light !== null ? atts[light] : null;
  const analysisAtt = analysisFor !== null ? atts[analysisFor] : null;

  const runAnalysis = async (att) => {
    setAnalyzingId(att.id);
    try {
      await analyzeAsset(project.id, captureId, att.id);
    } finally {
      setAnalyzingId(null);
    }
  };

  const saveTurn = async (idx, text) => {
    const nextTurns = turns.map((t, i) => (i === idx ? { ...t, text } : t));
    const stories = storiesFromConversationTurns(
      Array.isArray(entry.stories) && entry.stories.length
        ? entry.stories
        : (entry.understanding ? [entry.understanding] : []),
      nextTurns,
    );
    await updateEntry(project.id, captureId, {
      conversationTurns: nextTurns,
      stories,
      understanding: stories[0],
    });
    setSummaryStale(true);
  };

  const regenerateSummary = async () => {
    setSummarizing(true);
    try {
      const sourceText = turns.find((t) => t.role === 'user')?.text
        || String(entry.understanding?.originalCapture || entry.text || '').trim();
      const result = await understandCapture({
        text: sourceText,
        turns,
        projectName: project.name || '',
        forceReady: true,
        attachments: (atts || []).map((a) => ({ type: a.type, key: a.key })).filter((a) => a.key),
      });
      const nextSummary = String(result?.conversationSummary || '').trim();
      const nextTitle = String(result?.conversationTitle || '').trim();
      const nextStories = (Array.isArray(result?.captures) && result.captures.length)
        ? result.captures
        : (result?.understanding ? [result.understanding] : null);
      const stories = nextStories
        ? storiesFromConversationTurns(nextStories, turns)
        : storiesFromConversationTurns(
          Array.isArray(entry.stories) && entry.stories.length
            ? entry.stories
            : (entry.understanding ? [entry.understanding] : []),
          turns,
        );
      await updateEntry(project.id, captureId, {
        ...(nextSummary ? { text: nextSummary, sessionSummary: nextSummary } : {}),
        ...(nextTitle ? { sessionTitle: nextTitle } : {}),
        conversationTurns: turns,
        stories,
        understanding: stories[0],
      });
      setSummaryStale(false);
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <>
      <div className="np-scrim" onClick={onClose} />
      <aside className="np" role="dialog" aria-modal="true" aria-label="Note">
        <header className="np__bar">
          <span className="np__title">About this session</span>
          <div className="np__baracts">
            <button
              type="button"
              className="btn btn--tertiary btn--sm"
              disabled={regenerating}
              onClick={() => onRegenerate?.(entry)}
            >
              <Icon name="refresh" size={14} strokeWidth={2} />
              {regenerating ? 'Regenerating…' : 'Regenerate plan'}
            </button>
            <button className="np__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
          </div>
        </header>

        <div className="np__body">
          <div className="np__meta">
            <span>{week ? `${week} · ` : ''}{fmtWhen(entry.createdAt)}</span>
          </div>

          <SessionConversation
            turns={turns}
            title={title}
            summary={summary}
            editable
            canEditResponses={turns.some((t) => t.role === 'user')}
            summaryStale={summaryStale}
            summarizing={summarizing}
            onSaveTurn={saveTurn}
            onRegenerateSummary={regenerateSummary}
            onTitleBlur={(e) => {
              const next = e.target.value.trim();
              const prev = title;
              if (next !== prev) {
                updateEntry(project.id, captureId, { sessionTitle: next });
              }
            }}
            onSummaryBlur={(e) => {
              const next = e.target.value;
              const prev = summary;
              if (next !== prev) {
                updateEntry(project.id, captureId, { text: next, sessionSummary: next });
                setSummaryStale(false);
              }
            }}
          />

          <div className="np__grid">
            {atts.map((a, i) => {
              const state = a.analysis?.status; // undefined | 'done' | 'error' | 'pending'
              return (
                <div className="np__cell" key={a.id}>
                  <button className="np__cellopen" onClick={() => setLight(i)} aria-label={`Open ${a.type} ${i + 1} of ${atts.length}`}>
                    <span className="np__cellmedia">
                      <img src={previewUrl(a)} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                      {a.type === 'video' && <span className="ms__play"><Icon name="play" size={18} /></span>}
                    </span>
                  </button>
                  {a.type === 'image' && (
                    <button
                      className={`np__info${state === 'done' ? ' is-done' : ''}${state === 'error' ? ' is-err' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setAnalysisFor(i); }}
                      aria-label={state === 'done' ? 'Show AI analysis' : 'Analyse this asset'}
                      title={state === 'done' ? 'AI analysis' : 'Analyse with AI'}
                    >
                      <Icon name="info" size={15} />
                    </button>
                  )}
                </div>
              );
            })}
            <label className={`np__add ${uploading ? 'is-busy' : ''}`} aria-busy={uploading}>
              {uploading ? <span className="pj-spin" /> : <Icon name="plus" size={20} strokeWidth={2.5} />}
              <span>{uploading ? 'Analysing…' : 'Add'}</span>
              <input type="file" accept="image/*,video/*" multiple hidden disabled={uploading}
                onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
        </div>
      </aside>

      {current && (
        <div className="lb" role="dialog" aria-modal="true" aria-label="Media viewer">
          <div className="lb__scrim" onClick={() => setLight(null)} />
          <div className="lb__bar lb__bar--top">
            <span className="lb__count">{light + 1} / {atts.length}</span>
            <button className="lb__close" onClick={() => setLight(null)} aria-label="Close"><Icon name="x" size={20} strokeWidth={2.25} /></button>
          </div>
          {atts.length > 1 && (
            <button className="lb__nav lb__nav--prev" onClick={() => setLight((i) => (i - 1 + atts.length) % atts.length)} aria-label="Previous"><Icon name="arrow-left" size={22} /></button>
          )}
          <figure className="lb__stage">
            {current.type === 'image'
              ? <img src={previewUrl(current)} alt="" />
              : <video src={current.url} poster={previewUrl(current)} controls autoPlay playsInline />}
          </figure>
          {atts.length > 1 && (
            <button className="lb__nav lb__nav--next" onClick={() => setLight((i) => (i + 1) % atts.length)} aria-label="Next"><Icon name="arrow-right" size={22} /></button>
          )}
        </div>
      )}

      {analysisAtt && (
        <AssetAnalysis
          analysis={analysisAtt.analysis}
          busy={analyzingId === analysisAtt.id}
          onAnalyze={() => runAnalysis(analysisAtt)}
          onClose={() => setAnalysisFor(null)}
        />
      )}
    </>
  );
}

/* ── create / edit a project ───────────────────────────────────────────── */
export function ProjectFormModal({ mode, project, onClose, onSubmit }) {
  const isEdit = mode === 'edit';
  const [name, setName] = useState(project?.name || '');
  const submit = () => { if (name.trim()) onSubmit(name.trim()); };
  return (
    <>
      <div className="fm-scrim" onClick={onClose} />
      <div className="fm" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit project' : 'New project'}>
        <div className="fm__head">
          <h2>{isEdit ? 'Edit project' : 'New project'}</h2>
          <button className="np__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
        </div>
        <div className="fm__body">
          <label className="fm__field">
            <span className="fm__label">Project name</span>
            <input className="input" value={name} autoFocus placeholder="e.g. Prinsengracht apartment"
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
        </div>
        <div className="fm__foot">
          <span className="fm__spacer" />
          <button className="fm__cancel" onClick={onClose}>Cancel</button>
          <button className="fm__submit" disabled={!name.trim()} onClick={submit}>{isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </>
  );
}

/* ── the conversation engine — same rhythm as the weekly check-in ────────
 * Ported from bauhly-v3's CaptureChat. Bauhly asks one thing, waits, then the
 * answer chips appear under it. */
let ckMsgId = 1;
/* a landing visit is told the words matter: an answer that comes back at once
   reads as a script (bauhly-v3, Nov 6: "a one-second loading or thinking state") */
const LANDING_THINK_MS = 1000;
/* a stable list for `useTypedPlaceholder` when there are no examples (its effect keys on the list) */
const NO_ASKS = ['…'];
function useConversation(beat = 420) {
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const push = (msg) => setMessages((m) => [...m, { id: ckMsgId++, ...msg }]);
  const say = (texts, extra = 0) => {
    const list = Array.isArray(texts) ? texts : [texts];
    let delay = 0;
    list.forEach((text, i) => {
      /* `beat` is how long the dots show. At its 420 these are the 520 and 860 this has always been */
      delay += (i === 0 ? 100 : 440) + beat;
      const at = delay;
      timers.current.push(
        setTimeout(() => setTyping(true), at - beat),
        setTimeout(() => {
          setTyping(false);
          // Settings › Language: scripted lines come from the catalog; the
          // model's own questions already arrive in the UI language.
          push(typeof text === 'string'
            ? { from: 'bauhly', text: translate(text) }
            : { from: 'bauhly', ...text, ...(typeof text.text === 'string' ? { text: translate(text.text) } : {}) });
        }, at),
      );
    });
    return delay + extra;
  };
  const after = (ms, fn) => timers.current.push(setTimeout(fn, ms));
  /* the same dots with no line after them, for a press whose answer is not words */
  const think = (fn) => {
    setTyping(true);
    timers.current.push(setTimeout(() => { setTyping(false); fn(); }, beat));
  };
  /* takes back what was said about something that has changed (the Instagram card and its reply) */
  const drop = (fn) => setMessages((m) => m.filter((x) => !fn(x)));
  return { messages, typing, push, say, after, think, drop };
}

/* the landing's photo question (bauhly-v3 LANDING_PHOTO_ASK) */
const LANDING_PHOTO_ASK = 'Do you have any photos or images of this project? You can share work-in-progress photos, materials, sketches, or anything that helps tell the story.';

/* ── HOW FAR BAUHLY HAS GOT WITH THE EXAMPLE (bauhly-v3 GenProgress + lib/postrun.js stages) ────────────
   One sequence in ink: an empty ring before, a small drawing of what it is doing while it runs, a tick on a
   disc once done. No percentages and no estimates. The example's are on a clock: it is only shown. */
const EX_STAGES = [
  { id: 'reading', label: 'Reading what you shared', motion: 'scan' },
  { id: 'structuring', label: 'Structuring the story', motion: 'stack' },
  { id: 'designing', label: 'Designing the slides', motion: 'grid' },
  { id: 'preview', label: 'Preparing your preview', motion: 'frame' },
];
const EX_STAGE_MS = 1100;
/* what happens after a visitor makes their account, in the order it happens (visitorGenerate; bauhly-v3
   lib/postrun.js STAGES). Their first post is made in this box, not on the calendar's loading screen
   (bauhly-v3 decision 743: "Keep the user in the same view while generation finishes"). Each stage is a
   real step: the studio is the Instagram claim (only when they gave one), reading is the upload, the
   capture's understanding and filing, structuring is the plan run's `queued`/`planning` (the Strategist),
   designing its `writing`/`finalizing` (the carousel), and the preview is handing the post to the Editor. */
const VISITOR_STAGES = [
  { id: 'studio', label: 'Understanding your studio', motion: 'scan' },
  { id: 'reading', label: 'Reading what you shared', motion: 'scan' },
  { id: 'structuring', label: 'Structuring the story', motion: 'stack' },
  { id: 'designing', label: 'Designing the slides', motion: 'grid' },
  { id: 'preview', label: 'Preparing your preview', motion: 'frame' },
];
/* paced to be read (bauhly-v3 postrun.js MIN_STAGE_MS / MIN_PREVIEW_MS / TICK_MS): a stage that finishes
   early is held, a slower one is shown for as long as it really takes */
const VISITOR_STAGE_MS = 2900;
const VISITOR_PREVIEW_MS = 1900;
const VISITOR_TICK_MS = 200;
/* with every stage ticked, a moment to see it before the Editor opens (bauhly-v3 OPEN_HOLD_MS) */
const VISITOR_OPEN_HOLD_MS = 700;
/* no queue to report the run's stage: the Strategist has usually finished by then */
const VISITOR_UNREPORTED_DESIGN_MS = 30000;
function StageMotion({ kind }) {
  return (
    <span className={`gprog__motion gprog__motion--${kind}`} aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'scan' && (<><rect x="2.5" y="1.5" width="9" height="11" rx="1.5" /><path className="gprog__beam" d="M4 4.5h6" /></>)}
        {kind === 'stack' && (<><path className="gprog__bar" d="M2.5 3.5h9" /><path className="gprog__bar" d="M2.5 7h9" /><path className="gprog__bar" d="M2.5 10.5h6" /></>)}
        {kind === 'grid' && (<>
          <rect className="gprog__cell" x="1.5" y="1.5" width="4.5" height="4.5" rx="1" />
          <rect className="gprog__cell" x="8" y="1.5" width="4.5" height="4.5" rx="1" />
          <rect className="gprog__cell" x="1.5" y="8" width="4.5" height="4.5" rx="1" />
          <rect className="gprog__cell" x="8" y="8" width="4.5" height="4.5" rx="1" />
        </>)}
        {kind === 'frame' && (<><rect x="1.5" y="2.5" width="11" height="9" rx="1.5" /><path d="M3.5 10l2.5-3 2 2 1.5-1.5 1.5 2.5" /><path className="gprog__sheen" d="M5 3.5l-2 7" /></>)}
      </svg>
    </span>
  );
}
function GenProgress({ at, stages = EX_STAGES, doneSay = 'Your example is ready.' }) {
  const active = stages[at] || null;
  return (
    <div className="gprog">
      <ul className="gprog__card">
        {stages.map((s, i) => {
          const status = i < at ? 'done' : i === at ? 'active' : 'upcoming';
          return (
            <li className={`gprog__stage is-${status}`} key={s.id}>
              <span className="gprog__mark" aria-hidden="true">
                {status === 'done' && <Icon name="check" size={10} strokeWidth={2.75} />}
                {status === 'active' && <StageMotion kind={s.motion} />}
              </span>
              <span className="gprog__label">{s.label}</span>
            </li>
          );
        })}
      </ul>
      <span className="sr-only" role="status">{active ? active.label : doneSay}</span>
    </div>
  );
}

/* ── the "other project" picker — the projects list with a check + Add ──── */
function ProjectPickerModal({ projects, onClose, onPick, onNew }) {
  useBodyScrollLock();
  const [sel, setSel] = useState(null);
  return (
    <>
      <div className="fm-scrim" onClick={onClose} />
      <div className="fm fm--picker" role="dialog" aria-modal="true" aria-label="Choose a project">
        <div className="fm__head">
          <h2>Choose a project</h2>
          <button className="np__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
        </div>
        <div className="fm__body ppk__body">
          {projects.map((p) => {
            const cover = coverOf(p);
            return (
              <button key={p.id} className={`ppk__row ${sel === p.id ? 'is-sel' : ''}`} onClick={() => setSel(p.id)} aria-pressed={sel === p.id}>
                <span className="ppk__cover">{cover ? <img src={cover} alt="" onError={(e) => { e.target.style.display = 'none'; }} /> : <span className="pjcard__art" aria-hidden="true" />}</span>
                <span className="ppk__name">{p.name}</span>
                <span className="ppk__check">{sel === p.id && <Icon name="check" size={16} strokeWidth={2.5} />}</span>
              </button>
            );
          })}
          <button className="ppk__new" onClick={onNew}><Icon name="plus" size={15} strokeWidth={2.5} /> New project</button>
        </div>
        <div className="fm__foot">
          <span className="fm__spacer" />
          <button className="fm__cancel" onClick={onClose}>Cancel</button>
          <button className="fm__submit" disabled={!sel} onClick={() => onPick(projects.find((p) => p.id === sel))}>Add</button>
        </div>
      </div>
    </>
  );
}

/* ── Capture idea — the conversational capture, ported from bauhly-v3 ─────
 *
 * The reference's CaptureChat, rewired to the live backend: uploads go
 * browser→S3 via `uploadFiles`, and a finished capture is filed with
 * `addEntry` / `createProject` (projectsStore) rather than a local commit.
 *
 * The conversation itself is no longer a fixed script. After the user speaks
 * (or uploads), Capture-time understanding extracts what is actually known,
 * detects internal stories for clarification, preserves one unified Capture,
 * and asks at most four non-obvious questions that fill missing story pieces for the Strategist.
 * Strategy, Brand DNA, and format stay out of this conversation. */

/* The Capture composer — text, attach (+), voice (mic) and send (↑) in one
 * bordered field (bauhly-v3). It holds no capture logic: every control calls
 * back into CaptureChat. `live` is whether the step can take input; off, the
 * field greys and the buttons stop — it never unmounts, so the box does not
 * jump each time Bauhly speaks. Empty, it is a single bar; with text, the
 * words take the top and the controls drop to a row beneath. */
function CaptureComposer({ aiPolishing = false, value, onValue, live, canSend, placeholder, onSend, onFiles, onRecord, pending = [], onRemoveFile, plus = true, locked = false, fading = false, mic = true }) {
  /* staged images make the composer non-empty even with no text, so it takes
     its two-row shape (thumbnails on top, field, controls beneath) */
  const empty = !value && pending.length === 0;
  /* `locked`: words are arriving on their own (See an example) — the field
     keeps its resting look but takes no hand (bauhly-v3 `locked`) */
  const on = live && !locked;
  return (
    <div className={`capc ${empty ? 'is-empty' : ''} ${live || locked ? '' : 'is-off'} ${locked ? 'is-locked' : ''} ${fading ? 'is-fading' : ''} ${plus ? '' : 'capc--noplus'}`}>
      {pending.length > 0 && (
        <div className="capc__pending">
          {pending.map((p) => (
            <span className="capc__thumb" key={p.id}>
              {p.type === 'video' ? <video src={p.url} muted /> : <img src={p.url} alt="" />}
              <button
                type="button"
                className="capc__thumbx"
                onClick={() => onRemoveFile?.(p.id)}
                aria-label="Remove attachment"
              >
                <Icon name="x" size={12} strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>
      )}
      <AutoTextarea
        className={`capc__field${aiPolishing ? ' is-ai-polishing' : ''}`}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        minHeight={24}
        placeholderGrows={false}
        rows={1}
        disabled={!live}
        readOnly={locked}
        placeholder={placeholder}
        aria-label="Your capture"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (on && canSend) onSend(); }
        }}
      />
      <div className="capc__acts">
        {plus && <label className={`capc__btn capc__add ${live ? '' : 'is-off'}`} title="Add a photo or clip">
          <Icon name="plus" size={17} strokeWidth={2.2} />
          <span className="sr-only">Add a photo or clip</span>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            disabled={!live}
            onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
          />
        </label>}
        <span className="capc__grow" />
        {mic && <button
          type="button"
          className="capc__btn capc__mic"
          disabled={!on}
          onClick={onRecord}
          title="Record a voice note"
        >
          <Icon name="mic" size={16} strokeWidth={2.2} />
          <span className="sr-only">Record a voice note</span>
        </button>}
        <button
          type="button"
          className="capc__send"
          disabled={!on || !canSend}
          onClick={onSend}
          title="Send"
        >
          <Icon name="arrow-up" size={16} strokeWidth={2.4} />
          <span className="sr-only">Send</span>
        </button>
      </div>
    </div>
  );
}

/* what the studio actually said in a capture's conversation — the reference
   quotes this, never the summary written from it */
function saidIn(turns, fallback = '') {
  const said = (turns || [])
    .filter((t) => t?.role === 'user' && !/^skip this question/i.test(String(t.text || '')))
    .map((t) => String(t.text || '').trim())
    .filter((t) => t && t !== 'Uploaded a file');
  return said.length ? said.join('\n\n') : String(fallback || '').trim();
}

/* "Today, 12:41" / "Oct 3, 09:10" — names one capture in the reference card */
function refWhen(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const today = new Date();
  const day = d.toDateString() === today.toDateString()
    ? 'Today'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day}, ${time}`;
}

/* bauhly-v3 `ck-quote`: what a clarification is ABOUT — the studio's own words
   and pictures, with when it was taken and where it is filed — drawn under the
   question so the studio knows what is being asked about */
function CaptureReference({ of: r }) {
  const quote = String(r?.quote || '').trim();
  const shots = (r?.shots || []).slice(0, 4);
  if (!quote && !shots.length) return null;
  return (
    <div className="ck-quote">
      <span className="ck-quote__head">
        <span className="ck-quote__label">From your capture</span>
        <span className="ck-quote__meta">
          {r.when}
          {r.project && (
            <span className="ck-quote__proj">
              <Icon name="folder" size={12} strokeWidth={2} />
              {r.project}
            </span>
          )}
        </span>
      </span>
      {quote && <p className="ck-quote__said">{`“${quote}”`}</p>}
      {shots.length > 0 && (
        <span className="ck-quote__shots">
          {shots.map((a) => (
            <span className="ck-quote__shot" key={a.key || a.id}>
              {a.type === 'video' ? <video src={a.url} muted /> : <img src={previewUrl(a)} alt="" />}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

export function CaptureChat({ presetProjectId, defaultProjectId, onExit, onViewProject, onCaptured, exitLabel = 'Back', modal = false, opening = '', savedLine = '', projectName = '', askProject = true, maxQuestions = 4, askMedia = true, resume = null, deferQuestions = false, adding = null, onPlan = null, run = null, landing = null, leaving = false, onLoggedIn = null, onRestart = null }) {
  const projects = useProjects();
  /* ══ A VISIT FROM THE LANDING PAGE (bauhly-v3, Nov 5–6) ══════════════════
     The hero's field grows into this box. The first line is there as it opens,
     the field cycles examples of what to say, `See an example` plays one, and
     a visitor logs in (or asks for access) at their first real send — nothing
     reaches the backend before they have an account. */
  const liveIntro = Boolean(landing);
  const asks = landing?.asks || null;
  /* a visitor's own capture after the example (Create your own) asks in its own words and skips the
     example's offer, because they have just done it (bauhly-v3 toOwn) */
  const example = landing?.own ? null : (landing?.example || null);
  const { user } = useAuth();
  /* dev only: `?visitor=1` on the landing page walks the signed-out visitor's flow in a signed-in browser */
  const forceVisitor = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('visitor');
  const needsLogin = liveIntro && (!user || forceVisitor);
  const { messages, typing, push, say, after, think, drop } = useConversation(liveIntro ? LANDING_THINK_MS : undefined);
  const [step, setStep] = useState('boot');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState([]); // images staged in the composer, sent with the next message
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => { try { URL.revokeObjectURL(p.url); } catch { /* ok */ } }), []);
  /* Escape closes the box, like its × and its scrim (bauhly-v3 CaptureHost). Read through a
     ref so the listener is bound once; the account step, when it is up, is left first.
     `defaultPrevented` leaves it to anything inside (a lightbox) that used the key itself. */
  const escRef = useRef(null);
  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      escRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);
  const [optionsReady, setOptionsReady] = useState(false);
  const [saved, setSaved] = useState(null);
  const [creating, setCreating] = useState(false); // the new-project modal
  const [busy, setBusy] = useState(false); // an upload, understand, or save is in flight
  const [polishing, setPolishing] = useState(false);
  /* bauhly-v3 (Oct 6): a new capture is filed without being interviewed — the
     question Bauhly would ask is kept on it and asked only when the studio
     presses `Generate plan`, under a heads-up band saying what is at stake */
  const planning = useRef(false);
  /* `run` (Captures › Generate plan): this question is one of a queue asked
     before the plan — { left, warn, onNext, onStop, onHideWarn }. Answering or
     skipping moves to the next; Save and close / × end the run. */
  const [notice, setNotice] = useState(() => {
    if (!run?.warn) return false;
    try { return localStorage.getItem('bauhly.planNotice.off') !== '1'; } catch { return true; }
  });
  const hideNotice = () => { setNotice(false); run?.onHideWarn?.(); };
  // the capture a clarification is about (see CaptureReference)
  const [reference, setReference] = useState(() => (resume ? {
    quote: saidIn(resume.turns, (resume.history || []).map((h) => h.text).filter(Boolean).join('\n\n') || resume.text),
    shots: resume.attachments || [],
    when: refWhen(resume.createdAt),
    project: projects.find((p) => p.id === resume.projectId)?.name || '',
  } : null));
  const rec = useRecorder({
    keywords: projects.map((p) => p.name).filter(Boolean),
  });
  const autoDraft = useRef('');
  const endRef = useRef(null);
  const threadRef = useRef(null);
  const cap = useRef({
    kind: null,
    text: '',
    attachments: [],
    understanding: null,
    understandings: [],
    conversationSummary: '',
    conversationTitle: '',
    askedQuestion: '',
    askedAnswer: '',
    turns: [],
    awaitingAssets: false,
    held: [], // questions held back until Generate plan (deferQuestions)
  });
  /* whether the field on screen came from a recording — only then is "record
   * again" a real answer */
  const fromVoice = useRef(false);
  /* after a take, land back on writing (opening note) or clarify */
  const recordingReturn = useRef('writing');

  const preset = projects.find((p) => p.id === presetProjectId);
  const resumed = useRef(false);

  /* ── THE QUESTION IS WHAT HAS TO BE ON SCREEN (bauhly-v3, Oct 6) ─────────
     Scrolling to the very end used to push Bauhly's question out of view above
     its own evidence — the "From your capture" card and the Save / Skip row
     under a clarification are taller than what is left of the box. So the
     thread goes to its end, but never past the top of the latest question;
     what does not fit below it stays a scroll away, the question does not. */
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (!modal || !el || el.scrollHeight <= el.clientHeight + 1) {
      endRef.current?.scrollIntoView({ block: 'end' });
      return undefined;
    }
    const place = () => {
      const end = el.scrollHeight - el.clientHeight;
      const asked = [...el.querySelectorAll('.ck-turn--bauhly')]
        .filter((n) => !n.classList.contains('ck-turn--actions') && n.innerText.trim())
        .pop();
      const top = asked
        ? asked.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 16
        : end;
      el.scrollTop = Math.max(0, Math.min(end, top));
    };
    place();
    // and again once a late part (a picture, the reference card) has its height
    const t = setTimeout(place, 80);
    return () => clearTimeout(t);
  }, [messages, typing, step, optionsReady, busy, modal]);

  /* capture owns the screen while it runs — same as onboarding */
  useEffect(() => {
    document.body.classList.add('is-immersive');
    return () => document.body.classList.remove('is-immersive');
  }, []);

  useEffect(() => {
    /* `adding` (bauhly-v3, Oct 5–6): Captures › Add opened the drive first;
       the chosen files arrive here as the studio's own turn, under the
       capture's history, and Bauhly asks what they are. Nothing is written to
       the capture until the studio answers or presses Save and close. */
    if (adding) {
      if (!resumed.current) {
        resumed.current = true;
        (adding.history || []).forEach((h) => push({ from: 'user', text: h.text || undefined, media: h.media?.length ? h.media : undefined }));
        (adding.turns || []).forEach((t) => push(t.role === 'assistant'
          ? { from: 'bauhly', text: t.text }
          : { from: 'user', text: /^skip this question/i.test(t.text) ? 'Skip this question' : t.text }));
        if (adding.files.length) push({ from: 'user', media: adding.files });
      }
      // Add arrives holding files; the pencil (Edit capture) arrives empty
      const ask = translate(!adding.files.length
        ? 'What would you like to add or change?'
        : adding.files.length > 1
          ? 'What are these, and what should I do with them?'
          : 'What is this one — and what should I do with it?');
      cap.current = {
        ...cap.current,
        text: '',
        kind: !adding.files.length ? 'note' : adding.files.some((a) => a.type === 'video') ? 'video' : 'photo',
        attachments: [...adding.files],
        askedQuestion: ask,
      };
      const d = say(ask);
      after(d, () => setStep('noting'));
      return;
    }
    /* `resume` picks a saved capture's conversation back up (Captures › Add
       the detail): its turns are shown as they were, then the question it was
       left without is asked again and the answer goes into that capture */
    if (resume) {
      const skip = /^skip this question/i;
      // StrictMode runs this twice in dev: the replayed turns are pushed once
      // (the question below is a timer, which the first run's cleanup clears)
      if (!resumed.current) {
        resumed.current = true;
        // a capture filed without a chat: what it holds is what the studio said
        (resume.history || []).forEach((h) => push({ from: 'user', text: h.text || undefined, media: h.media?.length ? h.media : undefined }));
        (resume.turns || []).forEach((t) => push(t.role === 'assistant'
          ? { from: 'bauhly', text: t.text }
          : { from: 'user', text: skip.test(t.text) ? 'Skip this question' : t.text }));
      }
      // the skipped exchanges go; the gap is asked afresh below
      const kept = [];
      (resume.turns || []).forEach((t) => {
        if (t.role === 'user' && skip.test(t.text)) { if (kept[kept.length - 1]?.role === 'assistant') kept.pop(); return; }
        kept.push({ role: t.role, text: t.text });
      });
      const gap = String(resume.gap || '').trim();
      const ask = /\?$/.test(gap) ? gap : translate('One thing is still missing — {{gap}}. Can you tell me more?', { gap: gap.replace(/\.$/, '') });
      // with no chat on file, the note opens the conversation the model reads
      if (!kept.length && resume.text) kept.push({ role: 'user', text: resume.text });
      cap.current = {
        ...cap.current,
        kind: resume.kind || 'note',
        text: resume.text || '',
        attachments: resume.attachments || [],
        turns: [...kept, { role: 'assistant', text: ask }],
        askedQuestion: ask,
      };
      const d = say(ask);
      after(d, () => setStep('clarify'));
      return;
    }
    // a landing visit: the question is there as the box opens, with no dots first
    if (liveIntro) {
      // StrictMode runs this twice in dev: the line is pushed once
      if (!resumed.current) {
        resumed.current = true;
        push({ from: 'bauhly', text: landing?.own && landing?.ownAsk ? landing.ownAsk : translate('Tell me something recent from the studio. A project you\'re on, one you\'ve just finished, a decision you made, or something a client said.'), opener: true });
      }
      after(0, () => setStep('how'));
      return;
    }
    // `opening` aims the capture at one question (Editor › Add slide)
    const d = say(opening || (preset
      ? translate('Anything from {{name}}? Something that happened, an idea, something you noticed, or anything else that feels relevant.', { name: preset.name })
      : 'Tell me something recent from the studio. A project you\'re on, one you\'ve just finished, a decision you made, or something a client said.'));
    after(d, () => setStep('how'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'boot') { setOptionsReady(false); return; }
    setOptionsReady(false);
    const t = setTimeout(() => setOptionsReady(true), 540);
    return () => clearTimeout(t);
  }, [step]);

  const userSays = (text) => push({ from: 'user', text });

  const attachmentPayload = () =>
    (cap.current.attachments || []).map((a) => ({ type: a.type, key: a.key }));

  const runUnderstand = async ({ extraTurn } = {}) => {
    const turns = [...(cap.current.turns || [])];
    if (extraTurn?.text) turns.push(extraTurn);
    cap.current.turns = turns;
    try {
      return await understandCapture({
        text: cap.current.text,
        attachments: attachmentPayload(),
        projectName: preset?.name || '',
        turns,
      });
    } catch (err) {
      console.warn('[capture] understand failed', err);
      return { action: 'ready', question: null, understanding: null, captures: [] };
    }
  };

  /* A capture aimed at something that already has a project (Editor › Add
   * slide: the parent post's) is filed there — never "Which project is this
   * for?". By id when known, else by name (made if the studio has none of that
   * name yet), else the default project. Returns true when it filed. */
  const fileWithoutAsking = () => {
    if (resume) { finish(resume.projectId); return true; }
    if (preset) { finish(preset.id); return true; }
    if (askProject) return false;
    const want = String(projectName || '').trim().toLowerCase();
    const named = want ? projects.find((p) => String(p.name || '').trim().toLowerCase() === want) : null;
    if (named) finish(named.id);
    else if (want) finish(null, projectName.trim());
    else if (defaultProjectId) finish(defaultProjectId);
    else finish(null, 'Content ideas');
    return true;
  };

  const continueToFile = (result) => {
    if (resume) return fileWithoutAsking();
    const choice = String(result?.understanding?.visualAssetChoice || '').toLowerCase();
    if (askMedia && !cap.current.attachments.length && choice !== 'generate' && choice !== 'none') {
      const d = say('Do you have a photo or clip of this, or would you rather generate visuals later?');
      after(d, () => setStep('media'));
      return false;
    }
    if (fileWithoutAsking()) return true;
    const d = say('Which project is this for?');
    after(d, () => setStep('project'));
    return false;
  };

  const afterUnderstood = (result) => {
    if (result?.understanding) cap.current.understanding = result.understanding;
    if (Array.isArray(result?.captures) && result.captures.length) {
      cap.current.understandings = result.captures;
      cap.current.understanding = result.captures[0];
    }
    if (result?.conversationSummary) cap.current.conversationSummary = result.conversationSummary;
    if (result?.conversationTitle) cap.current.conversationTitle = result.conversationTitle;
    // an aimed capture (Editor › Add slide) caps its follow-ups: the post's
    // strategy already holds the context, so the studio is not interviewed
    const asked = (cap.current.turns || []).filter((t) => t?.role === 'assistant').length;
    const followUp = asked >= maxQuestions ? '' : (clarificationQuestion(result, cap.current.turns)
      || transcriptGapQuestion(cap.current.text, cap.current.askedQuestion));
    // a new capture keeps its question for Generate plan rather than asking now
    if (followUp && deferQuestions && !planning.current) {
      cap.current.held = [followUp];
      return continueToFile(result);
    }
    if (!followUp && planning.current) {
      planAnswered();
      return true;
    }
    if (followUp) {
      cap.current.askedQuestion = followUp;
      cap.current.turns = [...(cap.current.turns || []), { role: 'assistant', text: followUp }];
      cap.current.awaitingAssets = false;
      setStep('clarify');
      say(followUp);
      return false;
    }
    return continueToFile(result);
  };

  const chooseWrite = () => {
    setStep('boot');
    userSays('Write it down');
    cap.current.kind = 'note';
    setStep('writing');
  };
  const chooseRecord = () => {
    setStep('boot');
    userSays('Record a voice note');
    cap.current.kind = 'note';
    fromVoice.current = true;
    recordingReturn.current = 'writing';
    autoDraft.current = '';
    setPolishing(false);
    say(modal ? "I'm listening — take your time. Press Pause to add file if there is something to show." : "I'm listening — take your time.");
    rec.reset();
    rec.start();
    setStep('recording');
  };
  const recordClarify = () => {
    setStep('boot');
    userSays(fromVoice.current ? 'Record it again' : 'Record a voice note');
    fromVoice.current = true;
    recordingReturn.current = 'clarify';
    autoDraft.current = '';
    setPolishing(false);
    say(modal ? "I'm listening — take your time. Press Pause to add file if there is something to show." : "I'm listening — take your time.");
    rec.reset();
    rec.start();
    setStep('recording');
  };
  const recordAgain = () => {
    setDraft('');
    autoDraft.current = '';
    setPolishing(false);
    setStep('boot');
    userSays('Record it again');
    say("Go on then — I'm listening.");
    rec.reset();
    rec.start();
    setStep('recording');
  };

  const submitWriting = async () => {
    const text = draft.trim();
    if (!text) return;
    fromVoice.current = false;
    setDraft('');
    setStep('boot');
    userSays(text);
    cap.current.text = text;
    cap.current.turns = [{ role: 'user', text }];
    setBusy(true);
    try {
      const finishing = afterUnderstood(await runUnderstand());
      if (!finishing) setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  const submitClarify = async () => {
    const text = draft.trim();
    if (!text) return;
    fromVoice.current = false;
    setDraft('');
    setStep('boot');
    userSays(text);
    cap.current.askedAnswer = text;
    cap.current.text = [cap.current.text, text].filter(Boolean).join('\n\n');
    setBusy(true);
    try {
      const finishing = afterUnderstood(await runUnderstand({ extraTurn: { role: 'user', text } }));
      if (!finishing) setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  const skipClarify = async () => {
    fromVoice.current = false;
    setDraft('');
    setStep('boot');
    userSays('Skip this question');
    // Generate plan: the question stays open on the capture and Bauhly guesses
    if (planning.current) {
      handOff();
      return;
    }
    // a Generate-plan run: the capture stays as it was, on to the next question
    if (resume && run) {
      run.onNext();
      return;
    }
    // picking a capture back up and skipping again: nothing new to keep
    if (resume) {
      const d = say('No problem — it stays as it was.');
      after(d + 700, () => onExit?.());
      return;
    }
    setBusy(true);
    try {
      const finishing = afterUnderstood(await runUnderstand({
        extraTurn: { role: 'user', text: 'Skip this question. Leave it unknown. Ask another only if a non-obvious gap remains and fewer than 4 questions have been asked; otherwise return ready.' },
      }));
      if (!finishing) setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (rec.status === 'done' && step === 'recording') {
      const blob = rec.blob;
      const live = (rec.getLiveText?.() || rec.liveText || '').trim();
      autoDraft.current = live;
      if (live) {
        setDraft(live);
        setPolishing(true);
        setStep('boot');
        const d = say(hasTranscriptGap(live)
          ? 'I missed a word in there — fill it in if you can, then send.'
          : 'Check I got this right:');
        after(d, () => setStep(recordingReturn.current || 'writing'));
      }
      (async () => {
        if (!live) setBusy(true);
        try {
          let text = live;
          if (blob) {
            try {
              const result = await transcribeCapture(blob, {
                hint: live,
                keywords: projects.map((p) => p.name).filter(Boolean),
                languages: captureSttLanguages(rec.speechLang),
              });
              text = result.text || live;
            } catch {
              text = live;
            }
          }
          if (text) {
            refreshDraftIfUnedited(setDraft, autoDraft, text);
            if (!live) {
              setStep('boot');
              const d = say(hasTranscriptGap(text)
                ? 'I missed a word in there — fill it in if you can, then send.'
                : 'Check I got this right:');
              after(d, () => setStep(recordingReturn.current || 'writing'));
            }
          } else if (!live) {
            setDraft('');
            const d = blob
              ? say("I couldn't quite catch that — write it in, or record again.")
              : say("Write in what you said — I keep the words, not the audio.");
            after(d, () => setStep(recordingReturn.current || 'writing'));
          }
        } finally {
          setPolishing(false);
          setBusy(false);
        }
      })();
    }
    if (rec.status === 'denied' && step === 'recording') {
      setStep('boot');
      cap.current.kind = 'note';
      const back = recordingReturn.current || 'writing';
      const d = say("I can't reach the microphone — let's write it instead.");
      after(d, () => setStep(back));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.status, rec.blob]);

  const resolveAssetTurn = async (spoken) => {
    cap.current.awaitingAssets = false;
    setBusy(true);
    try {
      const finishing = afterUnderstood(await runUnderstand({ extraTurn: { role: 'user', text: spoken } }));
      if (!finishing) setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  /* files added ALONGSIDE a written/recorded note — uploaded to S3, then shown */
  const addFiles = async (files) => {
    const arr = [...files];
    if (!arr.length) return;
    setStep('boot');
    setBusy(true);
    try {
      const added = await uploadFiles(arr);
      cap.current.attachments = [...cap.current.attachments, ...added];
      cap.current.kind = added.some((a) => a.type === 'video') ? 'video' : (cap.current.kind || 'photo');
      push({ from: 'user', media: added });
      if (cap.current.awaitingAssets) {
        await resolveAssetTurn('I uploaded photos of this.');
        return;
      }
      // the upload answers "Do you have a photo…?" — file the capture now,
      // without an extra "Anything else, or save it?" stop
      setBusy(false);
      proceed('provided', { quiet: true });
    } catch {
      const d = say("That upload didn't go through — want to try again?");
      after(d, () => setStep('media'));
      setBusy(false);
    }
  };

  /* a file (or files) IS the capture — upload, then understand. Ask what it's
   * about only if the photos themselves aren't enough to preserve meaning. */
  const fromFiles = async (files, verb) => {
    const arr = [...files];
    if (!arr.length) return;
    setStep('boot');
    userSays(verb);
    setBusy(true);
    try {
      const added = await uploadFiles(arr);
      cap.current.kind = added.some((a) => a.type === 'video') ? 'video' : 'photo';
      cap.current.attachments = added;
      if (!cap.current.turns?.length) cap.current.turns = [{ role: 'user', text: verb || 'Uploaded a file' }];
      push({ from: 'user', media: added });
      const finishing = afterUnderstood(await runUnderstand());
      if (!finishing) setBusy(false);
    } catch {
      const d = say("That upload didn't go through — want to try again?");
      after(d, () => setStep('how'));
      setBusy(false);
    }
  };

  // `quiet`: reached from an upload, whose photo bubble already answered
  const proceed = (visualChoice = '', { quiet = false } = {}) => {
    setStep('boot');
    const spoken = cap.current.attachments.length
      ? 'That’s everything'
      : (visualChoice === 'generate' ? 'Generate visuals' : 'Nothing right now');
    if (!quiet) userSays(spoken);
    const choice = visualChoice || (cap.current.attachments.length ? 'provided' : 'none');
    const applyChoice = (u) => (u ? { ...u, visualAssetChoice: u.visualAssetChoice || choice } : u);
    cap.current.understanding = applyChoice(cap.current.understanding);
    cap.current.understandings = (cap.current.understandings || []).map(applyChoice);
    if (cap.current.awaitingAssets) {
      resolveAssetTurn(spoken);
      return;
    }
    if (fileWithoutAsking()) return;
    const d = say('Which project is this for?');
    after(d, () => setStep('project'));
  };

  const chooseProject = (p) => { setStep('boot'); userSays(p.name); finish(p.id); };
  const createFromModal = (name) => {
    setCreating(false);
    setStep('boot');
    userSays(name);
    finish(null, name);
  };

  /* file the conversation as one library session. `addSession`/`createProject`
   * update the store, so the saved card and the rest of the app see it straight away. */
  const finish = async (projectId, createName) => {
    const c = cap.current;
    const type = c.kind;
    const text = c.text || '';
    setBusy(true);
    try {
      let pid = projectId;
      let name = createName;
      if (createName) pid = await createProject(createName);
      else name = projects.find((p) => p.id === pid)?.name;
      const rows = (c.understandings && c.understandings.length)
        ? c.understandings
        : [c.understanding];
      if (resume) {
        await resumeSession(resume.projectId, resume.captureId, {
          text,
          attachments: c.attachments,
          understanding: c.understanding,
          understandings: rows,
          conversationSummary: c.conversationSummary,
          conversationTitle: c.conversationTitle,
          conversationTurns: c.turns,
        });
        const d = say('Added to your capture — the next plan is written from it.');
        after(d + 900, () => (run ? run.onNext() : onExit?.()));
        return;
      }
      const made = await addSession(pid, {
        type,
        text,
        attachments: c.attachments,
        understanding: c.understanding,
        understandings: rows,
        conversationSummary: c.conversationSummary,
        conversationTitle: c.conversationTitle,
        conversationTurns: c.turns,
        sessionKind: 'capture',
        clarifyQuestions: deferQuestions ? c.held : undefined,
      });
      const cover = previewUrl(c.attachments.find((a) => a.type === 'image') || c.attachments[0]) || null;
      setSaved({ id: pid, name, captureId: made?.captureId || null, at: new Date().toISOString() });
      if (visitorFiling.current) return true;
      if (deferQuestions) {
        /* a visitor has no plan yet: what is next for them is the post they were told about */
        const d = say(liveIntro ? 'Saved. Ready to become your first post.' : 'Saved. It is ready for your next plan.');
        after(d, () => setStep('done'));
      } else if (onCaptured) {
        const d = say(savedLine || "It's in your library — building your plan now.");
        // what was captured travels with it, for a caller that uses it (Add slide)
        after(d + 700, () => onCaptured({
          projectId: pid,
          projectName: name,
          text,
          attachments: (c.attachments || []).map((a) => ({ key: a.key, type: a.type, url: a.url })),
          understanding: c.understanding,
          conversationSummary: c.conversationSummary,
          conversationTitle: c.conversationTitle,
          turns: c.turns,
        }));
      } else {
        const d = say([{ kind: 'saved', project: { name, cover } }, "It's in your library — the next plan is written from it."]);
        after(d, () => setStep('done'));
      }
    } catch (err) {
      console.error('[capture] saving failed', err?.response?.status, err?.response?.data || err);
      /* a refusal the server explains (a rate limit, a missing project) is said as it is;
         anything else stays the generic line */
      const why = err?.response?.status && err.response.status < 500 ? err.response.data?.message : '';
      const d = say(why ? { text: why } : 'Something went wrong saving that — try again in a moment?');
      after(d, () => setStep(visitorFiling.current ? 'vDone' : c.attachments.length ? 'media' : 'project'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /* the payload a caller (Add slide, plan generation) gets with the capture */
  const capturedPayload = () => {
    const c = cap.current;
    return {
      projectId: saved?.id,
      projectName: saved?.name,
      text: c.text || '',
      attachments: (c.attachments || []).map((a) => ({ key: a.key, type: a.type, url: a.url })),
      understanding: c.understanding,
      conversationSummary: c.conversationSummary,
      conversationTitle: c.conversationTitle,
      turns: c.turns,
    };
  };
  /* the questions are dealt with (or skipped): the plan is the caller's */
  const handOff = () => {
    planning.current = false;
    setNotice(false);
    setStep('boot');
    const d = say('Generating your plan…');
    after(d + 500, () => (onCaptured ? onCaptured(capturedPayload()) : onExit?.()));
  };
  /* `Generate plan` (deferQuestions): the question held back at filing is
     asked now, in this conversation; with none, the plan starts */
  const generatePlan = () => {
    setStep('boot');
    userSays('Generate plan');
    const ask = (cap.current.held || [])[0];
    if (!ask || !saved?.captureId) { handOff(); return; }
    planning.current = true;
    setReference({
      quote: saidIn(cap.current.turns, cap.current.text),
      shots: cap.current.attachments || [],
      when: refWhen(saved.at),
      project: saved.name || '',
    });
    cap.current.held = [];
    cap.current.askedQuestion = ask;
    cap.current.turns = [...(cap.current.turns || []), { role: 'assistant', text: ask }];
    try { if (localStorage.getItem('bauhly.planNotice.off') !== '1') setNotice(true); } catch { setNotice(true); }
    const d = say(ask);
    after(d, () => setStep('clarify'));
  };
  /* the answer is in: written over the capture it was asked about (which also
     clears its open question), then the plan */
  const planAnswered = async () => {
    const c = cap.current;
    setBusy(true);
    try {
      await resumeSession(saved.id, saved.captureId, {
        text: c.text || '',
        attachments: c.attachments,
        understanding: c.understanding,
        understandings: (c.understandings && c.understandings.length) ? c.understandings : [c.understanding],
        conversationSummary: c.conversationSummary,
        conversationTitle: c.conversationTitle,
        conversationTurns: c.turns,
      });
    } catch (err) {
      console.warn('[capture] saving the answer failed', err);
    } finally {
      setBusy(false);
    }
    handOff();
  };

  /* Captures › Add: the files (and any words) go onto the capture they were
     added to. Words join the note; with none, the note and its open
     questions are left as they were. */
  const saveAdding = async (said, extra = []) => {
    const text = String(said || '').trim();
    const files = [...cap.current.attachments, ...extra];
    const owner = (projects.find((p) => p.id === adding.projectId)?.captures || []).find((c) => c.id === adding.captureId);
    const was = String(owner?.text || '').trim();
    const joined = !text ? was : (!was || was === text ? text : `${was}\n\n${text}`);
    const stories = text && Array.isArray(owner?.stories) && owner.stories.length
      ? [{ ...owner.stories[0], summary: joined }]
      : undefined;
    await updateEntry(adding.projectId, adding.captureId, {
      attachments: [...(owner?.attachments || []), ...files],
      ...(text ? { text: joined, sessionSummary: joined } : {}),
      ...(stories ? { stories, understanding: stories[0] } : {}),
      // only when the chat was loaded — a partial list would overwrite it
      ...(text && Array.isArray(owner?.conversationTurns)
        ? { conversationTurns: [...owner.conversationTurns, { role: 'assistant', text: cap.current.askedQuestion }, { role: 'user', text }] }
        : {}),
    });
    cap.current.attachments = [];
  };
  // `next`: Generate plan (onPlan) or Save and close (onExit) — anything typed goes too
  const keepAdding = async (next) => {
    const text = draft.trim();
    setDraft('');
    setStep('boot');
    userSays(text || (next === onPlan ? 'Generate plan' : 'Save and close'));
    setBusy(true);
    try {
      const extra = pending.length ? await uploadFiles(pending.map((x) => x.file)) : [];
      setPending([]);
      await saveAdding([cap.current.text, text].filter(Boolean).join('\n\n'), extra);
      cap.current.text = '';
      setBusy(false);
      next?.();
    } catch {
      setBusy(false);
      const d = say('Something went wrong saving that — try again in a moment?');
      after(d, () => setStep('noting'));
    }
  };
  // what was said (and shown) this round goes onto the capture; the box stays
  // up and says so (bauhly-v3 `stay`)
  const commitAdding = async (extra = []) => {
    setBusy(true);
    try {
      await saveAdding(cap.current.text, extra);
      cap.current.text = '';
      setBusy(false);
      const d = say('Saved. It is on this capture now.');
      after(d, () => setStep('done'));
    } catch {
      setBusy(false);
      const d = say('Something went wrong saving that — try again in a moment?');
      after(d, () => setStep(cap.current.text ? 'amendMedia' : 'noting'));
    }
  };
  /* the composer at `noting` / `amendMedia`. With files already in hand (Add)
     the words are their note and it is filed; on the pencil the words come
     first and Bauhly asks "Anything to show for it?" before filing */
  const sendAdding = async () => {
    const text = draft.trim();
    const files = pending.map((x) => x.file);
    if (step === 'noting' && !text && !files.length) return;
    pending.forEach((x) => { try { URL.revokeObjectURL(x.url); } catch { /* ok */ } });
    setPending([]);
    setDraft('');
    const at = step;
    setStep('boot');
    let extra = [];
    if (files.length) {
      setBusy(true);
      try {
        extra = await uploadFiles(files);
      } catch {
        setBusy(false);
        const d = say("That upload didn't go through — want to try again?");
        after(d, () => setStep(at));
        return;
      }
      setBusy(false);
    }
    if (text || extra.length) push({ from: 'user', text: text || undefined, media: extra.length ? extra : undefined });
    if (text) cap.current.text = [cap.current.text, text].filter(Boolean).join('\n\n');
    if (at === 'noting' && !cap.current.attachments.length && !extra.length) {
      const d = say('Got it. Anything to show for it?');
      after(d, () => setStep('amendMedia'));
      return;
    }
    commitAdding(extra);
  };
  const amendPhotos = async (list) => {
    const files = [...(list || [])];
    if (!files.length) return;
    setStep('boot');
    setBusy(true);
    let extra;
    try {
      extra = await uploadFiles(files);
    } catch {
      setBusy(false);
      const d = say("That upload didn't go through — want to try again?");
      after(d, () => setStep('amendMedia'));
      return;
    }
    push({ from: 'user', media: extra });
    commitAdding(extra);
  };
  const amendNothing = () => {
    setStep('boot');
    userSays('Nothing right now');
    commitAdding();
  };
  const addAnother = () => {
    setStep('boot');
    cap.current.text = '';
    cap.current.attachments = [];
    cap.current.askedQuestion = translate('What else would you like to add?');
    const d = say('What else would you like to add?');
    after(d, () => setStep('noting'));
  };

  const restart = () => {
    cap.current = { kind: null, text: '', attachments: [], understanding: null, understandings: [], conversationSummary: '', conversationTitle: '', askedQuestion: '', askedAnswer: '', turns: [], awaitingAssets: false };
    setSaved(null);
    setStep('boot');
    const d = say('What else have you got?');
    after(d, () => setStep('how'));
  };

  /* ══ THE LANDING VISIT'S OWN PARTS (bauhly-v3 CaptureChat, Nov 5–6) ═════ */
  /* what was typed into the hero's field before this box was there to take it:
     `{ text, n }`, counted so one arrival is added once (dev runs effects twice) */
  const took = useRef(0);
  useEffect(() => {
    const d = landing?.draft;
    if (!d?.text || d.n === took.current) return;
    took.current = d.n;
    setDraft((was) => `${was}${d.text}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landing?.draft?.n]);

  /* the examples of what to say keep typing in the field until the first letter */
  const [askDone, setAskDone] = useState(false);
  if (draft && !askDone) setAskDone(true);
  const askOn = Boolean(asks?.length) && (step === 'boot' || step === 'how') && !askDone;
  const [askTyped, askFading] = useTypedPlaceholder(asks?.length ? asks : NO_ASKS, askOn && step === 'how');

  /* ── SEE AN EXAMPLE: a demonstration typed into the real field, word by word.
     Sent as it played it goes through a scripted conversation and is never
     filed; the moment its words are changed they are the visitor's own. */
  const [demo, setDemo] = useState(false);
  const [exLive, setExLive] = useState(false);
  const [exWait, setExWait] = useState(false);
  const [exText, setExText] = useState('');
  /* the example's progress: the index of the running stage, EX_STAGES.length once all are done, null when off */
  const [exView, setExView] = useState(null);
  /* the example's post as the visitor has it (edits kept by Done), the slide both views are on, and the
     editing view: null, 'in', or 'out' while it fades (bauhly-v3 exEdit / exSlide, decision 677) */
  const [exPost, setExPost] = useState(null);
  const [exSlide, setExSlide] = useState(0);
  const [exEdit, setExEdit] = useState(null);
  const exEditTimer = useRef(0);
  useEffect(() => () => clearTimeout(exEditTimer.current), []);
  /* the box is a few px wider than it shows (its scroll-jump button), so a focus or a scroll into view can
     move it sideways under the editing view: it never scrolls sideways while the example is being edited */
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !exEdit) return undefined;
    const flat = () => { if (box.scrollLeft) box.scrollLeft = 0; };
    flat();
    box.addEventListener('scroll', flat);
    return () => { box.removeEventListener('scroll', flat); flat(); };
  }, [exEdit]);
  const leaveEdit = () => {
    setExEdit('out');
    clearTimeout(exEditTimer.current);
    exEditTimer.current = setTimeout(() => {
      setExEdit((now) => (now === 'out' ? null : now));
      /* back on the conversation, with the post in view */
      boxRef.current?.querySelector('.exp')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      if (boxRef.current) boxRef.current.scrollLeft = 0;
    }, 200);
  };
  const exTimer = useRef(0);
  useEffect(() => () => clearTimeout(exTimer.current), []);
  const isDemo = () => Boolean(exText) && (cap.current.text || draft || '').trim() === exText.trim();
  const exPlay = () => {
    if (!example) return;
    example.photos.forEach((url) => { const im = new Image(); im.src = url; });
    setExWait(true);
    exTimer.current = setTimeout(() => {
      setExWait(false);
      if (!isCaptureOpen()) return;
      const { text } = example;
      setExText(text);
      setDemo(true);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDraft(text); return; }
      const words = text.split(' ');
      let at = 0;
      setExLive(true);
      const land = () => {
        if (!isCaptureOpen()) { setExLive(false); return; }
        at += 1;
        setDraft(words.slice(0, at).join(' '));
        if (at >= words.length) { exTimer.current = setTimeout(() => setExLive(false), 300); return; }
        const said = words[at - 1];
        const breath = said.endsWith('.') ? 180 : said.endsWith(',') ? 90 : 0;
        exTimer.current = setTimeout(land, 70 + words[at].length * 11 + breath);
      };
      exTimer.current = setTimeout(land, 120);
    }, LANDING_THINK_MS);
  };
  /* the example's send: nothing is uploaded, understood or filed */
  const demoSend = () => {
    const text = draft.trim();
    setDraft('');
    setStep('boot');
    userSays(text);
    cap.current.text = text;
    const d = say(LANDING_PHOTO_ASK);
    after(d, () => setStep('exMedia'));
  };
  const addExamplePhotos = () => {
    setStep('boot');
    think(() => {
      const added = example.photos.map((url, i) => ({ id: `example-${i}`, type: 'image', url }));
      cap.current.attachments = added;
      push({ from: 'user', media: added, staged: true });
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      after(still ? 0 : (added.length - 1) * 220 + 360, () => {
        setSaved({ id: null, name: null, demo: true });
        /* a small thank-you for doing it, and that it was an example (bauhly-v3, decisions 680, 682) */
        const d = say('Nice, you’ve just completed your first capture! This one was only an example.');
        after(d, () => setStep('done'));
      });
    });
  };
  /* ══ AND THE EXAMPLE'S POST IS THE NEXT THING BAUHLY SAYS (bauhly-v3, Nov 6–9; decisions 675, 733) ══
     The progress stands in the thread, then gives way to a line saying it is ready; Bauhly introduces
     it and the post arrives under that, in this thread. It is only shown: nothing is filed. */
  const showExamplePost = () => {
    setStep('boot');
    setExView(0);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gap = still ? 300 : EX_STAGE_MS;
    const tick = (i) => {
      exTimer.current = setTimeout(() => {
        if (!isCaptureOpen()) return;
        if (i < EX_STAGES.length) { setExView(i); tick(i + 1); return; }
        /* every stage ticked, held a moment, then Bauhly's next words */
        setExView(EX_STAGES.length);
        exTimer.current = setTimeout(() => {
          setExView(null);
          if (!isCaptureOpen()) return;
          setExPost(example.post || null);
          setExSlide(0);
          push({ from: 'bauhly', text: example.readySay || 'Your example is ready.', ready: true });
          const d = say({ text: example.revealSay || 'Here’s what I created from your example.', exPost: true });
          after(d, () => setStep('exShown'));
        }, still ? 0 : 700);
      }, gap);
    };
    tick(1);
  };
  /* ── THE ACCOUNT STEP: asked at the visitor's first real send (or press of
     the mic, which would reach the transcriber), and only once. Their words and
     photos stay where they were, and logging in sends them from here. */
  const [login, setLogin] = useState(null); // null | 'send' | 'record'
  const sendNow = useRef(null);
  const recordNow = useRef(null);
  const loggedIn = () => {
    const then = login;
    onLoggedIn?.();
    if (then === 'generate') { setLogin(null); visitorGenerate(); return; }
    ensureProjects({ lite: true }).catch(() => {}).finally(() => {
      setLogin(null);
      setTimeout(() => (then === 'record' ? recordNow.current : sendNow.current)?.(), 0);
    });
  };

  /* ══ A VISITOR'S CAPTURE, WITH NO ACCOUNT UNTIL `GENERATE` (bauhly-v3 Flow B, Nov 6–10) ═════════════
     The project in their words, its photos, their Instagram (or `No, for now`), then three questions about
     the studio, which must be answered — all of it held here, in this conversation, and nothing filed. The
     Instagram is read at once, in the background, while they answer (backend services/visitorInstagram.js).
     The account is asked for at `Generate your first post`; once it exists the read and the answers become
     its profile and Business memory, the photos are uploaded, the capture is filed, and the post is made. */
  const visitorFiling = useRef(false);
  const igToken = useRef(null);
  const igHandleRef = useRef(null);
  const qAnswers = useRef({});
  const heldFiles = useRef([]);
  const [qAt, setQAt] = useState(null);
  const [qPicked, setQPicked] = useState([]);
  const [qOther, setQOther] = useState(false);
  const [vGen, setVGen] = useState(null);
  const [vStages, setVStages] = useState(VISITOR_STAGES);
  /* the box can be closed while the post is made: the run goes on (the calendar picks it up), this card stops */
  const vAlive = useRef(true);
  useEffect(() => { vAlive.current = true; return () => { vAlive.current = false; }; }, []);
  const vStep = ['vMedia', 'ig', 'ask', 'vDone'].includes(step);

  const visitorSend = (text) => {
    if (step === 'ig') { submitIg(text); return; }
    if (step === 'ask') { answerQ(text); return; }
    if (!text) return;
    setDraft('');
    userSays(text);
    cap.current.text = [cap.current.text, text].filter(Boolean).join('\n\n');
    cap.current.turns = [...(cap.current.turns || []), { role: 'user', text }];
    if (step === 'how') {
      cap.current.kind = 'note';
      setStep('boot');
      const d = say(LANDING_PHOTO_ASK);
      after(d, () => setStep('vMedia'));
    }
  };
  const visitorPhotos = (files) => {
    const arr = [...(files || [])].filter((f) => /^(image|video)\//.test(f.type));
    if (!arr.length) return;
    const held = arr.map((file, i) => ({ id: `held-${Date.now()}-${i}`, type: file.type.startsWith('video') ? 'video' : 'image', url: URL.createObjectURL(file), file }));
    heldFiles.current = [...heldFiles.current, ...held];
    cap.current.kind = held.some((a) => a.type === 'video') ? 'video' : 'photo';
    setStep('boot');
    push({ from: 'user', media: held, staged: true });
    askInstagram();
  };
  const askInstagram = () => {
    setStep('boot');
    const d = say({ text: IG_ASK.say, note: IG_ASK.note });
    after(d, () => setStep('ig'));
  };
  const submitIg = (typed) => {
    const text = String(typed || '').trim();
    if (!text) return;
    if (saysNo(text)) { setDraft(''); igSkip(); return; }
    const handle = instagramHandle(text);
    setStep('boot');
    if (!handle) {
      const d = say(IG_ASK.invalid);
      after(d, () => setStep('ig'));
      return;
    }
    setDraft('');
    igHandleRef.current = handle;
    igToken.current = null;
    /* the profile they gave as a card (bauhly-v3 `.ck-ig`, decision 690): Instagram's mark, the handle, the link */
    push({ from: 'user', ig: handle, tag: 'ig' });
    /* the read starts now and runs on its own; nothing here waits for it. It stands in for the studio
       questions, so with a handle none are asked (only "No, for now" asks them) */
    startVisitorRead(handle).then((r) => { if (igHandleRef.current === handle) igToken.current = r?.token || null; }).catch((err) => {
      console.warn('[capture] instagram read could not start', err?.response?.status || err);
    });
    const d = say({ text: IG_ASK.held(handle), tag: 'ig' });
    after(d, () => setStep('vDone'));
  };
  /* `Change account`: the question again with their address in the field, selected, so typing replaces it
     (bauhly-v3 igChange). What was said about the old one goes with it */
  const igChange = () => {
    const was = igHandleRef.current;
    igHandleRef.current = null;
    igToken.current = null;
    drop((m) => m.tag === 'ig');
    setDraft(was ? `instagram.com/${was}` : '');
    setStep('ig');
    requestAnimationFrame(() => {
      const field = boxRef.current?.querySelector('.capc__field textarea, .capc__field input, .capc textarea, .capc input');
      field?.focus({ preventScroll: true });
      field?.select?.();
    });
  };
  /* `Remove`: the same as never having given it, so the same as saying no — the questions are asked */
  const igTakeBack = () => {
    igHandleRef.current = null;
    igToken.current = null;
    drop((m) => m.tag === 'ig');
    igSkip();
  };
  const igSkip = () => {
    setStep('boot');
    userSays(IG_ASK.skip.title);
    askNext(IG_ASK.skipped);
  };
  const askNext = (lead = null) => {
    const q = nextQuestion(qAnswers.current);
    setStep('boot');
    if (!q) {
      const d = say('That’s everything I need. Ready to become your first post.');
      after(d, () => setStep('vDone'));
      return;
    }
    setQPicked([]);
    setQOther(false);
    const d = say([...(lead ? [lead] : []), { text: q.ask, note: q.hint }]);
    after(d, () => { setQAt(q.id); setStep('ask'); });
  };
  const togglePick = (q, id) => {
    if (id === 'other') {
      const on = !qOther;
      setQOther(on);
      if (on && q.otherAlone) setQPicked([]);
      if (on) boxRef.current?.querySelector('.capc__field, .capc textarea, .capc input')?.focus({ preventScroll: true });
      return;
    }
    if (qOther && q.otherAlone) { setQOther(false); setQPicked([id]); return; }
    setQPicked((list) => {
      if (list.includes(id)) return list.filter((x) => x !== id);
      return q.max && list.length + (qOther ? 1 : 0) >= q.max ? list : [...list, id];
    });
  };
  const answerQ = (typed = draft) => {
    const q = questionById(qAt);
    const other = String(typed || '').trim();
    if (!q || (!qPicked.length && !other) || (qOther && !other)) return;
    const picked = q.max && other ? qPicked.slice(0, q.max - 1) : qPicked;
    qAnswers.current[q.id] = { picked, other };
    setDraft('');
    userSays(answerSay(q, picked, other));
    askNext();
  };
  /* what Business memory is given: the options' own words, and theirs */
  const answersPayload = () => Object.fromEntries(Object.entries(qAnswers.current).map(([id, a]) => {
    const q = questionById(id);
    return [id, { picked: a.picked.map((p) => q.options.find((o) => o.id === p)).filter(Boolean).map((o) => ({ title: o.title, line: o.line })), other: a.other || '' }];
  }));
  const visitorGenerate = async () => {
    setStep('boot');
    visitorFiling.current = true;
    const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const stages = VISITOR_STAGES.filter((st) => st.id !== 'studio' || igToken.current);
    setVStages(stages);
    let since = Date.now();
    const show = (id) => { setVGen(stages.findIndex((st) => st.id === id)); since = Date.now(); };
    /* the stage on screen held to its minimum, a tick, then the next one */
    const next = async (id, least = VISITOR_STAGE_MS) => {
      const left = least - (Date.now() - since);
      if (left > 0) await wait(left);
      setVGen(stages.findIndex((st) => st.id === id) - 0.5);
      await wait(VISITOR_TICK_MS);
      show(id);
    };
    show(stages[0].id);
    try {
      await claimVisitorRead({ token: igToken.current, answers: answersPayload() });
    } catch (err) {
      console.warn('[capture] visitor claim failed', err?.response?.status || err);
    }
    if (stages[0].id === 'studio') await next('reading');
    try {
      const files = heldFiles.current.map((h) => h.file);
      if (files.length) {
        const added = await uploadFiles(files);
        cap.current.attachments = added;
      }
      const r = await runUnderstand();
      if (r?.understanding) cap.current.understanding = r.understanding;
      if (Array.isArray(r?.captures) && r.captures.length) { cap.current.understandings = r.captures; cap.current.understanding = r.captures[0]; }
      if (r?.conversationSummary) cap.current.conversationSummary = r.conversationSummary;
      if (r?.conversationTitle) cap.current.conversationTitle = r.conversationTitle;
      const followUp = clarificationQuestion(r, cap.current.turns);
      if (followUp) cap.current.held = [followUp];
      const choice = cap.current.attachments.length ? 'provided' : 'none';
      if (cap.current.understanding) cap.current.understanding = { ...cap.current.understanding, visualAssetChoice: cap.current.understanding.visualAssetChoice || choice };
    } catch (err) {
      console.warn('[capture] visitor upload or understand failed', err);
    }
    /* the account's own list, now that its profile is set: a returning studio's `No project` is used, not doubled */
    await refreshProjects().catch(() => null);
    const list = projectsSnapshot();
    const want = String(projectName || 'No project').trim().toLowerCase();
    const home = (Array.isArray(list) ? list : []).find((p) => String(p.name || '').trim().toLowerCase() === want);
    const ok = await finish(home ? home.id : null, home ? undefined : (projectName || 'No project'));
    if (!ok) {
      setVGen(null);
      visitorFiling.current = false;
      return;
    }
    heldFiles.current.forEach((h) => { try { URL.revokeObjectURL(h.url); } catch { /* ok */ } });

    /* ── THE POST IS MADE HERE, NOT ON THE CALENDAR (bauhly-v3 decision 743) ── the box stays open with its
       progress while the plan run makes the post; the run lives in the planGeneration store, so closing the
       box does not stop it. Its own stages move this card on. */
    await next('structuring');
    /* they made their account in this box: the post opens in the Editor, even if they close the box first */
    openNextInEditor();
    startPlanGeneration('capture', { label: cap.current?.text }).catch(() => {});
    let designing = false;
    while (getPlanGeneration().status === 'generating' && vAlive.current) {
      const g = getPlanGeneration();
      const reported = g.phase === 'writing' || g.phase === 'finalizing';
      if (!designing && (reported || (!g.phase && Date.now() - since > VISITOR_UNREPORTED_DESIGN_MS))) {
        designing = true;
        await next('designing');
      }
      await wait(500);
    }
    if (!vAlive.current) return;
    const made = getPlanGeneration().status === 'ready';
    if (made) {
      if (!designing) await next('designing');
      await next('preview');
      await wait(VISITOR_PREVIEW_MS);
      setVGen(stages.length);
      await wait(VISITOR_OPEN_HOLD_MS);
    }
    visitorFiling.current = false;
    if (!vAlive.current) return;
    /* ready: the host opens it in the Editor. A failure, or the Strategist asking for more, is said where
       the calendar says it (YourPlans reads the store), so the box closes onto that */
    onCaptured?.({ ...capturedPayload(), generated: true });
  };

  /* ── THE BOX GROWS OUT OF WHAT WAS PRESSED, AND CLOSES BACK INTO IT ──────
     A clip of the box itself, from the field's rectangle and corner out to its
     own edges: nothing inside is scaled. Written before paint, on the way up
     and again on the way down (the field may have become the pill by then). */
  const boxRef = useRef(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const o = landing?.origin?.();
    if (!box || !o || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const b = box.getBoundingClientRect();
    const px = (n) => `${Math.max(0, Math.round(n))}px`;
    const clip = `inset(${px(o.top - b.top)} ${px(b.right - (o.left + o.width))} ${px(b.bottom - (o.top + o.height))} ${px(o.left - b.left)} round ${px(o.radius || 0)})`;
    const corner = getComputedStyle(box).borderTopLeftRadius;
    const frames = [{ clipPath: clip }, { clipPath: `inset(0 round ${corner})` }];
    const anim = box.animate(leaving ? frames.reverse() : frames, {
      duration: CAPTURE_MORPH_MS,
      delay: leaving ? CAPTURE_HOLD_MS : 0,
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
      fill: leaving ? 'both' : 'none',
    });
    return () => anim.cancel();
    // the origin is a stable function for the life of a visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  /* the caret goes into the field once the box has settled, for a real pointer only */
  useEffect(() => {
    if (!liveIntro) return undefined;
    const t = setTimeout(() => {
      if (!canTakeCaret() || boxRef.current?.contains(document.activeElement)) return;
      boxRef.current?.querySelector('.capc__field')?.focus({ preventScroll: true });
    }, CAPTURE_MORPH_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderActions = () => {
    switch (step) {
      case 'how':
        return (
          <>
            <button className="ck-chip" onClick={chooseWrite}><Icon name="edit" size={14} /> Write it down</button>
            <button className="ck-chip" onClick={chooseRecord}><Icon name="pulse" size={14} /> Record a voice note</button>
            <label className="ck-chip"><Icon name="image" size={14} /> Upload a file
              <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { fromFiles(e.target.files, 'Uploaded a file'); e.target.value = ''; }} />
            </label>
          </>
        );
      case 'recording':
        return null;
      case 'writing':
      case 'clarify':
      case 'noting': {
        const voiced = step === 'writing' && fromVoice.current;
        const send = step === 'clarify' ? submitClarify : submitWriting;
        const label = step === 'clarify' ? 'Answer' : 'That’s it';
        return (
          <div className="cvtype">
            <AutoTextarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={polishing && draft === autoDraft.current ? 'is-ai-polishing' : ''}
              minHeight={step === 'clarify' ? 64 : 92}
              autoFocus
              placeholder={step === 'clarify' ? 'Answer in your own words…' : 'Say it however it comes out…'}
              aria-label={step === 'clarify' ? 'Your answer' : 'Your note'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || step === 'clarify')) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {polishing && (
              <AiProcessing className="cvtype__polish" />
            )}
            <div className="cvtype__acts">
              <button
                className="ck-chip ck-chip--primary cvtype__send"
                disabled={!draft.trim() || (polishing && draft === autoDraft.current)}
                onClick={send}
              >
                <Icon name="arrow-up-right" size={14} /> {label}
              </button>
              {step === 'clarify' && (
                <>
                  <button className="ck-chip" onClick={recordClarify}>
                    <Icon name="pulse" size={14} /> {fromVoice.current ? 'Record it again' : 'Record a voice note'}
                  </button>
                  <button className="btn btn--quiet btn--sm" onClick={skipClarify}>Skip this question</button>
                </>
              )}
              {voiced && (
                <button className="btn btn--quiet btn--sm" onClick={recordAgain}>Record it again</button>
              )}
            </div>
          </div>
        );
      }
      case 'exMedia':
        return example ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={addExamplePhotos}>{example.photosSay}</button>
        ) : null;
      case 'media':
        return (
          <>
            <label className="ck-chip ck-chip--primary"><Icon name="image" size={14} /> Upload a photo
              <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            {!cap.current.attachments.length && (
              <button className="ck-chip" onClick={() => proceed('generate')}>
                <Icon name="sparkle" size={14} /> Generate visuals
              </button>
            )}
            <button
              className={`ck-chip ${cap.current.attachments.length ? 'ck-chip--primary' : 'ck-chip--ghost'}`}
              onClick={() => proceed(cap.current.attachments.length ? 'provided' : 'none')}
            >
              {cap.current.attachments.length ? 'Save it' : 'Nothing right now'}
            </button>
          </>
        );
      /* the studio's real projects, listed to file this capture into — newest
       * first, the same order the Projects page shows them, with a New project
       * card at the end for a moment that doesn't belong to any of them yet */
      case 'project':
        return (
          <div className="ck-cards">
            {projects.map((p) => {
              const cover = coverOf(p);
              const n = sessionCount(p);
              return (
                <button key={p.id} className="ck-card ck-card--project" onClick={() => chooseProject(p)}>
                  <span className="ck-card__cover">
                    {cover ? <img src={cover} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} /> : <span className="pjcard__art" aria-hidden="true" />}
                  </span>
                  <span className="ck-card__body">
                    <span className="ck-card__top"><b>{p.name}</b></span>
                    <span className="ck-card__line">{n} {n === 1 ? 'item' : 'items'} on file.</span>
                  </span>
                </button>
              );
            })}
            <button className="ck-card ck-card--new" onClick={() => setCreating(true)}>
              <span className="ck-card__cover ck-card__cover--new"><Icon name="plus" size={18} strokeWidth={2.5} /></span>
              <span className="ck-card__body">
                <span className="ck-card__top"><b>New project</b></span>
                <span className="ck-card__line">Start a new one for this.</span>
              </span>
            </button>
          </div>
        );
      /* ── a visitor's steps (Flow B) ── */
      case 'vMedia':
        return (
          <>
            <label className="btn btn--primary btn--sm">
              Add a photo
              <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { visitorPhotos(e.target.files); e.target.value = ''; }} />
            </label>
            <button type="button" className="btn btn--secondary btn--sm ck-exbtn ck-exbtn--quiet" onClick={() => { userSays('Nothing right now'); askInstagram(); }}>Nothing right now</button>
          </>
        );
      case 'ig':
        return (
          <button type="button" className="ck-igskip" onClick={igSkip}>
            <span className="ck-igskip__ico" aria-hidden="true"><Icon name="share" size={15} /></span>
            <span className="ck-igskip__txt"><b>{IG_ASK.skip.title}</b><span>{IG_ASK.skip.line}</span></span>
            <Icon name="chevron-right" size={15} />
          </button>
        );
      case 'ask': {
        const q = questionById(qAt);
        if (!q) return null;
        const ready = (qPicked.length > 0 || Boolean(draft.trim())) && !(qOther && !draft.trim());
        return (
          <div className="ck-qs">
            <div className="ck-qs__grid" role="group" aria-label={q.ask}>
              {q.options.map((o) => {
                const on = o.id === 'other' ? qOther : qPicked.includes(o.id);
                return (
                  <button type="button" key={o.id} className={`ck-qcard${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => togglePick(q, o.id)}>
                    <b>{o.title}</b>
                    <span>{o.line}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn btn--primary btn--sm ck-qs__go" disabled={!ready} onClick={() => answerQ()}>Continue</button>
          </div>
        );
      }
      case 'vDone':
        return (
          <button type="button" className="btn btn--primary btn--sm ck-exbtn" onClick={() => setLogin('generate')}>
            <Icon name="sparkle" size={14} /> Generate your first post
          </button>
        );
      /* under the example's post: their own is next */
      case 'exShown':
        if (!example) return null;
        return (
          <>
            {/* Try editing first and primary, their own post second (bauhly-v3, decision 737) */}
            {exPost && <button type="button" className="btn btn--primary btn--sm ck-exbtn" onClick={() => setExEdit('in')}>{example.editSay || 'Try editing'}</button>}
            <button type="button" className="btn btn--secondary btn--sm ck-exbtn ck-exbtn--quiet" onClick={() => onRestart?.()}>{example.ctaSay}</button>
          </>
        );
      case 'done':
        if (adding) {
          return (
            <>
              <button className="ck-chip ck-chip--primary" onClick={onExit}>Save and close</button>
              <button className="ck-chip" onClick={addAnother}>Add something else</button>
            </>
          );
        }
        /* an example was only shown, so there is nothing to plan from */
        if (saved?.demo) {
          if (!example) return null;
          return (
            <>
              <button type="button" className="btn btn--primary btn--sm" onClick={showExamplePost}>{example.postSay}</button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => onRestart?.()}>{example.ctaSay}</button>
            </>
          );
        }
        if (deferQuestions && liveIntro) {
          return (
            <>
              <button type="button" className="btn btn--primary" onClick={generatePlan}>Generate your first post</button>
              <button type="button" className="btn btn--secondary" onClick={onExit}>Save and close</button>
            </>
          );
        }
        if (deferQuestions) {
          return (
            <>
              <button className="ck-chip ck-chip--primary" onClick={generatePlan}><Icon name="sparkle" size={14} /> Generate plan</button>
              <button className="ck-chip" onClick={onExit}>Save and close</button>
            </>
          );
        }
        return (
          <>
            <button className="ck-chip ck-chip--primary" onClick={() => onViewProject?.(saved.id)}><Icon name="arrow-right" size={14} /> Open {saved.name}</button>
            <button className="ck-chip" onClick={restart}>Capture another</button>
            <button className="ck-chip ck-chip--ghost" onClick={onExit}>Done for now</button>
          </>
        );
      default:
        return null;
    }
  };

  const actions = renderActions();
  const thinking = !typing && !busy && Boolean(actions) && !optionsReady;

  // In the modal, the text/voice steps are driven by the anchored composer at
  // the foot (bauhly-v3), not by the inline chips/textarea — so those are
  // suppressed for those steps and the composer owns the input.
  const composerOwnsInput = modal && (['how', 'writing', 'clarify'].includes(step) || (adding && ['noting', 'amendMedia'].includes(step)));
  const composerLive = (composerOwnsInput || (needsLogin && vStep)) && optionsReady && !typing && !busy;
  const composerSendable = Boolean(draft.trim()) || pending.length > 0 || Boolean(adding && step === 'amendMedia');
  // Staged images ride along with the next message (ChatGPT-style): the + adds a
  // thumbnail to the composer instead of posting a "file" turn on its own.
  const composerFiles = (files) => {
    const arr = [...files].filter(Boolean);
    if (!arr.length) return;
    const staged = arr.map((file, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      url: URL.createObjectURL(file),
      type: (file.type || '').startsWith('video') ? 'video' : 'image',
    }));
    setPending((p) => [...p, ...staged]);
  };
  /* Add a photo WHILE talking (bauhly-v3 Capture, Oct 1): the press holds the
     take — nothing said to a file browser is recorded — and the take carries
     on by itself once a file is in, or once the dialog is dismissed (the
     browser reports a cancel as the window getting focus back, nothing else). */
  const pickingFile = useRef(false);
  const hearHold = () => {
    if (rec.status !== 'recording') return;
    rec.pause();
    pickingFile.current = true;
    const back = () => {
      window.removeEventListener('focus', back);
      window.setTimeout(() => {
        if (!pickingFile.current) return;
        pickingFile.current = false;
        rec.resume();
      }, 500);
    };
    window.addEventListener('focus', back);
  };
  const hearFiles = (files) => {
    pickingFile.current = false;
    composerFiles(files); // staged: shown in the live turn, sent with the words
    rec.resume();
  };
  const removePending = (id) => setPending((p) => {
    const gone = p.find((x) => x.id === id);
    if (gone) { try { URL.revokeObjectURL(gone.url); } catch { /* already revoked */ } }
    return p.filter((x) => x.id !== id);
  });
  const composerSend = async () => {
    const text = draft.trim();
    if (login) return;
    if (liveIntro && demo && isDemo() && step === 'how' && !pending.length) { demoSend(); return; }
    if (needsLogin) { visitorSend(text); return; }
    if (adding && ['noting', 'amendMedia'].includes(step)) { sendAdding(); return; }
    if (!text && !pending.length) return;
    // Text only — the existing conversational submits.
    if (!pending.length) {
      if (step === 'writing') { submitWriting(); return; }
      if (step === 'clarify') { submitClarify(); return; }
      cap.current.kind = 'note';
      submitWriting();
      return;
    }
    // Text + staged images sent as ONE turn, then understood together.
    const files = pending.map((p) => p.file);
    pending.forEach((p) => { try { URL.revokeObjectURL(p.url); } catch { /* ok */ } });
    setPending([]);
    fromVoice.current = false;
    setDraft('');
    setStep('boot');
    setBusy(true);
    try {
      const added = await uploadFiles(files);
      cap.current.attachments = [...(cap.current.attachments || []), ...added];
      cap.current.kind = added.some((a) => a.type === 'video')
        ? 'video'
        : (cap.current.kind || (text ? 'note' : 'photo'));
      push({ from: 'user', text: text || undefined, media: added });
      let extra;
      if (text && step === 'clarify') {
        cap.current.askedAnswer = text;
        cap.current.text = [cap.current.text, text].filter(Boolean).join('\n\n');
        cap.current.turns = [...(cap.current.turns || []), { role: 'user', text }];
        extra = { extraTurn: { role: 'user', text } };
      } else if (text) {
        cap.current.text = text;
        cap.current.turns = [{ role: 'user', text }];
      } else if (!cap.current.turns?.length) {
        cap.current.turns = [{ role: 'user', text: 'Uploaded a file' }];
      }
      const finishing = afterUnderstood(await runUnderstand(extra));
      if (!finishing) setBusy(false);
    } catch {
      const d = say("That upload didn't go through — want to try again?");
      after(d, () => setStep(step === 'clarify' ? 'clarify' : 'how'));
      setBusy(false);
    }
  };
  const composerRecord = () => {
    if (needsLogin) return;
    if (step === 'clarify') return recordClarify();
    if (step === 'writing' && fromVoice.current) return recordAgain();
    return chooseRecord();
  };

  const showActions = Boolean(actions) && optionsReady && !typing && !busy && !composerOwnsInput;
  sendNow.current = composerSend;
  recordNow.current = composerRecord;
  /* the editing view takes Escape itself (ExampleEditor) */
  escRef.current = leaving || exEdit ? null : login ? () => setLogin(null) : onExit;
  /* `See an example` sits under the first question, for an empty field */
  const exampleAsk = Boolean(example) && step === 'how' && !typing && !demo;

  return createPortal(
    <div
      className={`cap-overlay${modal ? ' cap-overlay--modal' : ''}${liveIntro ? ' cap-overlay--landing' : ''}${leaving ? ' is-out' : ''}`}
      /* the landing page scrolls with Lenis, which takes every wheel event
         unless the thing under the pointer says otherwise */
      data-lenis-prevent
    >
      {modal && <div className="cap-overlay__scrim" onClick={onExit} aria-hidden="true" />}
      <div className={`ck${login ? ' is-signing' : ''}${exEdit === 'in' ? ' is-editing' : ''}`} ref={boxRef}>
        {exEdit && exPost && (
          <ExampleEditor
            post={exPost}
            original={example?.post || exPost}
            at={exSlide}
            onAt={setExSlide}
            leaving={exEdit === 'out'}
            onCancel={leaveEdit}
            onDone={(edited) => { setExPost(edited); setExSlide((k) => Math.min(k, edited.slides.length - 1)); leaveEdit(); }}
          />
        )}
        {login && (
          <CaptureLogin
            start={login === 'generate' ? 'signup' : 'signin'}
            onBack={() => setLogin(null)}
            onDone={loggedIn}
          />
        )}
        {modal ? (
          <>
            <div className="ck__intro ck__intro--row">
              <span className={`ck__intro-mark ${typing || busy || step === 'recording' ? 'is-live' : ''}`}><Mark size={36} /></span>
              <h2 className="ck__title">Capture</h2>
            </div>
            <button type="button" className="ck__x" onClick={onExit} aria-label="Close capture">
              <Icon name="x" size={20} strokeWidth={2} />
            </button>
            {notice && (
              <div className="ck__notice" role="status">
                <span className="ck__notice__mark" aria-hidden="true"><Icon name="info" size={16} strokeWidth={2.2} /></span>
                <p className="ck__notice__say">
                  {(run?.left || 1) === 1
                    ? 'Bauhly is unsure about 1 thing. Answer it and your post comes out right. Skip and Bauhly has to guess.'
                    : `Bauhly is unsure about ${run.left} things. Answer them and your posts come out right. Skip and Bauhly has to guess.`}
                  {' '}
                  <button
                    type="button"
                    className="ck__notice__never"
                    onClick={() => { hideNotice(); try { localStorage.setItem('bauhly.planNotice.off', '1'); } catch { /* this visit only */ } }}
                  >
                    Don&rsquo;t show again
                  </button>
                </p>
                <button type="button" className="ck__notice__x" onClick={hideNotice} aria-label="Hide this">
                  <Icon name="x" size={15} strokeWidth={2.2} />
                </button>
              </div>
            )}
          </>
        ) : (
          <button className="btn btn--quiet btn--sm ck__keep" onClick={onExit}>
            <Icon name="arrow-left" size={15} />
            {preset ? `Back to ${preset.name}` : exitLabel}
          </button>
        )}

        <div className="ck__thread" aria-live="polite" ref={threadRef}>
          {!modal && (
            <div className="ck__intro">
              <span className="ck__intro-mark"><Mark size={30} /></span>
              <span className="eyebrow">Capture</span>
            </div>
          )}

          {messages.map((m) => {
            if (m.from === 'user' && m.ig) {
              return (
                <div className="ck-turn ck-turn--user" key={m.id}>
                  <div className="ck-ig">
                    <span className="ck-ig__avatar" aria-hidden="true"><Icon name="instagram" size={22} strokeWidth={1.8} /></span>
                    <span className="ck-ig__who">
                      <b className="ck-ig__handle">@{m.ig}</b>
                      <a className="ck-ig__link" href={`https://instagram.com/${m.ig}`} target="_blank" rel="noopener noreferrer">
                        <span>instagram.com/{m.ig}</span>
                        <Icon name="arrow-up-right" size={13} strokeWidth={2} />
                        <span className="sr-only"> (opens Instagram)</span>
                      </a>
                    </span>
                    {step === 'vDone' && !login && (
                      <span className="ck-ig__acts">
                        <button type="button" className="btn btn--secondary btn--sm" onClick={igChange}>Change account</button>
                        <button type="button" className="btn btn--quiet btn--sm" onClick={igTakeBack}>
                          <Icon name="trash" size={14} strokeWidth={2} />
                          Remove
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              );
            }
            if (m.from === 'user') {
              return (
                <div className="ck-turn ck-turn--user ck-turn--stack" key={m.id}>
                  {m.media && (
                    <span className={`cvmedia${m.staged ? ' cvmedia--staged' : ''}`}>
                      {m.media.map((a, i) => (
                        <span className="cvmedia__item" key={a.key || a.id} style={m.staged ? { '--i': i } : undefined}>
                          {a.type === 'image' ? <img src={previewUrl(a)} alt="" /> : <video src={a.url} muted />}
                        </span>
                      ))}
                    </span>
                  )}
                  {m.text && <span className="ck-said">{m.text}</span>}
                </div>
              );
            }
            if (m.kind === 'saved') {
              return (
                <div className="ck-turn ck-turn--bauhly" key={m.id}>
                  <span className="ck-avatar" aria-hidden="true"><Mark size={15} /></span>
                  <div className="ck-savedcard">
                    <span className="ck-savedcard__cover">
                      {m.project.cover ? <img src={m.project.cover} alt="" onError={(e) => { e.target.style.display = 'none'; }} /> : <span className="pjcard__art" aria-hidden="true" />}
                    </span>
                    <span className="ck-savedcard__body">
                      <span className="ck-savedcard__label"><Icon name="check" size={12} strokeWidth={2.5} /> Saved to</span>
                      <b>{m.project.name}</b>
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <div className={`ck-turn ck-turn--bauhly${m.opener ? ' ck-turn--opener' : ''}`} key={m.id}>
                <span className="ck-avatar" aria-hidden="true"><Mark size={15} /></span>
                <div className="ck-body">
                  {/* a line said in paragraphs (the Instagram ask) keeps them */}
                  {typeof m.text === 'string' && m.text.includes('\n\n')
                    ? m.text.split('\n\n').map((para, i) => <p className="ck-para" key={i}>{para}</p>)
                    : m.text}
                  {m.note && <p className="ck-outcome">{m.note}</p>}
                  {m.exPost && exPost && <ExamplePreview post={exPost} at={exSlide} onAt={setExSlide} />}
                  {/* what comes of it, or that this one is only being shown */}
                  {m.opener && liveIntro && (
                    <p className={`ck-outcome${demo ? ' is-example' : ''}`}>
                      {demo ? 'This is an example, not your own project.' : 'We’ll turn this into your first post.'}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* the words land on the studio's side as they are said (bauhly-v3
              `ck-turn--live`): settled text, then a caret; before any words,
              what is happening to the take */}
          {modal && step === 'recording' && (
            <div className="ck-turn ck-turn--user ck-turn--stack ck-turn--live">
              {pending.length > 0 && (
                <span className="cvmedia">
                  {pending.map((a) => (
                    <span className="cvmedia__item" key={a.id}>
                      {a.type === 'image' ? <img src={a.url} alt="" /> : <video src={a.url} muted />}
                    </span>
                  ))}
                </span>
              )}
              <span className="ck-said ck-said--live">
                {rec.liveText
                  ? <span>{rec.liveText}</span>
                  : <span className="ck-said__waiting">{rec.liveSupported ? 'Transcribing…' : 'Recording…'}</span>}
                {rec.status === 'recording' && <i className="ck-said__caret" aria-hidden="true" />}
              </span>
              {rec.status === 'done' ? (
                <AiProcessing label="Transcribing your voice note" className="ck-said__ai" />
              ) : rec.correcting && rec.status === 'recording' ? (
                <AiProcessing label="AI is correcting the words" tone="quiet" className="ck-said__ai" />
              ) : null}
            </div>
          )}

          {(typing || thinking || busy) && (
            <div className="ck-turn ck-turn--bauhly">
              <span className="ck-avatar" aria-hidden="true"><Mark size={15} /></span>
              <div className="ck-typing" aria-label="Bauhly is thinking"><i /><i /><i /></div>
            </div>
          )}

          {/* in the modal the composer owns the answer, so the one other thing a
              question offers — not answering it — sits under it as a chip */}
          {/* Captures › Add: the composer is the answer; these keep the file
              without one, or go straight on to the plan */}
          {composerLive && adding && step === 'noting' && (
            <div className="ck-turn ck-turn--bauhly ck-turn--actions ck-turn--cont">
              <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
              <div className="ck-inline">
                {onPlan && (
                  <button type="button" className="ck-chip ck-chip--primary" onClick={() => keepAdding(onPlan)}>
                    <Icon name="sparkle" size={14} /> Generate plan
                  </button>
                )}
                {/* only when there is something to keep without words */}
                {cap.current.attachments.length > 0 && (
                  <button type="button" className="ck-chip" onClick={() => keepAdding(onExit)}>Save and close</button>
                )}
              </div>
            </div>
          )}
          {/* the pencil's second question: a photo, or nothing — and the field
              still takes more words (send saves) */}
          {composerLive && adding && step === 'amendMedia' && (
            <div className="ck-turn ck-turn--bauhly ck-turn--actions ck-turn--cont">
              <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
              <div className="ck-inline">
                <label className="ck-chip">
                  Add a photo
                  <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { amendPhotos(e.target.files); e.target.value = ''; }} />
                </label>
                <button type="button" className="btn btn--quiet btn--sm" onClick={amendNothing}>Nothing right now</button>
              </div>
            </div>
          )}
          {composerLive && step === 'clarify' && (
            <div className="ck-turn ck-turn--bauhly ck-turn--actions ck-turn--cont">
              <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
              <div className="ck-refwrap">
                {reference && <CaptureReference of={reference} />}
                <div className="ck-inline">
                  {(planning.current || resume) && (
                    <button type="button" className="ck-chip" onClick={run ? run.onStop : onExit}>Save and close</button>
                  )}
                  <button type="button" className={planning.current || resume ? 'btn btn--quiet btn--sm' : 'ck-chip'} onClick={skipClarify}>
                    {!(planning.current || resume) && <Icon name="arrow-right" size={14} />} Skip this question
                  </button>
                </div>
              </div>
            </div>
          )}
          {exampleAsk && (
            <div className="ck-turn ck-turn--bauhly ck-turn--actions ck-turn--cont ck-turn--ask">
              <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
              <div className="ck-inline ck-inline--row">
                <span className="ck-chip-hold" onMouseDown={(e) => e.preventDefault()}>
                  <button
                    type="button"
                    className="ck-chip ck-chip--icon"
                    disabled={exWait || Boolean(draft.trim()) || pending.length > 0}
                    onClick={exPlay}
                  >
                    <Icon name="play" size={14} strokeWidth={2.25} />
                    {example.say}
                  </button>
                </span>
              </div>
            </div>
          )}
          {vGen != null && (
            <div className="ck-turn ck-turn--bauhly ck-turn--actions ck-turn--cont">
              <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
              <GenProgress at={vGen} stages={vStages} doneSay="Your post is ready." />
            </div>
          )}
          {exView != null && (
            <div className="ck-turn ck-turn--bauhly ck-turn--actions ck-turn--cont">
              <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
              <GenProgress at={exView} />
            </div>
          )}
          {exWait && (
            <div className="ck-turn ck-turn--bauhly">
              <span className="ck-avatar" aria-hidden="true"><Mark size={15} /></span>
              <div className="ck-typing" aria-label="Bauhly is thinking"><i /><i /><i /></div>
            </div>
          )}
          {showActions && (
            <div className="ck-turn ck-turn--bauhly ck-turn--actions ck-turn--cont">
              <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
              <div className={`ck-inline ${step === 'project' ? 'ck-inline--cards' : ''} ${liveIntro && step === 'done' ? 'ck-inline--row' : ''}`}>{actions}</div>
            </div>
          )}

          <div ref={endRef} className="ck__tail" aria-hidden="true" />
        </div>

        <ScrollJump threadRef={threadRef} tailRef={endRef} deps={messages.length} />

        {/* Anchored at the foot in the modal: text, attach, voice, send — one
            bar that never changes the box height (bauhly-v3 CaptureComposer). */}
        {/* in the modal the bar IS the recorder (bauhly-v3 OnbComposer
            `listening`): the mark, Listening…, a live wave, Add a photo and Stop */}
        {modal && step === 'recording' && rec.status === 'done' && (
          <div className="capc capc--hearing capc--working">
            <AiProcessing label="Transcribing your voice note" />
          </div>
        )}
        {modal && step === 'recording' && rec.status !== 'done' && (
          <div className="capc capc--hearing">
            <span className={`capc__listen ${rec.status === 'paused' ? 'is-held' : ''}`}>
              <Icon name={rec.status === 'paused' ? 'image-plus' : 'mic'} size={18} strokeWidth={1.9} className="capc__listen-mic" />
              <span className="capc__listen-say">{rec.status === 'paused' ? 'Choosing a photo…' : 'Listening…'}</span>
              <span className="capc__listen-wave" aria-hidden="true">
                {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i }} />)}
              </span>
              {/* it names what happens to the RECORDING, not just what it opens (bauhly-v3 Oct 6) */}
              <label className="capc__hearadd" title="Holds the take while you choose" onPointerDown={hearHold}>
                <span>Pause to add file</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  hidden
                  onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) hearFiles(f); else { pickingFile.current = false; rec.resume(); } }}
                />
              </label>
              <button type="button" className="capc__stop" onClick={() => rec.stop()} title="Stop recording">
                <span className="capc__stop-mark" aria-hidden="true" />
                <span className="sr-only">Stop recording</span>
              </button>
            </span>
          </div>
        )}
        {modal && step !== 'recording' && polishing && (
          <AiProcessing className="capc-ai" />
        )}
        {modal && step !== 'recording' && (
          <CaptureComposer
            aiPolishing={polishing && draft === autoDraft.current}
            value={draft}
            onValue={(v) => { if (demo && !exLive && v !== exText) setDemo(false); setDraft(v); }}
            live={composerLive || (liveIntro && askOn && step === 'boot')}
            canSend={composerSendable}
            pending={pending}
            onRemoveFile={removePending}
            placeholder={step === 'clarify' ? 'Answer in your own words…' : step === 'amendMedia' ? 'Add anything else, or send to save it…'
              : step === 'ig' ? IG_ASK.field
              : step === 'ask' ? (qOther ? (questionById(qAt)?.otherField || 'Say it in your own words…') : 'Or say it in your own words…')
              /* the same short words to the end of a landing visit (bauhly-v3) */
              : liveIntro && step !== 'how' && !askOn ? 'Add anything else…'
              : (askOn ? (askTyped ?? 'Say it however it comes out…') : 'Say it however it comes out…')}
            onSend={composerSend}
            onFiles={composerFiles}
            onRecord={composerRecord}
            /* the landing field has no plus, as the hero's had none (bauhly-v3) */
            plus={!liveIntro}
            locked={exLive || exWait}
            fading={askFading}
            /* a visitor's voice would need the transcriber, which needs an account: the field is for typing */
            mic={!demo && !needsLogin}
          />
        )}
        {/* before anything real is sent and for as long as they have no account (bauhly-v3 `.ck__privacy`) */}
        {modal && liveIntro && !user && step !== 'recording' && (
          <p className="ck__privacy">
            We use what you share to prepare your post. Learn how we handle your information in our{' '}
            <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
          </p>
        )}
      </div>

      {step === 'recording' && !modal && (
        <RecordingSheet
          rec={rec}
          note="Your recording is only used to plan. It is never shared or posted."
        />
      )}

      {creating && (
        <ProjectFormModal
          mode="create"
          onClose={() => { setCreating(false); setPicking(true); }}
          onSubmit={createFromModal}
        />
      )}
    </div>,
    document.body,
  );
}

/* ── capture — a streamlined "add a moment" modal ──────────────────────────
 *
 * Two ways in. From a project detail, `project` is fixed and the capture files
 * straight into it. From Your Week (no single project in view), pass the
 * `projects` list instead: the modal offers a picker over them, and — for a
 * studio that has no project yet — a name field that creates one on save so the
 * one thing the flow needs from them is never blocked behind a setup step. */
export function CaptureModal({ project, projects, defaultProjectId, onClose }) {
  const fixed = Boolean(project);
  const list = projects || [];
  const noProjects = !fixed && list.length === 0;
  const [text, setText] = useState('');
  const [atts, setAtts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [targetId, setTargetId] = useState(defaultProjectId ?? list[0]?.id ?? '');
  const [newName, setNewName] = useState('');

  const hasContent = Boolean(text.trim()) || atts.length > 0;
  const canSave = hasContent && (fixed || !noProjects || Boolean(newName.trim()));

  const addFiles = async (files) => {
    setUploading(true);
    try { const added = await uploadFiles(files); setAtts((a) => [...a, ...added]); }
    finally { setUploading(false); }
  };
  const save = async () => {
    if (!canSave) return;
    const type = atts.some((a) => a.type === 'video') && !text.trim() ? 'video'
      : atts.length && !text.trim() ? 'photo' : 'note';
    setBusy(true);
    try {
      const id = fixed ? project.id : (noProjects ? await createProject(newName.trim()) : targetId);
      await addEntry(id, { type, text: text.trim(), attachments: atts });
      onClose();
    }
    finally { setBusy(false); }
  };

  const title = fixed ? `Capture to ${project.name}` : 'Capture idea';

  return (
    <>
      <div className="fm-scrim" onClick={onClose} />
      <div className="fm" role="dialog" aria-modal="true" aria-label={title}>
        <div className="fm__head">
          <h2>{title}</h2>
          <button className="np__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
        </div>
        <div className="fm__body">
          {!fixed && !noProjects && (
            <label className="fm__field">
              <span className="fm__label">Add to project</span>
              <select className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {noProjects && (
            <label className="fm__field">
              <span className="fm__label">New project</span>
              <input className="input" value={newName} autoFocus
                placeholder="e.g. Portfolio week"
                onChange={(e) => setNewName(e.target.value)} />
            </label>
          )}
          <label className="fm__field">
            <span className="fm__label">What happened?</span>
            <textarea className="input" rows={4} value={text} autoFocus={!noProjects}
              placeholder="e.g. Kitchen after the rewire — client picked the darker oak"
              onChange={(e) => setText(e.target.value)} />
          </label>
          {atts.length > 0 && <MediaStrip attachments={atts} max={6} />}
          <label className="btn btn--tertiary btn--sm" aria-busy={uploading}
            style={{ alignSelf: 'flex-start', cursor: uploading ? 'default' : 'pointer', pointerEvents: uploading ? 'none' : 'auto' }}>
            {uploading ? <span className="pj-spin" /> : <Icon name="image" size={15} />}
            {uploading ? 'Uploading…' : 'Add photos or a clip'}
            <input type="file" accept="image/*,video/*" multiple hidden disabled={uploading}
              onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
        <div className="fm__foot">
          <span className="fm__spacer" />
          <button className="fm__cancel" onClick={onClose}>Cancel</button>
          <button className="fm__submit" disabled={busy || uploading || !canSave} onClick={save}>
            {busy ? (atts.some((a) => a.type === 'image') ? 'Analysing…' : 'Saving…') : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── project detail ────────────────────────────────────────────────────── */
function ProjectDetail({ project, projects, onBack }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);   // entry id in the side panel
  const [editing, setEditing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState('');
  const [regenId, setRegenId] = useState('');
  const [entryUploadId, setEntryUploadId] = useState('');
  const others = projects.filter((p) => p.id !== project.id);
  const sessions = groupCapturesIntoSessions(project.captures);
  const groups = groupByWeek(sessions);
  const openEntry = open && sessions.find((e) => e.id === open);

  // How many image assets exist, and how many still lack an analysis — drives
  // the "Analyze with AI" button label and whether it's worth showing.
  const imageAtts = project.captures.flatMap((c) => (c.attachments || []).filter((a) => a.type === 'image'));
  const unanalyzed = imageAtts.filter((a) => a.analysis?.status !== 'done').length;

  async function runProjectAnalysis() {
    if (analyzing || imageAtts.length === 0) return;
    setAnalyzeMsg('');
    setAnalyzing(true);
    try {
      const { analyzed, usage } = await analyzeProjectAssets(project.id, {
        force: unanalyzed === 0,
      });
      const n = analyzed ?? unanalyzed;
      const tokens = (usage?.inputTokens || 0) + (usage?.outputTokens || 0);
      const cost = usage?.costUsd || 0;
      const spend = tokens
        ? ` — ${fmtTokens(tokens)} tokens, ~${fmtUsd(cost)}.`
        : '.';
      setAnalyzeMsg(`Analysed ${n} ${n === 1 ? 'asset' : 'assets'}${spend} Tap the ⓘ on any image to see its analysis.`);
    } catch (err) {
      setAnalyzeMsg(err?.response?.data?.message || err?.message || 'Analysis failed. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  // Add photos/clips straight to the project — no note required. The capture is
  // filed with the files and empty text (the backend allows a file-only capture).
  async function addFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!list.length) return;
    setUploadError('');
    setUploading(true);
    setUploadLabel(
      list.length === 1 ? 'Uploading 1 file…' : `Uploading ${list.length} files…`,
    );
    try {
      const added = await uploadFiles(list);
      const hasImages = added.some((a) => a.type === 'image');
      setUploadLabel(hasImages ? 'Analysing photos…' : 'Saving to project…');
      const type = added.some((a) => a.type === 'video') ? 'video' : 'photo';
      await addEntry(project.id, { type, text: '', attachments: added });
    } catch (err) {
      setUploadError(err?.response?.data?.message || err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadLabel('');
    }
  }

  async function addFilesToEntry(entry, files) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!list.length) return;
    setUploadError('');
    setEntryUploadId(entry.id);
    try {
      const added = await uploadFiles(list);
      const current = entry.attachments || [];
      await updateEntry(project.id, entry.id, { attachments: [...current, ...added] });
    } catch (err) {
      setUploadError(err?.response?.data?.message || err?.message || 'Upload failed. Please try again.');
    } finally {
      setEntryUploadId('');
    }
  }

  function regenerateFrom(entry) {
    if (!entry || regenId) return;
    setRegenId(entry.id);
    navigate('/dashboard', {
      state: {
        generateAfterCapture: true,
        sessionId: String(entry.sessionId || '').trim(),
        captureIds: Array.isArray(entry.memberIds) && entry.memberIds.length
          ? entry.memberIds
          : (entry.id ? [entry.id] : []),
      },
    });
  }

  const fileInput = (id) => (
    <input
      id={id}
      type="file"
      accept="image/*,video/*"
      multiple
      hidden
      disabled={uploading}
      onChange={(e) => { addFiles(e.target.files || []); e.target.value = ''; }}
    />
  );

  return (
    <div className="pj pj--detail">
      <div className="pd">
        <div className="pd__bar">
          <button className="pd__back" onClick={onBack} disabled={uploading}>
            <Icon name="arrow-left" size={17} strokeWidth={2.25} />
            Projects
          </button>
          <div className="pd__titles"><h1>{project.name}</h1></div>
          <div className="pd__actions">
            <button className="btn btn--tertiary btn--sm pd__edit" onClick={() => setEditing(true)} disabled={uploading}>
              <Icon name="edit" size={15} strokeWidth={2} /> Edit
            </button>
            {imageAtts.length > 0 && (
              <button
                className={`btn btn--tertiary btn--sm pd__analyze${analyzing ? ' is-busy' : ''}`}
                onClick={runProjectAnalysis}
                disabled={uploading || analyzing}
                title="Run AI analysis on every image in this project"
              >
                {analyzing ? <span className="pj-spin" aria-hidden="true" /> : <Icon name="sparkle" size={15} strokeWidth={2} />}
                {analyzing ? 'Analysing…' : unanalyzed > 0 ? `Analyse ${unanalyzed} with AI` : 'Re-analyse with AI'}
              </button>
            )}
            <label className={`btn btn--tertiary btn--sm pd__addfiles${uploading ? ' is-busy' : ''}`}>
              {uploading ? <span className="pj-spin" aria-hidden="true" /> : <Icon name="image" size={15} strokeWidth={2} />}
              {uploading ? 'Uploading…' : 'Add files'}
              {fileInput('pd-add-files')}
            </label>
            <button className="btn btn--primary btn--sm" onClick={() => setCapturing(true)} disabled={uploading}>
              <Icon name="plus" size={15} strokeWidth={2.5} /> Capture idea
            </button>
          </div>
        </div>

        {uploadError && (
          <p className="pd__upload-err" role="alert">{uploadError}</p>
        )}

        {(analyzing || analyzeMsg) && (
          <div className="pd__analyze-note" role="status" aria-live="polite" aria-busy={analyzing}>
            {analyzing ? (
              <>
                <span className="pj-spin" aria-hidden="true" />
                <span>Analysing images with AI — this can take a moment per asset.</span>
              </>
            ) : (
              <><Icon name="sparkle" size={15} /> <span>{analyzeMsg}</span></>
            )}
          </div>
        )}

        {uploading && project.captures.length > 0 && (
          <div className="pd__upload" role="status" aria-live="polite" aria-busy="true">
            <span className="pj-spin pj-spin--lg" aria-hidden="true" />
            <div className="pd__upload-copy">
              <b>{uploadLabel || 'Uploading…'}</b>
              <span>Large photos and clips can take a minute — keep this tab open.</span>
            </div>
          </div>
        )}

        {project.captures.length === 0 && !uploading && (
          <p className="pd__empty">
            Nothing here yet — tap <b>Capture idea</b> to write something down, or{' '}
            <label className="pd__emptylink" htmlFor="pd-add-files-empty">
              <b>Add files</b>
              {fileInput('pd-add-files-empty')}
            </label>{' '}
            to drop in photos or clips.
          </p>
        )}

        {project.captures.length === 0 && uploading && (
          <div className="pd__empty pd__empty--busy" role="status" aria-live="polite" aria-busy="true">
            <span className="pj-spin pj-spin--lg" aria-hidden="true" />
            <b>{uploadLabel || 'Uploading…'}</b>
            <span>Large photos and clips can take a minute — keep this tab open.</span>
          </div>
        )}

        {groups.map((g) => (
          <section className="pd__week" key={g.key}>
            <h2 className="pd__weekhead">{g.label}</h2>
            <div className="pd__entries">
              {g.entries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  others={others}
                  regenerating={regenId === entry.id}
                  onOpen={(e) => setOpen(e.id)}
                  onMove={(id, target) => moveSession(project.id, target, entry.memberIds || [id])}
                  onDelete={(id) => { deleteSession(project.id, entry.memberIds || [id]); setOpen(null); }}
                  onRegenerate={regenerateFrom}
                  uploadingFiles={entryUploadId === entry.id}
                  onAddFiles={addFilesToEntry}
                />
              ))}
            </div>
          </section>
        ))}

        {openEntry && (
          <EntryPanel
            key={openEntry.id}
            project={project}
            entry={openEntry}
            week={groups.find((g) => g.entries.some((e) => e.id === openEntry.id))?.label}
            regenerating={regenId === openEntry.id}
            onClose={() => setOpen(null)}
            onRegenerate={regenerateFrom}
          />
        )}
        {editing && (
          <ProjectFormModal mode="edit" project={project}
            onClose={() => setEditing(false)}
            onSubmit={(name) => { renameProject(project.id, name); setEditing(false); }} />
        )}
        {capturing && (
          <CaptureChat
            presetProjectId={project.id}
            deferQuestions
            exitLabel={`Back to ${project.name}`}
            onExit={() => setCapturing(false)}
            onViewProject={() => setCapturing(false)}
            onCaptured={() => {
              setCapturing(false);
              navigate('/dashboard', { state: { generateAfterCapture: true } });
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */
/* ── The "Generated" asset folder ──────────────────────────────────────────
 * Images the studio made in WeekView's Create-image flow, kept server-side and
 * account-scoped. Not a project (no notes/analysis) — a flat library the studio
 * can revisit, reuse and prune. A full-page grid + lightbox, matching the
 * project detail view's chrome. */
export function GeneratedFolderView({ images, loading, onBack, onDelete }) {
  const [light, setLight] = useState(null); // index into images, or null
  const current = light != null ? images[light] : null;

  useEffect(() => {
    if (current == null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setLight(null);
      if (e.key === 'ArrowLeft') setLight((i) => (i - 1 + images.length) % images.length);
      if (e.key === 'ArrowRight') setLight((i) => (i + 1) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, images.length]);

  return (
    <div className="pj">
      <div className="pj-head">
        <button className="btn btn--ghost btn--sm" onClick={onBack}>
          <Icon name="arrow-left" size={15} strokeWidth={2.5} /> Projects
        </button>
        <h1 className="pj-head__title">Generated images</h1>
      </div>

      {!loading && images.length === 0 && (
        <div className="empty">
          <div className="empty__card">
            <span className="empty__ico"><Icon name="sparkle" size={30} strokeWidth={1.7} /></span>
            <h1 className="empty__title">Nothing generated yet</h1>
            <p className="empty__sub">
              Images you create with “Generate image” on a post are saved here for later.
            </p>
          </div>
        </div>
      )}

      <div className="np__grid">
        {images.map((g, i) => (
          <div className="np__cell" key={g.key}>
            <button className="np__cellopen" onClick={() => setLight(i)} aria-label={`Open generated image ${i + 1} of ${images.length}`}>
              <span className="np__cellmedia">
                <img src={g.url} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
              </span>
            </button>
            <button
              className="np__info is-err"
              onClick={(e) => { e.stopPropagation(); onDelete(g.key); }}
              aria-label="Delete generated image"
              title="Delete"
            >
              <Icon name="trash" size={14} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      {current && (
        <div className="lb" role="dialog" aria-modal="true" aria-label="Media viewer">
          <div className="lb__scrim" onClick={() => setLight(null)} />
          <div className="lb__bar lb__bar--top">
            <span className="lb__count">{light + 1} / {images.length}</span>
            <button className="lb__close" onClick={() => setLight(null)} aria-label="Close"><Icon name="x" size={20} strokeWidth={2.25} /></button>
          </div>
          {images.length > 1 && (
            <button className="lb__nav lb__nav--prev" onClick={() => setLight((i) => (i - 1 + images.length) % images.length)} aria-label="Previous"><Icon name="arrow-left" size={22} /></button>
          )}
          <figure className="lb__stage">
            <img src={current.url} alt="" />
          </figure>
          {images.length > 1 && (
            <button className="lb__nav lb__nav--next" onClick={() => setLight((i) => (i + 1) % images.length)} aria-label="Next"><Icon name="arrow-right" size={22} /></button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Projects() {
  const projects = useProjects();
  const hydrated = useProjectsHydrated();
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState(null);
  const [editId, setEditId] = useState(null);
  // Seed from cache so the "Generated" folder is on screen from the first paint.
  const [genImages, setGenImages] = useState(readGenCache);
  const [genLoaded, setGenLoaded] = useState(false);
  const [showGen, setShowGen] = useState(false);

  useEffect(() => {
    let alive = true;
    listGeneratedImages()
      .then((imgs) => { if (alive) { setGenImages(imgs); writeGenCache(imgs); setGenLoaded(true); } })
      .catch(() => { if (alive) setGenLoaded(true); }); // keep the cached list on a failed refresh
    return () => { alive = false; };
  }, []);

  const removeGenerated = async (key) => {
    setGenImages((list) => { const next = list.filter((g) => g.key !== key); writeGenCache(next); return next; }); // optimistic
    try { await deleteGeneratedImage(key); } catch { /* the next load reconciles */ }
  };

  const openProject = projects.find((p) => p.id === openId);
  if (openId && openProject) {
    return <ProjectDetail project={openProject} projects={projects} onBack={() => setOpenId(null)} />;
  }
  if (showGen) {
    return (
      <GeneratedFolderView
        images={genImages}
        loading={!genLoaded}
        onBack={() => setShowGen(false)}
        onDelete={removeGenerated}
      />
    );
  }

  return (
    <div className="pj">
      <div className="pj-head">
        <h1 className="pj-head__title">Projects</h1>
        {projects.length > 0 && (
          <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} strokeWidth={2.5} /> New project
          </button>
        )}
      </div>

      {hydrated && projects.length === 0 && (
        <div className="empty">
          <div className="empty__card">
            <span className="empty__ico"><Icon name="brief" size={30} strokeWidth={1.7} /></span>
            <h1 className="empty__title">You don't have any projects yet</h1>
            <p className="empty__note">The things you'd otherwise forget by Friday.</p>
            <p className="empty__sub">
              Projects are where Bauhly keeps your raw material — notes, photos and clips.
              Your next plan is built from whatever lands here.
            </p>
            <button className="btn btn--primary" onClick={() => setCreating(true)}>Start your first project</button>
          </div>
        </div>
      )}

      <div className="pj-list">
        {genImages.length > 0 && (
          <div className="pjcard pjcard--generated">
            <button className="pjcard__open" onClick={() => setShowGen(true)}>
              <span className="pjcard__cover">
                {genImages[0]?.url
                  ? <img src={genImages[0].url} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                  : <span className="pjcard__art" aria-hidden="true" />}
              </span>
              <span className="pjcard__body">
                <b className="pjcard__name"><Icon name="sparkle" size={14} strokeWidth={2} /> Generated</b>
                <span className="pjcard__meta">
                  <span className="pjcard__count">{genImages.length} {genImages.length === 1 ? 'image' : 'images'}</span>
                </span>
              </span>
            </button>
          </div>
        )}
        {projects.map((p) => {
          const cover = coverOf(p);
          const n = sessionCount(p);
          return (
            <div key={p.id} className="pjcard">
              <button className="pjcard__open" onClick={() => setOpenId(p.id)}>
                <span className="pjcard__cover">{cover ? <img src={cover} alt="" onError={(e) => { e.target.style.display = 'none'; }} /> : <span className="pjcard__art" aria-hidden="true" />}</span>
                <span className="pjcard__body">
                  <b className="pjcard__name">{p.name}</b>
                  <span className="pjcard__meta">
                    <span className="pjcard__count">{n} {n === 1 ? 'item' : 'items'}</span>
                  </span>
                </span>
              </button>
              <button className="pjcard__menu" onClick={() => setMenuId(menuId === p.id ? null : p.id)}
                aria-label="Project options" aria-haspopup="menu" aria-expanded={menuId === p.id}>
                <Icon name="more" size={18} strokeWidth={2} />
              </button>
              {menuId === p.id && (
                <>
                  <div className="pe-menu__scrim" onClick={() => setMenuId(null)} />
                  <div className="pe-menu pjcard__pemenu" role="menu">
                    <button role="menuitem" onClick={() => { setMenuId(null); setEditId(p.id); }}>
                      <Icon name="edit" size={17} strokeWidth={2} />
                      <span className="pe-menu__grow">Rename</span>
                    </button>
                    <div className="pe-menu__sep" />
                    <button role="menuitem" className="pe-menu__del" onClick={() => { setMenuId(null); deleteProject(p.id); }}>
                      <Icon name="trash" size={17} strokeWidth={2} />
                      <span className="pe-menu__grow">Delete project</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {creating && (
        <ProjectFormModal mode="create"
          onClose={() => setCreating(false)}
          onSubmit={async (name) => { const id = await createProject(name); setCreating(false); setOpenId(id); }} />
      )}
      {editId && (
        <ProjectFormModal mode="edit" project={projects.find((p) => p.id === editId)}
          onClose={() => setEditId(null)}
          onSubmit={(name) => { renameProject(editId, name); setEditId(null); }} />
      )}
    </div>
  );
}
