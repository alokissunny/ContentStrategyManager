/*
 * WeekView — complete content for one plan's seven-day route.
 *
 * Desktop: date header → seven-day calendar → a wide two-column post card
 * (composition left, Caption / Why this post / Debug right). Phone: stacked Instagram
 * card with a "Why this?" aside. Edits persist via PATCH /routes/:id/day/:index.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Glyph from '../components/Glyph';
import Icon from '../brand/Icon';
import YourAnalysisModal from '../components/YourAnalysisModal';
import ConnectMetaModal from '../components/ConnectMetaModal';
import LinkedInPublisher from '../components/LinkedInPublisher';
import {
  getPost,
  generatePlan,
  markPublished,
  updatePostContent,
  schedulePost,
  retryScheduled,
  setPostTime,
  setPostReview,
  runPostLayout,
  runSlideLayoutVariations as apiRunSlideLayoutVariations,
  runPostCover,
  getPostOptions,
  getPostDebug,
  shiftPosts,
} from '../api/posts';
import { isoOf as isoOfDate, dateOf as dateFromIso, addDays as addDaysIso } from '../lib/shiftPosts';
import { distributionForGenerate } from '../lib/distribution';
import { getMetaStatus, publishPostToMeta, isMetaConnectedFor, metaConnectionFor, otherMetaConnections, rememberMetaOAuthReturn } from '../api/meta';

// WeekView edits a WEEK of PlannedPosts (one per day). Its engine still works on
// a `route` with a `days[]` array — YourPlans builds that array from the week's
// posts — but each day is now an independent document with its own `_id`. The
// per-day adapters that bridge the editor to the post-centric API are defined
// INSIDE the component (below), because they key each call to
// `days[index]._id` and merge the single-post response back into the current
// week route (via routeRef), preserving the other days.
import { mediaProxyUrl, videoProxyUrl, toDisplayUrl, isProxyUrl, rememberCdnBase, onCdnBase, getCdnBase, canvasSafeUrl, isProjectMediaKey, splitMediaKeys, iframeSafeUrl, projectKeysInText } from '../api/media';
import { createImage, listGeneratedImages } from '../api/images';
import { useProjects, uploadFiles } from '../lib/projectsStore';
import { toSvg } from 'html-to-image';
import { openCaptureIdea } from '../lib/captureUi';
import { styleOf, groundOf } from '../lib/visualbrand';
import { LAYOUTS as LIB_LAYOUTS, catForRole, shotsOf, DEFAULT_LAYOUT_BY_CAT, layoutShowsAllCopy } from '../data/layouts';
import { CAROUSEL_THEMES } from '../data/carouselThemes';
import { paintAll, identityOf, TYPE_SLOTS, FACES, logoPositionOf, markForTone } from '../lib/identity';
import { rolesOf as textRolesOf, plainOf, parseMarked, isListRole, listIndexOf } from '../lib/slidetext';
import ImagePicker from './weekview/ImagePicker';
import { PhotoEditor, SlotPack } from './weekview/PhotoEditor';
import RoleField from './weekview/RoleField';
import WordsPolish from './weekview/WordsPolish';
import CaptionPolish from './weekview/CaptionPolish';
import { useFeatureFlags } from '../lib/featureFlags';
import PostAgentDebug from './weekview/PostAgentDebug';
import DynamicLayout, { AnnotationOverlay } from './weekview/DynamicLayout';
import { BrandMark } from './visuallibrary/BrandMark';
import { rewriteAnnotationText, rewriteLayoutText, rewriteCarouselDocumentText, slotPlain, slideSlotPlain, withSharedLayoutStyles, layoutDirectionOf, themeIdOf, themeDirectionOf, slideIsThemed, optionForTheme, THEME_ORDER, bakeFrozenGeometry, findCarouselSlide } from './weekview/layoutHtml';
import { discoverSlideTextRoles, agentHtmlSource, isAgentHtmlSlide } from './weekview/slideTextRoles';
import { boxOf, normalizeSubjects } from './weekview/subjectBox';
import {
  CHANGE_LAYOUTS,
  findChangeLayout,
  shotsForLayout,
  LayoutSpecimen,
  SlideCompose,
} from './weekview/slideLayouts';
import { useAiDebug, fmtElapsed } from '../lib/aiDebug';
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

// Library Settings owns the three colours and the three faces. paintOf emits
// the --t-* tokens DynamicLayout remaps onto; --wv-* is the older hook the
// best-fit / hook compositions still read. Both come from libraryEdits first.
function brandStyleVars(store) {
  const paint = paintAll(store?.libraryEdits);
  const ground = groundOf(styleOf(store?.brandStyle));
  const vars = {
    ...paint,
    '--wv-accent': paint['--t-accent-bg'],
    '--wv-primary': paint['--t-ground-fg'],
    '--wv-neutral': paint['--t-ground-bg'],
    '--wv-post-font': paint['--t-headline-face'],
  };
  // the Brand Kit's chosen background (libraryEdits.background → paintAll) is the
  // ground image now; the legacy brandStyle ground is the fallback
  if (paint['--t-ground-image']) vars['--wv-ground-img'] = paint['--t-ground-image'];
  else if (ground.own && ground.url) vars['--wv-ground-img'] = `url(${ground.url})`;
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

// Add elements flyout — structure types a slide can take on. `cats` is the
// Visual Library categories that can carry the element; null means every role.
const ADD_ELEMENTS = [
  {
    id: 'title',
    label: 'Title',
    field: 'title',
    icon: 'type',
    desc: 'Main hook or headline.',
    placeholder: 'Your headline',
    cats: null,
  },
  {
    id: 'subtitle',
    label: 'Subtitle',
    field: 'subtitle',
    icon: 'text-sub',
    desc: 'Add a short supporting line.',
    placeholder: 'Supporting line',
    cats: null,
  },
  {
    id: 'body',
    label: 'Body',
    field: 'body',
    icon: 'text-body',
    desc: 'Add brief supporting text.',
    placeholder: 'Supporting text',
    cats: null,
  },
  {
    id: 'data',
    label: 'Data',
    field: 'stat',
    icon: 'chart',
    desc: 'Add a key stat or number.',
    placeholder: '42%',
    cats: ['hook', 'edu', 'story', 'results'],
  },
  {
    id: 'quote',
    label: 'Quote',
    field: 'quote',
    icon: 'quote',
    desc: 'Add a quote as the hook.',
    placeholder: 'A memorable quote',
    cats: ['hook', 'results', 'story'],
  },
];

function addElementsForRole(role) {
  const cat = catForRole(role);
  return ADD_ELEMENTS.filter((el) => !el.cats || el.cats.includes(cat));
}

// Layouts used when the studio adds structure via Add elements — ground only,
// no photograph slots. Title is head-only so Edit text does not invent a Body.
const ELEMENT_LAYOUTS = {
  'el-title': {
    id: 'el-title',
    name: 'Title',
    kind: 'statement',
    tone: 'ground',
    art: { head: '' },
    imgs: [],
  },
  'el-subtitle-only': {
    id: 'el-subtitle-only',
    name: 'Subtitle',
    kind: 'body-block',
    bodySlot: 'subtitle',
    tone: 'ground',
    art: { body: '' },
    imgs: [],
  },
  'el-body-only': {
    id: 'el-body-only',
    name: 'Body',
    kind: 'body-block',
    bodySlot: 'body',
    tone: 'ground',
    art: { body: '' },
    imgs: [],
  },
  'el-subtitle': {
    id: 'el-subtitle',
    name: 'Title & subtitle',
    kind: 'title-sub',
    bodySlot: 'subtitle',
    tone: 'ground',
    art: { head: '', body: '' },
    imgs: [],
  },
  'el-title-body': {
    id: 'el-title-body',
    name: 'Title & body',
    kind: 'title-body',
    bodySlot: 'body',
    tone: 'ground',
    art: { head: '', body: '' },
    imgs: [],
  },
  'el-data': {
    id: 'el-data',
    name: 'Data',
    kind: 'stat-only',
    tone: 'ground',
    art: { big: '', body: '' },
    imgs: [],
  },
  'el-quote': {
    id: 'el-quote',
    name: 'Quote',
    kind: 'statement',
    tone: 'ground',
    art: { head: '' },
    imgs: [],
  },
};

// The composable Add-elements slide (Canva-style): ONE manual slide that can
// carry any combination of Title, Subtitle, Body, Data (a number) and Quote,
// each an independently edited element. `slide.layout === 'el-stack'` marks it,
// and the live art is built from whichever fields the slide actually has — so
// the preview draws only the elements present, and Edit text offers a field for
// each. `role` is the typography role (lib/slidetext) each field is set in.
const ELEMENT_STACK_FIELDS = [
  { role: 'big', field: 'stat' },
  { role: 'head', field: 'title' },
  { role: 'subtitle', field: 'subtitle' },
  { role: 'body', field: 'body' },
  { role: 'quote', field: 'quote' },
];
const STACK_ROLE_TO_FIELD = Object.fromEntries(ELEMENT_STACK_FIELDS.map((e) => [e.role, e.field]));
const STACK_FIELD_TO_ROLE = Object.fromEntries(ELEMENT_STACK_FIELDS.map((e) => [e.field, e.role]));

function stackArt(slide) {
  const art = {};
  ELEMENT_STACK_FIELDS.forEach(({ role, field }) => {
    const v = String(slide?.[field] || '').trim();
    if (v) art[role] = v;
  });
  return art;
}

function elementStackLayout(slide) {
  return { id: 'el-stack', name: 'Slide', kind: 'stack', tone: 'ground', art: stackArt(slide), imgs: [] };
}

// A static marker so id-only checks (isManualSlide, slideRecord) recognise the
// composable slide; the drawable art comes from elementStackLayout(slide).
const ELEMENT_STACK_STUB = { id: 'el-stack', name: 'Slide', kind: 'stack', tone: 'ground', art: {}, imgs: [] };

function findElementLayout(id) {
  if (!id) return null;
  if (id === 'el-stack') return ELEMENT_STACK_STUB;
  return ELEMENT_LAYOUTS[id] || null;
}

function isManualSlide(slide) {
  return Boolean(slide?.manual) || Boolean(findElementLayout(slide?.layout));
}

// Every studio-built element slide is now the composable stack; the per-combo
// ELEMENT_LAYOUTS ids stay recognised (findElementLayout) so slides saved before
// this change still render, but any edit migrates them onto el-stack.
function elementLayoutForSlide() {
  return 'el-stack';
}

function composeLayoutOf(slide, layoutOverride = null) {
  if (layoutOverride) return layoutOverride;
  const changeLayout = findChangeLayout(slide?.layout);
  if (changeLayout) return changeLayout;
  if (slide?.layout === 'el-stack') return elementStackLayout(slide);
  return findElementLayout(slide?.layout) || null;
}
// Content and Image were two tabs over one slide — the words on it and the shape
// they go in — but nobody writes a line without looking at where it lands, so
// they are one pane now (bauhly-v3 decision 559).
const BEST_FIT_LAYOUT = { id: 'best-fit', kind: 'bleed', tone: 'photo', art: { head: '', body: '' }, imgs: [null] };

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
  const elapsedMs = Number(u.elapsedMs) || 0;
  if (!totalTokens && !estimatedCostUsd && !elapsedMs) return null;
  return { totalTokens, estimatedCostUsd, inputTokens, outputTokens, elapsedMs };
}

function shortDay(day) {
  return String(day || '').slice(0, 3);
}

/* Calendar placeholder for a weekday with no planned post (Weekly strip pads
 * Mon–Sun). Empty slots still carry date / day / dateLabel for the rail. */
