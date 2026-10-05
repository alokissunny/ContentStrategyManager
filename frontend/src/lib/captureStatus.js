/*
 * Capture status — what the Captures page (bauhly-v3's Projects workspace)
 * says about each capture session, and what the sidebar badge counts.
 *
 *   off     — the studio held it back from plans (capture.excluded)
 *   used    — a plan has been generated from it (capture.usedInPlanAt)
 *   unclear — photos/clips with no words: Bauhly can't tell what they show
 *   thin    — words, but something is missing (a skipped question, a gap the
 *             understanding recorded, only a few words) — plannable, flagged
 *   ready   — everything else: material the next plan can be built from
 */

import { groupCapturesIntoSessions } from './projectsStore';

/* Media with no usable note — the same rule the Calendar's NeedsAWord uses. */
function isWordless(c) {
  const words = String(c?.sessionSummary || c?.text || c?.understanding?.summary || '').trim();
  return !words;
}

export function statusOfMembers(members) {
  const list = members || [];
  if (list.some((c) => c.excluded)) return 'off';
  if (list.some((c) => c.usedInPlanAt)) return 'used';
  if (list.length && list.every(isWordless)) return 'unclear';
  if (list.some((c) => (c.gaps || []).length || (c.openQuestions || []).length)) return 'thin';
  return 'ready';
}

/** One row per capture session across every project, newest first. */
export function allCaptureSessions(projects) {
  const out = [];
  (projects || []).forEach((p) => {
    const byId = new Map((p.captures || []).map((c) => [c.id, c]));
    groupCapturesIntoSessions(p.captures).forEach((s) => {
      const ids = s.memberIds && s.memberIds.length ? s.memberIds : [s.id];
      const members = ids.map((id) => byId.get(id)).filter(Boolean);
      out.push({
        id: s.id,
        session: s,
        memberIds: ids,
        project: p,
        projectId: p.id,
        projectName: p.name,
        status: statusOfMembers(members),
      });
    });
  });
  return out.sort((a, b) => String(b.session.createdAt || '').localeCompare(String(a.session.createdAt || '')));
}

// a capture that is only missing a detail can still go into a plan
export const plannable = (status) => status === 'ready' || status === 'thin';

export const readyCount = (projects) =>
  allCaptureSessions(projects).filter((it) => plannable(it.status)).length;
