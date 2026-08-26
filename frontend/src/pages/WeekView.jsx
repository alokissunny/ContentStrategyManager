/*
 * WeekView — complete content for one plan's seven-day route.
 *
 * Desktop: date header → seven-day calendar → a wide two-column post card
 * (composition left, Caption / Why this post right). Phone: stacked Instagram
 * card with a "Why this?" aside. Edits persist via PATCH /routes/:id/day/:index.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Glyph from '../components/Glyph';
import Icon from '../brand/Icon';
import YourAnalysisModal from '../components/YourAnalysisModal';
import ConnectMetaModal from '../components/ConnectMetaModal';
import { markDayPublished, updateDayContent, replanWeek, scheduleDay, setDayTime } from '../api/routes';
import { getMetaStatus, publishDayToMeta } from '../api/meta';
import { mediaProxyUrl, toDisplayUrl, isProxyUrl, rememberCdnBase, onCdnBase, getCdnBase, canvasSafeUrl, isProjectMediaKey } from '../api/media';
import { createImage, listGeneratedImages } from '../api/images';
import { useProjects, uploadFiles } from '../lib/projectsStore';
import { toSvg } from 'html-to-image';
import { CaptureChat } from './Projects';
import { styleOf, rolesOf, groundOf } from '../lib/visualbrand';
import { LAYOUTS as LIB_LAYOUTS, CATEGORIES, catForRole, shotsOf, DEFAULT_LAYOUT_BY_CAT, layoutShowsAllCopy } from '../data/layouts';
import { paintOf, identityOf, TYPE_SLOTS, FACES } from '../lib/identity';
import { rolesOf as textRolesOf, plainOf, parseMarked, isListRole, listIndexOf } from '../lib/slidetext';
import { Preview } from './visuallibrary/LayoutArt';
import VisualLibrary from './visuallibrary/VisualLibrary';
import ImagePicker from './weekview/ImagePicker';
import { PhotoEditor, SlotPack } from './weekview/PhotoEditor';
import RoleField from './weekview/RoleField';
import WordsPolish from './weekview/WordsPolish';
import CaptionPolish from './weekview/CaptionPolish';
import { useBodyScrollLock } from './visualbrand/useBodyScrollLock';
import useMediaQuery from '../hooks/useMediaQuery';
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
function layoutsForSlide(role, store, catOverride) {
  const off = store?.layoutsOff || {};
  const gone = store?.layoutsGone || {};
  const added = store?.addedLayouts || [];
  const cat = catOverride || catForRole(role);
  const list = [...added, ...ALL_LIB].filter((l) => !gone[l.id] && !off[l.id] && l.cat === cat);
  const defId = DEFAULT_LAYOUT_BY_CAT[cat];
  if (defId) {
    const i = list.findIndex((l) => l.id === defId);
    if (i > 0) {
      const [def] = list.splice(i, 1);
      list.unshift(def);
    }
  }
  return list;
}
function findLayout(id, store) {
  if (!id) return null;
  const added = store?.addedLayouts || [];
  return [...added, ...ALL_LIB].find((l) => l.id === id) || null;
}
function slideNeedsSubtitle(slide) {
  return Boolean(
    String(slide?.subtitle || slide?.body || '').trim()
    || (Array.isArray(slide?.items) && slide.items.some(Boolean))
    || slide?.comparisonA
    || slide?.stat
    || slide?.quote,
  );
}

function layoutMatchesStructure(layout, slide) {
  const art = layout?.art || {};
  if (Array.isArray(slide?.items) && slide.items.some(Boolean) && Array.isArray(art.items)) return true;
  if (slide?.comparisonA && ('a' in art || Array.isArray(art.labels))) return true;
  if (slide?.stat && ('big' in art)) return true;
  if (slide?.quote && layout?.kind && /quote/.test(layout.kind)) return true;
  return false;
}

function fallbackLayout(store, role, slide) {
  const off = store?.layoutsOff || {};
  const gone = store?.layoutsGone || {};
  const list = layoutsForSlide(role, store);
  const usable = (l) => l && !off[l.id] && !gone[l.id];
  const fromList = list.find((l) => usable(l) && layoutMatchesStructure(l, slide))
    || ALL_LIB.find((l) => usable(l) && layoutMatchesStructure(l, slide));
  if (fromList) return fromList;
  const needSub = slideNeedsSubtitle(slide);
  const cat = catForRole(role);
  const defId = DEFAULT_LAYOUT_BY_CAT[cat];
  if (defId) {
    const preferred = findLayout(defId, store);
    if (usable(preferred) && (!needSub || layoutShowsAllCopy(preferred) || layoutMatchesStructure(preferred, slide))) {
      return preferred;
    }
  }
  if (needSub) {
    const withSub = list.find((l) => layoutShowsAllCopy(l));
    if (withSub) return withSub;
  }
  return list[0] || null;
}

function layoutForSlide(slide, store, role) {
  const stored = findLayout(slide?.layout, store);
  if (stored) {
    if (layoutMatchesStructure(stored, slide)) return stored;
    if (!slideNeedsSubtitle(slide) || layoutShowsAllCopy(stored)) return stored;
  }
  return fallbackLayout(store, role, slide);
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
function CreateImageChat({ role, projectName, words, subtitle, topic, contentType, basePrompt, brand, onBack, onCreated, backLabel = 'Back to layouts' }) {
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
          {backLabel}
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
// The glyph the post's own format tag wears — a moving waveform for a Reel, the
// same marks the day cards use for the rest.
const FORMAT_GLYPH = { Reel: 'activity', Carousel: 'copy', Post: 'image', Story: 'book-open' };

function hashtagsOf(day) {
  const raw = day?.content?.hashtags;
  const parts = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/);
  return [...new Set(parts.map((h) => String(h || '').replace(/^#/, '').trim()).filter(Boolean))];
}

function formatHashtagLine(tags) {
  return tags.map((t) => `#${t}`).join(' ');
}

function parseHashtagLine(text) {
  return hashtagsOf({ content: { hashtags: String(text || '').split(/[\s,]+/) } });
}
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

function shortDay(day) {
  return String(day || '').slice(0, 3);
}

// The app's default publish time when neither the post nor the plan set one.
const DEFAULT_TIME_24 = '09:00';

// Parse any time string ("9:00 AM", "07:30", "7 pm", "14:05") into 24h parts.
function parseClock(t) {
  const m = String(t || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return { h: 9, min: 0 };
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return { h: Math.min(23, Math.max(0, h)), min: Math.min(59, Math.max(0, min)) };
}

// Any time string → the 24h "HH:MM" a <input type="time"> expects.
function to24h(t) {
  const { h, min } = parseClock(t);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Any time string → a spoken "7:30 AM" for reading on the post.
function toSpoken(t) {
  const { h, min } = parseClock(t);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ap}`;
}

// The editor field shows a padded 12-hour clock ("09:30 AM") so the value
// matches the reference UI regardless of the browser's native time format.
function toClockField(t) {
  const { h, min } = parseClock(t);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${ap}`;
}

const CLOCK_HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const CLOCK_MINS = Array.from({ length: 60 }, (_, i) => i);
const CLOCK_AP = ['AM', 'PM'];
const pad2 = (n) => String(n).padStart(2, '0');
function cycleFrom(list, start) {
  const i = list.indexOf(start);
  if (i <= 0) return list;
  return list.slice(i).concat(list.slice(0, i));
}
function clockParts(t) {
  const { h, min } = parseClock(t);
  return { h12: h % 12 === 0 ? 12 : h % 12, min, ap: h < 12 ? 'AM' : 'PM' };
}
function joinClock(h12, min, ap) {
  let h = h12 % 12;
  if (ap === 'PM') h += 12;
  return `${pad2(h)}:${pad2(min)}`;
}

/* 12-hour clock with Hours / Minutes / AM·PM columns (bauhly-v3 uses a native
 * time input; Chrome draws this picker, other browsers do not — so we draw it). */
