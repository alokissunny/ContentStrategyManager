/*
 * ══ WHAT BAUHLY CAN DO NEXT, HERE ════════════════════════════════════════
 *
 * (Leon, Sep 24, the contextual-actions brief: "the chips above the composer
 * are not prompt suggestions — they are the most useful things Bauhly can do
 * next in the current context.")
 *
 * THE INTERACTION THIS SERVES. Select → action → optional refinement →
 * Submit, with typing optional at every step:
 *
 *   [The title ×] [Rewrite ×] [More explanatory ×]   Add anything to consider…
 *
 * Three badges, each removable, each one narrowing what the row below offers.
 * A press on the row NEVER writes into the field — the field is the studio's,
 * and a chip that fills it takes the sentence away from them and then makes
 * them edit it back. The row says what can be DONE; the field says what they
 * would like to add to it.
 *
 * WHY A RESOLVER AND NOT SIX LISTS. A flat list per element type is the thing
 * this replaces: it offered `Add a subtitle` on a slide with no words, `Crop`
 * on an empty frame, and the same four ideas whether the slide was the hook or
 * the CTA. What decides an action's worth is the whole context — what is
 * selected, what it already says, what job this slide does in the story, what
 * the post has to work with — so that is what comes in, and what goes out is a
 * ranked list with the best three to five at the front.
 *
 * WHAT IT WILL NOT DO. Offer an action whose information does not exist. The
 * framework's own accuracy rule (lib/narrative.js) is that the product never
 * invents a fact about the project, so `Add the result` is not offered on a
 * post whose capture has no result in it — the honest move is to ask for it,
 * which is what the placeholder does.
 *
 * HOW IT REACHES THE PRODUCT. Nothing here executes anything. Every action
 * resolves to a SENTENCE (`askSay`), and that sentence travels the road a
 * typed one already travels — `interpret` for the things the editor can do
 * itself, the generation path for the things it writes. So an action can only
 * ever do what a studio could already have asked for in words, and the
 * catalogue cannot drift away from what the build supports.
 */

/* ── the shape of an action ───────────────────────────────────────────────
 *   id      stable, so a badge survives a re-render
 *   label   what the chip says — a verb, two or three words, never a prompt
 *   say     the sentence it sends when it is the last badge standing
 *   hint    the placeholder while it is armed ("what can you optionally add")
 *   kids    the refinements it opens, if any
 *   act     the id of a door this press opens instead (the caller owns these)
 *   needs   what must be true for it to be offered at all
 */

const A = (id, label, say, extra = {}) => ({ id, label, say, ...extra });

/* ── AND THE SENTENCE IS WRITTEN FOR THE READER THAT GETS IT ──────────────
 * (Leon, Sep 24, measured: `Improve this slide, by cutting the text back.`
 * came back having ADDED a line.)
 * The label is the studio's word and `say` is what the product's own reader
 * is handed — and that reader is not a model. `lib/polish.js` matches on a
 * vocabulary: `shorter`, `simpler`, `add`, `opening`, `professional`,
 * `warmer`, and it tests them in order, so a sentence about cutting that
 * happens to contain the word `text` lands on `add` before it ever reaches
 * `shorter`. Every `say` below is written in that vocabulary, which is what
 * keeps a chip's promise the same as its result.
 */

/* ── THE REFINEMENTS ──────────────────────────────────────────────────────
 * Each one finishes its parent's sentence rather than starting a new one, so
 * what is sent reads as one instruction: "Rewrite the title, more
 * explanatory." The wording is the studio's own register — plain verbs, no
 * trade words — and the same vocabulary `interpret` already reads.
 */
const REWRITE_KIDS = [
  A('concise', 'More concise', 'shorter'),
  A('explan', 'More explanatory', 'and add more detail'),
  A('impact', 'More impactful', 'so the opening lands'),
  A('natural', 'More natural', 'warmer, more like me'),
  A('simpler', 'Simpler', 'simpler'),
  A('curious', 'Create curiosity', 'so the opening pulls the reader in'),
];

const TONE_KIDS = [
  A('pro', 'More professional', 'more professional'),
  A('conv', 'More conversational', 'warmer and more casual'),
  A('warm', 'Warmer', 'warmer'),
  A('minimal', 'More minimal', 'plainer'),
];

/* ── AND DETAIL IS ONLY OFFERED WHERE THERE IS DETAIL TO ADD ──────────────
 * Each of these asks the studio for something the post may not contain. They
 * are offered all the same — the studio is the one who knows — but the
 * placeholder asks the question rather than the product answering it, which
 * is the accuracy rule in the one place it can actually bite.
 */
