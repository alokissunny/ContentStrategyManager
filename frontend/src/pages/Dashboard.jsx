/*
 * Dashboard — Bauhly "Authority System" layout.
 *   this week's focus (hypothesis · recommendation · why) → an expandable
 *   "where you stand" panel across the three authority stages → the weekly
 *   route rail. Styling comes from src/styles/app.css (.mfocus/.as2/.wr).
 *
 * Backend-wired: `hasRoute` is read from /routes/current, so the focus card's
 * generate control and the route rail reflect whether a real route exists.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../brand/Icon';
import { useAuth } from '../context/AuthContext';
import { getCurrentRoute, generateRoute } from '../api/routes';

/* ── the three authority stages, each with its own accent from tokens.css ── */
const PILLARS = {
  discovery: { label: 'Discovery', icon: 'discovery', color: 'var(--discovery-500)', soft: 'var(--discovery-50)', tint: 'var(--discovery-100)', strong: 'var(--discovery-600)', question: 'Do new people find your work?', goalChip: 'Get noticed' },
  credibility: { label: 'Credibility', icon: 'credibility', color: 'var(--credibility-500)', soft: 'var(--credibility-50)', tint: 'var(--credibility-100)', strong: 'var(--credibility-600)', question: 'Do they trust your eye?', goalChip: 'Show expertise' },
  trust: { label: 'Trust', icon: 'trust', color: 'var(--trust-500)', soft: 'var(--trust-50)', tint: 'var(--trust-100)', strong: 'var(--trust-600)', question: 'Do they reach out?', goalChip: 'Build confidence' },
};

/* Route-rail presentation maps (content-type → icon). The plan itself now comes
   from /routes/current, generated from the user's Instagram analysis. */
const CONTENT_ICON = { 'Client Story': 'trust', 'Educational Tips': 'brief', 'Personal Journey': 'profile', Community: 'comment' };

