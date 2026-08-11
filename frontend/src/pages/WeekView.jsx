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
import { createImage, listGeneratedImages } from '../api/images';
import { useProjects, uploadFiles } from '../lib/projectsStore';
import { CaptureChat } from './Projects';
import { styleOf, rolesOf, groundOf } from '../lib/visualbrand';
import { LAYOUTS as LIB_LAYOUTS, CATEGORIES, catForRole, shotsOf } from '../data/layouts';
import { paintOf } from '../lib/identity';
import { Preview } from './visuallibrary/LayoutArt';
import { useStore } from '../lib/store';
import './weekView.css';

// ── Which layouts a slide can take — drawn straight from the Visual Library ──
// A slide's narrative role maps to ONE library category (`catForRole`): a Hook
// slide offers the Hook layouts, a CTA slide the CTA layouts, Setup/Process the
// Educational ones, and so on. The set is the studio's OWN — the library's
// layouts they have not turned off or removed there, plus any they added — so
// what the Visual Library shows is exactly what this picker offers. Generating
// a picture is its own control ("Generate image") beside the carousel, not a
// card in it, so the carousel is only ever real layouts.
const ALL_LIB = [...LIB_LAYOUTS];
function layoutsForSlide(role, store) {
  const off = store?.layoutsOff || {};
  const gone = store?.layoutsGone || {};
  const added = store?.addedLayouts || [];
  const cat = catForRole(role);
  return [...added, ...ALL_LIB].filter((l) => !gone[l.id] && !off[l.id] && l.cat === cat);
}
// the category a layout belongs to, in the studio's words — the small note under
// each card's name
const catLabelOf = (id) => (CATEGORIES.find((c) => c.id === id)?.label || '').toLowerCase();

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
// A topic phrase for the post, kept short — the plan's day title/direction, not
// the whole caption.
function shortTopic(topic) {
  const t = String(topic || '').trim().replace(/[.!?…]+$/, '');
  if (!t) return '';
  const clip = t.split(/[—:;\n]/)[0].trim();
  const w = clip.split(/\s+/);
  return (w.length > 12 ? w.slice(0, 12).join(' ') : clip).toLowerCase();
}

// The account's Visual Mood, distilled to a short style note the renderer can
// honour. There is no vision model here (see lib/refanalysis.js) — the only
// things actually read off the mood board are each picture's light/dark ground
// and its palette, so that is all we claim: the dominant lighting/feel, never a
// guessed "vibe". Returns '' when the studio has set no mood images, so a blank
// mood board simply adds nothing to the prompt.
function moodOf(store) {
  const refs = store?.visualRefs || [];
  if (!refs.length) return '';
  const analysis = store?.refAnalysis || {};
  const grounds = refs.map((r) => analysis[r.id]?.ground).filter(Boolean);
  const dark = grounds.filter((g) => g === 'dark').length;
  const light = grounds.filter((g) => g === 'light').length;
  const n = refs.length;
  const board = `consistent with the studio's mood board of ${n} reference image${n === 1 ? '' : 's'}`;
  if (!grounds.length) return board;
  const tone =
    dark > light
      ? 'dark, moody, low-key natural lighting'
      : 'bright, light and airy with soft natural lighting';
  return `${tone}, ${board}`;
}

