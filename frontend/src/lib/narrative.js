/*
 * The narrative arc of a carousel — the Lean Content Operating System, as data.
 *
 * ── WHAT THIS IS AND IS NOT (Leon, Aug 7 — decision 524) ──────────────────
 *
 * `docs/14-CONTENT-OS.md` is the framework Leon supplied and is the source of
 * truth; this file is the part of it a program can hold: the arc, the role each
 * slide plays in that arc, which composition suits that role, and the checklist
 * a finished post has to pass.
 *
 * IT WRITES NOTHING. There is no model in this build, and the framework's own
 * Accuracy Rules are explicit — never invent statistics, quotes or sources, say
 * so when evidence does not exist. So this module decides SHAPE, never words:
 * which slide is the hook, which is the struggle, which composition each of
 * them takes. The sentences remain the studio's, and the production model gets
 * this structure as its brief (docs/09, docs/11).
 *
 * ── WHY A CAROUSEL WAS SEVEN OF THE SAME SLIDE ────────────────────────────
 *
 * `slideRole` gave Hook · Setup · Process… · Result · CTA — five labels, of
 * which the middle one repeated for every slide between the second and the
 * second-to-last. Every one of those got the same category and therefore the
 * same handful of layouts, which is why a carousel read as a stack of
 * title-and-text slides rather than as one story.
 *
 * The arc below gives each position a DIFFERENT job, and each job a different
 * composition. Adjacent slides are connected because the arc connects them —
 * struggle follows context, the shift answers the struggle — and they look
 * different because their jobs are different, not because variety was added.
 */

/* ── the four beats the framework requires, and never skipping the last ──
 * "Always structure content as: Hook · Struggle · Shift · Takeaway."
 * Everything below is one of these four, expanded into the slide roles a
 * carousel actually has room for. */
export const BEATS = ['hook', 'struggle', 'shift', 'takeaway'];

/* ── AND WHICH REGISTER OF A PALETTE EACH SLIDE IS DRAWN IN (Leon, Sep 24) ─
 *
 * "Vary the colours based on narrative, so the set of colours is applied and
 * managed by the narrative emotion."
 *
 * A colour set in this product is three ROLES — ink, accent, ground — and the
 * ground is what a slide is drawn ON, so the only choice open here is between
 * the other two. That is not a limitation dressed up as a decision: ARREST
 * and CARRY are exactly the difference the arc has. Three slides in a six-
 * slide story have to stop someone — the opening line, the turn, and the ask
 * — and everything between them is the story doing its work and should not
 * shout over itself. So the accent is SPENT, three times, at the three
 * moments that are worth it.
 *
 * Keyed on the role rather than on the beat because the beat is too coarse
 * for this one question: `takeaway` holds both the framework (which carries)
 * and the CTA (which asks), and drawing those two the same way ends a
 * carousel on three identical slides.
 *
 * It names roles, never colours. Which hex an `accent` is belongs to the
 * studio, and it changes the moment they choose a different set — which is
 * the whole point of applying a set rather than six colours.
 */
export const ROLE_INK = {
  hook: 'accent',
  context: 'ink',
  struggle: 'ink',
  shift: 'accent',
  evidence: 'ink',
  framework: 'ink',
  takeaway: 'ink',
  cta: 'accent',
};
/* the register a given slide's words take, by position — the one call the
   product makes; `ink` is the resting answer for anything unlisted */
export const inkRoleAt = (i, n) => ROLE_INK[roleAt(i, n).id] || 'ink';

/* ── THE SLIDE ROLES ──────────────────────────────────────────────────────
 *
 * `beat` ties each role back to the framework. `cat` is the Visual Library
 * category its layouts come from. `kinds` are the compositions that suit the
 * job, best first — a hook wants one line at full size, a framework wants
 * numbered steps, evidence wants a picture with something written on it.
 *
 * `asks` is what the studio (or the production model) has to supply for that
 * slide. It is named so the product can show an empty slide honestly rather
 * than filling it.
 */
