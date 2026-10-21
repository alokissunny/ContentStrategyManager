/*
 * The phone's navigation — a floating bar, not a strip along the edge.
 *
 * WHAT THIS REPLACES (Leon, Oct 11, with the iOS reference)
 * ─────────────────────────────────────────────────────────────────────────
 * `.mtabs` as a full-width bar anchored to the bottom of the screen, with a
 * 78px disc straddling its top edge and a dome punched out of the background
 * by a hard-coded SVG data URI. Every number in that shape was solved by hand
 * for ONE arrangement: two destinations, one circular button, a `--notch`
 * written into the grid's column gap. Its own note says so — "THIS SHAPE
 * ASSUMES TWO DESTINATIONS" — and that is the thing being fixed here, because
 * the next section added to this product broke it.
 *
 * So the shape is COMPUTED rather than drawn. One `<path>`, generated from the
 * measured width of the bar and the measured width of the Capture button:
 * flat, a concave fillet, the stadium around Capture, the fillet again, flat,
 * and the two end caps. Any width, any number of destinations, any size of
 * Capture button — the curve stays tangent because tangency is solved rather
 * than tuned.
 *
 * WHAT IS REUSED, DELIBERATELY
 * `.mtabs` is still the class on the root. Five other files reach for it by
 * name — the queue host measures it to park above it, `yourweek.css` hides it
 * in focus mode, `checkin.css` in immersive, and two bulk bars stand it down —
 * and none of those relationships changed. The new styles hang off `.mnav`.
 * The scroll gesture is the shell's existing `navHidden`, applied to the same
 * two properties at the same travel.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../brand/Icon';
import Glyph from './Glyph';
import MobileSheet from './MobileSheet';
import './mobilenav.css';

/* ── THE SHAPE, IN NUMBERS (Leon, Oct 11) ───────────────────────────────────
 * Five lengths, and every other dimension in the bar falls out of them. They
 * are here rather than in the stylesheet because the path needs them as
 * numbers — a `calc()` cannot be read back out of CSS — and two copies of a
 * geometry is how a curve stops meeting the thing it curves around.
 * The stylesheet reads them back as custom properties (see `--mnav-*` set on
 * the root below), so there is still exactly one place they are written. */
const GEO = {
  /* ── A CONTROL ON THIS BAR ────────────────────────────────────────────
     "Minimum interactive touch target of 44 × 44 pt… comfortable internal
      padding and spacing between elements."
     Every button here is this box, Capture included: a 22pt mark over an
     11pt word with 4 between them is 37, so there are 6 and a half above
     and below. The HIG's floor is 44 and this clears it. */
  item: 50,
  /* the air between the pill's edge and a control, over and under */
  pad: 6,
  /* ── AND CAPTURE IS THE SAME BOX AS THE REST (Leon, Oct 11) ──────────
     "The Capture button is bigger than the rest, keep it same height, same
      paddings."
     So `lift` is 0 and Capture is `item` tall with `item`'s padding, sitting
     on `item`'s line — literally the same control, distinguished by its ink
     and nothing else.
     WHAT THIS COSTS, STATED: the swell in the bar's top edge. Its height is
     `lift − pad + gap`, so at 0 there is nothing standing above the flat top
     for the white to curve around and the silhouette is a plain pill (see
     the guard in `navPath`). That is not a thing that was removed — it is
     the same arithmetic reaching its floor, and the two cannot both be had:
     a raised edge needs something raised to follow.
     The machinery stays and the knob stays. A non-zero `lift` makes the
     button that much taller AT THE TOP ONLY, taken back as padding so the
     mark and the word never leave the line they share with their
     neighbours, and the swell comes back with it — one number, no other
     edit. 8 was the last value, and it bought 7px of curve. */
  lift: 0,
  /* the band of white between the button and the bar's edge, the whole way
     round. One number, because an even band is what makes the two read as
     one object rather than a button laid on a bar. */
  gap: 5,
  /* the concave sweep where the raised section rejoins the flat top — taste
     rather than arithmetic: too small and the junction reads as a kink, too
     large and the bar looks like it is melting. */
  fil: 20,
};
/* the pill, and the pill's top line in the box's own coordinates. Derived
   rather than typed: the box's top IS the apex of the swell, so where the
   flat top sits is a consequence of the other five numbers and not a sixth
   one that could disagree with them. */
