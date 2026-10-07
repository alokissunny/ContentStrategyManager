/*
 * Captures — the /dashboard/projects page, ported from bauhly-v3's Projects
 * workspace (pages/app/Projects.jsx, "Captures").
 *
 * One flat list of every capture across every project; the project is a
 * filter, not a page of its own. Each row states where it is filed, what the
 * studio said, and whether it is waiting on them (Needs clarification), ready
 * for the next plan, already used in one, or held back. Ticking rows reveals a
 * bulk bar (Exclude / Move / Delete / Generate plan). `Show assets` flips the
 * same filtered set to a wall of its photos and clips.
 *
 * Status is derived in lib/captureStatus.js from the live capture model:
 * `excluded`, `usedInPlanAt` and `usedInPosts` (the posts it went into, {id, date}
 * read live) are stored on each capture by the backend.
 * Generating hands the chosen capture ids to the Calendar's existing
 * generate-after-capture flow (YourPlans), which marks them used server-side.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../brand/Icon';
import EmptyState from '../components/ui/EmptyState';
import { useBodyScrollLock } from './checkin/ui';
import {
  useProjects, useProjectsHydrated, refreshProjects, createProject, renameProject, deleteProject,
  deleteSession, moveSession, setSessionExcluded, fmtWhen, sessionDisplayText, updateEntry, uploadFiles,
} from '../lib/projectsStore';
import { allCaptureSessions, plannable } from '../lib/captureStatus';
import { captureQuestions } from '../api/projects';
import { listGeneratedImages, deleteGeneratedImage } from '../api/images';
import { previewUrl } from '../api/media';
import { GeneratedFolderView, readGenCache, writeGenCache, CaptureChat } from './Projects';
import './projects.css';
import './captures.css';

/* The generate endpoint reads at most this many capture ids. */
const MAX_GEN_IDS = 24;

const STATUS_SAY = {
  unclear: { label: 'Needs clarification', short: 'Answer', icon: 'info', tone: 'ask' },
  thin: { label: 'Needs more information', short: 'More info', icon: 'info', tone: 'ask' },
  ready: { label: 'Ready for plan', short: 'Ready', icon: 'plan', tone: 'ready' },
  used: { label: 'Generated plan', short: 'Generated', icon: 'check', tone: 'done' },
  off: { label: 'Excluded from plan', short: 'Excluded', icon: 'eye-off', tone: 'off' },
};

const STATES = [
  { id: 'unclear', label: 'Needs clarification' },
  { id: 'thin', label: 'Needs more information' },
  { id: 'ready', label: 'Ready for plan' },
  { id: 'used', label: 'Used in a plan' },
  { id: 'off', label: 'Excluded' },
];

function useIsPhone() {
  const q = '(max-width: 560px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/* ── The capture's side panel (bauhly-v3 pages/app/Projects.jsx › EntryPanel)
 * Head: the project, the state badge and when. Body: one box per state — the
 * reason and the one press (Answer clarification / Generate plan / Generate
 * another plan) — then the words, editable where they are read ("Edit note"),
 * then the files with Add. ⋯ holds Move to project and Delete capture.
 * "Needs clarification" here means photos with no words (lib/captureStatus),
 * so answering it is writing the note: the button puts the caret there. */
const shortDay = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
};

