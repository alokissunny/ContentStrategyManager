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
import { markDayPublished, updateDayContent, replanWeek } from '../api/routes';
import { getMetaStatus, publishDayToMeta } from '../api/meta';
import { createImage } from '../api/images';
import { useProjects, uploadFiles } from '../lib/projectsStore';
import { CaptureChat } from './Projects';
import { styleOf, rolesOf, groundOf } from '../lib/visualbrand';
import { LAYOUTS as LIB_LAYOUTS, SPECIALS, catForRole, shotsOf, needsOf } from '../data/layouts';
import { paintOf } from '../lib/identity';
import { Preview } from './visuallibrary/LayoutArt';
import { useStore } from '../lib/store';
import './weekView.css';

// ── Which layouts a slide can take — drawn straight from the Visual Library ──
// A slide's narrative role maps to ONE library category (`catForRole`): a Hook
// slide offers the Hook layouts, a CTA slide the CTA layouts, Setup/Process the
// Educational ones, and so on. The set is the studio's OWN — the library's
// layouts they have not turned off or removed there, plus any they added — so
// what the Visual Library shows is exactly what this picker offers. "Create
// image" (the GEN special) stands last, on every slide.
const ALL_LIB = [...LIB_LAYOUTS];
function layoutsForSlide(role, store) {
  const off = store?.layoutsOff || {};
  const gone = store?.layoutsGone || {};
  const added = store?.addedLayouts || [];
  const cat = catForRole(role);
  const own = [...added, ...ALL_LIB].filter((l) => !gone[l.id] && !off[l.id] && l.cat === cat);
  return [...own, ...SPECIALS];
}
// "Create image" (GEN) and the annotated photo are the two the picker treats
// specially — one opens the generation chat, the other changes the upload's
// wording — so they are named off the library layout's own fields.
const isGen = (l) => l?.special === 'gen';
const isAnnotate = (l) => l?.kind === 'annotate' || l?.kind === 'annotate-multi';

// The grey band under the carousel says what the chosen layout is — and each
// answer is short. "Create image" is an invitation; an annotated photo lists
// what it will and will not touch; everything else describes the shape.
function layoutPoints(l) {
  if (!l) return ['Add a picture and Bauhly builds the slide around it.'];
  if (isGen(l)) {
    return [
      'Made from your colours, type and references',
      'Nothing is drawn until you ask for it',
      'You see it before it replaces this slide',
    ];
  }
  if (isAnnotate(l)) {
    return [
      'Follows the annotation style in your references',
      'Your photograph is left exactly as it is',
      'Only the marks and the words are made',
      'You review it before it replaces this slide',
    ];
  }
  const shots = shotsOf(l);
  return [
    l.when,
    shots === 0
      ? 'Words only — no photograph needed'
      : `Uses ${shots} of your photograph${shots === 1 ? '' : 's'}`,
    needsOf(l).includes('layout')
      ? 'Type sits on the picture — drawn from your Library references'
      : 'Drawn in your palette and type',
  ];
}

// ── Conversation seeds for the Create image flow (bauhly-v3 `subjectOf`) ──
const SUBJECT_STRIP = /^(the|a|an|your|our|my|this|that|these|those|five|four|three|two|one|\d+)\s+/i;
const IMPERATIVE = /^(save|add|follow|book|tap|swipe|download|read|try|get|see|learn|share|comment|message|dm|subscribe|send|call|visit|click|check|watch|where|how|why|what|when|who)\b/i;
function subjectOf(words) {
  const line = String(words || '').trim().replace(/[.!?…]+$/, '');
  if (!line || IMPERATIVE.test(line)) return '';
  const first = line.split(/[—:;]|\.\s/)[0].trim();
  let out = first;
  for (let i = 0; i < 2; i += 1) out = out.replace(SUBJECT_STRIP, '');
  const forPart = out.match(/\bfor\s+(.+)$/i);
  if (forPart) out = forPart[1];
  out = out.trim();
  const wordCount = out.split(/\s+/).filter(Boolean).length;
  if (wordCount < 2 || wordCount > 5) return '';
  return out.charAt(0).toLowerCase() + out.slice(1);
}
function seedsFor(words, role, projectName) {
  const subject = subjectOf(words);
  if (!subject) {
    return [
      'Design a minimalist cover',
      'Create a background inspired by this project',
      projectName
        ? `Create a material-focused visual from ${projectName}`
        : 'Create a material-focused visual',
    ];
  }
  return [
    `Show ${subject} in a real room`,
    `Compare the right and wrong ${subject}`,
    `Make a simple diagram of ${subject}`,
    role === 'Hook' || role === 'Cover'
      ? `Design a minimalist cover about ${subject}`
      : `Illustrate ${subject} as an educational visual`,
  ];
}