function getWeekRange(date) {
  const d = new Date(date);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

/* ⓘ button with a click-toggled popover (mirrors components/ui InfoTip) */
function InfoTip({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="infotip">
      <button className="infotip__btn" aria-label={`About ${title}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="info" size={15} />
      </button>
      {open && (
        <>
          <span className="infotip__scrim" onClick={() => setOpen(false)} />
          <span className="infotip__pop" role="tooltip"><b>{title}</b>{children}</span>
        </>
      )}
    </span>
  );
}

/* a plain-language status for each stage — the focus stage reads "Improving" */
function pillarState(row, focusPillar) {
  if (row.pillar === focusPillar) return { label: 'Improving', icon: 'pulse' };
  if (row.score >= 85) return { label: 'Very strong', icon: 'trust' };
  if (row.score >= 70) return { label: 'Strong', icon: 'credibility' };
  if (row.score >= 55) return { label: 'Stable', icon: 'check' };
  return { label: 'Needs attention', icon: 'info' };
}

const EVIDENCE_ICONS = ['pulse', 'calendar', 'eye', 'comment', 'evidence'];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const range = useMemo(() => getWeekRange(new Date()), []);
  const firstName = (user?.name || 'there').split(' ')[0];
  const routePath = '/dashboard/content-route';

  useEffect(() => {
    getCurrentRoute()
      .then((r) => { setRoute(r); if (r) setOpen(r.focus.pillar); })
      .catch(() => setRoute(null))
      .finally(() => setLoading(false));
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const r = await generateRoute();
      setRoute(r);
      if (r) setOpen(r.focus.pillar);
    } catch (err) {
      /* leave route as-is; the empty state lets the user retry */
    } finally {
      setGenerating(false);
    }
  }

  // Plan data, sourced from the generated route (was hardcoded before).
  const hasRoute = !!route;
  const WEEK = route?.focus;
  const FUNNEL = route?.funnel || [];
  const WEEK_PLAN = route?.days || [];
  const focus = PILLARS[WEEK?.pillar || 'trust'];
  const openRow = FUNNEL.find((r) => r.pillar === open);

  if (loading) {
    return (
      <div className="app__main">
        <div className="page-head">
          <div>
            <span className="eyebrow">Week of {range}</span>
            <h1>Here’s your week, {firstName}.</h1>
          </div>
        </div>
        <p className="sec-desc" style={{ marginTop: 8 }}>Loading your week…</p>
      </div>
    );
  }

  if (!hasRoute) {
    return (
      <div className="app__main">
        <div className="page-head">
          <div>
            <span className="eyebrow">Week of {range}</span>
            <h1>Here’s your week, {firstName}.</h1>
          </div>
        </div>
        <section className="card wr" aria-label="Weekly route" style={{ marginTop: 8 }}>
          <div className="wr__empty" style={{ padding: '40px 24px' }}>
            <p>Your week hasn’t been planned yet. Bauhly reads your Instagram analysis and builds a
              focus for the week plus a post for each day — with the reason behind it.</p>
            <button onClick={handleGenerate} disabled={generating} className="btn btn--primary btn--sm" style={{ flexShrink: 0, opacity: generating ? 0.6 : 1 }}>
              <Icon name="sparkle" size={15} />
              {generating ? 'Planning your week…' : 'Generate this week’s plan'}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app__main">
      <div className="page-head">
        <div>
          <span className="eyebrow">Week of {range}</span>
          <h1>Here’s your week, {firstName}.</h1>
        </div>
      </div>

      <div className="dash dash--single">
        <div className="dash__col dash__col--main">
          {/* ── This week's focus ── */}
          <section
            className="mfocus"
            aria-label="This week's focus"
            style={{ '--pc': focus.color, '--pt': focus.tint, '--ps': focus.soft, '--pstrong': focus.strong }}
          >
            <div className="mfocus__top">
              <div className="mfocus__topmain">
                <span className="mfocus__badge" aria-hidden="true">
                  <Icon name={focus.icon} size={24} strokeWidth={2} />
                </span>
                <div>
                  <span className="mfocus__eyebrow">This week’s focus</span>
                  <h2 className="mfocus__headline">{WEEK.headline}</h2>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mfocus__status"><i aria-hidden="true" />This week in progress</span>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="mfocus__expand"
                  style={{ marginTop: 0, opacity: generating ? 0.6 : 1 }}
                  title="Regenerate this week’s plan"
                >
                  <Icon name="sparkle" size={14} strokeWidth={2} />
                  {generating ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
            </div>

            <div className="mfocus__cols">
              <div className="mfocus__lead">
                <div className="mfocus__block">
                  <span className="mfocus__blabel">
                    <span className="mfocus__bico"><Icon name="pulse" size={13} strokeWidth={2} /></span>
                    The hypothesis
                  </span>
                  <p className="mfocus__para">{WEEK.hypothesis}</p>
                </div>
                <div className="mfocus__block">
                  <span className="mfocus__blabel">
                    <span className="mfocus__bico"><Icon name="route" size={13} strokeWidth={2} /></span>
                    The recommendation
                  </span>
                  <p className="mfocus__para">{WEEK.recommendation}</p>
                </div>
              </div>
              <aside className="mfocus__side">
                <div className="mfocus__reason-block">
                  <span className="mfocus__blabel">
                    <span className="mfocus__bico mfocus__bico--ghost"><Icon name="info" size={13} strokeWidth={2} /></span>
                    Why this focus
                  </span>
                  <p>{WEEK.whyMatters}</p>
                </div>
                <div className="mfocus__reason-block">
                  <span className="mfocus__blabel">
                    <span className="mfocus__bico mfocus__bico--ghost"><Icon name="clock" size={13} strokeWidth={2} /></span>
                    What last week showed
                  </span>
                  <p>{WEEK.observation}</p>
                </div>
              </aside>
            </div>

            <button
              className={`mfocus__expand ${expanded ? 'is-open' : ''}`}
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
            >
              {expanded ? 'Hide details' : 'Show more details'}
              <Icon name="chevron-down" size={15} strokeWidth={2.25} className="mfocus__expand-chev" />
            </button>

            {expanded && (
              <div className="mfocus__more">
                <div className="mfocus__more-lead">
                  <span className="mfocus__more-label">
                    Where you stand
                    <InfoTip title="How Bauhly reads your account">
                      Every new client moves through three stages: they <b>discover</b> your work,
                      they start <b>trusting your expertise</b>, and finally they <b>believe you can
                      do it for them</b>. Bauhly measures each stage from your real posts and points
                      this week at the one that will move your enquiries most.
                    </InfoTip>
                  </span>
                  <p className="sec-desc">Your content moves people through three stages — select one for the detail.</p>
                </div>

                <div className="as2">
                  <div className="as2__list" role="tablist" aria-label="Authority stages">
                    {FUNNEL.map((row) => {
                      const p = PILLARS[row.pillar];
                      const st = pillarState(row, WEEK.pillar);
                      return (
                        <button
                          key={row.pillar}
                          role="tab"
                          aria-selected={open === row.pillar}
                          className={`as2__pillar ${open === row.pillar ? 'is-open' : ''} ${row.pillar === WEEK.pillar ? 'is-focus' : ''}`}
                          onClick={() => setOpen(row.pillar)}
                          style={{ '--pc': p.color, '--pt': p.tint, '--ps': p.soft, '--pstrong': p.strong }}
                        >
                          <span className="as2__ico" aria-hidden="true"><Icon name={p.icon} size={20} strokeWidth={2} /></span>
                          <span className="as2__meta">
                            <span className="as2__name">{p.label}</span>
                            <span className="as2__state"><Icon name={st.icon} size={13} strokeWidth={2} />{st.label}</span>
                          </span>
                          <span className="as2__arrow" aria-hidden="true"><Icon name="chevron-right" size={16} strokeWidth={2} /></span>
                        </button>
                      );
                    })}
                  </div>

                  {openRow && (
                    <div className="as2__detail" key={openRow.pillar}>
                      <p className="as__detail-q">{PILLARS[openRow.pillar].question}</p>
                      <div className="as2__detail-grid">
                        <div>
                          <span className="as__label"><span className="as__hico"><Icon name="evidence" size={13} strokeWidth={2} /></span>Evidence</span>
                          <ul className="as__evidence">
                            {openRow.evidence.map((e, i) => (
                              <li key={e}>
                                <span className="as__evidence-ico" aria-hidden="true"><Icon name={EVIDENCE_ICONS[i % EVIDENCE_ICONS.length]} size={13} strokeWidth={2} /></span>
                                {e}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="as2__detail-right">
                          <span className="as__label"><span className="as__hico"><Icon name="info" size={13} strokeWidth={2} /></span>Why it matters</span>
                          <p className="as__meaning">{openRow.whyMatters}</p>
                          <span className="as__label" style={{ marginTop: 16 }}><span className="as__hico"><Icon name="route" size={13} strokeWidth={2} /></span>Recommendation</span>
                          <p className="as__meaning">{openRow.recommendation}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ── Weekly route — day directions ── */}
          <section className="card wr" aria-label="Weekly route">
            <div className="wr__head">
              <div>
                <span className="wr__title">
                  Weekly route
                  <InfoTip title="Your weekly route">
                    One post per day, planned for you. Each day has a direction — what to say and
                    why it helps your business — plus the caption, the format, and the best time to
                    publish. Every post targets one of your three authority stages.
                  </InfoTip>
                </span>
                <p className="wr__sub sec-desc">What your audience should hear from you each day — and why.</p>
              </div>
            </div>

            <div className="wr__meta">
              <Icon name="calendar" size={15} style={{ color: 'var(--ink-500)' }} />
              <b>{range}</b>
              {!hasRoute && (
                <span className="wr__status wr__status--pending"><i />Direction not chosen yet</span>
              )}
            </div>

            {hasRoute ? (
              <div className="wr__rail">
                {WEEK_PLAN.map((post, i) => {
                  const p = PILLARS[post.pillar] || PILLARS.trust;
                  return (
                    <Link key={post.day} to={`${routePath}?day=${i}`} className="wr__card">
                      <span className="wr__day">{post.day}</span>
                      <span className="wr__type"><Icon name={CONTENT_ICON[post.contentType] || 'brief'} size={14} />{post.contentType}</span>
                      <span className="wr__direction">{post.direction}</span>
                      <span className="wr__goal" style={{ background: p.tint, color: p.strong }}>
                        <Icon name={p.icon} size={13} strokeWidth={2} />{post.goalTag || p.goalChip}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="wr__empty">
                <p>Last week’s route has ended. This week’s strategy is waiting.</p>
                <button onClick={() => navigate(routePath)} className="btn btn--primary btn--sm" style={{ flexShrink: 0 }}>
                  Plan this week with Bauhly
                  <Icon name="arrow-right" size={15} />
                </button>
              </div>
            )}

            <div className="wr__foot">
              <span>
                <Icon name="route" size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 7 }} />
                Directions, not finished posts. Open the weekly route to explore a day.
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
