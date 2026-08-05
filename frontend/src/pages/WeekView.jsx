/*
 * WeekView — complete content for one plan's seven-day route.
 *
 * Day rail → IG preview + Slides list (default) / Caption / Why / Notes.
 * Opening a slide shows the Text | Image detail editor; × closes back to
 * the list. Edits persist via PATCH /routes/:id/day/:index.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Glyph from '../components/Glyph';
import YourAnalysisModal from '../components/YourAnalysisModal';
import ConnectMetaModal from '../components/ConnectMetaModal';
import { markDayPublished, updateDayContent, generateRoute } from '../api/routes';
import { getMetaStatus, publishDayToMeta } from '../api/meta';
import { useProjects, uploadFiles } from '../lib/projectsStore';
import { CaptureChat } from './Projects';
import { LAYOUTS } from '../lib/visualbrand';
import './weekView.css';

// Hook-family layouts from the Visual Brand layout system (H1 full-bleed,
// H2 split, H3 statement). The Hook slide is composed with one of these.
const HOOK_LAYOUTS = LAYOUTS.filter((l) => l.group === 'hook');
const DEFAULT_HOOK_LAYOUT = 'H1';
const layoutById = (id) => HOOK_LAYOUTS.find((l) => l.id === id) || HOOK_LAYOUTS[0];

const FORMAT_ICON = { Reel: 'play', Carousel: 'copy', Post: 'image', Story: 'book-open' };
const SLIDE_ROLES = {
  Carousel: ['Hook', 'Setup', 'Process', 'Process', 'Result', 'CTA'],
  Reel: ['Hook', 'Setup', 'CTA'],
  Story: ['Hook', 'Beat', 'CTA'],
  Post: ['Hook', 'CTA'],
};
const TABS = ['Content', 'Image', 'Caption', 'Why this post'];

const TEXT_SUGGESTIONS = [
  { id: 'sharpen', label: 'Sharpen the opening', hint: 'Cut to the point sooner.', icon: 'sparkles' },
  { id: 'shorter', label: 'Make it shorter', hint: 'Make it punchier.', icon: 'scissors' },
];

function shortDay(day) {
  return String(day || '').slice(0, 3);
}

function dayDateLabel(day) {
  if (!day?.dateLabel) return day?.day || '';
  return `${day.day}, ${day.dateLabel}`;
}

function collectProjectImages(projects) {
  const images = [];
  for (const p of projects || []) {
    for (const e of p.captures || []) {
      for (const a of e.attachments || []) {
        if (a.type === 'image' && (a.url || a.thumbnailUrl)) {
          images.push({
            key: a.key,
            url: a.url || a.thumbnailUrl,
            thumb: a.thumbnailUrl || a.url,
            projectName: p.name,
            note: e.text || '',
          });
        }
      }
    }
  }
  return images;
}

function deriveSlides(day) {
  const roles = SLIDE_ROLES[day.format] || SLIDE_ROLES.Post;
  const existing = day.content?.slides;
  if (Array.isArray(existing) && existing.length) {
    return existing.map((s, i) => ({
      role: s.role || roles[Math.min(i, roles.length - 1)],
      title: s.title || '',
      assetKey: s.assetKey || '',
      layout: s.layout || '',
    }));
  }
  const texts = (day.content?.onScreenText || []).filter(Boolean);
  if (texts.length) {
    return texts.map((t, i) => ({
      role: roles[Math.min(i, roles.length - 1)],
      title: t,
      assetKey: '',
    }));
  }
  const base = [{ role: 'Hook', title: day.title || day.direction || 'Open strong', assetKey: '' }];
  if (day.format === 'Carousel') {
    base.push(
      { role: 'Setup', title: 'Set the context', assetKey: '' },
      { role: 'Process', title: 'Show the work in progress', assetKey: '' },
      { role: 'Result', title: 'The finished outcome', assetKey: '' },
    );
  } else if (day.format === 'Reel' || day.format === 'Story') {
    base.push({ role: 'Setup', title: day.direction || 'The beat in the middle', assetKey: '' });
  }
  base.push({ role: 'CTA', title: day.content?.cta || 'Invite them to enquire', assetKey: '' });
  return base;
}

/** Resolve slides to images. Explicit assetKey = owned; auto-fill = standing-in. */
function bindSlidesToAssets(slides, dayIndex, allImages, localMedia) {
  const byKey = new Map(allImages.map((img) => [img.key, img]));
  Object.entries(localMedia || {}).forEach(([key, url]) => {
    if (!byKey.has(key)) byKey.set(key, { key, url, thumb: url, projectName: 'Uploaded', note: '' });
  });

  const used = new Set();
  const bound = slides.map((s) => {
    if (!s.assetKey) return { ...s, image: null, standing: false };
    const hit = byKey.get(s.assetKey) || null;
    if (hit) used.add(hit.key);
    return { ...s, image: hit, standing: false };
  });

  const pool = allImages.filter((img) => !used.has(img.key));
  let cursor = (dayIndex * 3) % Math.max(pool.length, 1);
  return bound.map((s) => {
    if (s.image || !pool.length) return s;
    const img = pool[cursor % pool.length];
    cursor += 1;
    return { ...s, image: img, standing: true };
  });
}

