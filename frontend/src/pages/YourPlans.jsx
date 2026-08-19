/*
 * Your Plans — the page you land on.
 *
 * A month calendar of planned posts. You land on this month and can move
 * between months. Opening a day shows its seven-day route (WeekView).
 * "Capture idea" runs generation behind the RouteLoom stage (PlanLoom).
 *
 * Backend-wired: GET /routes/current (running plan for the active Instagram handle),
 * GET /routes (that handle's history), POST /routes/generate (build the next one).
 * Switching accounts in the header reloads; both endpoints follow the active handle.
 */

import React, { useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { getCurrentRoute, getRoutes, generateRoute, clearCurrentMonth } from '../api/routes';
import { useNavigate, useLocation } from 'react-router-dom';
import { useProjects, createProject, refreshProjects, addEntry } from '../lib/projectsStore';
import { CaptureChat } from './Projects';
import { useAuth } from '../context/AuthContext';
import WeekView from './WeekView';
import PlanLoom from './PlanLoom';
import Checkin from './checkin/Checkin';
import NeedsAWord from '../components/NeedsAWord';
import './plans.css';
import './yourweek.css'; /* the shared .empty brand-moment styles */

const FORMAT_ICON = { Reel: 'play', Carousel: 'copy', Post: 'image', Story: 'bookmark' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/* Sum LLM usage across written weeks in a month group. */
function monthUsageOf(weeks) {
  const written = (weeks || []).filter((w) => !w.draft && w.usage);
  if (!written.length) return null;
  const inputTokens = written.reduce((n, w) => n + (Number(w.usage?.inputTokens) || 0), 0);
  const outputTokens = written.reduce((n, w) => n + (Number(w.usage?.outputTokens) || 0), 0);
  const estimatedCostUsd = written.reduce((n, w) => n + (Number(w.usage?.estimatedCostUsd) || 0), 0);
  const totalTokens = inputTokens + outputTokens;
  if (!totalTokens && !estimatedCostUsd) return null;
  return { inputTokens, outputTokens, totalTokens, estimatedCostUsd, weekCount: written.length };
}

function fmtTokens(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function fmtCost(usd) {
  if (usd == null || Number.isNaN(usd)) return '—';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
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

/* Calendar date of day `index` in a week — Monday + offset, local noon so
 * an IST-stamped UTC midnight doesn't slip to the previous day. */
function dayDateOf(week, index) {
  const base = week?.startsAt || week?.weekOf;
  if (!base) return null;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + (Number(index) || 0));
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
      rows.push({ week, day, dayIndex: i, date: dayDateOf(week, i) });
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

/* Monday-first month grid for `group`, with planned posts mapped onto dates.
 * Leading/trailing days from the neighbouring month fill complete weeks. */
function calendarCellsOf(group, dayRows) {
  const anchor = group?.start ? new Date(group.start) : new Date();
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1, 12, 0, 0, 0);
  const lastDate = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const byYmd = new Map();
  (dayRows || []).forEach((row) => {
    if (!row.date) return;
    byYmd.set(ymdKey(row.date), row);
  });
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

function MonthCalendar({ group, days, onOpen }) {
  const cells = calendarCellsOf(group, days);
  return (
    <div className="ph-cal">
      <div className="ph-cal__weekdays" aria-hidden="true">
        {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="ph-cal__grid">
        {cells.map((cell) => {
          const row = cell.post;
          const day = row?.day;
          const now = isNowDay(cell.date);
          const done = !!day?.published;
          const scheduled = !done && !!day?.scheduledAt;
          const format = String(day?.format || '').replace(/ series$/, '');
          const title = (day?.title || day?.contentType || '').trim();
          const clickable = Boolean(row);
          const cls = ['ph-cal__cell'];
          if (!cell.inMonth) cls.push('is-out');
          if (now) cls.push('is-now');
          if (done) cls.push('is-done');
          if (clickable) cls.push('is-post');
          const label = `${cell.date.getDate()} ${MONTHS[cell.date.getMonth()]}${title ? `, ${title}` : format ? `, ${format}` : ''}`;
          const inner = (
            <>
              <span className="ph-cal__num">{cell.date.getDate()}</span>
              {(done || scheduled) && (
                <span className={`ph-cal__mark${scheduled ? ' is-clock' : ''}`} aria-hidden="true">
                  <Icon name={done ? 'check' : 'clock'} size={11} strokeWidth={done ? 2.5 : 2.25} />
                </span>
              )}
              {clickable && (
                <span className="ph-cal__body">
                  {format && (
                    <span className="ph-cal__fmt">
                      <Icon name={FORMAT_ICON[format] || 'image'} size={11} strokeWidth={2.25} />
                      <span className="ph-cal__fmtword">{format}</span>
                    </span>
                  )}
                  {title ? <span className="ph-cal__title">{title}</span> : null}
                </span>
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

export default function YourPlans() {
  const navigate = useNavigate();
  const location = useLocation();
  const [current, setCurrent] = useState(null);   // the running route (or null)
  const [routes, setRoutes] = useState([]);       // the whole history
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState(location.state?.generateAfterCapture ? 'gen' : 'list');        // 'list' | 'checkin' | 'gen' | 'week'
  const [selected, setSelected] = useState(null);  // the route open in WeekView
  const [selectedDay, setSelectedDay] = useState(0); // day index inside that week
  const [capturing, setCapturing] = useState(false); // the Capture idea flow
  const [replanning, setReplanning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [calCursor, setCalCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  // Week 0 returns before the rest of the month finishes — poll until stubs land.
  const [monthFilling, setMonthFilling] = useState(false);
  const fillWatchRef = useRef(null);
  const captureGenStarted = useRef(false);
  const projects = useProjects();
  const { user } = useAuth();

  async function reload() {
    const [cur, all] = await Promise.all([
      getCurrentRoute().catch(() => ({ route: null, preparing: false })),
      getRoutes().catch(() => []),
    ]);
    setCurrent(cur.route || null);
    setPreparing(Boolean(cur.preparing));
    setRoutes(all);
    return { current: cur.route || null, routes: all };
  }

  function stopMonthFillWatch() {
    if (fillWatchRef.current) {
      clearInterval(fillWatchRef.current);
      fillWatchRef.current = null;
    }
    setMonthFilling(false);
  }

  // Poll until the running month has the expected written weeks (and preferably
  // next-month stubs), so the list fills without a tab switch.
  function startMonthFillWatch(expectedWeeks = null) {
    stopMonthFillWatch();
    setMonthFilling(true);
    let tries = 0;
    const target = Number(expectedWeeks) || 0;
    fillWatchRef.current = setInterval(async () => {
      tries += 1;
      try {
        const { routes: all } = await reload();
        const written = (all || []).filter((r) => !r.draft);
        const drafts = (all || []).filter((r) => r.draft);
        const now = new Date();
        const monthWritten = written.filter((r) => {
          const d = new Date(r.startsAt || r.weekOf);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
        const haveEnough = target > 0
          ? monthWritten.length >= target
          : drafts.length > 0;
        // Stubs are written after the parallel weeks — either signal means done.
        if ((haveEnough && drafts.length > 0) || (haveEnough && tries >= 8) || tries >= 48) {
          stopMonthFillWatch();
        }
      } catch {
        if (tries >= 48) stopMonthFillWatch();
      }
    }, 2500);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
    // Fresh projects so wordless photo questions show up on this page.
    refreshProjects().catch(() => {});
    return () => stopMonthFillWatch();
  }, []);

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

  // Re-run the current month's plan (same path as check-in generate).
  async function runGenerate(trigger) {
    setError('');
    setCapturing(false);
    setView('gen');
    const startedAt = Date.now();
    try {
      const data = await generateRoute(trigger);
      const route = data.route || data;
      const hold = Math.max(0, 1800 - (Date.now() - startedAt));
      setTimeout(async () => {
        await reload();
        setSelected(route);
        setSelectedDay(0);
        setView('week');
        startMonthFillWatch(data.expectedWeeks);
      }, hold);
    } catch (err) {
      setError(err.response?.data?.message || "We couldn't build a plan just now. Please try again.");
      setView('list');
      setReplanning(false);
    }
  }

  // Capture from Projects lands here with this flag so the plan starts immediately.
  useEffect(() => {
    if (!location.state?.generateAfterCapture || captureGenStarted.current) return;
    captureGenStarted.current = true;
    navigate('.', { replace: true, state: {} });
    runGenerate('capture');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.generateAfterCapture]);

  async function onReplanMonth() {
    if (replanning) return;
    const ok = window.confirm(
      'Add posts to empty days this month from your latest Brand DNA and Capture Idea notes?\n\nDays that already have content stay as they are.',
    );
    if (!ok) return;
    setError('');
    setReplanning(true);
    setView('gen');
    const startedAt = Date.now();
    try {
      const data = await generateRoute('replan-month');
      const route = data.route || data;
      const hold = Math.max(0, 1800 - (Date.now() - startedAt));
      setTimeout(async () => {
        await reload();
        setSelected(route);
        setSelectedDay(0);
        setView('week');
        setReplanning(false);
        startMonthFillWatch(data.expectedWeeks);
      }, hold);
    } catch (err) {
      setError(err.response?.data?.message || "We couldn't replan this month. Please try again.");
      setView('list');
      setReplanning(false);
    }
  }

  async function onClearMonth() {
    if (clearing || replanning) return;
    const ok = window.confirm(
      'Clear this month’s plan? The posts on this calendar will be deleted, along with next month’s scheduled weeks. Past months stay. This cannot be undone.',
    );
    if (!ok) return;
    setError('');
    setClearing(true);
    stopMonthFillWatch();
    try {
      await clearCurrentMonth();
      await reload();
      setSelected(null);
      setSelectedDay(0);
      setView('list');
    } catch (err) {
      setError(err.response?.data?.message || "We couldn't clear this month’s plan. Please try again.");
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
          await addEntry(projectId, {
            type: atts.some((a) => a.type === 'video') && !text ? 'video'
              : atts.length && !text ? 'photo' : 'note',
            text,
            attachments: atts,
            understanding: pending.understanding || undefined,
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
  const ckProjects = (projects || []).map((p) => ({
    ...p,
    status: 'On file',
    assets: [`${(p.captures || []).length} ${(p.captures || []).length === 1 ? 'item' : 'items'}`],
  }));

  // ── the check-in conversation ──
  if (view === 'checkin') {
    return (
      <Checkin
        projects={ckProjects}
        filingProjects={ckProjects}
        week={{ focus: current?.focus?.pillar || 'trust' }}
        name={user?.name || ''}
        lastWeek={null}
        lastProjectId={ckProjects[0]?.id || null}
        hasPlanned={Boolean(current) || routes.length > 0}
        brandGaps={[]}
        onGenerate={onCheckinGenerate}
        onCancel={() => setView('list')}
        cancelLabel={current ? "Keep this week's plan" : 'Not now'}
      />
    );
  }

  // ── the generation wait ──
  if (view === 'gen') return <PlanLoom />;

  // ── an opened plan ──
  if (view === 'week' && selected) {
    return (
      <WeekView
        key={`${selected.instagramUsername || ''}-${selected._id || ''}-${selectedDay}`}
        route={selected}
        initialDay={selectedDay}
        monthWeeks={monthWeeksOf(routes, selected)}
        onOpenWeek={(week) => { setSelected(week); setSelectedDay(0); }}
        onCaptured={() => runGenerate('capture')}
        onBack={() => {
          setView('list');
          // Background weeks may have finished while this one was open.
          reload().catch(() => {});
        }}
      />
    );
  }

  if (loading) {
    return <div className="ph"><p className="ph__sub">Loading your plans…</p></div>;
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
            <button className="btn btn--primary" onClick={() => setView('checkin')}>Let's plan your week</button>
          </div>
        </div>
      </div>
    );
  }

  const open = (route, dayIndex = 0) => {
    setSelected(route);
    setSelectedDay(dayIndex);
    setView('week');
  };

  const now = new Date();
  const isCurrentView = calCursor.year === now.getFullYear() && calCursor.month === now.getMonth();
  const monthWeeks = weeksOverlappingMonth(routes, calCursor.year, calCursor.month);
  const writtenMonthWeeks = monthWeeks.filter((w) => !w.draft);
  const monthDays = monthDaysOf(writtenMonthWeeks);
  const inMonthDayCount = monthDays.filter((row) => (
    row.date
    && row.date.getMonth() === calCursor.month
    && row.date.getFullYear() === calCursor.year
  )).length;
  const usage = monthUsageOf(writtenMonthWeeks);
  const canReplan = isCurrentView && writtenMonthWeeks.length > 0;
  const monthLabel = `${MONTHS[calCursor.month]} ${calCursor.year}`;
  const calGroup = { start: new Date(calCursor.year, calCursor.month, 1, 12, 0, 0, 0) };

  const shiftMonth = (delta) => {
    setCalCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  return (
    <div className="ph">
      <div className="ph__head">
        <div className="ph__headrow">
          <h1 className="ph__title">Your plans</h1>
          <div className="ph__headacts">
            <button className="btn btn--primary btn--sm ph__new" onClick={() => setCapturing(true)}>
              <Icon name="plus" size={15} strokeWidth={2.5} />
              Capture idea
            </button>
          </div>
        </div>
        <p className="ph__sub">
          Open a day to work on that post. Use the arrows to look at other months.
        </p>
        {error && <p className="ph__sub" style={{ color: 'var(--negative)' }}>{error}</p>}
      </div>

      <NeedsAWord />

      <div className="ph__list">
        <section className="ph__group">
          <div className="ph__month">
            <h3 className="ph__monthhead">
              <span className="ph__monthnav">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm ph__monthnav-btn"
                  onClick={() => shiftMonth(-1)}
                  aria-label="Previous month"
                >
                  <Icon name="chevron-left" size={16} strokeWidth={2.25} />
                </button>
                <span className="ph__monthnav-label">{monthLabel}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm ph__monthnav-btn"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                >
                  <Icon name="chevron-right" size={16} strokeWidth={2.25} />
                </button>
              </span>
              {canReplan && (
                <span className="ph__monthacts">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm ph__replan"
                    disabled={replanning || clearing}
                    onClick={onReplanMonth}
                  >
                    <Icon name="refresh" size={14} strokeWidth={2.25} />
                    {replanning ? 'Adding posts…' : 'Fill empty days'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm ph__clear"
                    disabled={replanning || clearing}
                    onClick={onClearMonth}
                  >
                    <Icon name="trash" size={14} strokeWidth={2.25} />
                    {clearing ? 'Clearing…' : 'Clear plan'}
                  </button>
                </span>
              )}
            </h3>
            {monthFilling && isCurrentView && (
              <p className="ph__usage ph__usage--filling">Writing the rest of this month…</p>
            )}
            {usage && (
              <p className="ph__usage" title="Estimated from Anthropic token usage for written weeks in this month">
                <span>{fmtTokens(usage.totalTokens)} tokens</span>
                <span aria-hidden="true">·</span>
                <span>~{fmtCost(usage.estimatedCostUsd)} est.</span>
                <span aria-hidden="true">·</span>
                <span>{usage.weekCount} {usage.weekCount === 1 ? 'week' : 'weeks'}</span>
                {inMonthDayCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{inMonthDayCount} {inMonthDayCount === 1 ? 'day' : 'days'}</span>
                  </>
                )}
                {monthFilling && isCurrentView ? <span className="ph__usage-live"> · updating</span> : null}
              </p>
            )}
            <MonthCalendar
              group={calGroup}
              days={monthDays}
              onOpen={open}
            />
          </div>
        </section>
      </div>

      {capturing && (
        <CaptureChat
          defaultProjectId={projects[0]?.id}
          exitLabel="Back to plans"
          onExit={() => setCapturing(false)}
          onViewProject={() => { setCapturing(false); navigate('/dashboard/projects'); }}
          onCaptured={() => runGenerate('capture')}
        />
      )}
    </div>
  );
}