// a post's calendar day ('2026-10-05', local) → "Mon, 5 Oct"
const postDay = (ymd, { weekday = true } = {}) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { ...(weekday ? { weekday: 'short' } : {}), month: 'short', day: 'numeric' });
};
const listDays = (days) => (days.length <= 1 ? days.join('')
  : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`);

function NoteField({ value, placeholder, onSave, fieldRef }) {
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);
  const grow = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => { grow(fieldRef.current); });
  return (
    <textarea
      ref={fieldRef}
      className="ctxf ctxf--panel"
      value={v}
      rows={1}
      placeholder={placeholder}
      aria-label="Note"
      onChange={(e) => { setV(e.target.value); grow(e.target); }}
      onBlur={() => { if (v.trim() !== String(value || '').trim()) onSave(v.trim()); }}
    />
  );
}

// what Bauhly would ask about a capture session: each member's open questions
// (stored on the capture) plus any asked on this visit
// …and what a capture with words still lacks (skipped questions, a missing piece)
const gapsOfItem = (item) => [...new Set((item.project.captures || [])
  .filter((c) => item.memberIds.includes(c.id))
  .flatMap((c) => [...(c.gaps || []), ...(c.openQuestions || [])]))];
const questionsOf = (item, asked = {}) => [...new Set((item.project.captures || [])
  .filter((c) => item.memberIds.includes(c.id))
  .flatMap((c) => [...(c.openQuestions || []), ...(asked[c.id] || [])]))];

// Add the detail: the member that is missing something, its conversation and
// the first gap — what the Capture window needs to pick it back up
function resumeOf(item) {
  const members = (item.project.captures || []).filter((c) => item.memberIds.includes(c.id));
  const m = members.find((c) => (c.gaps || []).length || (c.openQuestions || []).length);
  if (!m) return null;
  // the history to show: this capture's chat, else the session's (one member
  // usually carries it), else the note itself as what the studio said
  const chat = [m, ...members].map((c) => c.conversationTurns || []).find((t) => t.length) || [];
  return {
    projectId: item.projectId,
    captureId: m.id,
    turns: chat,
    history: chat.length ? null : members.map((c) => ({
      text: String(c.text || c.sessionSummary || '').trim(),
      media: (c.attachments || []).map((a) => ({ type: a.type, key: a.key, url: a.url })),
    })).filter((h) => h.text || h.media.length),
    // Bauhly's own question first; the generic gap only when there is none
    gap: (m.openQuestions || [])[0] || (m.gaps || [])[0] || '',
    text: m.text || '',
    createdAt: m.createdAt || item.session?.createdAt || null,
    attachments: (m.attachments || []).map((a) => ({ type: a.type, key: a.key, url: a.url })),
    kind: m.type || 'note',
  };
}

function CapturePanel({ item, projects, asked, onClose, onGenerate, onDelete, onMove, onAddDetail }) {
  useBodyScrollLock();
  const entry = item.session;
  const atts = entry.attachments || [];
  const members = (item.project.captures || []).filter((c) => item.memberIds.includes(c.id));
  const lead = members.find((c) => c.id === entry.id) || members[0] || entry;
  const words = String(sessionDisplayText(entry) || '').trim();
  const usedAt = members.map((c) => c.usedInPlanAt).filter(Boolean).sort().pop() || null;
  // the posts the plan made from it, as the calendar has them now (the
  // backend reads them live); `linked` = posts recorded, some may be gone
  const usedPosts = [...new Map(members.flatMap((c) => c.usedInPosts || []).map((p) => [p.id, p])).values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const linked = members.some((c) => Number(c.linkedPosts) > 0);
  const others = projects.filter((p) => p.id !== item.projectId);
  const [menu, setMenu] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [light, setLight] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const field = useRef(null);
  const closeMenu = () => { setMenu(false); setMoveOpen(false); };

  useEffect(() => {
    const onKey = (e) => {
      if (light !== null) {
        if (e.key === 'Escape') setLight(null);
        else if (e.key === 'ArrowRight') setLight((i) => (i + 1) % atts.length);
        else if (e.key === 'ArrowLeft') setLight((i) => (i - 1 + atts.length) % atts.length);
        return;
      }
      if (e.key === 'Escape') { if (menu) closeMenu(); else onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [light, menu, atts.length, onClose]);

  const saveNote = async (text) => {
    setErr('');
    try {
      // the words the list shows come from the capture's stories first, so the
      // edit is written into them too (the first story carries the note)
      const stories = Array.isArray(lead.stories) && lead.stories.length
        ? [{ ...lead.stories[0], summary: text }]
        : undefined;
      await updateEntry(item.projectId, lead.id, {
        text,
        sessionSummary: text,
        ...(stories ? { stories, understanding: stories[0] } : {}),
      });
    } catch { setErr('That note could not be saved. Try again.'); }
  };
  const removeAtt = async (att) => {
    const owner = members.find((c) => (c.attachments || []).some((a) => (a.key || a.id) === (att.key || att.id)));
    if (!owner) return;
    setLight(null);
    try {
      await updateEntry(item.projectId, owner.id, { attachments: owner.attachments.filter((a) => (a.key || a.id) !== (att.key || att.id)) });
    } catch { setErr('That file could not be removed. Try again.'); }
  };
  const addFiles = async (files) => {
    setUploading(true);
    setErr('');
    try {
      const added = await uploadFiles(files);
      await updateEntry(item.projectId, lead.id, { attachments: [...(lead.attachments || []), ...added] });
    } catch { setErr('Those files could not be added. Try again.'); }
    finally { setUploading(false); }
  };

  const st = item.status;
  const mark = st === 'used'
    ? {
      label: 'In a plan',
      icon: 'clock',
      tone: 'ready',
      more: usedPosts.length
        ? `· ${postDay(usedPosts[0].date, { weekday: false })}${usedPosts.length > 1 ? ` +${usedPosts.length - 1}` : ''}`
        : '',
    }
    : STATUS_SAY[st];
  const current = light !== null ? atts[light] : null;

  return (
    <>
      <div className="np-scrim" onClick={onClose} />
      <aside className="np" role="dialog" aria-modal="true" aria-label={`Capture in ${item.projectName}`}>
        <header className="np__bar">
          <span className="np__headtext">
            <span className="np__title">{item.projectName || 'No project'}</span>
            <span className="np__sub">
              {mark && (
                <span className={`pjw-badge pjw-badge--${mark.tone}`} title={mark.label}>
                  <Icon name={mark.icon} size={12} strokeWidth={2.2} />
                  {mark.label}
                  {mark.more && <em className="pjw-used__w">{mark.more}</em>}
                </span>
              )}
              <span className="np__sub__when">{fmtWhen(entry.createdAt)}</span>
            </span>
          </span>
          <div className="np__baracts">
            <div className="np__morewrap">
              <button className="np__close" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => (menu ? closeMenu() : setMenu(true))}>
                <Icon name="more" size={18} />
              </button>
              {menu && (
                <>
                  <div className="pe-menu__scrim" onClick={closeMenu} />
                  <div className="pe-menu pe-menu--panel" role="menu">
                    {!moveOpen ? (
                      <>
                        {others.length > 0 && (
                          <button role="menuitem" onClick={() => setMoveOpen(true)}>
                            <Icon name="plan" size={17} />
                            <span className="pe-menu__grow">Move to project</span>
                            <Icon name="chevron-right" size={16} />
                          </button>
                        )}
                        {others.length > 0 && <div className="pe-menu__sep" />}
                        <button role="menuitem" className="pe-menu__del" onClick={() => { closeMenu(); onDelete(); }}>
                          <Icon name="trash" size={17} /> Delete capture
                        </button>
                      </>
                    ) : (
                      <>
                        <button role="menuitem" className="pe-menu__back" onClick={() => setMoveOpen(false)}>
                          <Icon name="arrow-left" size={16} />
                          <span className="pe-menu__grow">Move to project</span>
                        </button>
                        <div className="pe-menu__sep" />
                        {others.map((p) => (
                          <button key={p.id} role="menuitem" onClick={() => { closeMenu(); onMove(p.id); }}>
                            <span className="pe-menu__grow">{p.name}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <button className="np__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
          </div>
        </header>

        <div className="np__body">
          {st === 'unclear' && (
            <div className="np__needs">
              <p className="np__needs__top">
                <Icon name="info" size={15} strokeWidth={2.2} />
                Bauhly would have to guess
              </p>
              {questionsOf(item, asked).map((q) => (
                <p key={q} className="np__needs__ask">{q}</p>
              ))}
              <p className="np__needs__say">
                Without your answer it has to work this out on its own, and what comes
                back can be inaccurate — the wrong reason, a detail that is not quite
                right, a post that does not sound like your work. One answer and it is
                written from what you actually said.
              </p>
              <button type="button" className="np__needs__go" onClick={() => field.current?.focus()}>
                Answer clarification
                <Icon name="arrow-right" size={15} strokeWidth={2.2} />
              </button>
            </div>
          )}
          {st === 'thin' && (
            <div className="np__needs">
              <p className="np__needs__top">
                <Icon name="info" size={15} strokeWidth={2.2} />
                Bauhly is missing a detail
              </p>
              {gapsOfItem(item).map((q) => (
                <p key={q} className="np__needs__ask">{q}</p>
              ))}
              <p className="np__needs__say">
                It can plan from this as it is, but it will fill the gap on its own.
                Add the detail to the note and the post is written from what you said.
              </p>
              <button type="button" className="np__needs__go" onClick={() => (onAddDetail ? onAddDetail() : field.current?.focus())}>
                Add the detail
                <Icon name="arrow-right" size={15} strokeWidth={2.2} />
              </button>
              <button type="button" className="np__needs__go np__needs__go--quiet" onClick={onGenerate}>
                Generate plan anyway
                <Icon name="arrow-right" size={15} strokeWidth={2.2} />
              </button>
            </div>
          )}
          {st === 'ready' && (
            <div className="np__needs np__needs--go">
              <p className="np__needs__top">
                <Icon name="plan" size={15} strokeWidth={2.2} />
                Nothing left to answer
              </p>
              <p className="np__needs__say">Bauhly has everything it needs from this one.</p>
              <button type="button" className="np__needs__go np__needs__go--ink" onClick={onGenerate}>
                Generate plan
                <Icon name="arrow-right" size={15} strokeWidth={2.2} />
              </button>
            </div>
          )}
          {st === 'used' && (
            <div className="np__needs np__needs--done">
              <p className="np__needs__top">
                <Icon name="check-circle" size={15} strokeWidth={2.2} />
                Already generated
              </p>
              <p className="np__needs__say">
                {usedPosts.length
                  ? `It went into the ${usedPosts.length > 1 ? 'posts' : 'post'} on ${listDays(usedPosts.map((p) => postDay(p.date)))}.`
                  : (linked
                    ? 'The posts made from it are no longer on the calendar.'
                    : (usedAt ? `A plan was made from it on ${shortDay(usedAt)}.` : 'This capture has already been through a plan.'))}
              </p>
              <button type="button" className="np__needs__go np__needs__go--quiet" onClick={onGenerate}>
                Generate another plan
                <Icon name="arrow-right" size={15} strokeWidth={2.2} />
              </button>
            </div>
          )}
          {st === 'off' && (
            <div className="np__needs np__needs--done">
              <p className="np__needs__top">
                <Icon name="eye-off" size={15} strokeWidth={2.2} />
                Held back from plans
              </p>
              <p className="np__needs__say">Your plans leave this one out until you include it again from the list.</p>
            </div>
          )}

          <div className="np__note">
            {words && (
              <button type="button" className="np__note__edit" onClick={() => field.current?.focus()}>
                <Icon name="edit" size={13} strokeWidth={2} />
                Edit note
              </button>
            )}
            <NoteField
              fieldRef={field}
              value={words}
              placeholder="What happened here, in your own words? Bauhly writes next week's plan from this."
              onSave={saveNote}
            />
          </div>
          {err && <p className="np__err" role="alert">{err}</p>}

          <div className="np__grid">
            {atts.map((a, i) => (
              <span className="np__cellwrap" key={a.key || a.id || i}>
                <button
                  className="np__cellx"
                  aria-label={`Remove ${a.type} ${i + 1}`}
                  title="Remove this file"
                  onClick={(e) => { e.stopPropagation(); removeAtt(a); }}
                >
                  <Icon name="x" size={13} strokeWidth={2.75} />
                </button>
                <button className="np__cell" onClick={() => setLight(i)} aria-label={`Open ${a.type} ${i + 1} of ${atts.length}`}>
                  <span className="np__cellmedia">
                    <img src={previewUrl(a)} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                    {a.type === 'video' && <span className="ms__play"><Icon name="play" size={18} /></span>}
                  </span>
                </button>
              </span>
            ))}
            <label className={`np__add ${uploading ? 'is-busy' : ''}`} aria-busy={uploading}>
              {uploading ? <span className="pj-spin" /> : <Icon name="plus" size={20} strokeWidth={2.5} />}
              <span>{uploading ? 'Adding…' : 'Add'}</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                disabled={uploading}
                onChange={(e) => { if (e.target.files?.length) addFiles([...e.target.files]); e.target.value = ''; }}
              />
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
    </>
  );
}

const wordsOf = (it) => String(sessionDisplayText(it.session) || it.session.text || '').trim();

function Thumb({ att }) {
  const [broken, setBroken] = useState(false);
  const src = previewUrl(att);
  if (!src || broken) return <Icon name="image" size={18} strokeWidth={2} />;
  return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

/* Manage projects — rename / delete / create, as rows of one list. */
function ProjectsPanel({ projects, onClose, onCreate, onRename, onDelete }) {
  useBodyScrollLock();
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState('');

  const saveName = (p) => {
    const name = draft.trim();
    if (name && name !== p.name) onRename(p.id, name);
    setEditing(null);
  };
  const make = () => {
    const name = fresh.trim();
    if (!name) return;
    onCreate(name);
    setFresh('');
    setAdding(false);
  };

  return (
    <>
      <div className="np-scrim" onClick={onClose} />
      <aside className="np" role="dialog" aria-modal="true" aria-label="Projects">
        <header className="np__bar">
          <span className="np__title">Projects</span>
          <div className="np__baracts">
            <button className="np__close np__close--go" onClick={() => setAdding(true)} aria-label="New project" title="New project">
              <Icon name="plus" size={17} strokeWidth={2.4} />
            </button>
            <button className="np__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
          </div>
        </header>
        <div className="np__body">
          <p className="pjm-lead">
            Make a project, rename one, or remove one you are done with. Deleting a project
            deletes the captures filed in it.
          </p>
          <div className="pjm-card">
            <ul className="pjm">
              {adding && (
                <li className="pjm__row pjm__row--new">
                  <input
                    className="input pjm__input"
                    value={fresh}
                    autoFocus
                    placeholder="e.g. Prinsengracht apartment"
                    onChange={(e) => setFresh(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') make(); if (e.key === 'Escape') { setFresh(''); setAdding(false); } }}
                  />
                  <span className="pjm__acts">
                    <button type="button" className="pjm__make" disabled={!fresh.trim()} onClick={make} aria-label="Create project" title="Create">
                      <Icon name="check" size={16} strokeWidth={2.4} />
                    </button>
                    <button type="button" aria-label="Cancel" title="Cancel" onClick={() => { setFresh(''); setAdding(false); }}>
                      <Icon name="x" size={16} strokeWidth={2} />
                    </button>
                  </span>
                </li>
              )}
              {projects.map((p) => {
                const n = (p.captures || []).length;
                const on = editing === p.id;
                return (
                  <li key={p.id} className="pjm__row">
                    {on ? (
                      <input
                        className="input pjm__input"
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveName(p); if (e.key === 'Escape') setEditing(null); }}
                        onBlur={() => saveName(p)}
                      />
                    ) : (
                      <span className="pjm__say">
                        <b className="pjm__name">{p.name}</b>
                        <span className="pjm__n">{`${n} ${n === 1 ? 'capture' : 'captures'}`}</span>
                      </span>
                    )}
                    {!on && (
                      <span className="pjm__acts">
                        <button type="button" aria-label={`Rename ${p.name}`} title="Rename" onClick={() => { setDraft(p.name); setEditing(p.id); }}>
                          <Icon name="edit" size={16} strokeWidth={2} />
                        </button>
                        <button type="button" className="pjm__del" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => onDelete(p)}>
                          <Icon name="trash" size={16} strokeWidth={2} />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </aside>
    </>
  );
}

export default function Captures() {
  const projects = useProjects();
  const hydrated = useProjectsHydrated();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [params] = useSearchParams();

  const [pick, setPick] = useState(() => { const id = params.get('p'); return id ? [id] : []; }); // [] = every project
  const [stat, setStat] = useState([]); // [] = every status
  const [tab, setTab] = useState('captures'); // 'captures' | 'assets'
  const [bare, setBare] = useState(false); // assets: only the undescribed ones
  const [sel, setSel] = useState([]); // ticked session ids
  const [open, setOpen] = useState(null); // session id in the side panel
  const [menu, setMenu] = useState(false);
  const [lvl, setLvl] = useState('root'); // filter menu level
  const [moving, setMoving] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [managing, setManaging] = useState(false);
  const [killing, setKilling] = useState(null); // project to delete
  const [gen, setGen] = useState(null); // { eligible, blocked, held, spent }
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(null); // Add the detail: the capture conversation picked back up

  // The generated-image folder (WeekView › Create image) — reached from Filters.
  const [genImages, setGenImages] = useState(readGenCache);
  const [genLoaded, setGenLoaded] = useState(false);
  const [showGen, setShowGen] = useState(false);

  useEffect(() => {
    // a plan generated since the list was loaded marks captures used server-side
    refreshProjects().catch(() => {});
    let alive = true;
    listGeneratedImages()
      .then((imgs) => { if (alive) { setGenImages(imgs); writeGenCache(imgs); setGenLoaded(true); } })
      .catch(() => { if (alive) setGenLoaded(true); });
    return () => { alive = false; };
  }, []);

  const all = allCaptureSessions(projects);
  // the questions Bauhly would ask about captures it cannot read — fetched for
  // the ones that have none stored yet (each is asked once, then kept)
  const [asked, setAsked] = useState({});
  const askedFor = useRef(new Set());
  useEffect(() => {
    const items = all
      .filter((it) => it.status === 'unclear' && !questionsOf(it, asked).length)
      .flatMap((it) => (it.project.captures || [])
        .filter((c) => it.memberIds.includes(c.id) && (c.attachments || []).length && !askedFor.current.has(c.id))
        .slice(0, 1)
        .map((c) => ({ projectId: it.projectId, captureId: c.id })))
      .slice(0, 12);
    if (!items.length) return;
    items.forEach((i) => askedFor.current.add(i.captureId));
    captureQuestions(items)
      .then((got) => setAsked((cur) => ({ ...cur, ...got })))
      .catch(() => { /* the badge still says it needs words */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);
  const inProject = (it, s) => (!s.length ? true : s.includes(it.projectId));
  const inStatus = (it, s) => (!s.length ? true : s.includes(it.status));
  const flip = (was, id) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]);
  const shown = all.filter((it) => inProject(it, pick) && inStatus(it, stat));

  const assetsInProject = all
    .filter((it) => inProject(it, pick))
    .flatMap((it) => (it.session.attachments || []).map((att, i) => ({ att, at: i, ...it })));
  const assetsAll = assetsInProject.filter((a) => inStatus(a, stat));
  const isBare = (a) => !String(a.att.analysis?.summary || '').trim() && !wordsOf(a);
  const bareCount = assetsAll.filter(isBare).length;
  const assets = bare ? assetsAll.filter(isBare) : assetsAll;
  const narrowed = pick.length > 0 || stat.length > 0 || (tab === 'assets' && bare);

  // a filter naming a project that no longer exists leaves an unexplained empty list
  useEffect(() => {
    const live = pick.filter((id) => projects.some((p) => p.id === id));
    if (live.length !== pick.length) setPick(live);
  }, [projects, pick]);
  // and a tick on a row no longer on screen is a count nobody can account for
  useEffect(() => {
    setSel((was) => was.filter((id) => shown.some((it) => it.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, stat, tab, projects]);

  const chips = projects.map((p) => ({
    id: p.id,
    label: p.name,
    n: all.filter((it) => it.projectId === p.id && inStatus(it, stat)).length,
  }));
  const states = STATES.map((x) => {
    const hit = all.filter((it) => inProject(it, pick) && it.status === x.id);
    return { ...x, n: tab === 'assets' ? hit.reduce((t, it) => t + (it.session.attachments || []).length, 0) : hit.length };
  });
  const sayOf = (s, rows, none, many) => (!s.length
    ? none
    : s.length === 1 ? (rows.find((r) => r.id === s[0])?.label || none) : `${s.length} ${many}`);
  const pickSay = sayOf(pick, chips, 'All projects', 'projects');
  const statSay = sayOf(stat, states, tab === 'assets' ? 'All files' : 'All captures', 'statuses');

  const toggle = (id) => setSel((was) => flip(was, id));
  const picked = shown.filter((it) => sel.includes(it.id));
  const holdable = picked.filter((it) => it.status !== 'used');
  const allHeld = holdable.length > 0 && holdable.every((it) => it.status === 'off');

  const waiting = all.filter((it) => inProject(it, pick) && it.status === 'unclear');
  const readyNow = all.filter((it) => inProject(it, pick) && plannable(it.status));

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const runGen = (list) => {
    if (!list.length) return;
    const captureIds = list.flatMap((it) => it.memberIds).slice(0, MAX_GEN_IDS);
    setSel([]);
    setGen(null);
    navigate('/dashboard', { state: { generateAfterCapture: true, captureIds } });
  };
  const genSplit = () => {
    const g = {
      eligible: picked.filter((it) => plannable(it.status)),
      blocked: picked.filter((it) => it.status === 'unclear'),
      held: picked.filter((it) => it.status === 'off'),
      spent: picked.filter((it) => it.status === 'used'),
    };
    const again = g.eligible.length === 0 && g.spent.length > 0;
    return { ...g, again, targets: again ? g.spent : g.eligible };
  };
  const aim = genSplit();

  // the page-level Generate: everything ready in the project(s) on screen; if
  // some are still waiting on words, say so before generating around them
  const startGen = () => {
    if (waiting.length) setGen({ eligible: readyNow, blocked: waiting, held: [], spent: [] });
    else runGen(readyNow);
  };

  const hold = (off) => run(async () => {
    for (const it of holdable) {
      // eslint-disable-next-line no-await-in-loop
      await setSessionExcluded(it.projectId, it.memberIds, off);
    }
    setSel([]);
  });
  const moveThese = (toId) => run(async () => {
    setMoving(false);
    for (const it of picked.filter((x) => x.projectId !== toId)) {
      // eslint-disable-next-line no-await-in-loop
      await moveSession(it.projectId, toId, it.memberIds);
    }
    setSel([]);
  });
  const dropThese = () => run(async () => {
    for (const it of picked) {
      // eslint-disable-next-line no-await-in-loop
      await deleteSession(it.projectId, it.memberIds);
    }
    setSel([]);
    setDropping(false);
  });

  const removeGenerated = async (key) => {
    setGenImages((list) => { const next = list.filter((g) => g.key !== key); writeGenCache(next); return next; });
    try { await deleteGeneratedImage(key); } catch { /* the next load reconciles */ }
  };

  if (showGen) {
    return <GeneratedFolderView images={genImages} loading={!genLoaded} onBack={() => setShowGen(false)} onDelete={removeGenerated} />;
  }

  const filterSay = narrowed
    ? `${pickSay}${stat.length ? ` · ${statSay}` : ''}${tab === 'assets' && bare ? ' · Not described' : ''}`
    : 'Filters';
  const openItem = open && all.find((it) => it.id === open);

  return (
    <div className="pj pjw">
      <div className="pj-head">
        <h1 className="pj-head__title">Captures</h1>
        <div className="pj-head__acts">
          {(readyNow.length > 0 || waiting.length > 0) && (
            <button type="button" className="pjw-genall" onClick={startGen}>
              <Icon name="sparkle" size={14} strokeWidth={2.2} />
              Generate plan
              {readyNow.length > 0 && <b className="pjw-chip__n">{readyNow.length}</b>}
            </button>
          )}
        </div>
      </div>

      {hydrated && projects.length === 0 ? (
        <EmptyState
          icon="brief"
          title="You don't have any captures yet"
          note="The things you'd otherwise forget by Friday."
          action={<button className="btn btn--primary" onClick={() => setManaging(true)}>Start your first project</button>}
        >
          This is where Bauhly keeps your raw material — notes, photos, clips, and the small
          things you'd otherwise forget by Friday. Your next plan is built from whatever lands here.
        </EmptyState>
      ) : (
        <>
          <div className="pjw-bar">
            <div className="pjw-filters">
              <button
                type="button"
                className={`pjw-fbtn pjw-swap ${tab === 'assets' ? 'is-on' : ''}`}
                onClick={() => setTab(tab === 'assets' ? 'captures' : 'assets')}
                aria-label={tab === 'assets' ? 'Show captures' : 'Show assets'}
                title={tab === 'assets' ? 'Show captures' : 'Show assets'}
              >
                <Icon name={tab === 'assets' ? 'blocks' : 'grid'} size={15} strokeWidth={2} />
                {!phone && <span className="pjw-fbtn__say">{tab === 'assets' ? 'Show captures' : 'Show assets'}</span>}
              </button>
              <button type="button" className="pjw-new" onClick={() => setManaging(true)} aria-label="New project" title="New project">
                <Icon name="plus" size={14} strokeWidth={2.5} />
                {!phone && 'New project'}
              </button>
              <div className="pjw-pick">
                <button
                  type="button"
                  className={`pjw-fbtn ${narrowed ? 'is-on' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  aria-label={narrowed ? `Filters — ${filterSay}` : 'Filters'}
                  title="Filters"
                  onClick={() => { setLvl('root'); setMenu((v) => !v); }}
                >
                  <Icon name="filter" size={15} strokeWidth={2} />
                  {!phone && <span className="pjw-fbtn__say">{filterSay}</span>}
                  {!phone && <Icon name="chevron-down" size={14} strokeWidth={2.2} />}
                </button>
                {menu && (
                  <>
                    <div className="pe-menu__scrim" onClick={() => setMenu(false)} />
                    <div className="pe-menu pjw-fmenu" role="menu">
                      {lvl === 'root' && (
                        <>
                          <button role="menuitem" onClick={() => setLvl('project')}>
                            <Icon name="folder" size={17} strokeWidth={2} />
                            <span className="pe-menu__grow">Project</span>
                            <span className="pjw-fmenu__val">{pickSay}</span>
                            <Icon name="chevron-right" size={16} strokeWidth={2} />
                          </button>
                          <button role="menuitem" onClick={() => setLvl('status')}>
                            <Icon name="plan" size={17} strokeWidth={2} />
                            <span className="pe-menu__grow">Status</span>
                            <span className="pjw-fmenu__val">{statSay}</span>
                            <Icon name="chevron-right" size={16} strokeWidth={2} />
                          </button>
                          {tab === 'assets' && bareCount > 0 && (
                            <button role="menuitemcheckbox" aria-checked={bare} className={bare ? 'is-on' : ''} onClick={() => setBare((v) => !v)}>
                              <Icon name="image-find" size={17} strokeWidth={2} />
                              <span className="pe-menu__grow">Not described</span>
                              <b className="pjw-chip__n">{bareCount}</b>
                              {bare && <Icon name="check" size={16} strokeWidth={2.6} />}
                            </button>
                          )}
                          {narrowed && (
                            <button role="menuitem" onClick={() => { setPick([]); setStat([]); setBare(false); setMenu(false); }}>
                              <Icon name="x" size={17} strokeWidth={2} />
                              <span className="pe-menu__grow">Clear filters</span>
                            </button>
                          )}
                          <div className="pe-menu__sep" />
                          {genImages.length > 0 && (
                            <button role="menuitem" onClick={() => { setMenu(false); setShowGen(true); }}>
                              <Icon name="sparkle" size={17} strokeWidth={2} />
                              <span className="pe-menu__grow">Generated images</span>
                              <b className="pjw-chip__n">{genImages.length}</b>
                            </button>
                          )}
                          <button role="menuitem" onClick={() => { setMenu(false); setManaging(true); }}>
                            <Icon name="settings" size={17} strokeWidth={2} />
                            <span className="pe-menu__grow">Manage projects</span>
                          </button>
                        </>
                      )}
                      {lvl !== 'root' && (
                        <>
                          <button className="pe-menu__back" onClick={() => setLvl('root')}>
                            <Icon name="chevron-left" size={16} strokeWidth={2} />
                            <span className="pe-menu__grow">{lvl === 'project' ? 'Project' : 'Status'}</span>
                          </button>
                          <div className="pe-menu__sep" />
                        </>
                      )}
                      {lvl === 'project' && (
                        <>
                          <button role="menuitemradio" aria-checked={!pick.length} className={!pick.length ? 'is-on' : ''} onClick={() => setPick([])}>
                            <span className="pjw-fmenu__tick">{!pick.length && <Icon name="check" size={14} strokeWidth={2.6} />}</span>
                            <span className="pe-menu__grow">All projects</span>
                            <b className="pjw-chip__n">{all.filter((it) => inStatus(it, stat)).length}</b>
                          </button>
                          {chips.map((c) => (
                            <button key={c.id} role="menuitemcheckbox" aria-checked={pick.includes(c.id)} className={pick.includes(c.id) ? 'is-on' : ''} onClick={() => setPick((was) => flip(was, c.id))}>
                              <span className="pjw-fmenu__tick">{pick.includes(c.id) && <Icon name="check" size={14} strokeWidth={2.6} />}</span>
                              <span className="pe-menu__grow">{c.label}</span>
                              <b className="pjw-chip__n">{c.n}</b>
                            </button>
                          ))}
                        </>
                      )}
                      {lvl === 'status' && (
                        <>
                          <button role="menuitemradio" aria-checked={!stat.length} className={!stat.length ? 'is-on' : ''} onClick={() => setStat([])}>
                            <span className="pjw-fmenu__tick">{!stat.length && <Icon name="check" size={14} strokeWidth={2.6} />}</span>
                            <span className="pe-menu__grow">{tab === 'assets' ? 'All files' : 'All captures'}</span>
                            <b className="pjw-chip__n">{tab === 'assets' ? assetsInProject.length : all.filter((it) => inProject(it, pick)).length}</b>
                          </button>
                          {states.map((x) => (
                            <button
                              key={x.id}
                              role="menuitemcheckbox"
                              aria-checked={stat.includes(x.id)}
                              className={stat.includes(x.id) ? 'is-on' : ''}
                              disabled={x.n === 0 && !stat.includes(x.id)}
                              onClick={() => setStat((was) => flip(was, x.id))}
                            >
                              <span className="pjw-fmenu__tick">{stat.includes(x.id) && <Icon name="check" size={14} strokeWidth={2.6} />}</span>
                              <span className="pe-menu__grow">{x.label}</span>
                              <b className="pjw-chip__n">{x.n}</b>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {sel.length > 0 && (
            <div className="pjw-bulk">
              <span className="pjw-bulk__n" aria-label={`${sel.length} selected`}>
                <b>{sel.length}</b>
                <span className="pjw-bulk__n__t">selected</span>
              </span>
              <div className="pjw-bulk__acts">
                {holdable.length > 0 && (
                  <button
                    type="button"
                    className="pjw-bulk__b"
                    disabled={busy}
                    onClick={() => hold(!allHeld)}
                    title={allHeld ? 'Include capture' : 'Exclude capture'}
                    aria-label={allHeld ? 'Include capture' : 'Exclude capture'}
                  >
                    <Icon name={allHeld ? 'plus' : 'minus-circle'} size={15} strokeWidth={2.2} />
                    <span className="pjw-bulk__b__t">
                      {allHeld ? (phone ? 'Include' : 'Include capture') : (phone ? 'Exclude' : 'Exclude capture')}
                    </span>
                  </button>
                )}
                {projects.length > 1 && (
                  <div className="pjw-bulk__wrap">
                    <button
                      type="button"
                      className="pjw-bulk__b"
                      disabled={busy}
                      aria-haspopup="menu"
                      aria-expanded={moving}
                      onClick={() => setMoving((v) => !v)}
                      title="Move to project"
                      aria-label="Move to project"
                    >
                      <Icon name="plan" size={15} strokeWidth={2} />
                      <span className="pjw-bulk__b__t">{phone ? 'Move' : 'Move to project'}</span>
                    </button>
                    {moving && (
                      <>
                        <div className="pe-menu__scrim" onClick={() => setMoving(false)} />
                        <div className="pe-menu pjw-bulk__menu" role="menu">
                          {projects.map((p) => (
                            <button key={p.id} role="menuitem" onClick={() => moveThese(p.id)}>
                              <span className="pe-menu__grow">{p.name}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <button type="button" className="pjw-bulk__b pjw-bulk__b--bad" disabled={busy} onClick={() => setDropping(true)} title="Delete" aria-label="Delete">
                  <Icon name="trash" size={15} strokeWidth={2} />
                  <span className="pjw-bulk__b__t">Delete</span>
                </button>
                <button
                  type="button"
                  className="pjw-bulk__b pjw-bulk__b--go"
                  disabled={busy}
                  onClick={() => { if (aim.blocked.length && !aim.again) setGen(aim); else runGen(aim.targets); }}
                >
                  <Icon name="sparkle" size={15} className="pjw-bulk__go-i" />
                  {aim.again ? (phone ? 'Re-generate' : 'Re-generate plan') : (phone ? 'Generate' : 'Generate plan')}
                  {aim.targets.length > 1 && <b className="pjw-chip__n">{aim.targets.length}</b>}
                </button>
              </div>
              <button type="button" className="pjw-bulk__clear" onClick={() => setSel([])} aria-label="Clear selection" title="Clear selection">
                <Icon name="x" size={16} strokeWidth={2.2} />
              </button>
            </div>
          )}

          <div className={`pjw-sec ${tab === 'assets' ? 'pjw-sec--bare' : ''}`}>
            {tab === 'assets' ? (
              assets.length === 0 ? (
                <p className="pjw-none">{narrowed ? 'No files match these filters.' : 'Nothing captured yet.'}</p>
              ) : (
                <ul className="pjw-assets">
                  {assets.map((a) => {
                    const say = String(a.att.analysis?.summary || '').trim() || wordsOf(a);
                    return (
                      <li key={`${a.id}-${a.att.key || a.att.id || a.at}`} className="pjw-asset">
                        <button
                          type="button"
                          className="pjw-asset__hit"
                          onClick={() => setOpen(a.id)}
                          aria-label={`Open ${a.att.type === 'video' ? 'clip' : 'photo'} from ${a.projectName}`}
                        >
                          <span className="pjw-asset__art">
                            <Thumb att={a.att} />
                            {a.att.type === 'video' && (
                              <span className="pjw-asset__clip"><Icon name="play" size={12} />Clip</span>
                            )}
                          </span>
                          <span className="pjw-asset__say">
                            {say ? (
                              <span className="pjw-asset__from">{say}</span>
                            ) : (
                              <span className="pjw-asset__add"><Icon name="edit" size={12} strokeWidth={2.2} />Describe it</span>
                            )}
                            {!pick.length && <span className="pjw-asset__proj">{a.projectName}</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : !hydrated ? null : shown.length === 0 ? (
              <p className="pjw-none">{narrowed ? 'No captures match these filters.' : 'Nothing captured yet.'}</p>
            ) : (
              <ul className="pjw-list">
                {shown.map((it) => {
                  const mark = STATUS_SAY[it.status];
                  const on = sel.includes(it.id);
                  const atts = it.session.attachments || [];
                  const cover = atts[0] || null;
                  const words = wordsOf(it);
                  const images = atts.length;
                  return (
                    <li key={`${it.projectId}-${it.id}`} className={`pjw-row is-${it.status} ${on ? 'is-sel' : ''}`}>
                      <label className="pjw-tick">
                        <input type="checkbox" checked={on} onChange={() => toggle(it.id)} aria-label={`Select capture from ${fmtWhen(it.session.createdAt)}`} />
                        <span aria-hidden="true"><Icon name="check" size={13} strokeWidth={2.6} /></span>
                      </label>
                      <button type="button" className="pjw-open" onClick={() => setOpen(it.id)} aria-label={`Open capture in ${it.projectName}`} />
                      <span className="pjw-shot">
                        <span className="pjw-thumb">
                          {cover ? <Thumb att={cover} /> : <Icon name="brief" size={18} strokeWidth={2} />}
                          {cover?.type === 'video' && <span className="pjw-thumb__play"><Icon name="play" size={12} /></span>}
                        </span>
                        {it.status === 'used' && (
                          <span className="pjw-disc" title="In a plan">
                            <Icon name="clock" size={12} strokeWidth={2.25} />
                          </span>
                        )}
                      </span>
                      <span className="pjw-body">
                        <span className="pjw-facts">
                          <span className="pjw-facts__proj"><em>{it.projectName}</em></span>
                          <span className="pjw-facts__end">
                            <span className={`pjw-badge pjw-badge--${mark.tone}`} title={mark.label}>
                              <Icon name={mark.icon} size={12} strokeWidth={2.2} />
                              {phone ? mark.short : mark.label}
                            </span>
                            <button type="button" className="pjw-go" tabIndex={-1} aria-hidden="true" onClick={() => setOpen(it.id)}>
                              <Icon name="chevron-right" size={18} strokeWidth={2} />
                            </button>
                          </span>
                        </span>
                        {words
                          ? <span className="pjw-quote">{`“${words}”`}</span>
                          : <span className="pjw-quote pjw-quote--none">No words captured</span>}
                        {(it.status === 'unclear' ? questionsOf(it, asked) : it.status === 'thin' ? gapsOfItem(it) : []).map((q) => (
                          <span key={q} className="pjw-ask">
                            <Icon name="info" size={13} strokeWidth={2.2} />
                            {q}
                          </span>
                        ))}
                        <span className="pjw-meta">
                          {images > 0 && (
                            <span><Icon name="image" size={13} strokeWidth={2} />{`${images} ${images === 1 ? 'image' : 'images'}`}</span>
                          )}
                          <span><Icon name="calendar" size={13} strokeWidth={2} />{fmtWhen(it.session.createdAt)}</span>
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {gen && (() => {
        const b = gen.blocked.length;
        const e = gen.eligible.length;
        const h = gen.held.length;
        const sp = gen.spent.length;
        const aside = [
          h ? `${h} ${h === 1 ? 'is' : 'are'} excluded from plans` : null,
          sp ? `${sp} ${sp === 1 ? 'has' : 'have'} been used already` : null,
        ].filter(Boolean).join(', and ');
        return (
          <>
            <div className="fm-scrim" onClick={() => setGen(null)} />
            <div className="fm" role="alertdialog" aria-modal="true" aria-label="Before generating">
              <div className="fm__head">
                <h2>{`Bauhly has ${b === 1 ? 'a question' : `${b} questions`} first`}</h2>
              </div>
              <div className="fm__body">
                <p className="pjw-drop__say">
                  {`${b === 1 ? 'One capture is' : `${b} captures are`} waiting on a word from you. Bauhly cannot tell what ${b === 1 ? 'it shows' : 'they show'}, so ${b === 1 ? 'it' : 'they'} cannot go into a plan yet.`}
                </p>
                <p className="pjw-drop__say">
                  {e === 0
                    ? 'Nothing else is ready, so there is nothing to generate from yet.'
                    : `${e} ${e === 1 ? 'other capture is' : 'others are'} ready${aside ? `, and ${aside}` : ''}.`}
                </p>
              </div>
              <div className="fm__foot">
                <span className="fm__spacer" />
                <button className="fm__cancel" onClick={() => setGen(null)}>Cancel</button>
                {e > 0 && (
                  <button className="fm__cancel" onClick={() => runGen(gen.eligible)}>Skip &amp; generate</button>
                )}
                <button className="fm__submit" onClick={() => { const first = gen.blocked[0]; setGen(null); setSel([]); setOpen(first.id); }}>
                  {b === 1 ? 'Answer it' : 'Answer the first'}
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {dropping && (
        <>
          <div className="fm-scrim" onClick={() => setDropping(false)} />
          <div className="fm" role="alertdialog" aria-modal="true" aria-label="Delete captures">
            <div className="fm__head">
              <h2>{`Delete ${sel.length} ${sel.length === 1 ? 'capture' : 'captures'}?`}</h2>
            </div>
            <div className="fm__body">
              <p className="pjw-drop__say">
                Their words and their files go with them, from here and from the pool your plans
                are written out of. This cannot be undone.
              </p>
            </div>
            <div className="fm__foot">
              <span className="fm__spacer" />
              <button className="fm__cancel" onClick={() => setDropping(false)}>Cancel</button>
              <button className="fm__submit fm__submit--bad" disabled={busy} onClick={dropThese}>Delete</button>
            </div>
          </div>
        </>
      )}

      {managing && (
        <ProjectsPanel
          projects={projects}
          onClose={() => setManaging(false)}
          onCreate={async (name) => { const id = await createProject(name); if (id) setPick([id]); }}
          onRename={(id, name) => renameProject(id, name)}
          onDelete={(p) => setKilling(p)}
        />
      )}

      {killing && (() => {
        const n = (killing.captures || []).length;
        return (
          <>
            <div className="fm-scrim" onClick={() => setKilling(null)} />
            <div className="fm" role="alertdialog" aria-modal="true" aria-label="Delete project">
              <div className="fm__head"><h2>{`Delete ${killing.name}?`}</h2></div>
              <div className="fm__body">
                <p className="pjw-drop__say">
                  {n === 0
                    ? 'It has nothing in it. The project is removed and nothing else changes.'
                    : `Its ${n} ${n === 1 ? 'capture and its files go' : 'captures and their files go'} with it. This cannot be undone.`}
                </p>
              </div>
              <div className="fm__foot">
                <span className="fm__spacer" />
                <button className="fm__cancel" onClick={() => setKilling(null)}>Cancel</button>
                <button
                  className="fm__submit fm__submit--bad"
                  onClick={() => { deleteProject(killing.id); setPick((was) => was.filter((id) => id !== killing.id)); setKilling(null); }}
                >
                  Delete project
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {openItem && (
        <CapturePanel
          key={openItem.id}
          item={openItem}
          projects={projects}
          asked={asked}
          onClose={() => setOpen(null)}
          onGenerate={() => { setOpen(null); runGen([openItem]); }}
          onMove={(toId) => run(async () => { setOpen(null); await moveSession(openItem.projectId, toId, openItem.memberIds); })}
          onDelete={() => { setSel([openItem.id]); setOpen(null); setDropping(true); }}
          onAddDetail={() => { const r = resumeOf(openItem); if (r) { setOpen(null); setResuming(r); } }}
        />
      )}
      {resuming && (
        <CaptureChat
          modal
          resume={resuming}
          presetProjectId={resuming.projectId}
          askMedia={false}
          // its earlier questions count; room for two more follow-ups
          maxQuestions={(resuming.turns || []).filter((t) => t.role === 'assistant').length + 2}
          onExit={() => setResuming(null)}
        />
      )}
    </div>
  );
}
