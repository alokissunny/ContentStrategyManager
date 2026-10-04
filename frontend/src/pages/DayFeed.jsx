/*
 * Phone Day feed — every scheduled post in one vertical scroll (bauhly-v3 `.ywf`).
 * The date in the toolbar is whichever item sits in the middle of the screen.
 *
 * List posts omit `content` (lite). Each item is enriched via GET /posts/:id so
 * DynamicLayout gets layoutHtml / slides — the same paint as WeekView.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { DayPeek } from './weekview/PostPeek';
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
    if (date && date !== iso) await shiftPosts({ [id]: date });
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

function FeedItem({ row, handle, metaConnected, onOpen, enriched, loading, onPatched }) {
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

      {/* The day feed shows the whole post inline, so the media is not a way in
          to a separate editor view — tapping it does nothing (per product). The
          schedule chip above stays the one control that opens the workspace. */}
      <div className="ywf__media">
        <div className="ywf__frame">
          {ready ? (
            <DayPeek key={String(enriched._id)} day={enriched} feed />
          ) : (
            <div className={`ywf__skel${loading ? ' is-loading' : ''}`} aria-hidden="true">
              {loading ? <span className="ywf__skel-spin" /> : null}
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

      {caption ? (
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
  const [fullById, setFullById] = useState(() => new Map());
  const [pending, setPending] = useState(() => new Set());
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
    const todo = rows
      .map((r) => String(r.day?._id || ''))
      .filter(Boolean);

    const load = async () => {
      const need = todo.filter((id) => !fullById.has(id));
      if (!need.length) return;

      setPending((prev) => {
        const next = new Set(prev);
        need.forEach((id) => next.add(id));
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
        setPending((prev) => {
          const next = new Set(prev);
          batch.forEach((id) => next.delete(id));
          return next;
        });
      }
    };

    load();
    return () => { cancelled = true; };
    // rowsKey identity — avoid depending on fullById (grows every batch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey]);

  useEffect(() => {
    const box = listRef.current;
    if (!box || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((r) => seen.set(r.target, r.isIntersecting));
      const first = [...box.querySelectorAll('.ywf__item')].find((el) => seen.get(el));
      if (first) onIso?.(first.getAttribute('data-iso'));
    }, { root: null, rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    box.querySelectorAll('.ywf__item').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rows, onIso, fullById]);

  useEffect(() => {
    if (!scrollToIso || !listRef.current) return;
    const iso = String(scrollToIso).split('#')[0];
    const el = listRef.current.querySelector(`.ywf__item[data-iso="${iso}"]`);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [scrollToIso]);

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
    </section>
  );
}
