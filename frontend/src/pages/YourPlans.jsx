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

import React, { useEffect, useState } from 'react';
import Icon from '../brand/Icon';
import { getCurrentRoute, getRoutes, generateRoute } from '../api/routes';
import { useNavigate } from 'react-router-dom';
import { useProjects, createProject } from '../lib/projectsStore';
import { CaptureChat } from './Projects';
import { useAuth } from '../context/AuthContext';
import WeekView from './WeekView';
import PlanLoom from './PlanLoom';
import Checkin from './checkin/Checkin';
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

/* "2 weeks ago" reads as a memory; "Jun 29" reads as a filing cabinet. */
function agoOf(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const days = Math.round((now - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return weeks === 1 ? 'a week ago' : `${weeks} weeks ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'a month ago' : `${months} months ago`;
}

/* Months for this year, the year alone for anything older. */
function bucketOf(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: 'x', label: 'Earlier' };
  if (d.getFullYear() !== now.getFullYear()) return { key: String(d.getFullYear()), label: String(d.getFullYear()) };
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
}

/* one route → the shape a row needs */
const toPlan = (r) => ({
  id: r._id,
  route: r,
  range: r.weekLabel,
  focus: r.focus?.pillar,
  total: (r.days || []).length,
  createdAt: r.generatedAt || r.createdAt || r.updatedAt,
});

function PlanRow({ plan, live, onOpen }) {
  const focus = PILLARS[plan.focus];
  return (
    <button className={`ph-row ${live ? 'is-live' : ''}`} onClick={onOpen}>
      <span className="ph-row__mark" style={focus ? { '--pc': focus.strong, '--pt': focus.tint } : undefined}>
        <Icon name={focus?.icon || 'route'} size={17} strokeWidth={2} />
      </span>
      <span className="ph-row__body">
        <span className="ph-row__line">
          <b className="ph-row__range">{plan.range}</b>
          {live
            ? <span className="ph-card__live">Running now</span>
            : <span className="ph-card__period">Week</span>}
        </span>
        <span className="ph-row__meta">
          {focus && <span className="ph-row__aim" style={{ '--pc': focus.strong }}>{focus.outcome}</span>}
          <span>{plan.total} {plan.total === 1 ? 'post' : 'posts'}</span>
          <span className="ph-row__ago">{agoOf(plan.createdAt)}</span>
        </span>
      </span>
      <Icon name="arrow-right" size={15} strokeWidth={2} />
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

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

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
      const route = await generateRoute();
      const hold = Math.max(0, 2600 - (Date.now() - startedAt));
      setTimeout(async () => {
        await reload();
        setSelected(route);
        setView('week');
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
        route={selected}
        onBack={() => setView('list')}
        onRegenerate={() => setView('checkin')}
        generating={false}
      />
    );
  }

  if (loading) {
    return <div className="ph"><p className="ph__sub">Loading your plans…</p></div>;
  }

  // ── a plan building in the background after a fresh (re)connect ──
  if (preparing && !current && routes.length === 0) {
    return (
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
    );
  }

  // ── nothing yet — the branded invitation ──
  if (!current && routes.length === 0) {
    return (
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
    );
  }

  // ── the list: running now + the archive by month/year ──
  const currentId = current?._id;
  const past = routes
    .filter((r) => r._id !== currentId)
    .map(toPlan)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const groups = past.reduce((acc, p) => {
    const b = bucketOf(p.createdAt);
    const last = acc[acc.length - 1];
    if (last && last.key === b.key) last.items.push(p);
    else acc.push({ ...b, items: [p] });
    return acc;
  }, []);

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
            ? 'One plan is running. Open it to work on it, or start the next one.'
            : "Nothing is running right now. Start one whenever you're ready."}
        </p>
        {error && <p className="ph__sub" style={{ color: 'var(--negative)' }}>{error}</p>}
      </div>

      <div className="ph__list">
        {current && (
          <section className="ph__group">
            <h2 className="ph__grouphead">Running now</h2>
            <div className="ph__groupbox">
              <PlanRow plan={toPlan(current)} live onOpen={() => open(current)} />
            </div>
          </section>
        )}
        {groups.map((g) => (
          <section className="ph__group" key={g.key}>
            <h2 className="ph__grouphead">{g.label}</h2>
            <div className="ph__groupbox">
              {g.items.map((p) => <PlanRow key={p.id} plan={p} onOpen={() => open(p.route)} />)}
            </div>
          </section>
        ))}
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
