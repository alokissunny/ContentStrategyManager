/*
 * "WHAT COULD YOU SHARE NEXT?" — the next-post idea, at the top of the GenPill panel once a run has finished
 * (Next-post recommendation, phase 2). The backend (GET /api/ideas/next) returns up to 7 ranked ideas; this card
 * shows one at a time:
 *   - Another idea → the next one in the batch (round again at the end, no new model call)
 *   - Explore idea → Capture opens on the idea's own first line and asks only what is missing; once it is
 *     saved the idea is marked accepted and the recommended REEL opens (ReelPlanner: format, story
 *     sequences, recording guide, footage). Explore alternatives there can still choose a carousel.
 *   - Dismiss      → never suggested again (PATCH dismissed), the next one shows
 *   - ×            → hides the card until the next finished run
 * Fetched once per finished run (keyed by the newest done job) and kept for the session.
 */
import { useEffect, useState } from 'react';
import Icon from '../brand/Icon';
import { getNextIdeas, updateIdea } from '../api/ideas';
import { openCaptureIdea } from '../lib/captureUi';
import { openReelPlanner } from './ReelPlanner';
import { MISSIONS, PILLAR_SAY } from '../lib/missions';

/* one fetch per finished run, kept across the panel opening and shutting */
const byRun = new Map(); // runKey → { status: 'loading'|'ready'|'failed', ideas, at, shut }
const listeners = new Set();
function put(runKey, patch) {
  byRun.set(runKey, { ...(byRun.get(runKey) || {}), ...patch });
  listeners.forEach((fn) => fn());
}
function load(runKey) {
  if (!runKey || byRun.has(runKey)) return;
  put(runKey, { status: 'loading', ideas: [], at: 0 });
  // runKey = `${handle}:${job}` — ask for THIS account's ideas, and never keep another's
  const handle = runKey.slice(0, runKey.indexOf(':')).toLowerCase();
  getNextIdeas({ handle })
    .then((data) => {
      const forOther = data.username && handle && String(data.username).toLowerCase() !== handle;
      if (forOther) {
        byRun.delete(runKey); // the next mount / switch asks again
        listeners.forEach((fn) => fn());
        return;
      }
      put(runKey, { status: 'ready', ideas: data.ideas || [], at: 0 });
    })
    .catch(() => put(runKey, { status: 'failed', ideas: [] }));
}

function useRunIdeas(runKey) {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  useEffect(() => { load(runKey); }, [runKey]);
  return byRun.get(runKey) || null;
}

/* whether the card has something to show (the pill's label and empty line read it) */
export function useIdeaShown(runKey) {
  const run = useRunIdeas(runKey);
  if (!run || run.shut) return false;
  return run.status === 'loading' || (run.status === 'ready' && (run.ideas || []).length > 0);
}