function ClockField({ value, onChange, open, onToggle }) {
  const { h12, min, ap } = clockParts(value);
  return (
    <div className={`wv-time__field${open ? ' is-open' : ''}`}>
      <span className="wv-time__label">Change time</span>
      <button
        type="button"
        className="wv-time__control"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Publish time"
        onClick={onToggle}
      >
        <span className="wv-time__value">{toClockField(value)}</span>
        <span className="wv-time__clock" aria-hidden="true">
          <Glyph name="clock" size={16} strokeWidth={2} />
        </span>
      </button>
      {open && (
        <div className="wv-time__pop" role="group" aria-label="Pick a time">
          <div className="wv-time__col" role="listbox" aria-label="Hour">
            {cycleFrom(CLOCK_HOURS, h12).map((h) => (
              <button
                key={h}
                type="button"
                role="option"
                aria-selected={h === h12}
                className={`wv-time__opt${h === h12 ? ' is-on' : ''}`}
                onClick={() => onChange(joinClock(h, min, ap))}
              >
                {pad2(h)}
              </button>
            ))}
          </div>
          <div className="wv-time__col" role="listbox" aria-label="Minute">
            {cycleFrom(CLOCK_MINS, min).map((m) => (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={m === min}
                className={`wv-time__opt${m === min ? ' is-on' : ''}`}
                onClick={() => onChange(joinClock(h12, m, ap))}
              >
                {pad2(m)}
              </button>
            ))}
          </div>
          <div className="wv-time__col" role="listbox" aria-label="AM or PM">
            {cycleFrom(CLOCK_AP, ap).map((p) => (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={p === ap}
                className={`wv-time__opt${p === ap ? ' is-on' : ''}`}
                onClick={() => onChange(joinClock(h12, min, p))}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The time this post goes out at: its own, else the plan's weekly preference,
// else the app default. Returned as-stored (24h or freeform); read it through
// toSpoken / to24h at the point of use.
function slotTimeRaw(day, route) {
  return (day?.time && String(day.time).trim())
    || (route?.postAtPref && String(route.postAtPref).trim())
    || DEFAULT_TIME_24;
}

// The moment this day's post is scheduled to go out — the week's start plus the
// day's offset, stamped with the post's time. Best-effort; the "Scheduled for"
// line reads day + time directly, so a rough Date never mislabels the slot.
function slotDateOf(route, index, day) {
  const base = route?.startsAt ? new Date(route.startsAt) : new Date();
  const d = Number.isNaN(base.getTime()) ? new Date() : new Date(base);
  d.setDate(d.getDate() + index);
  const { h, min } = parseClock(slotTimeRaw(day, route));
  d.setHours(h, min, 0, 0);
  return d;
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

function visualNeedRecord(s) {
  const src = (s?.visualNeed && typeof s.visualNeed === 'object' && !Array.isArray(s.visualNeed))
    ? s.visualNeed
    : (s?.visual && typeof s.visual === 'object' ? s.visual : {});
  const priority = String(src.priority || '').trim().toLowerCase();
  const type = String(src.type || '').trim();
  const execution = String(src.execution || '').trim().toLowerCase();
  const fromPlaceholder = typeof s?.image === 'string' && String(s.image).toLowerCase() === 'placeholder';
  const wants = (priority && priority !== 'none')
    || (type && type.toLowerCase() !== 'none')
    || /supplied|generated|graphic|unresolved/.test(execution)
    || fromPlaceholder;
  if (!wants) return null;
  return {
    priority: priority && priority !== 'none' ? priority : 'recommended',
    type: type && type.toLowerCase() !== 'none' ? type : '',
    role: String(src.role || '').trim(),
    communicationFunction: String(src.communicationFunction || '').trim(),
    truthBoundary: String(src.truthBoundary || '').trim(),
    execution,
    productionInstruction: String(src.productionInstruction || '').trim(),
  };
}

function visualKindLabel(value) {
  const raw = String(value || '').trim();
  if (!raw || /^none$/i.test(raw)) return '';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function slideRecord(s, extra = {}) {
  return {
    role: s.role || '',
    structure: s.structure || '',
    title: s.title || '',
    subtitle: s.subtitle || s.body || '',
    body: s.body || '',
    items: Array.isArray(s.items) ? s.items.map((x) => x || '') : [],
    itemsA: Array.isArray(s.itemsA) ? s.itemsA.map((x) => x || '') : [],
    itemsB: Array.isArray(s.itemsB) ? s.itemsB.map((x) => x || '') : [],
    stat: s.stat || '',
    quote: s.quote || '',
    action: s.action || '',
    comparisonA: s.comparisonA || '',
    comparisonB: s.comparisonB || '',
    labels: Array.isArray(s.labels) ? s.labels.map((x) => x || '') : [],
    image: s.image || '',
    imagePrompt: s.imagePrompt || '',
    assetKey: s.assetKey || '',
    assetKeys: Array.isArray(s.assetKeys) ? s.assetKeys.map((k) => k || '') : [],
    layout: s.layout || '',
    visualNeed: visualNeedRecord(s),
    ...extra,
  };
}

function deriveSlides(day) {
  const roles = SLIDE_ROLES[day.format] || SLIDE_ROLES.Post;
  const existing = day.content?.slides;
  if (Array.isArray(existing) && existing.length) {
    return existing.map((s, i) => ({
      ...slideRecord(s),
      role: s.role || roles[Math.min(i, roles.length - 1)],
      subtitle: s.subtitle || s.body || '',
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
function keysOf(slide) {
  if (Array.isArray(slide?.assetKeys) && slide.assetKeys.length) return slide.assetKeys;
  return slide?.assetKey ? [slide.assetKey] : [];
}

function urlForKey(key, slide, localMedia, mediaByKey, preferProxy = false) {
  if (!key) return null;
  // Prefer a URL this session already has (project pool, a just-uploaded
  // preview, or a slide image bindOwnedSlides already resolved). A leftover
  // key from another Instagram handle must not invent a CDN URL from the
  // pool — but a `projects/…` key already saved on THIS slide is the photo
  // the studio applied (a crop, a replace). After a tab switch local blob
  // previews are gone, so resolve that key through the CDN/proxy or the
  // post comes back empty.
  const local = localMedia?.[key];
  const pooled = mediaByKey?.get(key);
  const fromSlide = slide?.image?.key === key
    ? (slide.image.url || slide.image.thumb || null)
    : null;
  const known = local || pooled || fromSlide || null;
  if (known) {
    if (preferProxy && isProjectMediaKey(key)) return mediaProxyUrl(key);
    return toDisplayUrl(known, key) || (isProjectMediaKey(key) ? mediaProxyUrl(key) : null);
  }
  if (!isProjectMediaKey(key)) return null;
  if (preferProxy) return mediaProxyUrl(key);
  return toDisplayUrl('', key) || mediaProxyUrl(key) || null;
}

function bindOwnedSlides(slides, allImages, localMedia, used) {
  const byKey = new Map(allImages.map((img) => [img.key, img]));
  Object.entries(localMedia || {}).forEach(([key, url]) => {
    if (!byKey.has(key)) byKey.set(key, { key, url, thumb: url, projectName: 'Uploaded', note: '', keywords: '' });
  });
  return slides.map((s) => {
    const keys = keysOf(s).filter(Boolean);
    if (!keys.length) return { ...s, image: null, standing: false };
    keys.forEach((k) => {
      const hit = byKey.get(k);
      if (hit) used.add(hit.key);
      else used.add(k);
    });
    const hit = byKey.get(keys[0]);
    if (hit) return { ...s, image: hit, standing: false };
    if (isProjectMediaKey(keys[0])) {
      const url = toDisplayUrl('', keys[0]) || mediaProxyUrl(keys[0]);
      return { ...s, image: { key: keys[0], url, thumb: url, projectName: '', note: '', keywords: '' }, standing: false };
    }
    return { ...s, image: null, standing: false };
  });
}

function photoUrl(slide, localMedia, mediaByKey) {
  const key = slide?.assetKey || slide?.image?.key;
  return urlForKey(key, slide, localMedia, mediaByKey) || null;
}

function withSlidePhoto(layout, slide, localMedia, mediaByKey, preferProxy = false) {
  if (!layout) return layout;
  const shots = shotsOf(layout);
  // Always replace the library's specimen stills. Returning the layout as-is
  // when a slide has no owned photo would keep the canal-house placeholders —
  // which read as another account's pictures after a handle switch.
  if (shots < 1) return { ...layout, imgs: [] };
  const urls = keysOf(slide).map((k) => urlForKey(k, slide, localMedia, mediaByKey, preferProxy));
  return { ...layout, imgs: Array.from({ length: shots }, (_, i) => urls[i] || null) };
}


function dayAssetStatus(slides, published) {
  if (published) return { label: 'Published', kind: 'done', icon: 'check-circle-2' };
  // A post is ready once it has at least one assigned image (its lead frame).
  // Text-only slides no longer count as "missing" — images are deliberately not
  // reused to fill every slide, so an imageless slide is expected, not a gap.
  const hasImage = slides.some((s) => Boolean(s.image));
  if (!hasImage) return { label: 'Needs image', kind: 'need', icon: 'alert-circle' };
  return { label: 'Ready', kind: 'ready', icon: 'check' };
}

// The words fill the composition's headline slot, which is sized for a display
// line — the renderer shrinks the type as the line grows (LayoutArt `fitScale`),
// but a paragraph would still shrink past readable, so the input is capped. 180
// characters is a headline and a supporting line, not an essay.
const MAX_SLIDE_TEXT = 180;
const capText = (t) => String(t || '').slice(0, MAX_SLIDE_TEXT);

function faceLabelFor(slotId, store) {
  const slot = TYPE_SLOTS.find((x) => x.id === slotId) || TYPE_SLOTS[0];
  const ident = identityOf(store);
  const chosen = ident.type?.[slot.id]?.face || (slot.id === 'detail' ? ident.type?.body?.face : null) || slot.face;
  const own = (ident.fonts || []).find((f) => f.id === chosen);
  return own ? own.name : (FACES.find((f) => f.id === chosen) || FACES[0]).label;
}

function durableMediaKey(key, fallback = '') {
  if (isProjectMediaKey(key)) return String(key);
  if (String(key || '').startsWith('edit-')) {
    return isProjectMediaKey(fallback) ? String(fallback) : '';
  }
  return String(key || '');
}

function slidesPayload(slides, baseline = []) {
  return slides.map((s, i) => {
    const prev = baseline[i] || {};
    const prevKeys = Array.isArray(prev.assetKeys) ? prev.assetKeys : [];
    const nextKeys = Array.isArray(s.assetKeys) ? s.assetKeys : [];
    const assetKeys = nextKeys.length
      ? nextKeys.map((k, j) => durableMediaKey(k, prevKeys[j]))
      : prevKeys.map((k) => durableMediaKey(k));
    const assetKey = durableMediaKey(s.assetKey, prev.assetKey) || assetKeys.find(Boolean) || '';
    return {
      ...slideRecord(s, { assetKey, assetKeys }),
      role: s.role || '',
      title: s.title || '',
      subtitle: s.subtitle || '',
      imagePrompt: s.imagePrompt || '',
      layout: s.layout || '',
    };
  });
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
    if (d.content?.cta) lines.push('', 'CTA:', d.content.cta);
    const tags = hashtagsOf(d);
    if (tags.length) lines.push('', 'Hashtags:', formatHashtagLine(tags));
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
// the plan is built) fills the body. The eyebrow stays empty unless the studio
// writes one — never the day's contentType, which is a production label.
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

function fillLayout(layout, slide, contentType, draft) {
  if (!layout) return layout;
  const title = (draft?.head != null ? plainOf(draft.head) : (slide?.title || slide?.quote || slide?.action || '')).trim();
  const sub = (draft?.body != null ? plainOf(draft.body) : (slide?.subtitle || slide?.body || '')).trim();
  const src = layout.art || {};
  const has = (k) => k in src;
  const art = {};

  let accentText = '';
  if (has('a') && (slide?.comparisonA || slide?.comparisonB)) {
    art.a = String(slide.comparisonA || title).trim();
    if (has('b')) art.b = String(slide.comparisonB || slide?.subtitle || '').trim();
  } else if (has('head')) {
    if (has('accent') && title) {
      const split = splitStatement(title);
      art.head = split.head;
      accentText = split.accent;
    } else {
      art.head = title;
    }
    if (has('body')) art.body = sub;
  } else if (has('body')) {
    art.body = title;
  } else if (has('a')) {
    art.a = title;
  } else {
    art.head = title;
  }

  if (has('eyebrow')) art.eyebrow = '';
  if (has('bodyB')) art.bodyB = slide?.body && slide.body !== sub ? slide.body : '';

  if (has('accent')) art.accent = accentText;
  if (has('big')) {
    const n = String(slide?.stat || '').trim();
    art.big = n || (!has('head') ? title : '');
    if (has('body') && n) art.body = sub;
  }
  if (has('b') && !art.b) art.b = String(slide?.comparisonB || '').trim();
  if (has('items')) {
    art.items = Array.isArray(slide?.items) && slide.items.length ? slide.items.filter(Boolean) : [];
  }
  if (has('itemsA')) art.itemsA = Array.isArray(slide?.itemsA) ? slide.itemsA.filter(Boolean) : [];
  if (has('itemsB')) art.itemsB = Array.isArray(slide?.itemsB) ? slide.itemsB.filter(Boolean) : [];
  if (has('labels')) {
    art.labels = Array.isArray(slide?.labels) && slide.labels.length
      ? slide.labels.filter(Boolean)
      : (Array.isArray(src.labels) ? src.labels : []);
  }

  // Edit text draft overlays every role the layout actually has, so typing
  // updates the composition above before Apply writes it (bauhly-v3 §820).
  if (draft) {
    if (has('eyebrow') && draft.eyebrow != null) art.eyebrow = plainOf(draft.eyebrow);
    if (has('big') && draft.big != null) art.big = plainOf(draft.big);
    if (has('detail') && draft.detail != null) art.detail = plainOf(draft.detail);
    if (has('body') && draft.body != null) art.body = plainOf(draft.body);
    if (has('head') && has('accent') && draft.head) {
      const marked = parseMarked(draft.head);
      const acc = marked.find((p) => p.mark === 'accent');
      if (acc) {
        art.head = marked.filter((p) => p !== acc).map((p) => p.text).join('').trim();
        art.accent = acc.text;
      }
    }
    if (has('items')) {
      const items = Array.isArray(art.items) ? [...art.items] : [];
      Object.keys(draft).forEach((k) => {
        if (!isListRole(k)) return;
        items[listIndexOf(k)] = plainOf(draft[k]);
      });
      art.items = items;
    }
  }

  return { ...layout, art };
}

// Seed Edit text from what the preview is already drawing, so the fields and
// the composition are the same words (bauhly-v3 §879).
function seedWordDraft(layout, slide, contentType) {
  const filled = fillLayout(layout, slide, contentType);
  const art = filled?.art || {};
  const out = {};
  textRolesOf(layout).forEach((r) => {
    if (r.key === 'head') {
      out.head = (slide?.title || '').trim() || [art.head, art.accent].filter(Boolean).join(' ');
    } else if (r.key === 'body') {
      out.body = (slide?.subtitle || '').trim() || art.body || '';
    } else if (isListRole(r.key)) {
      out[r.key] = art.items?.[listIndexOf(r.key)] || '';
    } else {
      out[r.key] = art[r.key] || '';
    }
  });
  return out;
}

// Rasterise one composed slide node to a JPEG blob at its rendered size.
//
// html-to-image's own toBlob/toCanvas rasterise by loading the serialised SVG
// into an <img> and drawing it to a canvas, and that image-load step can hang
// indefinitely in some engines (WebKit especially) — which would freeze the
// Publish button forever. So we use html-to-image only for the reliable part
// (serialising the DOM + inlining computed styles, fonts and images into an SVG
// data URL via toSvg) and do the raster ourselves with a plain onload handler
// and an explicit timeout. Instagram feed images must be JPEG, so we encode
// JPEG on a white ground (the composition is opaque, so nothing shows through).
//
// Font embedding is OFF (`skipFonts`): the brand fonts are served from
// cross-origin CDNs (Fontshare, Google Fonts) whose stylesheets the browser
// won't let us read (`cssRules` SecurityError / CORS), so html-to-image can't
// inline them anyway — and attempting it only throws console errors. Every
// font stack in the compositions ends in `system-ui, sans-serif`, so the export
// falls back to a clean system sans-serif rather than a serif default.
function rasterizeSlide(node, { timeoutMs = 20000 } = {}) {
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  if (!w || !h) return Promise.reject(new Error('Slide has no size to render.'));
  return toSvg(node, { cacheBust: true, skipFonts: true }).then(
    (dataUrl) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        const timer = setTimeout(() => reject(new Error('Rendering the slide timed out.')), timeoutMs);
        img.onload = () => {
          clearTimeout(timer);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the slide image.'))),
              'image/jpeg',
              0.95
            );
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Could not render the slide image.'));
        };
        img.src = dataUrl;
      })
  );
}

// The post preview IS the chosen Visual Library layout — LayoutArt's own
// `Preview`, the same renderer the Image-tab cards and the Visual Library use.
// The slide's photograph fills the composition's picture slots (mood on); with
// none, the picture regions draw as the empty ground the layout has before a
// photo exists, exactly as the library shows them.
function VisualNeedHint({ need }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const priority = String(need?.priority || 'recommended').toLowerCase();
  const title = priority === 'required'
    ? 'Required visual'
    : priority === 'optional'
      ? 'Optional visual'
      : 'Recommended visual';
  const kind = visualKindLabel(need?.type);
  const role = visualKindLabel(need?.role);
  const what = String(need?.communicationFunction || need?.productionInstruction || '').trim();
  const boundary = String(need?.truthBoundary || '').trim();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div className={`wv-vneed${open ? ' is-open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="wv-vneed__i"
        aria-expanded={open}
        aria-label={`${title}${kind ? `: ${kind}` : ''}`}
        title={title}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Icon name="info" size={15} strokeWidth={2} />
      </button>
      {open && (
        <div className="wv-vneed__tip" role="tooltip">
          <strong className="wv-vneed__kicker">{title}</strong>
          {(kind || role) && (
            <span className="wv-vneed__kind">
              {kind || 'Visual'}
              {role ? ` · ${role}` : ''}
            </span>
          )}
          <p>{what || 'This slide wants a visual. Add a photograph, graphic, or generated image that carries the point.'}</p>
          {boundary ? <p className="wv-vneed__bound">{boundary}</p> : null}
        </div>
      )}
    </div>
  );
}

function SlideMedia({ slide, layout, contentType, localMedia, parts, mediaByKey, preferProxy = false, showVisualHint = false }) {
  const need = showVisualHint ? visualNeedRecord(slide) : null;
  if (!layout) {
    return (
      <div className="wv-ig__empty">
        <Glyph name="image" size={28} />
        <span>Needs image</span>
        {need && <VisualNeedHint need={need} />}
      </div>
    );
  }
  const filled = withSlidePhoto(
    fillLayout(layout, slide, contentType, parts),
    slide,
    localMedia,
    mediaByKey,
    preferProxy,
  );
  const anyPhoto = (filled?.imgs || []).some(Boolean);
  const showHint = Boolean(need) && !anyPhoto;
  const emptyPlaceholder = showHint && shotsOf(filled || layout) < 1;
  return (
    <div className={`wv-ig__lay${emptyPlaceholder ? ' is-needvisual' : ''}`}>
      <Preview l={filled} mood={anyPhoto} />
      {showHint && <VisualNeedHint need={need} />}
    </div>
  );
}

/* ── Browse layouts: the Visual Library itself, opened over the post ────
 * Not a second category browser — the real page, with everything that acts
 * on the library taken away, so the one action is choosing a category. */
function LibraryPick({ current, layoutId, onPick, onLayout, onClose }) {
  useBodyScrollLock();
  const [sel, setSel] = useState(current);
  useEffect(() => { setSel(current); }, [current]);
  const cat = CATEGORIES.find((c) => c.id === sel) || null;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="wv-vlib__scrim" onClick={onClose} />
      <div className="wv-vlib" role="dialog" aria-modal="true" aria-label="Choose a layout">
        <div className="wv-vlib__body">
          <VisualLibrary
            pick={{
              current: sel,
              layoutId,
              onPick: setSel,
              onLayout: (l) => { onLayout(l); onClose(); },
              onClose,
            }}
          />
        </div>
        <div className="wv-vlib__foot">
          <button type="button" className="btn btn--tertiary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => { if (cat) onPick(cat.id); onClose(); }}
            disabled={!cat}
          >
            Use {cat ? cat.label : 'category'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ── Adapt this slide to a new category? (bauhly-v3 §901) ───────────────
 * Browse layouts choosing a different group is a rewrite of the row, so it
 * asks once before the carousel moves. Continue points the row at that set;
 * Cancel leaves the post as it was. */
function AdaptCategoryDialog({ label, onContinue, onClose }) {
  useBodyScrollLock();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="wv-confirm__scrim" onClick={onClose} />
      <div className="wv-confirm" role="alertdialog" aria-modal="true" aria-labelledby="wv-cat-t">
        <h2 id="wv-cat-t">Adapt this slide to a new category?</h2>
        <p className="wv-cat__flow" aria-hidden="true">
          <span className="wv-cat__step">
            <Icon name="dashboard" size={15} strokeWidth={2} />
            This slide
          </span>
          <Icon name="arrow-right" size={14} strokeWidth={2.5} className="wv-cat__arrow" />
          <span className="wv-cat__step is-mid">
            <Icon name="sparkle" size={15} strokeWidth={2} />
            Bauhly adapts
          </span>
          <Icon name="arrow-right" size={14} strokeWidth={2.5} className="wv-cat__arrow" />
          <span className="wv-cat__step">
            <Icon name="check" size={15} strokeWidth={2.5} />
            {label}
          </span>
        </p>
        <p>
          Changing category means Bauhly will rework this slide&rsquo;s text and
          structure to fit the new layout style. This uses another generation.
        </p>
        <div className="wv-confirm__acts">
          <button type="button" className="btn btn--primary btn--sm" onClick={onContinue}>
            Continue
          </button>
          <button type="button" className="btn btn--tertiary btn--sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ── Add images to this layout? (bauhly-v3 §928) ────────────────────────
 * Apply layout always writes the shape first. If that shape has picture
 * places, this asks whether to fill them now. Not now leaves the regions
 * empty; Add images opens the Select images sheet. */
function AddImagesDialog({ count, onAdd, onSkip, onClose }) {
  useBodyScrollLock();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const spaces = count === 1 ? 'an image space' : `${count} image spaces`;
  return createPortal(
    <>
      <div className="wv-confirm__scrim" onClick={onClose} />
      <div className="wv-confirm" role="alertdialog" aria-modal="true" aria-labelledby="wv-imgq-t">
        <h2 id="wv-imgq-t">Add images to this layout?</h2>
        <p>
          This layout includes {spaces}. You can add them now or come back later.
        </p>
        <div className="wv-confirm__acts">
          <button type="button" className="btn btn--primary btn--sm" onClick={onSkip}>
            Not now
          </button>
          <button type="button" className="btn btn--tertiary btn--sm" onClick={onAdd}>
            Add images
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function WeekNav({ weekIdx, weekCount, onPick }) {
  if (weekCount <= 1) return null;
  return (
    <div className="wv-wknav">
      <button
        type="button"
        className="wv-wknav__arrow"
        onClick={() => onPick(weekIdx - 1)}
        disabled={weekIdx <= 0}
        aria-label="Previous week"
      >
        <Icon name="chevron-left" size={18} strokeWidth={2.5} />
      </button>
      <span className="wv-wknav__now">
        <b>Week {weekIdx + 1}</b>
        <span className="wv-wknav__of"> of {weekCount}</span>
      </span>
      <button
        type="button"
        className="wv-wknav__arrow"
        onClick={() => onPick(weekIdx + 1)}
        disabled={weekIdx >= weekCount - 1}
        aria-label="Next week"
      >
        <Icon name="chevron-right" size={18} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function handleInitials(username = '') {
  return (String(username).replace(/[^a-z0-9]/gi, '').slice(0, 2) || 'IG').toUpperCase();
}

const PILLAR_WHY = {
  discovery: { label: 'Discovery', job: 'Get noticed' },
  credibility: { label: 'Credibility', job: 'Show expertise' },
  trust: { label: 'Trust', job: 'Build confidence' },
};

/* Why this post — the strategy, used in the desktop side panel and the phone aside. */
function WhyBody({ day }) {
  if (!day) return <p className="wv-muted">No strategy notes for this post yet.</p>;
  const pillarKey = ['discovery', 'credibility', 'trust'].includes(day.pillar) ? day.pillar : '';
  const pillar = pillarKey ? PILLAR_WHY[pillarKey] : null;
  const job = String(day.goalTag || pillar?.job || '').trim();
  const empty = !pillar && !day.content?.strategy && !day.direction && !day.content?.notes && !day.content?.plan;
  return (
    <div className="wv-ig__whybody">
      {pillar && (
        <div className="wv-why__sec">
          <span className="wv-why__label"><Icon name={pillarKey} size={13} />Content pillar</span>
          <p>
            <b className="wv-why__pillar">{pillar.label}</b>
            {job ? ` · ${job}` : ''}
          </p>
        </div>
      )}
      {day.content?.strategy && (
        <div className="wv-why__sec">
          <span className="wv-why__label"><Glyph name="target" size={13} />Focus</span>
          <p>{day.content.strategy}</p>
        </div>
      )}
      {day.direction && (
        <div className="wv-why__sec">
          <span className="wv-why__label"><Glyph name="route" size={13} />Direction</span>
          <p>{day.direction}</p>
        </div>
      )}
      {(day.content?.notes || day.content?.plan) && (
        <div className="wv-why__sec">
          <span className="wv-why__label"><Glyph name="clipboard-list" size={13} />Production notes</span>
          <p>{day.content?.notes || day.content?.plan}</p>
        </div>
      )}
      {day.content?.prompts?.length > 0 && (
        <div className="wv-why__sec">
          <span className="wv-why__label"><Glyph name="sparkles" size={13} />Prompts</span>
          {day.content.prompts.map((p, i) => (
            <p key={i}>{i + 1}. {p}</p>
          ))}
        </div>
      )}
      {empty && <p className="wv-muted">No strategy notes for this post yet.</p>}
    </div>
  );
}

export default function WeekView({ route: initialRoute, onBack, monthWeeks = [], onOpenWeek, initialDay = 0, onCaptured, onRouteChange }) {
  const navigate = useNavigate();
  const projects = useProjects();
  const [capturing, setCapturing] = useState(false);
  const [route, setRoute] = useState(initialRoute);
  const [selected, setSelected] = useState(() => {
    const n = (initialRoute?.days || []).length;
    const i = Number(initialDay) || 0;
    if (n <= 0) return 0;
    return Math.max(0, Math.min(n - 1, i));
  });
  const [slideIdx, setSlideIdx] = useState(0);
  // The post is the interface (bauhly-v3 §652): the studio acts on the preview's
  // own zones. `zone` is the one open editor — the picture ('visual') or the
  // words ('caption') — and it is a single value, so the two can never both be
  // open. `whyOpen` reveals the strategy beside the post.
  const [zone, setZone] = useState(null); // 'visual' | 'caption' | null
  // Which editor the visual zone's menu opened (bauhly-v3 §818/§989): the pencil
  // shows a menu — Choose layout / Edit image / Select images / Edit text —
  // and picking one sets this. null = the menu itself is showing.
  const [visEdit, setVisEdit] = useState(null); // 'layout' | 'images' | 'words' | null
  // Edit image (bauhly-v3 §961/§965/§982): the still-photo studio. `adjustFor`
  // is the picture being cropped; `editSlot` is the measured layout region it
  // will occupy. More than one picture place opens the set first (`packOpen`).
  const [adjustFor, setAdjustFor] = useState(null); // { src, slotIndex } | null
  const [editSlot, setEditSlot] = useState(null);
  const [packOpen, setPackOpen] = useState(false);
  // Browse layouts / Apply layout (bauhly-v3 §809/§823/§825): picking a card
  // is a draft until Apply; Browse layouts points the row at another category.
  const [layPick, setLayPick] = useState(null);
  const [layCat, setLayCat] = useState(null);
  const [libOpen, setLibOpen] = useState(false);
  const [askCat, setAskCat] = useState(null); // { id, label } | null
  // How many picture places the shape just applied has, while the studio
  // decides whether to fill them now (bauhly-v3 §928).
  const [askImgs, setAskImgs] = useState(0);
  // Select images sheet (bauhly-v3 §821/§890): draft slots until Apply.
  const [imgPick, setImgPick] = useState(null); // { slots: (string|null)[], at: number } | null
  const [whyOpen, setWhyOpen] = useState(false);
  // Desktop side panel: Caption | Why this post (bauhly-v3 desktop split).
  const [sideTab, setSideTab] = useState('caption'); // 'caption' | 'why'
  const [capReviewed, setCapReviewed] = useState(() => new Set());
  // Day-to-day slide transition (bauhly-v3 §730/§786): the arriving post's
  // direction — 1 = came from the right (moving forward), -1 = from the left,
  // 0 = at rest. The class comes off once the card has arrived.
  const [enter, setEnter] = useState(0);
  // When a day ARROW is pressed the arrows leave first (they sit where the cards
  // are about to move), then the cards slide — see `goFromArrow` (bauhly-v3
  // §725, ARROW_OUT). `navOut` fades them out and keeps them gone until the move
  // has finished.
  const [navOut, setNavOut] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false); // header ⋯ menu
  const calGridRef = useRef(null);
  const [calMore, setCalMore] = useState(false);
  const [calPrev, setCalPrev] = useState(false);
  const calPlacedFor = useRef(null);
  const [wordDraft, setWordDraft] = useState(null); // role-keyed draft until Apply
  const [capDraft, setCapDraft] = useState(''); // caption editor draft
  const [tagDraft, setTagDraft] = useState(''); // hashtag editor draft
  const [capBusy, setCapBusy] = useState(false);
  const [wordsBusy, setWordsBusy] = useState(false);
  const capTaRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [metaStatus, setMetaStatus] = useState({ connected: false, configured: false });
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [askSchedule, setAskSchedule] = useState(false); // no-caption confirm
  // the inline "Edit publish time" editor: null = closed, else { at, every }
  const [timeDraft, setTimeDraft] = useState(null);
  const [clockOpen, setClockOpen] = useState(false);
  const [savingTime, setSavingTime] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [replanMsg, setReplanMsg] = useState('');
  const [cdnBase, setCdnBase] = useState(() => getCdnBase());
  const [genImages, setGenImages] = useState([]); // the studio's generated-image library
  // Fresh uploads / edits, keyed by object key, until the project list refreshes.
  const [localMedia, setLocalMedia] = useState({});
  const [creating, setCreating] = useState(false);
  // Off-screen, full-resolution renders of each slide's composition — the whole
  // layout (ground + words + photo), not the bare photo. Publishing rasterises
  // these to PNGs so Instagram receives the actual designed post, not the raw
  // project images. Indexed by slide position.
  const exportRefs = useRef([]);
  const routeRef = useRef(route);
  const lastSavedByDayRef = useRef({});
  const persistGenRef = useRef(0);
  routeRef.current = route;

  const weekId = initialRoute?._id;
  useEffect(() => {
    setRoute(initialRoute);
    const n = (initialRoute?.days || []).length;
    const i = Number(initialDay) || 0;
    setSelected(n <= 0 ? 0 : Math.max(0, Math.min(n - 1, i)));
    setSlideIdx(0);
    setZone(null);
    setVisEdit(null);
    setWhyOpen(false);
    setSideTab('caption');
    setCapReviewed(new Set());
    setWordDraft(null);
    setCapDraft('');
    setLayPick(null);
    setLayCat(null);
    setImgPick(null);
    setAdjustFor(null);
    setEditSlot(null);
    setPackOpen(false);
    setTimeDraft(null);
    setEnter(0);
    setMoreOpen(false);
    setLocalMedia({});
    lastSavedByDayRef.current = Object.fromEntries(
      (initialRoute?.days || []).map((d, i) => [i, d.content?.slides || []]),
    );
    persistGenRef.current = 0;
    // Reset editors when the open week (or Instagram handle) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekId, initialRoute?.instagramUsername]);

  useEffect(() => {
    getMetaStatus()
      .then(setMetaStatus)
      .catch(() => setMetaStatus({ connected: false, configured: false }));
  }, []);

  useEffect(() => onCdnBase(setCdnBase), []);

  // Load the persisted generated images so a slide that points at one still
  // resolves after a tab switch / reload (they aren't project captures, so they
  // don't come through `collectProjectImages`). Refetch when the handle changes
  // so a previous account's library cannot linger if this view stays mounted.
  useEffect(() => {
    let alive = true;
    setGenImages([]);
    listGeneratedImages()
      .then((imgs) => { if (alive) setGenImages(imgs); })
      .catch(() => { /* leave empty — a fresh session simply has none yet */ });
    return () => { alive = false; };
  }, [initialRoute?.instagramUsername]);

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
  const mediaByKey = useMemo(() => {
    const map = new Map();
    allImages.forEach((img) => {
      if (!img?.key || !img.url) return;
      rememberCdnBase(img.url);
      if (!isProxyUrl(img.url)) map.set(img.key, img.url);
    });
    Object.entries(localMedia || {}).forEach(([key, url]) => {
      if (!key || !url || isProxyUrl(url)) return;
      rememberCdnBase(url);
      map.set(key, url);
    });
    return map;
  }, [allImages, localMedia, cdnBase]);
  // Uploads land in `localMedia` before the project list refreshes, so the
  // Select images sheet can show them in the same visit.
  const imagePool = useMemo(() => {
    const seen = new Set(allImages.map((i) => i.url));
    const extra = Object.entries(localMedia)
      .filter(([, url]) => url && !seen.has(url))
      .map(([key, url]) => ({ key, url, thumb: url, projectName: 'Uploaded' }));
    return extra.length ? [...extra, ...allImages] : allImages;
  }, [allImages, localMedia]);
  // Palette + type set on the Visual Brand page, reflected in the post preview.
  const vbStore = useStore();
  const igVars = useMemo(() => brandStyleVars(vbStore), [vbStore]);
  const days = route?.days || [];
  const day = days[selected] || days[0];

  const enrichedDays = useMemo(() => {
    // Render only the images the plan actually assigns (persisted assetKeys).
    // A slide with no assigned photo shows empty picture regions rather than
    // borrowing one from another post.
    const used = new Set();
    return days.map((d) => {
      const slides = bindOwnedSlides(deriveSlides(d), allImages, localMedia, used);
      return { ...d, slides, status: dayAssetStatus(slides, d.published) };
    });
  }, [days, allImages, localMedia]);

  useEffect(() => {
    const el = calGridRef.current;
    if (!el) return undefined;
    const read = () => {
      setCalMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
      setCalPrev(el.scrollLeft > 4);
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', read); ro?.disconnect(); };
  }, [enrichedDays.length]);

  useEffect(() => {
    const g = calGridRef.current;
    const card = g?.children[selected];
    if (!g || !card || g.scrollWidth <= g.clientWidth) return;
    if (calPlacedFor.current === selected) return;
    calPlacedFor.current = selected;
    const left = card.offsetLeft;
    const right = left + card.offsetWidth;
    if (left < g.scrollLeft) g.scrollTo({ left: Math.max(0, left - 8), behavior: 'smooth' });
    else if (right > g.scrollLeft + g.clientWidth) g.scrollTo({ left: right - g.clientWidth + 8, behavior: 'smooth' });
  }, [selected, calMore]);

  const enriched = enrichedDays[selected] || enrichedDays[0];
  const slides = enriched?.slides || [];
  const safeIdx = Math.min(slideIdx, Math.max(slides.length - 1, 0));
  const activeSlide = slides[safeIdx] || null;
  const handle = route?.instagramUsername || 'your.studio';
  // A post is "scheduled" when it carries a slot and hasn't gone out yet. The
  // slot only means anything with an account to publish to (bauhly-v3 §783).
  const isScheduled = metaStatus.connected && !!day?.scheduledAt && !day?.published;
  const slotTime = toSpoken(slotTimeRaw(day, route));
  // the time is editable only while the decision is still open (bauhly-v3 §787)
  const canEditTime = !isScheduled && !day?.published;
  const timeSeedAt = to24h(slotTimeRaw(day, route));
  const timeSeedEvery = !day?.time && !!route?.postAtPref;
  const timeUnchanged = Boolean(timeDraft)
    && timeDraft.at === timeSeedAt
    && Boolean(timeDraft.every) === Boolean(timeSeedEvery);
  const captionText = String(day?.content?.caption || '').trim();
  const captionCta = String(day?.content?.cta || '').trim();
  const captionTags = hashtagsOf(day);
  const capNeedsReview = Boolean(captionText) && !isScheduled && !day?.published && !capReviewed.has(selected);

  useEffect(() => {
    setCreating(false);
    setTimeDraft(null);
    setClockOpen(false);
    setAdjustFor(null);
    setEditSlot(null);
    setPackOpen(false);
  }, [selected, safeIdx]);

  function selectDay(i) {
    setSelected(i);
    setSlideIdx(0);
    setZone(null);
    setVisEdit(null);
    setWhyOpen(false);
    setSideTab('caption');
    setPickerOpen(false);
    setCreating(false);
    setImgPick(null);
    setAskImgs(0);
  }

  // Change day with the reference's slide transition: a ghost copy of the post
  // slides out and fades while the real (new) post slides in and rises from the
  // opposite side (bauhly-v3 §730/§736/§786). The ghost is a plain DOM clone,
  // positioned where the original stands inside the clipping stage, and removed
  // once its animation ends. The move is skipped — the day simply changes —
  // when an editor or the strategy panel is open (their heights differ from the
  // arriving card) or the studio has asked for no motion.
  function animateToDay(nextIdx, dirIn) {
    const next = Math.max(0, Math.min(days.length - 1, nextIdx));
    if (next === selected) return;
    const dir = dirIn || (next > selected ? 1 : -1);
    const reduced = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const wrap = document.querySelector('.wv-postwrap');
    // the ghost lives in the stage (the content-wide row), so it slides across
    // the open space beside the post and clips only near the content edge
    const host = wrap?.closest('.wv-stage');
    if (!wrap || !host || reduced || zone || whyOpen) { selectDay(next); return; }

    const r = wrap.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const ghost = wrap.cloneNode(true);
    // a copy taken mid-arrival must not carry the arrival's class or inline
    // transform, or it would compose with the departure and fly twice as far
    ghost.classList.remove('is-in-r', 'is-in-l');
    ghost.style.translate = '';
    ghost.style.scale = '';
    ghost.classList.add('wv-postwrap--ghost', dir > 0 ? 'is-out-l' : 'is-out-r');
    ghost.style.left = `${Math.round(r.left - h.left)}px`;
    ghost.style.top = `${Math.round(r.top - h.top)}px`;
    ghost.style.width = `${Math.round(r.width)}px`;
    ghost.setAttribute('aria-hidden', 'true');
    host.appendChild(ghost);
    // removed after its LAST animation ends — movement 760ms, dissolve 700ms
    window.setTimeout(() => { ghost.remove(); }, 920);

    setEnter(dir);
    selectDay(next);
  }

  // Pressed from an arrow that sits where the cards are about to move: the arrow
  // leaves first (140ms fade), then after ARROW_OUT the cards slide, then the
  // arrows come back once the move has stopped (bauhly-v3 §725). Day CARDS call
  // animateToDay directly — nothing overlaps the motion there.
  const ARROW_OUT = 160;
  function goFromArrow(nextIdx, dir) {
    if (navOut) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (reduced || zone || whyOpen) { animateToDay(nextIdx, dir); return; }
    setNavOut(true);
    window.setTimeout(() => animateToDay(nextIdx, dir), ARROW_OUT);
    window.setTimeout(() => setNavOut(false), ARROW_OUT + 840);
  }
  function prevDay() { if (selected > 0) goFromArrow(selected - 1, -1); }
  function nextDay() { if (selected < days.length - 1) goFromArrow(selected + 1, 1); }

  // The carousel's own arrows (the INNER pair, on the picture): step through the
  // slides, and at the last slide the forward arrow leaves the post for the next
  // day (bauhly-v3 §672/§692 — here as a click, where the reference took a
  // second swipe). The OUTER pair (`.wv-daynav`) always moves the whole day.
  function prevSlide() { if (safeIdx > 0) setSlideIdx(safeIdx - 1); }
  function nextSlideOrDay() {
    if (safeIdx < slides.length - 1) setSlideIdx(safeIdx + 1);
    else if (selected < days.length - 1) nextDay();
  }

  // the arriving card's class comes off once it has arrived, so a card simply
  // sitting there carries no animation state
  useEffect(() => {
    if (!enter) return undefined;
    const t = window.setTimeout(() => setEnter(0), 820);
    return () => window.clearTimeout(t);
  }, [enter, selected]);

  // Open one of the post's editors. Opening the picture closes the words, and
  // vice-versa — a single value can only name one zone. Opening the caption
  // seeds its draft from the day's current caption.
  function openZone(next) {
    setVisEdit(null); // the visual zone always opens on its MENU, not an editor
    if (next === 'caption') setSideTab('caption');
    if (next) setTimeDraft(null);
    setZone((cur) => {
      const target = cur === next ? null : next;
      if (target === 'caption') {
        setCapDraft(day?.content?.caption || '');
        setTagDraft(formatHashtagLine(hashtagsOf(day)));
      }
      if (target !== 'visual') {
        setCreating(false);
        setPickerOpen(false);
        setImgPick(null);
        setAskImgs(0);
      }
      return target;
    });
  }

  function closeZone() {
    setZone(null);
    setVisEdit(null);
    setPickerOpen(false);
    setCreating(false);
    setImgPick(null);
    setAskImgs(0);
    setCapBusy(false);
    setWordsBusy(false);
  }

  // Press anywhere outside the caption editor and it closes without saving —
  // the same rule as bauhly-v3 §665. Done (Apply changes) is the only commit;
  // the draft lives in `capDraft` and goes with the close. Mousedown, not click,
  // so a press on another edit control can switch editors in one gesture (§849).
  useEffect(() => {
    if (zone !== 'caption') return undefined;
    const away = (e) => {
      if (e.target.closest('.wv-ig__zone--caption.is-editing')) return;
      if (e.target.closest('.wv-ig__edit') || e.target.closest('.wv-ig__menu')
        || e.target.closest('.wv-ig__menuscrim')) return;
      if (e.target.closest('.wv-vlib') || e.target.closest('.wv-vlib__scrim')) return;
      if (e.target.closest('.wv-confirm') || e.target.closest('.wv-confirm__scrim')) return;
      if (e.target.closest('.wv-imgs') || e.target.closest('.wv-imgs__chat')) return;
      if (e.target.closest('.wv-schedask') || e.target.closest('.wv-schedask__scrim')) return;
      if (e.target.closest('.wv-ig__zonebtn') || e.target.closest('.wv-ig__tabedit')) return;
      closeZone();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [zone]);

  // Same leave-without-commit for the time editor: the draft lives in
  // `timeDraft` and goes with a press anywhere else. Apply changes is the
  // only write.
  useEffect(() => {
    if (!timeDraft) return undefined;
    const away = (e) => {
      if (e.target.closest('.wv-time')) return;
      if (e.target.closest('.wv-ig__slot-edit') || e.target.closest('.wv-ig__zonebtn')) return;
      if (e.target.closest('.wv-confirm') || e.target.closest('.wv-confirm__scrim')) return;
      if (e.target.closest('.wv-schedask') || e.target.closest('.wv-schedask__scrim')) return;
      setTimeDraft(null);
      setClockOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [timeDraft]);

  // Layout picks are a draft until Apply changes — press elsewhere to abandon.
  useEffect(() => {
    if (zone !== 'visual' || visEdit !== 'layout') return undefined;
    const away = (e) => {
      if (e.target.closest('.wv-layed')) return;
      if (e.target.closest('.wv-vlib') || e.target.closest('.wv-vlib__scrim')) return;
      if (e.target.closest('.wv-confirm') || e.target.closest('.wv-confirm__scrim')) return;
      if (e.target.closest('.wv-ig__zonebtn') || e.target.closest('.wv-ig__menu')
        || e.target.closest('.wv-ig__menuscrim')) return;
      setVisEdit(null);
      setLayPick(null);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [zone, visEdit]);

  // Edit text is the same draft rule: leave without Apply and the words go back.
  useEffect(() => {
    if (zone !== 'visual' || visEdit !== 'words') return undefined;
    const away = (e) => {
      if (e.target.closest('.wv-worded')) return;
      if (e.target.closest('.wv-ig__zonebtn') || e.target.closest('.wv-ig__menu')
        || e.target.closest('.wv-ig__menuscrim')) return;
      setVisEdit(null);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [zone, visEdit]);

  useEffect(() => {
    if (visEdit !== 'layout') {
      setLayPick(null);
      setLayCat(null);
      setLibOpen(false);
      setAskCat(null);
    }
    if (visEdit !== 'words') setWordDraft(null);
  }, [visEdit]);

  useLayoutEffect(() => {
    if (zone !== 'caption') return;
    const el = capTaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(240, Math.max(120, el.scrollHeight))}px`;
  }, [capDraft, zone]);

  useEffect(() => {
    function onKey(e) {
      // Escape steps back one level: generate → images → browse → editor → menu
      if (e.key !== 'Escape') return;
      if (timeDraft) { setTimeDraft(null); setClockOpen(false); return; }
      if (adjustFor) { setAdjustFor(null); setEditSlot(null); return; }
      if (packOpen) { setPackOpen(false); return; }
      if (creating) { setCreating(false); return; }
      if (imgPick) { setImgPick(null); return; }
      if (askImgs) { setAskImgs(0); return; }
      if (!zone) return;
      if (askCat) { setAskCat(null); return; }
      if (libOpen) { setLibOpen(false); return; }
      if (visEdit) setVisEdit(null);
      else closeZone();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zone, visEdit, libOpen, askCat, askImgs, imgPick, creating, timeDraft, adjustFor, packOpen]);

  // Persist the caption for the open day — optimistic, then reconciled with the
  // server's copy. Backend whitelists `content.caption` (routeController §642).
  async function saveCaption(text) {
    if (!route?._id) return;
    const clean = String(text || '');
    const tags = parseHashtagLine(tagDraft);
    setRoute((prev) => {
      const daysCopy = [...(prev.days || [])];
      const d = { ...daysCopy[selected] };
      d.content = { ...(d.content || {}), caption: clean, hashtags: tags };
      daysCopy[selected] = d;
      return { ...prev, days: daysCopy };
    });
    setZone(null);
    setCapReviewed((s) => {
      const next = new Set(s);
      next.add(selected);
      return next;
    });
    setSaving(true);
    try {
      const updated = await updateDayContent(route._id, selected, { caption: clean, hashtags: tags });
      setRoute(updated);
    } catch { /* keep local until retry */ }
    finally { setSaving(false); }
  }

  async function persistSlides(nextSlides, dayIndex = selected) {
    if (!route?._id) return;
    const gen = ++persistGenRef.current;
    const payload = slidesPayload(nextSlides, lastSavedByDayRef.current[dayIndex] || []);
    setSaving(true);
    try {
      const updated = await updateDayContent(route._id, dayIndex, { slides: payload });
      if (gen !== persistGenRef.current) return;
      const saved = updated?.days?.[dayIndex]?.content?.slides;
      if (Array.isArray(saved)) lastSavedByDayRef.current[dayIndex] = saved;
      setRoute(updated);
      onRouteChange?.(updated);
    } catch { /* keep local until retry */ }
    finally {
      if (gen === persistGenRef.current) setSaving(false);
    }
  }

  function replaceSlides(next, { persist = true, dayIndex = selected } = {}) {
    setRoute((prev) => {
      const daysCopy = [...(prev.days || [])];
      const d = { ...daysCopy[dayIndex] };
      const content = {
        ...(d.content || {}),
        slides: next.map((s) => slideRecord(s)),
        onScreenText: next.map((s) => s.title),
      };
      daysCopy[dayIndex] = { ...d, content };
      return { ...prev, days: daysCopy };
    });
    if (persist) persistSlides(next, dayIndex);
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
    setSlideIdx((cur) => Math.min(cur, next.length - 1));
  }

  function rememberImage(key, url, meta = {}) {
    setLocalMedia((m) => ({ ...m, [key]: url }));
    if (!meta.skipGen) {
      setGenImages((list) =>
        list.some((g) => g.key === key)
          ? list
          : [{ key, url, prompt: meta.prompt || '', model: meta.model || '', addedAt: meta.addedAt || Date.now() }, ...list],
      );
    }
  }

  function putImgUrl(url) {
    setImgPick((v) => {
      if (!v) return v;
      const next = [...v.slots];
      const here = next.indexOf(url);
      if (here >= 0) { next[here] = null; return { ...v, slots: next, at: here }; }
      const i = v.at ?? 0;
      next[i] = url;
      const nextEmpty = next.findIndex((u) => !u);
      return { ...v, slots: next, at: nextEmpty >= 0 ? nextEmpty : i };
    });
  }

  function setImgSlot(url) {
    setImgPick((v) => {
      if (!v) return v;
      const next = [...v.slots];
      const i = v.at ?? 0;
      next[i] = url;
      const nextEmpty = next.findIndex((u) => !u);
      return { ...v, slots: next, at: nextEmpty >= 0 ? nextEmpty : i };
    });
  }

  async function onPickerUpload(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setUploading(true);
    try {
      const added = await uploadFiles(list);
      const first = added[0];
      if (!first) return;
      rememberImage(first.key, first.url, { skipGen: true });
      setImgSlot(first.url);
    } catch { /* ignore */ }
    finally { setUploading(false); }
  }

  // A freshly generated image — same path as an upload: give it an instant
  // local URL. From Select images it fills the active slot until Apply;
  // anywhere else it lands on the slide immediately.
  function onImageCreated(key, url, meta = {}, { slot } = {}) {
    if (!key) return;
    rememberImage(key, url, meta);
    if (slot) {
      setImgSlot(url);
      setCreating(false);
      return;
    }
    patchActiveSlide({ assetKey: key, assetKeys: [key, ...keysOf(activeSlide).slice(1)] });
    setCreating(false);
    setPickerOpen(false);
  }

  function claimStandingImage() {
    if (activeSlide?.image?.key) {
      patchActiveSlide({
        assetKey: activeSlide.image.key,
        assetKeys: [activeSlide.image.key, ...keysOf(activeSlide).slice(1)],
      });
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

  // ── Schedule this post (bauhly-v3 §739/§742). Pressing "Schedule" records the
  // intent to publish at the day's slot; a post with no caption is a real thing
  // to schedule (a photo can be the whole of it), so we ask once rather than
  // block. "Unschedule" puts it back. Publishing itself stays a real action —
  // see the "Publish now" affordance on a scheduled post.
  async function doSchedule() {
    if (!route || !day || scheduling) return;
    setPublishMsg('');
    setScheduling(true);
    try {
      const at = slotDateOf(route, selected, day).toISOString();
      setRoute(await scheduleDay(route._id, selected, at));
    } catch (err) {
      setPublishMsg(err.response?.data?.message || 'Could not schedule just now');
    } finally {
      setScheduling(false);
    }
  }

  function pressSchedule() {
    if (!route || !day || scheduling) return;
    if (!metaStatus.connected) { setConnectOpen(true); return; }
    const caption = day.content?.caption?.trim();
    if (!caption) { setAskSchedule(true); return; }
    doSchedule();
  }

  async function unschedule() {
    if (!route || !day || scheduling) return;
    setPublishMsg('');
    setScheduling(true);
    try {
      setRoute(await scheduleDay(route._id, selected, null));
    } catch (err) {
      setPublishMsg(err.response?.data?.message || 'Could not unschedule just now');
    } finally {
      setScheduling(false);
    }
  }

  // ── Edit publish time (bauhly-v3 §790/§794). The time is edited in the post,
  // on the slot's own surface. Opening it seeds the draft from the effective
  // time and whether that time is the plan's weekly one.
  function openTimeEditor() {
    if (!day) return;
    setPublishMsg('');
    closeZone();
    setTimeDraft({
      at: to24h(slotTimeRaw(day, route)),
      every: !day.time && !!route?.postAtPref,
    });
    setClockOpen(true);
  }

  // Done — three outcomes from two controls, the same rule the slot reads:
  //   every week      → the plan's habit; this post drops its own time
  //   this post only  → a time on this post
  //   default (reset) → neither: clear the habit too, or the next post inherits
  //                     the thing they just stepped out of
  async function saveTime() {
    if (!route || !day || !timeDraft || savingTime || timeUnchanged) return;
    const { at, every } = timeDraft;
    let payload;
    if (every) payload = { postAtPref: at, time: '' };
    else if (at === DEFAULT_TIME_24) payload = { postAtPref: '', time: '' };
    else payload = { time: at };
    setSavingTime(true);
    try {
      setRoute(await setDayTime(route._id, selected, payload));
      setTimeDraft(null);
      setClockOpen(false);
    } catch (err) {
      setPublishMsg(err.response?.data?.message || 'Could not save the time just now');
    } finally {
      setSavingTime(false);
    }
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
      // Publish the composed post — the full layout for each slide (ground +
      // on-screen words + photo), exactly as the preview shows it. Each slide's
      // composition is rendered off-screen at Instagram resolution (1080×1350,
      // 4:5) and rasterised to a JPEG; posting the bare project photos would drop
      // all the text and layout. The rendered JPEGs are uploaded to the user's
      // own media prefix, then the backend re-presigns each key server-side.
      setPublishMsg('Rendering slides…');
      const nodes = exportRefs.current.slice(0, slides.length).filter(Boolean);
      if (!nodes.length) throw new Error('Nothing to render for this post yet.');
      const blobs = [];
      for (const node of nodes) {
        // First pass primes html-to-image's image/font embedding; the second
        // renders reliably once those resources are cached.
        await rasterizeSlide(node).catch(() => null);
        const blob = await rasterizeSlide(node);
        if (blob) blobs.push(blob);
      }
      if (!blobs.length) throw new Error('Could not render the slides to publish.');

      setPublishMsg('Uploading…');
      const files = blobs.map((b, i) => new File([b], `slide-${i + 1}.jpg`, { type: 'image/jpeg' }));
      const uploaded = await uploadFiles(files);
      const imageKeys = uploaded.map((u) => u.key).filter(Boolean);
      if (!imageKeys.length) throw new Error('Could not prepare the rendered slides for publishing.');

      setPublishMsg('Posting to Instagram…');
      const result = await publishDayToMeta(route._id, selected, { imageKeys });
      if (result.route) setRoute(result.route);
      setPublishMsg(result.live ? 'Posted to Instagram' : (result.message || 'Published'));
    } catch (err) {
      // Surface the real cause: server error body, thrown message, then a
      // generic fallback. Log the raw error + any server payload so a failed
      // publish can be diagnosed from the console.
      console.error('[publish] failed:', err, err.response?.status, err.response?.data);
      if (err.response?.data?.code === 'META_NOT_CONNECTED') {
        setMetaStatus((s) => ({ ...s, connected: false }));
        setConnectOpen(true);
      } else {
        setPublishMsg(err.response?.data?.message || err.message || 'Could not publish just now');
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

  // Add posts to the next empty days of this month from the latest signals.
  // Existing days with content are left alone.
  async function handleReplanWeek() {
    if (replanning || !route?._id) return;
    const ok = window.confirm(
      "Add posts to empty days this month from your latest Brand DNA, Capture Idea notes, project assets and competitor insights?\n\nDays that already have content stay as they are."
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
        setVisEdit(null);
      }
    } catch (err) {
      setReplanMsg(err?.response?.data?.message || 'Could not replan this week. Try again in a moment.');
    } finally {
      setReplanning(false);
    }
  }

  const weekUsage = weekUsageOf(route);

  // The layouts this empty slide can take — its own category first, then the
  // "Image only" / "Create image" pair — and a sliding window of three with an
  // arrow at each end (bauhly-v3 YourWeek `EmptySlide`).
  const slideRoleName = activeSlide?.role || 'Hook';
  const layoutBrowseCat = layCat || catForRole(slideRoleName);
  const pickerImages = useMemo(() => {
    if (!allImages.length) return [];
    const dayText = [day?.title, day?.direction, day?.content?.caption, day?.contentType].filter(Boolean).join(' ');
    const words = keywordSet(`${activeSlide?.title || ''} ${dayText}`);
    return allImages
      .map((img) => ({ img, score: relevanceScore(words, img) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.img);
  }, [allImages, activeSlide?.title, day]);
  const slideLayouts = useMemo(() => {
    const own = layoutsForSlide(slideRoleName, vbStore, visEdit === 'layout' ? layoutBrowseCat : null);
    const applied = layoutForSlide(activeSlide, vbStore, slideRoleName);
    if (!applied) return own;
    if (visEdit === 'layout' && layoutBrowseCat && applied.cat !== layoutBrowseCat) return own;
    if (own.some((l) => l.id === applied.id)) {
      return [applied, ...own.filter((l) => l.id !== applied.id)];
    }
    return [applied, ...own];
  }, [slideRoleName, vbStore, visEdit, layoutBrowseCat, activeSlide?.layout]);
  // the studio's palette + faces, so the previews here read exactly as they do
  // in the Visual Library (empty object = the library's shipped defaults)
  const libPaint = useMemo(() => paintOf(vbStore?.libraryEdits), [vbStore?.libraryEdits]);
  const roleLayouts = useMemo(
    () => layoutsForSlide(slideRoleName, vbStore),
    [slideRoleName, vbStore],
  );
  const appliedLayout = layoutForSlide(activeSlide, vbStore, slideRoleName) || roleLayouts[0] || null;
  const appliedId = appliedLayout?.id || null;
  const draftId = visEdit === 'layout' ? (layPick || appliedId) : appliedId;
  const chosenLayout = (visEdit === 'layout' && layPick
    ? findLayout(layPick, vbStore)
    : null) || appliedLayout;
  const chosenLayoutIdx = Math.max(0, slideLayouts.findIndex((l) => l.id === draftId));
  const layoutCatLabel = (CATEGORIES.find((c) => c.id === layoutBrowseCat) || {}).label || '';
  const layoutUnchanged = Boolean(draftId) && draftId === appliedId;
  const wordRoles = visEdit === 'words' ? textRolesOf(chosenLayout) : [];
  const primaryWordKey = wordRoles.find((r) => r.key === 'head')?.key
    || wordRoles.find((r) => r.key === 'body')?.key
    || wordRoles[0]?.key;
  const wordsSeed = visEdit === 'words'
    ? seedWordDraft(chosenLayout, activeSlide, day?.contentType || day?.format)
    : null;
  const wordsUnchanged = Boolean(wordDraft && wordsSeed
    && Object.keys({ ...wordsSeed, ...wordDraft }).every(
      (k) => plainOf(wordDraft[k] || '') === plainOf(wordsSeed[k] || ''),
    ));

  useEffect(() => {
    if (visEdit !== 'words') return;
    setWordDraft(seedWordDraft(chosenLayout, activeSlide, day?.contentType || day?.format));
  }, [visEdit, selected, safeIdx, chosenLayout?.id]);

  const wordFills = useMemo(() => {
    const fromCap = String(day?.content?.caption || '')
      .split(/\n+|(?<=[.!?])\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 12 && t.length < 120);
    const others = slides.map((s, i) => (i === safeIdx ? '' : s.title)).filter(Boolean);
    return [...fromCap, ...others];
  }, [day?.content?.caption, slides, safeIdx]);

  function applyWords() {
    const roles = textRolesOf(chosenLayout);
    const hasHead = roles.some((r) => r.key === 'head');
    const hasBody = roles.some((r) => r.key === 'body');
    const primary = hasHead ? 'head' : (hasBody ? 'body' : roles[0]?.key);
    const title = capText(plainOf(wordDraft?.[primary] || ''));
    const patch = { title };
    if (hasHead && hasBody) patch.subtitle = capText(plainOf(wordDraft?.body || ''));
    patchActiveSlide(patch);
    setVisEdit(null);
    setZone(null);
  }

  function applyLayout() {
    if (!draftId || layoutUnchanged) return;
    const need = shotsOf(chosenLayout);
    patchActiveSlide({ layout: draftId });
    setLayPick(null);
    if (need > 0) {
      setAskImgs(need);
      return;
    }
    setVisEdit(null);
    setZone(null);
  }

  function openImagePicker() {
    const n = Math.max(1, shotsOf(chosenLayout));
    const saved = keysOf(activeSlide).map((k) => urlForKey(k, activeSlide, localMedia, mediaByKey));
    const fromSaved = Array.from({ length: n }, (_, i) => saved[i] || null);
    if (fromSaved.some(Boolean)) {
      const empty = fromSaved.findIndex((u) => !u);
      setImgPick({ slots: fromSaved, at: empty >= 0 ? empty : 0 });
      return;
    }
    const urls = pickerImages.map((i) => i.url).filter(Boolean);
    const current = activeSlide?.image?.url || null;
    const ranked = current ? [current, ...urls.filter((u) => u !== current)] : urls;
    setImgPick({
      slots: Array.from({ length: n }, (_, i) => ranked[i] || null),
      at: 0,
    });
  }

  function applyImgPick() {
    if (!imgPick) return;
    const slots = imgPick.slots || [];
    if (!slots.some(Boolean)) { setImgPick(null); return; }
    const keyOf = (url) => {
      if (!url) return '';
      const img = imagePool.find((i) => i.url === url || i.thumb === url);
      return img?.key || Object.entries(localMedia).find(([, u]) => u === url)?.[0] || '';
    };
    const keys = slots.map(keyOf);
    const extra = {};
    slots.forEach((url, i) => { if (url && keys[i]) extra[keys[i]] = url; });
    if (Object.keys(extra).length) setLocalMedia((m) => ({ ...m, ...extra }));
    patchActiveSlide({ assetKey: keys.find(Boolean) || '', assetKeys: keys });
    setImgPick(null);
  }

  const slideKind = day?.contentType || day?.format;
  const dressedLayout = withSlidePhoto(
    fillLayout(chosenLayout, activeSlide, slideKind),
    activeSlide,
    localMedia,
    mediaByKey,
  );
  const hasEditImage = (dressedLayout?.imgs || []).some(Boolean) || Boolean(photoUrl(activeSlide, localMedia, mediaByKey));
  const slotPackItems = (dressedLayout?.imgs || [])
    .map((url, i) => (url ? { i, url } : null))
    .filter(Boolean);

  function measureSlot(n = 0) {
    const ph = document.querySelectorAll('.wv-ig__media .vl-ph');
    const el = ph[n] || ph[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 4 && r.height > 4)) return null;
    return {
      ratio: r.width / r.height,
      radius: window.getComputedStyle(el).borderRadius,
      name: chosenLayout?.name || null,
    };
  }

  function editorSrc(slotIndex = 0) {
    const keys = keysOf(activeSlide);
    const key = keys[slotIndex] || (slotIndex === 0 ? (activeSlide?.assetKey || activeSlide?.image?.key || '') : '');
    if (key && localMedia?.[key]) return canvasSafeUrl(localMedia[key], key);
    if (key && mediaByKey?.has(key)) return mediaProxyUrl(key);
    return canvasSafeUrl((dressedLayout?.imgs || [])[slotIndex] || '', key) || null;
  }

  function writeSlotKey(key, slotIndex, { persist = true, dayIndex = selected, slideAt = safeIdx } = {}) {
    const prev = routeRef.current || {};
    const daysCopy = [...(prev.days || [])];
    const d = { ...(daysCopy[dayIndex] || {}) };
    const base = deriveSlides(d);
    const slide = base[slideAt] || {};
    const keys = [...keysOf(slide)];
    while (keys.length <= slotIndex) keys.push('');
    keys[slotIndex] = key;
    const next = base.map((s, i) => (
      i === slideAt ? { ...s, assetKey: keys.find(Boolean) || key, assetKeys: keys } : s
    ));
    const content = {
      ...(d.content || {}),
      slides: next.map((s) => slideRecord(s)),
      onScreenText: next.map((s) => s.title),
    };
    daysCopy[dayIndex] = { ...d, content };
    const nextRoute = { ...prev, days: daysCopy };
    routeRef.current = nextRoute;
    setRoute(nextRoute);
    if (persist && isProjectMediaKey(key)) persistSlides(next, dayIndex);
  }

  async function commitEditedUrl(url, slotIndex = 0) {
    const dayIndex = selected;
    const slideAt = safeIdx;
    const localKey = `edit-${Date.now()}-${slotIndex}`;
    rememberImage(localKey, url, { skipGen: true });
    writeSlotKey(localKey, slotIndex, { persist: false, dayIndex, slideAt });
    try {
      const blob = await fetch(url).then((r) => r.blob());
      const file = new File([blob], 'edited.jpg', { type: blob.type || 'image/jpeg' });
      const added = await uploadFiles([file]);
      const first = added[0];
      if (!first?.key) return;
      rememberImage(first.key, first.url || url, { skipGen: true });
      writeSlotKey(first.key, slotIndex, { persist: true, dayIndex, slideAt });
    } catch { /* keep the local preview */ }
  }

  async function replaceEditedFile(file, slotIndex = 0) {
    if (!file) return;
    const dayIndex = selected;
    const slideAt = safeIdx;
    const preview = URL.createObjectURL(file);
    const localKey = `edit-${Date.now()}-${slotIndex}`;
    rememberImage(localKey, preview, { skipGen: true });
    writeSlotKey(localKey, slotIndex, { persist: false, dayIndex, slideAt });
    try {
      const added = await uploadFiles([file]);
      const first = added[0];
      if (!first?.key) return;
      rememberImage(first.key, first.url || preview, { skipGen: true });
      writeSlotKey(first.key, slotIndex, { persist: true, dayIndex, slideAt });
    } catch { /* keep the local preview */ }
  }

  function openAdjust() {
    const n = shotsOf(chosenLayout || {});
    setVisEdit(null);
    setZone(null);
    if (n > 1 && slotPackItems.length > 0) {
      setPackOpen(true);
      return;
    }
    const i = slotPackItems[0]?.i || 0;
    const src = editorSrc(i);
    if (!src) return;
    setEditSlot(measureSlot(i));
    setAdjustFor({ src, slotIndex: i });
  }

  function downloadSrc(src, name = 'bauhly-photo.jpg') {
    if (!src) return;
    const el = document.createElement('a');
    el.href = src;
    el.download = name;
    document.body.appendChild(el);
    el.click();
    el.remove();
  }

  // Each rail slide resolved to its OWN chosen layout — the same composition the
  // big preview draws for that slide — so the vertical rail and the IG preview
  // always show the same picture for a given slide (never out of sync).
  const slideThumbLayout = (s) => {
    const role = s.role || 'Hook';
    return layoutForSlide(s, vbStore, role) || layoutsForSlide(role, vbStore)[0] || null;
  };
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
  const isDesktop = useMediaQuery('(min-width: 961px)');
  const layoutEditing = zone === 'visual' && visEdit === 'layout';
  const wordsEditing = zone === 'visual' && visEdit === 'words';
  const pickerLayouts = isDesktop ? slideLayouts : shownLayouts;

  const layoutPickerCards = (list) => list.map((l) => (
    <button
      key={l.id}
      type="button"
      role="radio"
      aria-checked={draftId === l.id}
      aria-label={l.name || l.id}
      className={`wv-act wv-act--layout${draftId === l.id ? ' is-on' : ''}`}
      onClick={() => setLayPick(l.id)}
      title={l.name}
    >
      <span className="wv-act__shot">
        <Preview mood={false} l={l} />
      </span>
      {l.id === appliedId && <span className="wv-act__now">Current</span>}
    </button>
  ));

  return (
    <div className="wv" style={libPaint}>
      {/* ── the way back, and the plan's actions ─────────────────────────── */}
      <div className="wv-top">
        <button type="button" className="wv-back" onClick={onBack}>
          <Glyph name="arrow-left" size={15} />Your plans
        </button>
        <div className="wv-top__actions">
          <button
            type="button"
            className="wv-abtn"
            onClick={() => setAnalysisOpen(true)}
            aria-label="Your analysis"
            title="Your analysis"
          >
            <Glyph name="bar-chart-2" size={15} />
            <span className="wv-abtn__t">Your analysis</span>
          </button>
          <button
            type="button"
            className="wv-abtn"
            onClick={handleExport}
            aria-label="Export"
            title="Export"
          >
            <Glyph name="download" size={15} />
            <span className="wv-abtn__t">Export</span>
          </button>
          <div className="wv-more">
            <button
              type="button"
              className="wv-abtn wv-abtn--icon"
              aria-label="More actions"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <Glyph name="more-horizontal" size={18} />
            </button>
            {moreOpen && (
              <>
                <div className="wv-more__scrim" onClick={() => setMoreOpen(false)} />
                <div className="wv-more__menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="wv-more__item"
                    onClick={() => { setMoreOpen(false); setCapturing(true); }}
                  >
                    <Glyph name="plus" size={15} />Capture idea
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="wv-more__item"
                    onClick={() => { setMoreOpen(false); handleReplanWeek(); }}
                    disabled={replanning}
                    title="Add posts to empty days this month from your Brand DNA, Capture Idea notes, project assets and competitor insights. Days that already have content stay as they are."
                  >
                    <Glyph name="refresh-cw" size={15} />{replanning ? 'Adding posts…' : 'Fill empty days'}
                  </button>
                  {weekUsage && (
                    <p className="wv-more__usage">
                      {fmtTokens(weekUsage.totalTokens)} tokens · ~{fmtCost(weekUsage.estimatedCostUsd)} est.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {capturing && (
        <CaptureChat
          defaultProjectId={projects[0]?.id}
          exitLabel="Back to plan"
          onExit={() => setCapturing(false)}
          onViewProject={() => { setCapturing(false); navigate('/dashboard/projects'); }}
          onCaptured={() => {
            setCapturing(false);
            onCaptured?.();
          }}
        />
      )}

      {/* ── the plan's dates, and which week of the month ────────────────── */}
      <div className="wv-head">
        <h1 className="wv-head__title">{route.weekLabel || route.focus?.headline || 'Your week'}</h1>
        <div className="wv-head__side">
          {saving && <span className="wv-head__chip">Saving…</span>}
          {replanning && <span className="wv-head__chip">Adding posts to empty days…</span>}
          {replanMsg && <span className="wv-head__chip is-warn">{replanMsg}</span>}
          {monthWeeks.length > 1 && (
            <span className="wv-head__week">
              <WeekNav
                weekIdx={Math.max(0, monthWeeks.findIndex((w) => String(w._id) === String(route._id)))}
                weekCount={monthWeeks.length}
                onPick={(i) => {
                  const next = monthWeeks[Math.max(0, Math.min(monthWeeks.length - 1, i))];
                  if (next && String(next._id) !== String(route._id)) onOpenWeek?.(next);
                }}
              />
            </span>
          )}
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

      {/* ask once, only when it matters (bauhly-v3 §742): a post with no caption
          is a real thing to schedule, so this is a question, not a block. */}
      {askSchedule && (
        <>
          <div className="wv-schedask__scrim" onClick={() => setAskSchedule(false)} />
          <div className="wv-schedask" role="dialog" aria-modal="true" aria-label="Schedule without a caption?">
            <span className="wv-schedask__mark"><Glyph name="clock" size={20} strokeWidth={2} /></span>
            <h2 className="wv-schedask__title">Schedule without a caption?</h2>
            <p className="wv-schedask__body">
              This post has no caption yet. A photo can be the whole of it — but if you
              meant to write one, add it first.
            </p>
            <div className="wv-schedask__acts">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => { setAskSchedule(false); doSchedule(); }}
              >
                Schedule anyway
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => { setAskSchedule(false); openZone('caption'); }}
              >
                Add a caption first
              </button>
            </div>
          </div>
        </>
      )}

      {libOpen && visEdit === 'layout' && (
        <LibraryPick
          current={layoutBrowseCat}
          layoutId={draftId}
          onPick={(id) => {
            setLibOpen(false);
            if (id === layoutBrowseCat) return;
            setLayCat(id);
            setLayPick(null);
            setLayWinStart(0);
          }}
          onLayout={(l) => {
            if (!l?.id) return;
            if (l.cat && l.cat !== layoutBrowseCat) setLayCat(l.cat);
            setLayPick(l.id);
            setLayWinStart(0);
          }}
          onClose={() => setLibOpen(false)}
        />
      )}

      {askCat && (
        <AdaptCategoryDialog
          label={askCat.label}
          onContinue={() => {
            const { id } = askCat;
            setAskCat(null);
            setLayCat(id);
            setLayPick(null);
            setLayWinStart(0);
          }}
          onClose={() => setAskCat(null)}
        />
      )}

      {askImgs > 0 && (
        <AddImagesDialog
          count={askImgs}
          onSkip={() => { setAskImgs(0); setVisEdit(null); setZone(null); }}
          onAdd={() => { setAskImgs(0); setVisEdit(null); setZone(null); openImagePicker(); }}
          onClose={() => { setAskImgs(0); setVisEdit(null); setZone(null); }}
        />
      )}

      {imgPick && (
        <ImagePicker
          layout={fillLayout(chosenLayout, activeSlide, day?.contentType || day?.format)}
          need={imgPick.slots.length}
          slots={imgPick.slots}
          at={imgPick.at}
          pool={imagePool}
          suggested={pickerImages.slice(0, Math.min(pickerImages.length, imgPick.slots.length + 2))}
          uploading={uploading}
          hold={creating}
          paint={libPaint}
          onAt={(i) => setImgPick((v) => (v ? { ...v, at: i } : v))}
          onPut={putImgUrl}
          onUpload={onPickerUpload}
          onGenerate={() => setCreating(true)}
          onApply={applyImgPick}
          onClose={() => setImgPick(null)}
        />
      )}

      {packOpen && slotPackItems.length > 0 && createPortal(
        <SlotPack
          items={slotPackItems}
          onPick={(i, url) => {
            setEditSlot(measureSlot(i));
            setAdjustFor({ src: editorSrc(i) || canvasSafeUrl(url), slotIndex: i });
          }}
          onClose={() => setPackOpen(false)}
        />,
        document.body,
      )}

      {adjustFor?.src && createPortal(
        <PhotoEditor
          src={adjustFor.src}
          slot={editSlot}
          onCancel={() => { setAdjustFor(null); setEditSlot(null); }}
          onDone={(url) => {
            const slotIndex = adjustFor.slotIndex || 0;
            commitEditedUrl(url, slotIndex);
            setAdjustFor(null);
            setEditSlot(null);
          }}
          onReplace={(file) => {
            const slotIndex = adjustFor.slotIndex || 0;
            replaceEditedFile(file, slotIndex);
            setAdjustFor(null);
            setEditSlot(null);
          }}
          onDownload={() => downloadSrc(adjustFor.src)}
        />,
        document.body,
      )}

      {creating && imgPick && createPortal(
        <>
          <div className="wv-imgs__chatscrim" onClick={() => setCreating(false)} />
          <div className="wv-imgs__chat">
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
              backLabel="Back to photos"
              onBack={() => setCreating(false)}
              onCreated={(key, url, meta) => onImageCreated(key, url, meta, { slot: true })}
            />
          </div>
        </>,
        document.body,
      )}

      {/* ── the week, as a calendar: seven cards, lime for the one you are on
           (bauhly-v3 §682) ─────────────────────────────────────────────── */}
      <div className={`wv-cal${calMore ? ' has-more' : ''}${calPrev ? ' has-prev' : ''}`}>
        <div className="wv-cal__grid" ref={calGridRef} role="tablist" aria-label="This week's posts">
          {enrichedDays.map((d, i) => {
            const active = i === selected;
            const done = d.published;
            // Two marks, not one (bauhly-v3 §761): a scheduled post is a
            // decision about the future — the lime clock — while a published one
            // is the past, in grey. The lime only means anything with an account.
            const scheduled = metaStatus.connected && !!d.scheduledAt && !done;
            const ready = done || scheduled;
            return (
              <button
                key={`${d.day}-${i}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-current={active ? 'true' : undefined}
                className={`wv-day${active ? ' is-on' : ''}${ready ? ' is-ready' : ''}`}
                onClick={() => animateToDay(i)}
              >
                <span className="wv-day__when">
                  <b>{shortDay(d.day)}</b>
                  <i>{String(d.dateLabel || '').replace(/^[A-Za-z]+\s*/, '')}</i>
                </span>
                <span className="wv-day__kind">
                  <Glyph name={FORMAT_ICON[d.format] || 'image'} size={15} className="wv-day__glyph" />
                  <span className="wv-day__word">{String(d.format || '').replace(/ series$/, '')}</span>
                </span>
                {ready && (
                  <span className={`wv-day__ready${done ? ' is-done' : ''}`} aria-hidden="true">
                    <Glyph name={done ? 'check' : 'clock'} size={13} strokeWidth={done ? 3 : 2.25} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {day && (
        <div className={`wv-stage${enter ? ' is-moving' : ''}`}>
          {/* ── the post is the interface: a true preview you act on in place
               (bauhly-v3 §652). On a day change only the OUTGOING post animates:
               a ghost copy of this wrap slides out + fades across the stage (see
               `animateToDay`), revealing the new day at rest underneath. The
               OUTER day arrows live inside the wrap, tucked half behind the post
               and anchored to the picture's centre (§710/§725). */}
          <div className="wv-postwrap">
          <button
            type="button"
            className={`wv-daynav wv-daynav--prev${navOut ? ' is-out' : ''}`}
            onClick={prevDay}
            disabled={selected <= 0}
            aria-label="Previous day"
          >
            <Glyph name="chevron-left" size={22} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            className={`wv-daynav wv-daynav--next${navOut ? ' is-out' : ''}`}
            onClick={nextDay}
            disabled={selected >= days.length - 1}
            aria-label="Next day"
          >
            <Glyph name="chevron-right" size={22} strokeWidth={2.5} />
          </button>
          <article className={`wv-ig${timeDraft ? ' is-timeedit' : ''}${layoutEditing ? ' is-layoutedit' : ''}${wordsEditing ? ' is-wordsedit' : ''}`} style={igVars}>
            <header className="wv-ig__head">
              <span className="wv-ig__avatar">{handleInitials(handle)}</span>
              <span className="wv-ig__user">{handle}</span>
              {/* the corner says the next step, never a receipt (bauhly-v3
                  §733/§739): Connect → Schedule → Unschedule, and Published once
                  a post has gone out. One control in one place, so nothing on
                  the header moves as the post's state changes. */}
              {!metaStatus.connected ? (
                <button type="button" className="wv-ig__connect" onClick={() => setConnectOpen(true)}>
                  <Glyph name="instagram" size={13} />Connect to Meta
                </button>
              ) : day.published ? (
                <span className="wv-ig__go is-out" aria-label="Published">
                  <Glyph name="check" size={14} strokeWidth={3} />Published
                </span>
              ) : isScheduled ? (
                <button
                  type="button"
                  className="wv-ig__go is-on"
                  onClick={unschedule}
                  disabled={scheduling}
                  title="Put this post back"
                >
                  <Glyph name="refresh-cw" size={14} />Unschedule
                </button>
              ) : (
                <button
                  type="button"
                  className="wv-ig__go"
                  onClick={pressSchedule}
                  disabled={scheduling}
                >
                  <Glyph name="clock" size={14} />Schedule
                </button>
              )}
            </header>

            {/* the picture — left column on desktop, full width on a phone */}
            <div className="wv-ig__media">
            <div
              className={`wv-ig__zone wv-ig__zone--visual${zone === 'visual' ? ' is-sel' : ''}${zone && zone !== 'visual' ? ' is-back' : ''}`}
              onClick={(e) => {
                // Phone: the picture itself is the way in — there is no hover to
                // reveal the corner control (bauhly-v3 §690). Desktop keeps the
                // press on the Edit button only.
                if (e.target.closest('button, a, [role="button"], input, label')) return;
                if (typeof window !== 'undefined' && window.matchMedia('(min-width: 961px)').matches) return;
                openZone('visual');
              }}
            >
              <div className="wv-ig__photo">
                <SlideMedia
                  slide={activeSlide}
                  layout={chosenLayout}
                  contentType={day.contentType || day.format}
                  localMedia={localMedia}
                  mediaByKey={mediaByKey}
                  parts={visEdit === 'words' ? wordDraft : null}
                  showVisualHint
                />
                {slides.length > 1 && (
                  <span className="wv-ig__count">{safeIdx + 1}/{slides.length}</span>
                )}
                {/* what kind of post this is, said on the post itself */}
                {day.format && (
                  <span className="wv-ig__tag">
                    <Glyph name={FORMAT_GLYPH[day.format] || 'image'} size={12} strokeWidth={2.5} />
                    {String(day.format).replace(/ series$/, '')}
                  </span>
                )}
              </div>
              {/* the carousel's own arrows — step through slides; the last one
                  hands the post over to the next day (see nextSlideOrDay) */}
              {slides.length > 1 && safeIdx > 0 && (
                <button
                  type="button"
                  className="wv-igm__nav wv-igm__nav--l"
                  onClick={(e) => { e.stopPropagation(); prevSlide(); }}
                  aria-label="Previous slide"
                >
                  <Glyph name="chevron-left" size={18} strokeWidth={2.5} />
                </button>
              )}
              {slides.length > 1 && (safeIdx < slides.length - 1 || selected < days.length - 1) && (
                <button
                  type="button"
                  className="wv-igm__nav wv-igm__nav--r"
                  onClick={(e) => { e.stopPropagation(); nextSlideOrDay(); }}
                  aria-label={safeIdx < slides.length - 1 ? 'Next slide' : 'Next day'}
                >
                  <Glyph name="chevron-right" size={18} strokeWidth={2.5} />
                </button>
              )}
              <span className="wv-ig__veil" aria-hidden="true" />
              {visEdit === 'layout' && layPick && layPick !== appliedId && (
                <span className="wv-ig__previewtag">Preview only · Apply layout to keep</span>
              )}
              <button
                type="button"
                className="wv-ig__zonebtn"
                aria-label={zone === 'visual' ? 'Done editing image' : 'Edit this image'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  openZone('visual');
                }}
              >
                <Glyph name={zone === 'visual' ? 'x' : 'pencil'} size={17} strokeWidth={2} />
              </button>
              {/* the edit menu — shape, this picture, pictures, words
                  (bauhly-v3 §818/§989/§993). Anchored under the pencil. */}
              {zone === 'visual' && !visEdit && !imgPick && (
                <>
                <div
                  className="wv-ig__menuscrim"
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); closeZone(); }}
                  aria-hidden="true"
                />
                <div className="wv-ig__menu" role="menu" aria-label="Edit this slide">
                  <button type="button" role="menuitem" className="wv-ig__menuitem" onClick={() => {
                    setTimeDraft(null);
                    if (zone === 'caption') closeZone();
                    setLayPick(appliedId);
                    setLayCat(null);
                    setVisEdit('layout');
                  }}>
                    <Icon name="dashboard" size={17} strokeWidth={2} />
                    <span>Choose layout</span>
                  </button>
                  {hasEditImage && (
                    <button type="button" role="menuitem" className="wv-ig__menuitem" onClick={openAdjust}>
                      <Icon name="crop" size={17} strokeWidth={2} />
                      <span>Edit image</span>
                    </button>
                  )}
                  {chosenLayout && shotsOf(chosenLayout) > 0 && (
                    <button type="button" role="menuitem" className="wv-ig__menuitem" onClick={openImagePicker}>
                      <Icon name="image" size={17} strokeWidth={2} />
                      <span>Select images</span>
                    </button>
                  )}
                  <button type="button" role="menuitem" className="wv-ig__menuitem" onClick={() => {
                    setWordDraft(seedWordDraft(chosenLayout, activeSlide, day?.contentType || day?.format));
                    setVisEdit('words');
                  }}>
                    <Icon name="edit" size={17} strokeWidth={2} />
                    <span>Edit text</span>
                  </button>
                </div>
                </>
              )}
            </div>

            {/* the carousel's own indicators — under the media, always (§951) */}
            {slides.length > 1 && (
              <div className="wv-ig__dotrow" role="tablist" aria-label="Slides">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === safeIdx}
                    className={`wv-ig__dot${i === safeIdx ? ' is-active' : ''}`}
                    onClick={() => setSlideIdx(i)}
                    aria-label={`Slide ${i + 1}`}
                  />
                ))}
              </div>
            )}

            </div>

            {wordsEditing && (
              <div className="wv-worded" onClick={(e) => e.stopPropagation()}>
                <div className="wv-worded__head">
                  <button
                    type="button"
                    className="wv-worded__back"
                    onClick={() => closeZone()}
                    aria-label="Back"
                  >
                    <Glyph name="arrow-left" size={16} />
                  </button>
                  <span className="wv-worded__title">Edit text</span>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm wv-worded__apply"
                    onClick={applyWords}
                    disabled={wordsUnchanged || wordsBusy}
                  >
                    Apply changes
                  </button>
                </div>
                {wordDraft && (
                  <>
                    <div className="wv-worded__fields">
                      {wordRoles.map((r, n) => (
                        <RoleField
                          key={`${chosenLayout?.id}-${r.key}`}
                          role={r}
                          faceName={faceLabelFor(r.slot, vbStore)}
                          value={wordDraft[r.key] || ''}
                          autoFocus={n === 0}
                          onChange={(next) => setWordDraft((d) => ({ ...(d || {}), [r.key]: next }))}
                        />
                      ))}
                    </div>
                    <div className="wv-worded__foot">
                      <WordsPolish
                        routeId={route?._id}
                        dayIndex={selected}
                        caption={plainOf(wordDraft[primaryWordKey] || '')}
                        fills={wordFills}
                        role={wordRoles.find((r) => r.key === primaryWordKey)?.label}
                        onBusy={setWordsBusy}
                        onCaption={(next) => {
                          if (!primaryWordKey) return;
                          setWordDraft((d) => ({ ...(d || {}), [primaryWordKey]: capText(next) }));
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {layoutEditing && (
              <div className="wv-layed" onClick={(e) => e.stopPropagation()}>
                <div className="wv-layed__head">
                  <button
                    type="button"
                    className="wv-layed__back"
                    onClick={() => closeZone()}
                    aria-label="Back"
                  >
                    <Glyph name="arrow-left" size={16} />
                  </button>
                  <span className="wv-layed__title">
                    Choose layout
                    {layoutCatLabel && <em className="wv-layed__cat">{layoutCatLabel}</em>}
                  </span>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm wv-layed__apply"
                    onClick={applyLayout}
                    disabled={layoutUnchanged}
                    title={layoutUnchanged ? 'This is the layout the post already has' : undefined}
                  >
                    <Glyph name="check" size={16} strokeWidth={2.5} />
                    Apply changes
                  </button>
                </div>
                <div className="wv-layed__picker">
                  <div className="wv-actsrow">
                    <button
                      type="button"
                      className="wv-actsrow__arrow wv-layed__arrow"
                      onClick={() => stepLayout(-1)}
                      disabled={layWinStart <= 0}
                      aria-label="Previous layouts"
                    >
                      <Glyph name="chevron-left" size={15} strokeWidth={2.5} />
                    </button>
                    <div className="wv-acts wv-layed__grid" role="radiogroup" aria-label="Which layout should this slide take?">
                      {layoutPickerCards(pickerLayouts)}
                    </div>
                    <button
                      type="button"
                      className="wv-actsrow__arrow wv-layed__arrow"
                      onClick={() => stepLayout(1)}
                      disabled={layWinStart >= maxWinStart}
                      aria-label="Next layouts"
                    >
                      <Glyph name="chevron-right" size={15} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--tertiary btn--sm wv-layed__browse"
                  onClick={() => setLibOpen(true)}
                >
                  <Glyph name="search" size={15} strokeWidth={2} />
                  Browse layouts
                </button>
              </div>
            )}

            {/* caption / why — right column on desktop */}
            <div className={`wv-ig__panel${sideTab === 'why' ? ' is-why' : ' is-cap'}${zone === 'caption' ? ' is-cappedit' : ''}`}>
            <div className="wv-ig__tabrow">
              <div className="wv-ig__seg" role="tablist" aria-label="Post details">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sideTab === 'caption'}
                  className={`wv-ig__segbtn${sideTab === 'caption' ? ' is-on' : ''}`}
                  onClick={() => setSideTab('caption')}
                >
                  Caption
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sideTab === 'why'}
                  className={`wv-ig__segbtn${sideTab === 'why' ? ' is-on' : ''}`}
                  onClick={() => { setSideTab('why'); if (zone === 'caption') closeZone(); }}
                >
                  Why this post
                </button>
              </div>
              {sideTab === 'caption' && zone !== 'caption' && !isScheduled && !day.published && (
                <button
                  type="button"
                  className="wv-ig__tabedit"
                  aria-label="Edit the caption"
                  onClick={() => openZone('caption')}
                >
                  <Glyph name="pencil" size={15} />
                </button>
              )}
            </div>

            <div className="wv-ig__capblock">
            {/* the words — the caption's own zone, edited where it is read (§652) */}
            {zone === 'caption' ? (
              <div
                className="wv-ig__caption wv-ig__zone wv-ig__zone--caption is-editing"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="wv-caped">
                  <div className="wv-caped__head">
                    <button
                      type="button"
                      className="wv-caped__back"
                      onClick={closeZone}
                      aria-label="Back"
                    >
                      <Glyph name="arrow-left" size={16} />
                    </button>
                    <span className="wv-caped__title">Edit caption</span>
                    {capNeedsReview && (
                      <span className="wv-ig__caprev wv-caped__flag">Caption needs review</span>
                    )}
                    <button
                      type="button"
                      className="btn btn--primary btn--sm wv-caped__apply"
                      onClick={() => saveCaption(capDraft)}
                      disabled={capBusy}
                    >
                      Apply changes
                    </button>
                  </div>
                  <textarea
                    ref={capTaRef}
                    className="wv-caped__input"
                    value={capDraft}
                    onChange={(e) => setCapDraft(e.target.value)}
                    placeholder="Write the caption…"
                    aria-label="Caption"
                    autoFocus
                  />
                  <label className="wv-caped__tagsfield">
                    <span>Hashtags</span>
                    <textarea
                      className="wv-caped__input wv-caped__input--tags"
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      placeholder="#mezzanine #duplex #interiordesign"
                      aria-label="Hashtags"
                      rows={2}
                    />
                  </label>
                  <CaptionPolish
                    routeId={route?._id}
                    dayIndex={selected}
                    caption={capDraft}
                    onCaption={setCapDraft}
                    onBusy={setCapBusy}
                  />
                </div>
              </div>
            ) : (
              <div className="wv-ig__caption wv-ig__zone wv-ig__zone--caption">
                {capNeedsReview && (
                  <span className="wv-ig__caprev">Caption needs review</span>
                )}
                <p className="wv-ig__captiontext">
                  <b>{handle}</b>{' '}
                  {day.content?.caption || day.direction || <span className="wv-muted">Add a caption…</span>}
                </p>
                {captionCta && (
                  <p className="wv-ig__cta">{captionCta}</p>
                )}
                {captionTags.length > 0 && (
                  <p className="wv-ig__hashtags">
                    {captionTags.map((t) => (
                      <span key={t}>#{t}</span>
                    ))}
                  </p>
                )}
                <span className="wv-ig__veil" aria-hidden="true" />
                <button
                  type="button"
                  className="wv-ig__zonebtn"
                  aria-label="Edit the caption"
                  onClick={() => openZone('caption')}
                >
                  <Glyph name="pencil" size={16} />
                </button>
              </div>
            )}
            </div>
            <div className="wv-ig__whyblock">
              <WhyBody day={day} />
            </div>
            </div>

            {/* when this goes out, and whose decision it is (bauhly-v3 §787/§794).
                A published post states a fact; a scheduled one offers the way to
                send it now (we have no background publisher); an unscheduled one
                names its slot and points at Schedule. The time is edited here,
                on the slot's own surface (§790). */}
            {timeDraft ? (
              <div className="wv-time" onClick={(e) => e.stopPropagation()}>
                <div className="wv-time__head">
                  <button
                    type="button"
                    className="wv-time__back"
                    onClick={() => { setTimeDraft(null); setClockOpen(false); }}
                    aria-label="Back"
                  >
                    <Glyph name="arrow-left" size={16} />
                  </button>
                  <span className="wv-time__title">Edit publish time</span>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm wv-time__apply"
                    onClick={saveTime}
                    disabled={savingTime || timeUnchanged}
                  >
                    Apply changes
                  </button>
                </div>
                <ClockField
                  value={timeDraft.at}
                  open={clockOpen}
                  onToggle={() => setClockOpen((v) => !v)}
                  onChange={(at) => setTimeDraft((d) => ({ ...d, at }))}
                />
                <div className="wv-time__every">
                  <label className="wv-time__box">
                    <input
                      type="checkbox"
                      checked={timeDraft.every}
                      onChange={() => setTimeDraft((d) => ({ ...d, every: !d.every }))}
                    />
                    Use this time every week
                  </label>
                  {(timeDraft.at !== DEFAULT_TIME_24 || timeDraft.every) && (
                    <button
                      type="button"
                      className="btn btn--quiet btn--sm wv-time__reset"
                      onClick={() => setTimeDraft({ at: DEFAULT_TIME_24, every: false })}
                    >
                      <Glyph name="refresh-cw" size={14} />
                      Use Bauhly time
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className={`wv-ig__slot${day.published ? ' is-out' : ''}${!metaStatus.connected ? ' is-muted' : ''}`}>
                <Glyph name={day.published ? 'check' : 'clock'} size={14} strokeWidth={2} />
                <span className="wv-ig__slot-text">
                  <span className="wv-ig__slot-when">
                    {day.published ? 'Published' : isScheduled ? 'Scheduled for' : 'Best time'}
                    {' '}
                    <b>{shortDay(day.day)} {slotTime}</b>
                    {day.published && metaStatus.igUsername ? ` · @${metaStatus.igUsername}` : ''}
                  </span>
                  {isScheduled && (
                    <span className="wv-ig__slot-why">
                      Nothing goes out until you send it.{' '}
                      <button
                        type="button"
                        className="wv-ig__pubnow"
                        onClick={handlePublish}
                        disabled={publishing}
                      >
                        {publishing ? 'Publishing…' : 'Publish now'}
                      </button>
                    </span>
                  )}
                  {!isScheduled && !day.published && metaStatus.connected && (
                    <span className="wv-ig__slot-why">Based on when your audience is most active.</span>
                  )}
                  {!metaStatus.connected && !day.published && (
                    <span className="wv-ig__slot-why">Connect Meta to schedule this post.</span>
                  )}
                </span>
                {canEditTime && (
                  <button
                    type="button"
                    className="wv-ig__zonebtn wv-ig__slot-edit"
                    onClick={openTimeEditor}
                    aria-label="Edit publish time"
                    title="Edit publish time"
                  >
                    <Glyph name="pencil" size={16} />
                  </button>
                )}
                {publishMsg && <span className="wv-publish__msg">{publishMsg}</span>}
              </div>
            )}
          </article>
          </div>

          {/* why this post exists — the strategy, beside the preview, on demand */}
          <aside className={`wv-why${whyOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="wv-why__toggle"
              aria-expanded={whyOpen}
              onClick={() => setWhyOpen((v) => !v)}
            >
              <Glyph name={whyOpen ? 'x' : 'help-circle'} size={15} />
              {whyOpen ? 'Close' : 'Why this?'}
            </button>
            {whyOpen && (
              <div className="wv-why__panel">
                <h3 className="wv-why__head">Why this post</h3>
                <WhyBody day={day} />
              </div>
            )}
          </aside>

          {/* Off-screen export stage — one full-resolution (1080px-wide, 4:5)
              render of each slide's composition, the source for the PNGs sent to
              Instagram on publish. Kept in the DOM (not display:none, which
              collapses the container query and blanks the render) but pushed far
              off-screen. Brand vars come from igVars, same as the live preview,
              so colours and type match exactly. */}
          <div
            aria-hidden="true"
            className="wv-ig"
            style={{ ...igVars, position: 'fixed', left: '-100000px', top: 0, width: 1080, pointerEvents: 'none' }}
          >
            {slides.map((s, i) => (
              <div
                key={i}
                ref={(el) => { exportRefs.current[i] = el; }}
                className="wv-ig__photo"
                style={{ width: 1080 }}
              >
                <SlideMedia
                  slide={s}
                  layout={slideThumbLayout(s)}
                  contentType={day.contentType || day.format}
                  localMedia={localMedia}
                  mediaByKey={mediaByKey}
                  preferProxy
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