export const ROLES = [
  {
    id: 'hook', beat: 'hook', label: 'Hook', cat: 'hook',
    kinds: ['statement', 'hook-band', 'hook-sub', 'centered'],
    asks: 'The one sentence that stops the scroll.',
  },
  {
    id: 'context', beat: 'struggle', label: 'Context', cat: 'story',
    kinds: ['split-type', 'airy', 'title-sub'],
    asks: 'Where this happened, in as few words as it takes.',
  },
  {
    id: 'struggle', beat: 'struggle', label: 'Struggle', cat: 'story',
    kinds: ['prose', 'quote', 'magazine'],
    asks: 'The problem, described rather than explained.',
  },
  {
    id: 'shift', beat: 'shift', label: 'Shift', cat: 'edu',
    kinds: ['callout', 'text-first', 'columns'],
    asks: 'What changed — the insight this post exists for.',
  },
  {
    id: 'evidence', beat: 'shift', label: 'Evidence', cat: 'results',
    kinds: ['stat-copy', 'quote-note', 'stat', 'strip'],
    asks: 'What you actually saw. Never a number you cannot stand behind.',
  },
  {
    id: 'framework', beat: 'takeaway', label: 'Framework', cat: 'edu',
    kinds: ['steps', 'step-photo', 'index', 'timeline'],
    asks: 'The steps, in the order someone would do them.',
  },
  {
    id: 'takeaway', beat: 'takeaway', label: 'Takeaway', cat: 'edu',
    kinds: ['statement', 'quote-note', 'callout'],
    asks: 'The one line they should be able to retell.',
  },
  {
    id: 'cta', beat: 'takeaway', label: 'CTA', cat: 'cta',
    kinds: ['centered', 'caption', 'edge'],
    asks: 'One ask. Never two.',
  },
];

export const roleOf = (id) => ROLES.find((r) => r.id === id) || ROLES[0];
/* ── AND WHAT THE SLIDE IS ASKING FOR, WHERE THE STUDIO CAN READ IT ──────
 * `asks` has been authored per role since this file was written and has never
 * left it — the product knew that an evidence slide wants "what you actually
 * saw" and never said so to anybody. This is the one call that lets a screen
 * ask for it (Leon, Sep 25, reviewing what `Add something › Words` offers).
 */
export const askOf = (id) => roleOf(id).asks;

/* ── THE ARC FOR A CAROUSEL OF N SLIDES ───────────────────────────────────
 *
 * The hook opens and the CTA closes — those two are fixed, because the
 * framework fixes them. What sits between grows in a deliberate order: at three
 * slides the middle one is the shift (the belief change is the one thing that
 * cannot be cut); a fourth adds the struggle it answers; a fifth adds the
 * takeaway; and so on outward. So a short carousel is not a long one with parts
 * missing — it is the same story told in fewer beats.
 */
const MIDDLE_ORDER = ['shift', 'struggle', 'takeaway', 'framework', 'evidence', 'context'];

export function arcFor(n) {
  if (n <= 1) return ['hook'];
  if (n === 2) return ['hook', 'cta'];
  const middles = MIDDLE_ORDER.slice(0, n - 2);
  /* told in reading order, not in the order they were added */
  const order = ['context', 'struggle', 'shift', 'evidence', 'framework', 'takeaway'];
  const chosen = order.filter((id) => middles.includes(id));
  return ['hook', ...chosen, 'cta'];
}

/* the role a given slide plays */
export const roleAt = (i, n) => roleOf(arcFor(n)[i] || 'shift');

/* ── NO TWO ADJACENT SLIDES SHARE A COMPOSITION ───────────────────────────
 *
 * Each role has several suitable compositions. Walking the arc and taking the
 * first that has not been used yet gives a carousel where every slide differs
 * from its neighbours BY ITS JOB — the variation is a consequence of the story,
 * which is the only kind that reads as intentional.
 *
 * `available` is the studio's own library (the ones they have kept), so this
 * can never propose a shape they turned off. If a role's preferred kinds are
 * all gone, it falls back to any layout in its category rather than repeating
 * the previous slide.
 */
export function planCarousel(n, available) {
  const have = new Set((available || []).map((l) => l.kind));
  const used = new Set();
  return arcFor(n).map((id) => {
    const role = roleOf(id);
    const fit = role.kinds.find((k) => have.has(k) && !used.has(k))
      || role.kinds.find((k) => have.has(k))
      || (available || []).find((l) => l.cat === role.cat && !used.has(l.kind))?.kind
      || null;
    if (fit) used.add(fit);
    return { role, kind: fit };
  });
}

/* ── THE QUALITY CHECKLIST (docs/14) ──────────────────────────────────────
 * Nine items, verbatim. `check` is what the PRODUCT can verify about a
 * structure; the rest are judgements about words, and are listed so the
 * production model is held to them and so nothing is quietly dropped.
 * A `check` of null means "a person or the model decides this, not the app" —
 * which the UI must say rather than claiming a pass. */
