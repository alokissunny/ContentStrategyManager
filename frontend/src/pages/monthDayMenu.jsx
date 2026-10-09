import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../brand/Icon';
import { getPost, schedulePost, setPostReview, markPublished, deletePost } from '../api/posts';
import { isNewPost, markPostSeen, useSeenPosts } from '../lib/seenPosts';
import { openCaptureIdea } from '../lib/captureUi';
import { DayPeek } from './weekview/PostPeek';

const FORMAT_ICON = { Reel: 'play', Carousel: 'copy', Story: 'eye', 'Story series': 'eye', Post: 'brief' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isNowDay(date) {
  const a = startOfDay(date).getTime();
  const b = startOfDay(new Date()).getTime();
  return a === b;
}

function ymdKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True when the post has real slide paint — not a lite list stub / direction-only fallback. */
export function peekReady(day) {
  if (!day) return false;
  if (String(day?.content?.carouselHtml || '').trim()) return true;
  const slides = day?.content?.slides;
  if (!Array.isArray(slides) || !slides.length) return false;
  return slides.some((s) => String(s?.layoutHtml || '').trim()
    || String(s?.assetKey || s?.image?.key || '').trim());
}

function PeekSkeleton({ phone = false }) {
  const h = phone ? 210 : 176;
  const w = Math.round(h * 0.8);
  return (
    <div className={`yw-peek yw-peek--skel${phone ? ' is-phone' : ''}`} aria-hidden="true">
      <div className="yw-peek__frame yw-peek__skel-frame" style={{ width: `${w}px`, height: `${h}px` }}>
        <span className="yw-peek__skel-spin" />
      </div>
    </div>
  );
}

export function calStatusOf(post, metaConnected) {
  if (post?.published) return { tone: 'done', icon: 'check', label: 'Published' };
  if (metaConnected && post?.scheduledAt) return { tone: 'set', icon: 'clock', label: 'Scheduled' };
  if (post?.savedForReview) return { tone: 'kept', icon: 'eye', label: 'Review' };
  return null;
}

/** Month-cell actions — preview + Open post / Status / Shift (bauhly-v3).
 *  `variant="sheet"` is the phone bottom sheet body (no popover chrome). */
export function MonthDayMenu({
  day,
  handle,
  metaConnected,
  level,
  onLevel,
  onOpen,
  onClose,
  onDistribute,
  onPatch,
  onShift,
  onRemove = null,
  variant = 'popover',
  peekLoading = false,
}) {
  /* Remove post (bauhly-v3 YourWeek day menu): last, behind a rule, in the
     danger ink — and it asks first, the same dialog the Editor's Remove uses */
  const [askRemove, setAskRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removeNow = async () => {
    if (!day?._id || removing) return;
    setRemoving(true);
    try {
      await deletePost(day._id);
      onRemove?.(String(day._id));
      setAskRemove(false);
      onClose();
    } catch { /* keep the post — the dialog stays for another try */ }
    finally { setRemoving(false); }
  };
  const dayLabel = day?.date
    ? new Date(`${String(day.date).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    : 'this day';
  const sheet = variant === 'sheet';
  const empty = !day;
  const out = !!day?.published;
  const set = metaConnected && !!day?.scheduledAt && !out;
  const isRev = !!day?.savedForReview && !out;
  const wasDay = day?.date && String(day.date).slice(0, 10) < ymdKey(new Date());
  const st = day ? calStatusOf(day, metaConnected) : null;
  const ready = peekReady(day);
  const showPeek = !!day && !level && ready;
  const showSkel = !!day && !level && !ready && peekLoading;

  const patch = async (fn) => {
    if (!day?._id) return;
    try {
      const next = await fn();
      if (next) onPatch?.(next);
    } catch { /* keep quiet — calendar refreshes on next load */ }
    onClose();
  };

  let items;
  if (empty) {
    items = (
      <>
        <button type="button" role="menuitem" onClick={() => { onClose(); openCaptureIdea(); }}>
          <Icon name="plus" size={17} />
          <span className="pe-menu__grow">Capture for this day</span>
        </button>
        <button type="button" role="menuitem" onClick={() => { onClose(); onDistribute?.(); }}>
          <Icon name="calendar" size={17} />
          <span className="pe-menu__grow">Change distribution</span>
        </button>
      </>
    );
  } else if (level === 'shift') {
    items = (
      <>
        <button type="button" role="menuitem" className="pe-menu__back" onClick={() => onLevel(null)}>
          <Icon name="chevron-left" size={16} strokeWidth={2.1} />
          <span className="pe-menu__grow">Shift posts</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => { onClose(); onShift?.(day, 'one'); }}
        >
          <span className="pe-menu__grow">
            This post
            <em>Move only the selected post.</em>
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => { onClose(); onShift?.(day, 'future'); }}
        >
          <span className="pe-menu__grow">
            This + next posts
            <em>Move this post and all future posts in the sequence.</em>
          </span>
        </button>
      </>
    );
  } else if (level === 'state') {
    items = (
      <>
        <button type="button" role="menuitem" className="pe-menu__back" onClick={() => onLevel(null)}>
          <Icon name="chevron-left" size={16} strokeWidth={2.1} />
          <span className="pe-menu__grow">Status</span>
        </button>
        {!out && wasDay && (
          <button type="button" role="menuitem" onClick={() => patch(() => markPublished(day._id, true))}>
            <Icon name="check" size={17} />
            <span className="pe-menu__grow">Published</span>
          </button>
        )}
        {!out && !wasDay && (
          <button
            type="button"
            role="menuitem"
            disabled={!metaConnected}
            onClick={() => patch(() => schedulePost(day._id, set ? null : new Date().toISOString()))}
          >
            <Icon name="clock" size={17} />
            <span className="pe-menu__grow">
              {!metaConnected ? 'Connect Meta to schedule' : (set ? 'Unschedule' : 'Schedule')}
            </span>
          </button>
        )}
        {!out && !isRev && (
          <button type="button" role="menuitem" onClick={() => patch(() => setPostReview(day._id, true))}>
            <Icon name="eye" size={17} />
            <span className="pe-menu__grow">Mark for review</span>
          </button>
        )}
        {!out && isRev && (
          <button type="button" role="menuitem" onClick={() => patch(() => setPostReview(day._id, false))}>
            <Icon name="eye" size={17} />
            <span className="pe-menu__grow">Clear review</span>
          </button>
        )}
        {out && (
          <button type="button" role="menuitem" onClick={() => patch(() => markPublished(day._id, false))}>
            <Icon name="refresh" size={17} />
            <span className="pe-menu__grow">Not published</span>
          </button>
        )}
      </>
    );
  } else {
    items = (
      <>
        <button type="button" role="menuitem" onClick={() => { onClose(); onOpen?.(); }}>
          <Icon name="arrow-up-right" size={17} />
          <span className="pe-menu__grow">Open post</span>
        </button>
        <button type="button" role="menuitem" onClick={() => onLevel('state')}>
          <Icon name="clock" size={17} />
          <span className="pe-menu__grow">Status</span>
          {st && (out || set || isRev) && (
            <span className={`pe-menu__state ${out ? 'is-out' : set ? 'is-set' : 'is-review'}`}>
              {st.label}
            </span>
          )}
          <Icon name="chevron-right" size={16} strokeWidth={2.1} />
        </button>
        {!out && (
          <button
            type="button"
            role="menuitem"
            disabled={!!set}
            onClick={set ? undefined : () => onLevel('shift')}
          >
            <Icon name="arrow-right" size={17} />
            <span className="pe-menu__grow">
              Shift posts
              {set && <em>Unschedule first</em>}
            </span>
            <Icon name="chevron-right" size={16} strokeWidth={2.1} />
          </button>
        )}
        {onRemove && (
          <>
            <span className="pe-menu__rule" aria-hidden="true" />
            <button type="button" role="menuitem" className="is-danger" onClick={() => setAskRemove(true)}>
              <Icon name="trash" size={17} />
              <span className="pe-menu__grow">Remove post</span>
            </button>
          </>
        )}
      </>
    );
  }

  const confirm = askRemove && createPortal(
    <>
      <div className="wv-confirm__scrim" onClick={() => !removing && setAskRemove(false)} />
      <div className="wv-confirm" role="alertdialog" aria-modal="true" aria-labelledby="yw-rm-t">
        <h2 id="yw-rm-t">Remove this post?</h2>
        <p>{`The whole post for ${dayLabel} goes — its caption, its schedule and all of its slides. The day stays in the plan with nothing on it.`}</p>
        <div className="wv-confirm__acts">
          <button type="button" className="btn btn--tertiary btn--sm" disabled={removing} onClick={() => setAskRemove(false)}>Keep it</button>
          <button type="button" className="btn btn--primary btn--sm wv-confirm__bad" disabled={removing} onClick={removeNow}>
            {removing ? 'Removing…' : 'Remove post'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );

  const body = (
    <>
      {showPeek && <DayPeek day={day} phone={sheet} />}
      {showSkel && <PeekSkeleton phone={sheet} />}
      <div role="menu" className={sheet ? 'msheet__menu' : undefined}>{items}</div>
    </>
  );
  if (sheet) return <>{body}{confirm}</>;
  return (
    <>
      {!askRemove && <div className="pe-menu__scrim" onClick={onClose} />}
      {!askRemove && <div className="pe-menu yw-mday__menu">{body}</div>}
      {confirm}
    </>
  );
}

/**
 * One month cell with optional day menu. Click opens the menu; double-click
 * opens the post (bauhly-v3 MonthDay).
 */
export function MonthDayCell({
  cell,
  metaConnected,
  preview = false,
  selected = false,
  picking = false,
  muted = false,
  moveKind = null,
  menu = null,
  timeLabel,
  onSelect,
  onOpen,
  onPickDay,
}) {
  const row = cell.row;
  const day = row?.day;
  useSeenPosts();
  const fresh = isNewPost(day);
  const now = isNowDay(cell.date);
  const st = day ? calStatusOf(day, metaConnected) : null;
  const format = String(day?.format || '').replace(/ series$/, '');
  const time = day && timeLabel ? timeLabel(day, row.week) : '';
  const past = !now && startOfDay(cell.date) < startOfDay(new Date());
  const cls = ['yw-mday'];
  if (!cell.inMonth) cls.push('is-dim');
  if (now) cls.push('is-today');
  if (!row) cls.push('is-empty');
  if (past) cls.push('is-past');
  if (preview) cls.push('is-preview');
  if (selected) cls.push('is-on');
  if (picking) cls.push('is-picking');
  if (muted) cls.push('is-muted');
  if (moveKind === 'from') cls.push('is-mv--src');
  if (moveKind === 'to') cls.push('is-mv--to');
  if (st?.tone === 'done') cls.push('is-out');
  if (st) cls.push('is-ready');
  const title = (day?.title || day?.contentType || '').trim();
  const label = `${cell.date.getDate()} ${MONTHS[cell.date.getMonth()]}${now ? ' Today' : ''}${title ? `, ${title}` : format ? `, ${format}` : ', nothing planned'}`;
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className={cls.join(' ')}>
      <button
        type="button"
        className="yw-mday__hit"
        aria-current={now ? 'date' : undefined}
        aria-label={label}
        onClick={() => {
          if (day && !picking) markPostSeen(day);
          onSelect?.(cell, row, false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onSelect?.(cell, row, true), 220);
        }}
        onDoubleClick={() => {
          clearTimeout(timer.current);
          if (picking) return;
          if (row) onOpen?.(row.week);
          else onPickDay?.(cell.date);
        }}
      >
        <span className="yw-mday__when">
          <b>{cell.date.getDate()}</b>
          {now && <i className="yw-mday__today">Today</i>}
        </span>
        {day && (
          <span className="yw-day__kind yw-mday__kind">
            <Icon name={FORMAT_ICON[day.format] || 'brief'} size={14} strokeWidth={2} className="yw-day__glyph" />
            <span className="yw-day__word">{format || 'Post'}</span>
            {time && <span className="yw-day__clock yw-mday__clock">{time}</span>}
          </span>
        )}
      </button>
      {fresh && <i className="yw-mday__new">New</i>}
      {st && (
        <span className={`yw-day__ready yw-mday__ready ${st.tone === 'done' ? 'is-done' : ''} ${st.tone === 'kept' ? 'is-kept' : ''}`} aria-hidden="true">
          <Icon name={st.icon} size={12} strokeWidth={st.tone === 'done' ? 3 : 2.25} />
        </span>
      )}
      {menu}
    </div>
  );
}

/** Hook: which day menu is open + enriched post for the peek.
 *  List posts omit layoutHtml — fetch the full post before DayPeek paints so
 *  the menu never flashes a direction-text stub (bauhly-v3). */
export function useMonthDayMenu(index) {
  const [dayMenu, setDayMenu] = useState(null);
  const [fullDay, setFullDay] = useState(null);
  const [peekLoading, setPeekLoading] = useState(false);
  const cacheRef = useRef(new Map());

  const openDayMenu = (key) => {
    setFullDay(null);
    setPeekLoading(true);
    setDayMenu({ key, level: null });
  };

  useEffect(() => {
    if (!dayMenu?.key) {
      setFullDay(null);
      setPeekLoading(false);
      return undefined;
    }
    const row = index.get(dayMenu.key);
    const stub = row?.day || null;
    const id = stub?._id || row?.week?._id;
    if (!id) {
      setFullDay(stub);
      setPeekLoading(false);
      return undefined;
    }

    const cached = cacheRef.current.get(String(id));
    if (cached && peekReady(cached)) {
      setFullDay(cached);
      setPeekLoading(false);
      return undefined;
    }
    if (peekReady(stub)) {
      cacheRef.current.set(String(id), stub);
      setFullDay(stub);
      setPeekLoading(false);
      return undefined;
    }

    /* Hold the stub out of the peek — actions still use list fields via caller */
    setFullDay(null);
    setPeekLoading(true);
    let cancelled = false;
    getPost(id)
      .then((p) => {
        if (cancelled) return;
        if (p) {
          cacheRef.current.set(String(id), p);
          setFullDay(p);
        } else {
          setFullDay(stub);
        }
      })
      .catch(() => { if (!cancelled) setFullDay(stub); })
      .finally(() => { if (!cancelled) setPeekLoading(false); });
    return () => { cancelled = true; };
  }, [dayMenu?.key, index]);

  const setFullDayCached = (p) => {
    if (p?._id && peekReady(p)) cacheRef.current.set(String(p._id), p);
    setFullDay(p);
  };

  return {
    dayMenu,
    setDayMenu,
    openDayMenu,
    fullDay,
    setFullDay: setFullDayCached,
    peekLoading,
  };
}

export { ymdKey as menuYmdKey };
