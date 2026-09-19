/*
 * Calendar — the page you land on.
 *
 * A month calendar of planned posts, with Monthly and Weekly views. You land
 * on this month and can move between months. Opening a day (or the Weekly tab)
 * shows its seven-day route (WeekView). "Capture idea" runs generation behind
 * the RouteLoom stage (PlanLoom).
 *
 * Backend-wired: GET /routes (plan history + preparing for the active Instagram
 * handle). Current week is derived client-side. Meta status and a lite projects
 * list load after first paint. Opening a day fetches GET /routes/:id (or a
 * hover prefetch). POST /routes/generate builds the next plan.
 * Switching accounts in the header reloads; list endpoints follow the active handle.
 */

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { getPosts, getPost, clearUpcoming, distributePosts } from '../api/posts';
import { MonthDayCell, MonthDayMenu, useMonthDayMenu, calStatusOf as peekCalStatusOf } from './monthDayMenu';
import DayFeed from './DayFeed';
import MobileSheet from '../components/MobileSheet';
import useMediaQuery from '../hooks/useMediaQuery';
import { useNavigate, useLocation } from 'react-router-dom';
import { peekMetaOAuthResult, takeMetaOAuthResult, getMetaStatus, isMetaConnectedFor } from '../api/meta';
import { useProjects, createProject, ensureProjects, addSession, sessionCount } from '../lib/projectsStore';
import {
  consumePlanReady,
  getPlanGeneration,
  setPlanWatching,
  startPlanGeneration,
  usePlanGeneration,
} from '../lib/planGeneration';
import { useAuth } from '../context/AuthContext';
import { getBrandDna, reviseBrandDna } from '../api/brandDna';
// Code-split the heavy views so the Calendar (month grid) does not download
// WeekView (~the largest component) or the capture/generate flows until they are
// actually opened.
const WeekView = React.lazy(() => import('./WeekView'));
const PlanLoom = React.lazy(() => import('./PlanLoom'));
const Checkin = React.lazy(() => import('./checkin/Checkin'));
import NeedsAWord from '../components/NeedsAWord';
import './plans.css';
import './yourweek.css'; /* the shared .empty brand-moment styles */
import './calendar.css'; /* the Monthly / Weekly / Day calendar views */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/* Illustration marks Mon / Wed / Fri as the studio's usual post cadence. */
const DEFAULT_POST_WEEKDAYS = new Set([0, 2, 4]);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/* Each PlannedPost is its own document now (no week container). The Calendar's
 * grid + editor were built around a week `route` with a `days[]` array, so we
 * wrap a post into a synthetic one-day "route": the post is both the route and
 * its single day. `weekOf`/`startsAt` = the post's own date so the existing
 * date helpers place it correctly. The day index is always 0. */
function postToRoute(post) {
  if (!post) return post;
  return {
    ...post,
    _id: post._id,
    weekOf: post.date,
    startsAt: post.date,
    instagramUsername: post.instagramUsername,
    generatedAt: post.generatedAt || post.updatedAt,
    days: [post],
  };
}

/* Monday of the week containing `from` — mirrors backend routeController.mondayOf. */
function mondayOf(from = new Date()) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/* Running week from the light /routes list (same rules as GET /routes/current). */
function pickCurrentRoute(routes) {
  const written = (routes || []).filter((r) => !r.draft);
  if (!written.length) return null;
  const thisMonday = mondayOf();
  const started = written
    .filter((r) => new Date(r.weekOf) <= thisMonday)
    .sort((a, b) => new Date(b.weekOf) - new Date(a.weekOf));
  if (started.length) return started[0];
  return [...written].sort((a, b) => new Date(a.weekOf) - new Date(b.weekOf))[0];
}

/* Written weeks in the same month as `week`, oldest first — the WeekView
 * navigator pages through these. Drafts (next-month placeholders) stay out. */
function monthWeeksOf(routes, week) {
  if (!week) return [];
  const key = week.monthKey;
  const list = (routes || []).filter((r) => {
    if (r.draft) return false;
    if (!(r.days || []).length) return false;
    if (key) return r.monthKey === key;
    const a = new Date(week.startsAt || week.weekOf);
    const b = new Date(r.startsAt || r.weekOf);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  });
  const newestByMonday = new Map();
  list.forEach((w) => {
    const k = mondayKey(w.startsAt || w.weekOf) || String(w._id);
    const prev = newestByMonday.get(k);
    const t = Date.parse(w.generatedAt || w.updatedAt || 0);
    const pt = prev ? Date.parse(prev.generatedAt || prev.updatedAt || 0) : -1;
    if (!prev || t >= pt) newestByMonday.set(k, w);
  });
  return [...newestByMonday.values()].sort((a, b) => {
    const d = (a.weekIndex ?? 0) - (b.weekIndex ?? 0);
    if (d) return d;
    return new Date(a.startsAt || a.weekOf) - new Date(b.startsAt || b.weekOf);
  });
}

function mondayKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/* Weeks whose Mon–Sun range touches `year`/`month` — so a week that starts
 * at the end of one month still paints days onto the next. Same Monday twice
 * (a replanned week whose old row wasn't deleted) keeps the newest write. */
function weeksOverlappingMonth(routes, year, month) {
  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const list = (routes || []).filter((r) => {
    const start = new Date(r.startsAt || r.weekOf);
    if (Number.isNaN(start.getTime())) return false;
    const end = new Date(start);
    end.setHours(12, 0, 0, 0);
    end.setDate(end.getDate() + 6);
    return start <= monthEnd && end >= monthStart;
  });
  const newestByMonday = new Map();
  list.forEach((w) => {
    const k = mondayKey(w.startsAt || w.weekOf) || String(w._id);
    const prev = newestByMonday.get(k);
    const t = Date.parse(w.generatedAt || w.updatedAt || 0);
    const pt = prev ? Date.parse(prev.generatedAt || prev.updatedAt || 0) : -1;
    if (!prev || t >= pt) newestByMonday.set(k, w);
  });
  return [...newestByMonday.values()].sort(
    (a, b) => new Date(a.startsAt || a.weekOf) - new Date(b.startsAt || b.weekOf),
  );
}

/* YYYY-MM-DD as a local calendar day (noon). `new Date("YYYY-MM-DD")` is UTC
 * midnight and slips to the previous day west of UTC. */
function parseIsoDay(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
}

/* The day's real calendar date. Plans often start mid-week (empty dates from
 * today forward), so array index is not Monday + N. */
function dayDateOf(week, day, index) {
  const fromIso = parseIsoDay(day?.date);
  if (fromIso) return fromIso;
  const base = week?.startsAt || week?.weekOf;
  if (!base) return null;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  const weekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const byName = weekday.indexOf(day?.day);
  d.setDate(d.getDate() + (byName >= 0 ? byName : (Number(index) || 0)));
  return d;
}

function isNowDay(date) {
  if (!date) return false;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const a = new Date(date); a.setHours(0, 0, 0, 0);
  return t.getTime() === a.getTime();
}

/* Flatten written weeks into chronological day rows. Weeks still filling
 * (no days yet) are skipped — the "writing the rest" line covers them. */
function monthDaysOf(weeks) {
  const rows = [];
  (weeks || []).forEach((week) => {
    if (week.draft) return;
    (week.days || []).forEach((day, i) => {
      rows.push({ week, day, dayIndex: i, date: dayDateOf(week, day, i) });
    });
  });
  return rows.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
}

