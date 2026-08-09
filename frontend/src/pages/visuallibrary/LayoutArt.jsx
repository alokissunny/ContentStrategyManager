/*
 * The layout artwork — a layout description, drawn as the post it becomes.
 *
 * ── ONE RENDERER, TWO PAGES (Leon, Aug 7) ─────────────────────────────────
 *
 * This lived inside `VisualLibrary.jsx` while the weekly plan drew its slides
 * with a SECOND renderer (`SlidePreview.jsx`, `.lp*`) over a SECOND set of
 * layouts. The two looked different, were named differently and could not
 * agree on an aspect ratio, because they had nothing in common but intent.
 *
 * They are one thing now. This module is the only place a layout is drawn, so
 * "the Visual Library and Plans are two views of the same design system" is
 * true by construction rather than by two teams keeping two files in step:
 * same composition, same name, same 4:5 frame, and the same palette and faces,
 * because the artwork reads them as custom properties off whatever ancestor
 * carries `paintOf(identity)`.
 *
 * `mood` says whether the studio's photographs are drawn or the slots are left
 * as the empty ground they are before a photograph exists.
 */

import { useEffect, useState } from 'react';
import { paletteOf } from '../../lib/slidestyle.js';
import './visuallibrary.css';

/* ── the swatch row, read off the photograph ───────────────────────────────
 *
 * THE PALETTE HAS TO BE THE PICTURE'S (Leon, Aug 6). This layout's whole job is
 * "the colours of this project", and it has now had two palettes that were not:
 * four hard-coded stones that sat unchanged under every theme, and then a ramp
 * built from the theme's own roles, which made a lime library show a lime
 * palette beside a photograph of linen. Both were decoration standing where a
 * fact belongs.
 *
 * It samples the photograph. `paletteOf` (lib/slidestyle.js) is the product's
 * existing reader — a 32px thumbnail, coarse bins, one paint — and it is what
 * the reference intake already uses, so there is one palette reader in this
 * codebase and not two.
 *
 * The theme does not touch these chips. The layout's words around them keep the
 * theme's colours; the palette is the picture's, which is the only thing that
 * makes it a palette rather than a pattern. */

/* one decode per photograph, for the life of the page */
const PALETTES = new Map();

const lumOf = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
};
const apart = (a, b, tol) => {
  const pa = parseInt(a.slice(1), 16); const pb = parseInt(b.slice(1), 16);
  return Math.abs(((pa >> 16) & 255) - ((pb >> 16) & 255)) >= tol
    || Math.abs(((pa >> 8) & 255) - ((pb >> 8) & 255)) >= tol
    || Math.abs((pa & 255) - (pb & 255)) >= tol;
};

/* SPREAD ACROSS THE RANGE, NOT THE TOP FOUR BY COUNT (measured on this set).
 * The studio's stills are warm and high-key — a wall of linen swatches is four
 * thousand near-identical creams — so the four most COMMON bins came back as
 * four chips nobody could tell apart. Take a wide sample, drop the ones that sit
 * on top of each other, sort by luminance and pick evenly across what is left:
 * every chip is a colour that is genuinely in the photograph, and adjacent chips
 * are as far apart as that photograph allows. */