/* `--navh` in app.css is `pill + top + 10` and seven stylesheets read it as
   "how much room the foot of a phone screen owes this bar". CHANGING `item`,
   `pad` OR `lift` MEANS CHANGING IT. */
GEO.pill = GEO.item + 2 * GEO.pad;
/* ...and never negative: with no lift the button sits inside the pill, so the
   pill's top line IS the box's, and a negative `top` would put the flat edge
   above the box that is supposed to contain it. */
GEO.top = Math.max(0, GEO.gap - GEO.pad + GEO.lift);

/* ── THE SILHOUETTE ─────────────────────────────────────────────────────────
 * y runs down from the apex of the raised section, which is y = 0 by
 * construction: the pill's top line sits at `rise + gap`, and the stadium
 * drawn around Capture is Capture's box grown by `gap` on every side, so its
 * apex is exactly `rise + gap` above that line.
 *
 * The fillet is the only piece with any work in it. It is a circle of radius
 * `fil` tangent to the flat top line from above and EXTERNALLY tangent to the
 * stadium's shoulder, which puts its centre on a circle of radius `rr + fil`
 * about the shoulder's centre and on the line `y = top − fil`. One right
 * triangle gives the horizontal offset; the two arcs then meet on the line
 * between the two centres, which is what tangency means and why the join has
 * no corner in it at any width.
 *
 * Kept in this file rather than exported: nothing else needs it, and a
 * second module would be a second place to look for the one thing that has
 * to agree with the button.
 */
function navPath({ w, h, cw, ch, ct, top, gap, fil }) {
  const R = Math.max(0, (h - top) / 2);
  const cx = w / 2;
  const hw = cw / 2 + gap;
  const rr = ch / 2 + gap;
  const Lx = cx - hw + rr;
  const Rx = cx + hw - rr;
  /* ── THE CURVE IS DRAWN FROM THE BUTTON, NOT FROM A NUMBER ABOUT IT ──
     `ct` is where the button's top ACTUALLY is, measured off the DOM — so a
     change to the row's padding, a longer label, a different font metric or
     a future change to how Capture is laid out moves the opening with it.
     The old dome could not do this: its coordinates were baked into a data
     URI, and the note above it had to warn that changing any of three
     numbers meant regenerating the path by hand.
     `ct - gap` is the apex of the stadium drawn round the button, and the
     apex is the box's own top — so in a bar laid out as intended it is 0. */
  const apex = ct - gap;
  const cy = apex + rr;
  const dy = top - fil - cy;
  /* a button that does not clear the line has no opening to make: draw the
     plain pill rather than a shape that folds through itself */
  if (apex >= top - 0.5 || dy > rr) return pillPath(w, h, top, R);
  const dx = Math.sqrt(Math.max(0, (rr + fil) ** 2 - dy ** 2));
  const xfL = Lx - dx;
  const xfR = Rx + dx;
  /* where fillet meets shoulder: `rr` of the way along the centre-to-centre
     line, since the two circles touch at exactly that point */
  const k = rr / (rr + fil);
  const ty = cy + (top - fil - cy) * k;
  const TLx = Lx + (xfL - Lx) * k;
  const TRx = Rx + (xfR - Rx) * k;
  const n = (v) => Math.round(v * 100) / 100;
  return [
    `M${n(R)} ${n(top)}`,
    `L${n(xfL)} ${n(top)}`,
    `A${n(fil)} ${n(fil)} 0 0 1 ${n(TLx)} ${n(ty)}`,
    `A${n(rr)} ${n(rr)} 0 0 1 ${n(Lx)} ${n(apex)}`,
    `L${n(Rx)} ${n(apex)}`,
    `A${n(rr)} ${n(rr)} 0 0 1 ${n(TRx)} ${n(ty)}`,
    `A${n(fil)} ${n(fil)} 0 0 1 ${n(xfR)} ${n(top)}`,
    `L${n(w - R)} ${n(top)}`,
    `A${n(R)} ${n(R)} 0 0 1 ${n(w - R)} ${n(h)}`,
    `L${n(R)} ${n(h)}`,
    `A${n(R)} ${n(R)} 0 0 1 ${n(R)} ${n(top)}`,
    'Z',
  ].join(' ');
}