function ymdKey(d) {
  if (!d) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function addDaysLocal(date, n) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* Lay posts onto calendar dates. Each post already owns a real date (its slot),
 * so every month simply places posts on their stored date — no redistribution.
 * (The old week model had to spread a week's days across free future days;
 * post-centric plans don't.) */
function postsByCalendarDay(dayRows, year, month) {
  const byYmd = new Map();
  const rows = (dayRows || []).filter((row) => {
    const d = row?.day;
    if (!d) return false;
    return Boolean(String(d.title || '').trim() || String(d.format || '').trim());
  });
  rows.forEach((row) => {
    if (!row.date) return;
    if (row.date.getMonth() !== month || row.date.getFullYear() !== year) return;
    byYmd.set(ymdKey(row.date), row);
  });
  return byYmd;
}

/* Monday-first month grid for `group`. Leading/trailing days from the
 * neighbouring month fill complete weeks. */
function calendarCellsOf(group, dayRows) {
  const anchor = group?.start ? new Date(group.start) : new Date();
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1, 12, 0, 0, 0);
  const lastDate = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const byYmd = postsByCalendarDay(dayRows, year, month);
  const start = addDaysLocal(first, -lead);
  const total = Math.ceil((lead + lastDate) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i += 1) {
    const date = addDaysLocal(start, i);
    cells.push({
      date,
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      post: byYmd.get(ymdKey(date)) || null,
    });
  }
  return cells;
}

function MonthCalendar({ group, days, onOpen, onPrefetch, metaConnected }) {
  const cells = calendarCellsOf(group, days);
  const postWeekdays = new Set();
  cells.forEach((cell) => {
    if (!cell.inMonth || !cell.post) return;
    postWeekdays.add((cell.date.getDay() + 6) % 7);
  });
  const markedWeekdays = postWeekdays.size > 0 ? postWeekdays : DEFAULT_POST_WEEKDAYS;

  return (
    <div className="ph-cal">
      <div className="ph-cal__weekdays" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={d} className="ph-cal__weekday">
            <span className="ph-cal__weekday-name">{d}</span>
            {markedWeekdays.has(i) && <span className="ph-cal__postday">Post day</span>}
          </span>
        ))}
      </div>
      <div className="ph-cal__grid">
        {cells.map((cell) => {
          const row = cell.post;
          const day = row?.day;
          const now = isNowDay(cell.date);
          const done = !!day?.published;
          const scheduled = !done && !!day?.scheduledAt && metaConnected;
          const format = String(day?.format || '').replace(/ series$/, '');
          const title = (day?.title || day?.contentType || '').trim();
          const clickable = Boolean(row);
          const cls = ['ph-cal__cell'];
          if (!cell.inMonth) cls.push('is-out');
          if (now) cls.push('is-now');
          if (done) cls.push('is-done');
          if (clickable) cls.push('is-post');
          const label = `${cell.date.getDate()} ${MONTHS[cell.date.getMonth()]}${now ? ' Today' : ''}${title ? `, ${title}` : format ? `, ${format}` : ''}`;
          const inner = (
            <>
              <span className="ph-cal__num">
                {cell.date.getDate()}
                {now ? <span className="ph-cal__today"> Today</span> : null}
              </span>
              {(done || scheduled) && (
                <span className={`ph-cal__mark${scheduled ? ' is-clock' : ' is-done'}`} aria-hidden="true">
                  <Icon name={done ? 'check' : 'clock'} size={10} strokeWidth={done ? 2.75 : 2.25} />
                </span>
              )}
              {clickable && (
                <span className="ph-cal__fmt">{format || 'Post'}</span>
              )}
            </>
          );
          if (clickable) {
            return (
              <button
                key={ymdKey(cell.date)}
                type="button"
                className={cls.join(' ')}
                onClick={() => onOpen(row.week, row.dayIndex)}
                onPointerEnter={() => onPrefetch?.(row.week?._id)}
                aria-label={label}
                aria-current={now ? 'date' : undefined}
              >
                {inner}
              </button>
            );
          }
          return (
            <div
              key={ymdKey(cell.date)}
              className={cls.join(' ')}
              aria-hidden={!cell.inMonth ? true : undefined}
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * CALENDAR VIEWS — Monthly / Weekly / Day
 *
 * A faithful port of bauhly-v3's YourWeek calendar (MonthGrid, DaySelector,
 * ViewMenu), wired to the live app's posts. Each `route` in the list is a post
 * wrapped as a one-day route (see postToRoute), so `route.days[0]` is the post.
 * `buildPostIndex` maps every post onto its calendar day (YYYY-M-D key), and the
 * three views read from that one index so they can never disagree.
 * ═══════════════════════════════════════════════════════════════════════════ */

const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CAL_VIEWS = [['day', 'Day'], ['week', 'Weekly'], ['month', 'Monthly']];
/* the glyph each format wears — the reference's own mapping */
const FORMAT_ICON = { Reel: 'play', Carousel: 'copy', Story: 'eye', 'Story series': 'eye', Post: 'brief' };

/* the time a post goes out, as 24h "HH:MM" (matches the reference screenshot):
   the post's own time, else the plan's weekly preference, else the app default. */
function timeLabelOf(post, route) {
  const raw = (post?.time && String(post.time).trim())
    || (route?.postAtPref && String(route.postAtPref).trim())
    || (post?.postAtPref && String(post.postAtPref).trim())
    || '';
  const ampm = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/pm/i.test(ampm[3])) h += 12;
    return `${String(h).padStart(2, '0')}:${ampm[2]}`;
  }
  const hm = raw.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return `${String(Number(hm[1])).padStart(2, '0')}:${hm[2]}`;
  return '09:00';
}

/* the settled state a day's post is in — the disc the calendar draws. Published
   is history (a grey tick); scheduled is a promise (a lime clock, only when Meta
   can actually publish). Everything else is quiet. */
function calStatusOf(post, metaConnected) {
  return peekCalStatusOf(post, metaConnected);
}

/* every post on its calendar day, keyed by ymdKey — the one index all three
   views read. Skips posts with nothing on them yet. */
function buildPostIndex(routes) {
  const map = new Map();
  monthDaysOf(routes).forEach((row) => {
    if (!row.date) return;
    const d = row?.day;
    if (!(String(d?.title || '').trim() || String(d?.format || '').trim())) return;
    map.set(ymdKey(row.date), row);
  });
  return map;
}

/* ascending list of every post's calendar date — the Day view steps through it */
function postDatesOf(index) {
  return [...index.values()]
    .map((row) => row.date)
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());
}

