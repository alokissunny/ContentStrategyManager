/*
 * Phone Day feed — every scheduled post in one vertical scroll (bauhly-v3 `.ywf`).
 * The date in the toolbar is whichever item sits in the middle of the screen.
 *
 * List posts omit `content` (lite). Each item is enriched via GET /posts/:id so
 * DynamicLayout gets layoutHtml / slides — the same paint as WeekView.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { DayPeek, feedBoxAr } from './weekview/PostPeek';
import DayPostView from './DayPostView';
import { getPost, schedulePost, setPostReview, setPostTime, shiftPosts } from '../api/posts';
import MobileSheet from '../components/MobileSheet';

function isoOf(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    const s = String(date).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function captionOf(day) {
  const c = day?.content;
  const raw = String(c?.caption || c?.cta || day?.direction || day?.title || '').trim();
  return raw;
}

// Parse any time string ("9:00 AM", "07:30", "7 pm") into 24h "HH:MM" — the
// same parsing WeekView uses, so the two views name the same hour.
function to24h(t) {
  const m = String(t || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return '09:00';
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  h = Math.min(23, Math.max(0, h));
  return `${String(h).padStart(2, '0')}:${String(Math.min(59, Math.max(0, min))).padStart(2, '0')}`;
}

// The post's hour. A scheduled post carries a full timestamp; an unscheduled
// one carries a slot time string (day.time / postAtPref), which is what the
// desktop WeekView reads too (see slotTimeRaw). Never empty — it defaults to
// 09:00 exactly as the desktop does, so the feed no longer falls back to a
// wrong "Not scheduled" for a post that has a real slot time.
function clockOf(day, route) {
  const at = day?.scheduledAt || day?.publishAt;
  if (at) {
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  return to24h(day?.time || route?.postAtPref || day?.postAtPref || day?.bestTime || '09:00');
}

function hasRenderableSlides(day) {
  if (String(day?.content?.carouselHtml || '').trim()) return true;
  const slides = day?.content?.slides;
  if (!Array.isArray(slides) || !slides.length) return false;
  return slides.some((s) => String(s?.layoutHtml || '').trim()
    || String(s?.title || s?.words || '').trim()
    || String(s?.assetKey || '').trim());
}

/* ── The schedule chip's sheet (bauhly-v3 YourWeek SchedMenu on a phone) ────
 * "Scheduling": Schedule ↔ Unschedule, Mark for review ↔ Clear review, and
 * Change time — a level of its own with the date and the time. Each row names
 * what pressing it produces, so the post is never in a state the sheet has no
 * word for. Open the post leads into the editor (the chip used to do only that). */