// ── The Create image conversation (bauhly-v3 YourWeek `CreateView`) ──
// Built to read as a chat, because that is what it is: one message from Bauhly,
// a few ways in, a box. The picture is real: the ask (composed with the
// studio's Visual Brand) goes to the backend, which renders it with Gemini
// "nano banana" and stores it. On success `onCreated(key, url)` puts the image
// on the slide, exactly like an upload.
function CreateImageChat({ role, projectName, words, brand, onBack, onCreated }) {
  const [ask, setAsk] = useState('');
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);

  async function send(text) {
    const line = String(text || '').trim();
    if (!line || busy) return;
    setAsk('');
    setBusy(true);
    setThread((t) => [
      ...t,
      { who: 'you', text: line },
      { who: 'bauhly', pending: true, text: 'Working that up in your studio’s style…' },
    ]);

    try {
      const { key, url } = await createImage({ prompt: line, brand });
      setThread((t) => {
        const next = [...t];
        next[next.length - 1] = {
          who: 'bauhly',
          text: 'Here it is — made from your colours and type. Placing it on this slide.',
          image: url,
        };
        return next;
      });
      onCreated?.(key, url);
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        'That didn’t work. Try again in a moment.';
      setThread((t) => {
        const next = [...t];
        next[next.length - 1] = { who: 'bauhly', text: 'I couldn’t make that one.', note: message };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wv-conv">
      <div className="wv-conv__bar">
        <button type="button" className="wv-conv__back" onClick={onBack}>
          <Glyph name="arrow-left" size={15} strokeWidth={2.5} />
          Back to layouts
        </button>
      </div>

      <div className="wv-conv__body">
        <div className="wv-conv__scroll">
          <div className="wv-conv__msg">
            <span className="wv-conv__who"><Glyph name="sparkles" size={14} strokeWidth={2.25} /></span>
            <p>
              Describe the image you’d like to create. I’ll keep it consistent with your
              Visual Brand.
            </p>
          </div>

          {thread.map((m, i) => (
            m.who === 'you' ? (
              <p className="wv-conv__you" key={i}>{m.text}</p>
            ) : (
              <div className="wv-conv__msg" key={i}>
                <span className="wv-conv__who"><Glyph name="sparkles" size={14} strokeWidth={2.25} /></span>
                <div>
                  <p className={m.pending ? 'wv-conv__pending' : undefined}>{m.text}</p>
                  {m.image && <img className="wv-conv__img" src={m.image} alt="" />}
                  {m.note && <p className="wv-conv__note">{m.note}</p>}
                </div>
              </div>
            )
          ))}
        </div>

        {thread.length === 0 && (
          <div className="wv-conv__seeds">
            {seedsFor(words, role, projectName).map((t) => (
              <button type="button" key={t} className="wv-conv__seed" disabled={busy} onClick={() => send(t)}>{t}</button>
            ))}
          </div>
        )}

        <div className="wv-conv__ask">
          <textarea
            className="wv-conv__input"
            rows={1}
            value={ask}
            disabled={busy}
            placeholder="Describe the picture you want…"
            aria-label="Describe the picture you want"
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(ask); }
            }}
          />
          <button
            type="button"
            className="wv-conv__send"
            disabled={!ask.trim() || busy}
            onClick={() => send(ask)}
            aria-label="Send"
          >
            <Glyph name="arrow-up-right" size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

// "Bricolage Grotesque for headlines, Inter for body text." → "Bricolage Grotesque"
function firstFont(fontsStr) {
  const first = String(fontsStr || '').split(',')[0] || '';
  return first.replace(/\s+for\s+.*$/i, '').trim();
}

// The palette / type the studio set on the Visual Brand page, as CSS variables
// the post compositions read (accent, primary type, neutral ground, headline
// face). Falls back to the product defaults when a brand hasn't been set.
function brandStyleVars(store) {
  const style = styleOf(store?.brandStyle);
  const roles = rolesOf(style, null);
  const ground = groundOf(style);
  const head = firstFont(store?.brand?.fonts);
  const vars = {
    '--wv-accent': roles.accent,
    '--wv-primary': roles.primary,
    '--wv-neutral': roles.neutral,
  };
  if (ground.own && ground.url) vars['--wv-ground-img'] = `url(${ground.url})`;
  if (head) vars['--wv-post-font'] = `'${head}', var(--font-display)`;
  return vars;
}

const FORMAT_ICON = { Reel: 'play', Carousel: 'copy', Post: 'image', Story: 'book-open' };
const SLIDE_ROLES = {
  Carousel: ['Hook', 'Setup', 'Process', 'Process', 'Result', 'CTA'],
  Reel: ['Hook', 'Setup', 'CTA'],
  Story: ['Hook', 'Beat', 'CTA'],
  Post: ['Hook', 'CTA'],
};
const TABS = ['Content', 'Image', 'Caption', 'Why this post'];

function fmtTokens(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function fmtCost(usd) {
  if (usd == null || Number.isNaN(Number(usd))) return '—';
  const n = Number(usd);
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function weekUsageOf(route) {
  const u = route?.usage;
  if (!u) return null;
  const inputTokens = Number(u.inputTokens) || 0;
  const outputTokens = Number(u.outputTokens) || 0;
  const totalTokens = Number(u.totalTokens) || inputTokens + outputTokens;
  const estimatedCostUsd = Number(u.estimatedCostUsd) || 0;
  if (!totalTokens && !estimatedCostUsd) return null;
  return { totalTokens, estimatedCostUsd, inputTokens, outputTokens };
}

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

// The searchable text that describes what an image shows — its AI analysis
// (summary, subjects, tags, mood, in-image text) plus the capture note. This is
// what lets a standing-in image be chosen by relevance instead of at random.
function imageKeywords(analysis, note) {
  const a = analysis && analysis.status === 'done' ? analysis : null;
  return [
    a?.summary,
    a?.description,
    ...(a?.subjects || []),
    ...(a?.tags || []),
    a?.mood,
    a?.text,
    note,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
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
            analyzed: a.analysis?.status === 'done',
            keywords: imageKeywords(a.analysis, e.text),
          });
        }
      }
    }
  }
  return images;
}