function dayAssetStatus(slides, published) {
  if (published) return { label: 'Published', kind: 'done', icon: 'check-circle-2' };
  const missing = slides.some((s) => !s.assetKey || s.standing);
  if (missing) return { label: 'Needs image', kind: 'need', icon: 'alert-circle' };
  return { label: 'Ready', kind: 'ready', icon: 'check' };
}

function rewriteText(current, kind, custom) {
  const text = String(current || '').trim();
  if (kind === 'sharpen') {
    const cut = text.split(/[.!?—–]/)[0]?.trim() || text;
    return cut.length > 48 ? `${cut.slice(0, 45).trim()}…` : cut;
  }
  if (kind === 'shorter') {
    const words = text.split(/\s+/);
    if (words.length <= 5) return text;
    return words.slice(0, 5).join(' ');
  }
  if (kind === 'custom' && custom) {
    const q = custom.toLowerCase();
    if (q.includes('shorter') || q.includes('punch')) return rewriteText(text, 'shorter');
    if (q.includes('sharpen') || q.includes('opening') || q.includes('cut')) return rewriteText(text, 'sharpen');
    if (q.startsWith('add ')) return `${text} ${custom.slice(4).trim()}`.trim();
    if (q.startsWith('replace with ')) return custom.slice('replace with '.length).trim();
    // Treat freeform as the new line when it looks like copy, else append.
    if (custom.length <= 80 && !q.includes('make') && !q.includes('change')) return custom.trim();
    return text;
  }
  return text;
}

function slidesPayload(slides) {
  return slides.map((s) => ({
    role: s.role || '',
    title: s.title || '',
    assetKey: s.assetKey || '',
    layout: s.layout || '',
  }));
}

function buildMarkdown(route) {
  const lines = [`# Your week — ${route.weekLabel}`, `Focus: ${route.focus?.headline || ''}`, ''];
  (route.days || []).forEach((d) => {
    lines.push(`## ${d.day}${d.dateLabel ? ` (${d.dateLabel})` : ''} · ${d.format} · ${d.contentType}`);
    if (d.title) lines.push(`Title: ${d.title}`);
    const slides = d.content?.slides?.length ? d.content.slides : (d.content?.onScreenText || []).map((t) => ({ title: t }));
    if (slides.length) {
      lines.push('', 'Slides:');
      slides.forEach((s, i) => lines.push(`  ${i + 1}. [${s.role || 'Slide'}] ${s.title || ''}`));
    }
    if (d.content?.caption) lines.push('', 'Caption:', d.content.caption);
    if (d.content?.strategy) lines.push('', `Why: ${d.content.strategy}`);
    if (d.content?.notes || d.content?.plan) lines.push('', `Notes: ${d.content.notes || d.content.plan}`);
    lines.push('', '---', '');
  });
  return lines.join('\n');
}

