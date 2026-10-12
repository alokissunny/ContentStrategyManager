/*
 * Plan setup — /dashboard/plan-setup, reached from Captures › Generate plan once
 * every open clarification has been answered or skipped.
 *
 * The studio sets the plan's preferences before anything is written:
 *   - which captures go in (every plannable one in the scope Captures was
 *     filtered to, ticked by default; `thin` ones say Bauhly fills the gap)
 *   - which weekdays the new posts land on (the same rule as the Calendar's
 *     Distribute panel — sent with the generate call, which persists it)
 * Generate hands off to the Calendar's generate-after-capture flow (YourPlans).
 * `?p=a,b` carries the project filter from Captures.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../brand/Icon';
import { useProjects, useProjectsHydrated, refreshProjects, fmtWhen } from '../lib/projectsStore';
import { allCaptureSessions, plannable } from '../lib/captureStatus';
import { readDistribution, distStorageKey, currentHandle } from '../lib/distribution';
import { getDistribution } from '../api/posts';
import { STATUS_SAY, Thumb, wordsOf } from './Captures';
import './projects.css';
import './captures.css';
import './plansetup.css';

/* The generate endpoint reads at most this many capture ids. */
const MAX_GEN_IDS = 24;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const listDays = (days) => (days.length <= 1 ? days.join('')
  : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`);

export default function PlanSetup() {
  const projects = useProjects();
  const hydrated = useProjectsHydrated();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pick = useMemo(() => (params.get('p') || '').split(',').filter(Boolean), [params]);

  // answers given in Capture a moment ago changed statuses server-side
  useEffect(() => { refreshProjects().catch(() => {}); }, []);

  const inScope = (it) => !pick.length || pick.includes(it.projectId);
  const all = allCaptureSessions(projects).filter(inScope);
  const rows = all.filter((it) => plannable(it.status));
  const left = all.filter((it) => it.status === 'unclear');

  // every capture starts ticked; ids the studio unticks are remembered
  const [off, setOff] = useState([]);
  const on = rows.filter((it) => !off.includes(it.id));
  const flip = (id) => setOff((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));
  const allOn = rows.length > 0 && on.length === rows.length;

  const [dist, setDist] = useState(() => readDistribution());
  useEffect(() => {
    let stale = false;
    getDistribution().then((d) => {
      if (stale || !d || !Array.isArray(d.days)) return;
      setDist({ mode: d.mode === 'weekly' ? 'weekly' : 'days', days: d.days.length ? d.days : [0, 2, 4] });
    }).catch(() => { /* the local copy holds */ });
    return () => { stale = true; };
  }, []);
  const dayOn = new Set(dist.days);
  const toggleDay = (i) => {
    if (dayOn.has(i)) { if (dayOn.size > 1) setDist({ ...dist, days: dist.days.filter((d) => d !== i) }); return; }
    setDist({ ...dist, days: [...dist.days, i].sort((a, b) => a - b) });
  };

  const back = () => navigate(`/dashboard/projects${pick.length ? `?p=${pick[0]}` : ''}`);
  const generate = () => {
    if (!on.length) return;
    const captureIds = on.flatMap((it) => it.memberIds).slice(0, MAX_GEN_IDS);
    const next = dist.mode === 'weekly' ? { mode: 'weekly', days: dist.days } : { mode: 'days', days: dist.days };
    try { localStorage.setItem(distStorageKey(currentHandle()), JSON.stringify(next)); } catch { /* sent with the call anyway */ }
    navigate('/dashboard', {
      state: {
        generateAfterCapture: true,
        captureIds,
        ...(next.mode === 'weekly' ? { mode: 'weekly' } : next),
      },
    });
  };

  const daysSay = listDays(dist.days.map((d) => WEEKDAYS_LONG[d]));

  return (
    <div className="pj pjw pls">
      <div className="pj-head">
        <div>
          <button type="button" className="pls-back" onClick={back}>
            <Icon name="chevron-left" size={16} strokeWidth={2.2} />
            Captures
          </button>
          <h1 className="pj-head__title">Plan preferences</h1>
          <p className="pls-lead">Choose what goes into this plan and when it is published.</p>
        </div>
      </div>

      <section className="pls-sec" aria-labelledby="pls-what">
        <div className="pls-sec__head">
          <h2 id="pls-what" className="pls-sec__title">What goes in</h2>
          {rows.length > 1 && (
            <button type="button" className="pls-link" onClick={() => setOff(allOn ? rows.map((it) => it.id) : [])}>
              {allOn ? 'Clear all' : 'Select all'}
            </button>
          )}
        </div>
        <div className="pjw-sec">
          {!hydrated ? (
            <p className="pjw-none">Loading your captures…</p>
          ) : rows.length === 0 ? (
            <p className="pjw-none">
              Nothing is ready for a plan yet
              {left.length ? ' — the questions are still open.' : '. Capture something first.'}
            </p>
          ) : (
            <ul className="pjw-list">
              {rows.map((it) => {
                const ticked = !off.includes(it.id);
                const atts = it.session.attachments || [];
                const cover = atts[0] || null;
                const words = wordsOf(it);
                const mark = STATUS_SAY[it.status];
                return (
                  <li key={`${it.projectId}-${it.id}`} className={`pjw-row is-${it.status} ${ticked ? 'is-sel' : ''}`}>
                    <label className="pjw-tick">
                      <input type="checkbox" checked={ticked} onChange={() => flip(it.id)} aria-label={`Include capture from ${fmtWhen(it.session.createdAt)}`} />
                      <span aria-hidden="true"><Icon name="check" size={13} strokeWidth={2.6} /></span>
                    </label>
                    <button type="button" className="pjw-open" onClick={() => flip(it.id)} tabIndex={-1} aria-hidden="true" />
                    <span className="pjw-shot">
                      <span className="pjw-thumb">
                        {cover ? <Thumb att={cover} /> : <Icon name="brief" size={18} strokeWidth={2} />}
                        {cover?.type === 'video' && <span className="pjw-thumb__play"><Icon name="play" size={12} /></span>}
                      </span>
                    </span>
                    <span className="pjw-body">
                      <span className="pjw-facts">
                        <span className="pjw-facts__proj"><em>{it.projectName}</em></span>
                        <span className="pjw-facts__end">
                          <span className={`pjw-badge pjw-badge--${mark.tone}`}>
                            <Icon name={mark.icon} size={12} strokeWidth={2.2} />
                            {it.status === 'thin' ? 'Bauhly fills the gap' : mark.label}
                          </span>
                        </span>
                      </span>
                      {words
                        ? <span className="pjw-quote">{`“${words}”`}</span>
                        : <span className="pjw-quote pjw-quote--none">No words captured</span>}
                      <span className="pjw-meta">
                        {atts.length > 0 && (
                          <span><Icon name="image" size={13} strokeWidth={2} />{`${atts.length} ${atts.length === 1 ? 'image' : 'images'}`}</span>
                        )}
                        <span><Icon name="calendar" size={13} strokeWidth={2} />{fmtWhen(it.session.createdAt)}</span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {left.length > 0 && rows.length > 0 && (
          <p className="pls-note">
            <Icon name="info" size={13} strokeWidth={2.2} />
            {`${left.length} ${left.length === 1 ? 'capture still needs a word and stays' : 'captures still need a word and stay'} out of this plan.`}
          </p>
        )}
      </section>

      <section className="pls-sec" aria-labelledby="pls-when">
        <div className="pls-sec__head">
          <h2 id="pls-when" className="pls-sec__title">When to publish</h2>
        </div>
        <div className="pls-card">
          <div className="pls-modes" role="radiogroup" aria-label="How to place the posts">
            {[['days', 'Choose days'], ['weekly', 'Spread weekly']].map(([id, text]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={dist.mode === id}
                className={`pls-mode ${dist.mode === id ? 'is-on' : ''}`}
                onClick={() => setDist({ ...dist, mode: id })}
              >
                {text}
              </button>
            ))}
          </div>
          {dist.mode === 'days' ? (
            <>
              <div className="pls-days" role="group" aria-label="Publishing days">
                {WEEKDAYS.map((d, i) => {
                  const only = dayOn.has(i) && dayOn.size === 1;
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`pls-day ${dayOn.has(i) ? 'is-on' : ''} ${only ? 'is-only' : ''}`}
                      aria-pressed={dayOn.has(i)}
                      aria-label={only ? `${WEEKDAYS_LONG[i]} — keep at least one day` : WEEKDAYS_LONG[i]}
                      onClick={() => toggleDay(i)}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <p className="pls-say">{`New posts go on ${daysSay}, in the next free slots.`}</p>
            </>
          ) : (
            <p className="pls-say">No fixed days — new posts take the next free days on the calendar.</p>
          )}
        </div>
      </section>

      <div className="pls-foot">
        <button type="button" className="pls-cancel" onClick={back}>Cancel</button>
        <button type="button" className="pjw-genall pls-go" disabled={!on.length} onClick={generate}>
          <Icon name="sparkle" size={14} strokeWidth={2.2} />
          Generate plan
          {on.length > 0 && <b className="pjw-chip__n">{on.length}</b>}
        </button>
      </div>
    </div>
  );
}