// Turn the REAL slide + strategy into a few image directions. Each is a short
// LABEL — the one-liner the studio taps — paired with the full PROMPT that goes
// to the renderer. The prompt is written from the post's own topic, this
// slide's words and its role in the carousel, so the picture belongs to THIS
// post instead of being one of four fixed phrases. Palette, type and Visual
// Mood are added by the caller/back end, so they are not repeated here.
function seedsFor({ words, subtitle, role, topic, contentType, projectName, basePrompt } = {}) {
  const concept = String(words || '').trim().replace(/[.!?…]+$/, '');
  const topicText = shortTopic(topic);
  const subject =
    subjectOf(words) || subjectOf(subtitle) || topicText || (projectName ? projectName.toLowerCase() : '');
  const post = `${(contentType || 'social').toLowerCase()} post`;
  const about = topicText ? ` about ${topicText}` : subject ? ` about ${subject}` : '';
  const carrying = concept ? ` The slide reads "${concept}".` : '';
  const room = subject || topicText || 'this post';

  const photo = {
    key: 'photo',
    label: subject ? `A real-world photo of ${subject}` : 'A real-world photo for this post',
    prompt:
      `A photorealistic, editorial photograph showing ${room} in a real, believable setting. ` +
      `One clear focal subject, natural light, shallow depth of field, and calm negative space where a short caption could sit. ` +
      `It should read as a real moment for a ${post}${projectName ? ` for ${projectName}` : ''}, not a generic stock shot.${carrying}`,
  };
  const compare = {
    key: 'compare',
    label: subject ? `Right vs wrong: ${subject}` : 'A right-vs-wrong comparison',
    prompt:
      `A clean split-frame image contrasting the wrong way and the right way of ${room}. ` +
      `Two balanced halves, clearly distinct through composition, colour and lighting alone (no text or labels), so the difference is obvious at a glance on a phone.${carrying}`,
  };
  const diagram = {
    key: 'diagram',
    label: `A simple diagram of ${subject || topicText || 'this idea'}`,
    prompt:
      `A simple, minimal explanatory illustration of ${room}. ` +
      `Flat vector style, a few clean shapes and icons (no words or labels), lots of whitespace and no clutter — the kind of visual that makes one idea instantly clear.${carrying}`,
  };
  const cover = {
    key: 'cover',
    label: `A minimalist cover for this ${(contentType || 'post').toLowerCase()}`,
    prompt:
      `A minimalist, premium cover image for a ${post}${about}. ` +
      `Lots of calm negative space, one quiet focal element, refined and aspirational. ` +
      `Leave clear room at the top for a short headline${concept ? ` like "${concept}"` : ''}.`,
  };

  const byRole = {
    Hook: [cover, photo, diagram],
    Cover: [cover, photo, diagram],
    Setup: [photo, diagram, compare],
    Process: [diagram, compare, photo],
    Result: [photo, compare, cover],
    CTA: [cover, photo],
  };
  const list = byRole[role] || [photo, compare, diagram, cover];

  // If the strategy wrote a rich base prompt for this slide, lead with it and
  // mark it Recommended — it was built while planning the post, already carries
  // the full context, and the studio only sees a one-liner while the whole base
  // (plus brand + Visual Mood, added later) is what actually sends.
  const base = String(basePrompt || '').trim();
  if (base) {
    return [
      {
        key: 'base',
        label: `This post's planned image${subject ? ` — ${subject}` : ''}`,
        prompt: base,
        recommended: true,
      },
      ...list,
    ];
  }
  return list;
}

