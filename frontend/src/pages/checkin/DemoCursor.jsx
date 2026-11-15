/* Ported from bauhly-v3 src/pages/app/DemoCursor.jsx (Nov 15, 64789e4); the box is our `.cap-overlay .ck`. */
/* ══ THE EXAMPLE'S HAND (Leon, Nov 10 — decision 815) ═══════════════════════════════════════════════════════════════
   "Show an animated cursor that fades in, moves smoothly to the relevant option or button, clicks it, and fades out.
    Use a medium-large cursor so it's clearly visible. Keep the cursor movement natural, without sudden jumps or
    unnecessary animations."
   One pointer, drawn with the product's own pointer mark (`Icon` `click`, the mark on `Try an example`) at 32, filled
   ink with a light rim so it reads over a photograph as well as over white. It stands above the Capture box (`.capm`
   is 200) in a portal, because the box is transformed while it opens and a fixed child of a transformed box is placed
   against the box, not the screen.
   `tap(el, then)` fades in a little below and right of the target (`NEAR`, decision 853; left before it), travels the short way to it, presses (a small scale, the press a real button shows), runs `then`, and fades
   out unless asked to stay for the next press. `rest(el, say)` travels to a control and stays on it, pointing down at
   it and back up, with `say` written beside it, over and over (decision 827), until `stop()` — the example's last move, handing the
   press to the visitor (decision 823). With reduced motion there is no travelling hand: `then` runs at once, and
   `rest` shows the hand still, on its control, with its bubble. Everything it has scheduled stops with `stop()` and
   when it unmounts. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../brand/Icon';
import TypedSay from './TypedSay';

/* ── LARGER THAN ANY POINTER A VISITOR OWNS (Leon, Nov 15 — decision 963: "Increase its size so users can clearly
   distinguish it from a normal cursor and understand that they're watching an automated demo… Preserve the existing
   cursor shape") ── 44, against a system pointer's 20 or so; the tip, the rim and the line beside it all scale from
   here. WHAT USED TO BE HERE: 32 (decision 815's "medium-large") */
const SIZE = 44;
/* where each mark's tip is, in its 24 box, at 32: the pressing hand (`click`, `M5.5 4.5…`) and the waiting one
   (`point-left`, `M3 12…`, decision 853; `pointer`, `M5 3…`, in 846) */
const TIPS = {
  click: { x: (5.5 / 24) * SIZE, y: (4.5 / 24) * SIZE },
  'point-left': { x: (3 / 24) * SIZE, y: (12 / 24) * SIZE },
};
const TIP = TIPS.click;
const FADE_MS = 240;
const PRESS_MS = 170;
/* ── SHORT AND DIRECT (Leon, Nov 11 — decision 818: "Keep the animated cursor's movement paths short and direct.
   Avoid unnecessary travel across the screen. Use smooth fade-in and fade-out transitions between actions rather than
   moving the cursor long distances") ── each press starts from `NEAR`, a little below and left of its control (the
   way a hand comes at a button), so the way is about 45px; only a press that follows one with the hand still up (a pick
   and its `Continue`, `stay`) travels between them. Time still grows with the distance, from a third of a second.
   WHAT USED TO BE HERE: the hand faded in where the last press left it and crossed the box from there (decision 815),
   560–1100ms. */
/* ── FROM THE RIGHT (Leon, Nov 12 — decision 853: "the cursor currently enters from left to right. Reverse the direction
   so it enters from right to left. Keep the movement smooth and natural") ── a little below and RIGHT of the control,
   so the hand, which points up and to the left, travels along its own line onto it. WHAT USED TO BE HERE: `x: -36`,
   below and left (decision 818) */
const NEAR = { x: 36, y: 28 };
/* after a press: how long what it set off is given to draw before the hand steps aside, and the air it keeps round
   itself from anything it could cover (decision 970) */
const PARK_WAIT_MS = 420;
const PARK_AIR = 8;
const PARK_EVERY_MS = 400;
/* a hand still up from one press goes the short way to the next only within this; further, it fades and comes back */
/* WHAT USED TO BE HERE: `FAR` (160), past which a hand still up faded out rather than travelling (decision 821; gone in 963) */
/* the resting tip: this far out from the control's right edge, level with its middle; and where the hand comes from to
   get there, further out to the right on the same line (decision 834). WHAT USED TO BE HERE: `CORNER_IN` (12, 8) inside
   the bottom right corner and `CORNER_FROM` (40, 34) out past it on the diagonal (decision 825) */
const SIDE_GAP = 6;
const SIDE_FROM = { x: 44, y: 0 };
/* the line beside the resting hand, from the hand box's own corner: right of the mark, on the tip's own line (centred on
   it, the line being about 18 high), so the hand, its words and the control read as one row (decision 834). WHAT USED TO
   BE HERE: a little below the tip, under the control's corner (decisions 825, 827) */