function rampOf(img, want) {
  const seen = [];
  paletteOf(img, 16).colours.forEach((c) => {
    if (/^#[0-9a-f]{6}$/i.test(c) && seen.every((u) => apart(u, c, 12))) seen.push(c);
  });
  const sorted = seen.sort((a, b) => lumOf(a) - lumOf(b));
  if (!sorted.length) return [];

  /* thin by BRIGHTNESS as well as by channel before spacing: two tones can be
     twelve points apart in red and still land on the same step of the ramp, and
     a ramp whose neighbours share a step is the thing that reads as random.
     Measured on the studio's own stills — warm, high-key, genuinely low
     contrast — 0.05 is the widest floor they can carry without losing a real
     tone; if the picture cannot fill `want` steps at that floor, the floor
     relaxes rather than the palette inventing a colour that is not in it. */
  const stepped = (floor) => {
    const keep = [sorted[0]];
    sorted.slice(1).forEach((c) => {
      if (lumOf(c) - lumOf(keep[keep.length - 1]) >= floor) keep.push(c);
    });
    /* always end on the lightest tone the photograph holds, so the ramp spans
       its whole range rather than stopping wherever the walk ran out */
    const last = sorted[sorted.length - 1];
    if (keep[keep.length - 1] !== last) keep.push(last);
    return keep;
  };
  let pool = stepped(0.05);
  if (pool.length < want) pool = stepped(0.03);
  if (pool.length < want) pool = sorted;
  if (pool.length <= want) return pool;

  const out = [];
  for (let i = 0; i < want; i += 1) {
    out.push(pool[Math.round((i * (pool.length - 1)) / (want - 1))]);
  }
  return [...new Set(out)];
}

function useImagePalette(src, want) {
  const [palette, setPalette] = useState(() => (src && PALETTES.get(src)) || null);
  useEffect(() => {
    /* no photograph — with mood visuals off, or before one exists — means no
       palette to show, and the chips draw as the empty ground the rest of the
       library uses for an unphotographed slide */
    if (!src) { setPalette(null); return undefined; }
    const cached = PALETTES.get(src);
    if (cached) { setPalette(cached); return undefined; }
    let alive = true;
    const img = new Image();
    /* the swatch reader samples pixels on a canvas; a cross-origin (S3) source
       needs CORS + this flag, and a same-origin asset ignores it */
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ramp = rampOf(img, want);
      PALETTES.set(src, ramp);
      if (alive) setPalette(ramp);
    };
    img.onerror = () => { if (alive) setPalette(null); };
    img.src = src;
    return () => { alive = false; };
    /* keyed on the source, so changing the photograph re-reads it */
  }, [src, want]);
  return palette;
}

/* ── the pieces every composition is built from ───────────────────────────
 *
 * SIZED IN `cqw`, NOT PIXELS (Leon, Aug 6). The type used to be set in px at a
 * 232px card, so a four-step list ran out of its own frame and the fourth step
 * was clipped by `overflow:hidden` — the layout was lying about what it holds.
 * The frame is a container now and every size in here is a share of its width,
 * so one piece of markup reads at 232px in a rail and would read at 900px in a
 * detail view, and nothing is hand-tuned per breakpoint. */

/* A LAYOUT WITH NO PICTURE IS STILL A LAYOUT. With mood visuals off — or before
   a studio has photographed anything — this draws the ground the photograph
   would sit on rather than an empty <img>. */
export function Ph({ src, on, className = '' }) {
  const show = on && src;
  return (
    <span className={`vl-ph ${className} ${show ? '' : 'is-empty'}`}>
      {show ? <img src={src} alt="" loading="lazy" /> : null}
    </span>
  );
}

function Words({ art = {}, className = '' }) {
  return (
    <span className={`vl-w ${className}`}>
      {art.eyebrow && <span className="vl-w__eyebrow">{art.eyebrow}</span>}
      {art.head && (
        <span className="vl-w__h">
          {art.head}
          {art.accent && <><br /><em>{art.accent}</em></>}
        </span>
      )}
      {art.body && <span className="vl-w__b">{art.body}</span>}
    </span>
  );
}

/* ── the layout itself, drawn ──────────────────────────────────────────────
 * One shape per `kind`. They share the frame, the type ramp and the way words
 * sit on a photograph, so the set reads as one family rather than a folder of
 * exports. */