function longDayLabel(date) {
  return `${WEEKDAYS_LONG[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function weekRangeLabel(monday) {
  const sun = addDaysLocal(monday, 6);
  if (monday.getMonth() === sun.getMonth()) {
    return `${MONTHS[monday.getMonth()]} ${monday.getDate()} – ${sun.getDate()}`;
  }
  const short = (d) => MONTHS[d.getMonth()].slice(0, 3);
  return `${short(monday)} ${monday.getDate()} – ${short(sun)} ${sun.getDate()}`;
}

/* Monday-first month grid: whole weeks, with the neighbouring months filling
   the leading/trailing days so a sequence crossing a boundary still paints. */
function monthCellsOf(year, month, index) {
  const first = new Date(year, month, 1, 12, 0, 0, 0);
  const lastDate = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const start = addDaysLocal(first, -lead);
  const total = Math.ceil((lead + lastDate) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i += 1) {
    const date = addDaysLocal(start, i);
    cells.push({
      date,
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      row: index.get(ymdKey(date)) || null,
    });
  }
  return cells;
}

/* ── the distribution — which weekdays the studio publishes on ─────────────
 * The "Posting" columns are the DISTRIBUTION pattern, not "every day that
 * happens to hold a post" (so Tue/Sat/Sun can carry a post without their column
 * claiming to be a posting day). The pattern comes from the Distribute panel:
 * a chosen set of weekdays ("Choose days"), or an even spread the arithmetic
 * names ("Spread weekly"). Persisted per handle; defaults to Mon/Wed/Fri. */
const DIST_DEFAULT = { mode: 'days', days: [0, 2, 4] };

function distStorageKey(handle) {
  return `bauhly:dist:${handle || 'default'}`;
}
function readDist(handle) {
  try {
    const raw = localStorage.getItem(distStorageKey(handle));
    if (!raw) return { ...DIST_DEFAULT };
    const p = JSON.parse(raw);
    const days = Array.isArray(p.days) && p.days.length
      ? [...new Set(p.days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
      : [...DIST_DEFAULT.days];
    return { mode: p.mode === 'weekly' ? 'weekly' : 'days', days: days.length ? days : [...DIST_DEFAULT.days] };
  } catch {
    return { ...DIST_DEFAULT };
  }
}

/* how many whole weeks this month still has in it — the denominator "Spread
   weekly" divides by. Past that the pattern simply repeats. */
function weeksLeftInMonth(today = new Date()) {
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  let n = 0;
  for (let c = mondayOf(today); c <= last; c = addDaysLocal(c, 7)) n += 1;
  return Math.max(1, n);
}

/* the weekday pattern an even spread produces: how many posts a week (count ÷
   weeks, rounded up), then those weekdays from Monday outward — one is Monday,
   two are Monday and Thursday, three are Monday/Wednesday/Friday. */
function weeklyPattern(count, weeks) {
  const perWeek = Math.max(1, Math.min(7, Math.ceil(Math.max(1, count) / Math.max(1, weeks))));
  return Array.from({ length: perWeek }, (_, i) => Math.floor((i * 7) / perWeek));
}

/* the weekday Set the calendar marks Posting, for the current distribution */
function postingSetOf(dist, count) {
  if (dist.mode === 'weekly') return new Set(weeklyPattern(count, weeksLeftInMonth()));
  return new Set(dist.days.length ? dist.days : DIST_DEFAULT.days);
}

/* ── the "View:" control — Day / Weekly / Monthly (phone: Day ↔ Monthly) ── */
function ViewMenu({ value, onPick }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const phone = useMediaQuery('(max-width: 767px)');
  const views = phone ? CAL_VIEWS.filter(([id]) => id !== 'week') : CAL_VIEWS;
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  const label = (CAL_VIEWS.find(([id]) => id === value) || CAL_VIEWS[2])[1];
  /* Two views on a phone are a toggle, not a menu (bauhly-v3). */
  if (phone) {
    const next = views[(views.findIndex(([id]) => id === value) + 1) % views.length]
      || views[0];
    return (
      <button
        type="button"
        className="btn cal-viewm__btn cal-viewm__btn--toggle"
        aria-label={`${label} view. Switch to ${next?.[1] || label}`}
        onClick={() => next && onPick(next[0])}
      >
        <span className="cal-viewm__pre" aria-hidden="true">View:</span>
        <span className="cal-viewm__label">{label}</span>
      </button>
    );
  }
  return (
    <div className="cal-viewm" ref={box}>
      <button
        type="button"
        className="btn cal-viewm__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`How to read the plan: ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cal-viewm__pre" aria-hidden="true">View:</span>
        <span className="cal-viewm__label">{label}</span>
        <Icon name="chevron-down" size={15} strokeWidth={2.1} className="cal-viewm__chev" />
      </button>
      {open && (
        <>
          <div className="cal-menu__scrim" onClick={() => setOpen(false)} />
          <div className="cal-menu" role="menu" aria-label="How to read the plan">
            {views.map(([id, text]) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={value === id}
                onClick={() => { setOpen(false); onPick(id); }}
              >
                <span className="cal-viewm__tick" aria-hidden="true">
                  {value === id && <Icon name="check" size={16} strokeWidth={2.25} />}
                </span>
                <span className="cal-menu__grow">{text}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── the month ─────────────────────────────────────────────────────────── */
function MonthView({
  anchor,
  index,
  metaConnected,
  posting,
  previewOn = false,
  handle = '',
  phone = false,
  onOpen,
  onPickDay,
  onDistribute,
  onPatchPost,
}) {
  const cells = monthCellsOf(anchor.getFullYear(), anchor.getMonth(), index);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const today = startOfDay(new Date());
  const { dayMenu, setDayMenu, openDayMenu, fullDay, setFullDay, peekLoading } = useMonthDayMenu(index);
  const [daySel, setDaySel] = useState(null);

  const closeMenu = () => {
    setDayMenu(null);
    setDaySel(null);
  };

  const menuKey = dayMenu?.key || null;
  const menuLevel = dayMenu?.level || null;
  const menuRow = menuKey ? index.get(menuKey) : null;
  const menuStub = menuRow?.day || null;
  /* Prefer enriched post only when it is THIS cell's — never paint the previous
     day's peek while the new fetch is in flight. */
  const menuEnriched = fullDay && menuStub && String(fullDay._id) === String(menuStub._id)
    ? fullDay
    : null;
  const menuDay = menuKey ? (menuEnriched || menuStub) : null;
  const sheetDate = menuKey
    ? (() => {
      const [y, m, d] = menuKey.split('-').map(Number);
      return new Date(y, m - 1, d);
    })()
    : null;
  const sheetTitle = menuLevel === 'shift' ? 'Shift posts'
    : menuLevel === 'state' ? 'Status'
      : sheetDate ? longDayLabel(sheetDate) : '';

  return (
    <div className="yw-mcal">
      <div className="yw-mcal__head" aria-hidden="true">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className="yw-mcal__wd">
            <b>{w}</b>
            {posting.has(i) && <em className="yw-postchip">Post<span>ing</span></em>}
          </span>
        ))}
      </div>
      <div className="yw-mcal__grid" role="grid" aria-label="Month of posts">
        {weeks.map((week) => (
          <div className="yw-mcal__row" role="row" key={ymdKey(week[0].date)}>
            {week.map((cell) => {
              const key = ymdKey(cell.date);
              const open = dayMenu?.key === key;
              const row = cell.row;
              const cellStub = row?.day || null;
              const cellEnriched = open && fullDay && cellStub
                && String(fullDay._id) === String(cellStub._id)
                ? fullDay
                : null;
              const cellDay = open ? (cellEnriched || cellStub) : null;
              return (
                <div role="gridcell" key={key} className="yw-mcal__cell">
                  <MonthDayCell
                    cell={cell}
                    metaConnected={metaConnected}
                    preview={previewOn && cell.date >= today && posting.has((cell.date.getDay() + 6) % 7)}
                    selected={daySel === key || open}
                    timeLabel={timeLabelOf}
                    onSelect={(c, r, late) => {
                      const k = ymdKey(c.date);
                      if (late) {
                        openDayMenu(k);
                        return;
                      }
                      /* lime lands immediately; menu waits so a double-click
                         can still open the post without flashing the popover */
                      setDayMenu(null);
                      setDaySel(k);
                    }}
                    onOpen={onOpen}
                    onPickDay={onPickDay}
                    menu={open && !phone ? (
                      <MonthDayMenu
                        day={cellDay}
                        peekLoading={peekLoading}
                        handle={handle}
                        metaConnected={metaConnected}
                        level={menuLevel}
                        onLevel={(level) => setDayMenu((m) => (m ? { ...m, level } : m))}
                        onOpen={() => {
                          if (row?.week) onOpen(row.week);
                          else onPickDay?.(cell.date);
                        }}
                        onClose={closeMenu}
                        onDistribute={onDistribute}
                        onPatch={(next) => {
                          setFullDay(next);
                          onPatchPost?.(next);
                        }}
                      />
                    ) : null}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {phone && (
        <MobileSheet
          open={!!dayMenu}
          title={sheetTitle}
          onBack={menuLevel
            ? () => setDayMenu((m) => (m ? { ...m, level: null } : m))
            : null}
          onClose={closeMenu}
        >
          <MonthDayMenu
            variant="sheet"
            day={menuDay}
            peekLoading={peekLoading}
            handle={handle}
            metaConnected={metaConnected}
            level={menuLevel}
            onLevel={(level) => setDayMenu((m) => (m ? { ...m, level } : m))}
            onOpen={() => {
              closeMenu();
              if (menuRow?.week) onOpen(menuRow.week);
              else if (sheetDate) onPickDay?.(sheetDate);
            }}
            onClose={closeMenu}
            onDistribute={onDistribute}
            onPatch={(next) => {
              setFullDay(next);
              onPatchPost?.(next);
            }}
          />
        </MobileSheet>
      )}
    </div>
  );
}

/* ── Distribute posts — choose the publishing-day pattern ──────────────────
 * Opened from the ⋯ menu. Two answers to one question: name the weekdays
 * ("Choose days") or say "evenly" and let the arithmetic name them ("Spread
 * weekly"). The chosen pattern drives the calendar's Posting columns and the
 * rings drawn while this is open. A faithful port of bauhly-v3's DistributeBody. */
function DistributePanel({ open, onClose, count, mode, days, onMode, onDays, weeklyCopy, onApply, applying }) {
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open, onClose]);
  if (!open) return null;
  const on = new Set(days);
  /* the last chosen day cannot be turned off — a pattern with no days in it
     schedules nothing, which is not a state the studio can have asked for */
  const toggle = (i) => {
    if (on.has(i)) { if (on.size > 1) onDays(days.filter((d) => d !== i)); return; }
    onDays([...days, i].sort((a, b) => a - b));
  };
  return (
    <div className="yw-dist" ref={box}>
      <div className="yw-dist__panel" role="dialog" aria-label="Distribute posts">
        <h3 className="yw-dist__head">
          {count ? `Distribute ${count} ${count === 1 ? 'post' : 'posts'}` : 'Distribute posts'}
        </h3>
        <div className="yw-dist__modes" role="radiogroup" aria-label="How to place the posts">
          {[['days', 'Choose days'], ['weekly', 'Spread weekly']].map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              className={`yw-dist__mode ${mode === id ? 'is-on' : ''}`}
              onClick={() => onMode(id)}
            >
              {text}
            </button>
          ))}
        </div>
        {mode === 'days' ? (
          <>
            <p className="yw-dist__ask" id="dist-days-label">Choose your publishing days</p>
            {!count && (
              <p className="yw-dist__none">
                Every upcoming post already has a date &mdash; scheduled, published, or set.
                These days are what new posts will use.
              </p>
            )}
            <div className="yw-dist__days" role="group" aria-labelledby="dist-days-label">
              {WEEKDAYS.map((d, i) => {
                const only = on.has(i) && on.size === 1;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`yw-dist__day ${on.has(i) ? 'is-on' : ''} ${only ? 'is-only' : ''}`}
                    aria-pressed={on.has(i)}
                    aria-disabled={only || undefined}
                    aria-label={only ? `${WEEKDAYS_LONG[i]} — the only publishing day, keep at least one` : WEEKDAYS_LONG[i]}
                    onClick={() => toggle(i)}
                  >
                    {d.slice(0, 1)}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="yw-dist__ask">{weeklyCopy}</p>
        )}
        <div className="yw-dist__foot">
          <button
            type="button"
            className="btn btn--primary yw-dist__apply"
            disabled={applying || !count}
            onClick={onApply}
          >
            {applying
              ? 'Distributing…'
              : count
                ? `Distribute ${count} ${count === 1 ? 'post' : 'posts'}`
                : 'Nothing to distribute'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── the week strip — seven day cards ──────────────────────────────────── */
function WeekStrip({ monday, index, metaConnected, onOpen, onPickDay }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDaysLocal(monday, i);
    return { date, row: index.get(ymdKey(date)) || null };
  });
  return (
    <div className="yw-cal">
      <div className="yw-cal__grid" role="tablist" aria-label="This week's posts">
        {days.map(({ date, row }) => {
          const day = row?.day;
          const now = isNowDay(date);
          const st = day ? calStatusOf(day, metaConnected) : null;
          const format = String(day?.format || '').replace(/ series$/, '');
          const time = day ? timeLabelOf(day, row.week) : '';
          const past = !now && date < startOfDay(new Date());
          const wd = WEEKDAYS[(date.getDay() + 6) % 7];
          const cls = ['yw-day'];
          if (now) cls.push('is-today');
          if (!row) cls.push('is-empty');
          if (past) cls.push('is-past');
          return (
            <button
              key={ymdKey(date)}
              type="button"
              className={cls.join(' ')}
              aria-current={now ? 'date' : undefined}
              aria-label={`${wd} ${date.getDate()}${now ? ', today' : ''}: ${day ? `${format} at ${time}` : 'not scheduled'}`}
              onClick={() => (row ? onOpen(row.week, row.dayIndex) : onPickDay(date))}
            >
              <span className="yw-day__when">
                <b>{wd}</b>
                <i>{date.getDate()}</i>
                {now && <em className="yw-day__today">Today</em>}
              </span>
              <span className="yw-day__line">
                {day ? (
                  <>
                    <span className="yw-day__word">{format || 'Post'}</span>
                    <span className="yw-day__sep" aria-hidden="true">·</span>
                    <span className="yw-day__clock">{time}</span>
                  </>
                ) : (
                  <span className="yw-day__none" aria-hidden="true" />
                )}
              </span>
              {st && (
                <span className={`yw-day__ready ${st.tone === 'done' ? 'is-done' : ''}`} aria-hidden="true">
                  <Icon name={st.icon} size={13} strokeWidth={st.tone === 'done' ? 3 : 2.25} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── the day — one post on its own, or an empty day inviting a capture ──── */
function DayPanel({ date, index, metaConnected, onOpen, onCapture }) {
  const row = index.get(ymdKey(date)) || null;
  const day = row?.day;
  const now = isNowDay(date);
  const st = day ? calStatusOf(day, metaConnected) : null;
  const format = String(day?.format || '').replace(/ series$/, '');
  const time = day ? timeLabelOf(day, row.week) : '';
  const cls = ['cal-daycard'];
  if (now) cls.push('is-today');
  if (!row) cls.push('is-empty');
  return (
    <div className="cal-daypanel">
      <div className={cls.join(' ')}>
        {day ? (
          <>
            <div className="cal-daycard__top">
              <span className="cal-daycard__fmt">
                <Icon name={FORMAT_ICON[day.format] || 'brief'} size={18} strokeWidth={2} />
                {format || 'Post'}
              </span>
              {st && (
                <span className={`cal-daycard__badge ${st.tone === 'done' ? 'is-done' : ''}`}>
                  <Icon name={st.icon} size={12} strokeWidth={2.25} />
                  {st.label}
                </span>
              )}
            </div>
            <h2 className="cal-daycard__title">{day.title || day.contentType || 'Planned post'}</h2>
            <div className="cal-daycard__meta">
              <span><Icon name="calendar" size={14} strokeWidth={2} />{longDayLabel(date)}</span>
              {time && <span><Icon name="clock" size={14} strokeWidth={2} />{time}</span>}
            </div>
            <button className="btn btn--primary cal-daycard__open" onClick={() => onOpen(row.week, row.dayIndex)}>
              Open post
            </button>
          </>
        ) : (
          <>
            <h2 className="cal-daycard__title">{longDayLabel(date)}{now ? ' · Today' : ''}</h2>
            <p className="cal-daycard__empty">Nothing planned for this day.</p>
            <button className="btn btn--primary cal-daycard__open" onClick={onCapture}>
              <Icon name="plus" size={15} strokeWidth={2.5} />
              Capture idea
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MonthMoreMenu({ canReplan, canDistribute, replanning, clearing, genBusy, onReplan, onClear, onDistribute }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canReplan && !canDistribute) return <span className="ph__toolbar-end" aria-hidden="true" />;

  return (
    <div className="ph__more" ref={rootRef}>
      <button
        type="button"
        className="btn btn--ghost btn--sm ph__more-btn"
        aria-label="More options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" size={18} strokeWidth={2.25} />
      </button>
      {open && (
        <div className="ph__more-menu" role="menu">
          {canDistribute && (
            <button
              type="button"
              role="menuitem"
              className="ph__more-item"
              onClick={() => { setOpen(false); onDistribute(); }}
            >
              <Icon name="filter" size={14} strokeWidth={2.25} />
              Distribute posts
            </button>
          )}
          {canReplan && (
            <button
              type="button"
              role="menuitem"
              className="ph__more-item"
              disabled={replanning || clearing || genBusy}
              onClick={() => { setOpen(false); onReplan(); }}
            >
              <Icon name="refresh" size={14} strokeWidth={2.25} />
              {replanning ? 'Adding posts…' : 'Fill empty days'}
            </button>
          )}
          {canReplan && (
            <button
              type="button"
              role="menuitem"
              className="ph__more-item ph__more-item--danger"
              disabled={replanning || clearing || genBusy}
              onClick={() => { setOpen(false); onClear(); }}
            >
              <Icon name="trash" size={14} strokeWidth={2.25} />
              {clearing ? 'Clearing…' : 'Clear plan'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function YourPlans() {
  const navigate = useNavigate();
  const location = useLocation();
  const [current, setCurrent] = useState(null);   // the running route (or null)
  const [routes, setRoutes] = useState([]);       // the whole history
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const gen = usePlanGeneration();
  const [view, setView] = useState(() => {
    if (getPlanGeneration().status === 'generating' || getPlanGeneration().status === 'ready') return 'gen';
    if (location.state?.generateAfterCapture) return 'gen';
    return 'list';
  });        // 'list' | 'checkin' | 'gen' | 'week'
  const [selected, setSelected] = useState(null);  // the route open in WeekView
  const [selectedDay, setSelectedDay] = useState(0); // day index inside that week
  const [opening, setOpening] = useState(false);   // fetching one week's full content
  // Cache of full route content (by id), warmed in the background so opening a
  // week is instant. `null` marks an in-flight prefetch.
  const fullCacheRef = useRef(new Map());
  const prefetchWeek = (id) => {
    if (!id || fullCacheRef.current.has(id)) return;
    fullCacheRef.current.set(id, null);
    getPost(id)
      .then((full) => { if (full?._id === id) fullCacheRef.current.set(id, postToRoute(full)); else fullCacheRef.current.delete(id); })
      .catch(() => fullCacheRef.current.delete(id));
  };
  const [replanning, setReplanning] = useState(false);
  const [clearing, setClearing] = useState(false);
  // The calendar's focal date drives all three views: the month it falls in,
  // the Mon–Sun week around it, or the day itself. `calView` is remembered
  // across visits so the studio lands back in the reading they chose.
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const [calViewStored, setCalView] = useState(() => {
    try { return localStorage.getItem('calView') || 'month'; } catch { return 'month'; }
  });
  /* A phone never lands in Weekly — the menu does not offer it, and a stored
     desktop preference must not trap them there (bauhly-v3). */
  const phoneWidth = useMediaQuery('(max-width: 767px)');
  const calView = (phoneWidth && calViewStored === 'week') ? 'day' : calViewStored;
  const [forceWorkspace, setForceWorkspace] = useState(false);
  const feedOn = phoneWidth && calView === 'day' && !forceWorkspace;
  const [feedIso, setFeedIso] = useState(null);
  const [feedScrollIso, setFeedScrollIso] = useState(null);
  // The Distribute panel (opened from the ⋯) and the publishing-day pattern it
  // edits. The pattern is per handle; it drives the calendar's Posting columns.
  const [distOpen, setDistOpen] = useState(false);
  const [dist, setDist] = useState(DIST_DEFAULT);
  const [distributing, setDistributing] = useState(false);
  // The Weekly / Day views embed WeekView (the post workspace). `embedWeek` is
  // the built week route + which day to open; `embedDay` is the post WeekView is
  // currently showing (so the toolbar can name the day it is on).
  const [embedWeek, setEmbedWeek] = useState(null);
  const [embedDay, setEmbedDay] = useState(null);
  // Week 0 returns before the rest of the month finishes — poll until stubs land.
  const [monthFilling, setMonthFilling] = useState(false);
  const fillWatchRef = useRef(null);
  const captureGenStarted = useRef(false);
  const projects = useProjects({ autoLoad: false });
  const { user } = useAuth();
  const [brandGaps, setBrandGaps] = useState([]);
  const [brandReportId, setBrandReportId] = useState(null);
  const [metaStatus, setMetaStatus] = useState(null);

  async function reload() {
    // One list call paints the calendar; the "current" post + preparing are
    // derived from it (preparing is included on GET /posts). Each post is wrapped
    // as a synthetic one-day route so the calendar/editor keep working. Meta +
    // projects load after.
    const data = await getPosts().catch(() => ({ posts: [], preparing: false }));
    const all = (data.posts || []).map(postToRoute);
    setRoutes(all);
    setCurrent(pickCurrentRoute(all));
    setPreparing(Boolean(data.preparing));
    return { current: pickCurrentRoute(all), routes: all };
  }

  function stopMonthFillWatch() {
    if (fillWatchRef.current) {
      clearInterval(fillWatchRef.current);
      fillWatchRef.current = null;
    }
    setMonthFilling(false);
  }

  // Post-centric generation writes all its posts in one pass (no background
  // next-month stubs to wait for), so there is nothing to poll — one reload
  // after generation is enough. Kept as a no-op so call sites stay simple.
  function startMonthFillWatch() {
    stopMonthFillWatch();
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
    return () => stopMonthFillWatch();
  }, []);

  // Load the publishing-day pattern for the active handle (it switches with the
  // header account). localStorage is the source of truth, so a background reload
  // that re-runs this reads back whatever the panel last saved.
  const activeHandle = current?.instagramUsername || routes[0]?.instagramUsername || '';
  useEffect(() => { setDist(readDist(activeHandle)); }, [activeHandle]);

  function saveDist(next) {
    setDist(next);
    try { localStorage.setItem(distStorageKey(activeHandle), JSON.stringify(next)); } catch { /* private mode — the session value holds */ }
  }

  // Build WeekView embed for Weekly / desktop Day / phone feed→editor.
  const embedKey = view !== 'list' || (feedOn && !forceWorkspace)
    ? ''
    : (calView === 'day' || forceWorkspace)
      ? ymdKey(anchorDate)
      : calView === 'week'
        ? mondayKey(anchorDate)
        : '';
  useEffect(() => {
    if (loading || view !== 'list' || calView === 'month') { setEmbedWeek(null); return undefined; }
    let cancelled = false;
    setEmbedWeek(null);
    // Weekly always stages a real post; Day view may open on an empty date.
    buildEmbedWeek(anchorDate, { preferPost: calView === 'week' }).then((r) => {
      if (!cancelled) setEmbedWeek(r);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calView, embedKey, loading, view, activeHandle]);

  // After the grid can paint: meta (schedule badges) + lite projects (NeedsAWord).
  // Skips a forced /projects refresh when the store is already hydrated.
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      getMetaStatus().then((meta) => { if (!cancelled) setMetaStatus(meta); }).catch(() => {});
      ensureProjects({ lite: true }).catch(() => {});
    };
    const ric = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(run, { timeout: 2000 })
      : setTimeout(run, 0);
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === 'function' && typeof ric === 'number') {
        try { window.cancelIdleCallback(ric); } catch { /* ignore */ }
      } else {
        clearTimeout(ric);
      }
    };
  }, [loading]);

  // Full week bodies load on hover/intent (or on open) — not on every Calendar visit.

  // After Connect with Meta, reopen the week we left so a handle mismatch is obvious.
  useEffect(() => {
    if (loading) return;
    const result = peekMetaOAuthResult();
    if (!result?.weekId) {
      if (location.state?.metaOAuth) navigate('/dashboard', { replace: true, state: {} });
      return;
    }
    if (location.state?.metaOAuth) navigate('/dashboard', { replace: true, state: {} });
    const week = (routes || []).find((r) => String(r._id) === String(result.weekId));
    if (!week) return;
    open(week, Number(result.day) || 0);
    takeMetaOAuthResult();
  }, [loading, location.state, routes, navigate]);

  // Refresh when the user comes back to this tab (covers the "switch and return" case).
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') reload().catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  // If the list already looks mid-fill (written weeks, no stubs yet), keep polling.
  useEffect(() => {
    if (loading || monthFilling || fillWatchRef.current) return;
    const written = (routes || []).filter((r) => !r.draft);
    const drafts = (routes || []).filter((r) => r.draft);
    if (!written.length || drafts.length) return;
    const newest = written
      .map((r) => Date.parse(r.generatedAt || r.updatedAt || 0))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => b - a)[0];
    if (newest && Date.now() - newest < 3 * 60 * 1000) {
      startMonthFillWatch();
    }
  }, [loading, routes, monthFilling]);

  useEffect(() => {
    if (view !== 'checkin') return undefined;
    let cancelled = false;
    getBrandDna()
      .then((data) => {
        if (cancelled) return;
        setBrandReportId(data.reportId || null);
        const rows = Array.isArray(data.gaps) ? data.gaps : [];
        setBrandGaps(rows.map((g) => ({
          key: g.key,
          question: g.question || g.missing || '',
          placeholder: g.prompt || 'In your own words…',
        })));
      })
      .catch(() => {
        if (cancelled) return;
        setBrandGaps([]);
        setBrandReportId(null);
      });
    return () => { cancelled = true; };
  }, [view]);

  // PlanLoom is this page's wait; the store keeps the request alive if they leave.
  useEffect(() => {
    setPlanWatching(view === 'gen');
    return () => setPlanWatching(false);
  }, [view]);

  useEffect(() => {
    if (gen.status === 'generating') setView('gen');
  }, [gen.status]);

  useEffect(() => {
    if (gen.status !== 'ready') return undefined;
    const hold = Math.max(0, 1800 - (Date.now() - gen.startedAt));
    const t = setTimeout(async () => {
      if (getPlanGeneration().status !== 'ready') return;
      consumePlanReady();
      await reload();
      // Post-centric: generation drops new posts onto empty calendar slots.
      // Land back on the calendar so they're all visible, rather than opening
      // one week.
      setView('list');
      setReplanning(false);
    }, hold);
    return () => clearTimeout(t);
  }, [gen.status, gen.startedAt]);

  useEffect(() => {
    if (gen.status !== 'error') return;
    setError(gen.error);
    setView('list');
    setReplanning(false);
  }, [gen.status, gen.error]);

  // Re-run the current month's plan (same path as check-in generate).
  async function runGenerate(trigger, extras = {}) {
    setError('');
    setView('gen');
    setPlanWatching(true);
    try {
      await startPlanGeneration(trigger, extras);
    } catch {
      /* store holds the error; the effect above paints it */
    }
  }

  // Capture from Projects lands here with this flag so the plan starts immediately.
  useEffect(() => {
    if (!location.state?.generateAfterCapture || captureGenStarted.current) return;
    captureGenStarted.current = true;
    const extras = {
      sessionId: location.state.sessionId || '',
      captureIds: location.state.captureIds || [],
    };
    const trigger = (extras.sessionId || extras.captureIds.length) ? 'regenerate-session' : 'capture';
    navigate('.', { replace: true, state: {} });
    runGenerate(trigger, extras);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.generateAfterCapture]);

  // Move the upcoming posts onto the chosen publishing days. The backend does
  // the reallocation (it owns the dates + the unique-slot rule) and returns the
  // refreshed calendar, which we fold back in without a second round-trip.
  async function applyDistribute() {
    if (distributing) return;
    setError('');
    setDistributing(true);
    try {
      const data = await distributePosts(dist.mode, dist.days);
      const all = (data.posts || []).map(postToRoute);
      setRoutes(all);
      setCurrent(pickCurrentRoute(all));
      setDistOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || "We couldn't distribute the posts just now. Please try again.");
    } finally {
      setDistributing(false);
    }
  }

  async function onReplanMonth() {
    if (replanning || gen.status === 'generating') return;
    const ok = window.confirm(
      'Add posts to empty days this month from your latest Brand DNA and Capture Idea notes?\n\nDays that already have content stay as they are.',
    );
    if (!ok) return;
    setReplanning(true);
    await runGenerate('replan-month');
  }

  async function onClearMonth() {
    if (clearing || replanning) return;
    const ok = window.confirm(
      'Clear the full calendar? Every unpublished planned post for this account will be deleted, on any date. Already-published posts stay. This cannot be undone.',
    );
    if (!ok) return;
    setError('');
    setClearing(true);
    stopMonthFillWatch();
    try {
      await clearUpcoming();
      await reload();
      setSelected(null);
      setSelectedDay(0);
      setView('list');
    } catch (err) {
      setError(err.response?.data?.message || "We couldn't clear the calendar. Please try again.");
    } finally {
      setClearing(false);
    }
  }

  // The check-in ends here: file what they just told us as a Capture (so the
  // planner reads the understood idea, not a scripted prompt), create a project
  // if they named a new one, then generate.
  async function onCheckinGenerate(pending) {
    setError('');
    setView('gen');
    try {
      let projectId = pending?.project || null;
      if (pending?.newProject) {
        try { projectId = await createProject(pending.newProject); } catch { /* non-fatal */ }
      }
      const text = [pending?.custom, ...(pending?.notes || [])].filter(Boolean).join('\n\n').trim();
      const atts = pending?.attachments || [];
      if (projectId && (text || atts.length)) {
        try {
          await addSession(projectId, {
            type: atts.some((a) => a.type === 'video') && !text ? 'video'
              : atts.length && !text ? 'photo' : 'note',
            text,
            attachments: atts,
            understanding: pending.understanding,
            understandings: pending.understandings,
            conversationSummary: pending.conversationSummary,
            conversationTitle: pending.conversationTitle,
            conversationTurns: pending.conversationTurns,
            sessionKind: 'checkin',
          });
        } catch { /* plan still runs from whatever is already on file */ }
      }
      await runGenerate('checkin');
    } catch (err) {
      setError(err.response?.data?.message || "We couldn't build a plan just now. Please try again.");
      setView('list');
    }
  }

  // the projects the check-in offers, adapted to the shape its cards read
  const ckProjects = (projects || []).map((p) => {
    const n = sessionCount(p);
    return {
      ...p,
      status: 'On file',
      assets: [`${n} ${n === 1 ? 'item' : 'items'}`],
    };
  });

  // ── the check-in conversation ──
  if (view === 'checkin') {
    return (
      <Suspense fallback={<div className="ph"><p className="ph__sub">Loading…</p></div>}>
      <Checkin
        projects={ckProjects}
        filingProjects={ckProjects}
        week={{ focus: current?.focus?.pillar || 'trust' }}
        name={user?.name || ''}
        lastWeek={null}
        lastProjectId={ckProjects[0]?.id || null}
        hasPlanned={Boolean(current) || routes.length > 0}
        brandGaps={brandGaps}
        onFillGap={async (key, text) => {
          if (!brandReportId || !text) return;
          try {
            await reviseBrandDna(brandReportId, text);
          } catch {
            /* plan still runs; memory can be filled on the Business memory page */
          }
        }}
        onGenerate={onCheckinGenerate}
        onCancel={() => setView('list')}
        cancelLabel={current ? "Keep this week's plan" : 'Not now'}
      />
      </Suspense>
    );
  }

  // ── the generation wait ──
  if (view === 'gen') {
    return (
      <Suspense fallback={<div className="ph"><p className="ph__sub">Loading…</p></div>}>
        <PlanLoom />
      </Suspense>
    );
  }

  // ── an opened week (Weekly tab) ──
  if (view === 'week' && selected) {
    return (
      <Suspense fallback={<div className="ph"><p className="ph__sub">Opening…</p></div>}>
      <WeekView
        key={`${selected.instagramUsername || ''}-${selected._id || ''}-${selectedDay}`}
        route={selected}
        initialDay={selectedDay}
        monthWeeks={[]}
        modeSwitch
        onCaptured={() => runGenerate('capture')}
        onRouteChange={(route) => {
          if (!route?._id) return;
          fullCacheRef.current.set(String(route._id), route);
          setSelected((s) => (s?._id === route._id ? route : s));
          setCurrent((c) => (c?._id === route._id ? route : c));
          setRoutes((list) => list.map((r) => (r._id === route._id ? route : r)));
        }}
        onBack={() => {
          setView('list');
          // Background weeks may have finished while this one was open.
          reload().catch(() => {});
        }}
      />
      </Suspense>
    );
  }

  if (loading) {
    return <div className="ph"><p className="ph__sub">Loading your calendar…</p></div>;
  }

  // Fetching one week's full content before showing WeekView.
  if (opening) {
    return <div className="ph"><p className="ph__sub">Opening…</p></div>;
  }

  // ── a plan building in the background after a fresh (re)connect ──
  if (preparing && !current && routes.length === 0) {
    return (
      <div className="ph">
        <NeedsAWord />
        <div className="empty">
          <div className="empty__card">
            <span className="empty__ico"><Icon name="route" size={30} strokeWidth={1.7} /></span>
            <h1 className="empty__title">We're building your first plan</h1>
            <p className="empty__note">One week you didn't have to invent.</p>
            <p className="empty__sub">
              We're reading your account and drafting a week of posts aimed at the stage that moves
              your enquiries most. This takes a moment — check back shortly.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── nothing yet — the branded invitation ──
  if (!current && routes.length === 0) {
    return (
      <div className="ph">
        <NeedsAWord />
        <div className="empty">
          <div className="empty__card">
            <span className="empty__ico"><Icon name="route" size={30} strokeWidth={1.7} /></span>
            <h1 className="empty__title">You don't have a plan yet</h1>
            <p className="empty__note">Every Monday, one week you didn't have to invent.</p>
            <p className="empty__sub">
              A week of posts built from your own work and aimed at the stage that moves your
              enquiries most — each with a reason behind it.
            </p>
            {error && <p className="ph__sub" style={{ color: 'var(--negative)' }}>{error}</p>}
            <button className="btn btn--primary" onClick={() => { ensureProjects(); setView('checkin'); }}>Let's plan your week</button>
          </div>
        </div>
      </div>
    );
  }

  // The Calendar list carries no day content (projected out for speed). Opening a
  // week fetches just that route's full content; routes that already have content
  // (e.g. a freshly generated one) pass through without a round-trip.
  // A function declaration (hoisted) so effects defined earlier — and the
  // generation-ready handler that runs while the component has early-returned on
  // the "gen"/"week" views — can call it without a TDZ error.
  // Open the Weekly view for a post: show its WHOLE calendar week (Mon–Sun) as
  // the day rail, with the clicked post auto-selected. Each day is an
  // independent post, so we gather the week's posts from the loaded list and
  // fetch their full content (using the prefetch cache when warm).
  // Gather a whole Mon–Sun week around `anchor` — always seven day slots, with
  // full post content where a post exists and empty calendar placeholders where
  // it does not (bauhly-v3 DaySelector draws seven equal cards). Open on the
  // anchor's weekday, whether or not that day has a post.
  // The one builder behind both the embedded Weekly/Day views and the
  // full-screen open() (meta-OAuth return).
  async function buildEmbedWeek(anchor, { preferPost = true } = {}) {
    const base = anchor instanceof Date ? anchor : (parseIsoDay(anchor) || new Date());
    const mon = startOfDay(mondayOf(base));
    const sun = startOfDay(addDaysLocal(mon, 6));
    const handle = activeHandle;
    const weekRoutes = (routes || [])
      .filter((r) => {
        const d = parseIsoDay(r.days?.[0]?.date);
        return d && startOfDay(d) >= mon && startOfDay(d) <= sun;
      })
      .sort((a, b) => (parseIsoDay(a.days?.[0]?.date)?.getTime() || 0) - (parseIsoDay(b.days?.[0]?.date)?.getTime() || 0));
    const byYmd = new Map();
    await Promise.all(weekRoutes.map(async (r) => {
      const cached = fullCacheRef.current.get(r._id);
      let post = cached?.days?.[0]?.content ? cached.days[0] : null;
      if (!post) {
        const p = await getPost(r._id).catch(() => null);
        if (p) fullCacheRef.current.set(r._id, postToRoute(p));
        post = p || r.days?.[0] || null;
      }
      if (!post) return;
      const d = parseIsoDay(post.date);
      if (d) byYmd.set(ymdKey(d), post);
    }));
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDaysLocal(mon, i);
      const existing = byYmd.get(ymdKey(date));
      if (existing) return existing;
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return {
        empty: true,
        date: iso,
        day: WEEKDAYS_LONG[i],
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      };
    });
    const anchorKey = ymdKey(base);
    let idx = days.findIndex((p) => ymdKey(parseIsoDay(p.date)) === anchorKey);
    if (idx < 0) idx = Math.min(6, Math.max(0, Math.round((startOfDay(base) - mon) / 86400000)));
    // Weekly always stages a real post; Day view may keep an empty anchor.
    if (preferPost && days[idx]?.empty) {
      const first = days.findIndex((p) => !p.empty);
      if (first >= 0) idx = first;
    }
    return {
      route: { _id: `week-${handle}-${mondayKey(mon)}`, instagramUsername: handle, days },
      dayIndex: idx,
    };
  }

  async function open(clicked, _dayIndex = 0) {
    const clickedPost = clicked?.days?.[0] || clicked;
    const base = parseIsoDay(clickedPost?.date) || new Date();
    setOpening(true);
    const { route: weekRoute, dayIndex } = await buildEmbedWeek(base);
    setOpening(false);
    setSelected(weekRoute);
    setSelectedDay(dayIndex);
    setView('week');
  }

  // Month "Open post" / double-click → Day view on that date (bauhly-v3 openDay).
  // Never Weekly: the month names a day; Weekly is only via the View menu.
  function goToPost(clicked) {
    const post = clicked?.days?.[0] || clicked;
    const d = parseIsoDay(post?.date);
    if (d) setAnchorDate(startOfDay(d));
    if (phoneWidth && !forceWorkspace) {
      /* Phone Day view is the feed — land on that post. From the feed itself
         the caller sets forceWorkspace first so we open the editor. */
      const iso = d
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        : '';
      pickView('day');
      if (iso) {
        setFeedIso(iso);
        setFeedScrollIso(`${iso}#${Date.now()}`);
      }
      return;
    }
    pickView('day');
  }

  const now = new Date();
  // Every post is a synthetic one-day route wrapped by postToRoute; buildPostIndex
  // lays each onto its own calendar day, and all three views read from that index.
  const postIndex = buildPostIndex(routes);
  const postDates = postDatesOf(postIndex);
  const isCurrentView = anchorDate.getFullYear() === now.getFullYear() && anchorDate.getMonth() === now.getMonth();
  const canReplan = isCurrentView && routes.length > 0;
  const calendarHandle = current?.instagramUsername || routes[0]?.instagramUsername;
  const calendarMetaConnected = isMetaConnectedFor(metaStatus, calendarHandle);

  // The posts the distribution will move: strictly after today, not published,
  // not scheduled (matches the backend's "movable" set exactly, so the count the
  // panel names equals the number that actually move).
  const toPlace = routes.filter((r) => {
    const d = r.days?.[0];
    const date = parseIsoDay(d?.date);
    if (!date || startOfDay(date) <= startOfDay(now)) return false;
    if (d?.published || d?.scheduledAt || d?.savedForReview) return false;
    return Boolean(String(d?.title || '').trim() || String(d?.format || '').trim());
  }).length;
  const postingSet = postingSetOf(dist, toPlace);
  const weeklyCopy = toPlace
    ? `We'll spread your ${toPlace} ${toPlace === 1 ? 'post' : 'posts'} evenly across the available weeks. If those weeks are full, we'll continue into the next month.`
    : 'Nothing left to spread — every upcoming post already has a date.';

  const weekMonday = mondayOf(anchorDate);
  // In Day view the workspace owns which post is on screen; the toolbar names
  // that day (from `embedDay`), falling back to the anchor before it loads.
  const dayLabelDate = (feedOn && feedIso && parseIsoDay(feedIso))
    || (calView === 'day' && parseIsoDay(embedDay?.date))
    || anchorDate;
  // The period label + the Today button both answer "where am I" in each view's
  // own terms: a month it contains, the week it falls in, or the day it is. The
  // Weekly view names the month (its strip carries the days), like the reference.
  const periodLabel = calView === 'month'
    ? `${MONTHS[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`
    : calView === 'week'
      ? `${MONTHS[weekMonday.getMonth()]} ${weekMonday.getFullYear()}`
      : `${MONTHS[dayLabelDate.getMonth()].slice(0, 3)} ${dayLabelDate.getDate()}`;
  const dayWeekdayLabel = WEEKDAYS_LONG[(dayLabelDate.getDay() + 6) % 7].slice(0, 3);
  const atToday = calView === 'month'
    ? isCurrentView
    : calView === 'week'
      ? ymdKey(weekMonday) === ymdKey(mondayOf(now))
      : isNowDay(dayLabelDate);

  const pickView = (v) => {
    const next = (phoneWidth && v === 'week') ? 'day' : v;
    setForceWorkspace(false);
    setCalView(next);
    try { localStorage.setItem('calView', next); } catch { /* private mode — the default holds */ }
  };

  // The Day view steps between scheduled posts (skipping empty days); month and
  // week step by a whole period. Everything moves the one anchor date.
  const stepDayDate = (from, delta) => {
    const cur = startOfDay(from);
    if (delta > 0) {
      const nxt = postDates.find((pd) => startOfDay(pd) > cur);
      if (nxt) return startOfDay(nxt);
    } else {
      const prev = [...postDates].reverse().find((pd) => startOfDay(pd) < cur);
      if (prev) return startOfDay(prev);
    }
    return startOfDay(addDaysLocal(from, delta));
  };
  const stepPeriod = (delta) => {
    setAnchorDate((d) => {
      if (calView === 'month') {
        const day = Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + delta + 1, 0).getDate());
        const n = new Date(d.getFullYear(), d.getMonth() + delta, day);
        n.setHours(0, 0, 0, 0);
        return n;
      }
      if (calView === 'week') return startOfDay(addDaysLocal(d, delta * 7));
      return stepDayDate(d, delta);
    });
  };
  const goToday = () => {
    const today = startOfDay(new Date());
    setAnchorDate(today);
    if (feedOn) {
      const isoOfDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const todayIso = isoOfDate(today);
      const hit = postDates.find((pd) => isoOfDate(startOfDay(pd)) === todayIso)
        || postDates.find((pd) => startOfDay(pd) >= today)
        || postDates[postDates.length - 1];
      if (hit) {
        const iso = isoOfDate(startOfDay(hit));
        setFeedIso(iso);
        setFeedScrollIso(`${iso}#${Date.now()}`); /* force scroll even if same iso */
      }
    }
  };
  // Pressing an empty day in the month or week drills into it in Day view.
  const goDay = (date) => { setAnchorDate(startOfDay(date)); pickView('day'); };

  const feedItems = [...postIndex.values()];

  return (
    <div className={`ph ph--cal ph--cal-${calView}${feedOn ? ' ph--cal-feed' : ''}`}>
      {/* Month keeps the Calendar title. Weekly / Day promote the period label
          to the title (bauhly-v3). Capture lives in the sidebar. */}
      {calView === 'month' && !phoneWidth && (
        <div className="ph__head">
          <div className="ph__headrow">
            <h1 className="ph__title">Calendar</h1>
          </div>
          {error && <p className="ph__sub" style={{ color: 'var(--negative)' }}>{error}</p>}
        </div>
      )}
      {calView === 'month' && phoneWidth && error && (
        <p className="ph__sub" style={{ color: 'var(--negative)' }}>{error}</p>
      )}
      {calView !== 'month' && error && (
        <p className="ph__sub" style={{ color: 'var(--negative)' }}>{error}</p>
      )}

      <NeedsAWord />

      <div className="cal-bar">
        <div className="cal-bar__left">
          <h2 className="cal-period">
            {periodLabel}
            {(calView === 'day' || feedOn) && (
              <span className="cal-period__day"><span className="cal-period__div">|</span>{dayWeekdayLabel}</span>
            )}
          </h2>
          <span className={`cal-nav${feedOn ? ' cal-nav--feed' : ''}`}>
            {!feedOn && (
              <button
                type="button"
                className="cal-nav__arrow"
                onClick={() => stepPeriod(-1)}
                aria-label={`Previous ${calView === 'month' ? 'month' : calView === 'week' ? 'week' : 'post'}`}
              >
                <Icon name="chevron-left" size={16} strokeWidth={2.25} />
              </button>
            )}
            <button
              type="button"
              className="cal-nav__today"
              onClick={goToday}
              disabled={atToday && !feedOn}
              aria-current={atToday ? 'date' : undefined}
            >
              Today
            </button>
            {!feedOn && (
              <button
                type="button"
                className="cal-nav__arrow"
                onClick={() => stepPeriod(1)}
                aria-label={`Next ${calView === 'month' ? 'month' : calView === 'week' ? 'week' : 'post'}`}
              >
                <Icon name="chevron-right" size={16} strokeWidth={2.25} />
              </button>
            )}
          </span>
        </div>

        <div className="cal-bar__right">
          <ViewMenu value={calView} onPick={pickView} />
          <MonthMoreMenu
            canReplan={canReplan}
            canDistribute={routes.length > 0}
            replanning={replanning}
            clearing={clearing}
            genBusy={gen.status === 'generating'}
            onReplan={onReplanMonth}
            onClear={onClearMonth}
            onDistribute={() => setDistOpen(true)}
          />
          <DistributePanel
            open={distOpen}
            onClose={() => setDistOpen(false)}
            count={toPlace}
            mode={dist.mode}
            days={dist.days.length ? dist.days : DIST_DEFAULT.days}
            onMode={(m) => saveDist({ ...dist, mode: m })}
            onDays={(d) => saveDist({ ...dist, days: d })}
            weeklyCopy={weeklyCopy}
            onApply={applyDistribute}
            applying={distributing}
          />
        </div>
      </div>

      <div className="ph__list">
        {monthFilling && isCurrentView && calView === 'month' && (
          <p className="ph__usage ph__usage--filling">Writing the rest of this month…</p>
        )}
        <div className="cal-plan" key={calView === 'month' ? `m-${anchorDate.getFullYear()}-${anchorDate.getMonth()}` : (feedOn ? 'feed' : calView)}>
          {calView === 'month' ? (
            <MonthView
              anchor={anchorDate}
              index={postIndex}
              metaConnected={calendarMetaConnected}
              posting={postingSet}
              previewOn={distOpen}
              handle={activeHandle}
              phone={phoneWidth}
              onOpen={(route) => goToPost(route)}
              onPickDay={goDay}
              onDistribute={() => setDistOpen(true)}
              onPatchPost={(post) => {
                if (!post?._id) return;
                const next = postToRoute(post);
                fullCacheRef.current.set(String(post._id), next);
                setRoutes((list) => list.map((r) => (String(r._id) === String(post._id) ? next : r)));
                setCurrent((c) => (c && String(c._id) === String(post._id) ? next : c));
              }}
            />
          ) : feedOn ? (
            <DayFeed
              items={feedItems}
              handle={activeHandle}
              metaConnected={calendarMetaConnected}
              onOpen={(row) => {
                const post = row.week || row.day;
                const d = parseIsoDay(post?.date || row.date);
                if (d) setAnchorDate(startOfDay(d));
                setForceWorkspace(true);
              }}
              onIso={(iso) => {
                setFeedIso(iso);
                const d = parseIsoDay(iso);
                if (d) setAnchorDate(startOfDay(d));
              }}
              scrollToIso={feedScrollIso}
            />
          ) : embedWeek ? (
            <Suspense fallback={<div className="ph"><p className="ph__sub">Opening…</p></div>}>
              <WeekView
                key={`${embedWeek.route._id}-${calView}-${forceWorkspace ? 'edit' : ''}`}
                route={embedWeek.route}
                initialDay={embedWeek.dayIndex}
                monthWeeks={[]}
                embedded
                hideStrip={calView === 'day' || forceWorkspace}
                onDayChange={(d) => setEmbedDay(d)}
                onDistribute={() => setDistOpen(true)}
                onCaptured={() => runGenerate('capture')}
                onRouteChange={(route) => {
                  const byId = new Map();
                  (route?.days || []).forEach((p) => { if (p?._id) byId.set(String(p._id), postToRoute(p)); });
                  if (!byId.size) return;
                  byId.forEach((w, id) => fullCacheRef.current.set(id, w));
                  setRoutes((list) => list.map((r) => byId.get(String(r._id)) || r));
                  setCurrent((c) => (c && byId.get(String(c._id))) || c);
                }}
                onBack={() => {
                  if (forceWorkspace) setForceWorkspace(false);
                  else pickView('month');
                }}
              />
            </Suspense>
          ) : (
            <div className="ph"><p className="ph__sub">Opening…</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