/* (+38: the mark's right edge is TIP + 30, and at the end of its 5px ease it ran into the first letter, MEASURED) */
/* ── AND BESIDE THE LEVEL POINTER (decision 853) ── it reaches 24 across its box (`18 / 24`), 5 more at the end of its
   ease, so the words start 8 clear of that, centred on the tip's own line (the line is about 18 high). WHAT USED TO BE
   HERE: the same sum for the upright pointer (`16.95 / 24`, decision 846), and `TIP + 38` for the tilted mark before */
const SAY_AT = { x: Math.round((18 / 24) * SIZE) + 5 + 8, y: TIPS['point-left'].y - 9 };
/* and a little calmer than a quick hand, so the eye can follow it there (decision 826; was 320–700, `280 + d × 0.9`) */
const travelMs = (d) => Math.round(Math.min(800, Math.max(440, 380 + d * 0.9)));

export function useDemoCursor() {
  /* `mark`: which drawing the hand is (`TIPS`) — the tilted `click` for a press, the upright `pointer` while it waits */
  const [at, setAt] = useState({ x: 0, y: 0, on: false, press: false, ms: 0, say: null, clip: null, mark: 'click' });
  /* the control the hand is resting on, kept in step with it while the thread scrolls or the window changes */
  const restOn = useRef(null);
  const now = useRef(at);
  const set = (next) => { now.current = { ...now.current, ...next }; setAt(now.current); };
  const timers = useRef([]);
  const later = (ms, fn) => timers.current.push(setTimeout(fn, ms));
  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    restOn.current = null;
    set({ on: false, press: false, say: null, clip: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* the spot on a control the hand goes to: its middle, or a little in from the left on a wide card */
  const spotOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 72), y: r.top + r.height / 2 };
  };
  /* `spot`: where on the control the tip goes; `from`: where it comes in from, beside that spot */
  /* each move bumps this, so a park scheduled after one press stands down if the next press has already set off */
  const moveSeq = useRef(0);
  const go = (el, done, { spot = spotOf, from = NEAR } = {}) => {
    moveSeq.current += 1;
    el.scrollIntoView({ block: 'nearest', behavior: still() ? 'auto' : 'smooth' });
    /* after the thread has moved, so the spot is where the control is now */
    later(still() ? 0 : 260, () => {
      if (!el.isConnected) return;
      const to = spot(el);
      if (still()) { done(); return; }
      let wait = 0;
      /* still up from the last press but further than `FAR` from this one: it goes, and comes back close by, rather
         than cross the screen (Leon, Nov 11 — decision 821, point 5 of the brief) */
      /* ── AND IT STAYS IN SIGHT ALL THE WAY (Leon, Nov 15 — decision 963: "keep the demo cursor visible throughout the
         entire guided experience… When the cursor isn't moving, keep it visible in its last position rather than fading
         it out") ── a hand already up travels to the next control however far it is (`travelMs` caps the time at 800).
         WHAT USED TO BE HERE: past `FAR` it faded out and in again beside the target (decision 821) */
      if (!now.current.on) {
        later(wait, () => set({ x: to.x + from.x, y: to.y + from.y, ms: 0, on: true }));
        wait += FADE_MS;
      }
      later(wait + 20, () => {
        const ms = travelMs(Math.hypot(to.x - now.current.x, to.y - now.current.y));
        set({ x: to.x, y: to.y, ms });
        later(ms, done);
      });
    });
  };
  /* ── AND IT CAN HOVER BEFORE IT PRESSES (Leon, Nov 14 — decision 944: "When the animated cursor reaches the Send icon,
     trigger the existing hover animation… Briefly pause so users can recognize the action, then animate the cursor
     clicking") ── `reach` runs as the hand arrives on the control (what a pointer coming to rest on it would set off),
     and the press waits `dwell` after it. Neither with reduced motion: there is no hand to arrive. `spot` is where on
     the control the tip goes (`spotOf`, its middle, unless the caller says) */
  /* (`stay`, which callers may still pass, is what every press does now, decision 963) */
  const tap = (el, then, { reach = null, dwell = 0, spot = spotOf } = {}) => {
    if (now.current.mark !== 'click') set({ mark: 'click' });
    go(el, () => {
      if (still()) { then(); return; }
      reach?.();
      later(reach ? dwell : 0, () => {
        set({ press: true });
        later(PRESS_MS, () => {
          set({ press: false });
          then();
          /* and stays in sight until the next move (decision 963), off to the side of what it pressed (decision 970,
             `park`). WHAT USED TO BE HERE: unless `stay`, it faded out `FADE_MS` after the press (decision 815) */
          const seq = moveSeq.current;
          const root = el.closest('.cap-overlay .ck') || document.body;
          const clip = clipOf(el);
          later(PARK_WAIT_MS, () => watchPark(seq, root, clip));
        });
      });
    }, { spot });
  };
  /* ── AND IT ENDS ON THE VISITOR'S PRESS (Leon, Nov 11 — decision 823: "when the cursor gets to the view post button,
     we end the automatic cursor here, and leave it pointing down, up, down up until the user clicks, also add a bubble
     saying now its your turn") ── WHAT USED TO BE HERE: `point(el)`, a rest of 900ms and gone (decision 815) */
  /* ── BESIDE IT, POINTING AT IT (Leon, Nov 12 — decision 834: "Move both elements to the right side… rather than the
     bottom-right corner. Animate the cursor moving horizontally from left to right, pointing toward the action button.
     Keep the movement smooth and subtle"; asked which button, "View post, from its right") ──
     The tip rests just past the control's right edge, level with its middle (`SIDE_GAP`), the hand coming to it from
     further right on the same line (`SIDE_FROM`); at rest it eases a few pixels right and back toward the control
     (`.is-rest`, app.css). WHAT USED TO BE HERE: the tip just inside the bottom right corner, at an angle (decision 825);
     before that, on the control's middle pointing down (823). (`cornerOf` keeps its name: it is the resting spot.) */
  const cornerOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.right + SIDE_GAP, y: r.top + r.height / 2 };
  };
  /* ── AND IT GOES UNDER THE FIELD, NOT OVER IT (Leon, Nov 12 — decision 830: "when scrolling, the cursor and 'Now it's
     your turn' text should move underneath the fixed chatfield and disappear behind it, rather than overlapping or
     appearing on top of it. Keep the chatfield above both elements in the visual hierarchy") ──
     The hand is drawn over the page (a portal, above the box), so it is cut to the box the control scrolls in: what of
     it falls past that box's bottom (the field) or top (the box's head) is not drawn, as the conversation's own lines
     are not. `clipOf` is that box, read again as it moves. */
  const clipOf = (el) => {
    let box = el.parentElement;
    while (box && box !== document.body) {
      const oy = getComputedStyle(box).overflowY;
      if (oy === 'auto' || oy === 'scroll') break;
      box = box.parentElement;
    }
    if (!box || box === document.body) return null;
    const r = box.getBoundingClientRect();
    /* a box whose top runs under something drawn over it says how far (`scroll-padding-top`): Capture's thread runs up
       behind the title (decision 845), and the hand goes under the title as it goes under the field */
    const under = parseFloat(getComputedStyle(box).scrollPaddingTop) || 0;
    return { top: r.top + under, bottom: r.bottom };
  };
  /* ── AND OFF TO ONE SIDE OF WHAT IT PRESSED (Leon, Nov 15 — decision 970: "During the guided demo, the cursor sometimes
     covers important information or content… when generating the post, move the cursor slightly to the side so the
     generation progress and messages remain visible. When the cursor isn't performing an action, position it in a
     nearby empty area without covering content… Preserve the existing cursor size, shape, movement, and smooth
     transitions") ── a press is followed, once what it set off has drawn (`PARK_WAIT_MS`), by a short move to the
     nearest spot beside where it pressed that covers nothing: to the right first, then a little lower, then to the
     left, then below. "Nothing" is measured, not assumed: the words' own LINES (Range rects of the text, so the empty
     end of a short line is room), and every control, picture, card and the field as boxes, the hand's box plus
     `PARK_AIR` checked against them, and the spot inside the box the conversation scrolls in. If no spot is clear the
     hand stays where it is. */
  const contentRects = (root) => {
    const rects = [];
    const vis = (r) => r.width > 0 && r.height > 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.textContent.trim() && !n.parentElement?.closest('.ck-cursor, .sr-only, [aria-hidden="true"]')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (vis(r)) rects.push(r);
    }
    /* the generation's progress is a card (`.gprog__card`), and a card is content as a whole, empty corners included */
    root.querySelectorAll('button, a, img, video, input, textarea, .capc, .cvmedia__item, .ck-said, .gprog, [class*="__card"]')
      .forEach((el) => { if (el.closest('.ck-cursor')) return; const r = el.getBoundingClientRect(); if (vis(r)) rects.push(r); });
    return rects;
  };
  /* and while it waits it keeps looking: the conversation goes on drawing under a hand that has stopped (Bauhly's next
     line, the next step's buttons), so the spot is checked again every `PARK_EVERY_MS` until the next move, and the
     hand steps aside again if something has arrived under it (MEASURED at 1280: the next message drew under the waiting
     hand and stayed covered until it set off for `Build post`) */
  const watchPark = (seq, root, clip) => {
    if (moveSeq.current !== seq || !now.current.on || restOn.current) return;
    park({ x: now.current.x, y: now.current.y }, root, clip);
    later(PARK_EVERY_MS, () => watchPark(seq, root, clip));
  };
  const park = (from, root, clip) => {
    const rects = contentRects(root);
    const top = Math.max(clip?.top ?? 0, 0);
    const bottom = Math.min(clip?.bottom ?? window.innerHeight, window.innerHeight);
    const box = root.getBoundingClientRect();
    const free = (x, y) => {
      const l = x - TIP.x - PARK_AIR;
      const t = y - TIP.y - PARK_AIR;
      const r = x - TIP.x + SIZE + PARK_AIR;
      const b = y - TIP.y + SIZE + PARK_AIR;
      if (t < top || b > bottom || l < box.left || r > box.right) return false;
      return !rects.some((q) => q.left < r && q.right > l && q.top < b && q.bottom > t);
    };
    if (free(from.x, from.y)) return;
    const tries = [];
    for (let d = 40; d <= 420; d += 20) tries.push([d, 0]);
    for (let d = 40; d <= 420; d += 20) tries.push([d, 36]);
    for (let d = 40; d <= 320; d += 20) tries.push([-d, 0]);
    for (let d = 40; d <= 200; d += 20) tries.push([0, d]);
    const hit = tries.find(([dx, dy]) => free(from.x + dx, from.y + dy));
    if (!hit) return;
    const to = { x: from.x + hit[0], y: from.y + hit[1] };
    set({ x: to.x, y: to.y, ms: travelMs(Math.hypot(hit[0], hit[1])) });
  };
  const rest = (el, say) => {
    /* the level pointer from the moment it sets out for the control, so it arrives as what it will be (decisions 846,
       853) */
    set({ clip: clipOf(el), mark: 'point-left' });
    const there = () => {
      restOn.current = el;
      const to = cornerOf(el);
      set({ x: to.x, y: to.y, ms: 0, on: true, say, clip: clipOf(el) });
    };
    if (still()) { there(); return; }
    go(el, there, { spot: cornerOf, from: SIDE_FROM });
  };
  useEffect(() => {
    if (!at.say) return undefined;
    const follow = () => {
      const el = restOn.current;
      if (!el) return;
      if (!el.isConnected) { stop(); return; }
      const to = cornerOf(el);
      set({ x: to.x, y: to.y, ms: 0, clip: clipOf(el) });
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    /* ── AND WHATEVER ELSE MOVES IT (Leon, Nov 13 — decision 884: "Fix the position of the 'Now it's your turn' label so
       it's correctly aligned with the element the user needs to interact with… stays correctly positioned across
       different screen sizes") ── a scroll and a resize were the only things it listened to, so a control that moved any
       other way — its turn's entrance still settling, a face arriving late, the column changing its inset (Leon's
       screenshot: the hand inside `View post` by about the 46px decision 883 moved Bauhly's turns) — left the hand where
       the control had been. While it rests it reads the control's place once a frame and moves only when that changed:
       one rectangle read, and nothing written while nothing moves. */
    let frame = 0;
    const watch = () => {
      const el = restOn.current;
      if (el?.isConnected) {
        const to = cornerOf(el);
        if (Math.abs(to.x - now.current.x) > 0.5 || Math.abs(to.y - now.current.y) > 0.5) follow();
      }
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.say]);

  const tip = TIPS[at.mark] || TIP;
  const node = createPortal(
    <span
      className={`ck-cursor ${at.on ? 'is-on' : ''} ${at.press ? 'is-press' : ''} ${at.say ? 'is-rest' : ''}`.replace(/\s+/g, ' ').trim()}
      style={{
        translate: `${at.x - tip.x}px ${at.y - tip.y}px`,
        '--ck-cursor-ms': `${at.ms}ms`,
        /* cut to the scrolling box, counted from the hand's own box: generous at the sides so the written line keeps its
           width, exact at the box's top and bottom */
        clipPath: at.clip
          ? `inset(${Math.max(-400, at.clip.top - (at.y - tip.y))}px -800px ${Math.max(-400, (at.y - tip.y + SIZE) - at.clip.bottom)}px -400px)`
          : undefined,
      }}
    >
      <Icon name={at.mark} size={SIZE} strokeWidth={1.6} />
      {/* a line written beside the hand, words only (decision 827), and said to a screen reader once, as it comes, rather
          than on every loop of the writing: the hand itself is only a picture of a press */}
      {at.say && (
        <span className="ck-cursor__line" style={{ left: SAY_AT.x, top: SAY_AT.y }}>
          <TypedSay text={at.say} />
          <span className="sr-only" role="status">{at.say}</span>
        </span>
      )}
    </span>,
    document.body,
  );
  return { node, tap, rest, stop };
}