export function Preview({ l, mood = true }) {
  const a = l.art || {};
  const img = (i = 0, cls) => <Ph src={l.imgs[i]} on={mood} className={cls} />;
  const cls = `vl-a vl-a--${l.kind} vl-a--${l.tone}`;

  switch (l.kind) {
    /* ── words alone ── */
    case 'statement':
      return <span className={cls}><Words art={a} /></span>;

    case 'stat':
      return (
        <span className={cls}>
          <span className="vl-big">{a.big}</span>
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    case 'quote':
      return (
        <span className={cls}>
          <span className="vl-mark">“</span>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    case 'prose':
      return <span className={cls}><Words art={a} /></span>;

    /* the display line, a subtitle under it, and a rule between — the shape the
       brief asked for by name */
    case 'title-sub':
      return (
        <span className={cls}>
          {a.eyebrow && <span className="vl-w__eyebrow">{a.eyebrow}</span>}
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-rule" />
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    case 'index':
      return (
        <span className={cls}>
          <span className="vl-num">{a.big}</span>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    case 'steps':
      return (
        <span className={cls}>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-list">
            {(a.items || []).map((it, i) => (
              <span key={it} className="vl-list__row">
                <i>{String(i + 1).padStart(2, '0')}</i>
                {it}
              </span>
            ))}
          </span>
        </span>
      );

    case 'compare':
      return (
        <span className={cls}>
          <span>{a.a}</span>
          <i className="vl-vs" />
          <span>{a.b}</span>
        </span>
      );

    /* ── a photograph, and words on it ── */
    case 'bleed':
    case 'quote-photo':
    case 'stat-photo':
      return (
        <span className={cls}>
          {img(0, 'is-fill')}
          <span className="vl-wash" />
          {l.kind === 'stat-photo' ? (
            <span className="vl-w is-on-photo">
              <span className="vl-big">{a.big}</span>
              <span className="vl-w__b">{a.body}</span>
            </span>
          ) : l.kind === 'quote-photo' ? (
            <span className="vl-w is-on-photo">
              <span className="vl-mark">“</span>
              <span className="vl-w__h">{a.head}</span>
              <span className="vl-w__b">{a.body}</span>
            </span>
          ) : (
            <Words art={a} className="is-on-photo" />
          )}
        </span>
      );

    /* the picture is the slide; one bar of paper at the foot carries the line */
    case 'caption':
      return (
        <span className={cls}>
          {img(0, 'is-fill')}
          <span className="vl-bar"><Words art={a} /></span>
        </span>
      );

    /* the picture above, the words under it on the studio's own ground */
    case 'hero':
      return (
        <span className={cls}>
          {img(0)}
          <Words art={a} />
        </span>
      );

    /* half and half */
    case 'split':
      return (
        <span className={cls}>
          <Words art={a} />
          {img(0)}
        </span>
      );

    /* the picture set inside the ground with a margin all round, the way a
       printed page frames a plate */
    case 'frame':
      return (
        <span className={cls}>
          {img(0)}
          <Words art={a} />
        </span>
      );

    /* the picture runs off the right edge and the words stand in what is left */
    case 'edge':
      return (
        <span className={cls}>
          <Words art={a} />
          {img(0)}
        </span>
      );

    /* two states of one room, beside each other */
    case 'duo':
      return (
        <span className={cls}>
          <span className="vl-half">{img(0)}<em>{a.labels?.[0]}</em></span>
          <span className="vl-half">{img(1)}<em>{a.labels?.[1]}</em></span>
          <span className="vl-foot">{a.head}</span>
        </span>
      );

    case 'grid4':
      return (
        <span className={cls}>
          <span className="vl-cells">{l.imgs.map((src, i) => <Ph key={src + i} src={src} on={mood} />)}</span>
          <span className="vl-foot">{a.head}</span>
        </span>
      );

    /* one large and two small — a collage that still has a reading order */
    case 'collage':
      return (
        <span className={cls}>
          <span className="vl-cells">
            {img(0, 'is-lead')}
            {img(1)}
            {img(2)}
          </span>
          <span className="vl-foot">{a.head}</span>
        </span>
      );

    /* two pictures that overlap — the only composition in the set where they
       touch, so it is the one that reads as a pair rather than a comparison */
    case 'overlap':
      return (
        <span className={cls}>
          {img(0, 'is-back')}
          {img(1, 'is-front')}
          <Words art={a} />
        </span>
      );

    /* a mark on the photograph, and the note it points at */
    case 'annotate':
      return (
        <span className={cls}>
          {img(0, 'is-fill')}
          <span className="vl-pin" />
          <span className="vl-note"><Words art={a} /></span>
        </span>
      );

    /* the palette of a project, under the room it came out of. The chips are
       drawn by SwatchRow, which reads them off that very photograph. */
    case 'swatches':
      return (
        <span className={cls}>
          {img(0)}
          <SwatchRow src={mood ? l.imgs[0] : null} want={a.swatches || 4} />
          <Words art={a} />
        </span>
      );


    /* ══ the compositions added Aug 6 ══════════════════════════════════════ */

    /* the claim, and the sentence that earns it — bottom-anchored so a long
       subtitle grows upward instead of crowding the statement */
    case 'hook-sub':
      return (
        <span className={cls}>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    /* the same hierarchy across a horizon: statement on the ground, photograph
       filling the foot, subtitle sitting on the picture */
    case 'hook-band':
      return (
        <span className={cls}>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-bandwrap">
            {img(0, 'is-fill')}
            <span className="vl-wash" />
            <span className="vl-w__b">{a.body}</span>
          </span>
        </span>
      );

    /* the line at the centre of both axes, a caption pinned to the foot */
    case 'centered':
      return (
        <span className={cls}>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    /* title in one corner, copy in the opposite one */
    case 'corner':
      return (
        <span className={cls}>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    /* title left, supporting text set against the right margin */
    case 'split-type':
      return (
        <span className={cls}>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    /* the smallest type in the set, in the largest field */
    case 'airy':
      return (
        <span className={cls}>
          <span className="vl-dot" />
          <span className="vl-w">
            <span className="vl-w__eyebrow">{a.eyebrow}</span>
            <span className="vl-w__b">{a.body}</span>
          </span>
        </span>
      );

    /* a title over two columns of body */
    case 'columns':
      return (
        <span className={cls}>
          <span className="vl-w__eyebrow">{a.eyebrow}</span>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-cols">
            <span className="vl-w__b">{a.body}</span>
            <span className="vl-w__b">{a.bodyB}</span>
          </span>
        </span>
      );

    /* a panel inset on the ground */
    case 'callout':
      return (
        <span className={cls}>
          {/* the accent plane is a real sibling, not a pseudo-element: a
              negative z-index inside `.vl-a` paints under the artwork's own
              background and vanishes (measured) */}
          <span className="vl-panelwrap">
            <span className="vl-panel__block" />
            <span className="vl-panel">
              <span className="vl-w__eyebrow">{a.eyebrow}</span>
              <span className="vl-w__h">{a.head}</span>
              <span className="vl-w__b">{a.body}</span>
            </span>
          </span>
        </span>
      );

    /* the quote, and a second voice beside it */
    case 'quote-note':
      return (
        <span className={cls}>
          <span className="vl-mark">“</span>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    /* the numeral hangs in the margin, the paragraph runs beside it */
    case 'stat-copy':
      return (
        <span className={cls}>
          <span className="vl-big">{a.big}</span>
          <span className="vl-w">
            <span className="vl-w__eyebrow">{a.eyebrow}</span>
            <span className="vl-w__b">{a.body}</span>
          </span>
        </span>
      );

    /* dated rows, joined */
    case 'timeline':
      return (
        <span className={cls}>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-time">
            {(a.items || []).map((t) => (
              <span key={t} className="vl-time__row"><i />{t}</span>
            ))}
          </span>
        </span>
      );

    /* two headed columns, each with its own list */
    case 'compare-cols':
      return (
        <span className={cls}>
          <span className="vl-col">
            <b>{a.a}</b>
            {(a.itemsA || []).map((t) => <em key={t}>{t}</em>)}
          </span>
          <span className="vl-col">
            <b>{a.b}</b>
            {(a.itemsB || []).map((t) => <em key={t}>{t}</em>)}
          </span>
        </span>
      );

    /* the magazine spread: a banner of type, then picture and column */
    case 'magazine':
      return (
        <span className={cls}>
          <span className="vl-w__eyebrow">{a.eyebrow}</span>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-mag">
            {img(0)}
            <span className="vl-w__b">{a.body}</span>
          </span>
        </span>
      );

    /* six pictures at mixed sizes — a board, not a grid */
    case 'moodboard':
      return (
        <span className={cls}>
          <span className="vl-board">
            {l.imgs.map((src, i) => <Ph key={src + i} src={src} on={mood} className={`is-p${i}`} />)}
          </span>
          <span className="vl-w">
            <span className="vl-w__eyebrow">{a.eyebrow}</span>
            <span className="vl-w__h">{a.head}</span>
          </span>
        </span>
      );

    /* nine cells: pictures, one filled block, one of type */
    case 'modular':
      return (
        <span className={cls}>
          {img(0)}
          <span className="vl-block" />
          {img(1)}
          <span className="vl-w__h">{a.head}</span>
          {img(2)}
          {img(3)}
        </span>
      );

    /* off the centre line on purpose */
    case 'asym':
      return (
        <span className={cls}>
          {img(0)}
          <span className="vl-w">
            <span className="vl-w__h">{a.head}</span>
            <span className="vl-w__b">{a.body}</span>
          </span>
        </span>
      );

    /* three pictures in a band, type above and below */
    case 'strip':
      return (
        <span className={cls}>
          <span className="vl-w">
            <span className="vl-w__eyebrow">{a.eyebrow}</span>
            <span className="vl-w__h">{a.head}</span>
          </span>
          <span className="vl-band">{l.imgs.map((src, i) => <Ph key={src + i} src={src} on={mood} />)}</span>
          <span className="vl-w__b">{a.body}</span>
        </span>
      );

    /* the picture is the slide; the words are a footnote on it */
    case 'min-caption':
      return (
        <span className={cls}>
          {img(0, 'is-fill')}
          <span className="vl-foot-note">{a.body}</span>
        </span>
      );

    /* the type leads and the picture supports it */
    case 'text-first':
      return (
        <span className={cls}>
          <span className="vl-w">
            <span className="vl-w__eyebrow">{a.eyebrow}</span>
            <span className="vl-w__h">{a.head}</span>
            <span className="vl-w__b">{a.body}</span>
          </span>
          {img(0)}
        </span>
      );

    /* several marks, and the legend that names them */
    case 'annotate-multi':
      return (
        <span className={cls}>
          {img(0, 'is-fill')}
          {(a.items || []).map((t, i) => <span key={t} className={`vl-pin is-p${i}`} />)}
          <span className="vl-legend">
            <span className="vl-w__eyebrow">{a.eyebrow}</span>
            {(a.items || []).map((t, i) => (
              <span key={t} className="vl-legend__row"><i>{i + 1}</i>{t}</span>
            ))}
          </span>
        </span>
      );

    /* one frame, two pictures, divided on the diagonal */
    case 'diagonal':
      return (
        <span className={cls}>
          {img(0, 'is-a')}
          {img(1, 'is-b')}
          <span className="vl-half is-a"><em>{a.labels?.[0]}</em></span>
          <span className="vl-half is-b"><em>{a.labels?.[1]}</em></span>
        </span>
      );

    /* samples as overlapping cards you could pick up */
    case 'material-stack':
      return (
        <span className={cls}>
          <span className="vl-stack">
            {l.imgs.map((src, i) => (
              <span key={src + i} className={`vl-stack__card is-c${i}`}>
                <Ph src={src} on={mood} />
                <em>{a.items?.[i]}</em>
              </span>
            ))}
          </span>
          <span className="vl-w__h">{a.head}</span>
        </span>
      );

    /* a process shown rather than listed */
    case 'step-photo':
      return (
        <span className={cls}>
          <span className="vl-w__h">{a.head}</span>
          <span className="vl-steps">
            {l.imgs.map((src, i) => (
              <span key={src + i} className="vl-steps__row">
                <Ph src={src} on={mood} />
                <em>{a.items?.[i]}</em>
              </span>
            ))}
          </span>
        </span>
      );

    default:
      return <span className={cls}><Words art={a} /></span>;
  }
}

function SwatchRow({ src, want }) {
  const palette = useImagePalette(src, want);
  const chips = palette && palette.length ? palette : null;
  return (
    <span className="vl-swatches">
      {chips
        ? chips.map((c) => <i key={c} style={{ background: c }} />)
        : Array.from({ length: want }, (_, i) => <i key={i} className="is-empty" />)}
    </span>
  );
}

/* ── one card: the layout, its name, and whether it is in use ───────────────
 *
 * THE LABELS IN THE ARTWORK WENT (Leon, Aug 6). Each preview carried "HOOK ·
 * STATEMENT" in its top corner and "01" in its bottom one. The first repeated
 * the row heading directly above it and the card name directly below it, three
 * times over on one screen; the second looked like a slide number and was the
 * literal string "01" on every card in the library, which is worse than
 * useless — it was untrue. Neither is replaced: the post canvas is for the
 * post, and what the card has to say it says underneath. */
