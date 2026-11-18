/* ══ THE PHONE'S POST, OPENED — ported from bauhly-v3 `pages/app/PostView.jsx` (decisions 781, 1015–1021) ═══════════
 * Pressing a post in the phone's Day feed opens it full size: the post travels from its place in the feed to the top
 * of the screen at the same width, its whole caption opens under it, the band (the app bar, the queue's row and the date
 * row) leaves upward as one piece and the tab bar goes down. Back and Edit float over the top as round discs and step
 * aside while the caption is read down. Back, Escape, or a swipe / drag / trackpad pull down at the top closes it, the
 * same travel in reverse, onto wherever the feed's post is.
 *
 * WHAT THIS REPLACES (DayFeed): the press that lifted a scaled copy of the post above a half caption sheet with a
 * corner pencil (`liftId`, `CaptionSheet`, `.yw-capedit`).
 *
 * One scroll, not two views (1021): the view has no ground of its own. While it is open the feed (`.ywf`) stands raised
 * by the post's travel, so its post lies exactly under the opened one; opening, closing and every frame of a drag move
 * the list and the post together. The opened caption's ground runs to the foot of the screen, so at rest nothing of the
 * list shows through.
 *
 * Not ported: the reference's Edit-into-the-Editor travel (1022–1024). Edit here hands over to the live Editor the way
 * the feed's other ways in do (`onEdit`).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../brand/Icon';
import { useBodyScrollLock } from './visualbrand/useBodyScrollLock';
import { useScrollHide } from '../hooks/useScrollHide';

const T = { in: 560, out: 440, ease: 'cubic-bezier(0.32, 0.72, 0, 1)' };
const still = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const CHROME = 'is-postview';
const MOVING = 'is-pv-moving';
let movingTimer = 0;
/* the band and the tab bar move on this view's clock while it opens or closes (1016) */
const moving = (ms) => {
  const root = document.documentElement;
  root.style.setProperty('--pv-dur', `${Math.round(ms)}ms`);
  root.style.setProperty('--pv-ease', T.ease);
  root.classList.add(MOVING);
  window.clearTimeout(movingTimer);
  movingTimer = window.setTimeout(() => {
    root.classList.remove(MOVING);
    root.style.removeProperty('--pv-dur');
    root.style.removeProperty('--pv-ease');
  }, Math.round(ms) + 60);
};

/* the band leaves as one piece (1019): one distance for all of it — its lowest edge on the screen, or the post's own
   travel when that is longer */
const bandTravel = (dy) => {
  let low = 0;
  document.querySelectorAll('.apptop, .gpill-slot, .ph--cal-feed .cal-bar').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height > 0) low = Math.max(low, r.bottom);
  });
  return Math.ceil(Math.max(dy, low));
};

/* the opened caption laid on the feed's (1017–1019): its top margin takes up any difference between the two layouts'
   post-to-caption distance (only ever growing), and `clip` is how much of its foot to clip so it starts showing only
   the lines the feed shows */
const alignCaption = (rest, fromEl, dy, shift = 0) => {
  const none = { clip: 0, lift: 0 };
  const feed = fromEl?.closest?.('.ywf__item')?.querySelector('.ywf__cap');
  const mine = rest.querySelector('.ywf__cap');
  if (!feed || !mine) return none;
  const f = feed.getBoundingClientRect();
  let m = mine.getBoundingClientRect();
  const delta = Math.round((f.top - shift - m.top) - dy);
  let lift = 0;
  if (delta) {
    const want = (parseFloat(mine.style.marginTop) || 0) + delta;
    const margin = Math.max(0, want);
    lift = want - margin;
    mine.style.marginTop = margin ? `${margin}px` : '';
    m = mine.getBoundingClientRect();
  }
  const r = rest.getBoundingClientRect();
  return { clip: Math.max(0, Math.round(r.bottom - (m.top + f.height))), lift };
};

