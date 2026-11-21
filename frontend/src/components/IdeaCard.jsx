/*
 * "WHAT COULD YOU SHARE NEXT?" — the next-post idea at the top of the GenPill panel, drawn as bauhly-v3's
 * ContentOpportunity (dark tone, Nov 20). The backend (GET /api/ideas/next) returns up to 7 ranked ideas; the
 * card shows one at a time:
 *   - 1 of N ›    → the next one in the batch (wraps; no new model call)
 *   - Build Reel  → Capture opens on the same card (lean, light) and asks how to make it:
 *                     Create with my footage → How would you like to record your Reel? (Face camera /
 *                       Speak while filming / Show and explain) → the idea's questions → ReelPlanner in the
 *                       matching format (talking_head / faceless_voiceover / talking_head_broll)
 *                     Generate automatically → the idea's questions → a plan run writes the post
 *   - Discard     → never suggested again (PATCH dismissed), the next one shows
 * Fetched once per finished run (keyed by the newest done job) and kept for the session.
 */
import { useEffect, useState } from 'react';
import Icon from '../brand/Icon';
import ContentOpportunity from './ContentOpportunity';
import { formatForMode } from './IdeaOffer';
import { startPlanGeneration } from '../lib/planGeneration';
import { getNextIdeas, updateIdea } from '../api/ideas';
import { openCaptureIdea } from '../lib/captureUi';
import { openReelPlanner } from './ReelPlanner';

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
      <div className="copp copp--dark copp--loading" aria-live="polite">
        <span className="copp__spark" aria-hidden="true"><Icon name="sparkle-ai" size={18} strokeWidth={1.9} /></span>
        <span className="copp__ask">Thinking about what you could share next…</span>
      </div>
    );
  }
  const ideas = run.ideas || [];
  if (run.status !== 'ready' || !ideas.length) return null;
  const at = Math.min(run.at || 0, ideas.length - 1);

  /* a built idea leaves the list; the other recommendations stay on the card (studio, 2026-11-21: "no
     recommendation is visible after I click Build Reel and come back") */
  const takeIdea = (idea) => {
    const now = byRun.get(runKey)?.ideas || ideas;
    const ix = now.findIndex((x) => x.id === idea.id);
    const rest = now.filter((x) => x.id !== idea.id);
    put(runKey, rest.length ? { ideas: rest, at: Math.max(0, ix) % rest.length } : { ideas: rest, shut: true });
  };
  const dismissIdea = (idea) => {
    updateIdea(idea.id, 'dismissed').catch(() => {});
    const now = byRun.get(runKey)?.ideas || ideas;
    const ix = now.findIndex((x) => x.id === idea.id);
    const rest = now.filter((x) => x.id !== idea.id);
    put(runKey, rest.length ? { ideas: rest, at: Math.max(0, ix) % rest.length } : { ideas: rest, shut: true });
  };
  const build = (idea) => {
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
      // Build Reel: the card, then how to make it / how to record it (IdeaOffer)
      offer: {
        idea,
        onDiscard: () => dismissIdea(idea),
        // Create with my footage: the shot guide opens in Capture itself (ReelStory) — the idea is taken here
        onAccepted: (captured) => {
          setBusy(false);
          updateIdea(idea.id, 'accepted', captured?.captureId || '').catch(() => {});
          takeIdea(idea);
        },
      },
      attachments: onFile,
      // photos already on file for it: don't ask for more
      askMedia: !onFile.length,
      onCancel: () => setBusy(false),
      onSaved: (captured) => {
        setBusy(false);
        const captureId = captured?.captureId || '';
        updateIdea(idea.id, 'accepted', captureId).catch(() => {});
        takeIdea(idea);
        const choice = captured?.offer || {};
        if (choice.way === 'auto') {
          // Generate automatically: Bauhly writes the post and puts it on the plan
          startPlanGeneration('idea', {
            label: `Next idea · ${idea.title}`,
            captureIds: captureId ? [captureId] : [],
          }).catch(() => {});
          return;
        }
        // Create with my footage: the reel planned in the recording method's format
        openReelPlanner({ idea, captured, format: formatForMode(choice.mode) });
      },
    });
  };

  return (
    <ContentOpportunity
      ideas={ideas}
      at={at}
      onShow={(i) => put(runKey, { at: i })}
      tone="dark"
      busy={busy}
      onBuild={build}
      onDismiss={dismissIdea}
      tabIndex={tabIndex}
    />
  );
}