function pillPath(w, h, top, R) {
  const n = (v) => Math.round(v * 100) / 100;
  return `M${n(R)} ${n(top)} L${n(w - R)} ${n(top)} A${n(R)} ${n(R)} 0 0 1 ${n(w - R)} ${n(h)} `
    + `L${n(R)} ${n(h)} A${n(R)} ${n(R)} 0 0 1 ${n(R)} ${n(top)} Z`;
}

/* ── FIVE SLOTS, AND CAPTURE OWNS THE MIDDLE ONE ───────────────────────────
 * "Do not redesign the navigation every time we introduce a new section."
 * So the arrangement is a function of the list rather than a layout somebody
 * drew: four destinations at most, split either side of Capture, and a `More`
 * in the last slot the moment there is a fifth.
 *
 * The two sides carry the SAME number of slots even when the counts differ —
 * three destinations is two and one, and the spare slot is left empty at the
 * outer end. That is what keeps Capture on the bar's centre line, which the
 * path depends on: the shape is drawn about `w / 2`, so anything that moves
 * the button off centre moves it out of its own opening.
 */
const MAX_VISIBLE = 4;

function split(items) {
  const over = items.length > MAX_VISIBLE;
  const shown = over ? items.slice(0, MAX_VISIBLE - 1) : items;
  const rest = over ? items.slice(MAX_VISIBLE - 1) : [];
  const left = shown.slice(0, Math.ceil(shown.length / 2));
  const right = shown.slice(left.length);
    /* `more`, which is this product's own name for the glyph — `Icon` returns
     null for a name it does not know, so a guessed one is an empty slot
     rather than an error (MEASURED: `more-horizontal` drew nothing) */
  if (over) right.push({ more: true, icon: 'more', label: 'More' });
  const slots = Math.max(left.length, right.length, 1);
  return { left, right, rest, slots };
}

/* NavLink decides this for itself, and the pip needs the same answer one
   frame earlier than the DOM can give it — so it is asked the same way
   `react-router` asks it: an `end` link matches exactly, any other matches
   its own path or anything under it. */
/* live app: a destination without a brand mark (`glyph`) draws its Lucide
   glyph instead, unfilled either way — see DashboardLayout */
const mark = (n, on, size) => (n.glyph
  ? <Glyph name={n.glyph} size={size} strokeWidth={on ? 2 : 1.6} />
  : <Icon name={on ? `${n.icon}-fill` : n.icon} size={size} />);

const hits = (path, item) => (item.end
  ? path === item.to
  : path === item.to || path.startsWith(`${item.to}/`));

/* ── AND ON A PHONE IT IS ONE WORD (Leon, Oct 11) ──────────────────────────
 * "Use only Capture, rather than Capture idea, in mobile."
 * WHAT THIS NARROWS: `Capture idea`, which is what the sidebar's button says
 * and what this one said with it so the two widths could not drift.
 * They can differ here because the ROW is the context: on a phone the word
 * sits under a mark, between two other words under two other marks, and the
 * three are read as one line — `Capture idea` is half again the length of
 * `Calendar` and `Captures` and was the only one of the three that was a
 * phrase. The sidebar's button stands alone in a column with room for a
 * sentence, and keeps it.
 * It is the default rather than a value passed from the shell, so the phone's
 * word is stated once, here, beside the bar that has to fit it. */