const DETAIL_KIDS = [
  A('why', 'Explain why', 'add a line on why this mattered', { hint: 'Why did it matter?' }),
  A('context', 'Add context', 'add a line of context', { hint: 'What should the reader know first?' }),
  A('example', 'Add an example', 'add an example', { hint: 'Which example?' }),
  A('process', 'Explain the process', 'add a line on how it was done', { hint: 'What did the process involve?' }),
  A('result', 'Clarify the result', 'add a line on the result', { hint: 'What happened as a result?' }),
];

/* WHAT USED TO BE HERE: `LAYOUT_KIDS` and `LOOK_KIDS`, the refinements under
   `Change the layout` and `Change the look`. Both actions came off the row on
   Sep 24 — they were the ⋯ menu's own `Layouts` and `Themes`, one press away
   with a grid of real answers behind each — and their refinements went with
   them rather than sitting here unreachable. */

const TEXT_KINDS = [
  A('title', 'Title', 'a title', { needs: (c) => !c.parts?.title }),
  A('subtitle', 'Subtitle', 'a subtitle', { needs: (c) => !c.parts?.body }),
  A('kicker', 'Kicker', 'a kicker above the headline', { needs: (c) => !c.parts?.eyebrow }),
  A('support', 'Supporting text', 'a supporting line'),
  A('cta', 'CTA', 'a call to action', { needs: (c) => c.role === 'cta' }),
];

/* ── AND THE THINGS THAT OPEN A DOOR RATHER THAN SEND A SENTENCE ──────────
 * `act` names a flow the Editor already owns — the picture chooser, the
 * reference reader, the arrangement grid. The caller runs it; this file only
 * says which one is worth offering here. A door is never faked: if the caller
 * has no handler for an act, the action is dropped before it is drawn.
 */
const VISUAL_KIDS = [
  A('project', 'Project photos', null, { act: 'media' }),
  /* and `Upload` goes to the file chooser, not to the library with an upload
     button in its corner: two chips that open the same sheet are one chip
     with two names (Leon, Sep 24) */
  A('upload', 'Upload an image', null, { act: 'upload' }),
  A('reference', 'Design from a reference', null, { act: 'reference' }),
];

/* ══ THE CATALOGUE, BY WHAT IS SELECTED ═══════════════════════════════════
 * Written as everything that COULD be offered. Ranking is below, and it is
 * what decides which three to five of them a studio actually sees.
 */

/* WHAT IS NOT OFFERED, AND WHY: `Make specific` and `Emphasize`. The first
   needs a fact the post may not hold and the reader has no intent for it; the
   second is scale and weight, which the toolbar on the selection already does
   by hand — the brief's own rule about not turning manual controls into chips
   (§26). Both come back the moment there is something behind them. */
const TEXT_ACTIONS = [
  A('rewrite', 'Rewrite', 'rewrite the opening so it lands', { kids: REWRITE_KIDS, hint: "Describe how you'd like it rewritten…" }),
  A('shorter', 'Make shorter', 'make it shorter'),
  A('detail', 'Add detail', 'add more detail', { kids: DETAIL_KIDS, hint: 'What should it say more about?' }),
  A('simplify', 'Simplify', 'make it simpler'),
  A('tone', 'Change tone', 'change how it sounds', { kids: TONE_KIDS, hint: 'How should it sound?' }),
];

const PLACE_ACTIONS = [
  A('project', 'Add a project image', null, { act: 'media' }),
  A('upload', 'Upload an image', null, { act: 'upload' }),
  A('generate', 'Generate an image', 'generate an image for this place',
    { needs: (c) => c.canGenerate, hint: 'What should the picture show?' }),
];

const PICTURE_ACTIONS = [
  A('replace', 'Replace', null, { act: 'media', hint: "Describe what you'd prefer…" }),
  A('crop', 'Crop', 'crop it', {
    kids: [
      A('subject', 'Focus the subject', 'to focus the subject'),
      A('space', 'Show more space', 'to show more around it'),
      A('reframe', 'Reframe', 'reframed'),
      A('fit', 'Fit the layout', 'to fit the arrangement'),
    ],
    hint: 'What should be in frame?',
  }),
  A('bigger', 'Give it more room', 'give the picture more room on the slide'),
  A('mood', 'Improve the mood', 'improve the mood of this picture'),
];