export default function DayPostView({
  art, handle, caption, fromEl = null, closing = false, onClosed, onBack, onEdit,
}) {
  const closingRef = useRef(closing);
  closingRef.current = closing;
  const scrollRef = useRef(null);
  const artRef = useRef(null);
  const restRef = useRef(null);
  const barRef = useRef(null);
  const backRef = useRef(null);
  const feedEl = useRef(null);
  const shiftRef = useRef(0);
  const travelRef = useRef(0);
  const setShift = (px) => {
    shiftRef.current = px;
    const f = feedEl.current;
    if (f) f.style.translate = px ? `0 ${px}px` : '';
  };
  useBodyScrollLock();
  /* Back and Edit get out of the way as the caption is read down, back on the first move up */
  const away = useScrollHide({ travel: 64, from: 24, ref: scrollRef });

  /* ── IN ── everything held on its first frame as the view mounts, then started together two frames later (1018) */
  useLayoutEffect(() => {
    const root = document.documentElement;
    feedEl.current = fromEl?.closest?.('.ywf') || null;
    const artEl = artRef.current;
    const rest = restRef.current;
    const from = fromEl?.getBoundingClientRect?.();
    const to = artEl?.getBoundingClientRect?.();
    const dy = from && to ? Math.round(from.top - to.top) : 0;
    travelRef.current = dy;
    if (still()) {
      root.style.setProperty('--pv-band', `${bandTravel(0)}px`);
      setShift(-dy);
      root.classList.add(CHROME);
      backRef.current?.focus({ preventScroll: true });
      return undefined;
    }
    const { clip, lift } = rest ? alignCaption(rest, fromEl, dy) : { clip: 0, lift: 0 };
    const band = bandTravel(dy);
    const opts = { duration: T.in, easing: T.ease, fill: 'backwards' };
    setShift(-dy);
    const anims = [
      artEl?.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], opts),
      feedEl.current?.animate([{ translate: '0 0' }, { translate: `0 ${-dy}px` }], opts),
      rest?.animate([
        { transform: `translateY(${dy + lift}px)`, clipPath: `inset(0 0 ${clip}px 0)` },
        { transform: 'none', clipPath: 'inset(0 0 0px 0)' },
      ], opts),
      barRef.current?.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], opts),
    ].filter(Boolean);
    anims.forEach((x) => x.pause());
    let started = false;
    let f2 = 0;
    const go = () => {
      started = true;
      moving(T.in);
      root.style.setProperty('--pv-band', `${band}px`);
      root.classList.add(CHROME);
      anims.forEach((x) => x.play());
      backRef.current?.focus({ preventScroll: true });
    };
    const f1 = requestAnimationFrame(() => { f2 = requestAnimationFrame(go); });
    return () => {
      cancelAnimationFrame(f1);
      cancelAnimationFrame(f2);
      if (!started) { anims.forEach((x) => x.cancel()); setShift(0); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── OUT ── back onto the feed's post, held and started the same way */
  useEffect(() => {
    if (!closing) return undefined;
    const root = document.documentElement;
    const done = () => {
      fromEl?.focus?.({ preventScroll: true });
      onClosed?.();
    };
    if (still()) { setShift(0); root.classList.remove(CHROME); done(); return undefined; }
    const opts = { duration: T.out, easing: T.ease, fill: 'forwards' };
    const artEl = artRef.current;
    const rest = restRef.current;
    const from = fromEl?.getBoundingClientRect?.();
    const at = artEl?.getBoundingClientRect?.();
    const shiftNow = shiftRef.current;
    const home = from ? from.top - shiftNow : 0;
    const dy = from && at ? Math.round(home - at.top) : 0;
    const shiftFrom = from && at ? Math.round(shiftNow + (at.top - from.top)) : shiftNow;
    const { clip, lift } = rest ? alignCaption(rest, fromEl, dy, shiftNow) : { clip: 0, lift: 0 };
    const now = (el) => (el ? Number(getComputedStyle(el).opacity) : 1);
    const run = artEl?.animate([{ transform: 'none' }, { transform: `translateY(${dy}px)` }], opts);
    setShift(0);
    const anims = [
      run,
      feedEl.current?.animate([{ translate: `0 ${shiftFrom}px` }, { translate: '0 0' }], { ...opts, fill: 'backwards' }),
      rest?.animate([
        { transform: 'none', clipPath: 'inset(0 0 0px 0)' },
        { transform: `translateY(${dy + lift}px)`, clipPath: `inset(0 0 ${clip}px 0)` },
      ], opts),
      barRef.current?.animate([{ opacity: now(barRef.current) }, { opacity: 0 }], opts),
    ].filter(Boolean);
    if (!anims.length) { root.classList.remove(CHROME); done(); return undefined; }
    anims.forEach((x) => x.pause());
    let f2 = 0;
    const go = () => {
      moving(T.out);
      root.classList.remove(CHROME);
      anims.forEach((x) => x.play());
    };
    const f1 = requestAnimationFrame(() => { f2 = requestAnimationFrame(go); });
    const last = run || anims[0];
    last.onfinish = done;
    return () => {
      cancelAnimationFrame(f1);
      cancelAnimationFrame(f2);
      last.onfinish = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  /* the chrome comes back however this goes — an unmount without a close (Edit, a route change) included */
  useEffect(() => () => {
    const root = document.documentElement;
    root.classList.remove(CHROME);
    root.style.removeProperty('--pv-band');
    if (feedEl.current) feedEl.current.style.translate = '';
  }, []);

  /* ── A SWIPE DOWN IS BACK (1015, 1019) ── armed only with the layer at its top; a finger, a mouse drag or a trackpad
     pull. The post and the list follow together; past 110px (or a flick) it is Back, short of that it springs back.
     Moves up (the caption's scroll) and across (the carousel) are left alone. */
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return undefined;
    const atTop = () => sc.scrollTop <= 1;
    let d = null;
    const paint = (dy) => {
      sc.style.translate = dy ? `0 ${dy}px` : '';
      setShift(-travelRef.current + dy);
      barRef.current?.style.setProperty('--pv-pull', dy ? String(Math.min(1, dy / 110)) : '0');
    };
    const settle = (dy, v) => {
      if (dy > 110 || (v > 0.5 && dy > 24)) { onBackRef.current?.(); return; }
      if (still() || !dy) { paint(0); return; }
      const spring = { duration: 220, easing: T.ease };
      sc.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], spring);
      feedEl.current?.animate([{ translate: `0 ${-travelRef.current + dy}px` }, { translate: `0 ${-travelRef.current}px` }], spring);
      paint(0);
    };
    const begin = (x, y) => {
      if (closingRef.current || !atTop()) return;
      d = { x0: x, y0: y, claimed: false, on: false, dy: 0, v: 0, ly: y, lt: performance.now() };
    };
    const move = (x, y, e) => {
      if (!d) return;
      const dx = x - d.x0;
      const dyRaw = y - d.y0;
      if (!d.claimed) {
        if (!dx && !dyRaw) return;
        if (dyRaw > 0 && dyRaw >= Math.abs(dx) && atTop()) d.claimed = true;
        else { d = null; return; }
      }
      if (e.cancelable) e.preventDefault();
      if (!d.on) {
        if (Math.abs(dx) < 8 && Math.abs(dyRaw) < 8) return;
        if (dyRaw > Math.abs(dx) * 1.2) { d.on = true; d.y0 = y; } else { d = null; return; }
      }
      const t = performance.now();
      d.v = (y - d.ly) / Math.max(1, t - d.lt);
      d.ly = y;
      d.lt = t;
      d.dy = Math.max(0, y - d.y0);
      paint(d.dy);
    };
    const end = () => {
      if (!d) return;
      const { on, dy, v } = d;
      d = null;
      if (on) settle(dy, v);
    };
    let w = null;
    let wLast = 0;
    let wIdle = 0;
    const wheel = (e) => {
      if (closingRef.current) return;
      const now = performance.now();
      const fresh = now - wLast > 160;
      wLast = now;
      if (fresh) w = atTop() && e.deltaY < 0 ? { dy: 0 } : null;
      if (!w) return;
      e.preventDefault();
      w.dy = Math.max(0, w.dy - e.deltaY * 0.6);
      paint(w.dy);
      window.clearTimeout(wIdle);
      wIdle = window.setTimeout(() => {
        const pulled = w ? w.dy : 0;
        w = null;
        settle(pulled, 0);
      }, 160);
    };
    const noDrag = (e) => e.preventDefault();
    const ts = (e) => { const p = e.touches[0]; if (e.touches.length === 1) begin(p.clientX, p.clientY); else d = null; };
    const tm = (e) => { const p = e.touches[0]; if (p) move(p.clientX, p.clientY, e); };
    const pd = (e) => { if (e.pointerType === 'mouse' && e.button === 0) begin(e.clientX, e.clientY); };
    const pm = (e) => { if (e.pointerType === 'mouse') move(e.clientX, e.clientY, e); };
    const pu = (e) => { if (e.pointerType === 'mouse') end(); };
    sc.addEventListener('touchstart', ts, { passive: true });
    sc.addEventListener('touchmove', tm, { passive: false });
    sc.addEventListener('touchend', end);
    sc.addEventListener('touchcancel', end);
    sc.addEventListener('pointerdown', pd);
    sc.addEventListener('wheel', wheel, { passive: false });
    sc.addEventListener('dragstart', noDrag);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    return () => {
      window.clearTimeout(wIdle);
      sc.removeEventListener('touchstart', ts);
      sc.removeEventListener('touchmove', tm);
      sc.removeEventListener('touchend', end);
      sc.removeEventListener('touchcancel', end);
      sc.removeEventListener('pointerdown', pd);
      sc.removeEventListener('wheel', wheel);
      sc.removeEventListener('dragstart', noDrag);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !closingRef.current) onBackRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const text = String(caption || '').trim();
  return createPortal(
    <div className="ywpv" role="dialog" aria-modal="true" aria-label="Post">
      <div className="ywpv__scroll" ref={scrollRef}>
        <div className="ywpv__art ywf" ref={artRef}>{art}</div>
        <div className="ywpv__rest" ref={restRef}>
          {text ? (
            <p className="ywf__cap is-open">
              <b>{handle || 'account'}</b>
              {' '}
              {text}
            </p>
          ) : null}
        </div>
      </div>
      <div
        className="ywpv__bar"
        ref={barRef}
        style={{
          translate: `0 calc(${(-away).toFixed(3)} * (100% + 12px + env(safe-area-inset-top)))`,
          opacity: `calc(${(1 - away).toFixed(3)} * (1 - var(--pv-pull, 0)))`,
        }}
      >
        <button type="button" className="ywpv__disc" ref={backRef} onClick={onBack} tabIndex={away > 0.5 ? -1 : 0} aria-label="Back" title="Back">
          <Icon name="arrow-left" size={20} strokeWidth={1.9} />
        </button>
        <button type="button" className="ywpv__disc" onClick={onEdit} tabIndex={away > 0.5 ? -1 : 0} aria-label="Edit post" title="Edit">
          <Icon name="edit" size={20} strokeWidth={1.9} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
