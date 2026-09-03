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

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../brand/Icon';
import { Mark } from '../brand/Logo';
import { AutoTextarea, useBodyScrollLock } from './checkin/ui';
import { RecordingSheet, useRecorder, refreshDraftIfUnedited } from './checkin/recorder';
import ScrollJump from './checkin/ScrollJump';
import {
  useProjects, useProjectsHydrated, createProject, renameProject, deleteProject,
  addEntry, addSession, updateEntry, deleteSession, moveSession,
  analyzeProjectAssets, analyzeAsset,
  coverOf, groupByWeek, groupCapturesIntoSessions, sessionCount, sessionDisplayText, fmtWhen, uploadFiles,
} from '../lib/projectsStore';
import { listGeneratedImages, deleteGeneratedImage } from '../api/images';
import { understandCapture, transcribeCapture, clarificationQuestion, hasTranscriptGap, transcriptGapQuestion } from '../api/projects';
import { previewUrl } from '../api/media';
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
function readGenCache() {
  try {
    const raw = localStorage.getItem(genCacheKey());
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function writeGenCache(list) {
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

/* ── one entry, as a card ──────────────────────────────────────────────── */
function EntryCard({ entry, others, regenerating, uploadingFiles, onOpen, onMove, onDelete, onRegenerate, onAddFiles }) {
  const [menu, setMenu] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const fileRef = useRef(null);
  const closeMenu = () => { setMenu(false); setMoveOpen(false); };
  const video = entry.type === 'video' ? (entry.attachments || [])[0] : null;
  const summary = sessionDisplayText(entry);
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
  const atts = entry.attachments || [];

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
      await updateEntry(project.id, entry.id, { attachments: [...atts, ...added] });
    } finally {
      setUploading(false);
    }
  };
  const current = light !== null ? atts[light] : null;
  const analysisAtt = analysisFor !== null ? atts[analysisFor] : null;

  const runAnalysis = async (att) => {
    setAnalyzingId(att.id);
    try {
      await analyzeAsset(project.id, entry.id, att.id);
    } finally {
      setAnalyzingId(null);
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

          <textarea
            className="ctxf ctxf--panel"
            defaultValue={sessionDisplayText(entry)}
            aria-label="Session summary"
            placeholder="Summary of this conversation…"
            onBlur={(e) => {
              const next = e.target.value;
              const prev = sessionDisplayText(entry);
              if (next !== prev) {
                updateEntry(project.id, entry.id, { text: next, sessionSummary: next });
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
function ProjectFormModal({ mode, project, onClose, onSubmit }) {
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
function useConversation() {
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const push = (msg) => setMessages((m) => [...m, { id: ckMsgId++, ...msg }]);
  const say = (texts, extra = 0) => {
    const list = Array.isArray(texts) ? texts : [texts];
    let delay = 0;
    list.forEach((text, i) => {
      delay += i === 0 ? 520 : 860;
      const at = delay;
      timers.current.push(
        setTimeout(() => setTyping(true), at - 420),
        setTimeout(() => {
          setTyping(false);
          push(typeof text === 'string' ? { from: 'bauhly', text } : { from: 'bauhly', ...text });
        }, at),
      );
    });
    return delay + extra;
  };
  const after = (ms, fn) => timers.current.push(setTimeout(fn, ms));
  return { messages, typing, push, say, after };
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
export function CaptureChat({ presetProjectId, defaultProjectId, onExit, onViewProject, onCaptured, exitLabel = 'Back' }) {
  const projects = useProjects();
  const { messages, typing, push, say, after } = useConversation();
  const [step, setStep] = useState('boot');
  const [draft, setDraft] = useState('');
  const [optionsReady, setOptionsReady] = useState(false);
  const [saved, setSaved] = useState(null);
  const [creating, setCreating] = useState(false); // the new-project modal
  const [busy, setBusy] = useState(false); // an upload, understand, or save is in flight
  const [polishing, setPolishing] = useState(false);
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
    askedQuestion: '',
    askedAnswer: '',
    turns: [],
    awaitingAssets: false,
  });
  /* whether the field on screen came from a recording — only then is "record
   * again" a real answer */
  const fromVoice = useRef(false);
  /* after a take, land back on writing (opening note) or clarify */
  const recordingReturn = useRef('writing');

  const preset = projects.find((p) => p.id === presetProjectId);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, typing, step]);

  /* capture owns the screen while it runs — same as onboarding */
  useEffect(() => {
    document.body.classList.add('is-immersive');
    return () => document.body.classList.remove('is-immersive');
  }, []);

  useEffect(() => {
    const d = say(preset
      ? `Anything from ${preset.name}? Something that happened, an idea, something you noticed, or anything else that feels relevant.`
      : 'What would you like to capture today? Maybe something that happened at work, an idea, or something you noticed.');
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

  const continueToFile = (result) => {
    const choice = String(result?.understanding?.visualAssetChoice || '').toLowerCase();
    if (!cap.current.attachments.length && choice !== 'generate' && choice !== 'none') {
      const d = say('Do you have a photo or clip of this, or would you rather generate visuals later?');
      after(d, () => setStep('media'));
      return false;
    }
    if (preset) {
      finish(preset.id);
      return true;
    }
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
    const followUp = clarificationQuestion(result, cap.current.turns)
      || transcriptGapQuestion(cap.current.text, cap.current.askedQuestion);
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
    say("I'm listening — take your time.");
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
    say("I'm listening — take your time.");
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
      const d = say('Added. Anything else, or save it?');
      after(d, () => setStep('media'));
      setBusy(false);
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

  const proceed = (visualChoice = '') => {
    setStep('boot');
    const spoken = cap.current.attachments.length
      ? 'That’s everything'
      : (visualChoice === 'generate' ? 'Generate visuals' : 'Nothing right now');
    userSays(spoken);
    const choice = visualChoice || (cap.current.attachments.length ? 'provided' : 'none');
    const applyChoice = (u) => (u ? { ...u, visualAssetChoice: u.visualAssetChoice || choice } : u);
    cap.current.understanding = applyChoice(cap.current.understanding);
    cap.current.understandings = (cap.current.understandings || []).map(applyChoice);
    if (cap.current.awaitingAssets) {
      resolveAssetTurn(spoken);
      return;
    }
    if (preset) { finish(preset.id); return; }
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
      await addSession(pid, {
        type,
        text,
        attachments: c.attachments,
        understanding: c.understanding,
        understandings: rows,
        conversationSummary: c.conversationSummary,
        sessionKind: 'capture',
      });
      const cover = previewUrl(c.attachments.find((a) => a.type === 'image') || c.attachments[0]) || null;
      setSaved({ id: pid, name });
      if (onCaptured) {
        const d = say("It's in your library — building your plan now.");
        after(d + 700, () => onCaptured({ projectId: pid, projectName: name }));
      } else {
        const d = say([{ kind: 'saved', project: { name, cover } }, "It's in your library — the next plan is written from it."]);
        after(d, () => setStep('done'));
      }
    } catch {
      const d = say('Something went wrong saving that — try again in a moment?');
      after(d, () => setStep(c.attachments.length ? 'media' : 'project'));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    cap.current = { kind: null, text: '', attachments: [], understanding: null, understandings: [], conversationSummary: '', askedQuestion: '', askedAnswer: '', turns: [], awaitingAssets: false };
    setSaved(null);
    setStep('boot');
    const d = say('What else have you got?');
    after(d, () => setStep('how'));
  };

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
              <span className="cvtype__polish">Cleaning the words up…</span>
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
      case 'done':
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
  const showActions = Boolean(actions) && optionsReady && !typing && !busy;
  const thinking = !typing && !busy && Boolean(actions) && !optionsReady;

  return createPortal(
    <div className="cap-overlay">
      <div className="ck">
        <button className="btn btn--quiet btn--sm ck__keep" onClick={onExit}>
          <Icon name="arrow-left" size={15} />
          {preset ? `Back to ${preset.name}` : exitLabel}
        </button>

        <div className="ck__thread" aria-live="polite" ref={threadRef}>
          <div className="ck__intro">
            <span className="ck__intro-mark"><Mark size={30} /></span>
            <span className="eyebrow">Capture</span>
          </div>

          {messages.map((m) => {
            if (m.from === 'user') {
              return (
                <div className="ck-turn ck-turn--user" key={m.id}>
                  {m.media ? (
                    <span className="cvmedia">
                      {m.media.map((a) => (
                        <span className="cvmedia__item" key={a.key || a.id}>
                          {a.type === 'image' ? <img src={previewUrl(a)} alt="" /> : <video src={a.url} muted />}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="ck-said">{m.text}</span>
                  )}
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
              <div className="ck-turn ck-turn--bauhly" key={m.id}>
                <span className="ck-avatar" aria-hidden="true"><Mark size={15} /></span>
                <div className="ck-body">{m.text}</div>
              </div>
            );
          })}

          {(typing || thinking || busy) && (
            <div className="ck-turn ck-turn--bauhly">
              <span className="ck-avatar" aria-hidden="true"><Mark size={15} /></span>
              <div className="ck-typing" aria-label="Bauhly is thinking"><i /><i /><i /></div>
            </div>
          )}

          {showActions && (
            <div className="ck-turn ck-turn--bauhly ck-turn--actions ck-turn--cont">
              <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
              <div className={`ck-inline ${step === 'project' ? 'ck-inline--cards' : ''}`}>{actions}</div>
            </div>
          )}

          <div ref={endRef} className="ck__tail" aria-hidden="true" />
        </div>

        <ScrollJump threadRef={threadRef} tailRef={endRef} deps={messages.length} />
      </div>

      {step === 'recording' && (
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
function GeneratedFolderView({ images, loading, onBack, onDelete }) {
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
