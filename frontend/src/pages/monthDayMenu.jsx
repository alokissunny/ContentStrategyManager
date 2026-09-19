import React, { useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { getPost, schedulePost, setPostReview, markPublished } from '../api/posts';
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
  variant = 'popover',
}) {
  const sheet = variant === 'sheet';
  const empty = !day;
  const out = !!day?.published;
  const set = metaConnected && !!day?.scheduledAt && !out;
  const isRev = !!day?.savedForReview && !out;
  const wasDay = day?.date && String(day.date).slice(0, 10) < ymdKey(new Date());
  const st = day ? calStatusOf(day, metaConnected) : null;

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
        <button type="button" role="menuitem" onClick={() => { onClose(); onDistribute?.(); }}>
          <Icon name="calendar" size={17} />
          <span className="pe-menu__grow">
            Change distribution
            <em>Move upcoming posts onto your publishing days</em>
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
        <button type="button" role="menuitem" onClick={() => onLevel('shift')}>
          <Icon name="arrow-right" size={17} />
          <span className="pe-menu__grow">Shift posts</span>
          <Icon name="chevron-right" size={16} strokeWidth={2.1} />
        </button>
      </>
    );
  }

  const body = (
    <>
      {day && !level && <DayPeek day={day} phone={sheet} />}
      <div role="menu" className={sheet ? 'msheet__menu' : undefined}>{items}</div>
    </>
  );
  if (sheet) return body;
  return (
    <>
      <div className="pe-menu__scrim" onClick={onClose} />
      <div className="pe-menu yw-mday__menu">{body}</div>
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
  menu = null,
  timeLabel,
  onSelect,
  onOpen,
  onPickDay,
}) {
  const row = cell.row;
  const day = row?.day;
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
          onSelect?.(cell, row, false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onSelect?.(cell, row, true), 220);
        }}
        onDoubleClick={() => {
          clearTimeout(timer.current);
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
      {st && (
        <span className={`yw-day__ready yw-mday__ready ${st.tone === 'done' ? 'is-done' : ''} ${st.tone === 'kept' ? 'is-kept' : ''}`} aria-hidden="true">
          <Icon name={st.icon} size={12} strokeWidth={st.tone === 'done' ? 3 : 2.25} />
        </span>
      )}
      {menu}
    </div>
  );
}

/** Hook: which day menu is open + enriched post for the peek. */
export function useMonthDayMenu(index) {
  const [dayMenu, setDayMenu] = useState(null);
  const [fullDay, setFullDay] = useState(null);

  useEffect(() => {
    if (!dayMenu?.key) { setFullDay(null); return undefined; }
    const row = index.get(dayMenu.key);
    const id = row?.day?._id || row?.week?._id;
    if (!id) { setFullDay(row?.day || null); return undefined; }
    let cancelled = false;
    getPost(id)
      .then((p) => { if (!cancelled && p) setFullDay(p); })
      .catch(() => { if (!cancelled) setFullDay(row?.day || null); });
    return () => { cancelled = true; };
  }, [dayMenu?.key, index]);

  return { dayMenu, setDayMenu, fullDay, setFullDay };
}

export { ymdKey as menuYmdKey };