function isEmptyCalDay(d) {
  if (!d || d.empty) return true;
  return !(d._id || String(d.format || '').trim() || String(d.title || '').trim());
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

// ── Change time (bauhly-v3): a Date field with a calendar, and a typed Time
// field. Both draw the product's own surfaces instead of the browser's native
// date/time controls, which read in the OS locale and paint a second clock.
const SCHED_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SCHED_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SCHED_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Any typed time ("9", "930", "9:30", "9 pm", "21:15") → "HH:MM" or null.
function readClock(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return null;
  const pm = /p/.test(t);
  const am = /a/.test(t);
  let h;
  let m = 0;
  const parts = t.match(/^\s*(\d{1,2})\s*[:.\s]\s*(\d{1,2})/);
  if (parts) { h = Number(parts[1]); m = Number(parts[2]); } else {
    const digits = t.replace(/[^0-9]/g, '');
    if (!digits) return null;
    if (digits.length <= 2) h = Number(digits);
    else if (digits.length === 3) { h = Number(digits.slice(0, 1)); m = Number(digits.slice(1)); }
    else { h = Number(digits.slice(0, 2)); m = Number(digits.slice(2, 4)); }
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const schedMonthLabel = (year, month) => `${SCHED_MONTHS[month]} ${year}`;
// "Thursday, 24 September" — the product's own words, not the OS locale's.
function schedLongDay(iso) {
  const d = dateFromIso(iso);
  return d ? `${SCHED_DAYS[d.getDay()]}, ${d.getDate()} ${SCHED_MONTHS[d.getMonth()]}` : '';
}
// "Thu, Sep 24, 2026" — the value shown on the Date field.
function schedFieldDate(iso) {
  const d = dateFromIso(iso);
  if (!d) return '';
  return `${SCHED_WEEKDAYS[(d.getDay() + 6) % 7]}, ${SCHED_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}
// Monday→Sunday weeks covering the month, with neighbours marked out-of-month.
function schedMonthGrid(year, month, today = new Date()) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = addDaysIso(first, -lead);
  const last = new Date(year, month + 1, 0);
  const tail = 6 - ((last.getDay() + 6) % 7);
  const total = lead + last.getDate() + tail;
  const rows = Math.ceil(total / 7);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const weeks = [];
  for (let r = 0; r < rows; r += 1) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const d = addDaysIso(start, r * 7 + i);
      return {
        iso: isoOfDate(d),
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        isToday: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() === t0,
      };
    }));
  }
  return weeks;
}

// One labelled field: an icon, a value and a chevron, opening a picker.
function SchedField({ id, label, icon, value, open, onOpen }) {
  return (
    <div className="schedf">
      <span className="schedf__label" id={`${id}-lb`}>{label}</span>
      <button
        type="button"
        className={`schedf__box ${open ? 'is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value}`}
        onClick={onOpen}
      >
        <Glyph name={icon} size={16} strokeWidth={1.9} />
        <span className="schedf__value">{value}</span>
        <Glyph name="chevron-down" size={15} strokeWidth={2.1} className="schedf__caret" />
      </button>
    </div>
  );
}

// The Time field — the same box, but a typed 24-hour input that commits on blur.
function SchedTime({ id, label, value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const live = useRef(false);
  useEffect(() => { if (!live.current) setDraft(value); }, [value]);
  const commit = () => {
    live.current = false;
    const next = readClock(draft);
    if (next) { setDraft(next); if (next !== value) onCommit(next); } else setDraft(value);
  };
  return (
    <div className="schedf">
      <span className="schedf__label" id={`${id}-lb`}>{label}</span>
      <span className="schedf__box schedf__box--type">
        <Glyph name="clock" size={16} strokeWidth={1.9} />
        <input
          id={id}
          className="schedf__value schedf__input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          maxLength={8}
          value={draft}
          aria-label={`${label}, 24-hour, for example 09:30`}
          onFocus={(e) => { live.current = true; e.target.select(); }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setDraft(value); live.current = false; e.currentTarget.blur(); }
          }}
        />
      </span>
    </div>
  );
}

// The month grid the Date field opens — today is lime, the chosen day is ink.
function SchedCalendar({ value, minIso = null, onPick }) {
  const [month, setMonth] = useState(() => {
    const d = dateFromIso(value) || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const weeks = useMemo(() => schedMonthGrid(month.getFullYear(), month.getMonth()), [month]);
  const step = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  return (
    <div className="schedcal">
      <div className="schedcal__head">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)}>
          <Glyph name="chevron-left" size={16} strokeWidth={2.25} />
        </button>
        <b>{schedMonthLabel(month.getFullYear(), month.getMonth())}</b>
        <button type="button" aria-label="Next month" onClick={() => step(1)}>
          <Glyph name="chevron-right" size={16} strokeWidth={2.25} />
        </button>
      </div>
      <div className="schedcal__wd" aria-hidden="true">
        {SCHED_WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="schedcal__grid">
        {weeks.map((week) => week.map((d) => {
          const blocked = minIso ? (d.iso < minIso && d.iso !== value) : false;
          const on = d.iso === value;
          return (
            <button
              key={d.iso}
              type="button"
              disabled={blocked}
              aria-pressed={on}
              aria-current={d.isToday ? 'date' : undefined}
              aria-label={schedLongDay(d.iso)}
              className={`schedcal__day ${on ? 'is-on' : ''} ${d.isToday ? 'is-today' : ''} ${d.inMonth ? '' : 'is-dim'}`}
              onClick={() => onPick(d.iso)}
            >
              {d.day}
            </button>
          );
        }))}
      </div>
    </div>
  );
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
    ...(normalizeSubjects(a?.subjects).map((s) => s.name)),
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
  const push = (a, projectName, note) => {
    if (!a || (a.type && a.type !== 'image')) return;
    if (!(a.url || a.thumbnailUrl || a.key)) return;
    images.push({
      key: a.key,
      url: a.url || a.thumbnailUrl,
      thumb: a.thumbnailUrl || a.url,
      projectName,
      note: note || '',
      analyzed: a.analysis?.status === 'done',
      keywords: imageKeywords(a.analysis, note),
      subjects: normalizeSubjects(a.analysis?.status === 'done' ? a.analysis.subjects : []),
    });
  };
  for (const p of projects || []) {
    for (const e of p.captures || []) {
      for (const a of e.attachments || []) push(a, p.name, e.text || '');
    }
    for (const n of p.notes || []) {
      for (const a of n.assets || n.attachments || []) push(a, p.name, n.text || n.understanding?.summary || '');
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
    index: Number(s.index) > 0 ? Number(s.index) : (Number(extra.index) > 0 ? Number(extra.index) : 0),
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
    assetKey: s.assetKey || s.visual?.assetKey || '',
    assetKeys: Array.isArray(s.assetKeys) ? s.assetKeys.map((k) => k || '') : [],
    visual: s.visual && typeof s.visual === 'object' ? s.visual : null,
    layout: s.layout || '',
    layoutHtml: s.layoutHtml || '',
    layoutTheme: s.layoutTheme || '',
    layoutOptions: Array.isArray(s.layoutOptions)
      ? s.layoutOptions
        .map((o, i) => ({
          rank: Number(o?.rank) > 0 ? Number(o.rank) : i + 1,
          label: o?.label || '',
          reason: o?.reason || '',
          direction: o?.direction || '',
          html: o?.html || '',
        }))
        .filter((o) => o.html)
      : [],
    annotation: s.annotation && typeof s.annotation === 'object'
      ? {
        text: s.annotation.text || '',
        targetSubject: s.annotation.targetSubject || '',
        targetRegion: s.annotation.targetRegion || '',
        ...(boxOf(s.annotation.targetBox) ? { targetBox: boxOf(s.annotation.targetBox) } : {}),
      }
      : (typeof s.annotation === 'string' ? { text: s.annotation, targetSubject: '', targetRegion: '' } : null),
    visualNeed: visualNeedRecord(s),
    // Studio-added empty page — must not inherit writer copy or the carousel doc.
    blank: Boolean(s.blank) || s.layout === 'blank',
    // Studio-built via Add elements — skip Day Writer backfill on derive.
    manual: Boolean(s.manual) || Boolean(findElementLayout(s.layout)),
    ...extra,
  };
}

function isBlankSlide(slide) {
  return Boolean(slide?.blank) || slide?.layout === 'blank';
}

function makeBlankSlide(role) {
  return slideRecord({
    role: role || 'Slide',
    title: '',
    subtitle: '',
    body: '',
    items: [],
    stat: '',
    quote: '',
    action: '',
    assetKey: '',
    assetKeys: [],
    layout: 'blank',
    layoutHtml: '',
    layoutTheme: '',
    layoutOptions: [],
    annotation: null,
    visual: null,
    blank: true,
  });
}

function writerSlideOf(day, index) {
  const slides = day?.agentTrace?.dayWriter?.content?.slides;
  if (!Array.isArray(slides)) return null;
  return slides.find((s) => Number(s?.index) === index + 1) || slides[index] || null;
}

function elementOfTypes(elements, types) {
  const want = new Set(types.map((t) => String(t).toLowerCase().replace(/[\s/-]+/g, '_')));
  return (elements || []).find((e) => want.has(String(e?.type || '').toLowerCase().replace(/[\s/-]+/g, '_'))) || null;
}

function fillFromWriter(slide, raw) {
  if (!raw || typeof raw !== 'object') return slide;
  const els = Array.isArray(raw.elements) ? raw.elements : [];
  const titleEl = elementOfTypes(els, ['title', 'short_statement', 'question']);
  const subEl = elementOfTypes(els, ['subtitle', 'supporting_text', 'caption_label']);
  const bodyEl = elementOfTypes(els, ['body']);
  const annEl = elementOfTypes(els, ['annotation']);
  const cmpEl = elementOfTypes(els, ['comparison', 'pros_cons', 'do_dont', 'problem_solution', 'cause_effect']);
  const diagramEl = elementOfTypes(els, ['diagram', 'graphic_artwork', 'list', 'numbered_items']);
  const visual = raw.visual && typeof raw.visual === 'object' ? raw.visual : {};
  const items = Array.isArray(slide.items) && slide.items.length
    ? slide.items
    : (diagramEl?.text ? [String(diagramEl.text).trim()] : []);
  const annotationText = String(
    slide.annotation?.text
    || annEl?.text
    || (typeof raw.annotation === 'string' ? raw.annotation : raw.annotation?.text)
    || '',
  ).trim();
  return {
    ...slide,
    title: String(titleEl?.text || slide.title || '').trim(),
    subtitle: String(subEl?.text || slide.subtitle || '').trim(),
    body: String(bodyEl?.text || slide.body || '').trim(),
    comparisonA: slide.comparisonA || cmpEl?.comparisonA || '',
    comparisonB: slide.comparisonB || cmpEl?.comparisonB || '',
    items,
    visual: slide.visual || visual,
    visualNeed: slide.visualNeed || visualNeedRecord({ visual, visualNeed: raw.visualNeed }),
    assetKey: slide.assetKey || raw.assetKey || visual.assetKey || '',
    assetKeys: (Array.isArray(slide.assetKeys) && slide.assetKeys.some(Boolean))
      ? slide.assetKeys
      : splitMediaKeys(raw.assetKeys || visual.assetKeys || raw.assetKey || visual.assetKey),
    annotation: annotationText
      ? {
        text: annotationText,
        targetSubject: String(
          slide.annotation?.targetSubject || annEl?.targetSubject || raw.annotation?.targetSubject || '',
        ).trim(),
        targetRegion: String(
          slide.annotation?.targetRegion || annEl?.targetRegion || raw.annotation?.targetRegion || '',
        ).trim(),
        ...((boxOf(slide.annotation?.targetBox) || boxOf(annEl?.targetBox) || boxOf(raw.annotation?.targetBox))
          ? { targetBox: boxOf(slide.annotation?.targetBox) || boxOf(annEl?.targetBox) || boxOf(raw.annotation?.targetBox) }
          : {}),
      }
      : null,
  };
}

function deriveSlides(day) {
  const roles = SLIDE_ROLES[day.format] || SLIDE_ROLES.Post;
  const existing = day.content?.slides;
  if (Array.isArray(existing) && existing.length) {
    return existing.map((s, i) => {
      const base = {
        ...slideRecord(s, { index: i + 1 }),
        role: s.role || roles[Math.min(i, roles.length - 1)],
        subtitle: s.subtitle || s.body || '',
      };
      // Blank / Add-elements pages stay as the studio left them — do not
      // backfill from Day Writer by index (that reintroduces body + images).
      if (isBlankSlide(base) || isManualSlide(base)) {
        if (isBlankSlide(base)) {
          return {
            ...base,
            blank: true,
            layout: 'blank',
            layoutHtml: '',
            layoutTheme: '',
            layoutOptions: [],
          };
        }
        return { ...base, manual: true };
      }
      return fillFromWriter(base, writerSlideOf(day, i));
    });
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

function structureSlideOfDay(day, index) {
  const slides = day?.agentTrace?.structure?.slidesOrScenes;
  if (!Array.isArray(slides)) return null;
  const n = Number(index);
  return slides.find((s) => Number(s?.index) === n) || slides[n - 1] || null;
}

function mentionedKeysOf(slide, day) {
  const structured = structureSlideOfDay(day, slide?.index);
  return projectKeysInText(
    slide?.assetKey,
    slide?.visual?.assetKey,
    slide?.evidenceAvailability?.reason,
    structured?.visual?.assetKey,
    structured?.evidenceAvailability?.reason,
    structured?.evidenceAvailability,
  );
}

// Pass 1 — bind each slide's explicit (owned) assetKey to its image and claim
// that key in the shared `used` set, so a later standing-in fill (this day or
// another day of the week) never grabs a photo that a real post owns.
function allocatedKeysOfDay(day) {
  const brief = day?.agentTrace?.strategyBrief || {};
  const fromBrief = (Array.isArray(brief.allocatedAssets) ? brief.allocatedAssets : [])
    .map((a) => String(a?.key || a || '').trim())
    .filter(Boolean);
  const fromStruct = [];
  const slides = day?.agentTrace?.structure?.slidesOrScenes;
  if (Array.isArray(slides)) {
    slides.forEach((s) => {
      splitMediaKeys(s?.visual?.assetKey).forEach((k) => fromStruct.push(k));
      projectKeysInText(s?.evidenceAvailability?.reason, s?.evidenceAvailability).forEach((k) => {
        fromStruct.push(k);
      });
    });
  }
  return [...new Set([...fromBrief, ...fromStruct].filter(isProjectMediaKey))];
}

function withAllocatedSlideKeys(slides, day) {
  const allocated = allocatedKeysOfDay(day);
  const used = new Set((slides || []).flatMap((s) => keysOf(s)).filter(Boolean));
  const next = (slides || []).map((s) => {
    if (isBlankSlide(s) || isManualSlide(s)) return s;
    if (keysOf(s).some(Boolean)) return s;
    const named = mentionedKeysOf(s, day).find((k) => k && !used.has(k)) || mentionedKeysOf(s, day)[0];
    if (!named) return s;
    used.add(named);
    return {
      ...s,
      assetKey: named,
      assetKeys: [named],
      visual: { ...(s.visual || {}), assetKey: named },
    };
  });
  if (!allocated.length) return next;
  let n = 0;
  return next.map((s) => {
    if (keysOf(s).some(Boolean)) return s;
    const pri = String(s?.visualNeed?.priority || s?.visual?.priority || '').toLowerCase();
    const type = String(s?.visualNeed?.type || s?.visual?.type || '').toLowerCase();
    const wants = (pri && pri !== 'none') || (type && type !== 'none') || String(s?.image || '') === 'placeholder';
    if (!wants) return s;
    while (n < allocated.length && used.has(allocated[n])) n += 1;
    const key = allocated[n];
    if (!key) return s;
    used.add(key);
    n += 1;
    return { ...s, assetKey: key, assetKeys: [key] };
  });
}

function keysFromLayoutHtml(html) {
  const keys = [];
  const seen = new Set();
  String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (_, attrs) => {
    if (!/data-slot\s*=\s*(["'](?:image|illustration)["']|(?:image|illustration)(?=[\s>/]|$))/i.test(attrs)) return _;
    const m = String(attrs).match(/\bdata-asset-key\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const key = String(m?.[2] || m?.[3] || m?.[4] || '').trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    return _;
  });
  return keys;
}

function keysOf(slide) {
  const listed = splitMediaKeys(slide?.assetKeys);
  if (listed.length) return listed;
  const single = splitMediaKeys(slide?.assetKey);
  if (single.length) return single;
  const fromVisual = splitMediaKeys(slide?.visual?.assetKey || slide?.image?.key);
  if (fromVisual.length) return fromVisual;
  // Carousel often stamps data-asset-key on the <img> without setting slide.assetKey.
  return keysFromLayoutHtml(slide?.layoutHtml);
}

function subjectsForSlide(slide, subjectsByKey) {
  if (!subjectsByKey) return [];
  for (const key of keysOf(slide)) {
    const list = subjectsByKey.get(key);
    if (list?.length) return list;
  }
  return [];
}

function mediaUrlOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.url || value.thumb || '').trim();
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
  const known = mediaUrlOf(localMedia?.[key])
    || mediaUrlOf(mediaByKey?.get(key))
    || (slide?.image?.key === key ? mediaUrlOf(slide.image) : '');
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
const MAX_ANNOTE_TEXT = 48;
const ANNOTATIONS_ENABLED = false;
const ANNOTE_ROLE = {
  key: 'annotation',
  label: 'Annotation',
  slot: 'headline',
  hint: 'The callout on the photograph — same heading face as the rest of the slide.',
};
const capText = (t) => String(t || '').slice(0, MAX_SLIDE_TEXT);
const capAnnote = (t) => String(t || '').trim().slice(0, MAX_ANNOTE_TEXT);

function annotationTextOf(slide) {
  const a = slide?.annotation;
  if (!a) return '';
  return String(typeof a === 'string' ? a : a.text || '').trim();
}

function slideHasPhoto(slide) {
  return Boolean(
    String(slide?.assetKey || '').trim()
    || (Array.isArray(slide?.assetKeys) && slide.assetKeys.some((k) => String(k || '').trim()))
    || String(slide?.image?.key || slide?.image?.url || '').trim(),
  );
}

function wordRolesForSlide(slide, visual) {
  if (isAgentHtmlSlide(slide)) {
    const html = agentHtmlSource(slide, visual);
    const index = Number(slide?.index) > 0 ? Number(slide.index) : 1;
    const direction = visual?.direction || layoutDirectionOf(slide);
    const discovered = discoverSlideTextRoles(html, { direction, index });
    if (discovered.length) {
      if (ANNOTATIONS_ENABLED && (slideHasPhoto(slide) || annotationTextOf(slide))) {
        if (!discovered.some((r) => r.key === 'annotation' || r.htmlSlot === 'annotation')) {
          discovered.push(ANNOTE_ROLE);
        }
      }
      return discovered;
    }
  }
  const layout = composeLayoutOf(slide) || BEST_FIT_LAYOUT;
  const roles = [...textRolesOf(layout)];
  if (ANNOTATIONS_ENABLED && (slideHasPhoto(slide) || annotationTextOf(slide))) roles.push(ANNOTE_ROLE);
  return roles;
}

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
      blank: Boolean(s.blank) || s.layout === 'blank',
      manual: Boolean(s.manual) || Boolean(findElementLayout(s.layout)),
    };
  });
}

// The page heading for a single post: a concise date (the single-post
// equivalent of the old week's date-range label), e.g. "Wednesday, September
// 16". Parses the date-only part locally so it never drifts a day across
// timezones. The post's editorial title/hook lives in the preview, not here.
function postHeading(day) {
  if (!day) return 'Your post';
  const m = String(day.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }
  }
  return day.dateLabel || day.day || 'Your post';
}

function buildMarkdown(route) {
  const first = (route.days || [])[0] || {};
  const heading = first.title || first.dateLabel || first.day || 'Your post';
  const lines = [`# ${heading}`, ''];
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
function fillLayout(layout, slide, contentType, draft) {
  if (!layout) return layout;
  const rawTitle = String(draft?.head != null ? draft.head : (slide?.title || slide?.quote || slide?.action || '')).trim();
  const title = plainOf(rawTitle).trim();
  const sub = (draft?.body != null ? plainOf(draft.body) : (slide?.subtitle || slide?.body || '')).trim();
  const src = layout.art || {};
  const has = (k) => k in src;
  const art = {};

  let accentText = '';
  if (has('a') && (slide?.comparisonA || slide?.comparisonB)) {
    art.a = String(slide.comparisonA || title).trim();
    if (has('b')) art.b = String(slide.comparisonB || slide?.subtitle || '').trim();
  } else if (has('head')) {
    if (has('accent')) {
      const marked = parseMarked(rawTitle);
      accentText = marked.filter((p) => p.mark === 'accent').map((p) => p.text).join('').trim();
      art.head = marked.filter((p) => p.mark !== 'accent').map((p) => p.text).join('').trim() || title;
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
function visibleSlot(html, slide, slot, visual) {
  const index = Number(slide?.index) > 0 ? Number(slide.index) : 1;
  const direction = visual?.direction || layoutDirectionOf(slide);
  return slideSlotPlain(visual?.documentHtml || '', { direction, index, slot })
    || slideSlotPlain(html, { direction, index, slot })
    || slotPlain(html, slot);
}

function seedWordDraft(layout, slide, contentType, visual) {
  if (isAgentHtmlSlide(slide)) {
    const html = agentHtmlSource(slide, visual);
    const index = Number(slide?.index) > 0 ? Number(slide.index) : 1;
    const direction = visual?.direction || layoutDirectionOf(slide);
    const discovered = discoverSlideTextRoles(html, { direction, index });
    if (discovered.length) {
      const out = {};
      discovered.forEach((r) => { out[r.key] = r.text || ''; });
      if (ANNOTATIONS_ENABLED && (slideHasPhoto(slide) || annotationTextOf(slide))) {
        out.annotation = annotationTextOf(slide);
      }
      return out;
    }
  }
  const filled = fillLayout(layout, slide, contentType);
  const art = filled?.art || {};
  const baked = slide?.layoutHtml || '';
  const stack = slide?.layout === 'el-stack';
  const out = {};
  textRolesOf(layout).forEach((r) => {
    if (stack) {
      // Composable slide has no baked html — seed each role straight from its
      // field, keeping marks so accent emphasis survives a round-trip.
      const field = STACK_ROLE_TO_FIELD[r.key];
      out[r.key] = field ? String(slide?.[field] || '').trim() : (art[r.key] || '');
      return;
    }
    if (r.key === 'head') {
      out.head = visibleSlot(baked, slide, 'title', visual)
        || (slide?.title || '').trim()
        || [art.head, art.accent].filter(Boolean).join(' ');
    } else if (r.key === 'body') {
      const elLay = findElementLayout(slide?.layout);
      if (elLay?.bodySlot === 'body') {
        out.body = visibleSlot(baked, slide, 'body', visual)
          || (slide?.body || '').trim()
          || art.body || '';
      } else {
        out.body = visibleSlot(baked, slide, 'subtitle', visual)
          || visibleSlot(baked, slide, 'supporting-text', visual)
          || visibleSlot(baked, slide, 'body', visual)
          || (slide?.subtitle || '').trim()
          || art.body || '';
      }
    } else if (isListRole(r.key)) {
      out[r.key] = art.items?.[listIndexOf(r.key)] || '';
    } else {
      out[r.key] = art[r.key] || '';
    }
  });
  if (ANNOTATIONS_ENABLED && (slideHasPhoto(slide) || annotationTextOf(slide))) {
    out.annotation = annotationTextOf(slide);
  }
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
// Tiny transparent GIF — used so empty image slots don't throw during
// html-to-image serialisation (src-less <img> fires an error event and aborts publish).
const EXPORT_IMG_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function rasterizeSlide(node, { timeoutMs = 20000 } = {}) {
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  if (!w || !h) return Promise.reject(new Error('Slide has no size to render.'));

  // Empty / broken image slots must not abort export. Give them a loadable
  // data-URI for the duration of the snapshot, then restore.
  const restored = [];
  node.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src || img.classList.contains('is-placeholder')) {
      restored.push([img, src]);
      img.setAttribute('src', EXPORT_IMG_PLACEHOLDER);
    }
  });

  const restoreImgs = () => {
    restored.forEach(([img, prev]) => {
      if (prev == null || prev === '') img.removeAttribute('src');
      else img.setAttribute('src', prev);
    });
  };

  return toSvg(node, {
    cacheBust: true,
    skipFonts: true,
    imagePlaceholder: EXPORT_IMG_PLACEHOLDER,
  })
    .finally(restoreImgs)
    .then(
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

function slideAllowsPhoto(slide) {
  if (String(slide?.assetKey || '').trim()) return true;
  if (Array.isArray(slide?.assetKeys) && slide.assetKeys.some((k) => String(k || '').trim())) return true;
  if (String(slide?.visual?.assetKey || '').trim()) return true;
  if (String(slide?.image?.key || slide?.image?.url || slide?.image?.thumb || '').trim()) return true;
  return false;
}

function slideCopy(slide, parts) {
  const elLay = findElementLayout(slide?.layout);
  // Composable stack: each element maps 1:1 to a slide field. `parts` (the live
  // Edit-text draft, keyed by typography role) wins so typing updates the
  // preview before Apply; marks are kept so accent emphasis renders.
  if (slide?.layout === 'el-stack') {
    const pick = (role, field) => String(
      parts?.[role] != null ? parts[role] : (slide?.[field] || ''),
    ).trim();
    return {
      title: pick('head', 'title'),
      sub: pick('subtitle', 'subtitle'),
      body: pick('body', 'body'),
      items: [],
      cmpA: '',
      cmpB: '',
      stat: pick('big', 'stat'),
      quote: pick('quote', 'quote'),
      annotation: null,
    };
  }
  if (elLay?.kind === 'body-block') {
    const draftLine = parts?.body != null ? plainOf(parts.body) : '';
    if (elLay.bodySlot === 'body') {
      const body = draftLine || String(slide?.body || '').trim();
      return {
        title: '',
        sub: '',
        body,
        items: [],
        cmpA: '',
        cmpB: '',
        stat: '',
        quote: '',
        annotation: null,
      };
    }
    const sub = draftLine || String(slide?.subtitle || '').trim();
    return {
      title: '',
      sub,
      body: '',
      items: [],
      cmpA: '',
      cmpB: '',
      stat: '',
      quote: '',
      annotation: null,
    };
  }
  if (elLay?.kind === 'title-body') {
    const title = String(parts?.head != null ? parts.head : (slide?.title || '')).trim();
    const body = String(parts?.body != null ? plainOf(parts.body) : (slide?.body || '')).trim();
    return {
      title,
      sub: '',
      body,
      items: [],
      cmpA: '',
      cmpB: '',
      stat: String(slide?.stat || '').trim(),
      quote: '',
      annotation: null,
    };
  }
  const title = String(parts?.head != null ? parts.head : (slide?.title || slide?.quote || slide?.action || '')).trim();
  const sub = String(parts?.body != null ? parts.body : (slide?.subtitle || '')).trim();
  const body = String(slide?.body || '').trim();
  const items = Array.isArray(slide?.items) ? slide.items.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const cmpA = String(slide?.comparisonA || '').trim();
  const cmpB = String(slide?.comparisonB || '').trim();
  const showCmp = Boolean(cmpA || cmpB);
  return {
    title,
    sub,
    body: body && body !== sub && body !== title ? body : '',
    items,
    cmpA: showCmp ? cmpA : '',
    cmpB: showCmp ? cmpB : '',
    stat: String(slide?.stat || '').trim(),
    quote: String(slide?.quote || '').trim() && String(slide?.quote || '').trim() !== title
      ? String(slide.quote).trim() : '',
    annotation: ANNOTATIONS_ENABLED
      ? (parts?.annotation != null
        ? {
          text: capAnnote(plainOf(parts.annotation)),
          targetSubject: slide?.annotation?.targetSubject || '',
          targetRegion: slide?.annotation?.targetRegion || 'center',
          ...(boxOf(slide?.annotation?.targetBox) ? { targetBox: boxOf(slide.annotation.targetBox) } : {}),
        }
        : (slide?.annotation || null))
      : null,
  };
}

function carouselDocumentOf(day) {
  const t = day?.agentTrace && typeof day.agentTrace === 'object' ? day.agentTrace : {};
  const html = day?.content?.carouselHtml
    || t.layout?.html
    || t.carousel?.html
    || t.layout?.parsed?.html
    || t.carousel?.parsed?.html
    || '';
  const raw = String(html || '').trim();
  if (!raw) return '';
  // Stale runs from the template-split bug stored apology shells — do not paint them.
  if (/content structure (was )?not included|awaiting content|role not supplied/i.test(raw)) {
    return '';
  }
  return (/<!doctype html/i.test(raw) || /<html[\s>]/i.test(raw)) ? raw : '';
}

function SlideMedia({
  slide,
  localMedia,
  parts,
  mediaByKey,
  preferProxy = false,
  showVisualHint = false,
  subjectsByKey,
  paint,
  themed = false,
  layoutOverride = null,
  carouselLayoutHtmls = null,
  documentHtml = '',
  slideIndex = 1,
  direction: directionProp = '',
  copyDraft = null,
  frameRef = null,
  editMode = false,
}) {
  const store = useStore();
  const copy = slideCopy(slide, parts);
  const need = visualNeedRecord(slide);
  const changeLayout = composeLayoutOf(slide, layoutOverride);
  const wantShots = shotsForLayout(changeLayout);
  const allowPhoto = wantShots > 0
    || (!changeLayout && slideAllowsPhoto(slide))
    || Boolean(slide?.image && typeof slide.image === 'object' && (slide.image.url || slide.image.thumb));
  const urls = allowPhoto
    ? keysOf(slide).map((k) => urlForKey(k, slide, localMedia, mediaByKey, preferProxy))
    : [];
  if (allowPhoto && !urls[0]) {
    const lead = photoUrl(slide, localMedia, mediaByKey)
      || slide?.image?.url
      || slide?.image?.thumb
      || '';
    if (lead) urls[0] = lead;
  }
  while (wantShots > 0 && urls.length < wantShots) urls.push(null);
  const src = urls[0] || null;
  const missingVisual = Boolean(need) && !src;
  const showHint = missingVisual && showVisualHint;
  const subjects = subjectsForSlide(slide, subjectsByKey);
  const layoutHtml = withSharedLayoutStyles(
    slide?.layoutHtml,
    Array.isArray(carouselLayoutHtmls) && carouselLayoutHtmls.length
      ? carouselLayoutHtmls
      : [slide?.layoutHtml],
  );
  const mark = markForTone(store.brandLogos, src ? 'photo' : 'ground');
  const logo = mark?.key
    ? { ...mark, url: canvasSafeUrl(mark.url, mark.key) || mark.url }
    : mark;
  const logoPosition = logoPositionOf(store.libraryEdits);

  // A Change layout pick (or applied id) wins over generated layoutHtml so the
  // studio can reshape a slide without waiting on the layout agent.
  if (isBlankSlide(slide)) {
    return (
      <div className="wv-ig__lay wv-ig__lay--blank" style={paint} aria-label="Empty slide">
        <span className="wv-ig__blankhint">Empty slide</span>
      </div>
    );
  }
  if (changeLayout) {
    return (
      <div className={`wv-ig__lay${showHint ? ' is-needvisual' : ''}`} style={paint}>
        <SlideCompose
          kind={changeLayout.kind}
          copy={copy}
          urls={urls}
          slide={slide}
          showVisualHint={showVisualHint}
          need={need}
          subjects={subjects}
          AnnotationOverlay={AnnotationOverlay}
        />
        {showHint && <VisualNeedHint need={need} />}
        <BrandMark mark={logo} position={logoPosition} />
      </div>
    );
  }

  if (layoutHtml) {
    return (
      <div className={`wv-ig__lay${showHint ? ' is-needvisual' : ''}`} style={paint}>
        <DynamicLayout
          html={layoutHtml}
          documentHtml={documentHtml}
          slideIndex={Number(slide?.index) > 0 ? Number(slide.index) : slideIndex}
          direction={directionProp || layoutDirectionOf(slide)}
          copyDraft={copyDraft}
          frameRef={frameRef}
          editMode={editMode}
          subjects={subjects}
          needsVisual={missingVisual}
          themed={themed}
          copy={{
            title: copy.title,
            subtitle: copy.sub,
            body: copy.body,
            items: copy.items,
            comparisonA: copy.cmpA,
            comparisonB: copy.cmpB,
            stat: copy.stat,
            quote: copy.quote,
            action: String(slide?.action || '').trim(),
            annotation: ANNOTATIONS_ENABLED ? (copy.annotation || slide?.annotation || null) : null,
          }}
          imageUrls={urls.map(iframeSafeUrl).filter(Boolean)}
          paint={paint}
        />
        {showHint && <VisualNeedHint need={need} />}
        <BrandMark mark={logo} position={logoPosition} />
      </div>
    );
  }
  return (
    <div className="wv-ig__lay" style={paint}>
      <SlideCompose
        kind="best-fit"
        copy={copy}
        urls={urls}
        slide={slide}
        showVisualHint={showVisualHint}
        need={need}
        subjects={subjects}
        AnnotationOverlay={AnnotationOverlay}
      />
      {showHint && <VisualNeedHint need={need} />}
      <BrandMark mark={logo} position={logoPosition} />
    </div>
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

function pillarKeyOf(day) {
  const allowed = ['discovery', 'credibility', 'trust'];
  const brief = day?.agentTrace?.strategyBrief;
  const candidates = [brief?.lens, brief?.pillar, day?.lens, day?.pillar];
  return candidates
    .map((v) => String(v || '').toLowerCase().trim())
    .find((v) => allowed.includes(v)) || '';
}

/* Why this post — the strategy, used in the desktop side panel and the phone aside. */
function WhyBody({ day }) {
  if (!day) return <p className="wv-muted">No strategy notes for this post yet.</p>;
  const pillarKey = pillarKeyOf(day);
  const pillar = pillarKey ? PILLAR_WHY[pillarKey] : null;
  const job = String(pillar?.job || day.goalTag || '').trim();
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

/* The IG-preview caption, collapsed to three lines with a "Show more" toggle
 * (bauhly-v3 FeedCard). Keyed per day by the caller so it resets on switch.
 * When collapsed the CTA and hashtags are part of "more" and stay hidden. */
function CaptionPreview({ handle, caption, direction, cta, tags = [], needsReview, onEdit }) {
  const [open, setOpen] = useState(false);
  const text = String(caption || '').trim();
  // A control that expands two lines into two lines does nothing — only draw it
  // when there is more to reveal: a long caption, a CTA, or hashtags.
  const long = text.length > 120 || Boolean(cta) || tags.length > 0;
  return (
    <div className="wv-ig__caption wv-ig__zone wv-ig__zone--caption">
      {needsReview && <span className="wv-ig__caprev">Caption needs review</span>}
      <p className={`wv-ig__captiontext ${long && !open ? 'is-clamped' : ''}`}>
        <b>{handle}</b>{' '}
        {caption || direction || <span className="wv-muted">Add a caption…</span>}
      </p>
      {(!long || open) && cta && <p className="wv-ig__cta">{cta}</p>}
      {(!long || open) && tags.length > 0 && (
        <p className="wv-ig__hashtags">
          {tags.map((t) => <span key={t}>#{t}</span>)}
        </p>
      )}
      {long && (
        <button
          type="button"
          className="wv-ig__more"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
      <span className="wv-ig__veil" aria-hidden="true" />
      <button
        type="button"
        className="wv-ig__zonebtn"
        aria-label="Edit the caption"
        onClick={onEdit}
      >
        <Glyph name="pencil" size={16} />
      </button>
    </div>
  );
}

/* Video cover — the animated hook clip from the Carousel Cover agent. Shown in
   the side panel; Apply swaps it in for the static hook slide. */
function VideoCoverPanel({ busy, error, url, spec, isApplied, hasApplied, onApply, onRemove, onRegenerate }) {
  const headline = Array.isArray(spec?.headline?.lines)
    ? spec.headline.lines.map((l) => l.text).filter(Boolean).join(' ')
    : '';
  if (busy) {
    return (
      <div className="wv-vcover wv-vcover--busy">
        <span className="wv-vcover__spinner" aria-hidden="true" />
        <p className="wv-vcover__status">Creating your animated hook…</p>
        <p className="wv-vcover__hint">Passing the strategy brief and content structure to the cover agent, then rendering the video. This takes a few seconds.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="wv-vcover wv-vcover--error">
        <p className="wv-vcover__status">Couldn’t create the video cover.</p>
        <p className="wv-vcover__hint">{error}</p>
        <button type="button" className="btn btn--sm" onClick={onRegenerate}>Try again</button>
      </div>
    );
  }
  if (!url) {
    return (
      <div className="wv-vcover">
        <p className="wv-vcover__hint">No video cover yet. Open the hook slide’s edit menu and choose <b>Video cover</b> to generate an animated hook from this post’s strategy and structure.</p>
      </div>
    );
  }
  return (
    <div className="wv-vcover">
      <div className="wv-vcover__stage">
        <video
          className="wv-vcover__video"
          src={url}
          controls
          autoPlay
          loop
          muted
          playsInline
        />
      </div>
      {headline && <p className="wv-vcover__cap">{headline}</p>}
      <div className="wv-vcover__actions">
        {isApplied ? (
          <>
            <span className="wv-vcover__applied"><Glyph name="check" size={14} /> Applied to the hook</span>
            <button type="button" className="btn btn--sm wv-vcover__ghost" onClick={onRemove}>Remove</button>
            <button type="button" className="btn btn--sm" onClick={onRegenerate}>Regenerate</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--sm" onClick={onApply}>Apply to hook</button>
            <button type="button" className="btn btn--sm" onClick={onRegenerate}>Regenerate</button>
            {hasApplied && (
              <button type="button" className="btn btn--sm wv-vcover__ghost" onClick={onRemove}>Remove current</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function WeekView({
  route: initialRoute,
  onBack,
  monthWeeks = [],
  onOpenWeek,
  initialDay = 0,
  onCaptured,
  onRouteChange,
  backLabel = 'Calendar',
  modeSwitch = false,
  embedded = false,
  hideStrip = false,
  onDayChange = null,
  onDistribute = null,
}) {
  const navigate = useNavigate();
  const projects = useProjects();
  // Empty-day popover (bauhly-v3 desktop-post-workspace): the strip answers
  // "Capture for this day / Change distribution" without replacing the post.
  const [dayPop, setDayPop] = useState(null); // { idx, iso, x, y } | null
  const [route, setRoute] = useState(initialRoute);
  const [selected, setSelected] = useState(() => {
    const list = initialRoute?.days || [];
    const n = list.length;
    if (n <= 0) return 0;
    const i = Math.max(0, Math.min(n - 1, Number(initialDay) || 0));
    if (!isEmptyCalDay(list[i])) return i;
    // Weekly: land on a real post. Day view may keep an empty index for its panel.
    if (!hideStrip) {
      const first = list.findIndex((d) => !isEmptyCalDay(d));
      if (first >= 0) return first;
    }
    return i;
  });
  const [slideIdx, setSlideIdx] = useState(0);
  // The post is the interface (bauhly-v3 §652): the studio acts on the preview's
  // own zones. `zone` is the one open editor — the picture ('visual') or the
  // words ('caption') — and it is a single value, so the two can never both be
  // open. `whyOpen` reveals the strategy beside the post.
  const [zone, setZone] = useState(null); // 'visual' | 'caption' | null
  // Which editor the visual zone's menu opened (bauhly-v3 §818/§989): the pencil
  // shows a menu — Add elements / Change theme / Change layout / … — and picking
  // one sets this. null = the menu itself is showing.
  const [visEdit, setVisEdit] = useState(null); // 'theme' | 'layout' | 'images' | 'words' | null
  // Nested flyout inside the visual-zone menu.
  const [menuPane, setMenuPane] = useState(null); // 'elements' | 'theme' | 'add-slide' | null
  const menuRef = useRef(null); // the .wv-ig__menu box, so flyouts can anchor to it
  const [flyPos, setFlyPos] = useState(null); // fixed-position for the portalled flyout
  const layoutFrameRef = useRef(null);
  // Experimental "Edit mode" (Canva-lite): drag/resize any element on the
  // rendered slide directly in the iframe. Visual-only for this pass — see
  // weekview/slideEditMode.js.
  const [slideEditMode, setSlideEditMode] = useState(false);
  // Edit image (bauhly-v3 §961/§965/§982): the still-photo studio. `adjustFor`
  // is the picture being cropped; `editSlot` is the measured layout region it
  // will occupy. More than one picture place opens the set first (`packOpen`).
  const [adjustFor, setAdjustFor] = useState(null); // { src, slotIndex } | null
  const [editSlot, setEditSlot] = useState(null);
  const [packOpen, setPackOpen] = useState(false);
  // Change layout (bauhly-v3 §809/§823/§825): picking a card is a draft until
  // Apply. The set is the four studio compositions, not the Visual Library.
  const [layPick, setLayPick] = useState(null);
  // When the layout agent has produced ranked options for this slide, the
  // Change layout picker shows those instead of the presets; this holds the
  // index of the option being drafted (null = the applied one).
  const [layOpt, setLayOpt] = useState(null);
  // How many picture places the shape just applied has, while the studio
  // decides whether to fill them now (bauhly-v3 §928).
  const [askImgs, setAskImgs] = useState(0);
  // Select images sheet (bauhly-v3 §821/§890): draft slots until Apply.
  const [imgPick, setImgPick] = useState(null); // { slots: (string|null)[], at: number } | null
  const [whyOpen, setWhyOpen] = useState(false);
  // Desktop side panel: Caption | Why this post | Video cover | Debug.
  const [sideTab, setSideTab] = useState('caption'); // 'caption' | 'why' | 'video' | 'debug'
  const aiDebug = useAiDebug();
  const videoCoverOn = useFeatureFlags().videoCover;
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutErr, setLayoutErr] = useState('');
  // On-demand Change-layout variations for the current slide. The layout agent
  // composes four fresh layouts of just this slide when Change layout is opened
  // and the slide has none yet — instead of the carousel pre-generating them.
  const [layVarBusy, setLayVarBusy] = useState(false);
  const [layVarErr, setLayVarErr] = useState('');
  const [optionsBusy, setOptionsBusy] = useState(false); // loading the week's stored layoutOptions
  const optionsLoadedRef = useRef(null);
  // Animated Carousel Cover agent — a freshly rendered clip for the current day,
  // held until the studio applies it to the hook slide. { spec, url, key }.
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverErr, setCoverErr] = useState('');
  const [coverResult, setCoverResult] = useState(null);
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
  const [wordFocus, setWordFocus] = useState(null); // role key to focus when Edit text opens
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
  const [schedMenu, setSchedMenu] = useState(false); // schedule button dropdown
  const [askSchedule, setAskSchedule] = useState(false); // no-caption confirm
  // the inline "Change time" editor: null = closed, else { date, time }
  const [timeDraft, setTimeDraft] = useState(null);
  const [pick, setPick] = useState(null); // 'date' = the calendar popover is open
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

  // ── Per-day API adapters ────────────────────────────────────────────────
  // Bridge the editor's (routeId, dayIndex, …) calls to the post-centric API.
  // Each day is its own PlannedPost, so the real id is days[index]._id (the
  // passed routeId — the synthetic week id — is ignored). Responses are single
  // posts; mergePost splices the updated post back into the current week route
  // so the other days survive.
  const postIdAt = (i) => routeRef.current?.days?.[i]?._id;
  const mergePost = (updated) => {
    const cur = routeRef.current;
    if (!cur || !updated?._id) return cur;
    return { ...cur, days: (cur.days || []).map((d) => (String(d._id) === String(updated._id) ? updated : d)) };
  };
  const updateDayContent = (_id, i, content) => updatePostContent(postIdAt(i), content).then(mergePost);
  const markDayPublished = (_id, i, published) => markPublished(postIdAt(i), published).then(mergePost);
  const scheduleDay = (_id, i, scheduledAt, extras) => schedulePost(postIdAt(i), scheduledAt, extras).then(mergePost);
  const retryScheduledDay = (_id, i) => retryScheduled(postIdAt(i)).then(mergePost);
  const setDayTime = (_id, i, { time } = {}) => setPostTime(postIdAt(i), time || '').then(mergePost);
  const reviewDay = (_id, i, on) => setPostReview(postIdAt(i), on).then(mergePost);
  const runDayLayout = (_id, i, opts) => runPostLayout(postIdAt(i), opts).then((d) => ({ ...d, route: mergePost(d.post) }));
  const runDayCover = (_id, i, visual) => runPostCover(postIdAt(i), visual).then((d) => ({ ...d, route: mergePost(d.post) }));
  const runSlideLayoutVariations = (_id, i, slideIndex) => apiRunSlideLayoutVariations(postIdAt(i), slideIndex);
  // Options are per-post; fetch each day's, index-aligned with route.days.
  const getRouteOptions = () => Promise.all((routeRef.current?.days || []).map((d) => getPostOptions(d._id)));
  const getDayDebug = (_id, i) => getPostDebug(postIdAt(i));
  const publishDayToMeta = (_id, i, body) => publishPostToMeta(postIdAt(i), body).then((r) => ({ ...r, route: mergePost(r.post) }));

  const weekId = initialRoute?._id;
  useEffect(() => {
    if (!aiDebug.enabled && sideTab === 'debug') setSideTab('caption');
    if (!videoCoverOn && sideTab === 'video') setSideTab('caption');
  }, [aiDebug.enabled, videoCoverOn, sideTab]);
  useEffect(() => {
    setLayoutBusy(false);
    setLayoutErr('');
  }, [selected]);
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

  // The debug trace (agentTrace.layout/.carousel, ~2.2MB) is NOT in the render
  // payload — it is fetched per-day, on demand, only when the Debug panel is open
  // for the visible day. Keeps a normal week open from ever pulling the trace.
  const debugFetchedRef = useRef(new Set());
  useEffect(() => {
    if (!aiDebug.enabled || sideTab !== 'debug' || !weekId) return;
    const key = `${weekId}#${selected}`;
    if (debugFetchedRef.current.has(key)) return;
    const cur = routeRef.current?.days?.[selected];
    if (cur?.agentTrace && (cur.agentTrace.layout || cur.agentTrace.carousel)) {
      debugFetchedRef.current.add(key);
      return;
    }
    debugFetchedRef.current.add(key);
    getDayDebug(weekId, selected).then((trace) => {
      if (!trace || (!trace.layout && !trace.carousel)) return;
      setRoute((prev) => {
        if (!prev || prev._id !== weekId) return prev;
        const days = (prev.days || []).map((d, i) => (
          i === selected ? { ...d, agentTrace: { ...(d.agentTrace || {}), ...trace } } : d
        ));
        return { ...prev, days };
      });
    }).catch(() => {});
  }, [aiDebug.enabled, sideTab, weekId, selected]);

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
  }, [initialRoute?.instagramUsername, weekId]);

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
  const subjectsByKey = useMemo(() => {
    const map = new Map();
    allImages.forEach((img) => {
      if (!img?.key || !img.subjects?.length) return;
      map.set(img.key, img.subjects);
    });
    return map;
  }, [allImages]);
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
  // Agent-generated carousel slides always render as the raw layout-agent
  // output — the actual model result, same as the AI Debug "Carousel preview"
  // — never auto-repainted with Library visual settings. Applying the studio's
  // brand palette to a slide is a manual, per-post choice made from the slide's
  // context menu (Change theme), not an automatic side effect of having set a
  // palette. (SafeLayout / best-fit compositions are the studio's own art and
  // stay branded regardless — they have no agent styling to preserve.)
  const hasVisualEdits = false;
  const days = route?.days || [];
  const day = days[selected] || days[0];
  // Local "YYYY-MM-DD" for today — the strip rings today in lime, the reference's
  // "you are here" (a selected day that is not today takes ink instead).
  const todayIso = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();

  // Close the empty-day menu when its anchor would move (scroll / resize) —
  // coordinates are taken at press time and go stale otherwise (bauhly-v3).
  useEffect(() => {
    if (!dayPop) return undefined;
    const close = () => setDayPop(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [dayPop]);

  // When embedded in the calendar, let the parent's toolbar name the day it is
  // showing (e.g. "September 22 | Tuesday") — the selected post is WeekView's
  // own internal state, so it reports the change out rather than being told.
  useEffect(() => {
    onDayChange?.(day, selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day?._id, day?.date, selected]);

  const enrichedDays = useMemo(() => {
    // Render only the images the plan actually assigns (persisted assetKeys).
    // A slide with no assigned photo shows empty picture regions rather than
    // borrowing one from another post. Empty calendar placeholders stay bare.
    const used = new Set();
    return days.map((d) => {
      if (isEmptyCalDay(d)) return { ...d, slides: [], status: 'empty' };
      const slides = bindOwnedSlides(
        withAllocatedSlideKeys(deriveSlides(d), d),
        allImages,
        localMedia,
        used,
      );
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
  // Video cover: the last clip the agent rendered for this day (agentTrace.cover)
  // and the one currently applied to the hook (day.content.coverVideo).
  const existingCover = day?.agentTrace?.cover || null;
  const existingCoverUrl = existingCover?.videoKey ? videoProxyUrl(existingCover.videoKey) : '';
  const appliedCoverKey = day?.content?.coverVideo?.key || '';
  const appliedCoverUrl = appliedCoverKey ? videoProxyUrl(appliedCoverKey) : '';
  const handle = route?.instagramUsername || 'your.studio';
  // Publish/schedule only when Meta is linked for *this* plan's Instagram handle.
  const metaForHandle = metaConnectionFor(metaStatus, handle);
  const metaConnected = isMetaConnectedFor(metaStatus, handle);
  const otherMeta = otherMetaConnections(metaStatus, handle);
  // A post is "scheduled" when it carries a slot and hasn't gone out yet. The
  // slot only means anything with an account to publish to (bauhly-v3 §783).
  const isScheduled = metaConnected && !!day?.scheduledAt && !day?.published;
  const scheduleStatus = String(day?.scheduleStatus || '');
  const isPublishingSlot = isScheduled && scheduleStatus === 'publishing';
  const scheduleFailed = isScheduled && scheduleStatus === 'failed';
  // "Save for review" — held in the calendar as a draft, not queued to publish.
  const isReview = !!day?.savedForReview && !isScheduled && !day?.published;
  const slotTime = toSpoken(slotTimeRaw(day, route));
  // the time is editable only while the decision is still open (bauhly-v3 §787)
  const canEditTime = !isScheduled && !day?.published;
  const timeSeedAt = to24h(slotTimeRaw(day, route));
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
    setDayPop(null);
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
    setCoverResult(null);
    setCoverErr('');
  }

  // Skip empty calendar placeholders when stepping with the post arrows — the
  // strip still shows them, but the stage only holds real posts (bauhly-v3).
  function nearestPostIdx(from, dir) {
    let i = from;
    while (true) {
      i += dir;
      if (i < 0 || i >= days.length) return -1;
      if (!isEmptyCalDay(days[i])) return i;
    }
  }

  function onStripDay(i, el) {
    const d = days[i];
    if (!isEmptyCalDay(d)) {
      animateToDay(i);
      return;
    }
    // Empty day: keep the open post; answer with the same two actions the
    // month menu offers (Capture for this day / Change distribution).
    const r = el?.getBoundingClientRect();
    setDayPop(r
      ? {
          idx: i,
          iso: String(d.date || ''),
          x: Math.min(r.left, window.innerWidth - 248),
          y: r.bottom + 8,
        }
      : null);
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
    if (isEmptyCalDay(days[next]) && !hideStrip) {
      // Weekly strip never stages an empty day — use the popover path instead.
      return;
    }
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
  function prevDay() {
    const i = nearestPostIdx(selected, -1);
    if (i >= 0) goFromArrow(i, -1);
  }
  function nextDay() {
    const i = nearestPostIdx(selected, 1);
    if (i >= 0) goFromArrow(i, 1);
  }

  const prevPostIdx = nearestPostIdx(selected, -1);
  const nextPostIdx = nearestPostIdx(selected, 1);
  // While the empty-day menu is open, that card takes the strip's selected mark
  // (ink) so the studio can see which day they asked about (bauhly-v3).
  const stripOnIdx = dayPop ? dayPop.idx : selected;

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

  // The submenu flyout is portalled to <body> so the card's overflow (and the
  // side panel) never clip or cover it. Anchor it to the menu box: to the right
  // when there is room, otherwise to the left, clamped to the viewport.
  useLayoutEffect(() => {
    if (!menuPane || !menuRef.current) { setFlyPos(null); return; }
    const r = menuRef.current.getBoundingClientRect();
    const W = Math.min(300, window.innerWidth - 24);
    const GAP = 8;
    const M = 12;
    let left = r.right + GAP;
    if (left + W > window.innerWidth - M) left = r.left - GAP - W;
    if (left < M) left = M;
    const top = Math.max(M, Math.min(r.top, window.innerHeight - M - 120));
    setFlyPos({ top, left, width: W });
  }, [menuPane]);

  // Open one of the post's editors. Opening the picture closes the words, and
  // vice-versa — a single value can only name one zone. Opening the caption
  // seeds its draft from the day's current caption.
  function openZone(next) {
    setVisEdit(null); // the visual zone always opens on its MENU, not an editor
    setMenuPane(null);
    setSlideEditMode(false);
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
    setMenuPane(null);
    setPickerOpen(false);
    setCreating(false);
    setImgPick(null);
    setAskImgs(0);
    setCapBusy(false);
    setWordsBusy(false);
    setSlideEditMode(false);
  }

  // Press anywhere outside the caption editor and it closes without saving —
  // the same rule as bauhly-v3 §665. Done (Apply changes) is the only commit;
  // the draft lives in `capDraft` and goes with the close. Mousedown, not click,
  // so a press on another edit control can switch editors in one gesture (§849).
  useEffect(() => {
    if (zone !== 'caption') return undefined;
    const away = (e) => {
      if (e.target.closest('.wv-ig__zone--caption.is-editing')) return;
      if (e.target.closest('.wv-ig__edit') || e.target.closest('.wv-ig__menuwrap')
        || e.target.closest('.wv-ig__menuscrim')) return;
      if (e.target.closest('.wv-vlib') || e.target.closest('.wv-vlib__scrim')) return;
      if (e.target.closest('.wv-confirm') || e.target.closest('.wv-confirm__scrim')) return;
      if (e.target.closest('.wv-imgs') || e.target.closest('.wv-imgs__chat')) return;
      if (e.target.closest('.wv-schedask') || e.target.closest('.wv-schedask__scrim')) return;
      if (e.target.closest('.wv-ig__zonebtn') || e.target.closest('.wv-ig__tabedit') || e.target.closest('.wv-ig__layrun')) return;
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
      setPick(null);
      setClockOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [timeDraft]);

  // Layout / theme picks are a draft until Apply changes — press elsewhere to abandon.
  useEffect(() => {
    if (zone !== 'visual' || (visEdit !== 'layout' && visEdit !== 'theme')) return undefined;
    const away = (e) => {
      if (e.target.closest('.wv-layed')) return;
      if (e.target.closest('.wv-vlib') || e.target.closest('.wv-vlib__scrim')) return;
      if (e.target.closest('.wv-confirm') || e.target.closest('.wv-confirm__scrim')) return;
      if (e.target.closest('.wv-ig__zonebtn') || e.target.closest('.wv-ig__menuwrap')
        || e.target.closest('.wv-ig__menuscrim')) return;
      setVisEdit(null);
      setLayPick(null);
      setLayOpt(null);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [zone, visEdit]);

  // Edit text is the same draft rule: leave without Apply and the words go back.
  useEffect(() => {
    if (zone !== 'visual' || visEdit !== 'words') return undefined;
    const away = (e) => {
      if (e.target.closest('.wv-worded')) return;
      if (e.target.closest('.wv-ig__zonebtn') || e.target.closest('.wv-ig__menuwrap')
        || e.target.closest('.wv-ig__menuscrim')) return;
      setVisEdit(null);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [zone, visEdit]);

  useEffect(() => {
    if (visEdit !== 'layout' && visEdit !== 'theme') { setLayPick(null); setLayOpt(null); }
    if (visEdit !== 'words') { setWordDraft(null); setWordFocus(null); }
  }, [visEdit]);

  // Switching slides resets which agent option is being drafted.
  useEffect(() => { setLayOpt(null); }, [selected, safeIdx]);

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
      if (schedMenu) { setSchedMenu(false); return; }
      if (pick) { setPick(null); return; }
      if (timeDraft) { setTimeDraft(null); setClockOpen(false); return; }
      if (adjustFor) { setAdjustFor(null); setEditSlot(null); return; }
      if (packOpen) { setPackOpen(false); return; }
      if (creating) { setCreating(false); return; }
      if (imgPick) { setImgPick(null); return; }
      if (askImgs) { setAskImgs(0); return; }
      if (!zone) return;
      if (menuPane) { setMenuPane(null); return; }
      if (visEdit) setVisEdit(null);
      else closeZone();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zone, visEdit, menuPane, askImgs, imgPick, creating, timeDraft, pick, adjustFor, packOpen, schedMenu]);

  // Close the schedule dropdown on any press outside it, and whenever the open
  // day changes.
  useEffect(() => {
    if (!schedMenu) return undefined;
    function onDown(e) {
      if (e.target.closest?.('.wv-sched')) return;
      setSchedMenu(false);
    }
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [schedMenu]);

  useEffect(() => { setSchedMenu(false); setPublishMsg(''); }, [selected]);

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

  async function persistSlides(nextSlides, dayIndex = selected, extra = {}) {
    if (!route?._id) return;
    const gen = ++persistGenRef.current;
    const payload = slidesPayload(nextSlides, lastSavedByDayRef.current[dayIndex] || []);
    setSaving(true);
    try {
      const updated = await updateDayContent(route._id, dayIndex, { slides: payload, ...extra });
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

  function replaceSlides(next, { persist = true, dayIndex = selected, extra = {} } = {}) {
    setRoute((prev) => {
      const daysCopy = [...(prev.days || [])];
      const d = { ...daysCopy[dayIndex] };
      const content = {
        ...(d.content || {}),
        slides: next.map((s) => slideRecord(s)),
        onScreenText: next.map((s) => s.title),
        ...extra,
      };
      if (extra.carouselHtml) {
        const trace = { ...(d.agentTrace || {}) };
        if (trace.layout && typeof trace.layout === 'object') {
          trace.layout = { ...trace.layout, html: extra.carouselHtml };
        }
        if (trace.carousel && typeof trace.carousel === 'object') {
          trace.carousel = { ...trace.carousel, html: extra.carouselHtml };
        }
        d.agentTrace = trace;
      }
      daysCopy[dayIndex] = { ...d, content };
      return { ...prev, days: daysCopy };
    });
    if (persist) persistSlides(next, dayIndex, extra);
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
    const insertAt = Math.min(safeIdx + 1, base.length);
    const role = roles[Math.min(insertAt, roles.length - 1)] || 'Slide';
    const next = [...base.slice(0, insertAt), makeBlankSlide(role), ...base.slice(insertAt)];
    replaceSlides(next);
    setSlideIdx(insertAt);
  }

  function duplicateSlide() {
    const base = deriveSlides(day);
    const src = base[safeIdx];
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    const insertAt = safeIdx + 1;
    const next = [...base.slice(0, insertAt), copy, ...base.slice(insertAt)];
    replaceSlides(next);
    setSlideIdx(insertAt);
  }

  function removeSlide(index) {
    const base = deriveSlides(day);
    if (base.length <= 1) return;
    const next = base.filter((_, i) => i !== index);
    replaceSlides(next);
    setSlideIdx((cur) => Math.min(cur, next.length - 1));
  }

  // Add a structure element to the open slide. Empty fields get a short
  // placeholder. Title uses a head-only ground layout (no body field, no photo)
  // when building from a blank / Add-elements slide.
  function addSlideElement(el) {
    if (!el?.field) return;
    const role = activeSlide?.role || 'Hook';
    const cur = String(activeSlide?.[el.field] || '').trim();
    const adding = !cur;
    const wasBlank = isBlankSlide(activeSlide);
    const studioBuilt = wasBlank || isManualSlide(activeSlide);
    const patch = {};
    if (adding) patch[el.field] = el.placeholder;

    if (studioBuilt) {
      patch.manual = true;
      patch.blank = false;
      patch.layoutHtml = '';
      patch.layoutTheme = '';
      patch.layoutOptions = [];

      // Starting from empty: only the element being added — never invent body/image.
      if (wasBlank) {
        patch.title = el.field === 'title' ? (patch.title || el.placeholder) : '';
        patch.subtitle = el.field === 'subtitle' ? (patch.subtitle || el.placeholder) : '';
        patch.body = el.field === 'body' ? (patch.body || el.placeholder) : '';
        patch.stat = el.field === 'stat' ? (patch.stat || el.placeholder) : '';
        patch.quote = el.field === 'quote' ? (patch.quote || el.placeholder) : '';
        patch.assetKey = '';
        patch.assetKeys = [];
        patch.image = '';
        patch.visual = null;
      }

      const nextSlide = { ...activeSlide, ...patch, role };
      patch.layout = elementLayoutForSlide(nextSlide);

      // Element layouts are ground-only — strip photographs so Add title cannot
      // pull in a background from allocation / prior carousel art.
      const lay = findElementLayout(patch.layout);
      if (lay && shotsForLayout(lay) === 0) {
        patch.assetKey = '';
        patch.assetKeys = [];
        patch.image = '';
      }
    }

    const patched = { ...activeSlide, ...patch, role };
    if (Object.keys(patch).length) patchActiveSlide(patch);
    setMenuPane(null);

    // Every element is a text field the studio then edits — open Edit text on
    // the one just added and focus its field, so adding an element flows
    // straight into writing it (Canva-style).
    const wordLay = composeLayoutOf(patched) || BEST_FIT_LAYOUT;
    setWordDraft(seedWordDraft(wordLay, patched, day?.contentType || day?.format, {
      documentHtml: isManualSlide(patched) || isBlankSlide(patched) ? '' : carouselDocumentOf(day),
      direction: isManualSlide(patched) ? '' : layoutDirectionOf(patched),
    }));
    setWordFocus(STACK_FIELD_TO_ROLE[el.field] || null);
    setVisEdit('words');
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

  // ── Schedule this post. Pressing "Schedule" renders the slides, uploads
  // them, and records the slot. The daily job posts after that time; "Publish
  // now" sends immediately. "Unschedule" puts it back.
  async function renderPublishKeys() {
    setPublishMsg('Rendering slides…');
    const nodes = exportRefs.current.slice(0, slides.length).filter(Boolean);
    if (!nodes.length) throw new Error('Nothing to render for this post yet.');
    const blobs = [];
    for (const node of nodes) {
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
    return imageKeys;
  }

  async function doSchedule() {
    if (!route || !day || scheduling) return;
    setPublishMsg('');
    setScheduling(true);
    try {
      const at = slotDateOf(route, selected, day);
      const imageKeys = await renderPublishKeys();
      setPublishMsg('Scheduling…');
      setRoute(await scheduleDay(route._id, selected, at.toISOString(), { publishImageKeys: imageKeys }));
      setPublishMsg('');
    } catch (err) {
      setPublishMsg(err.response?.data?.message || err.message || 'Could not schedule just now');
    } finally {
      setScheduling(false);
    }
  }

  function pressSchedule() {
    if (!route || !day || scheduling) return;
    setSchedMenu(false);
    if (!metaConnected) { setConnectOpen(true); return; }
    const caption = day.content?.caption?.trim();
    if (!caption) { setAskSchedule(true); return; }
    doSchedule();
  }

  // "Save for review" — keep the post in the calendar as a draft, held back
  // from the publish queue. Reversible: Schedule or Unschedule clears the hold.
  async function saveForReview() {
    if (!route || !day || scheduling) return;
    setSchedMenu(false);
    setPublishMsg('');
    setScheduling(true);
    try {
      setRoute(await reviewDay(route._id, selected, true));
      setPublishMsg('Saved for review');
    } catch (err) {
      setPublishMsg(err.response?.data?.message || 'Could not save for review just now');
    } finally {
      setScheduling(false);
    }
  }

  async function unschedule() {
    if (!route || !day || scheduling || isPublishingSlot) return;
    setSchedMenu(false);
    setPublishMsg('');
    setScheduling(true);
    try {
      // A review hold and a live slot are cleared the same way — back to a
      // plain draft — so Unschedule handles both.
      setRoute(day?.savedForReview
        ? await reviewDay(route._id, selected, false)
        : await scheduleDay(route._id, selected, null));
    } catch (err) {
      setPublishMsg(err.response?.data?.message || 'Could not unschedule just now');
    } finally {
      setScheduling(false);
    }
  }

  async function retrySchedule() {
    if (!route || !day || scheduling) return;
    setPublishMsg('');
    setScheduling(true);
    try {
      setRoute(await retryScheduledDay(route._id, selected));
    } catch (err) {
      setPublishMsg(err.response?.data?.message || 'Could not retry just now');
    } finally {
      setScheduling(false);
    }
  }

  // ── Edit publish time (bauhly-v3 §790/§794). The time is edited in the post,
  // on the slot's own surface. Opening it seeds the draft from the effective
  // time and whether that time is the plan's weekly one.
  function openTimeEditor() {
    if (!day) return;
    setSchedMenu(false);
    setPublishMsg('');
    closeZone();
    setPick(null);
    setTimeDraft({
      date: String(day.date || '').slice(0, 10),
      time: to24h(slotTimeRaw(day, route)),
    });
  }

  // The Time field commits a "HH:MM" — the post's own slot time. The default
  // clears it so the plan's habit takes over again (bauhly-v3 §787).
  async function commitTime(at) {
    if (!route || !day || savingTime) return;
    setTimeDraft((d) => (d ? { ...d, time: at } : d));
    const payload = at === DEFAULT_TIME_24 ? { time: '' } : { time: at };
    setSavingTime(true);
    try {
      setRoute(await setDayTime(route._id, selected, payload));
    } catch (err) {
      setPublishMsg(err.response?.data?.message || 'Could not save the time just now');
    } finally {
      setSavingTime(false);
    }
  }

  // The Date field moves the post to another day. It reuses the Shift-posts
  // endpoint (a single-post move), then reflects the new date locally and tells
  // the parent so its calendar follows.
  async function moveDate(iso) {
    setPick(null);
    const from = String(day?.date || '').slice(0, 10);
    if (!route?._id || !iso || iso === from) return;
    setSavingTime(true);
    setPublishMsg('');
    try {
      await shiftPosts({ [route._id]: iso });
      const d = dateFromIso(iso);
      const patch = {
        date: iso,
        day: SCHED_DAYS[d.getDay()],
        dateLabel: `${SCHED_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`,
      };
      const updated = {
        ...route,
        date: iso,
        weekOf: iso,
        startsAt: iso,
        days: (route.days || []).map((dd, i) => (i === selected ? { ...dd, ...patch } : dd)),
      };
      setRoute(updated);
      setTimeDraft((t) => (t ? { ...t, date: iso } : t));
      onRouteChange?.(updated);
    } catch (err) {
      setPublishMsg(err.response?.data?.message || 'Could not move this post to that day.');
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

    if (!metaConnected) {
      setConnectOpen(true);
      return;
    }

    setPublishing(true);
    try {
      let imageKeys = Array.isArray(day.publishImageKeys) ? day.publishImageKeys.filter(Boolean) : [];
      if (!imageKeys.length) {
        imageKeys = await renderPublishKeys();
      }
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
        setConnectOpen(true);
      } else {
        const fromEvent = err && typeof err === 'object' && err.type === 'error'
          ? 'A slide image failed to load while rendering. Check empty image slots, then try again.'
          : '';
        setPublishMsg(
          err.response?.data?.message
            || err.message
            || fromEvent
            || 'Could not publish just now'
        );
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
    a.download = `post-${((day?.title || day?.dateLabel || day?.day || 'post')).replace(/\s+/g, '-')}.md`;
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
      // Fill empty calendar slots with fresh posts. This is a calendar-level
      // action (it creates OTHER posts, not this one), so we just report how
      // many landed — the new posts appear on the calendar. This post is left
      // exactly as it is.
      const data = await generatePlan('fill-empty-slots', distributionForGenerate());
      const added = Number(data?.count) || (Array.isArray(data?.posts) ? data.posts.length : 0);
      setReplanMsg(added ? `Added ${added} post${added === 1 ? '' : 's'} to empty days.` : 'No empty days to fill.');
      onCaptured?.();
    } catch (err) {
      // a `needsInput` 422 is the strategist asking for a clearer idea, not a
      // failure — keep it gentle and point at Capture idea
      const msg = err?.response?.data?.needsInput
        ? 'Add a clearer idea first — tap Capture idea to fill these days.'
        : (err?.response?.data?.message || 'Could not add posts just now. Try again in a moment.');
      setReplanMsg(msg);
    } finally {
      setReplanning(false);
    }
  }

  async function handleRunLayout(opts) {
    if (layoutBusy || !route?._id) return;
    const themeId = typeof opts === 'string' ? opts.trim() : String(opts?.themeId || '').trim();
    const referenceImageKey = typeof opts === 'object' && opts ? String(opts.referenceImageKey || '').trim() : '';
    setLayoutBusy(true);
    setLayoutErr('');
    try {
      const data = await runDayLayout(
        route._id,
        selected,
        referenceImageKey ? { referenceImageKey } : (themeId ? { themeId } : undefined),
      );
      if (data?.route) {
        setRoute(data.route);
        onRouteChange?.(data.route);
      }
    } catch (err) {
      const timedOut = err?.code === 'ECONNABORTED' || /timeout/i.test(String(err?.message || ''));
      setLayoutErr(
        timedOut
          ? 'Carousel agent timed out. Try again — a server restart mid-run can leave this stuck.'
          : (err.response?.data?.message || err.message || 'Carousel agent failed.'),
      );
    } finally {
      setLayoutBusy(false);
    }
  }

  async function handleChangeTheme(theme) {
    if (!theme?.id || layoutBusy) return;
    setMenuPane(null);
    closeZone();
    await handleRunLayout(theme.id);
  }

  // Change theme › Upload a reference: upload the studio's photo, then rebuild
  // the carousel with it as the visual reference instead of a catalog theme.
  async function handleUploadReferenceTheme(file) {
    if (!file || layoutBusy || !route?._id) return;
    setMenuPane(null);
    closeZone();
    setLayoutBusy(true);
    setLayoutErr('');
    try {
      const uploaded = await uploadFiles([file]);
      const key = uploaded?.[0]?.key;
      if (!key) throw new Error('Could not upload that photo.');
      const data = await runDayLayout(route._id, selected, { referenceImageKey: key });
      if (data?.route) {
        setRoute(data.route);
        onRouteChange?.(data.route);
      }
    } catch (err) {
      const timedOut = err?.code === 'ECONNABORTED' || /timeout/i.test(String(err?.message || ''));
      setLayoutErr(
        timedOut
          ? 'Carousel agent timed out. Try again — a server restart mid-run can leave this stuck.'
          : (err.response?.data?.message || err.message || 'Could not use that reference photo.'),
      );
    } finally {
      setLayoutBusy(false);
    }
  }

  // Load the week's stored layoutOptions (kept out of the render payload) and
  // merge them into the in-memory route, once per week. Runs when Change layout
  // first opens so the picker shows the persisted variations without a fetch per
  // slide and without regenerating.
  async function ensureRouteOptions() {
    if (optionsLoadedRef.current === weekId || !weekId) return;
    optionsLoadedRef.current = weekId;
    setOptionsBusy(true);
    try {
      const days = await getRouteOptions(weekId);
      setRoute((prev) => {
        if (!prev || prev._id !== weekId) return prev;
        const nextDays = (prev.days || []).map((d, di) => {
          const dayOpts = days[di];
          if (!Array.isArray(dayOpts) || !Array.isArray(d.content?.slides)) return d;
          const byIndex = new Map(dayOpts.map((o) => [Number(o.index), o.layoutOptions]));
          const slides = d.content.slides.map((s, si) => {
            const idx = Number(s?.index) > 0 ? Number(s.index) : si + 1;
            const opts = byIndex.get(idx);
            return Array.isArray(opts) ? { ...s, layoutOptions: opts } : s;
          });
          return { ...d, content: { ...d.content, slides } };
        });
        return { ...prev, days: nextDays };
      });
    } catch {
      optionsLoadedRef.current = null; // allow a retry
    } finally {
      setOptionsBusy(false);
    }
  }

  // Change layout: generate four fresh layouts of THIS slide on demand. Runs the
  // layout agent on one slide (cheap) rather than pre-generating variations for
  // the whole carousel. Stores the results on the slide's layoutOptions.
  //
  // Never regenerate when this slide already has generated variations — that is
  // wasted spend. Auto-open passes no `force`, so it no-ops once variations
  // exist; only the explicit Regenerate / Try-again buttons pass force:true.
  async function generateLayoutVariations(force = false) {
    if (layVarBusy || !route?._id) return;
    if (!force && !needsLayoutVars) return;
    const slideIndex = Number(activeSlide?.index) > 0 ? Number(activeSlide.index) : safeIdx + 1;
    setLayVarBusy(true);
    setLayVarErr('');
    try {
      const data = await runSlideLayoutVariations(route._id, selected, slideIndex);
      const opts = Array.isArray(data?.options) ? data.options : [];
      if (opts.length) {
        // Merge the new options into the active slide locally — the endpoint no
        // longer returns the heavy full route.
        setRoute((prev) => {
          if (!prev) return prev;
          const days = [...(prev.days || [])];
          const d = { ...days[selected] };
          const content = { ...(d.content || {}) };
          content.slides = (content.slides || []).map((s, i) => {
            const si = Number(s?.index) > 0 ? Number(s.index) : i + 1;
            return si === slideIndex
              ? { ...s, layout: 'dynamic', layoutHtml: String(s.layoutHtml || '') || opts[0].html, layoutOptions: opts }
              : s;
          });
          d.content = content;
          days[selected] = d;
          return { ...prev, days };
        });
      }
      setLayOpt(0);
    } catch (err) {
      const timedOut = err?.code === 'ECONNABORTED' || /timeout/i.test(String(err?.message || ''));
      setLayVarErr(
        timedOut
          ? 'Layout agent timed out. Try again in a moment.'
          : (err.response?.data?.message || err.message || 'Could not generate layouts for this slide.'),
      );
    } finally {
      setLayVarBusy(false);
    }
  }

  // The studio's active Visual Library settings, resolved to concrete palette +
  // font names, so the rendered cover matches the brand (not a fixed template).
  function coverVisualPayload() {
    try {
      const ident = identityOf(vbStore);
      const pal = ident?.palette || {};
      const faceLabel = (slot, dflt) => {
        const id = ident?.type?.[slot]?.face || dflt;
        return (FACES.find((f) => f.id === id) || {}).label || '';
      };
      const style = styleOf(vbStore?.brandStyle) || {};
      const mood = typeof style.mood === 'string' ? style.mood : (style.mood?.label || style.mood?.name || '');
      const payload = {
        palette: { bg: pal.ground || '', ink: pal.fg || '', accent: pal.accent || '' },
        fonts: { headline: faceLabel('headline', 'display'), body: faceLabel('body', 'ui') },
        mood: String(mood || ''),
      };
      const hasAny = payload.palette.bg || payload.palette.accent || payload.fonts.headline;
      return hasAny ? payload : null;
    } catch {
      return null;
    }
  }

  // Animated Carousel Cover — runs the cover agent (strategy brief + content
  // structure) and renders a hook video. The clip is shown in the side panel;
  // it only replaces the static hook slide once the studio applies it.
  async function handleMakeCover() {
    if (coverBusy || !route?._id) return;
    closeZone();
    setSideTab('video');
    setCoverBusy(true);
    setCoverErr('');
    setCoverResult(null);
    try {
      const data = await runDayCover(route._id, selected, coverVisualPayload());
      const c = data?.cover || {};
      const url = (c.videoKey ? videoProxyUrl(c.videoKey) : '') || c.videoUrl || '';
      setCoverResult({ spec: c.spec || null, url, key: c.videoKey || '' });
      if (data?.route) { setRoute(data.route); onRouteChange?.(data.route); }
    } catch (err) {
      setCoverErr(err.response?.data?.message || err.message || 'Could not create the video cover.');
    } finally {
      setCoverBusy(false);
    }
  }

  // Apply the rendered clip to the hook (slide 1) — persisted as day.content
  // .coverVideo so the preview plays it in place of the static cover.
  function handleApplyCover() {
    const key = coverResult?.key || existingCover?.videoKey || '';
    const url = coverResult?.url || existingCoverUrl || '';
    if (!key && !url) return;
    persistDayExtra({ coverVideo: { key } });
    setRoute((prev) => {
      if (!prev?.days) return prev;
      const days = [...prev.days];
      const d = { ...days[selected] };
      d.content = { ...(d.content || {}), coverVideo: { key } };
      days[selected] = d;
      return { ...prev, days };
    });
    setSlideIdx(0);
    closeZone();
  }

  // Remove an applied video cover — the hook goes back to its static slide.
  function handleRemoveCover() {
    persistDayExtra({ coverVideo: null });
    setRoute((prev) => {
      if (!prev?.days) return prev;
      const days = [...prev.days];
      const d = { ...days[selected] };
      d.content = { ...(d.content || {}), coverVideo: null };
      days[selected] = d;
      return { ...prev, days };
    });
  }

  async function persistDayExtra(content) {
    if (!route?._id) return;
    try {
      const updated = await updateDayContent(route._id, selected, content);
      setRoute(updated);
      onRouteChange?.(updated);
    } catch { /* keep local until retry */ }
  }

  const weekUsage = weekUsageOf(route);

  const slideRoleName = activeSlide?.role || 'Hook';
  const pickerImages = useMemo(() => {
    if (!allImages.length) return [];
    const dayText = [day?.title, day?.direction, day?.content?.caption, day?.contentType].filter(Boolean).join(' ');
    const words = keywordSet(`${activeSlide?.title || ''} ${dayText}`);
    return allImages
      .map((img) => ({ img, score: relevanceScore(words, img) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.img);
  }, [allImages, activeSlide?.title, day]);
  const slideLayouts = CHANGE_LAYOUTS;
  // the studio's palette + faces, so the previews here read exactly as they do
  // in the Visual Library (empty object = the library's shipped defaults)
  const libPaint = useMemo(() => paintAll(vbStore?.libraryEdits), [vbStore?.libraryEdits]);
  const appliedChange = findChangeLayout(activeSlide?.layout);
  const appliedId = appliedChange?.id || null;
  const draftId = visEdit === 'layout' ? (layPick || appliedId) : appliedId;
  const chosenLayout = (visEdit === 'layout' && layPick
    ? findChangeLayout(layPick)
    : null) || appliedChange;
  const chosenLayoutIdx = Math.max(0, slideLayouts.findIndex((l) => l.id === draftId));
  const layoutUnchanged = Boolean(draftId) && draftId === appliedId;
  // Ranked layout options the agent generated for this slide, best-first. When
  // present they replace the fixed wireframe presets in the Change layout
  // picker; picking one applies its HTML as the slide's layoutHtml.
  // The options stored for this slide, best-first. This includes the persistent
  // "Original" option (rank 0, the parent composition) plus the generated
  // variations, so the studio can always switch back to the original after
  // applying a change.
  const layoutOpts = useMemo(() => {
    const list = Array.isArray(activeSlide?.layoutOptions) ? activeSlide.layoutOptions : [];
    return list
      .filter((o) => o && o.html)
      .slice()
      .sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0));
  }, [activeSlide?.layoutOptions]);
  const hasLayoutOpts = layoutOpts.length > 0;
  // "Change theme" used to switch between stored multi-theme layout options.
  // New carousels pick a catalog theme and re-run the carousel agent instead.
  // Number of generated (non-original) variations already stored — a fresh
  // single-theme carousel has just its one composition, so opening Change layout
  // should generate the variations on demand; once they exist, don't regenerate.
  const generatedCount = useMemo(
    () => layoutOpts.filter((o) => !o.original).length,
    [layoutOpts],
  );
  const needsLayoutVars = generatedCount < 2;
  // Once the stored options are loaded (ensureRouteOptions), generate this
  // slide's variations only if it still has none (a fresh single-theme carousel).
  // Never regenerates an existing set — it sees the persisted options first.
  useEffect(() => {
    if (visEdit !== 'layout' || optionsBusy || layVarBusy) return;
    if (optionsLoadedRef.current !== weekId) return;
    if (needsLayoutVars) generateLayoutVariations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visEdit, optionsBusy, weekId, needsLayoutVars, safeIdx]);
  const appliedOptIdx = hasLayoutOpts
    ? layoutOpts.findIndex((o) => o.html === activeSlide?.layoutHtml)
    : -1;
  const draftOptIdx = (visEdit === 'layout' || visEdit === 'theme')
    ? (layOpt != null ? layOpt : (appliedOptIdx >= 0 ? appliedOptIdx : 0))
    : appliedOptIdx;
  const draftOpt = hasLayoutOpts ? (layoutOpts[draftOptIdx] || null) : null;
  const optUnchanged = hasLayoutOpts && draftOptIdx === appliedOptIdx;
  const draftTheme = themeIdOf(draftOpt);
  const themeUnchanged = Boolean(draftTheme) && slides.every(
    (s) => layoutDirectionOf(s) === draftTheme,
  );
  // The composition the big preview should draw while editing: drafted
  // Change layout / Change theme options win over the stored html. Edit text
  // paints words in the iframe without rewriting the composition.
  const previewSlide = useMemo(() => {
    if ((visEdit === 'layout' || visEdit === 'theme') && draftOpt) {
      return {
        ...activeSlide,
        layout: 'dynamic',
        layoutHtml: draftOpt.html,
        // Theme options carry a real direction; standalone variations carry
        // none (their label is a composition name, not a theme).
        layoutTheme: visEdit === 'theme'
          ? (themeDirectionOf(draftOpt) || THEME_ORDER[draftOptIdx] || '')
          : themeDirectionOf(draftOpt),
      };
    }
    return activeSlide;
  }, [visEdit, draftOpt, activeSlide, draftOptIdx]);
  // Whether the big preview should crop the carousel document (themed slide) or
  // render the slide's own layoutHtml (a standalone on-demand variation).
  const previewUsesDoc = isBlankSlide(previewSlide)
    ? false
    : visEdit === 'theme'
      ? true
      : (visEdit === 'layout' && draftOpt)
        ? Boolean(themeDirectionOf(draftOpt))
        : slideIsThemed(previewSlide);
  const wordVisual = {
    documentHtml: isManualSlide(activeSlide) || isBlankSlide(activeSlide) ? '' : carouselDocumentOf(day),
    direction: layoutDirectionOf(activeSlide),
  };
  const wordRoles = visEdit === 'words' ? wordRolesForSlide(activeSlide, wordVisual) : [];
  const primaryWordKey = wordRoles.find((r) => r.key === 'title' || r.key === 'head')?.key
    || wordRoles.find((r) => r.key === 'supporting-text' || r.key === 'body' || r.key === 'subtitle')?.key
    || wordRoles[0]?.key;
  const wordsSeed = visEdit === 'words'
    ? seedWordDraft(composeLayoutOf(activeSlide) || BEST_FIT_LAYOUT, activeSlide, day?.contentType || day?.format, wordVisual)
    : null;
  const wordsUnchanged = Boolean(wordDraft && wordsSeed
    && Object.keys({ ...wordsSeed, ...wordDraft }).every(
      (k) => plainOf(wordDraft[k] || '') === plainOf(wordsSeed[k] || ''),
    ));

  useEffect(() => {
    if (visEdit !== 'words') return;
    setWordDraft(seedWordDraft(composeLayoutOf(activeSlide) || BEST_FIT_LAYOUT, activeSlide, day?.contentType || day?.format, {
      documentHtml: isManualSlide(activeSlide) || isBlankSlide(activeSlide) ? '' : carouselDocumentOf(day),
      direction: layoutDirectionOf(activeSlide),
    }));
  }, [visEdit, selected, safeIdx]);

  const wordFills = useMemo(() => {
    const fromCap = String(day?.content?.caption || '')
      .split(/\n+|(?<=[.!?])\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 12 && t.length < 120);
    const others = slides.map((s, i) => (i === safeIdx ? '' : s.title)).filter(Boolean);
    return [...fromCap, ...others];
  }, [day?.content?.caption, slides, safeIdx]);

  function applyWords() {
    const roles = wordRolesForSlide(activeSlide, wordVisual);
    const agentSlide = isAgentHtmlSlide(activeSlide);
    const hasHead = roles.some((r) => r.key === 'head' || r.key === 'title');
    const hasBody = roles.some((r) => (
      r.key === 'body' || r.key === 'supporting-text' || r.key === 'subtitle'
    ));
    const hasAnnote = roles.some((r) => r.key === 'annotation');
    const elLay = findElementLayout(activeSlide?.layout);
    const isStack = activeSlide?.layout === 'el-stack';
    let patch = {};
    if (agentSlide) {
      const titleKey = roles.find((r) => r.key === 'title' || r.htmlSlot === 'title')?.key;
      const bodyRole = roles.find((r) => (
        r.key === 'supporting-text' || r.key === 'subtitle' || r.key === 'body'
        || r.htmlSlot === 'supporting-text' || r.htmlSlot === 'subtitle' || r.htmlSlot === 'body'
      ));
      if (titleKey) patch.title = capText(wordDraft?.[titleKey] || '');
      if (bodyRole) patch.subtitle = capText(wordDraft?.[bodyRole.key] || '');
    } else if (isStack) {
      // Each role writes straight to its field. A role only exists while its
      // element does, so this preserves every element on the slide and edits
      // each independently; a role emptied to nothing drops that element.
      const roleKeys = new Set(roles.map((r) => r.key));
      ELEMENT_STACK_FIELDS.forEach(({ role, field }) => {
        if (roleKeys.has(role)) patch[field] = capText(wordDraft?.[role] || '');
      });
    } else if (elLay) {
      if (hasHead) patch.title = capText(wordDraft?.head || '');
      if (hasBody) {
        const line = capText(wordDraft?.body || '');
        if (elLay.bodySlot === 'body') patch.body = line;
        else patch.subtitle = line;
      }
      if (elLay.kind === 'body-block') {
        patch.title = '';
        if (elLay.bodySlot === 'body') patch.subtitle = '';
        else patch.body = '';
      }
    } else {
      const primary = hasHead ? 'head' : (hasBody ? 'body' : roles[0]?.key);
      patch.title = capText(wordDraft?.[primary] || '');
      const subtitle = (hasHead && hasBody) ? capText(wordDraft?.body || '') : undefined;
      if (subtitle !== undefined) patch.subtitle = subtitle;
    }
    const title = patch.title ?? '';
    const subtitle = patch.subtitle;

    let annotationText;
    if (hasAnnote) {
      const prev = activeSlide?.annotation && typeof activeSlide.annotation === 'object'
        ? activeSlide.annotation
        : {};
      annotationText = capAnnote(plainOf(wordDraft?.annotation || ''));
      patch.annotation = {
        text: annotationText,
        targetSubject: prev.targetSubject || '',
        targetRegion: prev.targetRegion || 'center',
        ...(boxOf(prev.targetBox) ? { targetBox: boxOf(prev.targetBox) } : {}),
      };
    }

    const slots = agentSlide
      ? Object.fromEntries(
        roles
          .filter((r) => r.key !== 'annotation')
          .map((r) => [r.key, wordDraft?.[r.key] ?? '']),
      )
      : null;

    // The words are baked into the agent HTML, so patching title/subtitle alone
    // changes nothing on screen. Rewrite the applied composition AND every
    // ranked layout option, so the preview, the export, and the Change layout
    // option previews all show the edited copy.
    const applyToHtml = (html) => {
      if (!html) return html;
      let h = rewriteLayoutText(html, {
        title: slots ? undefined : title,
        subtitle: slots ? undefined : subtitle,
        slots,
        direction: layoutDirectionOf(activeSlide),
        index: Number(activeSlide?.index) > 0 ? Number(activeSlide.index) : safeIdx + 1,
      });
      if (annotationText != null) h = rewriteAnnotationText(h, annotationText);
      return h;
    };
    if (activeSlide?.layoutHtml) patch.layoutHtml = applyToHtml(activeSlide.layoutHtml);
    if (Array.isArray(activeSlide?.layoutOptions) && activeSlide.layoutOptions.length) {
      patch.layoutOptions = activeSlide.layoutOptions.map((o) => ({
        ...o,
        html: applyToHtml(o?.html || ''),
      }));
    }

    if (isManualSlide(activeSlide)) {
      patch.manual = true;
      patch.layout = elementLayoutForSlide({ ...activeSlide, ...patch });
    }

    const index = Number(activeSlide?.index) > 0 ? Number(activeSlide.index) : safeIdx + 1;
    const direction = layoutDirectionOf(activeSlide);
    // A studio-built element slide is its own composition — it must never write
    // its words back into the shared carousel document at its index.
    const doc = isManualSlide(activeSlide) ? '' : carouselDocumentOf(day);
    let carouselHtml = doc
      ? rewriteCarouselDocumentText(doc, {
        index,
        title: slots ? undefined : title,
        subtitle: slots ? undefined : (subtitle ?? ''),
        slots,
        direction,
      })
      : '';
    const live = findCarouselSlide(layoutFrameRef.current?.contentDocument, direction, index);
    if (live) {
      if (carouselHtml) carouselHtml = bakeFrozenGeometry(carouselHtml, live, { direction, index });
      if (patch.layoutHtml) patch.layoutHtml = bakeFrozenGeometry(patch.layoutHtml, live, { direction, index });
    }

    const base = deriveSlides(day);
    const next = base.map((s, i) => (i === safeIdx ? { ...s, ...patch } : s));
    const extra = carouselHtml ? { carouselHtml } : {};
    replaceSlides(next, { extra });
    setVisEdit(null);
    setZone(null);
  }

  function applyLayout() {
    // Agent options mode: apply the drafted option's HTML directly. Set
    // layoutTheme from the option's direction (empty for a standalone variation)
    // so the render path uses this html instead of the carousel document.
    if (hasLayoutOpts) {
      if (!draftOpt || optUnchanged) return;
      patchActiveSlide({
        blank: false,
        layout: 'dynamic',
        layoutHtml: draftOpt.html,
        layoutTheme: themeDirectionOf(draftOpt) || '',
      });
      setLayOpt(null);
      setVisEdit(null);
      setZone(null);
      return;
    }
    if (!draftId || layoutUnchanged) return;
    const next = findChangeLayout(draftId);
    const need = shotsForLayout(next);
    patchActiveSlide({ blank: false, layout: draftId, layoutHtml: '' });
    setLayPick(null);
    if (need > 0) {
      setAskImgs(need);
      return;
    }
    setVisEdit(null);
    setZone(null);
  }

  function applyThemeToAll(optIdx = draftOptIdx) {
    const picked = layoutOpts[optIdx];
    if (!picked) return false;
    const theme = themeIdOf(picked) || THEME_ORDER[optIdx] || '';
    const base = deriveSlides(day);
    let changed = 0;
    const next = base.map((s) => {
      const opts = Array.isArray(s.layoutOptions)
        ? s.layoutOptions.filter((o) => o && o.html).slice()
          .sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0))
        : [];
      const opt = (theme && optionForTheme(s, theme)) || opts[optIdx] || null;
      if (!opt?.html) return s;
      changed += 1;
      return {
        ...s,
        layout: 'dynamic',
        layoutHtml: opt.html,
        layoutTheme: theme || themeIdOf(opt) || '',
      };
    });
    if (!changed) return false;
    replaceSlides(next);
    return true;
  }

  function applyTheme() {
    applyThemeToAll(draftOptIdx);
    setLayOpt(null);
    setVisEdit(null);
    setZone(null);
  }

  function openImagePicker() {
    const n = Math.max(1, shotsForLayout(chosenLayout || findChangeLayout(activeSlide?.layout)) || 1);
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

  const hasEditImage = Boolean(photoUrl(activeSlide, localMedia, mediaByKey));
  const slotPackItems = hasEditImage
    ? [{ i: 0, url: photoUrl(activeSlide, localMedia, mediaByKey) }]
    : [];

  function measureSlot() {
    const el = document.querySelector('.wv-ig__media .wv-fit__slot')
      || document.querySelector('.wv-ig__media .wv-ig__photo');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 4 && r.height > 4)) return null;
    return {
      ratio: r.width / r.height,
      radius: window.getComputedStyle(el).borderRadius,
      name: 'Slide',
    };
  }

  function editorSrc(slotIndex = 0) {
    const keys = keysOf(activeSlide);
    const key = keys[slotIndex] || (slotIndex === 0 ? (activeSlide?.assetKey || activeSlide?.image?.key || '') : '');
    if (key && localMedia?.[key]) return canvasSafeUrl(localMedia[key], key);
    if (key && mediaByKey?.has(key)) return mediaProxyUrl(key);
    return canvasSafeUrl(photoUrl(activeSlide, localMedia, mediaByKey) || '', key) || null;
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
    setVisEdit(null);
    setZone(null);
    const src = editorSrc(0);
    if (!src) return;
    setEditSlot(measureSlot());
    setAdjustFor({ src, slotIndex: 0 });
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
  const themeEditing = zone === 'visual' && visEdit === 'theme';
  const compositionEditing = layoutEditing || themeEditing;
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
        <LayoutSpecimen layout={l} />
      </span>
      <span className="wv-act__name">{l.name}</span>
      {l.id === appliedId && <span className="wv-act__now">Current</span>}
    </button>
  ));

  // Agent-generated options, ranked best-first — each card is a real 4:5
  // preview of that composition (same renderer as the big preview), so the
  // picker shows the actual layouts the agent proposed, not wireframes.
  const layoutOptionCards = (hideRank = false) => layoutOpts.map((opt, i) => {
    const on = draftOptIdx === i;
    const isOriginal = Boolean(opt.original);
    const hasOriginal = Boolean(layoutOpts[0]?.original);
    // Rank position among the generated variations (the "Original" card carries no
    // rank), best-first.
    const genPos = hasOriginal ? i - 1 : i;
    const label = opt.label || (isOriginal ? 'Original' : `Option ${i + 1}`);
    const optSlide = { ...activeSlide, layout: 'dynamic', layoutHtml: opt.html };
    // A themed option (from the carousel document) renders by cropping that
    // document; a standalone variation renders from its own html, so the
    // document must NOT be passed or it would override opt.html — the reason all
    // four variations used to render identically.
    const optDir = themeDirectionOf(opt);
    return (
      <button
        key={`opt:${i}`}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={label}
        className={`wv-act wv-act--layout wv-act--opt${on ? ' is-on' : ''}`}
        onClick={() => setLayOpt(i)}
        title={opt.reason || label}
      >
        <span className="wv-act__shot">
          <SlideMedia
            slide={optSlide}
            localMedia={localMedia}
            mediaByKey={mediaByKey}
            subjectsByKey={subjectsByKey}
            paint={igVars}
            themed={hasVisualEdits}
            documentHtml={optDir ? carouselDocumentOf(day) : ''}
            slideIndex={safeIdx + 1}
            direction={optDir || layoutDirectionOf(optSlide)}
          />
          {!hideRank && (isOriginal ? (
            <span className="wv-act__rank">Original</span>
          ) : (
            <span className={`wv-act__rank${genPos === 0 ? ' is-best' : ''}`}>
              {genPos === 0 ? 'Best' : `#${genPos + 1}`}
            </span>
          ))}
        </span>
        <span className="wv-act__name">{label}</span>
        {i === appliedOptIdx && <span className="wv-act__now">Current</span>}
      </button>
    );
  });

  return (
    <div className={`wv${embedded ? ' wv--embedded' : ''}`} style={libPaint}>
      {/* ── the way back, and the plan's actions ─────────────────────────── */}
      {/* When embedded in the calendar (Weekly / Day views), the page's own
          toolbar — period label, View menu, ⋯ — replaces this bar. */}
      {!embedded && (
      <div className="wv-top">
        {modeSwitch ? (
          <div className="cal-mode" role="tablist" aria-label="Calendar view">
            <button type="button" role="tab" aria-selected={false} className="cal-mode__btn" onClick={onBack}>
              Monthly
            </button>
            <button type="button" role="tab" aria-selected={true} className="cal-mode__btn is-on">
              Weekly
            </button>
          </div>
        ) : (
          <button type="button" className="wv-back" onClick={onBack}>
            <Glyph name="arrow-left" size={15} />{backLabel}
          </button>
        )}
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
                    onClick={() => { setMoreOpen(false); openCaptureIdea(); }}
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
                      {weekUsage.elapsedMs ? `${fmtElapsed(weekUsage.elapsedMs)} · ` : ''}
                      {fmtTokens(weekUsage.totalTokens)} tokens · ~{fmtCost(weekUsage.estimatedCostUsd)} est.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ── the plan's dates, and which week of the month ────────────────── */}
      {/* Hidden when embedded — the calendar's own toolbar carries the title.
          A "Saving…" chip still surfaces so an in-flight save is visible. */}
      {embedded ? (
        (saving || replanning || replanMsg) && (
          <div className="wv-head wv-head--embedded">
            <div className="wv-head__side">
              {saving && <span className="wv-head__chip">Saving…</span>}
              {replanning && <span className="wv-head__chip">Adding posts to empty days…</span>}
              {replanMsg && <span className="wv-head__chip is-warn">{replanMsg}</span>}
            </div>
          </div>
        )
      ) : (
      <div className="wv-head">
        <h1 className="wv-head__title">{postHeading(day)}</h1>
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
      )}

      {analysisOpen && (
        <YourAnalysisModal
          username={route?.instagramUsername}
          onClose={() => setAnalysisOpen(false)}
        />
      )}

      {connectOpen && (
        <ConnectMetaModal
          configured={metaStatus.configured}
          expectedHandle={handle}
          otherConnections={otherMeta}
          onRememberReturn={() => rememberMetaOAuthReturn({
            expectedHandle: handle,
            weekId: route?.days?.[selected]?._id || route?._id || null,
            day: selected,
          })}
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
          layout={(() => {
            const change = findChangeLayout(activeSlide?.layout);
            if (!change) return { ...BEST_FIT_LAYOUT, imgs: imgPick.slots };
            // Map onto LayoutArt kinds that expose .vl-ph slots for the picker.
            if (change.kind === 'before-after') {
              return {
                id: change.id,
                kind: 'duo',
                tone: 'ground',
                art: { head: '', labels: ['Before', 'After'] },
                imgs: imgPick.slots,
              };
            }
            if (change.kind === 'process') {
              return { id: change.id, kind: 'centered', tone: 'ground', art: { head: '' }, imgs: [] };
            }
            return {
              id: change.id,
              kind: 'split',
              tone: 'ground',
              art: { head: '', body: '' },
              imgs: imgPick.slots,
            };
          })()}
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
                font: faceLabelFor('headline', vbStore),
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

      {/* ── the week, as a calendar: seven cards (bauhly-v3 DaySelector).
           Today is lime; a selected day that is not today is ink. Empty days
           open a Capture / Change distribution menu — the post underneath
           does not move. ─────────────────────────────────────────────────── */}
      {!hideStrip && (
      <div className={`wv-cal${calMore ? ' has-more' : ''}${calPrev ? ' has-prev' : ''}`}>
        <div className="wv-cal__grid" ref={calGridRef} role="tablist" aria-label="This week's posts">
          {enrichedDays.map((d, i) => {
            const empty = isEmptyCalDay(d);
            const active = i === stripOnIdx;
            const done = !empty && d.published;
            // Two marks, not one (bauhly-v3 §761): a scheduled post is a
            // decision about the future — the lime clock — while a published one
            // is the past, in grey. The lime only means anything with an account.
            const scheduled = !empty && metaConnected && !!d.scheduledAt && !done;
            const inReview = !empty && !!d.savedForReview && !scheduled && !done;
            const ready = done || scheduled || inReview;
            const isToday = String(d.date || '') === todayIso;
            const past = !isToday && !!d.date && String(d.date) < todayIso;
            const clock = empty ? '' : to24h(slotTimeRaw(d, route));
            const format = empty ? '' : String(d.format || '').replace(/ series$/, '');
            return (
              <button
                key={`${d.date || d.day}-${i}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-current={active ? 'true' : undefined}
                aria-label={`${shortDay(d.day)} ${String(d.dateLabel || '').replace(/^[A-Za-z]+\s*/, '')}${isToday ? ', today' : ''}: ${empty ? 'not scheduled' : `${format} at ${clock}`}`}
                className={`wv-day${active ? ' is-on' : ''}${isToday ? ' is-today' : ''}${empty ? ' is-empty' : ''}${past ? ' is-past' : ''}${ready ? ' is-ready' : ''}${inReview ? ' is-review' : ''}`}
                onClick={(e) => onStripDay(i, e.currentTarget)}
              >
                <span className="wv-day__when">
                  <b>{shortDay(d.day)}</b>
                  <i>{String(d.dateLabel || '').replace(/^[A-Za-z]+\s*/, '')}</i>
                  {isToday && <em className="wv-day__today">Today</em>}
                </span>
                {/* Second line: "Carousel · 19:30" — format and hour, the facts
                    a studio scans a week for (bauhly-v3 Sep 15). */}
                <span className="wv-day__line">
                  {empty ? (
                    <span className="wv-day__none" aria-hidden="true" />
                  ) : (
                    <>
                      <span className="wv-day__word">{format}</span>
                      {clock && <span className="wv-day__sep" aria-hidden="true">·</span>}
                      {clock && <span className="wv-day__clock">{clock}</span>}
                    </>
                  )}
                </span>
                {(done || scheduled) && (
                  <span className={`wv-day__ready${done ? ' is-done' : ''}`} aria-hidden="true">
                    <Glyph name={done ? 'check' : 'clock'} size={13} strokeWidth={done ? 3 : 2.25} />
                  </span>
                )}
                {inReview && (
                  <span className="wv-day__ready is-review" aria-hidden="true">
                    <Glyph name="file-text" size={13} strokeWidth={2.25} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {dayPop && (
        <>
          <div className="pe-menu__scrim" onClick={() => setDayPop(null)} />
          <div
            className="pe-menu yw-daypop"
            role="menu"
            aria-label="Nothing planned"
            style={{ left: `${Math.max(8, dayPop.x)}px`, top: `${dayPop.y}px` }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => { setDayPop(null); openCaptureIdea(); }}
            >
              <Glyph name="plus" size={17} />
              <span className="pe-menu__grow">Capture for this day</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => { setDayPop(null); onDistribute?.(); }}
            >
              <Glyph name="calendar" size={17} />
              <span className="pe-menu__grow">Change distribution</span>
            </button>
          </div>
        </>
      )}

      {/* An empty selected day gets the capture card instead of a blank panel.
          Day view lands on the empty date directly; Weekly reaches this when the
          whole week has no posts (nothing real to land on) — either way, never
          show blank. (Clicking an empty strip day still opens the quick popover.) */}
      {day && isEmptyCalDay(day) && (
        /* the day with nothing on it — three washed studio photographs, a line
           and one obvious move, centred on the whole panel (bauhly-v3 .yw-dayempty) */
        <div className="wv-dayempty">
          <div className="wv-dayempty__card">
            <span className="wv-dayempty__shots" aria-hidden="true">
              <img src="/assets/photo/mood/light.jpg" alt="" loading="lazy" />
              <img src="/assets/photo/mood/materials.jpg" alt="" loading="lazy" />
              <img src="/assets/photo/mood/style.jpg" alt="" loading="lazy" />
            </span>
            <h2 className="wv-dayempty__title">Capture something new</h2>
            <button type="button" className="btn btn--primary" onClick={() => openCaptureIdea()}>
              <Glyph name="plus" size={16} strokeWidth={2.5} />
              Capture idea
            </button>
          </div>
        </div>
      )}

      {day && !isEmptyCalDay(day) && (
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
            disabled={prevPostIdx < 0}
            aria-label="Previous day"
          >
            <Glyph name="chevron-left" size={22} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            className={`wv-daynav wv-daynav--next${navOut ? ' is-out' : ''}`}
            onClick={nextDay}
            disabled={nextPostIdx < 0}
            aria-label="Next day"
          >
            <Glyph name="chevron-right" size={22} strokeWidth={2.5} />
          </button>
          <article className={`wv-ig${timeDraft ? ' is-timeedit' : ''}${compositionEditing ? ' is-layoutedit' : ''}${wordsEditing ? ' is-wordsedit' : ''}`} style={igVars}>
            <header className="wv-ig__head">
              <span className="wv-ig__avatar">{handleInitials(handle)}</span>
              <span className="wv-ig__user">{handle}</span>
              {/* the corner is the one control for the post's future
                  (bauhly-v3 §733/§739). Connect and the terminal states stay
                  single pills; while the decision is open it is a split button —
                  a primary action plus a menu of the rest (Schedule / Save for
                  review / Change time / Unschedule). */}
              {!metaConnected ? (
                <button type="button" className="wv-ig__connect" onClick={() => setConnectOpen(true)}>
                  <Glyph name="instagram" size={13} />Connect Instagram
                </button>
              ) : day.published ? (
                day.permalink ? (
                  <a
                    className="wv-ig__go is-out"
                    href={day.permalink}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View published post on Instagram"
                  >
                    <Glyph name="check" size={14} strokeWidth={3} />Published
                  </a>
                ) : (
                  <span className="wv-ig__go is-out" aria-label="Published">
                    <Glyph name="check" size={14} strokeWidth={3} />Published
                  </span>
                )
              ) : (isPublishingSlot || publishing) ? (
                <span className="wv-ig__go is-on" aria-label="Publishing">
                  <span className="wv-ig__go-spin" aria-hidden="true" />Publishing…
                </span>
              ) : (
                <div className={`wv-sched${schedMenu ? ' is-open' : ''}`}>
                  <div className={`wv-sched__btn${isScheduled || isReview ? ' is-on' : ''}`}>
                    <button
                      type="button"
                      className="wv-sched__main"
                      onClick={isScheduled ? () => setSchedMenu((v) => !v) : pressSchedule}
                      disabled={scheduling}
                      title={isScheduled ? 'Scheduled — open options' : isReview ? 'Held for review — schedule it' : 'Schedule this post'}
                    >
                      <Glyph name={isScheduled ? 'calendar-check' : isReview ? 'file-text' : 'clock'} size={14} />
                      {scheduling
                        ? 'Working…'
                        : isScheduled
                          ? `Scheduled · ${timeSeedAt}`
                          : isReview
                            ? 'Saved for review'
                            : `Schedule for ${timeSeedAt}`}
                    </button>
                    <button
                      type="button"
                      className="wv-sched__caret"
                      onClick={() => setSchedMenu((v) => !v)}
                      disabled={scheduling}
                      aria-haspopup="menu"
                      aria-expanded={schedMenu}
                      aria-label="Scheduling options"
                    >
                      <Glyph name="chevron-down" size={16} strokeWidth={2.5} />
                    </button>
                  </div>
                  {schedMenu && (
                    <div className="wv-sched__menu" role="menu" aria-label="Scheduling options">
                      {!isScheduled && (
                        <button type="button" role="menuitem" className="wv-sched__item" onClick={pressSchedule}>
                          <Glyph name="calendar" size={18} strokeWidth={2} />
                          <span className="wv-sched__copy">
                            <span className="wv-sched__label">Schedule</span>
                            <span className="wv-sched__desc">Publish to Meta at a specific time</span>
                          </span>
                        </button>
                      )}
                      {!isScheduled && (
                        <button
                          type="button"
                          role="menuitem"
                          className="wv-sched__item"
                          onClick={() => { setSchedMenu(false); handlePublish(); }}
                          disabled={publishing}
                        >
                          <Glyph name="send" size={18} strokeWidth={2} />
                          <span className="wv-sched__copy">
                            <span className="wv-sched__label">{publishing ? 'Publishing…' : 'Publish now'}</span>
                            <span className="wv-sched__desc">Send it to Instagram right away</span>
                          </span>
                        </button>
                      )}
                      {isScheduled && (
                        <button
                          type="button"
                          role="menuitem"
                          className="wv-sched__item"
                          onClick={() => { setSchedMenu(false); handlePublish(); }}
                          disabled={publishing}
                        >
                          <Glyph name="send" size={18} strokeWidth={2} />
                          <span className="wv-sched__copy">
                            <span className="wv-sched__label">{publishing ? 'Publishing…' : 'Publish now'}</span>
                            <span className="wv-sched__desc">Send it to Instagram right away</span>
                          </span>
                        </button>
                      )}
                      {isScheduled && scheduleFailed && (
                        <button
                          type="button"
                          role="menuitem"
                          className="wv-sched__item"
                          onClick={() => { setSchedMenu(false); retrySchedule(); }}
                        >
                          <Glyph name="refresh-cw" size={18} strokeWidth={2} />
                          <span className="wv-sched__copy">
                            <span className="wv-sched__label">Retry publish</span>
                            <span className="wv-sched__desc">Re-queue for the next daily run</span>
                          </span>
                        </button>
                      )}
                      {!isReview && (
                        <button type="button" role="menuitem" className="wv-sched__item" onClick={saveForReview}>
                          <Glyph name="file-text" size={18} strokeWidth={2} />
                          <span className="wv-sched__copy">
                            <span className="wv-sched__label">Save for review</span>
                            <span className="wv-sched__desc">Keep in calendar, don&apos;t publish yet</span>
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className="wv-sched__item"
                        onClick={openTimeEditor}
                        disabled={!canEditTime}
                        title={canEditTime ? undefined : 'Unschedule first to change the time'}
                      >
                        <Glyph name="clock" size={18} strokeWidth={2} />
                        <span className="wv-sched__copy">
                          <span className="wv-sched__label">Change time</span>
                          <span className="wv-sched__desc">Set a different date and time</span>
                        </span>
                      </button>
                      {isScheduled && (
                        <button
                          type="button"
                          role="menuitem"
                          className="wv-sched__item wv-sched__item--danger"
                          onClick={unschedule}
                          disabled={scheduling || isPublishingSlot}
                        >
                          <Glyph name="trash-2" size={18} strokeWidth={2} />
                          <span className="wv-sched__copy">
                            <span className="wv-sched__label">Unschedule</span>
                            <span className="wv-sched__desc">Remove from calendar</span>
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </header>

            {/* Publishing loader — covers the card while slides render and the
                post goes out to Instagram, then a success confirmation once
                the day flips to published. */}
            {publishing && (
              <div className="wv-ig__publishing" role="status" aria-live="polite">
                <span className="wv-ig__publishing-spin" aria-hidden="true" />
                <span className="wv-ig__publishing-text">{publishMsg || 'Publishing to Instagram…'}</span>
              </div>
            )}
            {!publishing && day.published && publishMsg && (
              <div className="wv-ig__published" role="status">
                <Glyph name="check" size={15} strokeWidth={3} />
                <span>{publishMsg}</span>
              </div>
            )}

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
              <div className={`wv-ig__photo${layoutBusy ? ' is-laying' : ''}`}>
                <SlideMedia
                  slide={previewSlide}
                  localMedia={localMedia}
                  mediaByKey={mediaByKey}
                  subjectsByKey={subjectsByKey}
                  parts={visEdit === 'words' ? wordDraft : null}
                  showVisualHint
                  paint={igVars}
                  themed={hasVisualEdits}
                  layoutOverride={(visEdit === 'layout' && !hasLayoutOpts) ? (chosenLayout || null) : null}
                  carouselLayoutHtmls={slides.map((s) => s?.layoutHtml || '')}
                  documentHtml={previewUsesDoc ? carouselDocumentOf(day) : ''}
                  copyDraft={visEdit === 'words' && wordDraft
                    ? (isAgentHtmlSlide(activeSlide)
                      ? { slots: wordDraft }
                      : { title: wordDraft.head, subtitle: wordDraft.body })
                    : null}
                  frameRef={layoutFrameRef}
                  editMode={slideEditMode}
                  slideIndex={safeIdx + 1}
                  direction={visEdit === 'theme'
                    ? (themeIdOf(draftOpt) || THEME_ORDER[draftOptIdx] || layoutDirectionOf(previewSlide))
                    : layoutDirectionOf(previewSlide)}
                />
                {slideEditMode && (
                  <div className="wv-editmode-bar" role="status">
                    <span className="wv-editmode-bar__dot" aria-hidden="true" />
                    <span>Edit mode — drag to move, corners to resize, double-click to type</span>
                    <button
                      type="button"
                      className="wv-editmode-bar__done"
                      onClick={() => setSlideEditMode(false)}
                    >
                      Done
                    </button>
                  </div>
                )}
                {layoutBusy && (
                  <div className="wv-ig__laying" role="status" aria-live="polite">
                    <span className="wv-spin" aria-hidden="true" />
                    <span>Composing carousel…</span>
                  </div>
                )}
                {layoutErr && !layoutBusy && (
                  <div className="wv-ig__layerr" role="alert">
                    <span>{layoutErr}</span>
                  </div>
                )}
                {safeIdx === 0 && videoCoverOn && appliedCoverUrl && (
                  <video
                    className="wv-ig__covervideo"
                    src={appliedCoverUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    aria-label="Animated hook cover"
                  />
                )}
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
              {(visEdit === 'layout' && layPick && layPick !== appliedId) || (visEdit === 'theme' && draftOpt && !themeUnchanged) ? (
                <span className="wv-ig__previewtag">
                  {visEdit === 'theme' ? 'Preview only · Apply theme to keep' : 'Preview only · Apply layout to keep'}
                </span>
              ) : null}
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
              {/* the edit menu — Add elements, shape, this picture, pictures, words
                  (bauhly-v3 §818/§989/§993). Anchored under the pencil. */}
              {zone === 'visual' && !visEdit && !imgPick && !slideEditMode && (
                <>
                <div
                  className="wv-ig__menuscrim"
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); closeZone(); }}
                  aria-hidden="true"
                />
                <div className="wv-ig__menuwrap">
                <div
                  className="wv-ig__menu"
                  role="menu"
                  aria-label="Edit this slide"
                  ref={menuRef}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className={`wv-ig__menuitem wv-ig__menuitem--sub${menuPane === 'elements' ? ' is-open' : ''}`}
                    aria-haspopup="menu"
                    aria-expanded={menuPane === 'elements'}
                    onMouseEnter={() => setMenuPane('elements')}
                    onClick={() => setMenuPane((p) => (p === 'elements' ? null : 'elements'))}
                  >
                    <Icon name="sparkle" size={17} strokeWidth={2} />
                    <span className="wv-ig__menugrow">Add elements</span>
                    <Icon name="chevron-right" size={16} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`wv-ig__menuitem wv-ig__menuitem--sub${menuPane === 'theme' || menuPane === 'theme-library' ? ' is-open' : ''}`}
                    aria-haspopup="menu"
                    aria-expanded={menuPane === 'theme' || menuPane === 'theme-library'}
                    disabled={layoutBusy}
                    onMouseEnter={() => setMenuPane('theme')}
                    onClick={() => setMenuPane((p) => (p === 'theme' || p === 'theme-library' ? null : 'theme'))}
                  >
                    <Icon name="swatch" size={17} strokeWidth={2} />
                    <span className="wv-ig__menugrow">Change theme</span>
                    <Icon name="chevron-right" size={16} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="wv-ig__menuitem"
                    onMouseEnter={() => setMenuPane(null)}
                    onClick={() => {
                      setMenuPane(null);
                      setLayPick(appliedId);
                      setLayVarErr('');
                      setLayOpt(null);
                      setVisEdit('layout');
                      // layoutOptions are NOT in the week's render payload (too
                      // heavy) — load the stored ones now. An effect generates the
                      // variations only if none exist once they're loaded.
                      ensureRouteOptions();
                    }}
                  >
                    <Icon name="dashboard" size={17} strokeWidth={2} />
                    <span>Change layout</span>
                  </button>
                  {hasEditImage && (
                    <button
                      type="button"
                      role="menuitem"
                      className="wv-ig__menuitem"
                      onMouseEnter={() => setMenuPane(null)}
                      onClick={openAdjust}
                    >
                      <Icon name="crop" size={17} strokeWidth={2} />
                      <span>Edit image</span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="wv-ig__menuitem"
                    onMouseEnter={() => setMenuPane(null)}
                    onClick={openImagePicker}
                  >
                    <Icon name="image" size={17} strokeWidth={2} />
                    <span>Select images</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="wv-ig__menuitem"
                    onMouseEnter={() => setMenuPane(null)}
                    onClick={() => {
                      setMenuPane(null);
                      setWordDraft(seedWordDraft(composeLayoutOf(activeSlide) || BEST_FIT_LAYOUT, activeSlide, day?.contentType || day?.format, {
                        documentHtml: isManualSlide(activeSlide) || isBlankSlide(activeSlide) ? '' : carouselDocumentOf(day),
                        direction: layoutDirectionOf(activeSlide),
                      }));
                      setVisEdit('words');
                    }}
                  >
                    <Icon name="edit" size={17} strokeWidth={2} />
                    <span>Edit text</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="wv-ig__menuitem"
                    onMouseEnter={() => setMenuPane(null)}
                    onClick={() => {
                      setMenuPane(null);
                      setSlideEditMode(true);
                    }}
                  >
                    <Icon name="expand" size={17} strokeWidth={2} />
                    <span className="wv-ig__menugrow">Edit mode</span>
                    <span className="wv-ig__menubadge">Beta</span>
                  </button>
                  {safeIdx === 0 && videoCoverOn && (
                    <button
                      type="button"
                      role="menuitem"
                      className="wv-ig__menuitem"
                      onMouseEnter={() => setMenuPane(null)}
                      onClick={handleMakeCover}
                      disabled={coverBusy}
                    >
                      <Icon name="play" size={17} strokeWidth={2} />
                      <span>{coverBusy ? 'Creating cover…' : 'Video cover'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className={`wv-ig__menuitem wv-ig__menuitem--sub${menuPane === 'add-slide' ? ' is-open' : ''}`}
                    aria-haspopup="menu"
                    aria-expanded={menuPane === 'add-slide'}
                    onMouseEnter={() => setMenuPane('add-slide')}
                    onClick={() => setMenuPane((p) => (p === 'add-slide' ? null : 'add-slide'))}
                  >
                    <Icon name="plus" size={17} strokeWidth={2} />
                    <span className="wv-ig__menugrow">Add slide</span>
                    <Icon name="chevron-right" size={16} strokeWidth={2} />
                  </button>
                </div>
                {menuPane === 'elements' && flyPos && createPortal(
                  <div
                    className="wv-ig__menuflyout"
                    role="menu"
                    aria-label="Add elements"
                    style={{ position: 'fixed', top: flyPos.top, left: flyPos.left, width: flyPos.width, zIndex: 200 }}
                    onMouseEnter={() => setMenuPane('elements')}
                  >
                    <div className="wv-ig__flyhead">
                      <strong>Add elements</strong>
                      <span>{slideRoleName} slide</span>
                    </div>
                    <div className="wv-ig__flylist">
                      {addElementsForRole(slideRoleName).map((el) => (
                        <button
                          key={el.id}
                          type="button"
                          role="menuitem"
                          className="wv-ig__flyitem"
                          onClick={() => addSlideElement(el)}
                        >
                          <Icon name={el.icon} size={18} strokeWidth={2} />
                          <span className="wv-ig__flycopy">
                            <span className="wv-ig__flylabel">{el.label}</span>
                            <span className="wv-ig__flydesc">{el.desc}</span>
                          </span>
                          <span className="wv-ig__flyadd" aria-hidden="true">
                            <Icon name="plus" size={16} strokeWidth={2.2} />
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="wv-ig__flynote">
                      <Icon name="info" size={14} strokeWidth={2} />
                      <span>
                        Only elements compatible with a {String(slideRoleName).toLowerCase()} slide
                        and your content are shown.
                      </span>
                    </p>
                  </div>,
                  document.body,
                )}
                {menuPane === 'theme' && flyPos && createPortal(
                  <div
                    className="wv-ig__menuflyout"
                    role="menu"
                    aria-label="Themes"
                    style={{ position: 'fixed', top: flyPos.top, left: flyPos.left, width: flyPos.width, zIndex: 200 }}
                    onMouseEnter={() => setMenuPane('theme')}
                  >
                    <div className="wv-ig__flyhead wv-ig__flyhead--back">
                      <button
                        type="button"
                        className="wv-ig__flyback"
                        aria-label="Back"
                        onClick={() => setMenuPane(null)}
                      >
                        <Icon name="chevron-left" size={18} strokeWidth={2} />
                      </button>
                      <strong>Themes</strong>
                    </div>
                    <div className="wv-ig__flylist">
                      <label
                        className={`wv-ig__flyitem${layoutBusy ? ' is-disabled' : ''}`}
                        role="menuitem"
                      >
                        <Icon name="image" size={18} strokeWidth={2} />
                        <span className="wv-ig__flycopy">
                          <span className="wv-ig__flylabel">Upload a reference</span>
                          <span className="wv-ig__flydesc">A photograph you like the look of</span>
                        </span>
                        <Icon name="chevron-right" size={16} strokeWidth={2} />
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          disabled={layoutBusy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) handleUploadReferenceTheme(file);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        role="menuitem"
                        className="wv-ig__flyitem"
                        disabled={layoutBusy}
                        onClick={() => setMenuPane('theme-library')}
                      >
                        <Icon name="droplet" size={18} strokeWidth={2} />
                        <span className="wv-ig__flycopy">
                          <span className="wv-ig__flylabel">Choose from library</span>
                          <span className="wv-ig__flydesc">{CAROUSEL_THEMES.length} directions</span>
                        </span>
                        <Icon name="chevron-right" size={16} strokeWidth={2} />
                      </button>
                    </div>
                  </div>,
                  document.body,
                )}
                {menuPane === 'theme-library' && flyPos && createPortal(
                  <div
                    className="wv-ig__menuflyout wv-ig__menuflyout--themes"
                    role="menu"
                    aria-label="Choose from library"
                    style={{ position: 'fixed', top: flyPos.top, left: flyPos.left, width: flyPos.width, zIndex: 200 }}
                    onMouseEnter={() => setMenuPane('theme-library')}
                  >
                    <div className="wv-ig__flyhead wv-ig__flyhead--back">
                      <button
                        type="button"
                        className="wv-ig__flyback"
                        aria-label="Back"
                        onClick={() => setMenuPane('theme')}
                      >
                        <Icon name="chevron-left" size={18} strokeWidth={2} />
                      </button>
                      <strong>Choose from library</strong>
                    </div>
                    <div className="wv-ig__flylist wv-ig__flylist--themes">
                      {CAROUSEL_THEMES.map((theme) => (
                        <button
                          key={theme.id}
                          type="button"
                          role="menuitem"
                          className="wv-ig__flyitem wv-ig__flyitem--theme"
                          disabled={layoutBusy}
                          onClick={() => handleChangeTheme(theme)}
                        >
                          <img
                            className="wv-ig__flythumb"
                            src={theme.thumb}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                          <span className="wv-ig__flycopy">
                            <span className="wv-ig__flylabel">{theme.name}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body,
                )}
                {menuPane === 'add-slide' && flyPos && createPortal(
                  <div
                    className="wv-ig__menuflyout wv-ig__menuflyout--addslide"
                    role="menu"
                    aria-label="Add slide"
                    style={{ position: 'fixed', top: flyPos.top, left: flyPos.left, width: flyPos.width, zIndex: 200 }}
                    onMouseEnter={() => setMenuPane('add-slide')}
                  >
                    <div className="wv-ig__flyhead wv-ig__flyhead--back">
                      <button
                        type="button"
                        className="wv-ig__flyback"
                        aria-label="Back"
                        onClick={() => setMenuPane(null)}
                      >
                        <Icon name="chevron-left" size={18} strokeWidth={2} />
                      </button>
                      <strong>Add slide</strong>
                    </div>
                    <div className="wv-ig__flylist">
                      <button
                        type="button"
                        role="menuitem"
                        className="wv-ig__flyitem"
                        onClick={() => {
                          addSlide();
                          setMenuPane(null);
                          closeZone();
                        }}
                      >
                        <Icon name="file-plus" size={18} strokeWidth={2} />
                        <span className="wv-ig__flycopy">
                          <span className="wv-ig__flylabel">Add blank slide</span>
                          <span className="wv-ig__flydesc">Add a new empty slide</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="wv-ig__flyitem"
                        onClick={() => {
                          duplicateSlide();
                          setMenuPane(null);
                          closeZone();
                        }}
                      >
                        <Icon name="files-plus" size={18} strokeWidth={2} />
                        <span className="wv-ig__flycopy">
                          <span className="wv-ig__flylabel">Duplicate slide</span>
                          <span className="wv-ig__flydesc">Create a copy of this slide</span>
                        </span>
                      </button>
                    </div>
                  </div>,
                  document.body,
                )}
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
                          key={`${activeSlide?.layoutHtml ? 'agent' : (chosenLayout?.id || 'lay')}-${r.key}`}
                          role={r}
                          faceName={faceLabelFor(r.slot, vbStore)}
                          value={wordDraft[r.key] || ''}
                          autoFocus={wordFocus ? r.key === wordFocus : n === 0}
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

            {compositionEditing && (
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
                    {themeEditing ? 'Change theme' : 'Change layout'}
                    {themeEditing ? (
                      <span className="wv-layed__hint">Applies to every slide in this carousel</span>
                    ) : optionsBusy ? (
                      <span className="wv-layed__hint">Loading layouts…</span>
                    ) : layVarBusy ? (
                      <span className="wv-layed__hint">Generating four layouts for this slide…</span>
                    ) : hasLayoutOpts && !needsLayoutVars ? (
                      <span className="wv-layed__hint">
                        Original + {generatedCount} ranked alternatives
                        <button
                          type="button"
                          className="wv-layed__regen"
                          onClick={() => generateLayoutVariations(true)}
                        >
                          Regenerate
                        </button>
                      </span>
                    ) : null}
                  </span>
                  {!themeEditing && (layVarBusy || (layVarErr && needsLayoutVars)) ? (
                    <span className="wv-layed__apply" aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm wv-layed__apply"
                      onClick={themeEditing ? applyTheme : applyLayout}
                      disabled={themeEditing
                        ? (!draftOpt || themeUnchanged)
                        : (hasLayoutOpts ? (!draftOpt || optUnchanged) : (!draftId || layoutUnchanged))}
                      title={themeEditing
                        ? (themeUnchanged ? 'This theme is already on every slide' : 'Apply this theme to every slide')
                        : ((hasLayoutOpts ? optUnchanged : layoutUnchanged)
                          ? 'This is the layout the post already has'
                          : undefined)}
                    >
                      <Glyph name="check" size={16} strokeWidth={2.5} />
                      {themeEditing ? 'Apply theme' : 'Apply changes'}
                    </button>
                  )}
                </div>
                <div className="wv-layed__picker">
                  {!themeEditing && (optionsBusy || layVarBusy) ? (
                    <div className="wv-layed__loading" role="status" aria-live="polite">
                      <span className="wv-spin" aria-hidden="true" />
                      <span>{optionsBusy ? 'Loading this slide’s layouts…' : 'Generating four layout variations of this slide…'}</span>
                    </div>
                  ) : !themeEditing && layVarErr && needsLayoutVars ? (
                    <div className="wv-layed__loading wv-layed__loading--err" role="alert">
                      <span>{layVarErr}</span>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => generateLayoutVariations(true)}
                      >
                        Try again
                      </button>
                    </div>
                  ) : themeEditing || hasLayoutOpts ? (
                    <div
                      className="wv-acts wv-layed__grid wv-layed__grid--opts"
                      role="radiogroup"
                      aria-label={themeEditing
                        ? 'Which carousel theme should this post use?'
                        : 'Which layout option should this slide use?'}
                    >
                      {layoutOptionCards(themeEditing)}
                    </div>
                  ) : (
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
                  )}
                </div>
              </div>
            )}

            {/* caption / why — right column on desktop */}
            <div className={`wv-ig__panel${sideTab === 'why' ? ' is-why' : sideTab === 'debug' ? ' is-debug' : sideTab === 'video' ? ' is-video' : ' is-cap'}${zone === 'caption' ? ' is-cappedit' : ''}`}>
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
                {videoCoverOn && (coverBusy || coverResult || existingCover || appliedCoverKey) && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sideTab === 'video'}
                    className={`wv-ig__segbtn${sideTab === 'video' ? ' is-on' : ''}`}
                    onClick={() => { setSideTab('video'); if (zone === 'caption') closeZone(); }}
                  >
                    Video cover
                  </button>
                )}
                {aiDebug.enabled && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sideTab === 'debug'}
                    className={`wv-ig__segbtn${sideTab === 'debug' ? ' is-on' : ''}`}
                    onClick={() => { setSideTab('debug'); if (zone === 'caption') closeZone(); }}
                  >
                    Debug
                  </button>
                )}
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
              <CaptionPreview
                key={selected}
                handle={handle}
                caption={day.content?.caption}
                direction={day.direction}
                cta={captionCta}
                tags={captionTags}
                needsReview={capNeedsReview}
                onEdit={() => openZone('caption')}
              />
            )}
            </div>
            <div className="wv-ig__whyblock">
              <WhyBody day={day} />
            </div>
            {aiDebug.enabled && (
              <div className="wv-ig__debugblock">
                <PostAgentDebug
                  day={day}
                  onRunLayout={handleRunLayout}
                  layoutBusy={layoutBusy}
                  layoutErr={layoutErr}
                  elapsedMs={weekUsage?.elapsedMs}
                  estimatedCostUsd={weekUsage?.estimatedCostUsd}
                  totalTokens={weekUsage?.totalTokens}
                />
              </div>
            )}
            <div className="wv-ig__videoblock">
              <VideoCoverPanel
                busy={coverBusy}
                error={coverErr}
                url={coverResult?.url || existingCoverUrl}
                spec={coverResult?.spec || existingCover?.spec || null}
                isApplied={Boolean(appliedCoverKey) && (
                  appliedCoverKey === (coverResult?.key || existingCover?.videoKey)
                )}
                hasApplied={Boolean(appliedCoverKey)}
                onApply={handleApplyCover}
                onRemove={handleRemoveCover}
                onRegenerate={handleMakeCover}
              />
            </div>
            </div>

            {/* when this goes out. A scheduled post waits for the next daily
                run after its slot; Publish now sends it immediately. */}
            {timeDraft ? (
              <div className="wv-time wv-time--change" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="schedm__back"
                  onClick={() => { setTimeDraft(null); setPick(null); }}
                >
                  <Glyph name="arrow-left" size={16} strokeWidth={2.1} />
                  Back
                </button>
                <h3 className="schedm__title">Change time</h3>
                <p className="schedm__lead">Pick a different date and time.</p>

                <SchedField
                  id="wv-sched-date"
                  label="Date"
                  icon="calendar"
                  value={schedFieldDate(timeDraft.date)}
                  open={pick === 'date'}
                  onOpen={() => setPick((v) => (v === 'date' ? null : 'date'))}
                />
                {pick === 'date' && (
                  <div className="schedpop" role="dialog" aria-label="Choose date">
                    <SchedCalendar value={timeDraft.date} minIso={todayIso} onPick={moveDate} />
                  </div>
                )}

                <SchedTime
                  id="wv-sched-time"
                  label="Time"
                  value={timeDraft.time}
                  onCommit={commitTime}
                />

                {metaConnected ? (
                  <>
                    <div className="schedm__rec">
                      <span className="schedm__rechead">
                        <Glyph name="sparkles" size={15} strokeWidth={2} />
                        Recommended time
                      </span>
                      <b>{shortDay(day.day)} · {timeSeedAt}</b>
                      <em>Based on when your audience is most active.</em>
                    </div>
                    <button
                      type="button"
                      className="btn btn--tertiary btn--sm schedm__use"
                      onClick={() => commitTime(timeSeedAt)}
                    >
                      <Glyph name="refresh-cw" size={15} strokeWidth={2} />
                      Use recommended time
                    </button>
                  </>
                ) : (
                  <div className="schedm__offer">
                    <span className="schedm__rechead">
                      <Glyph name="sparkles" size={15} strokeWidth={2} />
                      Get your best posting times
                    </span>
                    <em>Connect Instagram to let Bauhly recommend when to publish, based on when your audience is most active.</em>
                    <button
                      type="button"
                      className="btn btn--tertiary btn--sm schedm__connect"
                      onClick={() => { setTimeDraft(null); setConnectOpen(true); }}
                    >
                      Connect Instagram
                    </button>
                  </div>
                )}
                {savingTime && <span className="wv-time__saving">Saving…</span>}
                {publishMsg && !day.published && <span className="wv-publish__msg">{publishMsg}</span>}
              </div>
            ) : (
              <div className={`wv-ig__slot${day.published ? ' is-out' : ''}${!metaConnected ? ' is-muted' : ''}`}>
                <Glyph name={day.published ? 'check' : 'clock'} size={14} strokeWidth={2} />
                <span className="wv-ig__slot-text">
                  <span className="wv-ig__slot-when">
                    {day.published ? 'Published' : isScheduled ? 'Scheduled for' : isReview ? 'In review for' : 'Best time'}
                    {' '}
                    <b>{shortDay(day.day)} {slotTime}</b>
                    {day.published && metaForHandle?.igUsername ? ` · @${metaForHandle.igUsername}` : ''}
                  </span>
                  {isScheduled && (
                    <span className={`wv-ig__slot-why${scheduleFailed ? ' is-fail' : ''}`}>
                      {isPublishingSlot
                        ? 'Posting to Instagram…'
                        : scheduleFailed
                          ? (day.scheduleError || 'The last daily publish did not go through.')
                          : `Goes out after ${slotTime} on the next daily publish. You can send it now.`}
                      {' '}
                      {scheduleFailed && (
                        <button
                          type="button"
                          className="wv-ig__pubnow"
                          onClick={retrySchedule}
                          disabled={scheduling || publishing}
                        >
                          Retry
                        </button>
                      )}
                      {!isPublishingSlot && (
                        <button
                          type="button"
                          className="wv-ig__pubnow"
                          onClick={handlePublish}
                          disabled={publishing}
                        >
                          {publishing ? 'Publishing…' : 'Publish now'}
                        </button>
                      )}
                    </span>
                  )}
                  {isReview && (
                    <span className="wv-ig__slot-why">Held in the calendar for review — it won&apos;t publish until you schedule it.</span>
                  )}
                  {!isScheduled && !isReview && !day.published && metaConnected && (
                    <span className="wv-ig__slot-why">Based on when your audience is most active.</span>
                  )}
                  {!metaConnected && !day.published && (
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
                {publishMsg && !day.published && <span className="wv-publish__msg">{publishMsg}</span>}
              </div>
            )}
          </article>
          <LinkedInPublisher
            key={day._id || `${route._id}-${selected}`}
            initialText={[day.content?.caption, captionCta, formatHashtagLine(captionTags)].filter(Boolean).join('\n\n')}
          />
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
                {aiDebug.enabled && (
                  <PostAgentDebug
                    day={day}
                    onRunLayout={handleRunLayout}
                    layoutBusy={layoutBusy}
                    layoutErr={layoutErr}
                    elapsedMs={weekUsage?.elapsedMs}
                    estimatedCostUsd={weekUsage?.estimatedCostUsd}
                    totalTokens={weekUsage?.totalTokens}
                  />
                )}
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
            className="wv-ig wv-ig--export"
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
                  localMedia={localMedia}
                  mediaByKey={mediaByKey}
                  subjectsByKey={subjectsByKey}
                  preferProxy
                  paint={igVars}
                  themed={hasVisualEdits}
                  carouselLayoutHtmls={slides.map((x) => x?.layoutHtml || '')}
                  documentHtml={slideIsThemed(s) ? carouselDocumentOf(day) : ''}
                  slideIndex={i + 1}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