function SchedSheet({ open, day, iso, clock, metaConnected, onClose, onPatched, onOpenPost }) {
  const [level, setLevel] = useState(null); // null | 'time'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [date, setDate] = useState(iso);
  const [time, setTime] = useState(clock);
  useEffect(() => {
    if (open) { setLevel(null); setErr(''); setDate(iso); setTime(clock); }
  }, [open, iso, clock]);
  const id = String(day?._id || '');
  const out = !!day?.published;
  const set = !!day?.scheduledAt && !out;
  const review = !!day?.savedForReview;
  const run = async (fn, close = true) => {
    if (!id || busy) return;
    setBusy(true);
    setErr('');
    try {
      const next = await fn();
      if (next?._id) onPatched(next);
      if (close) onClose();
    } catch (e) {
      setErr(e?.response?.data?.message || 'That did not go through — try again.');
    } finally {
      setBusy(false);
    }
  };
  const slotIso = (d, t) => new Date(`${d}T${t || '09:00'}:00`).toISOString();
  const saveTime = () => run(async () => {
    if (date && date !== iso) await shiftPosts({ [id]: date }, { from: date, to: date });
    let next = await setPostTime(id, time);
    if (set) next = await schedulePost(id, slotIso(date || iso, time));
    return (await getPost(id).catch(() => null)) || next;
  });

  return (
    <MobileSheet
      open={open}
      title={level === 'time' ? 'Change time' : 'Scheduling'}
      onBack={level ? () => setLevel(null) : null}
      onClose={onClose}
      className="schedm--sheet"
      // the reference's head: the title on the left, a round × on the right;
      // a level below the root keeps its ‹ back on the left
      nav={Boolean(level)}
      actions={(
        <button type="button" className="msheet__nav ywf-sched__x" onClick={onClose} aria-label="Close">
          <Icon name="x" size={20} strokeWidth={2.25} />
        </button>
      )}
    >
      {level === 'time' ? (
        <div className="schedm schedm--sheet ywf-sched__time">
          <p className="schedm__lead">Pick a different date and time.</p>
          <label className="ywf-sched__field">
            <span>Date</span>
            <input type="date" value={date} min={isoOf(new Date())} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="ywf-sched__field">
            <span>Time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          {err && <p className="ywf-sched__err" role="alert">{err}</p>}
          <button type="button" className="btn btn--primary ywf-sched__save" disabled={busy || !date || !time} onClick={saveTime}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <div className="msheet__menu schedm schedm--sheet" role="menu">
          {out ? null : set ? (
            <button type="button" role="menuitem" className="schedm__row" disabled={busy} onClick={() => run(() => schedulePost(id, null))}>
              <Icon name="calendar" size={17} strokeWidth={1.9} />
              <span className="schedm__text">
                <b>Unschedule</b>
                <em>Take it off the calendar; nothing else changes</em>
              </span>
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="schedm__row"
              disabled={busy}
              onClick={() => (metaConnected ? run(() => schedulePost(id, slotIso(iso, clock))) : (onClose(), onOpenPost()))}
            >
              <Icon name="calendar" size={17} strokeWidth={1.9} />
              <span className="schedm__text">
                <b>Schedule</b>
                <em>{metaConnected ? 'Publish to Meta at the selected time' : 'Connect Meta to publish automatically'}</em>
              </span>
            </button>
          )}
          {!out && (review ? (
            <button type="button" role="menuitem" className="schedm__row" disabled={busy} onClick={() => run(() => setPostReview(id, false))}>
              <Icon name="eye" size={17} strokeWidth={1.9} />
              <span className="schedm__text">
                <b>Clear review</b>
                <em>Take the hold off — nothing else about the post changes</em>
              </span>
            </button>
          ) : (
            <button type="button" role="menuitem" className="schedm__row" disabled={busy} onClick={() => run(() => setPostReview(id, true))}>
              <Icon name="eye" size={17} strokeWidth={1.9} />
              <span className="schedm__text">
                <b>Mark for review</b>
                <em>Prepared, but held until you check it</em>
              </span>
            </button>
          ))}
          {!out && (
            <button type="button" role="menuitem" className="schedm__row" disabled={busy} onClick={() => setLevel('time')}>
              <Icon name="clock" size={17} strokeWidth={1.9} />
              <span className="schedm__text">
                <b>Change time</b>
                <em>Set a different date and time</em>
              </span>
              <Icon name="chevron-right" size={16} strokeWidth={2.1} className="schedm__more" />
            </button>
          )}
          <button type="button" role="menuitem" className="schedm__row" onClick={() => { onClose(); onOpenPost(); }}>
            <Icon name="edit" size={17} strokeWidth={1.9} />
            <span className="schedm__text">
              <b>Open the post</b>
              <em>Slides, caption and layout</em>
            </span>
          </button>
          {err && <p className="ywf-sched__err" role="alert">{err}</p>}
        </div>
      )}
    </MobileSheet>
  );
}

