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
import { getPost } from '../api/posts';

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

function FeedItem({ row, handle, metaConnected, onOpen, enriched, loading }) {
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
          onClick={() => onOpen?.(row)}
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
            />
          );
        })}
      </div>
    </section>
  );
}