// Compose the Hook slide the way its chosen layout says to — full-bleed (line
// on the photo), split (words beside the photo) or statement (words on a
// ground, no photo). Mirrors the Visual Brand layout previews (LayoutSystem).
function HookMedia({ slide, layoutId, contentType }) {
  const shape = layoutById(layoutId).shape; // 'bleed' | 'split' | 'poster'
  const head = slide?.title || 'Your hook line';
  const eyebrow = contentType || '';
  const img = slide?.image?.url || null;

  if (shape === 'poster') {
    return (
      <div className="wv-hook wv-hook--poster">
        <div className="wv-hook__words">
          {eyebrow && <span className="wv-hook__eyebrow">{eyebrow}</span>}
          <p className="wv-hook__head">{head}</p>
        </div>
      </div>
    );
  }
  if (shape === 'split') {
    return (
      <div className="wv-hook wv-hook--split">
        <div className="wv-hook__words">
          {eyebrow && <span className="wv-hook__eyebrow">{eyebrow}</span>}
          <p className="wv-hook__head">{head}</p>
        </div>
        <div className="wv-hook__photo">
          {img ? <img src={img} alt="" /> : <div className="wv-hook__empty"><Glyph name="image" size={22} /></div>}
        </div>
      </div>
    );
  }
  // bleed (default) — the line sits on the photograph, bottom-left
  return (
    <div className="wv-hook wv-hook--bleed">
      {img
        ? <img className="wv-hook__bg" src={img} alt="" />
        : <div className="wv-hook__empty"><Glyph name="image" size={28} /><span>Needs image</span></div>}
      <span className="wv-hook__scrim" />
      <div className="wv-hook__words is-on-photo">
        {eyebrow && <span className="wv-hook__eyebrow">{eyebrow}</span>}
        <p className="wv-hook__head">{head}</p>
      </div>
    </div>
  );
}

