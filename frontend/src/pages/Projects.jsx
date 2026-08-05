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
import Icon from '../brand/Icon';
import { Mark } from '../brand/Logo';
import { AutoTextarea, useBodyScrollLock } from './checkin/ui';
import { RecordingSheet, useRecorder } from './checkin/recorder';
import ScrollJump from './checkin/ScrollJump';
import {
  useProjects, useProjectsHydrated, createProject, renameProject, deleteProject,
  addEntry, updateEntry, deleteEntry, moveEntry,
  coverOf, groupByWeek, fmtWhen, uploadFiles,
} from '../lib/projectsStore';
import './projects.css';
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
          <img src={a.thumbnailUrl} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
          {a.type === 'video' && <span className="ms__play"><Icon name="play" size={16} /></span>}
        </span>
      ))}
      {extra > 0 && <span className="ms__thumb ms__more">+{extra}</span>}
    </div>
  );
}

/* ── one entry, as a card ──────────────────────────────────────────────── */
function EntryCard({ entry, others, onOpen, onMove, onDelete }) {
  const [menu, setMenu] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const closeMenu = () => { setMenu(false); setMoveOpen(false); };
  const video = entry.type === 'video' ? (entry.attachments || [])[0] : null;
  const open = () => onOpen(entry);
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
          <button className="pe__more" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu}
            onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}>
            <Icon name="more" size={18} />
          </button>
        </div>
      </div>

      {entry.text && <p className="pe__text">{entry.text}</p>}

      {video ? (
        <div className="pe__video" onClick={(e) => { e.stopPropagation(); onOpen(entry, 0); }}>
          <img src={video.thumbnailUrl} alt="" loading="lazy" />
          <span className="ms__play"><Icon name="play" size={16} /></span>
        </div>
      ) : (entry.attachments || []).length > 0 ? (
        <MediaStrip attachments={entry.attachments} />
      ) : null}

      {menu && (
        <>
          <div className="pe-menu__scrim" onClick={(e) => { e.stopPropagation(); closeMenu(); }} />
          <div className="pe-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            {!moveOpen ? (
              <>
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
export function EntryPanel({ project, entry, week, onClose }) {
  const [light, setLight] = useState(null); // index into attachments, or null
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
      updateEntry(project.id, entry.id, { attachments: [...atts, ...added] });
    } finally {
      setUploading(false);
    }
  };
  const current = light !== null ? atts[light] : null;

  return (
    <>
      <div className="np-scrim" onClick={onClose} />
      <aside className="np" role="dialog" aria-modal="true" aria-label="Note">
        <header className="np__bar">
          <span className="np__title">About this note</span>
          <div className="np__baracts">
            <button className="np__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
          </div>
        </header>

        <div className="np__body">
          <div className="np__meta">
            <span>{week ? `${week} · ` : ''}{fmtWhen(entry.createdAt)}</span>
          </div>

          <textarea
            className="ctxf ctxf--panel"
            defaultValue={entry.text || ''}
            aria-label="Note"
            placeholder="Write here — what happened, in your own words…"
            onBlur={(e) => { if (e.target.value !== (entry.text || '')) updateEntry(project.id, entry.id, { text: e.target.value }); }}
          />

          <div className="np__grid">
            {atts.map((a, i) => (
              <button className="np__cell" key={a.id} onClick={() => setLight(i)} aria-label={`Open ${a.type} ${i + 1} of ${atts.length}`}>
                <span className="np__cellmedia">
                  <img src={a.thumbnailUrl} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                  {a.type === 'video' && <span className="ms__play"><Icon name="play" size={18} /></span>}
                </span>
              </button>
            ))}
            <label className={`np__add ${uploading ? 'is-busy' : ''}`} aria-busy={uploading}>
              {uploading ? <span className="pj-spin" /> : <Icon name="plus" size={20} strokeWidth={2.5} />}
              <span>{uploading ? 'Uploading…' : 'Add'}</span>
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
              ? <img src={current.url} alt="" />
              : <video src={current.url} poster={current.thumbnailUrl} controls autoPlay playsInline />}
          </figure>
          {atts.length > 1 && (
            <button className="lb__nav lb__nav--next" onClick={() => setLight((i) => (i + 1) % atts.length)} aria-label="Next"><Icon name="arrow-right" size={22} /></button>
          )}
        </div>
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
 * One question at a time, on the check-in surface — write it, record it, or
 * upload it, then file it into a project. Rendered as a full-screen immersive
 * overlay so it reads the same wherever it is triggered from. */
export function CaptureChat({ presetProjectId, defaultProjectId, onExit, onViewProject, exitLabel = 'Back' }) {
  const projects = useProjects();
  const { messages, typing, push, say, after } = useConversation();
  const [step, setStep] = useState('boot');
  const [draft, setDraft] = useState('');
  const [optionsReady, setOptionsReady] = useState(false);
  const [saved, setSaved] = useState(null);
  const [creating, setCreating] = useState(false); // the new-project modal
  const [busy, setBusy] = useState(false); // an upload or a save is in flight
  const rec = useRecorder();
  const endRef = useRef(null);
  const threadRef = useRef(null);
  const cap = useRef({ kind: null, text: '', attachments: [] });
  /* whether the field on screen came from a recording — only then is "record
   * again" a real answer */
  const fromVoice = useRef(false);

  const preset = projects.find((p) => p.id === presetProjectId);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, typing, step]);

  /* capture owns the screen while it runs — same as onboarding */
  useEffect(() => {
    document.body.classList.add('is-immersive');
    return () => document.body.classList.remove('is-immersive');
  }, []);

  useEffect(() => {
    const d = say(preset
      ? `Anything recent on ${preset.name}? A decision you made, something a client said, or where it's got to.`
      : "Tell me something recent from the studio. A project you're on, one you've just finished, a decision you made, or something a client said.");
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

  const chooseWrite = () => {
    setStep('boot');
    userSays('Write it down');
    cap.current.kind = 'note';
    const d = say("Go ahead — what happened, or what's the idea?");
    after(d, () => setStep('writing'));
  };
  const chooseRecord = () => {
    setStep('boot');
    userSays('Record a voice note');
    cap.current.kind = 'note';
    fromVoice.current = true;
    const d = say("I'm listening — take your time.");
    after(d, () => { rec.reset(); rec.start(); setStep('recording'); });
  };
  const recordAgain = () => {
    setDraft('');
    setStep('boot');
    userSays('Record it again');
    const d = say("Go on then — I'm listening.");
    after(d, () => { rec.reset(); rec.start(); setStep('recording'); });
  };

  const submitWriting = () => {
    const text = draft.trim();
    if (!text) return;
    fromVoice.current = false;
    setDraft('');
    setStep('boot');
    userSays(text);
    cap.current.text = text;
    askMedia();
  };

  useEffect(() => {
    if (rec.status === 'done' && step === 'recording') {
      /* The recording is the input, not the record. A real build transcribes and
       * keeps the words; this build has no transcriber, so it opens the field
       * empty rather than inventing words. */
      setStep('boot');
      setDraft('');
      const d = say(['Recorded — I keep the words, not the audio.', 'Check I got this right:']);
      after(d, () => setStep('writing'));
    }
    if (rec.status === 'denied' && step === 'recording') {
      setStep('boot');
      cap.current.kind = 'note';
      const d = say("I can't reach the microphone — let's write it instead. What happened?");
      after(d, () => setStep('writing'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.status]);

  const askMedia = () => {
    const d = say('Got it. Anything to show for it?');
    after(d, () => setStep('media'));
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
      push({ from: 'user', media: added });
      const d = say('Added. Anything else, or save it?');
      after(d, () => setStep('media'));
    } catch {
      const d = say("That upload didn't go through — want to try again?");
      after(d, () => setStep('media'));
    } finally {
      setBusy(false);
    }
  };

  /* a file (or files) IS the capture — upload, then ask the one line that makes
   * it usable next week */
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
      push({ from: 'user', media: added });
      const d = say('What is this about? The more you tell me, the more your next plan can do with it.');
      after(d, () => setStep('noting'));
    } catch {
      const d = say("That upload didn't go through — want to try again?");
      after(d, () => setStep('how'));
    } finally {
      setBusy(false);
    }
  };

  /* the note that belongs to the file just added; skipping keeps the file */
  const submitNote = () => {
    const text = draft.trim();
    setDraft('');
    setStep('boot');
    if (text) { userSays(text); cap.current.text = text; }
    else { userSays('Nothing to add'); }
    if (preset) { finish(preset.id); return; }
    const d = say('Which project is this for?');
    after(d, () => setStep('project'));
  };

  const proceed = () => {
    setStep('boot');
    userSays(cap.current.attachments.length ? 'That’s everything' : 'Nothing right now');
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

  /* file the capture through the real backend: make the project if it's new,
   * then add the entry. `addEntry`/`createProject` update the store, so the
   * saved card and the rest of the app see it straight away. */
  const finish = async (projectId, createName) => {
    const c = cap.current;
    const type = c.kind;
    const text = c.kind === 'note' ? c.text : '';
    setBusy(true);
    try {
      let pid = projectId;
      let name = createName;
      if (createName) pid = await createProject(createName);
      else name = projects.find((p) => p.id === pid)?.name;
      await addEntry(pid, { type, text, attachments: c.attachments });
      const cover = c.attachments.find((a) => a.type === 'image')?.thumbnailUrl
        || c.attachments[0]?.thumbnailUrl || null;
      setSaved({ id: pid, name });
      const d = say([{ kind: 'saved', project: { name, cover } }, "It's in your library — the next plan is written from it."]);
      after(d, () => setStep('done'));
    } catch {
      const d = say('Something went wrong saving that — try again in a moment?');
      after(d, () => setStep('media'));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    cap.current = { kind: null, text: '', attachments: [] };
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
      case 'noting': {
        const voiced = step === 'writing' && fromVoice.current;
        const send = step === 'noting' ? submitNote : submitWriting;
        const label = step === 'noting' ? 'Add it' : 'That’s it';
        return (
          <div className="cvtype">
            <AutoTextarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              minHeight={step === 'noting' ? 64 : 92}
              autoFocus
              placeholder={step === 'noting' ? 'e.g. Kitchen after the rewire — client picked the darker oak' : 'Say it however it comes out…'}
              aria-label="Your note"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || step !== 'writing')) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="cvtype__acts">
              <button className="ck-chip ck-chip--primary cvtype__send" disabled={!draft.trim()} onClick={send}>
                <Icon name="arrow-up-right" size={14} /> {label}
              </button>
              {step === 'noting' && (
                <button className="btn btn--quiet btn--sm" onClick={submitNote}>Nothing to add</button>
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
            <label className="ck-chip"><Icon name="image" size={14} /> Upload a file
              <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <button
              className={`ck-chip ${cap.current.attachments.length ? 'ck-chip--primary' : 'ck-chip--ghost'}`}
              onClick={proceed}
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
              const n = p.captures?.length || 0;
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
                          {a.type === 'image' ? <img src={a.url} alt="" /> : <video src={a.url} muted />}
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
          <button className="fm__submit" disabled={busy || uploading || !canSave} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </>
  );
}

/* ── project detail ────────────────────────────────────────────────────── */
function ProjectDetail({ project, projects, onBack }) {
  const [open, setOpen] = useState(null);   // entry id in the side panel
  const [editing, setEditing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const others = projects.filter((p) => p.id !== project.id);
  const groups = groupByWeek(project.captures);
  const openEntry = open && project.captures.find((e) => e.id === open);

  // Add photos/clips straight to the project — no note required. The capture is
  // filed with the files and empty text (the backend allows a file-only capture).
  async function addFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!list.length) return;
    setUploading(true);
    try {
      const added = await uploadFiles(list);
      const type = added.some((a) => a.type === 'video') ? 'video' : 'photo';
      await addEntry(project.id, { type, text: '', attachments: added });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="pj pj--detail">
      <div className="pd">
        <div className="pd__bar">
          <button className="pd__back" onClick={onBack}>
            <Icon name="arrow-left" size={17} strokeWidth={2.25} />
            Projects
          </button>
          <div className="pd__titles"><h1>{project.name}</h1></div>
          <div className="pd__actions">
            <button className="btn btn--tertiary btn--sm pd__edit" onClick={() => setEditing(true)}>
              <Icon name="edit" size={15} strokeWidth={2} /> Edit
            </button>
            <label className={`btn btn--tertiary btn--sm pd__addfiles${uploading ? ' is-busy' : ''}`}>
              <Icon name="image" size={15} strokeWidth={2} /> {uploading ? 'Adding…' : 'Add files'}
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                disabled={uploading}
                onChange={(e) => { addFiles(e.target.files || []); e.target.value = ''; }}
              />
            </label>
            <button className="btn btn--primary btn--sm" onClick={() => setCapturing(true)}>
              <Icon name="plus" size={15} strokeWidth={2.5} /> Capture idea
            </button>
          </div>
        </div>

        {project.captures.length === 0 && (
          <p className="pd__empty">
            Nothing here yet — tap <b>Capture idea</b> to write something down, or{' '}
            <label className="pd__emptylink">
              <b>Add files</b>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                disabled={uploading}
                onChange={(e) => { addFiles(e.target.files || []); e.target.value = ''; }}
              />
            </label>{' '}
            to drop in photos or clips.
          </p>
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
                  onOpen={(e) => setOpen(e.id)}
                  onMove={(id, target) => moveEntry(project.id, target, id)}
                  onDelete={(id) => { deleteEntry(project.id, id); setOpen(null); }}
                />
              ))}
            </div>
          </section>
        ))}

        {openEntry && (
          <EntryPanel
            project={project}
            entry={openEntry}
            week={groups.find((g) => g.entries.some((e) => e.id === openEntry.id))?.label}
            onClose={() => setOpen(null)}
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
          />
        )}
      </div>
    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */
export default function Projects() {
  const projects = useProjects();
  const hydrated = useProjectsHydrated();
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState(null);
  const [editId, setEditId] = useState(null);

  const openProject = projects.find((p) => p.id === openId);
  if (openId && openProject) {
    return <ProjectDetail project={openProject} projects={projects} onBack={() => setOpenId(null)} />;
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
        {projects.map((p) => {
          const cover = coverOf(p);
          const n = (p.captures || []).length;
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