// Stopword-filtered word set for scoring image relevance against slide text.
const STOP = new Set('the a an and or of to for with in on at from your our this that these those is are be as by it its into out up over under about you we they them their his her out post reel story slide day week content'.split(' '));
function keywordSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
  );
}
// Overlap score between a slide's text and an image's description keywords.
function relevanceScore(slideWords, image) {
  if (!image.keywords) return 0;
  const imgWords = keywordSet(image.keywords);
  let hits = 0;
  slideWords.forEach((w) => { if (imgWords.has(w)) hits += 1; });
  return hits;
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

// Pass 1 — bind each slide's explicit (owned) assetKey to its image and claim
// that key in the shared `used` set, so a later standing-in fill (this day or
// another day of the week) never grabs a photo that a real post owns.
function bindOwnedSlides(slides, allImages, localMedia, used) {
  const byKey = new Map(allImages.map((img) => [img.key, img]));
  Object.entries(localMedia || {}).forEach(([key, url]) => {
    if (!byKey.has(key)) byKey.set(key, { key, url, thumb: url, projectName: 'Uploaded', note: '', keywords: '' });
  });
  return slides.map((s) => {
    if (!s.assetKey) return { ...s, image: null, standing: false };
    const hit = byKey.get(s.assetKey) || null;
    // A duplicate owned key (already claimed elsewhere) is dropped to a standing
    // slot so the image isn't shown twice.
    if (hit && used.has(hit.key)) return { ...s, assetKey: '', image: null, standing: false };
    if (hit) used.add(hit.key);
    return { ...s, image: hit, standing: false };
  });
}


function dayAssetStatus(slides, published) {
  if (published) return { label: 'Published', kind: 'done', icon: 'check-circle-2' };
  // A post is ready once it has at least one assigned image (its lead frame).
  // Text-only slides no longer count as "missing" — images are deliberately not
  // reused to fill every slide, so an imageless slide is expected, not a gap.
  const hasImage = slides.some((s) => s.assetKey && s.image);
  if (!hasImage) return { label: 'Needs image', kind: 'need', icon: 'alert-circle' };
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

// Put the slide's own words (and content type) into the chosen library layout's
// text, so the post preview draws the EXACT composition the studio picked —
// same renderer, same shape as the Image-tab card — with this slide's line in
// it rather than the layout's specimen copy. A live slide carries one line
// (`title`), so it fills the composition's PRIMARY text slot; the layout keeps
// its own supporting copy for the parts a one-line slide cannot fill.
function fillLayout(layout, slide, contentType) {
  if (!layout) return layout;
  const line = (slide?.title || '').trim();
  const art = { ...(layout.art || {}) };
  if (line) {
    if ('head' in art) art.head = line;
    else if ('big' in art) art.body = line; // a number layout — the line captions it
    else if ('a' in art) art.a = line; // a comparison — best effort with one line
    else art.body = line;
    // an accent word would split the studio's line in two
    if ('accent' in art) delete art.accent;
  }
  // the eyebrow is the post's content type, but only where the layout shows one
  if (contentType && 'eyebrow' in art) art.eyebrow = contentType;
  return { ...layout, art };
}

// The post preview IS the chosen Visual Library layout — LayoutArt's own
// `Preview`, the same renderer the Image-tab cards and the Visual Library use.
// The slide's photograph fills the composition's picture slots (mood on); with
// none, the picture regions draw as the empty ground the layout has before a
// photo exists, exactly as the library shows them.
function SlideMedia({ slide, layout, contentType }) {
  if (!layout) {
    return <div className="wv-ig__empty"><Glyph name="image" size={28} /><span>Needs image</span></div>;
  }
  const photo = slide?.image?.url || null;
  const shots = shotsOf(layout);
  const filled = fillLayout(layout, slide, contentType);
  const withPhoto = photo && shots > 0
    ? { ...filled, imgs: Array.from({ length: shots }, () => photo) }
    : filled;
  return (
    <div className="wv-ig__lay">
      <Preview l={withPhoto} mood={Boolean(photo && shots > 0)} />
    </div>
  );
}

export default function WeekView({ route: initialRoute, onBack }) {
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
  const [replanning, setReplanning] = useState(false);
  const [replanMsg, setReplanMsg] = useState('');
  const [localMedia, setLocalMedia] = useState({});
  const [creating, setCreating] = useState(false);
  const fileRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    getMetaStatus()
      .then(setMetaStatus)
      .catch(() => setMetaStatus({ connected: false, configured: false }));
  }, []);

  const allImages = useMemo(() => collectProjectImages(projects), [projects]);
  // Palette + type set on the Visual Brand page, reflected in the post preview.
  const vbStore = useStore();
  const igVars = useMemo(() => brandStyleVars(vbStore), [vbStore]);
  const days = route?.days || [];
  const day = days[selected] || days[0];

  const enrichedDays = useMemo(() => {
    // Render only the images the plan actually assigns (persisted assetKeys). The
    // planner assigns each project photo at most once across the whole month, so
    // there's nothing to invent here — a slide with no assigned photo simply
    // shows no image rather than borrowing (and repeating) one. The shared `used`
    // set additionally drops any duplicate key within the visible week.
    const used = new Set();
    return days.map((d) => {
      const slides = bindOwnedSlides(deriveSlides(d), allImages, localMedia, used);
      return { ...d, slides, status: dayAssetStatus(slides, d.published) };
    });
  }, [days, allImages, localMedia]);

  const enriched = enrichedDays[selected] || enrichedDays[0];
  const slides = enriched?.slides || [];
  const safeIdx = Math.min(slideIdx, Math.max(slides.length - 1, 0));
  const activeSlide = slides[safeIdx] || null;
  const handle = route?.instagramUsername || 'your.studio';

  useEffect(() => {
    setDraftText(activeSlide?.title || '');
    setEditing(false);
    setAsk('');
    setCreating(false);
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

  // A freshly generated image — same path as an upload: give it an instant
  // local URL and persist its S3 key onto the slide, then leave the chat.
  function onImageCreated(key, url) {
    if (!key) return;
    setLocalMedia((m) => ({ ...m, [key]: url }));
    patchActiveSlide({ assetKey: key });
    setCreating(false);
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

  // Replan only this week from the latest signals — Brand DNA, Capture Idea
  // notes, content-pillar gap, project assets, and competitor cohort — keeping
  // the same calendar week and month focus. Sibling weeks are left alone.
  async function handleReplanWeek() {
    if (replanning || !route?._id) return;
    const ok = window.confirm(
      "Replan this week from your latest Brand DNA, Capture Idea notes, content-pillar gap, project assets and competitor insights?\n\nThis replaces this week's plan and any edits you've made to it. Other weeks stay as they are."
    );
    if (!ok) return;
    setReplanning(true);
    setReplanMsg('');
    try {
      const fresh = await replanWeek(route._id, 'replan-week');
      if (fresh) {
        setRoute(fresh);
        setSelected(0);
        setSlideIdx(0);
        setDetailOpen(false);
        setEditing(false);
      }
    } catch (err) {
      setReplanMsg(err?.response?.data?.message || 'Could not replan this week. Try again in a moment.');
    } finally {
      setReplanning(false);
    }
  }

  const formatMeta = day
    ? `${day.contentType || 'Post'} | ${day.format}${
        slides.length > 1 ? ` (${slides.length} slides)` : ''
      }`
    : '';

  const hasOwnImage = Boolean(activeSlide?.assetKey && !activeSlide?.standing && activeSlide?.image);
  const weekUsage = weekUsageOf(route);

  // The layouts this empty slide can take — its own category first, then the
  // "Image only" / "Create image" pair — and a sliding window of three with an
  // arrow at each end (bauhly-v3 YourWeek `EmptySlide`).
  const slideRoleName = activeSlide?.role || 'Hook';
  // The project picker, ranked by how well each photo's described content
  // matches the current slide + day — so the most relevant photos come first
  // instead of raw upload order.
  const pickerImages = useMemo(() => {
    if (!allImages.length) return [];
    const dayText = [day?.title, day?.direction, day?.content?.caption, day?.contentType].filter(Boolean).join(' ');
    const words = keywordSet(`${activeSlide?.title || ''} ${dayText}`);
    return allImages
      .map((img) => ({ img, score: relevanceScore(words, img) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.img);
  }, [allImages, activeSlide?.title, day]);
  const slideLayouts = useMemo(
    () => layoutsForSlide(slideRoleName, vbStore),
    [slideRoleName, vbStore],
  );
  // the studio's palette + faces, so the previews here read exactly as they do
  // in the Visual Library (empty object = the library's shipped defaults)
  const libPaint = useMemo(() => paintOf(vbStore?.libraryEdits), [vbStore?.libraryEdits]);
  const chosenLayout = slideLayouts.find((l) => l.id === activeSlide?.layout) || slideLayouts[0] || null;
  const chosenLayoutIdx = Math.max(0, slideLayouts.findIndex((l) => l.id === chosenLayout?.id));
  const LAY_PER_PAGE = 3;
  const layWinStart = Math.min(
    Math.max(0, chosenLayoutIdx - 1),
    Math.max(0, slideLayouts.length - LAY_PER_PAGE),
  );
  const shownLayouts = slideLayouts.slice(layWinStart, layWinStart + LAY_PER_PAGE);
  const stepLayout = (d) => {
    const next = Math.min(slideLayouts.length - 1, Math.max(0, chosenLayoutIdx + d));
    const l = slideLayouts[next];
    if (l) patchActiveSlide({ layout: l.id });
  };

  return (
    <div className="wv" style={libPaint}>
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
          {replanning && <span className="wv-head__chip">Replanning this week…</span>}
          {replanMsg && <span className="wv-head__chip" style={{ color: 'var(--negative)' }}>{replanMsg}</span>}
        </div>
        <div className="wv-actions">
          <button type="button" className="wv-btn" onClick={() => setAnalysisOpen(true)}>
            <Glyph name="bar-chart-2" size={15} />Your analysis
          </button>
          <button type="button" className="wv-btn" onClick={handleExport}>
            <Glyph name="download" size={15} />Export
          </button>
          <div className="wv-replan">
            <button
              type="button"
              className="wv-btn wv-btn--replan"
              onClick={handleReplanWeek}
              disabled={replanning}
              title="Regenerate only this week from your Brand DNA, Capture Idea notes, content-pillar gap, project assets and competitor insights."
            >
              <Glyph name="refresh-cw" size={15} />{replanning ? 'Replanning…' : 'Replan this week'}
            </button>
            {weekUsage && (
              <p
                className="wv-replan__usage"
                title={`Last plan for this week · ${weekUsage.inputTokens.toLocaleString()} in / ${weekUsage.outputTokens.toLocaleString()} out`}
              >
                <span>{fmtTokens(weekUsage.totalTokens)} tokens</span>
                <span aria-hidden="true">·</span>
                <span>~{fmtCost(weekUsage.estimatedCostUsd)} est.</span>
              </p>
            )}
          </div>
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
                    {s.role && <span className="wv-slide__role">{s.role}</span>}
                    {s.title && <span className="wv-slide__cap">{s.title}</span>}
                  </span>
                </button>
              ))}
              <button type="button" className="wv-slide wv-slide--add" onClick={addSlide} aria-label="Add slide">
                <span className="wv-slide__thumb wv-slide__thumb--add"><Glyph name="plus" size={18} /></span>
                <span className="wv-slide__addlabel">Add slide</span>
              </button>
            </div>

            <article className="wv-ig" style={igVars}>
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
                {/* the post preview composes through the layout chosen in the
                    Image tab — for every slide, so the layout picker actually
                    changes what the post looks like */}
                <SlideMedia
                  slide={activeSlide}
                  layout={chosenLayout}
                  contentType={day.contentType || day.format}
                />
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
                  {/* one hidden file input, shared by Upload / Replace / Create */}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploading}
                    onChange={(e) => { onUploadFiles(e.target.files || []); e.target.value = ''; }}
                  />

                  {creating ? (
                    <CreateImageChat
                      role={slideRoleName}
                      projectName={projects[0]?.name}
                      words={activeSlide?.title}
                      brand={{
                        accent: igVars['--wv-accent'],
                        primary: igVars['--wv-primary'],
                        neutral: igVars['--wv-neutral'],
                        font: firstFont(vbStore?.brand?.fonts),
                      }}
                      onBack={() => setCreating(false)}
                      onCreated={onImageCreated}
                    />
                  ) : (
                    <div className="wv-vis">
                      <span className="wv-sec__label">Which layout should this slide take?</span>

                      {/* the sliding window: three layout cards, an arrow at each end */}
                      <div className="wv-actsrow">
                        <button
                          type="button"
                          className="wv-actsrow__arrow"
                          onClick={() => stepLayout(-1)}
                          disabled={chosenLayoutIdx <= 0}
                          aria-label="Previous layout"
                        >
                          <Glyph name="chevron-left" size={15} strokeWidth={2.5} />
                        </button>
                        <div className="wv-acts" role="radiogroup" aria-label="Which layout should this slide take?">
                          {shownLayouts.map((l) => (
                            <button
                              key={l.id}
                              type="button"
                              role="radio"
                              aria-checked={chosenLayout?.id === l.id}
                              className={`wv-act wv-act--layout${chosenLayout?.id === l.id ? ' is-on' : ''}`}
                              onClick={() => patchActiveSlide({ layout: l.id })}
                              title={l.when}
                            >
                              <span className="wv-act__shot"><Preview l={l} mood={false} /></span>
                              <b>{l.name}</b>
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="wv-actsrow__arrow"
                          onClick={() => stepLayout(1)}
                          disabled={chosenLayoutIdx >= slideLayouts.length - 1}
                          aria-label="Next layout"
                        >
                          <Glyph name="chevron-right" size={15} strokeWidth={2.5} />
                        </button>
                      </div>

                      {/* the chosen layout, in its own band: what it is and one way on */}
                      <div className="wv-sel">
                        <div className="wv-empty wv-empty--band">
                          {/* the chosen layout with THIS slide's image in its
                              placeholder — the same composition as the post
                              preview, so picking a layout or an image is seen
                              here immediately */}
                          <div className="wv-lay__big">
                            {chosenLayout
                              ? <SlideMedia slide={activeSlide} layout={chosenLayout} contentType={day.contentType || day.format} />
                              : <div className="wv-empty__ph"><Glyph name="image" size={30} /></div>}
                          </div>
                          <h3 className="wv-empty__title">
                            {chosenLayout ? chosenLayout.name : 'No picture on this slide yet'}
                          </h3>
                          <ul className="wv-empty__points">
                            {layoutPoints(chosenLayout).map((t) => (
                              <li key={t}><Glyph name="check" size={14} />{t}</li>
                            ))}
                          </ul>
                          {isGen(chosenLayout) ? (
                            /* Create image has one way on — a conversation about a
                               picture that does not exist yet, no door out beside it */
                            <div className="wv-empty__acts">
                              <button type="button" className="wv-run wv-run--primary" onClick={() => setCreating(true)}>
                                <Glyph name="sparkles" size={16} />Start creating
                              </button>
                            </div>
                          ) : (
                            <div className="wv-empty__acts">
                              <button
                                type="button"
                                className={`wv-run wv-run--primary${uploading ? ' is-busy' : ''}`}
                                disabled={uploading}
                                onClick={() => fileRef.current?.click()}
                              >
                                <Glyph name={isAnnotate(chosenLayout) ? 'sparkles' : 'upload'} size={16} />
                                {uploading
                                  ? 'Uploading…'
                                  : hasOwnImage
                                    ? 'Replace image'
                                    : isAnnotate(chosenLayout) ? 'Create' : 'Upload image'}
                              </button>
                              {hasOwnImage ? (
                                <button type="button" className="wv-run wv-run--ghost" onClick={() => patchActiveSlide({ assetKey: '' })}>
                                  <Glyph name="trash-2" size={16} />Remove image
                                </button>
                              ) : (
                                <button type="button" className="wv-run wv-run--ghost" onClick={() => navigate('/dashboard/visual-library')}>
                                  <Glyph name="layout-grid" size={16} />Visual Library
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {!creating && allImages.length > 0 && (
                    <div className="wv-picker">
                      <span className="wv-suggest__label">From your projects</span>
                      <div className="wv-picker__grid">
                        {pickerImages.slice(0, 24).map((img) => (
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

                  {!creating && !allImages.length && !hasOwnImage && (
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