export const CHECKLIST = [
  { id: 'hook', label: 'Strong hook', check: (arc) => arc[0]?.role.id === 'hook' },
  { id: 'conflict', label: 'Clear conflict', check: (arc) => arc.some((s) => s.role.beat === 'struggle') },
  { id: 'insight', label: 'Memorable insight', check: null },
  { id: 'takeaway', label: 'Actionable takeaway', check: (arc) => arc.some((s) => s.role.beat === 'takeaway') },
  { id: 'specific', label: 'Emotional specificity', check: null },
  { id: 'hero', label: 'Audience is the hero', check: null },
  { id: 'evidence', label: 'Evidence over claims', check: null },
  { id: 'cta', label: 'One CTA', check: (arc) => arc.filter((s) => s.role.id === 'cta').length === 1 },
  { id: 'retell', label: 'Easy to retell', check: null },
];

/* what the app can honestly say about a structure before a word is written */
export function validate(arc) {
  return CHECKLIST.map((item) => ({
    ...item,
    /* `null` is not a pass and not a fail — it is "this one is about the
       words, and the words are not ours to grade" */
    state: item.check ? (item.check(arc) ? 'pass' : 'fail') : 'unchecked',
  }));
}

/* ── A REEL IS A TIMELINE, NOT A STACK OF LAYOUTS ─────────────────────────
 *
 * (Leon, Aug 7 — decision 533.) A carousel slide is a COMPOSITION: the studio
 * chooses a shape and words sit in it. A reel scene is a DURATION: something
 * happens, for a number of seconds, and the words are spoken over it. They are
 * not the same object and the reel was borrowing the carousel's whole workflow
 * — a layout carousel on a post that has no layouts.
 *
 * The arc is the same one (`arcFor`), because the Content OS does not change
 * with the format: hook · struggle · shift · takeaway · CTA. What changes is
 * that each beat becomes a scene with a length and a visual direction instead
 * of a slide with a composition.
 *
 * SECONDS ARE NOT INVENTED. They come from the beat: a hook has to land inside
 * three seconds or the scroll continues; a struggle needs room to be felt; a
 * CTA is short because it is one ask. These are pacing conventions for
 * short-form video, and they are stated as the reason rather than presented as
 * research.
 */
const SCENE_SECONDS = { hook: 3, struggle: 4, shift: 5, takeaway: 4, cta: 3 };

/* what the camera is doing, per beat. A DIRECTION, never a claim — the same
   kind of art direction the image prompts carry (docs/09). */
const SCENE_VISUAL = {
  hook: 'Open on the finished detail, close. Move out slowly — the reveal is the hook.',
  context: 'Wide, static. The room as it was, with nothing edited out.',
  struggle: 'Handheld, mid-shot. The mess, the samples, the part nobody posts.',
  shift: 'Cut to the decision — the drawing, the swatch, the moment it changed.',
  evidence: 'Hold on the result. No motion; let it be looked at.',
  framework: 'Steps on screen, one per beat, over B-roll of the work.',
  takeaway: 'Back to the finished room. Slow push in as the line lands.',
  cta: 'Static on the space, text only. Nothing moving under the ask.',
};

/* the transition INTO the next scene, named so an editor knows the intent */
const SCENE_CUT = {
  hook: 'Hard cut',
  context: 'Hard cut',
  struggle: 'Match cut on the same corner',
  shift: 'Cross-dissolve',
  evidence: 'Hard cut',
  framework: 'Hard cut',
  takeaway: 'Hold, then cut to black',
};

/* ── the script ───────────────────────────────────────────────────────────
 * `words` is what the studio has already written for each beat (the reel's own
 * frames). It is passed in and never generated: the on-screen text is theirs,
 * and where they have written nothing the scene says so rather than inventing
 * a line. */
export function reelScript(n, words = []) {
  let at = 0;
  return arcFor(n).map((id, i) => {
    const role = roleOf(id);
    const secs = SCENE_SECONDS[role.beat] || 4;
    const from = at;
    at += secs;
    return {
      n: i + 1,
      role,
      from,
      to: at,
      /* "0–3s" */
      span: `${from}–${at}s`,
      onScreen: words[i] || '',
      /* the spoken line is the studio's to write — never put words in their
         mouth. `asks` says what this scene needs from them. */
      voice: '',
      needs: role.asks,
      visual: SCENE_VISUAL[role.id] || SCENE_VISUAL.shift,
      cut: i === arcFor(n).length - 1 ? null : (SCENE_CUT[role.id] || 'Hard cut'),
    };
  });
}
