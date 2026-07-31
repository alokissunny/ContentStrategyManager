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

import React, { useEffect, useState } from 'react';
import Icon from '../brand/Icon';
import {
  useProjects, useProjectsHydrated, createProject, renameProject, deleteProject,
  addEntry, updateEntry, deleteEntry, moveEntry,
  coverOf, groupByWeek, fmtWhen, uploadFiles,
} from '../lib/projectsStore';
import './projects.css';
import './yourweek.css'; /* the shared .empty brand-moment styles */

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
function EntryPanel({ project, entry, week, onClose }) {
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

  const addFiles = async (files) => {
    const added = await uploadFiles(files);
    updateEntry(project.id, entry.id, { attachments: [...atts, ...added] });
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
            <label className="np__add">
              <Icon name="plus" size={20} strokeWidth={2.5} />
              <span>Add</span>
              <input type="file" accept="image/*,video/*" multiple hidden
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

/* ── capture — a streamlined "add a moment" modal ──────────────────────── */
function CaptureModal({ project, onClose }) {
  const [text, setText] = useState('');
  const [atts, setAtts] = useState([]);
  const [busy, setBusy] = useState(false);

  const addFiles = async (files) => {
    setBusy(true);
    try { const added = await uploadFiles(files); setAtts((a) => [...a, ...added]); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!text.trim() && atts.length === 0) return;
    const type = atts.some((a) => a.type === 'video') && !text.trim() ? 'video'
      : atts.length && !text.trim() ? 'photo' : 'note';
    setBusy(true);
    try { await addEntry(project.id, { type, text: text.trim(), attachments: atts }); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="fm-scrim" onClick={onClose} />
      <div className="fm" role="dialog" aria-modal="true" aria-label={`Capture to ${project.name}`}>
        <div className="fm__head">
          <h2>Capture to {project.name}</h2>
          <button className="np__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
        </div>
        <div className="fm__body">
          <label className="fm__field">
            <span className="fm__label">What happened?</span>
            <textarea className="input" rows={4} value={text} autoFocus
              placeholder="e.g. Kitchen after the rewire — client picked the darker oak"
              onChange={(e) => setText(e.target.value)} />
          </label>
          {atts.length > 0 && <MediaStrip attachments={atts} max={6} />}
          <label className="btn btn--tertiary btn--sm" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
            <Icon name="image" size={15} /> Add photos or a clip
            <input type="file" accept="image/*,video/*" multiple hidden
              onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
        <div className="fm__foot">
          <span className="fm__spacer" />
          <button className="fm__cancel" onClick={onClose}>Cancel</button>
          <button className="fm__submit" disabled={busy || (!text.trim() && atts.length === 0)} onClick={save}>Save</button>
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
  const others = projects.filter((p) => p.id !== project.id);
  const groups = groupByWeek(project.captures);
  const openEntry = open && project.captures.find((e) => e.id === open);

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
            <button className="btn btn--primary btn--sm" onClick={() => setCapturing(true)}>
              <Icon name="plus" size={15} strokeWidth={2.5} /> Capture idea
            </button>
          </div>
        </div>

        {project.captures.length === 0 && (
          <p className="pd__empty">Nothing here yet — tap <b>Capture idea</b> to write something down or add a file.</p>
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
        {capturing && <CaptureModal project={project} onClose={() => setCapturing(false)} />}
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