export default function WeekView({ route: initialRoute, onBack, onRegenerate, generating }) {
  const navigate = useNavigate();
  const projects = useProjects();
  const [capturing, setCapturing] = useState(false);
  const [route, setRoute] = useState(initialRoute);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState('Content');
  const [slideIdx, setSlideIdx] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false); // false = slides list (default)
  const [mode, setMode] = useState('text'); // 'text' | 'image'
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [listDraft, setListDraft] = useState(null); // { i, text } inline list edit
  const [menuIdx, setMenuIdx] = useState(null);
  const [ask, setAsk] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [metaStatus, setMetaStatus] = useState({ connected: false, configured: false });
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState('');
  const [localMedia, setLocalMedia] = useState({});
  const fileRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    getMetaStatus()
      .then(setMetaStatus)
      .catch(() => setMetaStatus({ connected: false, configured: false }));
  }, []);

  const allImages = useMemo(() => collectProjectImages(projects), [projects]);
  const days = route?.days || [];
  const day = days[selected] || days[0];

  const enrichedDays = useMemo(
    () =>
      days.map((d, i) => {
        const slides = bindSlidesToAssets(deriveSlides(d), i, allImages, localMedia);
        return { ...d, slides, status: dayAssetStatus(slides, d.published) };
      }),
    [days, allImages, localMedia],
  );

  const enriched = enrichedDays[selected] || enrichedDays[0];
  const slides = enriched?.slides || [];
  const safeIdx = Math.min(slideIdx, Math.max(slides.length - 1, 0));
  const activeSlide = slides[safeIdx] || null;
  const handle = route?.instagramUsername || 'your.studio';

  useEffect(() => {
    setDraftText(activeSlide?.title || '');
    setEditing(false);
    setAsk('');
  }, [selected, safeIdx, activeSlide?.title]);

  useEffect(() => {
    if (editing && textRef.current) textRef.current.focus();
  }, [editing]);

  function selectDay(i) {
    setSelected(i);
    setSlideIdx(0);
    setTab('Content');
    setDetailOpen(false);
    setMode('text');
    setPickerOpen(false);
    setMenuIdx(null);
    setListDraft(null);
  }

  function closeDetail() {
    setDetailOpen(false);
    setEditing(false);
    setPickerOpen(false);
    setAsk('');
  }

  useEffect(() => {
    if (!detailOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') closeDetail();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailOpen]);

  function openDetail(i, nextMode = 'text') {
    setSlideIdx(i);
    setMode(nextMode);
    setDetailOpen(true);
    setPickerOpen(false);
    setMenuIdx(null);
    setListDraft(null);
  }

  async function persistSlides(nextSlides) {
    if (!route?._id) return;
    setSaving(true);
    try {
      const updated = await updateDayContent(route._id, selected, { slides: slidesPayload(nextSlides) });
      setRoute(updated);
    } catch { /* keep local until retry */ }
    finally { setSaving(false); }
  }

  function replaceSlides(next) {
    setRoute((prev) => {
      const daysCopy = [...(prev.days || [])];
      const d = { ...daysCopy[selected] };
      const content = { ...(d.content || {}), slides: slidesPayload(next), onScreenText: next.map((s) => s.title) };
      daysCopy[selected] = { ...d, content };
      return { ...prev, days: daysCopy };
    });
    persistSlides(next);
  }

  function patchActiveSlide(patch) {
    const base = deriveSlides(day);
    const next = base.map((s, i) => (i === safeIdx ? { ...s, ...patch } : s));
    replaceSlides(next);
  }

  function patchSlideAt(index, patch) {
    const base = deriveSlides(day);
    const next = base.map((s, i) => (i === index ? { ...s, ...patch } : s));
    replaceSlides(next);
  }

  function addSlide() {
    const roles = SLIDE_ROLES[day.format] || SLIDE_ROLES.Post;
    const base = deriveSlides(day);
    const role = roles[Math.min(base.length, roles.length - 1)] || 'Slide';
    const next = [...base, { role, title: '', assetKey: '' }];
    replaceSlides(next);
    setSlideIdx(next.length - 1);
  }

  function removeSlide(index) {
    const base = deriveSlides(day);
    if (base.length <= 1) return;
    const next = base.filter((_, i) => i !== index);
    replaceSlides(next);
    setMenuIdx(null);
    setSlideIdx((cur) => Math.min(cur, next.length - 1));
    if (detailOpen && index === safeIdx) closeDetail();
  }

  function applyText(nextTitle) {
    setDraftText(nextTitle);
    patchActiveSlide({ title: nextTitle });
    setEditing(false);
  }

  function clearText() {
    applyText('');
  }

  function onAskSubmit(e) {
    e.preventDefault();
    if (!ask.trim()) return;
    if (mode === 'text') {
      applyText(rewriteText(draftText || activeSlide?.title, 'custom', ask.trim()));
    }
    setAsk('');
  }

  async function onUploadFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setUploading(true);
    try {
      const added = await uploadFiles(list);
      const first = added[0];
      if (!first) return;
      setLocalMedia((m) => ({ ...m, [first.key]: first.url }));
      patchActiveSlide({ assetKey: first.key });
      setPickerOpen(false);
    } catch { /* ignore */ }
    finally { setUploading(false); }
  }

  function pickProjectImage(img) {
    patchActiveSlide({ assetKey: img.key });
    setPickerOpen(false);
  }

  function claimStandingImage() {
    if (activeSlide?.image?.key) {
      patchActiveSlide({ assetKey: activeSlide.image.key });
    } else {
      setPickerOpen(true);
    }
  }

  async function markPublishedManually() {
    setConnectOpen(false);
    if (!route || day?.published) return;
    try {
      setRoute(await markDayPublished(route._id, selected, true));
      setPublishMsg('Marked as published');
    } catch { /* ignore */ }
  }

  async function handlePublish() {
    if (!route || !day || publishing) return;
    setPublishMsg('');

    if (day.published) {
      // Allow unpublish locally
      try {
        setRoute(await markDayPublished(route._id, selected, false));
        setPublishMsg('');
      } catch { /* ignore */ }
      return;
    }

    if (!metaStatus.connected) {
      setConnectOpen(true);
      return;
    }

    setPublishing(true);
    try {
      // Publish the images actually shown for the day — owned photos and the
      // "standing-in" ones the app auto-filled (both are the user's project
      // media, keyed by S3 key). The backend re-presigns each key server-side.
      const imageKeys = slides.map((s) => s.assetKey || s.image?.key).filter(Boolean);
      const result = await publishDayToMeta(route._id, selected, { imageKeys });
      if (result.route) setRoute(result.route);
      setPublishMsg(result.live ? 'Posted to Instagram' : (result.message || 'Published'));
    } catch (err) {
      if (err.response?.data?.code === 'META_NOT_CONNECTED') {
        setMetaStatus((s) => ({ ...s, connected: false }));
        setConnectOpen(true);
      } else {
        setPublishMsg(err.response?.data?.message || 'Could not publish just now');
      }
    } finally {
      setPublishing(false);
    }
  }

  function handleExport() {
    if (!route) return;
    const blob = new Blob([buildMarkdown(route)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `your-week-${(route.weekLabel || 'plan').replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Rebuild the running week directly from the latest signals — Brand DNA, the
  // studio's Capture Idea notes, the content-pillar (D/C/T) gap, project assets
  // and competitor cohort insights. This regenerates server-side and replaces
  // the current week's plan, so it's guarded by a confirm (any manual edits to
  // the current plan are overwritten). Unlike "Plan again", it skips the
  // check-in conversation and rebuilds in place.
  async function handleRebuild() {
    if (rebuilding || generating) return;
    const ok = window.confirm(
      "Rebuild this week's plan from your latest signals — your Brand DNA, Capture Idea notes, the content-pillar gap, project assets and competitor insights?\n\nThis replaces the current plan and any edits you've made to it."
    );
    if (!ok) return;
    setRebuilding(true);
    setRebuildMsg('');
    try {
      const fresh = await generateRoute();
      if (fresh) {
        setRoute(fresh);
        setSelected(0);
        setSlideIdx(0);
        setDetailOpen(false);
        setEditing(false);
      }
    } catch {
      setRebuildMsg('Could not rebuild the plan. Try again in a moment.');
    } finally {
      setRebuilding(false);
    }
  }

  const formatMeta = day
    ? `${day.contentType || 'Post'} | ${day.format}${
        slides.length > 1 ? ` (${slides.length} slides)` : ''
      }`
    : '';

  const hasOwnImage = Boolean(activeSlide?.assetKey && !activeSlide?.standing && activeSlide?.image);
  const isHook = activeSlide?.role === 'Hook';
  const hookLayout = activeSlide?.layout || DEFAULT_HOOK_LAYOUT;

  return (
    <div className="wv">
      <div className="wv-topbar">
        <button type="button" className="wv-back" onClick={onBack}>
          <Glyph name="arrow-left" size={15} />Your plans
        </button>
        <button type="button" className="wv-capture" onClick={() => setCapturing(true)}>
          <Glyph name="plus" size={15} strokeWidth={2.5} />Capture idea
        </button>
      </div>

      {capturing && (
        <CaptureChat
          defaultProjectId={projects[0]?.id}
          exitLabel="Back to plan"
          onExit={() => setCapturing(false)}
          onViewProject={() => { setCapturing(false); navigate('/dashboard/projects'); }}
        />
      )}

      <div className="wv-head">
        <div className="wv-head__meta">
          <h1 className="wv-head__title">{route.focus?.headline || 'Your week'}</h1>
          <span className="wv-head__chip">
            <Glyph name="calendar" size={14} />{route.weekLabel}
          </span>
          {saving && <span className="wv-head__chip">Saving…</span>}
          {rebuilding && <span className="wv-head__chip">Rebuilding from your signals…</span>}
          {rebuildMsg && <span className="wv-head__chip" style={{ color: 'var(--negative)' }}>{rebuildMsg}</span>}
        </div>
        <div className="wv-actions">
          <button type="button" className="wv-btn" onClick={() => setAnalysisOpen(true)}>
            <Glyph name="bar-chart-2" size={15} />Your analysis
          </button>
          <button type="button" className="wv-btn" onClick={handleExport}>
            <Glyph name="download" size={15} />Export
          </button>
          <button type="button" className="wv-btn" onClick={onRegenerate} disabled={generating || rebuilding}>
            <Glyph name="refresh-cw" size={15} />{generating ? 'Planning…' : 'Plan again'}
          </button>
          <button
            type="button"
            className="wv-btn wv-btn--rebuild"
            onClick={handleRebuild}
            disabled={rebuilding || generating}
            title="Regenerate this week from your Brand DNA, Capture Idea notes, content-pillar gap, project assets and competitor insights."
          >
            <Glyph name="sparkles" size={15} />{rebuilding ? 'Rebuilding…' : 'Rebuild plan'}
          </button>
        </div>
      </div>

      {analysisOpen && (
        <YourAnalysisModal
          username={route?.instagramUsername}
          onClose={() => setAnalysisOpen(false)}
        />
      )}

      {connectOpen && (
        <ConnectMetaModal
          configured={metaStatus.configured}
          onClose={() => setConnectOpen(false)}
          onMarkManually={markPublishedManually}
          onConnected={(status) => {
            setMetaStatus(status);
            setConnectOpen(false);
          }}
        />
      )}

      <div className="wv-rail">
        {enrichedDays.map((d, i) => {
          const active = i === selected;
          const st = d.status;
          return (
            <button
              key={`${d.day}-${i}`}
              type="button"
              className={`wv-day${active ? ' is-active' : ''}`}
              onClick={() => selectDay(i)}
            >
              <div className="wv-day__top">
                <span className="wv-day__label">
                  {shortDay(d.day)} {String(d.dateLabel || '').replace(/^[A-Za-z]+\s/, '') || ''}
                </span>
              </div>
              <span className="wv-day__type">{d.contentType || d.format}</span>
              <span className="wv-day__icon">
                <Glyph name={FORMAT_ICON[d.format] || 'image'} size={16} />
              </span>
              <span className={`wv-day__status is-${st.kind}`}>
                <Glyph name={st.icon} size={12} />
                {st.label}
              </span>
            </button>
          );
        })}
      </div>

      {day && (
        <>
          <div className="wv-dayhead">
            <h2 className="wv-dayhead__date">{dayDateLabel(day)}</h2>
            <span className="wv-dayhead__meta">{formatMeta}</span>
          </div>

          <div className="wv-studio">
            <div className="wv-slides" role="tablist" aria-label="Slides">
              {slides.map((s, i) => (
                <button
                  key={`${s.role}-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === safeIdx}
                  className={`wv-slide${i === safeIdx ? ' is-on' : ''}`}
                  onClick={() => { setSlideIdx(i); setPickerOpen(false); }}
                >
                  <span className="wv-slide__thumb">
                    {s.image?.thumb
                      ? <img src={s.image.thumb} alt="" />
                      : <Glyph name="image" size={18} />}
                    <span className="wv-slide__num">{i + 1}</span>
                    {s.title && <span className="wv-slide__cap">{s.title}</span>}
                  </span>
                </button>
              ))}
              <button type="button" className="wv-slide wv-slide--add" onClick={addSlide} aria-label="Add slide">
                <span className="wv-slide__thumb wv-slide__thumb--add"><Glyph name="plus" size={18} /></span>
                <span className="wv-slide__addlabel">Add slide</span>
              </button>
            </div>

            <article className="wv-ig">
              <header className="wv-ig__head">
                <span className="wv-ig__avatar">
                  {allImages[0]?.thumb
                    ? <img src={allImages[0].thumb} alt="" />
                    : <Glyph name="user" size={15} />}
                </span>
                <span className="wv-ig__user">{handle}</span>
                <span className="wv-ig__format">
                  <Glyph name={FORMAT_ICON[day.format] || 'image'} size={12} />{day.format}
                </span>
                {metaStatus.connected ? (
                  <span className="wv-ig__meta is-on">
                    <Glyph name="check" size={12} />{metaStatus.igUsername ? `@${metaStatus.igUsername}` : 'Connected'}
                  </span>
                ) : (
                  <button type="button" className="wv-ig__connect" onClick={() => setConnectOpen(true)}>
                    <Glyph name="instagram" size={13} />Connect to Meta
                  </button>
                )}
              </header>
              <div className="wv-ig__photo">
                {isHook ? (
                  <HookMedia slide={activeSlide} layoutId={hookLayout} contentType={day.contentType || day.format} />
                ) : (
                  <>
                    {activeSlide?.image?.url ? (
                      <img src={activeSlide.image.url} alt="" />
                    ) : (
                      <div className="wv-ig__empty">
                        <Glyph name="image" size={28} />
                        <span>Needs image</span>
                      </div>
                    )}
                    {(activeSlide?.title || day.title) && (
                      <div className="wv-ig__overlay">
                        <span className="wv-ig__badge">{day.contentType || day.format}</span>
                        <p className="wv-ig__hook">{activeSlide?.title || day.title}</p>
                      </div>
                    )}
                  </>
                )}
                {slides.length > 1 && (
                  <span className="wv-ig__count">{safeIdx + 1}/{slides.length}</span>
                )}
                {slides.length > 1 && (
                  <div className="wv-ig__dots" aria-hidden="true">
                    {slides.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`wv-ig__dot${i === safeIdx ? ' is-active' : ''}`}
                        onClick={() => setSlideIdx(i)}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="wv-ig__caption">
                <b>{handle}</b>{' '}
                {(day.content?.caption || day.direction || '').slice(0, 220)}
                {(day.content?.caption || '').length > 220 ? '…' : ''}
              </div>
              <div className="wv-ig__publish">
                <button
                  type="button"
                  className={`wv-publish${day.published ? ' is-done' : ''}`}
                  onClick={handlePublish}
                  disabled={publishing}
                >
                  <Glyph name={day.published ? 'check-circle-2' : 'send'} size={15} />
                  {publishing ? 'Publishing…' : day.published ? 'Published' : 'Publish'}
                </button>
                {metaStatus.connected && metaStatus.igUsername && !day.published && (
                  <span className="wv-publish__hint">to @{metaStatus.igUsername}</span>
                )}
                {!metaStatus.connected && !day.published && (
                  <span className="wv-publish__hint">Connect Meta to post</span>
                )}
                {publishMsg && <span className="wv-publish__msg">{publishMsg}</span>}
              </div>
            </article>

            <div className="wv-detail">
              <div className="wv-tabs" role="tablist" aria-label="Post detail">
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    className={`wv-tab${tab === t ? ' is-on' : ''}`}
                    onClick={() => { setTab(t); setPickerOpen(false); }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {tab === 'Content' && (
                <div className="wv-pane">
                  <div className="wv-sec">
                    <span className="wv-sec__label">Words on this slide</span>
                    <div className="wv-textcard">
                      {editing ? (
                        <textarea
                          ref={textRef}
                          className="wv-textcard__input"
                          rows={3}
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          onBlur={() => applyText(draftText)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              applyText(draftText);
                            }
                            if (e.key === 'Escape') {
                              setDraftText(activeSlide?.title || '');
                              setEditing(false);
                            }
                          }}
                        />
                      ) : (
                        <button type="button" className="wv-textcard__body" onClick={() => setEditing(true)}>
                          {activeSlide?.title || <span className="wv-muted">Add on-slide text…</span>}
                        </button>
                      )}
                      <div className="wv-textcard__actions">
                        <button type="button" className="wv-iconbtn" aria-label="Edit text" onClick={() => setEditing(true)}>
                          <Glyph name="pencil" size={14} />
                        </button>
                        {activeSlide?.title && (
                          <button type="button" className="wv-iconbtn" aria-label="Clear text" onClick={clearText}>
                            <Glyph name="x" size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="wv-suggest">
                    <span className="wv-suggest__label">Suggested edits</span>
                    <div className="wv-suggest__row">
                      {TEXT_SUGGESTIONS.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="wv-suggest__chip"
                          onClick={() => applyText(rewriteText(activeSlide?.title, s.id))}
                        >
                          <Glyph name={s.icon} size={14} />
                          <span>
                            <b>{s.label}</b>
                            <small>{s.hint}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <form className="wv-ask" onSubmit={onAskSubmit}>
                    <input
                      value={ask}
                      onChange={(e) => setAsk(e.target.value)}
                      placeholder="Change these words — e.g. 'add another line'"
                    />
                    <button type="submit" className="wv-ask__go" aria-label="Apply" disabled={!ask.trim()}>
                      <Glyph name="arrow-up" size={16} />
                    </button>
                  </form>

                  {slides.length > 1 && (
                    <button type="button" className="wv-remove" onClick={() => removeSlide(safeIdx)}>
                      <Glyph name="trash-2" size={14} />Remove this slide
                    </button>
                  )}
                </div>
              )}

              {tab === 'Image' && (
                <div className="wv-pane">
                  {isHook && (
                    <div className="wv-sec">
                      <span className="wv-sec__label">Which layout should this slide take?</span>
                      <div className="wv-layouts">
                        {HOOK_LAYOUTS.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            className={`wv-layout${hookLayout === l.id ? ' is-on' : ''}`}
                            onClick={() => patchActiveSlide({ layout: l.id })}
                            title={l.when}
                          >
                            <span className={`wv-layout__shape wv-layout__shape--${l.shape}`} aria-hidden="true" />
                            <span className="wv-layout__name">{l.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasOwnImage ? (
                    <>
                      <div className="wv-imgprev">
                        <img src={activeSlide.image.url} alt="" />
                      </div>
                      <div className="wv-imgacts">
                        <label className={`wv-run wv-run--primary${uploading ? ' is-busy' : ''}`}>
                          <Glyph name="upload" size={16} />
                          {uploading ? 'Uploading…' : 'Replace image'}
                          <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            hidden
                            disabled={uploading}
                            onChange={(e) => { onUploadFiles(e.target.files || []); e.target.value = ''; }}
                          />
                        </label>
                        <button type="button" className="wv-run wv-run--ghost" onClick={() => patchActiveSlide({ assetKey: '' })}>
                          <Glyph name="trash-2" size={16} />Remove image
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="wv-empty">
                      <div className="wv-empty__visual">
                        {isHook ? (
                          <HookMedia slide={activeSlide} layoutId={hookLayout} contentType={day.contentType || day.format} />
                        ) : activeSlide?.image?.url ? (
                          <img src={activeSlide.image.url} alt="" />
                        ) : (
                          <div className="wv-empty__ph"><Glyph name="image" size={30} /></div>
                        )}
                      </div>
                      <h3 className="wv-empty__title">
                        {isHook ? layoutById(hookLayout).name : 'No picture on this slide yet'}
                      </h3>
                      <ul className="wv-empty__points">
                        {(isHook
                          ? [
                              layoutById(hookLayout).when,
                              layoutById(hookLayout).shots === 0
                                ? 'Words only — no photograph needed'
                                : 'Uses one of your photographs',
                            ]
                          : ['Add a picture and Bauhly builds the slide around it.']
                        ).map((t) => (
                          <li key={t}><Glyph name="check" size={14} />{t}</li>
                        ))}
                      </ul>
                      <div className="wv-empty__acts">
                        <label className={`wv-run wv-run--primary${uploading ? ' is-busy' : ''}`}>
                          <Glyph name="upload" size={16} />
                          {uploading ? 'Uploading…' : 'Upload image'}
                          <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            hidden
                            disabled={uploading}
                            onChange={(e) => { onUploadFiles(e.target.files || []); e.target.value = ''; }}
                          />
                        </label>
                        <button type="button" className="wv-run wv-run--ghost" onClick={() => navigate('/dashboard/visual-brand')}>
                          <Glyph name="palette" size={16} />Visual Brand
                        </button>
                      </div>
                    </div>
                  )}

                  {allImages.length > 0 && (
                    <div className="wv-picker">
                      <span className="wv-suggest__label">From your projects</span>
                      <div className="wv-picker__grid">
                        {allImages.slice(0, 24).map((img) => (
                          <button
                            key={img.key}
                            type="button"
                            className={`wv-picker__cell${activeSlide?.assetKey === img.key ? ' is-active' : ''}`}
                            onClick={() => pickProjectImage(img)}
                            title={img.projectName}
                          >
                            <img src={img.thumb} alt="" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {!allImages.length && !hasOwnImage && (
                    <p className="wv-muted" style={{ marginTop: 8 }}>
                      Add photos in Projects, then pick them here — or upload above.
                    </p>
                  )}
                </div>
              )}

              {tab === 'Caption' && (
                <div>
                  <div className="wv-field">
                    <div className="wv-field__label"><Glyph name="message-square" size={13} />Caption</div>
                    <p>{day.content?.caption || '—'}</p>
                  </div>
                  {day.content?.cta && (
                    <div className="wv-field">
                      <div className="wv-field__label"><Glyph name="arrow-up-right" size={13} />Call to action</div>
                      <p>{day.content.cta}</p>
                    </div>
                  )}
                  {day.content?.hashtags?.length > 0 && (
                    <div className="wv-field">
                      <div className="wv-field__label"><Glyph name="hash" size={13} />Hashtags</div>
                      <div className="wv-tags">
                        {day.content.hashtags.map((h) => (
                          <span key={h} className="wv-tag">#{h}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'Why this post' && (
                <div>
                  <div className="wv-field">
                    <div className="wv-field__label"><Glyph name="target" size={13} />Why this post</div>
                    <p>{day.content?.strategy || '—'}</p>
                  </div>
                  {day.direction && (
                    <div className="wv-field">
                      <div className="wv-field__label"><Glyph name="route" size={13} />Direction</div>
                      <p>{day.direction}</p>
                    </div>
                  )}
                  {(day.content?.notes || day.content?.plan) && (
                    <div className="wv-field">
                      <div className="wv-field__label"><Glyph name="clipboard-list" size={13} />Production notes</div>
                      <p>{day.content?.notes || day.content?.plan}</p>
                    </div>
                  )}
                  {day.content?.prompts?.length > 0 && (
                    <div className="wv-field">
                      <div className="wv-field__label"><Glyph name="sparkles" size={13} />Prompts</div>
                      {day.content.prompts.map((p, i) => (
                        <p key={i}>{i + 1}. {p}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="wv-detail__foot">
                <button
                  type="button"
                  className={`wv-btn${day.published ? ' wv-btn--ok' : ' wv-btn--signal'}`}
                  onClick={handlePublish}
                  disabled={publishing}
                >
                  <Glyph name={day.published ? 'check-circle-2' : 'send'} size={15} />
                  {publishing ? 'Publishing…' : day.published ? 'Published' : 'Publish'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