const POST_ACTIONS = [
  A('write', 'Write this slide', 'Write the words for this slide, from the story this post is telling.',
    { needs: (c) => c.bare }),
  /* the three this slide's own words can actually be made to do. `Improve
     hierarchy` and `Improve balance` were here and are not: they are about
     the arrangement, the reader has no intent for either, and a chip that
     reports `nothing changed` is worse than a chip that is not there. */
  A('improve', 'Improve this slide', 'make it clearer', {
    kids: [
      A('clearer', 'Make it clearer', 'simpler and clearer'),
      A('less', 'Cut it back', 'shorter'),
      A('message', 'Strengthen the opening', 'so the opening lands'),
    ],
    hint: "Describe anything you'd like kept or changed…",
  }),
  A('visual', 'Add a visual', null, { kids: VISUAL_KIDS, hint: 'What should it show?' }),
  A('text', 'Add text', 'add', { kids: TEXT_KINDS, hint: 'What should it help explain?' }),
  /* ── AND THE ROW DOES NOT SAY WHAT THE ⋯ ALREADY SAYS (Leon, Sep 24) ─
     "In the chat field suggestions, do not repeat the options in the context
     menu."
     `Change the layout` and `Change the look` were exactly the menu's own
     `Layouts` and `Themes`, two inches above and one press away, with a grid
     of real answers behind each of them. A row that offers the same doors is
     spending the one place this Editor keeps for what Bauhly can do on what
     the studio can already do themselves — which is the brief's own rule
     about manual controls (§26) applied to a menu rather than to a handle.
     What survives is the part of them that is not a door: `Improve this
     slide` still reaches for hierarchy, balance and less text, which is an
     arrangement asked for in words rather than picked off a grid. */
  A('logo', 'Add your logo', null, { act: 'logo', needs: (c) => c.canLogo }),
  A('flow', 'Improve the flow', 'improve how the slides follow each other',
    { needs: (c) => (c.slides || 1) > 2 }),
];

/* the logo keeps the three a studio actually asks of it, and they are the
   three its own controls answer — see `SEL_TRIES` in refinetalk.js, which
   this replaces for every other selection but not for this one: a mark is
   moved, sized and taken off, and all three are manual controls that exist */
const MARK_ACTIONS = [
  A('corner', 'Move it to another corner', 'move the logo to another corner'),
  A('smaller', 'Make it smaller', 'make the logo smaller'),
  A('off', 'Take it off this slide', 'take the logo off this slide'),
];

const BY_KIND = {
  text: TEXT_ACTIONS,
  place: PLACE_ACTIONS,
  picture: PICTURE_ACTIONS,
  post: POST_ACTIONS,
  mark: MARK_ACTIONS,
};

/* ══ RANKING ══════════════════════════════════════════════════════════════
 *
 * What the brief asks for in one line: "do not solve ranking by displaying
 * every valid action." So each one is scored against the context and the best
 * few are drawn. The numbers are small and the rules are few on purpose —
 * this is an order of preference, not a model, and it has to stay legible to
 * whoever reads it next.
 */

/* what each slide role wants first, in the language of the catalogue above.
   Straight from the brief's own priorities (§9), mapped onto the roles this
   product actually has (lib/narrative.js). */
const ROLE_WANTS = {
  hook: { rewrite: 3, shorter: 2, simplify: 1, visual: 2 },
  context: { detail: 2, simplify: 2, visual: 1 },
  struggle: { rewrite: 2, detail: 2, visual: 1 },
  shift: { detail: 3, simplify: 2, rewrite: 1, visual: 1 },
  evidence: { detail: 2, project: 2, visual: 2 },
  framework: { simplify: 2, detail: 2, shorter: 1 },
  takeaway: { shorter: 2, rewrite: 1 },
  cta: { tone: 3, rewrite: 2, shorter: 1 },
};

/* and what each refinement wants, once its parent is armed: the same table,
   one level down, so a hook's rewrite leads with impact and a CTA's with
   voice (the brief, §11) */
const ROLE_KID_WANTS = {
  hook: { impact: 3, curious: 2, concise: 1 },
  context: { explan: 2, simpler: 2, context: 2, concise: 1 },
  struggle: { explan: 2, natural: 1 },
  shift: { explan: 3, why: 3, simpler: 2, context: 1 },
  evidence: { why: 1, concise: 1 },
  framework: { simpler: 2, concise: 2 },
  takeaway: { impact: 2, concise: 2 },
  cta: { natural: 3, conv: 2, warm: 1, concise: 1 },
};

/* the length a line has to pass to be worth shortening, and the one under
   which it is worth adding to. Characters, because that is what the product
   holds — a headline of ten words is long for a hook and short for a
   framework step, which is what the role weighting above is for. */
const LONG = 90;
const SHORT = 34;