function FeedItem({ row, handle, metaConnected, onOpen, enriched, loading, onPatched, opened = false, onView }) {
  const [schedOpen, setSchedOpen] = useState(false);
  const day = enriched || row.day;
  const iso = isoOf(row.date || day?.date);
  const caption = captionOf(day);
  const [more, setMore] = useState(false);
  const long = caption.length > 120;
  const shown = more || !long ? caption : `${caption.slice(0, 110).trim()}…`;
  const who = String(handle || day?.instagramUsername || '').replace(/^@/, '');
  const clock = clockOf(day, row.week);
  const out = !!day?.published;
  const set = metaConnected && !!day?.scheduledAt && !out;
  // Same sentence at every width (bauhly-v3): a scheduled post reads
  // "Scheduled for HH:MM", an unscheduled one offers "Schedule for HH:MM" —
  // never a bare "Not scheduled" when the desktop shows a time.
  const schedLabel = out
    ? 'Published'
    : set
      ? `Scheduled for ${clock}`
      : day?.savedForReview
        ? `Needs review · ${clock}`
        : `Schedule for ${clock}`;
  /* List rows have no content — wait for GET /posts/:id before painting. */
  const ready = Boolean(enriched && (hasRenderableSlides(enriched) || enriched.content));

  /* Only the posts near the screen are drawn. Each drawn slide is a whole
     carousel document with its photos; a feed that kept every post it had
     scrolled past drawn ran the phone's web view out of memory, and iOS then
     restarts it (the app "refreshes"). A post far away keeps the exact room it
     took, so nothing on screen moves when it is let go or drawn again. */
  const mediaRef = useRef(null);
  const [near, setNear] = useState(true);
  const [heldH, setHeldH] = useState(0);
  useEffect(() => {
    const el = mediaRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        const h = Math.round(el.getBoundingClientRect().height);
        if (h) setHeldH(h);
      }
      setNear(entry.isIntersecting);
    }, { rootMargin: '150% 0px 150% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const drawn = ready && (near || opened);

  return (
    <article className="ywf__item" data-iso={iso}>
      <header className="ywf__head">
        <span className="ywf__who">
          <span className="ywf__avatar" aria-hidden="true" />
          <span className="ywf__whotext">
            <b>{who || 'account'}</b>
          </span>
        </span>
        <button
          type="button"
          className={`ywf__sched${set || out ? ' is-set' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={schedOpen}
          onClick={() => setSchedOpen(true)}
        >
          <Icon name="clock" size={14} strokeWidth={2.25} />
          <span>{schedLabel}</span>
          <Icon name="chevron-down" size={14} strokeWidth={2.1} />
        </button>
      </header>

      {/* Pressing the picture opens it full size (bauhly-v3 FeedPost →
          PostView, decision 781): the post travels to the top of the screen
          with its whole caption under it (DayPostView). */}
      <div
        ref={mediaRef}
        className="ywf__media"
        role={ready ? 'button' : undefined}
        tabIndex={ready ? 0 : undefined}
        aria-label={ready ? 'Open this post' : undefined}
        aria-expanded={ready ? opened : undefined}
        onClick={ready ? () => onView?.(mediaRef.current) : undefined}
        onKeyDown={ready ? (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          onView?.(mediaRef.current);
        } : undefined}
      >
        <div className="ywf__frame">
          {drawn ? (
            <DayPeek key={String(enriched._id)} day={enriched} feed />
          ) : ready && heldH ? (
            <div className="ywf__skel" style={{ height: `${heldH}px` }} aria-hidden="true" />
          ) : (
            /* the same room the post will take — box and, for a carousel,
               its dots — so nothing below moves when it arrives */
            <div aria-hidden="true">
              <div
                className={`ywf__skel${loading ? ' is-loading' : ''}`}
                // DayPeek draws the post at the window's width, not the column's
                style={{ height: `calc(100vw / ${feedBoxAr(day?.format)})` }}
              >
                {loading ? <span className="ywf__skel-spin" /> : null}
              </div>
              {/^carousel/i.test(String(day?.format || 'Carousel')) && <div className="ywf__skel-dots" />}
            </div>
          )}
        </div>
      </div>

      <SchedSheet
        open={schedOpen}
        day={day}
        iso={iso}
        clock={clock}
        metaConnected={metaConnected}
        onClose={() => setSchedOpen(false)}
        onPatched={onPatched}
        onOpenPost={() => onOpen?.(row)}
      />

      {!ready ? (
        /* a loading post's caption, held at the room a shortened one takes */
        <p className="ywf__cap ywf__cap--hold" aria-hidden="true" />
      ) : caption ? (
        <p className="ywf__cap">
          <b>{who || 'account'}</b>
          {' '}
          {shown}
          {long && !more && (
            <button type="button" className="ywf__more" onClick={(e) => { e.stopPropagation(); setMore(true); }}>
              Show more
            </button>
          )}
        </p>
      ) : null}
    </article>
  );
}

/* The feed's full posts outlive the feed: opening a post's Editor unmounts
 * it, and coming back to skeletons meant every post above the one just edited
 * changed height under the scroll. The cache paints them at once; each mount
 * still refreshes them in the background (an edit may have changed one). */
const FEED_CACHE = new Map();

/* How far down the sticky date bar reaches — a post placed "at the top" sits
 * under it, not behind it. */
function stickyBottom() {
  const bar = document.querySelector('.ph--cal-feed .cal-bar');
  return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
}
function feedYOf(el) {
  return Math.max(0, Math.round(window.scrollY + el.getBoundingClientRect().top - stickyBottom()));
}

/**
 * Infinite-scroll day feed for phones. `items` are `{ week, day, date }` rows
 * sorted by date. `onIso` reports which post is centred so the toolbar date
 * can follow the scroll.
 */
export default function DayFeed({
  items,
  handle,
  metaConnected,
  onOpen,
  onIso,
  scrollToIso,
  onPatchPost,
}) {
  const listRef = useRef(null);
  const [fullById, setFullById] = useState(() => new Map(FEED_CACHE));
  // ids refreshed by THIS mount (the cache's copies are painted, then refreshed)
  const fetchedRef = useRef(new Set());
  const pendingRef = useRef(0);
  const [pending, setPending] = useState(() => new Set());
  // the post opened full size: { id, fromEl, closing }
  const [pv, setPv] = useState(null);
  const pvRef = useRef(null);
  pvRef.current = pv;
  const rowsKey = useMemo(
    () => (items || []).map((r) => String(r?.day?._id || '')).filter(Boolean).join(','),
    [items],
  );
  const rows = useMemo(
    () => (items || []).filter((r) => r?.day && r?.date).sort((a, b) => a.date - b.date),
    [items],
  );

  useEffect(() => {
    let cancelled = false;
    // marked as this mount's, and un-marked if this run is cancelled first
    // (StrictMode runs it twice; the second run must still fetch)
    const mine = new Set();
    // nearest the day being jumped to first, so the post landed on (and the
    // ones round it) are drawn before the far ends of the feed
    const aim = String(scrollToIso || '').split('#')[0];
    const at = aim ? rows.findIndex((r) => isoOf(r.date || r.day?.date) === aim) : -1;
    const todo = rows
      .map((r, i) => ({ id: String(r.day?._id || ''), d: at < 0 ? i : Math.abs(i - at) + (i < at ? 0.5 : 0) }))
      .filter((r) => r.id)
      .sort((a, b) => a.d - b.d)
      .map((r) => r.id);

    const load = async () => {
      const need = todo.filter((id) => !fetchedRef.current.has(id));
      if (!need.length) return;
      need.forEach((id) => { fetchedRef.current.add(id); mine.add(id); });

      // only the ones with nothing to show yet draw as loading
      setPending((prev) => {
        const next = new Set(prev);
        need.forEach((id) => { if (!fullById.has(id)) next.add(id); });
        return next;
      });

      for (let i = 0; i < need.length; i += 6) {
        if (cancelled) return;
        const batch = need.slice(i, i + 6);
        const got = await Promise.all(batch.map(async (id) => {
          try { return await getPost(id); } catch { return null; }
        }));
        if (cancelled) return;
        setFullById((prev) => {
          const next = new Map(prev);
          got.forEach((p) => { if (p?._id) next.set(String(p._id), p); });
          return next;
        });
        batch.forEach((id) => mine.delete(id));
        setPending((prev) => {
          const next = new Set(prev);
          batch.forEach((id) => next.delete(id));
          return next;
        });
      }
    };

    load();
    return () => {
      cancelled = true;
      mine.forEach((id) => fetchedRef.current.delete(id));
    };
    // rowsKey identity — avoid depending on fullById (grows every batch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey]);

  useEffect(() => {
    const box = listRef.current;
    if (!box || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((r) => seen.set(r.target, r.isIntersecting));
      // the list moves under an opened post: that is not the studio scrolling (bauhly-v3 decision 1021)
      if (pvRef.current) return;
      const first = [...box.querySelectorAll('.ywf__item')].find((el) => seen.get(el));
      if (first) onIso?.(first.getAttribute('data-iso'));
    }, { root: null, rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    box.querySelectorAll('.ywf__item').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rows, onIso, fullById]);

  useEffect(() => {
    fullById.forEach((v, k) => FEED_CACHE.set(k, v));
  }, [fullById]);

  /* Scroll anchoring, which iOS Safari does not do: a post that changes height
     wholly above the screen (it finished loading, a caption opened) would push
     everything on screen down — so the page is moved by the same amount and
     what the studio is looking at stays put. */
  useEffect(() => {
    const box = listRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const was = new WeakMap();
    const ro = new ResizeObserver((entries) => {
      let shift = 0;
      const top = stickyBottom();
      entries.forEach((entry) => {
        const el = entry.target;
        const h = el.getBoundingClientRect().height;
        const before = was.get(el);
        was.set(el, h);
        if (before === undefined || Math.abs(h - before) < 0.5) return;
        if (el.getBoundingClientRect().bottom <= top + 1) shift += h - before;
      });
      if (shift) window.scrollBy(0, shift);
    });
    const watch = () => box.querySelectorAll('.ywf__item').forEach((el) => {
      if (!was.has(el)) { was.set(el, el.getBoundingClientRect().height); ro.observe(el); }
    });
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(box, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);
  pendingRef.current = pending.size;

  /* Jump to a post, under the sticky date bar. The post's place is read again
   * every frame — posts above it are still arriving and growing, and the top
   * bar slides away on the way down — so the travel steers onto where the
   * post IS, not where it was when the jump began. A far jump cuts straight to
   * within a screen of it and glides the rest (no drawing every post on the
   * way). Once there it is held while the feed settles — posts still loading
   * round it, or the Editor's scroll lock restoring an old position — until it
   * has been still for a moment, or the studio touches the screen.
   * `iso#pin#…` (the way back from the Editor) lands without any travel. */
  useLayoutEffect(() => {
    if (!scrollToIso || !listRef.current) return undefined;
    const [iso, mode] = String(scrollToIso).split('#');
    const find = () => listRef.current?.querySelector(`.ywf__item[data-iso="${iso}"]`);
    const el = find();
    if (!el) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const glide = mode !== 'pin' && !reduce;
    const GLIDE_MS = 380;
    const ease = (t) => 1 - (1 - t) ** 3;

    let raf = 0;
    let done = false;
    const evs = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    const stop = () => {
      if (done) return;
      done = true;
      window.cancelAnimationFrame(raf);
      evs.forEach((ev) => window.removeEventListener(ev, stop));
    };

    // a far jump starts a screen short of the post, on the side it comes from
    const target0 = feedYOf(el);
    const span = window.innerHeight * 0.9;
    let from = window.scrollY;
    if (!glide) from = target0;
    else if (Math.abs(target0 - from) > span) from = target0 - Math.sign(target0 - from) * span;
    window.scrollTo(0, from);

    const start = performance.now();
    let stillSince = start;
    const tick = () => {
      if (done) return;
      const now = performance.now();
      const e = find();
      if (e) {
        const y = feedYOf(e);
        const t = glide ? Math.min(1, (now - start) / GLIDE_MS) : 1;
        const want = t < 1 ? Math.round(from + (y - from) * ease(t)) : y;
        if (Math.abs(window.scrollY - want) > 1) {
          window.scrollTo(0, want);
          stillSince = now;
        }
        if (t < 1) stillSince = now;
      }
      if (pendingRef.current > 0) stillSince = now;
      if (now - stillSince > 450 || now - start > 6000) { stop(); return; }
      raf = window.requestAnimationFrame(tick);
    };
    evs.forEach((ev) => window.addEventListener(ev, stop, { passive: true }));
    raf = window.requestAnimationFrame(tick);
    return stop;
  }, [scrollToIso]);

  const pvRow = pv ? rows.find((r) => String(r.day?._id || '') === pv.id) : null;
  const pvDay = pvRow ? (fullById.get(pv.id) || pvRow.day) : null;
  const closeView = () => setPv((v) => (v && !v.closing ? { ...v, closing: true } : v));

  // a post that left the feed (moved, deleted) cannot stay open
  useEffect(() => {
    if (pv && !pvRow) setPv(null);
  }, [pv, pvRow]);

  if (!rows.length) {
    return (
      <section className="ywf ywf--empty" aria-label="Scheduled posts">
        <p className="ywf__empty">Nothing scheduled yet. Capture an idea to start the plan.</p>
      </section>
    );
  }

  return (
    <section className="ywf" aria-label="Scheduled posts">
      <div className="ywf__list" ref={listRef}>
        {rows.map((row) => {
          const id = String(row.day?._id || '');
          return (
            <FeedItem
              key={id || isoOf(row.date)}
              row={row}
              handle={handle}
              metaConnected={metaConnected}
              onOpen={onOpen}
              enriched={id ? fullById.get(id) : null}
              loading={id ? pending.has(id) && !fullById.has(id) : false}
              opened={!!id && pv?.id === id}
              onView={(el) => { if (id && !pv) setPv({ id, fromEl: el, closing: false }); }}
              onPatched={(post) => {
                // the PATCH returns the post without its heavy content — keep ours
                setFullById((prev) => {
                  const next = new Map(prev);
                  const was = prev.get(String(post._id));
                  next.set(String(post._id), was && !post.content ? { ...was, ...post } : { ...(was || {}), ...post });
                  return next;
                });
                onPatchPost?.(post);
              }}
            />
          );
        })}
      </div>
      {pv && pvDay && (
        <DayPostView
          key={pv.id}
          art={<DayPeek day={pvDay} feed />}
          handle={String(handle || pvDay?.instagramUsername || '').replace(/^@/, '')}
          caption={captionOf(pvDay)}
          fromEl={pv.fromEl}
          closing={pv.closing}
          onBack={closeView}
          onClosed={() => setPv(null)}
          // Edit hands over to the Editor, as the feed's other ways in do
          onEdit={() => { const r = pvRow; setPv(null); if (r) onOpen?.(r, 'post'); }}
        />
      )}
    </section>
  );
}