export default function MobileNav({ items, onCapture, captureLabel = 'Capture', hidden = 0 }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const root = useRef(null);
  const row = useRef(null);
  const cap = useRef(null);
  const [box, setBox] = useState({ w: 0, cw: 0, ch: 0, ct: 0 });
  const [pip, setPip] = useState(null);
  const [more, setMore] = useState(false);
  /* ── WHAT GIVES WAY, AND IN WHAT ORDER (MEASURED, Oct 11) ─────────────
     "Never allow buttons to overflow, wrap, overlap, or shrink excessively."
     Decided by measurement, not by a breakpoint. The bar hugs its contents
     (`width: fit-content`), so the single moment something cannot be
     afforded is the moment the bar stops growing and meets its cap — which
     is exactly `scrollWidth > clientWidth` on the row.
     Three rungs, each tried only when the one above it was not enough:
       0 · everything has its word
       1 · the destinations lose theirs, Capture keeps its own
       2 · Capture loses its word too
     Rung 2 exists because rung 1 was not sufficient and I found that by
     MEASURING rather than by reasoning: five destinations on a 320px screen
     need 347px icons-only against a 296px cap, and the `More` button ended
     up at x 333 — off the glass entirely, which is the exact failure the
     brief names.
     Each rung only ever SHRINKS the row, so the test cannot oscillate: it is
     reset to 0 whenever something that could change the answer changes, and
     the layout effect walks back down before paint. */
  const [fit, setFit] = useState(0);
  /* ── AND THE RE-CHECK NEEDS ITS OWN REASON TO HAPPEN (MEASURED, Oct 11)
     `setFit(0)` when `fit` is already 0 is not a render, so a viewport
     change that left the bar's own width alone never re-ran the test below
     — MEASURED at 320 with the bar clamped to 296 and the row needing 305:
     `fit` stayed 0 and 9px hung off the end. The window changing IS one of
     the things that can change the answer, so it says so in its own value
     rather than hiding inside a `setState` that may be a no-op. */
  const [tick, setTick] = useState(0);
  /* no transition on the FIRST placement: a pip that slides in from x=0 on
     mount is an animation about nothing, and it is the first thing a studio
     would see on every cold open */
  const placed = useRef(false);

  const { left, right, rest, slots } = useMemo(() => split(items), [items]);

  /* ── WHAT THE BAR MEASURES, AND WHY IT MEASURES IT ────────────────────
     Two numbers feed the path — the bar's width and Capture's width — and
     both are decided by content and viewport rather than by us: the label
     inside Capture is a string from the shell, and the bar is as wide as its
     slots until the screen says otherwise. A ResizeObserver on each is the
     only honest source. */
  useLayoutEffect(() => {
    const el = root.current;
    const btn = cap.current;
    if (!el || !btn) return undefined;
    const read = () => {
      const a = el.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      /* ── THE BUTTON IS MEASURED WHOLE (MEASURED, Oct 11) ─────────────
         Height as well as width and offset, and this is the pass that
         earned it: a `height` declaration lost in an edit left the button
         17px tall while the path was still drawn from `GEO.cap` — an
         opening made for a 46px button with a 17px button inside it. The
         path cannot read a number that is wrong about the DOM if it reads
         the DOM. */
      const next = { w: a.width, cw: b.width, ch: b.height, ct: b.top - a.top };
      setBox((prev) => (['w', 'cw', 'ch', 'ct'].every((k) => Math.abs(prev[k] - next[k]) < 0.5)
        ? prev : next));
    };
    read();
    /* ── AND THIS OBSERVER DOES NOT TOUCH THE LADDER (Oct 11) ────────
       It watches the BAR, and the bar's width is what the ladder changes —
       so resetting `fit` from here is a loop with a step in it: rung 1
       narrows the bar, the observer sees a new width, the rung goes back to
       0, the row overflows again, rung 1 narrows the bar. The ladder may
       only be reset by something it cannot itself move, which is the
       viewport (below). */
    const ro = new ResizeObserver(read);
    ro.observe(el);
    ro.observe(btn);
    return () => ro.disconnect();
  }, [items, captureLabel]);

  /* the selection's ground, measured off the item it belongs to rather than
     computed from a column width — the items are not all the same width (a
     label decides that) and the brief asks the indicator to take the size of
     the thing it is under */
  const place = useCallback(() => {
    const host = row.current;
    if (!host) return;
    const on = host.querySelector('.mnav__item.is-active');
    if (!on) { setPip(null); return; }
    const h = host.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    setPip({ x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height });
  }, []);

  /* before paint, so a word is never seen arriving and leaving */
  useLayoutEffect(() => {
    const host = row.current;
    if (!host || fit >= 2) return;
    if (host.scrollWidth > host.clientWidth + 1) setFit(fit + 1);
    /* `fit` is in the list, so each rung's own render runs this again and
       the walk continues until it fits or runs out of rungs — which is why
       this is not the unbounded `setState` in a layout effect it looks
       like. `box` and `items` are the other two things that can change the
       answer. */
    /* Every value that can change the answer is listed: the rung itself, so
       each one's render walks to the next; the measured box; the window, via
       `tick`; and the list of destinations. That is why this is not the
       unbounded `setState` in a layout effect it reads as — the walk only
       ever goes up, and it stops at 2. */
  }, [fit, tick, box, items]);

  /* ── AND THE LADDER IS CLIMBED BACK UP (MEASURED, Oct 11) ────────────
     The observer above watches the BAR, and at the tightest rung the bar is
     the same width on a 320px screen as on a 430px one — it is under its cap
     either way — so nothing fired and the words never came back. MEASURED:
     rotated to 430, still `fit: 2` with 143px of room going spare.
     The window is what changed, so the window is what has to say so. */
  useEffect(() => {
    /* ── AND ONLY THE WIDTH COUNTS (Leon, Oct 11) ────────────────────
       The root's HEIGHT changes constantly on a feed — every image that
       lands moves it — and each change was re-rendering this bar for a
       number it does not use. The ladder is about horizontal room, so the
       last width seen is the gate: height alone is not an answer that can
       have changed. */
    let was = window.innerWidth;
    const again = () => { setFit(0); setTick((t) => t + 1); };
    const maybe = () => {
      if (window.innerWidth === was) return;
      was = window.innerWidth;
      again();
    };
    /* the root element rather than the event alone: a viewport that changes
       without firing `resize` is not hypothetical — MEASURED in the preview
       pane, where `innerWidth` went 320 → 430 and no event came, and the bar
       sat on the narrow rung with 143px going spare. The root's own size
       cannot be moved by the ladder, so this is safe to reset from. */
    const ro = new ResizeObserver(maybe);
    ro.observe(document.documentElement);
    window.addEventListener('resize', maybe);
    window.addEventListener('orientationchange', again);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', maybe);
      window.removeEventListener('orientationchange', again);
    };
  }, []);

  useLayoutEffect(() => { place(); }, [place, pathname, box, slots, fit]);
  useEffect(() => {
    /* a web font landing changes a label's width, and with it the pip's */
    if (!document.fonts?.ready) return undefined;
    let live = true;
    document.fonts.ready.then(() => { if (live) place(); });
    return () => { live = false; };
  }, [place]);
  useEffect(() => {
    const t = window.setTimeout(() => { placed.current = true; }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const { top } = GEO;
  const h = GEO.pill + top;
  const d = box.w > 0 && box.cw > 0
    ? navPath({ w: box.w, h, cw: box.cw, ch: box.ch, ct: box.ct, top, gap: GEO.gap, fil: GEO.fil })
    : null;

  const item = (n, i) => {
    if (!n) return <span key={`gap-${i}`} className="mnav__slot" aria-hidden="true" />;
    if (n.more) {
      const on = rest.some((r) => hits(pathname, r));
      return (
        <button
          key="more"
          type="button"
          className={`mnav__item ${on ? 'is-active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={() => setMore(true)}
        >
          <Icon name={n.icon} size={22} />
          <span className="mnav__name">{n.label}</span>
        </button>
      );
    }
    return (
      <NavLink
        key={n.to}
        to={n.to}
        end={n.end}
        className={({ isActive }) => `mnav__item ${isActive ? 'is-active' : ''}`}
      >
        {({ isActive }) => (
          <>
            {/* the destination you are on is drawn filled — the same pair of
                glyphs the sidebar swaps between, unchanged (Leon, Sep 30) */}
            {mark(n, isActive, 22)}
            <span className="mnav__name">{n.label}</span>
          </>
        )}
      </NavLink>
    );
  };

  const side = (list) => Array.from({ length: slots }, (_, i) => list[i] || null);

  return (
    <>
      <nav
        ref={root}
        className="mtabs mnav"
        aria-label="Main"
        data-fit={fit}
        style={{
          /* the three lengths the stylesheet needs, published from the one
             place they are written. `rise`, `top` and the slot count stay in
             JS: the path needs them and nothing in CSS does, and a custom
             property nobody reads is a number waiting to drift. */
          '--mnav-h': `${h}px`,
          '--mnav-pill': `${GEO.pill}px`,
          '--mnav-item': `${GEO.item}px`,
          '--mnav-lift': `${GEO.lift}px`,
          '--mnav-gap': `${GEO.gap}px`,
          transform: `translate(-50%, ${hidden * 175}%)`,
          opacity: 1 - hidden,
        }}
      >
        {/* the bar's whole surface: fill, hairline and lift are this one
            path's, so there is no box whose edges could disagree with it */}
        <svg className="mnav__shape" viewBox={`0 0 ${box.w || 1} ${h}`} aria-hidden="true" focusable="false">
          {d && <path d={d} />}
        </svg>
        <div className="mnav__row" ref={row}>
          {pip && (
            <span
              className={`mnav__pip ${placed.current ? '' : 'is-set'}`}
              aria-hidden="true"
              style={{
                transform: `translate(${pip.x}px, ${pip.y}px)`,
                width: `${pip.w}px`,
                height: `${pip.h}px`,
              }}
            />
          )}
          <div className="mnav__side">{side(left).map(item)}</div>
          {/* ── CAPTURE IS IN THE ROW, NOT OVER IT (Leon, Oct 11) ────────
              "The Capture button should feel integrated into the navbar, not
               like a separate floating action button."
              Which is a layout statement before it is a visual one: it is a
              grid cell between the two sides, so the bar is as wide as its
              contents and Capture's centre IS the bar's centre. The old disc
              was positioned absolutely at `left: 50%`, which is the same
              place by arithmetic and a different thing by construction —
              nothing made the two agree, and a label long enough to widen
              one of them would have moved the opening off the button. */}
          {/* ── AND IT IS AN ITEM, WEARING THE INK ────────────────────────
              Same class as the destinations, so the box, the padding, the
              mark and the word are literally the same rules — `--cap` only
              adds the fill, the white ink and the lift. A copy of those
              numbers under a second name is how the one control that has to
              match the others stops matching them. */}
          <button ref={cap} type="button" className="mnav__item mnav__cap" onClick={onCapture}>
            {/* the same mark at the same size as every other on this bar —
                heavier in the stroke only, because a plus drawn at a
                destination glyph's weight reads as a hairline on ink */}
            <Icon name="plus" size={22} strokeWidth={2.2} />
            {/* `mnav__name` for the type, `mnav__capname` purely as the
                hook rung 2 hides it by — same word, same size, same weight
                as every other on the bar */}
            <span className="mnav__name mnav__capname">{captureLabel}</span>
          </button>
          <div className="mnav__side">{side(right).map(item)}</div>
        </div>
      </nav>
      {/* ── AND THE FIFTH SECTION ONWARDS LIVES IN A SHEET ───────────────
          The product's own sheet, with the product's own menu rows — a
          second list style for the same job is how two menus stop matching. */}
      {rest.length > 0 && (
        <MobileSheet open={more} title="More" onClose={() => setMore(false)}>
          <div className="msheet__menu" role="menu">
            {rest.map((n) => (
              <button
                key={n.to}
                type="button"
                role="menuitem"
                className={`msheet__opt ${hits(pathname, n) ? 'is-on' : ''}`}
                onClick={() => { setMore(false); navigate(n.to); }}
              >
                {mark(n, hits(pathname, n), 19)}
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        </MobileSheet>
      )}
    </>
  );
}