const scoreOf = (a, c, wants) => {
  let n = wants?.[a.id] || 0;
  if (c.kind === 'text') {
    if (a.id === 'shorter') n += c.len > LONG ? 3 : (c.len > SHORT ? 0 : -2);
    if (a.id === 'detail') n += c.len < SHORT ? 2 : 0;
    if (a.id === 'simplify') n += c.len > LONG ? 1 : 0;
  }
  if (c.kind === 'post') {
    /* the brief's own example: text-heavy and weak on hierarchy asks for
       less text and a visual, not for more decoration */
    if (a.id === 'visual') n += c.hasArt ? -2 : 2;
    if (a.id === 'improve') n += c.heavy ? 2 : 0;
    if (a.id === 'text') n += c.bare ? -3 : (c.room ? 1 : -1);
    if (a.id === 'layout') n += c.heavy ? 1 : 0;
  }
  if (c.kind === 'picture' && a.id === 'mood') n += 1;
  return n;
};

const allowed = (a, c) => {
  if (a.needs && !a.needs(c)) return false;
  /* a door nobody can open is not offered — the caller says which acts it
     has, and an action whose only outcome is a missing flow is dropped
     rather than drawn dead (the brief, §35) */
  if (a.act && c.acts && !c.acts.includes(a.act)) return false;
  return true;
};

/* ── AND THE ROW IS WHATEVER LEVEL THE STUDIO IS ON ───────────────────────
 * Nothing armed: the actions for what is selected. An action armed: its
 * refinements. Both armed: nothing — the instruction is complete and the row
 * makes way for the field, which is the one thing left to add.
 */
export function actionsFor(ctx) {
  const c = ctx || {};
  if (c.action && c.modifier) return [];
  if (c.action) {
    const parent = (BY_KIND[c.kind] || []).find((a) => a.id === c.action);
    const kids = (parent?.kids || []).filter((k) => allowed(k, c));
    const wants = ROLE_KID_WANTS[c.role] || {};
    return [...kids]
      .map((k, i) => ({ k, n: (wants[k.id] || 0) * 10 - i }))
      .sort((x, y) => y.n - x.n)
      .slice(0, 5)
      .map((x) => x.k);
  }
  const wants = ROLE_WANTS[c.role] || {};
  const list = (BY_KIND[c.kind] || []).filter((a) => allowed(a, c));
  return list
    .map((a, i) => ({ a, n: scoreOf(a, c, wants) * 10 - i }))
    .sort((x, y) => y.n - x.n)
    .slice(0, c.kind === 'post' ? 5 : 4)
    .map((x) => x.a);
}

export const actionOf = (kind, id) => (BY_KIND[kind] || []).find((a) => a.id === id) || null;
export const modifierOf = (kind, id, kidId) => {
  const parent = actionOf(kind, id);
  return (parent?.kids || []).find((k) => k.id === kidId) || null;
};

/* ── WHAT THE FIELD ASKS FOR, AT WHATEVER LEVEL IT IS ─────────────────────
 * "Suggestion chips answer what Bauhly can do. Placeholder text answers what
 * the user can optionally tell Bauhly." So it is a question about the ADDED
 * information, never a description of the action the badges already name.
 */
export function askHint(ctx, fallback) {
  const c = ctx || {};
  if (c.action && c.modifier) {
    const kid = modifierOf(c.kind, c.action, c.modifier);
    return kid?.hint || 'Add anything Bauhly should consider…';
  }
  if (c.action) {
    const a = actionOf(c.kind, c.action);
    return a?.hint || 'Add anything Bauhly should consider…';
  }
  return fallback;
}

/* ── AND SUBMIT IS ONE SENTENCE, MADE OF WHAT IS ON SCREEN ────────────────
 * The badges are the instruction and the typed line is the addition to it, so
 * a studio who chose `Rewrite → More impactful` and typed nothing has said
 * something complete: "Rewrite it, more impactful." What they type is
 * appended rather than merged, because it is theirs and the product does not
 * get to rephrase it.
 * Everything else the operation needs — which element, which slide, what the
 * post is about, the direction, the arrangement, the kit — is already carried
 * by the path this sentence travels (`onAskPart` and `onAsk` both take the
 * selection with them), which is why none of it is written into the words.
 */
export function askSay(ctx, typed = '') {
  const c = ctx || {};
  const a = c.action ? actionOf(c.kind, c.action) : null;
  const k = c.action && c.modifier ? modifierOf(c.kind, c.action, c.modifier) : null;
  const said = [a?.say, k?.say].filter(Boolean).join(', ');
  const mine = (typed || '').trim();
  if (!said) return mine;
  const line = said.charAt(0).toUpperCase() + said.slice(1);
  return mine ? `${line}. ${mine}` : `${line}.`;
}

/* whether there is enough on screen to send without typing a word */
export const askReady = (ctx, typed = '') => Boolean((typed || '').trim() || ctx?.action);