// ── The Create image conversation (bauhly-v3 YourWeek `CreateView`) ──
// Built to read as a chat, because that is what it is: one message from Bauhly,
// a few ways in, a box. The picture is real: the ask (composed with the
// studio's Visual Brand) goes to the backend, which renders it with Gemini
// "nano banana" and stores it. On success `onCreated(key, url)` puts the image
// on the slide, exactly like an upload.
function CreateImageChat({ role, projectName, words, subtitle, topic, contentType, basePrompt, brand, onBack, onCreated }) {
  const [ask, setAsk] = useState('');
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const [debugOpen, setDebugOpen] = useState({}); // message index → show full prompt

  const seeds = useMemo(
    () => seedsFor({ words, subtitle, role, topic, contentType, projectName, basePrompt }),
    [words, subtitle, role, topic, contentType, projectName, basePrompt],
  );

  // A free-typed ask is the studio's own words; we send them as written and only
  // add a light one-line note of what post this is for, so a plain "a kitchen"
  // still lands in this post's world. The seed buttons pass their full detailed
  // prompt instead (see `label`/`prompt`), while the studio only sees the label.
  function promptForTyped(line) {
    const t = shortTopic(topic);
    const ctx = [
      contentType ? `${contentType} post` : '',
      t ? `about ${t}` : '',
      projectName ? `for ${projectName}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return ctx ? `${line}\n\n(For a ${ctx}.)` : line;
  }

  // `text` may be a plain string (typed ask) or a seed's detailed prompt. The
  // second arg is what to show in the thread — the studio sees their own words
  // or the seed's one-liner, never the long behind-the-scenes prompt.
  async function send(text, shown) {
    const prompt = String(text || '').trim();
    if (!prompt || busy) return;
    setAsk('');
    setBusy(true);
    setThread((t) => [
      ...t,
      { who: 'you', text: shown || prompt },
      { who: 'bauhly', pending: true, text: 'Working that up in your studio’s style…' },
    ]);

    try {
      const { key, url, finalPrompt, model, addedAt } = await createImage({ prompt, brand });
      setThread((t) => {
        const next = [...t];
        next[next.length - 1] = {
          who: 'bauhly',
          text: 'Here it is — made from your colours and type. Placing it on this slide.',
          image: url,
          // the exact composed text the renderer saw (ask + brand + mood + tail)
          debugPrompt: finalPrompt || prompt,
        };
        return next;
      });
      onCreated?.(key, url, { prompt: finalPrompt || prompt, model, addedAt });
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        'That didn’t work. Try again in a moment.';
      setThread((t) => {
        const next = [...t];
        next[next.length - 1] = {
          who: 'bauhly',
          text: 'I couldn’t make that one.',
          note: message,
          // no server response, so this is what the client SENT — the brand
          // palette/type/mood tail is added server-side and so isn't shown here
          debugPrompt: prompt,
          debugPartial: true,
        };
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
                  {m.debugPrompt && (
                    <div className="wv-conv__dbg">
                      <button
                        type="button"
                        className="wv-conv__dbgbtn"
                        aria-expanded={Boolean(debugOpen[i])}
                        onClick={() => setDebugOpen((o) => ({ ...o, [i]: !o[i] }))}
                      >
                        <Glyph name="bug" size={12} strokeWidth={2} />
                        {debugOpen[i] ? 'Hide prompt' : 'Debug: full prompt'}
                      </button>
                      {debugOpen[i] && (
                        <>
                          {m.debugPartial && (
                            <p className="wv-conv__dbgnote">
                              What was sent — brand palette, type &amp; Visual Mood are appended on the server.
                            </p>
                          )}
                          <pre className="wv-conv__dbgpre">{m.debugPrompt}</pre>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          ))}
        </div>

        {thread.length === 0 && (
          <div className="wv-conv__seeds">
            {seeds.map((s) => (
              <button
                type="button"
                key={s.key}
                className={`wv-conv__seed${s.recommended ? ' is-recommended' : ''}`}
                disabled={busy}
                onClick={() => send(s.prompt, s.label)}
                title={s.label}
              >
                <span className="wv-conv__seedtxt">{s.label}</span>
                {s.recommended && <span className="wv-conv__seedtag">Recommended</span>}
              </button>
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
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(promptForTyped(ask.trim()), ask.trim()); }
            }}
          />
          <button
            type="button"
            className="wv-conv__send"
            disabled={!ask.trim() || busy}
            onClick={() => send(promptForTyped(ask.trim()), ask.trim())}
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
// Content and Image were two tabs over one slide — the words on it and the shape
// they go in — but nobody writes a line without looking at where it lands, so
// they are one pane now (bauhly-v3 decision 559).
const TABS = ['Content & Visual', 'Caption', 'Why this post'];

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
      // the supporting line, written while the plan is built (see the strategy
      // generator). Fills the layout's body slot instead of specimen copy.
      subtitle: s.subtitle || s.body || '',
      // The context-rich base image prompt written while the plan was built.
      // The brand palette/type and Visual Mood are layered on at generation.
      imagePrompt: s.imagePrompt || '',
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
    // Carry the plan-written copy and base image prompt through an edit so a
    // layout/title/image change never wipes them (the server keeps both too).
    subtitle: s.subtitle || '',
    imagePrompt: s.imagePrompt || '',
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
// NEVER the layout's own specimen copy. The preview must show only words the
// studio actually has, so the composition is rebuilt from the slide: its line
// (`title`) fills the headline, its supporting line (`subtitle`, written while
// the plan is built) fills the body, and the post's content type fills the
// eyebrow. Every other slot keeps the layout's STRUCTURE (a list stays a list,
// a number slot stays a number slot) but is emptied of invented words — an
// empty slot is honest; "Almost nobody wants the six weeks in between" is not.
// A two-tone "statement" layout draws its headline in the brand colour with the
// last beat set apart in the accent ink (LayoutArt `Words`: `<em>{accent}</em>`).
// A live slide carries one line, so to keep that treatment we split the line —
// its emphatic tail becomes the accent, the rest stays the head — the same
// "one line, one accent word" shape the layout was designed around. A short
// leading function word rides along with the tail so the accent never reads as a
// dangling article ("Your Portfolio." not "Portfolio.").
const ACCENT_LEAD = new Set([
  'a', 'an', 'the', 'your', 'our', 'my', 'their', 'his', 'her', 'its',
  'to', 'of', 'in', 'on', 'for', 'and', 'at', 'by', 'with', 'no', 'not', 'so',
]);
function splitStatement(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  // too short to split without leaving an empty head — keep it whole, no accent
  if (words.length < 3) return { head: String(text || '').trim(), accent: '' };
  let take = 1;
  const prev = words[words.length - 2].replace(/[^a-z']/gi, '').toLowerCase();
  if (ACCENT_LEAD.has(prev)) take = 2;
  return {
    head: words.slice(0, words.length - take).join(' '),
    accent: words.slice(words.length - take).join(' '),
  };
}

function fillLayout(layout, slide, contentType) {
  if (!layout) return layout;
  const title = (slide?.title || '').trim();
  const sub = (slide?.subtitle || slide?.body || '').trim();
  const src = layout.art || {};
  const has = (k) => k in src;
  const art = {};

  // the headline lands in a real text slot, never in a number/label/list slot
  let accentText = '';
  if (has('head')) {
    if (has('accent') && title) {
      // two-tone statement — keep the accent-ink tail the layout is built around
      const parts = splitStatement(title);
      art.head = parts.head;
      accentText = parts.accent;
    } else {
      art.head = title;
    }
    if (has('body')) art.body = sub;
  } else if (has('body')) {
    art.body = title; // stat / airy / caption — the prose slot carries the line
  } else if (has('a')) {
    art.a = title;
  } else {
    art.head = title;
  }

  // real facts about the post, where the layout has a place for them
  if (has('eyebrow')) art.eyebrow = contentType || '';
  if (has('bodyB')) art.bodyB = '';

  // the accent carries the statement's tail (drawn in the accent ink), or stays
  // blank when the line was too short to split — never the layout's specimen word
  if (has('accent')) art.accent = accentText;
  if (has('big')) art.big = '';
  if (has('b')) art.b = '';
  if (has('items')) art.items = [];
  if (has('itemsA')) art.itemsA = [];
  if (has('itemsB')) art.itemsB = [];
  if (has('labels')) art.labels = [];

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
  const [tab, setTab] = useState('Content & Visual');
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
  const [genImages, setGenImages] = useState([]); // the studio's generated-image library
  const [creating, setCreating] = useState(false);
  const fileRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    getMetaStatus()
      .then(setMetaStatus)
      .catch(() => setMetaStatus({ connected: false, configured: false }));
  }, []);

  // Load the persisted generated images so a slide that points at one still
  // resolves after a tab switch / reload (they aren't project captures, so they
  // don't come through `collectProjectImages`).
  useEffect(() => {
    let alive = true;
    listGeneratedImages()
      .then((imgs) => { if (alive) setGenImages(imgs); })
      .catch(() => { /* leave empty — a fresh session simply has none yet */ });
    return () => { alive = false; };
  }, []);

  const allImages = useMemo(() => {
    const fromProjects = collectProjectImages(projects);
    // Generated images join the same resolution pool, shaped like the rest, so
    // `bindOwnedSlides` can bind a slide's assetKey to one after a reload.
    const generated = genImages
      .filter((g) => g.url)
      .map((g) => ({
        key: g.key,
        url: g.url,
        thumb: g.url,
        projectName: 'Generated',
        note: '',
        analyzed: false,
        keywords: String(g.prompt || '').toLowerCase(),
        generated: true,
      }));
    return [...fromProjects, ...generated];
  }, [projects, genImages]);
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
    setTab('Content & Visual');
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
  function onImageCreated(key, url, meta = {}) {
    if (!key) return;
    setLocalMedia((m) => ({ ...m, [key]: url }));
    // Add it to the generated-image library in state too, so it resolves even
    // after this pane remounts (the server already persisted it on create).
    setGenImages((list) =>
      list.some((g) => g.key === key)
        ? list
        : [{ key, url, prompt: meta.prompt || '', model: meta.model || '', addedAt: meta.addedAt || Date.now() }, ...list],
    );
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
  // Each rail slide resolved to its OWN chosen layout — the same composition the
  // big preview draws for that slide — so the vertical rail and the IG preview
  // always show the same picture for a given slide (never out of sync).
  const slideThumbLayout = (s) => {
    const opts = layoutsForSlide(s.role || 'Hook', vbStore);
    return opts.find((l) => l.id === s.layout) || opts[0] || null;
  };
  // this slide's picture, if it has one — swapped into the layout cards so a
  // chosen shape shows the studio's own photo, not a specimen (bauhly-v3 §542)
  const activePhoto = activeSlide?.image?.url || null;
  const cardLayout = (l) => (activePhoto && shotsOf(l) > 0
    ? { ...l, imgs: Array.from({ length: shotsOf(l) }, () => activePhoto) }
    : l);
  const LAY_PER_PAGE = 3;
  const maxWinStart = Math.max(0, slideLayouts.length - LAY_PER_PAGE);
  // ── THE WINDOW IS ITS OWN STATE, NOT THE SELECTION'S ──────────────────────
  // Deriving the window from the chosen layout re-centred the carousel on every
  // pick — so clicking a card slid the whole row and swapped the three
  // compositions in view, which reads as flicker. Now the arrows scroll the
  // window and a click only selects; the window follows the selection ONLY when
  // the pick lands outside it (e.g. switching slides), so browsing never
  // reshuffles what you are looking at.
  const [layWinStart, setLayWinStart] = useState(0);
  useEffect(() => {
    setLayWinStart((s) => {
      let n = Math.min(s, maxWinStart);
      if (chosenLayoutIdx < n) n = chosenLayoutIdx;
      else if (chosenLayoutIdx > n + LAY_PER_PAGE - 1) n = chosenLayoutIdx - LAY_PER_PAGE + 1;
      return Math.max(0, Math.min(n, maxWinStart));
    });
  }, [chosenLayoutIdx, maxWinStart]);
  const shownLayouts = slideLayouts.slice(layWinStart, layWinStart + LAY_PER_PAGE);
  const stepLayout = (d) => setLayWinStart((s) => Math.max(0, Math.min(s + d, maxWinStart)));

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
                    <SlideMedia
                      slide={s}
                      layout={slideThumbLayout(s)}
                      contentType={day.contentType || day.format}
                    />
                    <span className="wv-slide__num">{i + 1}</span>
                    {s.role && <span className="wv-slide__role">{s.role}</span>}
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

              {tab === 'Content & Visual' && (
                <div className="wv-pane">
                  {/* one hidden file input, shared by Upload / Replace */}
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
                      subtitle={activeSlide?.subtitle}
                      topic={day?.title || day?.direction}
                      contentType={day?.contentType || day?.format}
                      basePrompt={activeSlide?.imagePrompt}
                      brand={{
                        accent: igVars['--wv-accent'],
                        primary: igVars['--wv-primary'],
                        neutral: igVars['--wv-neutral'],
                        font: firstFont(vbStore?.brand?.fonts),
                        mood: moodOf(vbStore),
                      }}
                      onBack={() => setCreating(false)}
                      onCreated={onImageCreated}
                    />
                  ) : (
                    <>
                      {/* ── THE VISUAL: which layout, and its picture ────────── */}
                      <div className="wv-vis">
                        <span className="wv-sec__label">Which layout should this slide take?</span>

                        {/* the sliding window: three layout cards, an arrow at each end */}
                        <div className="wv-actsrow">
                          <button
                            type="button"
                            className="wv-actsrow__arrow"
                            onClick={() => stepLayout(-1)}
                            disabled={layWinStart <= 0}
                            aria-label="Previous layouts"
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
                                {/* the card shows this slide's own picture once it
                                    has one; the words stay the layout's specimen so
                                    the card still reads as a picture OF a layout */}
                                <span className="wv-act__shot"><Preview l={cardLayout(l)} mood={Boolean(activePhoto)} /></span>
                                <b>{l.name}</b>
                                <em className="wv-act__cat">{catLabelOf(l.cat)}</em>
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="wv-actsrow__arrow"
                            onClick={() => stepLayout(1)}
                            disabled={layWinStart >= maxWinStart}
                            aria-label="Next layouts"
                          >
                            <Glyph name="chevron-right" size={15} strokeWidth={2.5} />
                          </button>
                        </div>

                        {/* the picture: bring your own, or have Bauhly make one */}
                        <div className="wv-visacts">
                          <button
                            type="button"
                            className={`wv-visbtn${uploading ? ' is-busy' : ''}`}
                            disabled={uploading}
                            onClick={() => fileRef.current?.click()}
                          >
                            <Glyph name="upload" size={16} />
                            {uploading ? 'Uploading…' : hasOwnImage ? 'Replace image' : 'Upload image'}
                          </button>
                          <button type="button" className="wv-visbtn" onClick={() => setCreating(true)}>
                            <Glyph name="sparkles" size={16} />Generate image
                          </button>
                        </div>
                        {hasOwnImage && (
                          <button type="button" className="wv-remove" onClick={() => patchActiveSlide({ assetKey: '' })}>
                            <Glyph name="trash-2" size={14} />Remove image
                          </button>
                        )}

                        {allImages.length > 0 && (
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
                        {!allImages.length && !hasOwnImage && (
                          <p className="wv-muted" style={{ marginTop: 8 }}>
                            Add photos in Projects, then pick them here — or upload above.
                          </p>
                        )}
                      </div>

                      {/* ── THE WORDS on this slide ──────────────────────────── */}
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
                    </>
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
