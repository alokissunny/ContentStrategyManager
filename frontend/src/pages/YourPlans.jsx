/*
 * Your Plans — the page you land on.
 *
 * A record and a starting point: the plan that's running, the plans that have
 * run (grouped by the month or year they were made in), and one button that
 * starts the next. Opening a plan shows its seven-day route (WeekView);
 * "Create a new plan" runs the real generation behind the RouteLoom stage
 * animation (PlanLoom), then drops you into the fresh plan.
 *
 * Backend-wired: GET /routes/current (running plan for the active Instagram handle),
 * GET /routes (that handle's history), POST /routes/generate (build the next one).
 * Switching accounts in the header reloads; both endpoints follow the active handle.
 */

import React, { useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { getCurrentRoute, getRoutes, generateRoute } from '../api/routes';
import { useNavigate } from 'react-router-dom';
import { useProjects, createProject, refreshProjects } from '../lib/projectsStore';
import { CaptureChat } from './Projects';
import { useAuth } from '../context/AuthContext';
import WeekView from './WeekView';
import PlanLoom from './PlanLoom';
import Checkin from './checkin/Checkin';
import NeedsAWord from '../components/NeedsAWord';
import './plans.css';
import './yourweek.css'; /* the shared .empty brand-moment styles */

/* the three authority stages in the user's own words. Colours from tokens.css */
const PILLARS = {
  discovery: { icon: 'discovery', outcome: 'Attract new people', tint: 'var(--discovery-100)', strong: 'var(--discovery-600)' },
  credibility: { icon: 'credibility', outcome: 'Show your expertise', tint: 'var(--credibility-100)', strong: 'var(--credibility-600)' },
  trust: { icon: 'trust', outcome: 'Build confidence', tint: 'var(--trust-100)', strong: 'var(--trust-600)' },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (d) => (d ? `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}` : '');

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

function monthlyGroups(routes) {
  /* Group weeks by the calendar month they start in, then sort by date.
   * (Never by weekIndex alone — that interleaved Aug week 2 with Sep week 2
   * when both months shared a stale monthKey.)
   * Same calendar Monday twice (a replanned week whose old row wasn't deleted)
   * keeps the newest write. */
  const by = new Map();
  (routes || []).forEach((r) => {
    const start = new Date(r.startsAt || r.weekOf);
    if (Number.isNaN(start.getTime())) return;
    const key = `${start.getFullYear()}-${start.getMonth()}`;
    const name = start.getFullYear() === new Date().getFullYear()
      ? MONTHS[start.getMonth()]
      : `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
    if (!by.has(key)) {
      by.set(key, { key, name, weeks: [], start });
    }
    const g = by.get(key);
    g.weeks.push(r);
    if (start < g.start) g.start = start;
  });

  const groups = [...by.values()];
  groups.forEach((g) => {
    const newestByMonday = new Map();
    g.weeks.forEach((w) => {
      const k = mondayKey(w.startsAt || w.weekOf) || String(w._id);
      const prev = newestByMonday.get(k);
      const t = Date.parse(w.generatedAt || w.updatedAt || 0);
      const pt = prev ? Date.parse(prev.generatedAt || prev.updatedAt || 0) : -1;
      if (!prev || t >= pt) newestByMonday.set(k, w);
    });
    g.weeks = [...newestByMonday.values()].sort(
      (a, b) =>
        new Date(a.startsAt || a.weekOf) - new Date(b.startsAt || b.weekOf),
    );
    // Coming up = locked placeholders only. A mix of written + draft weeks in
    // the same calendar month stays under Running / Already run.
    g.draft = g.weeks.length > 0 && g.weeks.every((w) => w.draft);
  });

  const written = groups.filter((g) => !g.draft).sort((a, b) => b.start - a.start);
  const drafts = groups.filter((g) => g.draft).sort((a, b) => a.start - b.start);
  const sections = [];
  if (written[0]) sections.push({ kind: 'running', label: 'Running now', group: written[0] });
  drafts.forEach((g) => sections.push({ kind: 'coming', label: 'Coming up', group: g }));
  written.slice(1).forEach((g) => sections.push({ kind: 'already', label: 'Already run', group: g }));
  return sections;
}

/* Does this week contain today? — the running week gets the accent date mark
 * and a "This week" pulse, matching bauhly-v3's `is-now` row. */
function isNowWeek(start, locked) {
  if (locked || !start) return false;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const a = new Date(start); a.setHours(0, 0, 0, 0);
  const b = new Date(a); b.setDate(b.getDate() + 6);
  return t >= a && t <= b;
}

/* One week within a month. A row is the date mark on the left, "Week N" with
 * the pillar-coloured aim badge, and the week's state said in words on the
 * second line — the shape from bauhly-v3's PlanHistory row. Next-month weeks
 * have no strategy yet: they are locked, non-clickable, and say when Bauhly
 * will write them. */
function WeekRow({ week, index, onOpen }) {
  const focus = PILLARS[week.focus?.pillar];
  const locked = !!week.draft;
  const start = (week.startsAt || week.weekOf) ? new Date(week.startsAt || week.weekOf) : null;
  const ready = week.readyAt ? new Date(week.readyAt) : null;
  const readySoon = !locked && ready && ready.getTime() > Date.now();
  const now = isNowWeek(start, locked);
  const cls = ['ph-row'];
  if (locked) cls.push('ph-row--draft');
  if (readySoon) cls.push('is-ready');
  if (now) cls.push('is-now');
  return (
    <button
      type="button"
      className={cls.join(' ')}
      disabled={locked}
      aria-disabled={locked}
      onClick={locked ? undefined : onOpen}
    >
      <span className="ph-row__mark ph-row__mark--date">
        <b>{start ? MONTH_ABBR[start.getMonth()].toUpperCase() : ''}</b>
        <span>{start ? start.getDate() : ''}</span>
      </span>
      <span className="ph-row__body">
        <span className="ph-row__line">
          <b className="ph-row__range">Week {(index ?? week.weekIndex ?? 0) + 1}</b>
          {focus && (
            <span className="ph-row__aim ph-badge" style={{ '--pc': focus.strong, '--pt': focus.tint }}>
              <Icon name={focus.icon} size={12} strokeWidth={2.25} />
              {focus.outcome}
            </span>
          )}
        </span>
        <span className="ph-row__meta">
          {locked ? (
            <span className="ph-row__when">
              <Icon name="clock" size={12} strokeWidth={2.25} />
              Bauhly finishes writing it on {fmtDay(ready)}
            </span>
          ) : now ? (
            <span className="ph-row__when is-now">
              <Icon name="pulse" size={12} strokeWidth={2.25} />
              This week
            </span>
          ) : readySoon ? (
            <span className="ph-row__when is-ready">
              <Icon name="eye" size={12} strokeWidth={2.25} />
              You can read this now
            </span>
          ) : (
            <span className="ph-row__when">{week.weekLabel}</span>
          )}
        </span>
      </span>
      {!locked && <Icon name="arrow-right" size={15} strokeWidth={2} />}
    </button>
  );
}

export default function YourPlans() {
  const [current, setCurrent] = useState(null);   // the running route (or null)
  const [routes, setRoutes] = useState([]);       // the whole history
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('list');        // 'list' | 'checkin' | 'gen' | 'week'
  const [selected, setSelected] = useState(null);  // the route open in WeekView
  const [capturing, setCapturing] = useState(false); // the Capture idea flow
  const [replanning, setReplanning] = useState(false);
  // Week 0 returns before the rest of the month finishes — poll until stubs land.
  const [monthFilling, setMonthFilling] = useState(false);
  const fillWatchRef = useRef(null);
  const navigate = useNavigate();
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
  async function onReplanMonth() {
    if (replanning) return;
    const ok = window.confirm(
      'Replan this month? Bauhly will rewrite the remaining weeks from your latest Brand DNA and replace the current month’s plan.',
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

  // The check-in ends here: create the project the studio named (if any), then
  // run the real generation behind the RouteLoom wait. The backend plans from
  // the account's own analysis; the conversation's answers frame the moment.
  async function onCheckinGenerate(pending) {
    setError('');
    setView('gen');
    const startedAt = Date.now();
    try {
      if (pending?.newProject) {
        try { await createProject(pending.newProject); } catch { /* non-fatal */ }
      }
      // Backend returns as soon as week 0 is ready; later weeks fill in behind.
      const data = await generateRoute('checkin');
      const route = data.route || data;
      const hold = Math.max(0, 1800 - (Date.now() - startedAt));
      setTimeout(async () => {
        await reload();
        setSelected(route);
        setView('week');
        startMonthFillWatch(data.expectedWeeks);
      }, hold);
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
        key={`${selected.instagramUsername || ''}-${selected._id || ''}`}
        route={selected}
        monthWeeks={monthWeeksOf(routes, selected)}
        onOpenWeek={(week) => setSelected(week)}
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

  // ── the list: a month of weeks, grouped Running now / Coming up / Already run ──
  const sections = monthlyGroups(routes);

  const open = (route) => { setSelected(route); setView('week'); };

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
          {current
            ? 'This month’s weeks are ready to open. Next month is scheduled — Bauhly writes it when it’s time.'
            : "Nothing is running right now. Start one whenever you're ready."}
        </p>
        {error && <p className="ph__sub" style={{ color: 'var(--negative)' }}>{error}</p>}
      </div>

      <NeedsAWord />

      <div className="ph__list">
        {sections.map((sec, i) => {
          const showLabel = i === 0 || sections[i - 1].kind !== sec.kind;
          const usage = monthUsageOf(sec.group.weeks);
          const canReplan = sec.kind === 'running' && !sec.group.draft;
          return (
            <section className="ph__group" key={sec.group.key}>
              {showLabel && <h2 className="ph__grouphead">{sec.label}</h2>}
              <div className="ph__month">
                <h3 className="ph__monthhead">
                  {sec.group.name}
                  {canReplan && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm ph__replan"
                      disabled={replanning}
                      onClick={onReplanMonth}
                    >
                      <Icon name="refresh" size={14} strokeWidth={2.25} />
                      {replanning ? 'Replanning…' : 'Replan month'}
                    </button>
                  )}
                </h3>
                {monthFilling && canReplan && (
                  <p className="ph__usage ph__usage--filling">Writing the rest of this month…</p>
                )}
                {usage && (
                  <p className="ph__usage" title="Estimated from Anthropic token usage for written weeks in this month">
                    <span>{fmtTokens(usage.totalTokens)} tokens</span>
                    <span aria-hidden="true">·</span>
                    <span>~{fmtCost(usage.estimatedCostUsd)} est.</span>
                    <span aria-hidden="true">·</span>
                    <span>{usage.weekCount} {usage.weekCount === 1 ? 'week' : 'weeks'}</span>
                    {monthFilling ? <span className="ph__usage-live"> · updating</span> : null}
                  </p>
                )}
                <div className="ph__groupbox">
                  {sec.group.weeks.map((w, i) => (
                    <WeekRow key={w._id} week={w} index={i} onOpen={() => open(w)} />
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {capturing && (
        <CaptureChat
          defaultProjectId={projects[0]?.id}
          exitLabel="Back to plans"
          onExit={() => setCapturing(false)}
          onViewProject={() => { setCapturing(false); navigate('/dashboard/projects'); }}
        />
      )}
    </div>
  );
}