export default function IdeaCard({ runKey, tabIndex = 0, onExplore }) {
  const run = useRunIdeas(runKey);
  const [busy, setBusy] = useState(false);
  if (!run || run.shut) return null;
  if (run.status === 'loading') {
    return (
      <div className="gidea gidea--loading" aria-live="polite">
        <span className="gidea__spark" aria-hidden="true"><Icon name="sparkle" size={14} strokeWidth={2} /></span>
        <span className="gidea__ask">Thinking about what you could share next…</span>
      </div>
    );
  }
  const ideas = run.ideas || [];
  if (run.status !== 'ready' || !ideas.length) return null;
  const at = Math.min(run.at || 0, ideas.length - 1);
  const idea = ideas[at];
  const thumb = (idea.assets || []).find((a) => a.url && a.type !== 'video');
  const eyebrow = [PILLAR_SAY[idea.pillar], idea.eyebrow].filter(Boolean).join(' · ');
  const mission = MISSIONS[idea.mission] || null;
  const why = [idea.missionWhy, idea.why].filter(Boolean).join(' ');

  const next = () => put(runKey, { at: (at + 1) % ideas.length });
  const shut = () => put(runKey, { shut: true });
  const dismiss = () => {
    updateIdea(idea.id, 'dismissed').catch(() => {});
    const rest = ideas.filter((x) => x.id !== idea.id);
    put(runKey, rest.length ? { ideas: rest, at: at % rest.length } : { ideas: rest, shut: true });
  };
  const explore = () => {
    if (busy) return;
    setBusy(true);
    onExplore?.();
    // photos the studio already uploaded for this idea come along as the
    // capture's own attachments, so the post reuses them (studio, 2026-11-19)
    const onFile = (idea.assets || [])
      .filter((a) => a.key && (a.type === 'image' || a.type === 'video'))
      .map((a) => ({ id: a.key, key: a.key, type: a.type, url: a.url || '' }));
    openCaptureIdea({
      opening: idea.opening || idea.title,
      savedLine: 'Got it — planning your reel now.',
      projectName: 'No project',
      askProject: false,
      // the opening is question 1; the agent may add one more only if the
      // story still has a real gap (1–2 contextual questions in all)
      maxQuestions: 2,
      // the capture agent reads what is already known, so it never re-asks it
      idea: {
        title: idea.title || '',
        mission: idea.mission || '',
        why: [idea.missionWhy, idea.why].filter(Boolean).join(' '),
        known: idea.known || [],
        questions: idea.questions || [],
        assets: (idea.assets || []).map((a) => ({ key: a.key, type: a.type, reason: a.reason || '' })),
      },
      attachments: onFile,
      // photos already on file for it: don't ask for more
      askMedia: !onFile.length,
      onCancel: () => setBusy(false),
      onSaved: (captured) => {
        setBusy(false);
        const captureId = captured?.captureId || '';
        updateIdea(idea.id, 'accepted', captureId).catch(() => {});
        // the explored idea leaves the card; the others wait for another run
        put(runKey, { shut: true });
        // a recommended post is always a reel (studio's rule, 2026-11-18)
        openReelPlanner({ idea, captured });
      },
    });
  };

  return (
    <section className="gidea" aria-label="What could you share next?">
      <div className="gidea__top">
        <span className="gidea__spark" aria-hidden="true"><Icon name="sparkle" size={14} strokeWidth={2} /></span>
        <span className="gidea__ask">What could you share next?</span>
        <button type="button" className="gidea__x" onClick={shut} aria-label="Hide this idea" title="Hide" tabIndex={tabIndex}>
          <Icon name="x" size={14} strokeWidth={2.25} />
        </button>
      </div>
      {mission && (
        <p className={`gidea__mission gidea__mission--${idea.mission}`} title={mission.purpose}>
          <span aria-hidden="true">{mission.mark}</span>
          {' '}Next: <strong>{mission.say.toUpperCase()}</strong>
        </p>
      )}
      <div className={`gidea__body ${thumb ? 'has-thumb' : ''}`}>
        {thumb && <img className="gidea__thumb" src={thumb.url} alt="" loading="lazy" />}
        <div className="gidea__words">
          {eyebrow && <p className="gidea__eyebrow">{eyebrow}</p>}
          <h3 className="gidea__title">{idea.title}</h3>
        </div>
      </div>
      {why && <p className="gidea__why"><strong>Why:</strong> {why}</p>}
      <div className="gidea__acts">
        {ideas.length > 1 && (
          <button type="button" className="gidea__btn gidea__btn--line" onClick={next} tabIndex={tabIndex}>
            <Icon name="refresh" size={13} strokeWidth={2.25} />
            Another idea
          </button>
        )}
        {ideas.length > 1 && <span className="gidea__count" aria-live="polite">{at + 1} of {ideas.length}</span>}
        <button type="button" className="gidea__btn gidea__btn--go" onClick={explore} disabled={busy} tabIndex={tabIndex}>
          Explore idea
          <Icon name="arrow-right" size={13} strokeWidth={2.25} />
        </button>
        <button type="button" className="gidea__dismiss" onClick={dismiss} tabIndex={tabIndex}>Dismiss</button>
      </div>
    </section>
  );
}
