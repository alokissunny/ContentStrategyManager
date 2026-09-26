/*
 * ══ WHAT BAUHLY CAN DO NEXT, HERE ════════════════════════════════════════
 *
 * (Leon, Sep 24, the Edit Mode iteration, step 4: "instead of exposing Add
 * Elements, Themes, Layouts, Colour, Text editing and Composition as separate
 * permanent controls, make them available through the contextual suggestion
 * system above the chat field.")
 *
 * THE INTERACTION THIS SERVES. Select → action → refinement → refinement →
 * Submit, with typing optional at every step:
 *
 *   [This post ×] [Add ×] [Text ×] [A subtitle ×]   What should it say?
 *
 * Every badge is removable and every one of them narrows what the row below
 * offers. A press on the row NEVER writes into the field — the field is the
 * studio's, and a chip that fills it takes the sentence away from them and
 * then makes them edit it back. The row says what can be DONE; the field says
 * what they would like to add to it.
 *
 * WHAT CHANGED IN STEP 4, AND WHY THIS FILE IS A TREE NOW. It held two
 * levels: an action and one refinement. The brief asks for three where three
 * are needed — `Add → Text → Subtitle`, `Theme → Reference → Your own
 * picture` — so the state is a PATH rather than a pair, and a node is a node
 * at any depth. Two levels were never the shape; they were as far as the
 * first pass went.
 *
 * WHY A RESOLVER AND NOT A NESTED MENU. "This must not behave like a static
 * nested menu." A menu shows its whole self and waits; this shows three to
 * five things at each level, chosen against what is selected, what the slide
 * already says, what job it does in the story, and what the post has to work
 * with. Two different slides in the same post open on different rows, and
 * that is the whole point of it.
 *
 * WHAT IT WILL NOT DO. Offer an action whose information does not exist, or
 * whose door this build does not have. The framework's accuracy rule
 * (lib/narrative.js) is that the product never invents a fact about the
 * project; the brief's own is that a suggestion never leads to a dead end
 * (step 10). So `Generate an image` is not drawn where there is no image
 * model, `Your logo` is not drawn where there is no logo, and a level whose
 * children have all fallen away is not drawn either — see `liveKids`.
 *
 * HOW IT REACHES THE PRODUCT. Nothing here executes anything. A leaf either
 * resolves to a SENTENCE (`askSay`) that travels the road a typed one already
 * travels — `interpret` reads it as words, as a direction or as an
 * arrangement, which is what `mode` below chooses — or it names a DOOR
 * (`act`) that the caller owns. So an action can only ever do what a studio
 * could already have asked for in words or reached with their own hands, and
 * the catalogue cannot drift away from what the build supports.
 */

import { DNA_AREAS, askAreas, dnaSentence } from './dna.js';
/* what each slide's job in the story asks the studio for — authored per role
   in the Content OS and surfaced here for the first time (Leon, Sep 25) */
import { askOf } from './narrative.js';

/* ── the shape of a node ──────────────────────────────────────────────────
 *   id      stable, so a badge survives a re-render
 *   label   what the chip says — a verb or a thing, two or three words
 *   say     the words it contributes to the sentence (null for a grouping
 *           node, which is a heading and not an instruction)
 *   sep     what joins its words to the ones above it (', ' unless stated)
 *   mode    which reader the finished sentence is handed to first:
 *           'text' | 'theme' | 'layout' (see `interpret` in refinetalk.js).
 *           Inherited down a path — the deepest one that states it wins.
 *   hint    the placeholder while it is armed ("what can you optionally add")
 *   kids    the level under it
 *   act     the id of a door this press opens instead (the caller owns these)
 *   needs   what must be true for it to be offered at all
 */

const A = (id, label, say, extra = {}) => ({ id, label, say, ...extra });

/* ── AND ONE NODE'S WORDS DEPEND ON WHAT IS ALREADY KNOWN (Leon, Sep 24) ──
   `Sound like me` says something different to a studio Bauhly has learnt four
   things about than to one it has learnt nothing about, and it is the only
   node in this file that does. So `say` may be a FUNCTION of the context, and
   every reader of it goes through here rather than touching `.say` directly —
   which is why this is three lines and not a special case in four places. */
const sayOf = (node, c) => (typeof node?.say === 'function' ? node.say(c || {}) : node?.say);

/* ── AND THE SENTENCE IS WRITTEN FOR THE READER THAT GETS IT ──────────────
 * (Leon, Sep 24, measured: `Improve this slide, by cutting the text back.`
 * came back having ADDED a line.)
 * The label is the studio's word and `say` is what the product's own reader
 * is handed — and that reader is not a model. `lib/polish.js` matches on a
 * vocabulary and tests it in order, so a sentence about cutting that happens
 * to contain the word `text` lands on `add` before it reaches `shorter`;
 * `readTheme` and `readLayout` in refinetalk.js each have their own. Every
 * `say` below is written in the vocabulary of the reader its `mode` sends it
 * to, which is what keeps a chip's promise the same as its result.
 */

/* ══ THE WORDS ════════════════════════════════════════════════════════════ */

const REWRITE_KIDS = [
  A('concise', 'Shorter and tighter', 'shorter'),
  A('explan', 'Explain it more', 'and add more detail'),
  A('impact', 'Hit harder', 'so the opening lands'),
  A('simpler', 'Use simpler words', 'simpler'),
  A('curious', 'Make them want more', 'so the opening pulls the reader in'),
];

const TONE_KIDS = [
  A('pro', 'More professional', 'more professional'),
  A('conv', 'More like talking', 'warmer and more casual'),
  A('warm', 'Warmer', 'warmer'),
  A('minimal', 'Plainer', 'plainer'),
];

/* ── AND DETAIL IS ONLY OFFERED WHERE THERE IS DETAIL TO ADD ──────────────
 * Each of these asks the studio for something the post may not contain. They
 * are offered all the same — the studio is the one who knows — but the
 * placeholder asks the question rather than the product answering it, which
 * is the accuracy rule in the one place it can actually bite.
 */
const DETAIL_KIDS = [
  A('why', 'Say why it mattered', 'add a line on why this mattered', { hint: 'Why did it matter?' }),
  A('context', 'Say what leads up to it', 'add a line of context', { hint: 'What should the reader know first?' }),
  A('example', 'Give an example', 'add an example', { hint: 'Which example?' }),
  A('process', 'Explain how it was done', 'add a line on how it was done', { hint: 'What did the process involve?' }),
  A('result', 'Say how it turned out', 'add a line on the result', { hint: 'What happened as a result?' }),
];

/* ══ THE THIRD LEVEL UNDER `ADD` ══════════════════════════════════════════
 *
 * (The brief, step 4: "Add → Text / Visual / Graphic", and under Text
 * "Title, Subtitle, Supporting text, Label, Number, CTA — only show options
 * that make sense for the current slide.")
 *
 * `needs` is what "make sense" comes to here: a slide that already has a
 * title is not offered one, and a CTA is offered where the slide's job in the
 * story is to ask for something — or where the post is a single slide, which
 * is the brief's own example of a hook that has to carry a CTA as well.
 * `sep` is a space rather than a comma on all of them, because the parent's
 * word and this one are one phrase: `Add` + `a subtitle`.
 */
/* ══ THE WORDS A SLIDE CAN BE GIVEN ══════════════════════════════════════
 *
 * (Leon, Sep 25, the Words brief: "the suggestions shown under Words must
 * adapt to the current slide… rank and show only the text additions that
 * make sense for that particular slide.")
 *
 * WHAT THE COMPOSITION ACTUALLY DRAWS, which is the only list this may be
 * measured against: `rolesOf` in lib/slidetext.js resolves the flat roles a
 * layout was AUTHORED with — `eyebrow`, `head`/`big`, `body` — plus the
 * numbered LIST roles `items.N`, whose length the arrangement decides
 * (`maxItemsOf`). Across the 46 compositions this build ships, `detail` is
 * authored by none of them and `.tsl__by`, the credit line, resolves to
 * nothing. So there are THREE places on a slide for a line to go, and the
 * whole of this level is: which of the three are free, and what is the most
 * useful thing to put in the ones that are.
 *
 * WHICH IS WHY THIS IS SIXTEEN CHIPS AND A ROW OF FIVE. The brief asks for
 * thirteen more elements than were here, and then asks — in the same breath
 * — that they never be shown as a list. Both halves are the same mechanism:
 * a chip earns its place by naming a FUNCTION the slide is missing, in a
 * SLOT the composition has open, with SOURCE for it in the post. Fail any of
 * the three and it is not drawn, which is §6 and §7 in one sentence.
 *
 * `WORD_SLOTS` is the first of those, and it is exported because the demo's
 * writer needs the same answer this level is gated on — a chip that offers
 * the body and a writer that fills the eyebrow would be two opinions about
 * one press (lib/demoactions.js).
 *
 * WHAT THIS REVERSES, said plainly: "a QUOTE and a STATISTIC are a title in
 * a different voice — Rewrite and the type controls are where that is said."
 * That was true of REWRITING a line the studio has. It was never true of
 * adding one they do not: `Rewrite the words` cannot put a client's sentence
 * on an evidence slide that has no sentence on it yet. The two levels answer
 * different questions and both of them are worth having.
 */

/* ── WHICH SLOT EACH CHIP FILLS, IN ORDER OF PREFERENCE ───────────────────
 * Read twice: here, to decide whether a chip is offered at all, and in
 * lib/demoactions.js, to decide where its line lands. A chip whose every
 * slot is taken is a chip that can only fail, and this level does not draw
 * those — §6's "avoid suggestions that would create unnecessary text
 * density", which on a three-slot composition is not a matter of taste.
 */
export const WORD_SLOTS = {
  /* the general one: whichever of the three is most worth filling, which is
     a decision rather than a preference — see `neededWord` */
  need: ['title', 'body', 'eyebrow'],
  title: ['title'],
  question: ['title', 'body'],
  quote: ['title', 'body'],
  subtitle: ['body'],
  explain: ['body'],
  callout: ['body'],
  fact: ['body'],
  caption: ['body'],
  note: ['body'],
  carry: ['body'],
  key: ['body', 'title'],
  closing: ['body', 'title'],
  cta: ['body', 'title'],
  /* the three that compete for the one small line above the headline. They
     are different FUNCTIONS — a kicker sets a tone, a label names a section,
     a number says where you are — and the slide has room for one of them, so
     the ranking below is what decides which is worth the slot on this slide */
  kicker: ['eyebrow'],
  label: ['eyebrow'],
  num: ['eyebrow'],
  /* a list is not a slot: the arrangement has rows or it has not, which is
     `canList` */
  list: [],
};

/* ── AND THE TWO FACTS ARE NOT THE SAME FACT ─────────────────────────────
 * `slots` is what the COMPOSITION DRAWS. `parts` is what is currently IN it.
 * Measured on the demo carousel, and this is the whole reason the rule below
 * is shaped the way it is: on all six slides every drawn role is occupied.
 * It is not that the studio filled them — `adapted` fills an empty role from
 * the post's spare sentences, because a composition with a hole in it is
 * worse than one Bauhly finished. A composition on screen is always
 * complete.
 *
 * So `parts` cannot be the gate. Gated on it, this level offers nothing on
 * any slide of any post, which is not what §6 asks for — it asks that a
 * suggestion not DUPLICATE a function the slide already has.
 *
 * The gate is `slots`, and it is absolute: a chip whose element the
 * composition does not draw has nowhere to land, and drawing it would be the
 * dead end step 10 forbids. `A small line on top` is not offered on a
 * statement, which draws a headline and nothing else.
 * `parts` decides WHICH of a chip's slots it takes — an empty one first —
 * and, for the three chips whose name means "one more of these", whether it
 * is offered at all. `A subtitle` on a slide that already draws one is the
 * duplicate §6 names; `A callout` on a slide with a body line is the studio
 * saying what that line should be doing, which is the press they made.
 */
const drawn = (c, id) => (WORD_SLOTS[id] || []).filter((s) => c?.slots?.[s]);
/* where this chip's line lands: the first place the composition draws that
   has nothing in it, and otherwise the first place it draws at all */
export const wordSlot = (c, id) => {
  const can = drawn(c, id);
  return can.find((s) => !c?.parts?.[s]) || can[0] || null;
};
/* whether the composition draws this element anywhere */
const fits = (c, id) => drawn(c, id).length > 0;
/* whether it draws one that is still empty — the stricter test, kept by the
   three chips that would otherwise offer a second title, a second line under
   it, or a second kicker */
const free = (c, id) => drawn(c, id).some((s) => !c?.parts?.[s]);

/* ── AND WHAT THE SOURCE WILL STAND BEHIND (the brief, §7) ────────────────
 * "Adding a text element must never invent project information. A fact or
 * detail, a quote, an annotation, an image caption… must be grounded in
 * information already available from the capture/project/post context. If
 * the required information isn't available, don't surface that suggestion."
 *
 * The second half is the part a catalogue can enforce, and it is enforced
 * HERE rather than at generation time, because a chip that appears and then
 * apologises has already made the promise. `c.source` is what the post and
 * its project actually hold — the caption the post was planned with, the
 * studio's own capture notes, the one CTA the framework allows — and each of
 * these four chips is gated on the material it would have to draw from.
 */
const SOURCED = {
  fact: (c) => Boolean(c.source?.fact),
  quote: (c) => Boolean(c.source?.quote),
  caption: (c) => Boolean(c.source?.caption),
  note: (c) => Boolean(c.source?.caption),
};

const TEXT_KINDS = [
  /* ── AND THE SLIDE'S OWN JOB IS THE FIRST THING IT ASKS FOR (Leon,
     Sep 25) ──────────────────────────────────────────────────────────────
     Every other chip on this level names a SLOT — a title, a line under it,
     a kicker — which is a question about the composition, and the studio's
     question is about the story: this is the evidence slide, what goes on
     it? `lib/narrative.js` has answered that since the day it was written
     (`asks`, one line per role: "What you actually saw. Never a number you
     cannot stand behind.") and nothing in the product had ever shown it to
     anyone.
     So the beat's own ask leads the row, and it is the HINT that carries it
     — the question in the field, where the caret is, at the moment the
     studio is deciding what to write.
     ── AND IT IS NOT ALWAYS THE SAME KIND OF LINE (Leon, Sep 25, §3) ────
     "When selected, inspect the current slide, surrounding slides and
     narrative role, then determine the single most useful missing text
     element. It should not always generate the same type of text."
     Which is the one chip on this level that does not name its own answer.
     It used to write the beat's headline and nothing else; it now runs the
     same ranking the ROW is built from and spends it on the winner — a
     subtitle here, a callout there, a caption on the slide with the
     photograph. See `neededWord` in lib/demoactions.js, which is the same
     table read for one answer instead of six.
     Not on the two beats whose ask another chip on this row already makes:
     `framework` asks for the steps, which is `A list of steps`, and `cta`
     asks for the one ask, which is `Something to do next`. */
  A('need', 'The line this slide needs', 'a line that does this slide’s job in the story', {
    sep: ' ',
    /* ── AND IT STANDS DOWN ONLY WHERE ANOTHER CHIP MAKES ITS ASK ─────
       `framework` asks for the steps and `cta` asks for the one ask, so on
       those two beats this would be a second wording of the chip beside it.
       Asked of whether that chip is ACTUALLY on the row, not of the role
       alone: a framework slide whose arrangement draws no list, and a CTA
       slide whose ask is already written, both have the other chip gone —
       and excluding this one as well left the level empty on the last slide
       of the demo post, which is the one place the general chip is most
       obviously wanted. */
    needs: (c) => Boolean(c.role)
      && !(c.role === 'framework' && c.canList)
      && !(c.role === 'cta' && !c.ctaOn && fits(c, 'cta'))
      && fits(c, 'need'),
    hint: (c) => askOf(c.role),
  }),
  A('title', 'A title', 'a title', { sep: ' ', needs: (c) => free(c, 'title') }),
  A('subtitle', 'A subtitle', 'a subtitle', { sep: ' ', needs: (c) => free(c, 'subtitle') }),
  A('kicker', 'A small line on top', 'a kicker above the headline', { sep: ' ', needs: (c) => free(c, 'kicker') }),
  /* ── AND A NUMBER IS A POSITION, NOT A PIECE OF COPY (the brief, §4) ──
     "Only make it available for multi-slide posts. It should understand the
     full carousel, so generated numbering is consistent across slides."
     Both halves are facts this file can hold: a single post has no position
     to state, and a slide that already carries one does not want a second
     (§6). What the number LOOKS like — `1/6`, `01`, `01 — 06` — is the
     direction's business and is decided where the direction is known
     (`slideNumber`, lib/demoactions.js). */
  A('num', 'Slide number', 'the slide number', {
    sep: ' ',
    needs: (c) => (c.slides || 1) > 1 && !c.numbered && fits(c, 'num'),
    hint: 'Anything about how it should be written?',
  }),
  /* a label opens a section, so it is not offered on the slide that closes
     the post — §6's "final slide: don't prioritise elements intended to
     introduce a new section", taken as the rule it is rather than as a
     ranking nudge */
  A('label', 'A section label', 'a section label', {
    sep: ' ',
    needs: (c) => (c.slides || 1) > 1 && !c.last && fits(c, 'label'),
  }),
  A('explain', 'A short explanation', 'a short explanation', {
    sep: ' ',
    needs: (c) => fits(c, 'explain'),
    hint: 'What needs explaining?',
  }),
  A('key', 'A key takeaway', 'the key takeaway', {
    sep: ' ',
    needs: (c) => (c.last || ['shift', 'evidence', 'takeaway', 'cta'].includes(c.role)) && fits(c, 'key'),
  }),
  A('callout', 'A callout', 'a callout', {
    sep: ' ',
    needs: (c) => c.role !== 'hook' && fits(c, 'callout'),
    hint: 'What should it pull out?',
  }),
  A('fact', 'A fact or detail', 'a fact from the project', {
    sep: ' ',
    needs: (c) => SOURCED.fact(c) && fits(c, 'fact'),
    hint: 'Which detail?',
  }),
  /* neither of these is worth a word on a slide with nothing to caption or
     annotate — §6's "no image → don't suggest Image caption or Annotation",
     asked of what the slide is actually DRAWING rather than of what its
     arrangement has room for */
  A('caption', 'An image caption', 'a caption for the picture', {
    sep: ' ',
    needs: (c) => c.hasPhoto && SOURCED.caption(c) && fits(c, 'caption'),
    hint: 'What should the caption say?',
  }),
  A('note', 'An annotation', 'an annotation on the picture', {
    sep: ' ',
    needs: (c) => c.hasPhoto && SOURCED.note(c) && fits(c, 'note'),
    hint: 'What should it point at?',
  }),
  /* a quote can be the headline as easily as the line under it, so it is one
     of the few that may take a title — which is exactly why it is kept to
     the beats a quotation belongs on. A client's sentence over a framework's
     steps is not evidence, it is a headline that lost its slide. */
  A('quote', 'A quote', 'a quote from the project', {
    sep: ' ',
    needs: (c) => ['hook', 'struggle', 'shift', 'evidence', 'takeaway'].includes(c.role)
      && SOURCED.quote(c) && fits(c, 'quote'),
  }),
  A('question', 'A question', 'a question', {
    sep: ' ',
    needs: (c) => (c.first || ['hook', 'struggle', 'cta'].includes(c.role)) && fits(c, 'question'),
    hint: 'What should it ask?',
  }),
  /* ── AND A TRANSITION IS ABOUT TWO SLIDES (the brief, §5) ─────────────
     "This is specifically about narrative continuity, not simply adding more
     copy. Don't show it where a transition would be unnecessary or awkward."
     Three things make it awkward and all three are checkable: there is no
     next slide, the next slide says nothing yet to flow INTO, or this one is
     the ask — a CTA transitions to the follow button and not to a slide. */
  A('carry', 'Continue the story', 'a line that carries into the next slide', {
    sep: ' ',
    needs: (c) => (c.slides || 1) > 1 && !c.last && c.role !== 'cta' && c.nextSaid && fits(c, 'carry'),
  }),
  A('closing', 'A closing line', 'a closing line', {
    sep: ' ',
    needs: (c) => (c.last || ['takeaway', 'cta'].includes(c.role)) && !c.first && fits(c, 'closing'),
  }),
  /* only where the arrangement draws one — see `canList`. A list asked for on
     a full-bleed photograph has nowhere to land, and a chip that can only
     fail is the one thing this catalogue does not draw. */
  A('list', 'A list of steps', 'a numbered list of steps', {
    sep: ' ',
    needs: (c) => c.canList,
    hint: 'What are the steps?',
  }),
  /* ── AND THE FRAMEWORK ALLOWS ONE (lib/narrative.js, the checklist) ───
     "One CTA. Never two." — which is `CHECKLIST.cta`, already the product's
     own rule about a finished post, and §6 asks for it here: "existing CTA →
     don't suggest another CTA". `ctaOn` is whether the post has spent it. */
  A('cta', 'A CTA', 'a call to action', {
    sep: ' ',
    needs: (c) => (c.role === 'cta' || (c.slides || 1) === 1) && !c.ctaOn && fits(c, 'cta'),
  }),
];

/* ── AND THE ROW IS RANKED BY THE SLIDE'S JOB, NOT BY THIS ORDER ──────────
 *
 * (The brief, §2: "use the actual slide narrative/context when ranking" —
 * and its examples, which are the five columns below read left to right.)
 *
 * Sixteen chips, of which `needs` typically leaves seven or eight live and
 * the cap draws six. So this table is what the studio actually sees, and it
 * is the only thing standing between "adapts to the slide" and "the first
 * six in the file". Weights are small integers for the same reason every
 * other table here is: it is an order of preference, not a model.
 *
 * It hangs off the `text` node rather than joining `ROLE_KID_WANTS`, because
 * that table is read at EVERY level below the first and these ids mean
 * nothing on the rewrite or detail levels — one shared namespace for three
 * unrelated rows is how a weight for `A callout` ends up reordering
 * `Say why it mattered`.
 */
const ROLE_WORDS = {
  /* the opening: the line, what sits under it, and where the reader is */
  /* `cta` is live on a hook only when the hook IS the whole post — the
     brief's own example of a single slide that has to carry the ask as
     well (see the chip's `needs`). Weighted here because that is the one
     case it appears in, and unweighted it sat last of sixteen and fell off
     the row of six on the very post that needs it most. */
  hook: { need: 6, question: 4, cta: 4, subtitle: 3, title: 3, kicker: 3, num: 1 },
  /* the explanation slides: say it, name the section, carry it forward */
  context: { need: 6, explain: 4, label: 3, carry: 3, subtitle: 2, callout: 2, num: 1 },
  struggle: { need: 6, explain: 4, callout: 3, quote: 3, carry: 2, fact: 2, num: 1 },
  shift: { need: 6, callout: 4, explain: 3, carry: 3, key: 2, quote: 1, num: 1 },
  /* the evidence slide is the one with the photograph on it, and the three
     chips that only exist where there is one lead it */
  evidence: { fact: 5, need: 5, caption: 4, note: 4, quote: 2, callout: 2, num: 1 },
  /* the steps ARE the slide — everything else on a framework slide is
     furniture around them */
  framework: { list: 6, label: 4, explain: 2, caption: 1, carry: 1, num: 1 },
  takeaway: { need: 6, key: 5, closing: 3, carry: 2, quote: 1, num: 1 },
  cta: { cta: 6, closing: 4, key: 3, question: 1, num: 1 },
};

/* ── AND THE THINGS THAT OPEN A DOOR RATHER THAN SEND A SENTENCE ──────────
 * `act` names a flow the Editor already owns — the picture chooser, the file
 * dialog, the reference reader, the arrangements, the directions, the colour
 * sets. The caller runs it; this file only says which one is worth offering
 * here. A door is never faked: if the caller has no handler for an act, the
 * action is dropped before it is drawn (`allowed`), and a parent left with no
 * children goes with them (`liveKids`).
 */
/* WHAT USED TO BE HERE: `VISUAL_KIDS`, the three ways a picture arrived —
   from the story, from the project, from a file. Two of them are rows of the
   ⋯ menu's `Image` level now, so a level that offered all three was offering
   the same two doors twice; and a level with ONE child left is a press the
   studio pays for to reach a thing that was already in front of them (Leon,
   Sep 25). What survived is the answer only Bauhly can give, and it is the
   chip itself. See `ADD_KIDS`. */

/* ══ AND THE ONE GRAPHIC THIS BUILD HAS IS ALWAYS REACHABLE (Leon,
 * Sep 24) ════════════════════════════════════════════════════════════════
 * "I don't see a way to add artwork like logos or assets."
 * There is no artwork library in this build — `hasArt` is the slide's own
 * picture region, not a set of decorations — so the two graphics a studio
 * can put on a post are their own mark and their own background. The mark
 * was offered on one condition: `canLogo`, which is `has a logo AND it is
 * not on this slide`. On a post where the mark was already drawn, `Add
 * something` came back holding two rows and nothing about logos at all,
 * which is exactly what he was looking for and could not find.
 * Three states, and only ever one of them live:
 *   no logo at all      → upload one, which is also how the Brand Kit gets it
 *   a logo, not on this slide → put it on
 *   a logo, already on  → take the studio to it, so its own actions come up
 * The third is the one that was missing, and it is what makes the row honest:
 * the answer to "where is my logo" is never nothing.
 */
/* ══ AND A GRAPHIC IS A LEVEL, BECAUSE THERE ARE ALWAYS TWO WAYS IN (Leon,
 * Sep 24) ════════════════════════════════════════════════════════════════
 * "In case none have been uploaded, like logos or situations like this, add
 * a sublevel to upload one or use from Brand Kit. Same with backgrounds."
 *
 * WHAT THIS REVERSES, said plainly: the three logo rows above were siblings
 * ON `Add something`, so the row answered "put it on" or "upload one" and
 * never both. A studio with a mark already on the slide could not reach the
 * place marks are kept, and a studio with none was sent to the Brand Kit
 * with no way to simply hand over a file. Both halves are true at once, so
 * the node is a LEVEL and the halves are its children — the same shape `A
 * picture` has had since it was written, and the reason that one never had
 * this problem.
 *
 * The last row is the constant, and it is what keeps `allowed`'s empty-level
 * rule from ever dropping the parent: wherever the studio is, the Brand Kit
 * is somewhere to go. So `Your logo` and `A background` are drawn on every
 * post, in every state, which is the guarantee the three-row version was
 * written for and did not quite reach.
 */
/* ── AND NOT A DOOR TO ANOTHER SCREEN (Leon, Sep 24) ──────────────────────
   "Open your Brand Kit should not be shown as a suggestion."
   It was the constant on both levels, and it was the wrong constant: this row
   exists so a studio can act on the post in front of them, and every other
   chip on it does. A row that leaves the post is the one thing the row is
   not for — the sidebar has carried that link the whole time. What is left on
   each level is the two things that happen HERE: use one you have, or hand
   over a new one. */
/* WHAT USED TO BE HERE: `LOGO_KIDS` and `GROUND_KIDS`, the four ways a logo
   reaches a slide and the three a background does. Both levels are drawn by
   `EditorMore` now — see the `logo` and `background` levels there, which hold
   the same rows with the same guards (Leon, Sep 25). */

/* ══ AND ARTWORK IS A SOURCE, NOT A SHELF OF BUTTONS (Leon, Sep 24) ══════
 *
 * "Artwork should not be buttons that add assets. Artwork refers to upload
 * artwork or choose from library, so the user can choose and AI can use it to
 * decorate the post."
 *
 * WHAT THIS REVERSES, said plainly: four rows, one per prepared cut-out,
 * named after what each picture happens to be. That made the row a CONTENTS
 * LIST of a library the studio cannot see — they were choosing a file by
 * reading its description, which is the one thing a picture chooser exists to
 * save them from. It also welded the product to four assets: a fifth would
 * have been a fifth row, and a studio's own artwork had nowhere to go at all.
 *
 * Two ways in, which is the shape `A background` and `Your logo` have had
 * since the day they were written and the reason neither of them has this
 * problem: use one you have, or hand over a new one. The library is looked
 * AT — a grid of the things themselves — and what is chosen is decoration
 * Bauhly lays on the post.
 */
const ARTWORK_KINDS = [
  /* ── AND THE THIRD ANSWER IS THE ONE-PRESS ONE (Leon, Sep 25) ─────────
     "There's a missing button where I can generate directly, something like
     generate from existing artwork."
     Right, and the level was two halves of the same question without the
     answer most studios want: both rows asked the studio to DECIDE — which
     of my pieces, or which file — and neither asked Bauhly to. It leads,
     the way every level's own `read the slide and do it` answer leads, and
     it reads the slide's job in the story to choose from the pieces already
     in the library (`DEMO_GRAPHIC`). Nothing is uploaded and nothing new is
     drawn; what it picks is something the studio already owns.
     Named for who does the choosing, because that is the whole difference
     between this row and the one under it. */
  A('artauto', 'Let Bauhly pick one', 'use the artwork that fits this slide',
    { hint: 'Bauhly reads this slide\u2019s job in the story and picks from your artwork. Anything it should avoid?' }),
  A('artlib', 'Choose from your library', null, { act: 'artlib' }),
  A('artup', 'Upload artwork', null, { act: 'artup' }),
];

/* ══ AND A DRAWING CAN BE ASKED FOR BY SHOWING ONE (Leon, Sep 25) ══════
 * "Add a sublevel menu in `An illustration`, so the user can add an
 * illustration type reference they like."
 *
 * `An illustration` was a leaf: one press, and Bauhly drew from the slide's
 * place in the story with whatever the field added to it. That is the answer
 * for a studio who can SAY what they want, and the level was missing the one
 * for a studio who can only point at it — which is most people, about a
 * style of drawing. Nobody types `loose ink, flat fills, no outline`; they
 * have a drawing they like.
 *
 * Two answers, in the shape `From my artwork` already has beside it: the one
 * where Bauhly decides leads, and the one where the studio hands something
 * over sits under it. `reference` is the door the bar and the ⋯ already
 * open, and what comes back is READ rather than placed — see `askFor`'s
 * `got.reference`. `From` rather than `Use`, because the drawing is not laid
 * on the slide; only its look travels.
 */
/* the two ways a photograph gets onto a slide, which is one question with
   two answers rather than two rows (Leon, Sep 25). Same shape as
   `GRAPHIC_KINDS` below it: Bauhly's answer leads, the studio's is under it,
   and the second is the `reference` door the bar and the ⋯ already open. */
const PHOTO_KINDS = [
  A('photoauto', 'Let Bauhly make one', 'generate a picture from this slide\u2019s place in the story',
    { hint: 'What should the image show? Leave this empty and Bauhly will pick something that fits this slide.' }),
  A('fromref', 'From an image I like', null, { act: 'reference' }),
];

const GRAPHIC_KINDS = [
  A('gfxauto', 'Let Bauhly draw it', 'draw an illustration that carries this slide\u2019s place in the story',
    { hint: 'Describe what the drawing should show. Leave this empty and Bauhly will draw for this slide\u2019s job in the story.' }),
  /* the same door `From an image I like` opens one level up. Two ways in and
     no second machinery: there it is the look of the whole post, here it is
     the drawing the studio wants theirs to look like. */
  A('gfxref', 'From a drawing I like', null, { act: 'reference' }),
];

/* ══ AND SOMETHING DRAWN, RATHER THAN PHOTOGRAPHED (Leon, Sep 24) ════════
 * "I am missing a suggestion that can generate an illustration or graphics to
 * communicate the narrative."
 *
 * WHY IT IS ITS OWN THING AND NOT A PICTURE. `A picture` asks where a
 * PHOTOGRAPH comes from — the project, a file, a camera — and every answer it
 * has is a file the studio already owns. `Artwork` is the other end: a
 * cut-out they hand over, laid on the slide as decoration. Neither of them is
 * "draw me something that says what this slide is saying", which is the one a
 * designer actually reaches for when a beat has no photograph worth taking.
 *
 * The first answer is the one the studio asked for: Bauhly reads the slide's
 * job in the story — hook, struggle, shift, takeaway — and draws for THAT,
 * rather than for the sentence on the slide. The second is the same act with
 * the studio's own brief in front of it.
 */
/* WHAT USED TO BE HERE: `GRAPHIC_KIDS` — `From this post's story` and
   `Describe what it should show`. They were one question asked twice: both
   draw an illustration for this slide, and the only difference between them
   is whether the studio typed anything, which is what the FIELD is for. So
   the level is the chip and the brief is the placeholder under it (Leon,
   Sep 25). */

const ADD_KIDS = [
  /* `wants` is this level's OWN ranking table (see `ROLE_WORDS`): sixteen
     chips, of which the slide's job decides which six are worth its row */
  /* ── AND IT IS A NOUN LIKE ITS SIBLINGS (Leon, Sep 25) ───────────────
     "`Words` is not clear in the context of making something."
     It was clear when this level was `Add something` and half its children
     were files: `Words` was the one you typed rather than handed over. Under
     `Make something`, beside `An image` and `An illustration`, it is the odd
     register — a bare plural where the others are a thing with an article —
     and a studio reads it as a category rather than as what will land on the
     slide. `Some text` is what arrives. */
  A('text', 'Some text', null, { kids: TEXT_KINDS, wants: ROLE_WORDS, hint: 'What should it say?' }),
  /* ── AND A CHIP SAYS WHAT PRESSING IT DOES (Leon, Sep 25) ────────────
     "Keep this suggestion at one level and rename it to something like
     generate image. Keep it clear and concise, so a 12-year-old
     understands."
     `A picture` was a NOUN for a level, and a noun cannot say who is doing
     the work — the studio read it as "a picture I am about to hand over",
     which is what two of its three children actually were. They are the ⋯
     menu's now. What is left is Bauhly making one, so the chip is the verb
     and its object, and the field under it is where the studio adds to it —
     or does not, in which case Bauhly reads the slide's job in the story,
     which is what this act has always done. */
  /* ── AND A TWELVE-YEAR-OLD SAYS `PHOTO` (Leon, Sep 25) ────────────
     ── AND THEN SAID IMAGE (Leon, Sep 25, same afternoon) ────────────
     "Do not call it photos, call it images."
     Taken on the chip he pointed at and on its twin, because the ask before
     this one was that the two rows say the same words and changing one of
     them alone is how they came apart in the first place. What the argument
     below still gets right is the REGISTER — plain, one word, no article
     games — and `image` passes that as well as `photo` does; what it got
     wrong is whose word it is, which is his to say and not mine.
     The note is kept rather than replaced so the next rename can see both
     halves of the reasoning and not re-run this one.

     WHAT THE FIRST RENAME SAID, kept because half of it still holds:
     "The buttons are unclear — make them easy to understand by a
     12-year-old."
     `An image` and `An illustration` are the words a designer files things
     under. Nobody asks for an image; they ask for a photo. Nobody under
     thirty asks for an illustration; they ask for a drawing. And `visual`
     lays a PHOTOGRAPH — `DEMO_PHOTO`, `DEMO_MEDIA` — so the plain word is
     also the accurate one, which is the test a rename has to pass here.
     Changed on BOTH rows in the same pass, because the ask before this one
     was that the two say the same words: simplifying one of them would have
     put the two levels back out of step by the afternoon. */
  /* ── AND THE TWO WAYS TO GET A PHOTO STAND TOGETHER (Leon, Sep 25) ──
     "Photos and `From an image I like` should be in the same group, not
     separate."
     They were siblings on one row: `A photo` (Bauhly makes one) and `From an
     image I like` (hand one over), reading as two unrelated things to add
     rather than as two answers to the same question. The drawing above
     already had that shape — draw it, or follow one I like — so this takes
     it too, and the two levels now read alike.
     ── AND THE GATE CAME OFF WITH THE LEVEL (Leon, Sep 26) ──────────
     "Recover the image suggestion button we had previously, in All slides
     and This post."
     `needs: !hasPhoto` was written on Sep 25 against his own rule — things
     that already exist on the slide are not offered again — and it was right
     about the chip it was written for: `An image` was then a LEAF that made
     one picture, and a slide already wearing one had the bar's `Replace
     image` for changing it.
     It is a level now, and its second child is `From an image I like`, which
     is not about adding a picture at all: it hands over a reference and the
     post takes its look. Gating the parent made that unreachable on every
     slide that has a photograph — which is most of them, and exactly the
     slide a studio is standing on when they think of it.
     So the gate goes. What it was protecting against is still true of the
     first child and nothing else, and offering to make a picture on a slide
     that has one is a replacement, which is a thing studios ask for. */
  A('visual', 'An image', null, {
    kids: PHOTO_KINDS,
    hint: 'Should Bauhly make one, or follow a picture you like?',
  }),
  /* ── AND THE NAME SAYS WHO DRAWS IT (Leon, Sep 24) ────────────────────
     "An illustration is unclear — it feels like the user should upload an
     illustration, when we will generate it."
     Right, and the row is where the confusion comes from: every other chip
     on it is a NOUN for something the studio hands over — words they write,
     a picture they own, artwork they have, their logo — so a sixth noun read
     as a sixth thing to supply. This one is the only act on the row that
     Bauhly performs, so it is the only one that leads with a verb. The pair
     now reads as what it is: `Draw an illustration` is Bauhly's, `Your
     artwork` is theirs. */
  /* and the same for the drawing, for the same reason: `From a drawing I
     like` is a reference, not a second drawing (Leon, Sep 26) */
  A('graphic', 'A drawing', null, {
    kids: GRAPHIC_KINDS,
    hint: 'Should Bauhly draw it, or follow a drawing you like?',
  }),
  /* ── AND A LEVEL THAT IS NOT ABOUT WORDS SAYS SO (Leon, Sep 24) ────────
     `Add something` carries `What should it say?`, which was true of every
     child it had: Words asks it directly and `A picture` overrides it with
     its own. These two inherited it and the field ended up asking what a
     BACKGROUND should say. The wording is the one `askHint` falls back to
     when a level has no hint of its own — the label, quoted back — written
     here because the fallback cannot reach past the parent's. */
  /* `Your`, for the same reason `Your logo` has always carried it: this is
     the studio's own material being put on the slide, not something being
     made for them (Leon, Sep 24) */
  /* the studio's own cut-outs. The odd one out on this level by design: the
     other three are things Bauhly invents and this is material handed over
     for it to lay — so it is the only child that says where it comes FROM
     rather than what it is. Same gate as the illustration, because both put
     artwork on the slide and the rule is about what is already there. */
  A('artwork', 'From my artwork', null, {
    kids: ARTWORK_KINDS,
    needs: (c) => !(c.artN > 0),
    hint: 'Anything to add about how it should be used?',
  }),
  /* WHAT USED TO BE HERE: `fromref`, `From an image I like`, added this
     morning as a fifth chip on this row. It is `A photo`'s second child now
     — handing over a picture you like is a way of ASKING FOR a photo, not a
     different thing to add (Leon, Sep 25). */
  /* WHAT USED TO BE HERE: `A background` and `Your logo`. Both are chosen by
     looking — a texture and a corner — and both are levels of the ⋯ menu now
     (Leon, Sep 25). What is left on this level is the four things a studio
     hands over or asks Bauhly to make. */
];

/* ══ THE DIRECTION ════════════════════════════════════════════════════════
 *
 * (The brief, step 4: "Theme → Choose theme / Change style / Reference", and
 * step 11: "when the first post is created without a theme, make Theme a
 * relevant contextual suggestion".)
 *
 * WHAT THIS REVERSES, said plainly. `Change the look` came off this row on
 * Sep 24 — "in the chat field suggestions, do not repeat the options in the
 * context menu" — because the ⋯ two inches above held `Themes` with a grid of
 * real answers behind it. The brief's step 4 puts it back, and the reason it
 * is not the same mistake twice is what `Choose from the library` now does:
 * it OPENS that grid, in place, rather than being a second copy of it. The
 * row is the way in; the menu is still the only place directions are drawn.
 *
 * `Change the style` is the half that was never in the menu at all — a
 * direction asked for in words, which `readTheme` has understood since Sep 21
 * and nothing on screen offered.
 */
/* WHAT USED TO BE HERE: `STYLE_KIDS`, the six style words, and the long note
   about the brief's step 4 that put `Change the look` back on the row. Step 4
   is answered in the ⋯ menu now: the six words are its `style` level, one
   press inside `Themes`, and the reference upload and the collection are the
   two rows that were already beside them there (Leon, Sep 25). */

/* WHAT USED TO BE HERE: `LAYOUT_KIDS` and `LOOK_KIDS` — the grid plus six
   described arrangements, and the four ways into a direction. The grids they
   opened were always the ⋯ menu's (`layout`, `themelib`, `colour`); the words
   beside them are levels of it now (Leon, Sep 25). */

/* ══ THE CATALOGUE, BY WHAT IS SELECTED ═══════════════════════════════════
 * Written as everything that COULD be offered. Ranking is below, and it is
 * what decides which three to five of them a studio actually sees.
 */

/* WHAT IS NOT OFFERED HERE, AND WHY. The brief's element-mode list for text
   includes `Style`, `Colour`, `Position` and `Emphasize`. Three of the four
   are the floating toolbar, two inches above the selection, with a ladder of
   real values behind each — and Leon's own rule from the day before is that
   this row does not repeat a menu the studio can already see (Sep 24). The
   fourth, `Position`, has no reader: a sentence about where a headline sits
   is not something `interpret` can answer, and a chip that reports `I did not
   understand that` is worse than a chip that is not there. What is left is
   what only Bauhly can do to a line of type — which is every row below. */
/* ══ AND `SOUND LIKE ME` IS HOW BAUHLY LEARNS TO (Leon, Sep 24) ══════════
 *
 * "Use Sound like me as an opportunity for Bauhly to progressively understand
 * the user's writing preferences. Ask only what Bauhly does not already know →
 * apply the answer → update Brand DNA → do not ask the same thing again."
 *
 * WHAT THIS REPLACES: `Sound more like me`, a leaf under `Write it again` that
 * said `warmer, more like me` to every studio in the product and learnt
 * nothing from being pressed. It was the one chip whose whole subject is the
 * studio, and it was the only one that could not become more true over time.
 *
 * HOW IT IS A LEVEL AND THEN STOPS BEING ONE. Its children are the QUESTIONS
 * Bauhly cannot yet answer, best first and never more than a handful (§2, and
 * `askAreas`). Each answered question takes itself off the row for good. When
 * the last one goes the node has no children left — and it survives, because
 * its words are a function of what has been learnt rather than a fixed string,
 * so `allowed`'s empty-level rule does not reach it (see `sayOf`). An
 * established studio presses one chip and the whole of their voice is applied;
 * a new one is asked a single question in the middle of a change they were
 * making anyway. That is §7, and it is the same node doing both.
 *
 * NOTHING HERE IS A SETTING. There is no screen for these and none is wanted:
 * the answer is given in the row, and changing it is pressing a different chip
 * in the same row — which is why the option a studio has already chosen is
 * marked rather than hidden (`chosen`, attached in `actionsFor`).
 */
const SOUND_KIDS = [
  ...DNA_AREAS.map((area) => A(`dna-${area.key}`, area.chip, null, {
    hint: area.hint,
    /* the area asks its question only while it is one of the few worth
       asking — `askAreas` is the whole of §2 and §3 */
    needs: (c) => askAreas(c.dna || {}).some((x) => x.key === area.key),
    kids: area.options.map((o) => A(`${area.key}-${o.id}`, o.label, o.say, {
      /* both halves of one press: `say` changes the words in front of them,
         `dna` is what the studio will not be asked again (see lib/dna.js) */
      dna: { key: area.key, value: o.value },
      chosen: (c) => {
        const have = (c.dna || {})[area.key];
        return area.multi ? (have || []).includes(o.value) : have === o.value;
      },
    })),
  })),
  /* ── AND A PREFERENCE THE ROW HAS NO CHIP FOR (§5) ──────────────────────
     "I want to sound knowledgeable but never like I'm teaching people" is a
     real answer and none of the chips above is it. Deliberately no `say` of
     its own: with nothing typed there is nothing to send, which is what keeps
     it from becoming a way to submit an empty instruction. What the studio
     writes travels the road a typed line already travels, and `detectPreference`
     is what decides whether it was a rule worth keeping — the queue's job, not
     this file's, because that one IS an inference. */
  A('dna-else', 'Something else…', null, {
    hint: 'Say how you want to sound…',
    needs: (c) => askAreas(c.dna || {}).length > 0,
  }),
];

/* what Bauhly has learnt about how this studio writes — one node, wherever
   the question is asked (Leon, Sep 25) */
const SOUND_LIKE_ME = A('soundlike', 'Sound like me', (c) => dnaSentence(c.dna || {}), {
  kids: SOUND_KIDS,
  hint: 'Anything else about how it should sound?',
  /* ── AND A QUESTION IS NOT AN ANSWER (Leon, Sep 25) ───────────────────
     "When I click Sound like me it activates the Submit button incorrectly,
     as it did not end the suggestion flow."
     Right, and this node is the only one in the catalogue where that is
     true. Everything else that speaks and still has children offers
     REFINEMENTS — `Write it again` is a whole instruction and `impact` or
     `curious` only colour it, which is the brief's own case for submitting
     mid-path. This one's children are the QUESTIONS Bauhly cannot yet answer
     (see the note above `SOUND_KIDS`), so a lit Submit at this level is the
     product offering to act on an interview it has just started.
     `asks` is what `askReady` reads. It lights again the moment there is
     nothing left to ask — an established studio has no live questions under
     this node, presses once, and the whole of their voice is applied, which
     is §7 and is unchanged. */
  asks: true,
});

const TEXT_ACTIONS = [
  A('rewrite', 'Write it again', 'rewrite the opening so it lands', { kids: REWRITE_KIDS, hint: "Describe how you'd like it rewritten…" }),
  A('shorter', 'Make it shorter', 'make it shorter',
    { hint: 'Bauhly will cut it back without losing the point. Anything to keep?' }),
  A('detail', 'Say more about it', 'add more detail', { kids: DETAIL_KIDS, hint: 'What should it say more about?' }),
  A('simplify', 'Make it simpler', 'make it simpler',
    { hint: 'Bauhly will use plainer words and shorter sentences. Anything to keep?' }),
  A('tone', 'Change how it sounds', 'change how it sounds', { kids: TONE_KIDS, hint: 'How should it sound?' }),
  /* `say` is a function because the answer grows: see `SOUND_KIDS` above */
  SOUND_LIKE_ME,
];

const PLACE_ACTIONS = [
  /* ── AND AN EMPTY PLACE HAS ONE THING TO ASK FOR (Leon, Sep 25) ───────
     "Remove `A photo from this project` and `Upload a photo` — they are
     redundant with the top floating toolbar. And `From this post's story` is
     not clear; call it generate image based on this post, concise enough for
     a twelve-year-old."
     Both halves of the same trim. The bar two inches above this row opens
     exactly those two doors with `Add an image`, and this row's own rule
     since Sep 24 is that it does not repeat a menu the studio can see. What
     is left is the one answer only Bauhly can give — and its old name said
     where the idea came FROM, which is the product's own way of describing
     the mechanism rather than the act. The verb is on the chip now, because
     there is no level above it to carry one.
     A single-chip row is right here rather than thin: the subject is an
     empty frame, and there is exactly one thing to do about it that this bar
     does not already do. */
  A('narrative', 'Generate an image', 'generate a picture from this slide\u2019s place in the story',
    { hint: 'Bauhly reads this slide\u2019s job in the story. Anything it should include?' }),
  /* WHAT USED TO BE HERE: `A photo from this project`, `Upload a photo` — the
     floating bar's own two doors — and `Make a picture with AI`, gated on a
     `canGenerate` this build has never set true. */
];

/* ══ WHAT ONLY BAUHLY CAN DO TO A PHOTOGRAPH (Leon, Sep 24) ══════════════
 *
 * "Do not repeat what we have in the floating toolbar in suggestions. Review
 * anywhere this happens."
 *
 * WHAT CAME OFF, and why each one was the bar's and not this row's:
 *   `Crop it`              the bar's pencil opens the real crop tool, with
 *                          handles and a live frame. Four sentences about
 *                          framing beside a control that DOES it is the
 *                          studio choosing between a description and the
 *                          thing itself.
 *   `Use a different pic`  the bar's first button is exactly this, and it
 *                          opens the same sheet.
 *   `Give it more room`    a layout action wearing a picture's clothes, and
 *                          his own reading: it does not make sense here.
 * WHAT CAME ON is what the bar's AI control used to hold — the asks that
 * need a sentence rather than a handle — plus the two the spec named and
 * nothing offered: describing the picture, and straightening it.
 *
 * The rule this row now keeps: a suggestion is something you SAY to Bauhly.
 * If a control on the bar already does it with your hands, it does not
 * belong here.
 */
const PICTURE_ACTIONS = [
  /* ── AND THE LEVEL WAS A LEVEL FOR ONE OF ITS THREE (Leon, Sep 25) ────
     "Remove `Describe what it should show` and put it in the placeholder.
     Put the other two out, and make them short, clear and understood by a
     twelve-year-old."
     `Generate a different image ›` held three children and only one of them
     was a separate decision: describing the picture is not a different ACT
     from generating one, it is the same act with the studio's words in front
     of it — which is what the field under the row is for. With it gone the
     level had two children, and a chevron that opens a list of two the row
     has room for is a press the studio pays for twice.
     So both come out, named for what they do rather than for where the idea
     comes from. `From this post's story` and `From an example I like`
     described the SOURCE, which is the product explaining its own reasoning;
     a studio wants to know what they will get. */
  A('make', 'Generate a new image', 'generate a picture from this slide\u2019s place in the story',
    { hint: 'What should the picture show? Leave this empty and Bauhly will read this slide\u2019s job in the story.' }),
  /* it hands over a photograph and takes its LOOK — the direction, not the
     contents — which is what `reference` has always read. The name says the
     outcome rather than the mechanism. */
  A('ref', 'Copy a style I like', null, { act: 'reference' }),
  /* the one correction a photograph of a room almost always wants, and the
     one thing on this row a handle could not do: verticals that lean */
  A('perspective', 'Correct the perspective', 'straighten the verticals in this picture',
    { hint: 'Bauhly will straighten the lines. Anything to keep?' }),
];



/* ══ THE FOUR WAYS WRITING CHANGES (Leon, Sep 25) ════════════════════════
 * One list, two catalogues. `Rewrite the words` is the same question whether
 * it is asked of one slide or of all of them — the only difference is how far
 * the answer reaches, and that is the SCOPE's job, not the action's. They
 * were written once for All Slides and were missing from the single post
 * entirely; the hints are worded for either, because the reach is said above
 * the field, in the badge, not inside the sentence.
 *
 * The note below about `say` applies to every one of them and is the reason
 * this list exists rather than a second copy: the post level's own
 * `Make it clearer` said `simpler and clearer`, and `simpler` is one of
 * readTheme's words for Architectural Minimal — so on a single slide that
 * chip changed the DIRECTION and left the writing alone, which is exactly
 * the bug All Slides was fixed for. Sharing the nodes is what stops the two
 * drifting apart again.
 */

const WRITE_TONE = [
  /* ── AND THESE ARE NOT WRITTEN IN THE STUDIO'S WORDS (Leon, Sep 24,
     measured) ───────────────────────────────────────────────────────────
     The label is the studio's word; `say` is what the product's own reader
     is handed — which is the rule at the top of this file, and this is the
     place it bites hardest. `interpret` tries `readText`, then `readTheme`,
     then `readLayout`, and `mode` only REORDERS that list: a sentence the
     words-reader has no opinion about goes on to the next one rather than
     stopping. So the obvious phrasings are all traps:
       `simpler and clearer`   → `simpler` is one of readTheme's own words
                                 for Architectural Minimal.
       `more professional`     → readTheme's Editorial Studio.
       `warmer and more casual`→ readTheme's Warm Material.
     Each is rewritten in a word only `lib/polish.js` knows — `clearer`,
     `formal`, `casual` — none of which appears anywhere in refinetalk.js, so
     the sentence reaches the rewriter that was promised. The labels are
     unchanged, because the labels were never the problem. */
  A('shorter', 'Make it shorter', 'shorter',
    { hint: 'Bauhly will cut it back without losing the point. Anything to keep?' }),
  A('clearer', 'Make it clearer', 'clearer and less wordy',
    { hint: 'Plainer words and shorter sentences. Anything to keep?' }),
  A('pro', 'More professional', 'more formal and less casual',
    { hint: 'Steadier and less casual. Anything to keep?' }),
  A('conv', 'More conversational', 'more casual and relaxed',
    { hint: 'Warmer and closer to talking. Anything to keep?' }),
];

const ALL_TYPE_KIDS = [
  A('bigger', 'Bigger titles', 'larger title'),
  A('smaller', 'Smaller titles', 'smaller title'),
  /* ── AND IT SAYS WHAT IT DOES TO THEM (Leon, Sep 25) ────────────────
     "I don't understand what `Stronger titles` is."
     Nor could anyone: it sat between `Bigger titles` and `Smaller titles`,
     so `stronger` read as a third size. It is not a size — the reader steps
     the WEIGHT and the prominence together (`stronger hierarchy` in
     refinetalk.js), which is the title pulling away from the body. So the
     chip names the outcome the studio can see rather than the axis the
     reader moves. */
  A('hier', 'Make titles stand out', 'stronger hierarchy'),
  A('air', 'More space between things', 'more air'),
  A('align', 'Change the alignment', null, {
    hint: 'Where should the words sit?',
    kids: [
      /* `align left` and not `left aligned`: `has` matches WORDS, so
         `\bleft align\b` does not find itself inside `left aligned` (see
         `rx` in refinetalk.js). Written the way the reader spells it. */
      A('left', 'Left aligned', 'align left'),
      A('centre', 'Centred', 'centred'),
      A('right', 'Right aligned', 'align right'),
    ],
  }),
];

const POST_ACTIONS = [
  /* ── AND THE THREE ABOUT THE WORDS SAY SO (Leon, Sep 24) ──────────────
     `mode` was left off these because words are what every sentence in this
     Editor used to be. They are not any more — the row can ask for an
     arrangement or a direction now — and without it these fell through to
     the active tab, which is the LAYOUT reader on this screen. Measured:
     `Improve this slide → Make it clearer` sends `simpler and clearer`, and
     `simpler` is one of `readLayout`'s own words, so the toast came back
     `Refined: more minimal` and the post was rearranged instead of rewritten.
     Stated, so the sentence is read as what the chip promised. */
  /* ══ AND EVERY ACTION SAYS WHAT IT WILL DO (Leon, Sep 24) ═════════════
     "I still don't understand what `Make the slides fit together` is — add
     context in the chat field placeholder."
     A label is two or three words and cannot carry a promise; the field
     under it has a whole line and was spending it on `Add anything Bauhly
     should consider`. So the hint is the explanation: what Bauhly is about
     to do, then the one thing the studio can add to it. Written for the
     reader who has just pressed the chip and wants to know what they have
     asked for before they press Submit.
     Every action that had no hint of its own has one now. The pattern is
     the same each time — a sentence about the act, then a question — and
     the question is what the placeholder is FOR. */
  A('write', 'Write this slide', 'Write the words for this slide, from the story this post is telling.',
    { mode: 'text', needs: (c) => c.bare, hint: 'Bauhly will write this slide from your story. Anything it should include?' }),
  /* ══ AND A SINGLE POST GETS THE SAME REWRITE AS THE CAROUSEL (Leon,
     Sep 25) ═════════════════════════════════════════════════════════════
     "We are missing, in single post, Rewrite the words and its sublevels,
     and Change the type."
     WHAT USED TO BE HERE: `Improve this slide`, with three children of its
     own — clearer, fewer words, a stronger first line. It was the same
     question as All Slides' `Rewrite the words` asked in different words
     with a different, smaller answer set, so a studio who learnt the
     carousel's row found two of their five answers missing on one slide and
     `Sound like me` — the thing the product has actually learnt about them —
     nowhere at all.
     One question, one set of answers, and the reach said above the field
     rather than inside the action. `Make the first line stronger` is the one
     child the carousel's list did not have and it is kept here, because a
     hook is a fact about a SLIDE. Nothing is lost and the two rows now
     differ only where they should. */
  A('rewrite', 'Rewrite the words', null, {
    mode: 'text',
    kids: [
      SOUND_LIKE_ME,
      ...WRITE_TONE,
      A('message', 'Make the first line stronger', 'so the opening lands',
        { hint: 'Bauhly will make the opening land sooner. Anything to keep?' }),
      A('writeelse', 'Something else…', null,
        { hint: 'Say how the writing should change…' }),
    ],
    /* a grouping node, the same as the carousel's: `Rewrite the words.` on
       its own is not an instruction `polish` can place */
    hint: 'How should the writing change?',
    needs: (c) => !c.bare,
  }),
  /* `part` because `add` is half a phrase: its children finish it with a
     space (`Add` + `a subtitle`), so on its own it is not an instruction
     anybody could carry out. See `askReady`, which is what keeps Submit dark
     until the sentence is whole. */
  /* ══ AND THE LEVEL IS NAMED FOR WHO DOES THE WORK (Leon, Sep 25) ═════
     "Change the name `Add something`. Once inside, the idea is to generate
     elements — words, an illustration, an image, or from my artwork."
     `Add something` was written when this level's children were files the
     studio handed over. They are not any more: the two doors that opened a
     chooser are the ⋯ menu's, and what is left is four things BAUHLY makes
     for this slide. `Add` is what the studio does; this is what they ask
     for.
     The verb lives on the level and the children are the nouns that finish
     it — `Make something › An image` — so the work is never named twice and
     every chip is two or three words. */
  A('add', 'Make something', 'add', {
    part: true,
    mode: 'text',
    kids: ADD_KIDS,
    hint: 'What should Bauhly make for this slide?',
  }),
  /* WHAT USED TO BE HERE: `Change the look` and `Change the layout`, and
     before that `Move things around`. All three are the ⋯ menu's now — see
     the note above `BY_KIND` (Leon, Sep 25). */
  /* the carousel's own type level, on one slide — the settings are stored
     per slide already (`partAlign`), so the only thing that was missing was
     the way in (Leon, Sep 25) */
  /* ── AND `TYPE` IS A DESIGNER'S WORD (Leon, Sep 25) ─────────────────
     "`Change the type` is also confusing — find a better name so it is
     understood by a twelve-year-old."
     It is the trade's word for letterforms, and to everyone else `type` is a
     KIND of thing. The row it sits on makes the confusion worse rather than
     better: `Rewrite the words` beside `Change the type` reads as two
     questions about content, one of which is asking what sort of post this
     is. The pair is really what it SAYS and how it LOOKS, so the chip says
     the second one in those words. */
  A('type', 'Change how the text looks', null, {
    kids: ALL_TYPE_KIDS,
    mode: 'text',
    hint: 'Describe how the type should read…',
  }),
  /* ══ WHAT USED TO BE HERE: `MAKE THE SLIDES FOLLOW ON BETTER` (Leon,
     Sep 24, the scope brief, §5) ════════════════════════════════════════
     "When This post is active, this action does not make much sense because
     it refers to the relationship between multiple slides. Remove it."
     Which it never did: the row it sat on says `This post` at the head of
     its own trail, and every other chip on it changes the slide in front of
     the studio. This one quietly rewrote six. It is `story` in the
     whole-carousel catalogue below — same sentence, same reader, asked where
     the answer can be seen. */
];

/* ══ A SELECTED LOGO HAS NOTHING TO SAY (Leon, Sep 25) ══════════════════
 * It had three: another corner, smaller, off this slide. All three are Logo,
 * which is one of the five subjects that left this row for the ⋯ menu — and
 * two of them were already on the mark's own floating bar, two inches above
 * the selection, with real values behind them. So the row is empty when the
 * logo is in the handles, deliberately: everything that can be done to a mark
 * is a control you can see, and there is no sentence about a logo that this
 * product can read. The kind stays in `BY_KIND` so the resolver answers `[]`
 * rather than `undefined` — an empty level is a fact, not a gap.
 */
const MARK_ACTIONS = [];

/* ══ AND THE SAME ROOM, ASKED OF THE WHOLE CAROUSEL ═══════════════════════
 *
 * (Leon, Sep 24: "This post = change the current slide. All slides = give
 * Bauhly a direction for the whole carousel.")
 *
 * WHY A CATALOGUE AND NOT A FLAG. The first shape this was going to take was
 * `POST_ACTIONS` with a `reach` modifier on it — one row, one extra word in
 * the sentence. It is the wrong shape and §4 is why: `Crop it`, `Move it to
 * another corner`, `Put the picture first` and half of `Add something` are
 * about a composition that exists once. A flag would have had to subtract
 * them one `needs` at a time, and every action written afterwards would have
 * had to remember to opt out. A carousel is a different SUBJECT, so it gets a
 * different list — the same way a picture and a line of type already do.
 *
 * WHAT IS IN IT IS WHAT CAN BE SAID ABOUT SIX SLIDES AT ONCE, and nothing
 * else. Four things: the writing, the direction, the type, and the way the
 * slides follow each other.
 *
 * ── AND CONSISTENCY IS NOT DUPLICATION (§4, §6) ─────────────────────────
 * "All slides does NOT mean make every slide the same." Nothing in here can
 * make it mean that, and that is a property of the sentences rather than a
 * rule anyone has to keep: `shorter` is run over each slide's OWN words with
 * each slide's own neighbours beside it (see `askFor` in YourWeek), and a
 * taste patch is a set of type values every slide reads through its own
 * arrangement. There is no node here that writes one slide's content onto
 * another, because there is no sentence in this product that could.
 *
 * ── AND WHAT THE BRIEF ASKED FOR THAT IS NOT HERE ───────────────────────
 * §3 lists `More confident`, `Simplify the language`, `More consistent
 * hierarchy`, four `Brand` rows and four `Images` rows. They are not drawn,
 * and the reason is this file's oldest rule rather than an oversight:
 *   `More confident`  — no intent in lib/polish.js answers it, and the box
 *                       returns silence for an ask it cannot place.
 *   `Simplify the...` — the same intent `Make it clearer` already carries.
 *                       Two chips, one outcome, is one chip with two names.
 *   `...hierarchy`    — nothing measures consistency ACROSS slides; what is
 *                       real is applying one set of type values to all of
 *                       them, which is every other row under `type`.
 *   Brand             — `Adjust colours` is `look › colour`, already here;
 *                       the other three have no reader at all.
 *   Images            — there is no image model and no image-treatment
 *                       reader in this build. A row that promises a
 *                       consistent treatment and delivers nothing is the
 *                       dead end step 10 forbids.
 * Every one of them is a row this can gain the day its reader exists.
 */

/* the writing, across the carousel. Each of these is an INTENT `lib/polish.js`
   actually has — shorter, simplify, professional, playful — plus the one node
   whose words are the studio's own voice. */


const ALL_WRITE_KIDS = [
  /* the same node as on a single slide and on a selected line, one level
     down: what Bauhly has learnt about how this studio writes, applied to
     all of it at once. §3 puts it first and the scoring below keeps it
     there. */
  SOUND_LIKE_ME,
  ...WRITE_TONE,
  /* §3's `Something else…`, and the same shape `dna-else` has: no words of
     its own, so there is nothing to send until the studio writes something */
  A('writeelse', 'Something else…', null,
    { hint: 'Say how the writing should change…' }),
];

/* the type, as a system: one set of values every slide reads through its own
   arrangement. All five are sentences `readText` answers (refinetalk.js). */

const ALL_ACTIONS = [
  A('write', 'Rewrite the words', null, {
    mode: 'text',
    kids: ALL_WRITE_KIDS,
    /* a grouping node, deliberately: `Rewrite the words.` on its own is not
       an instruction `polish` can place, and a chip whose Submit returns
       silence is worse than one that waits for a direction */
    hint: 'How should the writing change?',
    needs: (c) => (c.written || 0) > 0,
  }),
  /* WHAT USED TO BE HERE: `Change the look`, the direction asked of the whole
     carousel. It is the ⋯ menu's now, and the menu reads the scope the switch
     above the composer has set, so All slides still reaches all of them (Leon,
     Sep 25). */
  /* ── AND `TYPE` IS A DESIGNER'S WORD (Leon, Sep 25) ─────────────────
     "`Change the type` is also confusing — find a better name so it is
     understood by a twelve-year-old."
     It is the trade's word for letterforms, and to everyone else `type` is a
     KIND of thing. The row it sits on makes the confusion worse rather than
     better: `Rewrite the words` beside `Change the type` reads as two
     questions about content, one of which is asking what sort of post this
     is. The pair is really what it SAYS and how it LOOKS, so the chip says
     the second one in those words. */
  A('type', 'Change how the text looks', null, {
    kids: ALL_TYPE_KIDS,
    mode: 'text',
    hint: 'Describe how the type should read…',
  }),
  /* ══ AND THE PICTURES CAN BE ASKED FOR ALL AT ONCE (Leon, Sep 25) ════
     "Add a suggestion about image generation for all slides based on the
     narrative."
     The single-slide row has had it since Sep 24 (`Make something › An
     image`, which reads the slide's job in the story) and the carousel's had
     no way to ask for it six times. It is the same act at the reach this row
     exists for — and it is the reach where reading the NARRATIVE actually
     means something: one slide has a beat, six have an arc, and each one
     gets the picture its own beat calls for rather than six of the same.
     Only where there is an arc to read. */
  /* ── AND `VISUALS` IS A MARKETER'S WORD (Leon, Sep 25) ───────────────
     It covers photographs and drawings, which is why it was reached for, and
     it is not a word anybody says out loud about their own post. `Pictures`
     covers both too — a drawing is a picture to everyone who is not filing
     it — and it is the word the studio would use. The reach is already said
     above the row, so the chip does not repeat it. */
  /* ── AND IT IS THE SAME LEVEL THE SLIDE HAS (Leon, Sep 25) ────────
     "Add `Make something` in the All slides suggestions too, but give the
     option to let Bauhly decide between illustration, image, artwork etc —
     and replace `Add pictures` with it."
     Two rows either side of one switch, asking the same question in two
     vocabularies: the slide said `Make something` and the carousel said `Add
     pictures`, so flicking the scope renamed the thing the studio was in the
     middle of doing. One name, and the reach says the rest — it is written
     above the row already.
     The three answers under it are unchanged, and the first is the one he is
     describing: Bauhly reading each beat and choosing the kind for itself.
     `artwork` is not a fourth answer because in this build it is not a fourth
     THING — `artEvery` lays pieces from the studio's own artwork, which is
     what `Drawings` already is; a row promising a third kind that resolves to
     the second is the dead end this row is written against. */
  A('visuals', 'Make something', null, {
    needs: (c) => (c.slides || 1) > 1,
    hint: 'What should every slide be shown with?',
    kids: [
      /* ── AND THE FIRST ANSWER IS "YOU DECIDE" (Leon, Sep 25) ──────────
         "Let it generate images, illustrations etc to communicate the
         slides, so it can go through artwork, images, or combine them."
         Which is the answer most studios want and the only one the other two
         cannot give: a beat that has to STOP someone wants a photograph, and
         a beat doing the story's work is often clearer drawn. Asking per
         slide is the whole point of asking across the carousel — one slide
         has a beat, six have an arc — so this leads and the other two are
         there for a studio who has already decided. */
      A('auto', 'Let Bauhly decide', 'give every slide the visual its place in the story calls for',
        { hint: 'A photograph where the slide has to stop someone, a drawing where it has to explain. Anything to avoid?' }),
      /* ── AND THE TWO ROWS SAY THE SAME WORDS (Leon, Sep 25) ─────────
         "Make the suggestion button names in All slides consistent with This
         post."
         The slide says `An image` and `An illustration`; this row said
         `Photos` and `Drawings`. Same acts, same level, two vocabularies —
         so flicking the scope renamed what the studio was in the middle of
         choosing, which is the complaint that renamed the parent an hour
         ago. Plural because the reach is plural, and nothing else changes.
         WHAT THIS REVERSES: `Drawings`, not `Illustrations`, written this
         morning on the argument that it is the word a twelve-year-old
         already has. It is — and the slide's own chip says `An
         illustration`, so the choice was never between the two words, only
         between saying one of them twice or both of them once. */
      /* the same pair as the slide's `A photo`, so the two rows go on
         reading alike — see `PHOTO_KINDS` (Leon, Sep 25) */
      A('photos', 'Images', null, {
        hint: 'Should Bauhly make them, or follow a picture you like?',
        kids: [
          A('photoauto', 'Let Bauhly make them', 'generate a picture for every slide from its place in the story',
            { hint: 'An image on every slide, chosen for its place in the story. Anything to avoid?' }),
          A('fromref', 'From an image I like', null, { act: 'reference' }),
        ],
      }),
      /* ── AND THE DRAWINGS ASK THE SAME WAY (Leon, Sep 25) ──────────
         "We are missing for drawings `From an image I like`."
         `Images` grew the pair an hour ago and this stayed a leaf, so one
         chip on the row had a chevron and its neighbour did not — the same
         question with two shapes, which is what the last three renames were
         about. Both are levels now, both with Bauhly's answer first and the
         studio's second.
         `a drawing I like` rather than `an image`: this level is about
         drawings, and the slide's own `A drawing` has said it that way since
         it was written. The two rows say the same words, which is the rule
         he set; what he pointed at is the missing ROW. */
      A('art', 'Drawings', null, {
        hint: 'Should Bauhly draw them, or follow a drawing you like?',
        kids: [
          A('artauto', 'Let Bauhly draw them', 'draw an illustration for every slide from its place in the story',
            { hint: 'A drawing on every slide, made for its place in the story. Anything to include?' }),
          A('gfxref', 'From a drawing I like', null, { act: 'reference' }),
        ],
      }),
      /* ── AND THE STUDIO'S OWN WORK IS AN ANSWER HERE TOO (Leon, Sep 25) ─
         "Suggestion missing artwork."
         The slide's level has `From my artwork` and this one did not, so the
         same question asked of six slides was missing the answer that does
         not invent anything — which, for a studio with a library, is the one
         they reach for first.
         It lands on `artEvery` beside `Illustrations`, and that is not a
         duplicate by accident: `artEvery` lays pieces out of `DEMO_ARTWORK`,
         which IS the library, so in this build `draw me one` and `use one of
         mine` resolve to the same answer. Exactly the case already written
         down for the single slide at `post:add>artwork>artauto` — two
         honest questions, one reader, and the day an illustration model
         exists it is `art` that changes and this that does not. */
      A('artwork', 'From my artwork', 'use the artwork that fits each slide',
        { hint: 'Bauhly reads each slide\u2019s job in the story and picks from your artwork. Anything it should avoid?' }),
    ],
  }),
  /* WHAT USED TO BE HERE: `Improve the story` (Leon, Sep 25). The one action
     in the product about the relationship BETWEEN slides — and the only thing
     this build could actually do for it was `opening`, run over each slide in
     turn to cut it to its point sooner. A chip whose name promises a reading
     of the whole arc and whose act is six independent rewrites is the kind of
     gap this row is written against; it goes until there is a reader that can
     reason about a six-slide arc. */
];

/* ══ WHAT CAN BE DONE TO A PIECE OF ARTWORK (Leon, Sep 24, §58) ══════════
 * "Do not create a permanent artwork toolbar. Use the existing contextual
 * suggestion system." So it is a catalogue like every other kind, and the
 * seven acts §58 lists are these seven rows.
 * None of them is a sentence. Every one is a fact about a picture lying on a
 * slide — how big, how far up the stack, whether it is there at all — and
 * there is no reader in this product that could carry out any of them from
 * words. `act` is the honest shape: the caller owns them, and the resolver's
 * own rule drops a row whose door the caller has not opened.
 * `Move it` is deliberately absent as a row: the piece is dragged, by the
 * same handles every other element on the post is dragged by, because it is a
 * role and roles have handles. A row that said `Move it` and then asked
 * "where" would be a worse answer than the one the studio's thumb already
 * gives.
 */
const ARTWORK_ACTIONS = [
  A('bigger', 'Make it bigger', null, { act: 'art-bigger' }),
  A('smaller', 'Make it smaller', null, { act: 'art-smaller' }),
  A('forward', 'Bring it forward', null, { act: 'art-forward', needs: (c) => (c.artN || 1) > 1 }),
  A('backward', 'Send it backward', null, { act: 'art-backward', needs: (c) => (c.artN || 1) > 1 }),
  A('replace', 'Use different artwork', null, { act: 'art-replace' }),
  A('off', 'Remove it', null, { act: 'art-off' }),
];

/* ══ THE CAPTION ══════════════════════════════════════════════════════════
 *
 * (Leon, Sep 25: "Implement a new Caption Edit experience using the same
 * interaction system already used for editing the post/slides… avoid building
 * a second AI editing system specifically for captions.")
 *
 * WHICH IS WHY THIS IS A CATALOGUE AND NOT A SCREEN. Everything the caption
 * needs from the editing system — the levels, the ranking, the cap of six, the
 * badges, the composer, the placeholder, Submit — already exists and is
 * indifferent to what it is pointed at. `BY_KIND` is the contextual layer the
 * brief's diagram describes, and it has had six subjects in it since Sep 24;
 * the caption is the seventh. Nothing below is new machinery.
 *
 * WHY THE FIRST LEVEL IS GROUPS. The brief lists forty actions in eight
 * groups, and a row shows six. A flat forty would be the static menu it is
 * explicit about not wanting, and ranking forty against each other would make
 * the row's contents change in ways nobody could predict. So the first level
 * is the eight groups plus the one hero action, ranked; the second is the
 * actions themselves, which is the shape `Rewrite the words` and `Change the
 * look` already have.
 *
 * `mode: 'text'` throughout: every one of these is an instruction about WORDS
 * and must reach the words reader, never the arrangement or the direction —
 * the collision `lib/demoactions.js` was written to end.
 */

/* ── AND ONE OF THEM IS THE WHOLE REASON THE STATE EXISTS ────────────────
 * (§5 and §7.) `Match caption to slides` is the answer to `Needs review`, and
 * the brief is firm that it must NOT exist only as an error action: "this
 * keeps the AI editing model predictable instead of making an action
 * mysteriously appear only after an error."
 * So it is an ordinary member of this level that happens to rank first when
 * the caption is out of step — see `CAPTION_WANTS`, where `needsReview` is the
 * only fact in the whole table that moves anything by more than a step.
 */
const CAPTION_MATCH = A('match', 'Match caption to slides', 'match the caption to what the slides now say', {
  mode: 'text',
  hint: 'Anything that should stay exactly as it is?',
});

const CAP_REWRITE = [
  A('capwrite', 'Write it again', 'rewrite the caption', { mode: 'text' }),
  /* a caption already under a paragraph has nothing to give back */
  A('capshort', 'Make it shorter', 'make the caption shorter', { mode: 'text', needs: (x) => (x.len || 0) > 240 }),
  A('capclear', 'Make it clearer', 'make the caption clearer', { mode: 'text' }),
  A('capnat', 'Make it more natural', 'make the caption read more naturally', { mode: 'text' }),
  A('cappro', 'Make it more professional', 'make the caption more professional', { mode: 'text' }),
  A('capsimple', 'Use simpler words', 'simplify the language in the caption', { mode: 'text' }),
];

const CAP_STORY = [
  CAPTION_MATCH,
  A('capflow', 'Improve the flow', 'improve the flow of the caption', { mode: 'text' }),
  A('capopen', 'Strengthen the opening', 'strengthen the caption’s opening', { mode: 'text' }),
  A('capend', 'Strengthen the ending', 'strengthen the caption’s ending', { mode: 'text' }),
  A('caprep', 'Remove repetition', 'remove repetition from the caption', { mode: 'text' }),
];

const CAP_TONE = [
  /* the studio's own voice, which is the one answer in this level that is not
     a direction but a RECALL — the same node the post's rewrite carries, so
     the Brand DNA is learnt once and spent everywhere (see `SOUND_LIKE_ME`) */
  A('capvoice', 'Match my voice', (c) => dnaSentence(c.dna || {}), {
    mode: 'text',
    kids: SOUND_KIDS,
    hint: 'Anything else about how it should sound?',
    asks: true,
  }),
  A('capconv', 'More conversational', 'make the caption more conversational', { mode: 'text' }),
  A('capconf', 'More confident', 'make the caption more confident', { mode: 'text' }),
  A('cappers', 'More personal', 'make the caption more personal', { mode: 'text' }),
  A('capdirect', 'More direct', 'make the caption more direct', { mode: 'text' }),
  A('capteach', 'More educational', 'make the caption more educational', { mode: 'text' }),
];

const CAP_MORE = [
  A('capctx', 'Add more context', 'add more context to the caption', {
    mode: 'text', hint: 'What should the reader know?',
  }),
  A('capwhy', 'Explain the decision', 'explain the decision in the caption', { mode: 'text', hint: 'Which decision?' }),
  A('capmatter', 'Explain why it matters', 'explain why it matters in the caption', { mode: 'text' }),
  A('capeg', 'Add an example', 'add an example to the caption', { mode: 'text', hint: 'Which example?' }),
  A('captake', 'Add a takeaway', 'add a takeaway to the caption', { mode: 'text' }),
];

const CAP_PULL = [
  A('caphook', 'Improve the hook', 'improve the caption’s hook', { mode: 'text' }),
  A('capcta', 'Improve the CTA', 'improve the caption’s call to action', { mode: 'text' }),
  A('capask', 'Add a question', 'add a question to the caption', { mode: 'text' }),
  A('capengage', 'Make it more engaging', 'make the caption more engaging', { mode: 'text' }),
  A('capsave', 'Make it worth saving', 'make the caption worth saving', { mode: 'text' }),
];

const CAP_SHAPE = [
  A('cappara', 'Break into paragraphs', 'break the caption into paragraphs', { mode: 'text' }),
  A('capscan', 'Make it easier to scan', 'make the caption easier to scan', { mode: 'text' }),
  A('capshortp', 'Shorten the paragraphs', 'shorten the caption’s paragraphs', { mode: 'text' }),
  A('capkey', 'Move the key point up', 'move the caption’s key point up', { mode: 'text' }),
];

const CAP_TIDY = [
  A('capgram', 'Fix the grammar', 'fix the grammar in the caption', { mode: 'text' }),
  A('caprep2', 'Remove repetition', 'remove repetition from the caption', { mode: 'text' }),
  A('capfill', 'Remove filler', 'remove filler from the caption', { mode: 'text' }),
  A('capnames', 'Fix names and details', 'fix the names and details in the caption', { mode: 'text' }),
];

/* ── AND THE GROUP THAT IS ABOUT THE OTHER HALF OF THE POST ──────────────
   §3: "Slides + Caption = one post narrative." These four are the only
   actions in the catalogue that read something OTHER than what is selected —
   they are all about the relationship between the two halves, which is why
   they are a group of their own rather than four more rewrites. */
const CAP_CHECK = [
  CAPTION_MATCH,
  A('capreview', 'Review it against the slides', 'check the caption against the slides', { mode: 'text' }),
  A('capfix', 'Fix what does not agree', 'fix what the caption and the slides disagree about', { mode: 'text' }),
  A('capdetail', 'Match the names and details', 'match the caption’s names and details to the slides', { mode: 'text' }),
];

const CAPTION_ACTIONS = [
  CAPTION_MATCH,
  A('caprewrite', 'Rewrite it', null, { kids: CAP_REWRITE, hint: 'Anything to keep?' }),
  A('capstory', 'The story it tells', null, { kids: CAP_STORY, hint: 'Anything to add about the story?' }),
  A('captone', 'How it sounds', null, { kids: CAP_TONE, hint: 'Anything to add about the tone?' }),
  A('capsay', 'Say more', null, { kids: CAP_MORE, hint: 'What should it say more about?' }),
  A('capland', 'Make it land', null, { kids: CAP_PULL, hint: 'Anything to add?' }),
  A('capshape', 'How it is laid out', null, { kids: CAP_SHAPE, hint: 'Anything to add about the shape?' }),
  A('captidy', 'Tidy it up', null, { kids: CAP_TIDY, hint: 'Anything to watch for?' }),
  A('capcheck', 'Check it against the slides', null, { kids: CAP_CHECK, hint: 'Anything that should stay?' }),
];

/* ── AND ONE FACT DECIDES THIS ROW (Leon, Sep 25, §5 and §7) ─────────────
 * "When `captionNeedsReview = true`… make the first/prominent contextual
 * suggestion `Match caption to slides`. This should be much easier to
 * discover than the normal caption suggestions."
 * And, in the same breath, §7: it stays available at ordinary priority when
 * there is nothing wrong. So this is one table with one number in it that
 * moves, which is the whole of the feature's ranking:
 *   nothing wrong   `match` sits mid-row, where an action you might want is
 *   needs review    `match` leads by a margin nothing else can close
 * The rest is a resting order — rewriting and the story are what a studio
 * opens a caption to do, tidying is what they do last.
 */
const CAPTION_WANTS = {
  caprewrite: 4,
  capstory: 3,
  captone: 3,
  /* saying more is worth more on a caption that says little — the same
     length rule `scoreOf` keeps for a selected line */
  capsay: 2,
  capland: 2,
  capshape: 1,
  captidy: 1,
  capcheck: 1,
  match: 2,
};

/* ══ WHAT LEFT THIS ROW FOR THE ⋯ MENU (Leon, Sep 25) ════════════════════
 *
 * "Remove all suggestion buttons, levels and sublevels related to Layouts,
 * Colours, Themes, Background and Logo. Move these actions into the existing
 * top More button dropdown menu."
 *
 * Five subjects, and what they have in common is the reason they go: every
 * one of them is answered by LOOKING at something. Arrangements are a grid of
 * wires, directions a grid of cards, colour sets a list of swatches,
 * backgrounds a grid of textures, and a logo is a corner of the slide. A
 * suggestion row is a sentence being composed — it holds intents, and its
 * Submit is the act — so each of these chips was a door rather than an
 * answer: press it and a menu opened over the post anyway. The ⋯ is where
 * that menu lives, so that is where the door belongs, and the row keeps only
 * what it can actually finish in words.
 *
 * WHAT WENT, in full, so nothing is looked for here again:
 *   POST_ACTIONS   `look` (LOOK_KIDS: the library, the six style words, the
 *                  colour sets and their two siblings, a reference picture)
 *                  and `layout` (LAYOUT_KIDS: the grid and six described
 *                  arrangements).
 *   ALL_ACTIONS    `look`, the same node at carousel reach.
 *   ADD_KIDS       `ground` (GROUND_KIDS) and `logo` (LOGO_KIDS).
 *   MARK_ACTIONS   all three — a selected logo's row is empty now, and its
 *                  corner and size are on its own floating bar where they
 *                  always were.
 * Their ranking entries went with them (`ROLE_WANTS`, and the two `scoreOf`
 * lines that made a post with no direction ask for one).
 *
 * NOTHING ABOUT WHAT THEY DO CHANGED. Every level they opened is drawn by
 * `EditorMore` exactly as it was, and the rows that had no menu of their own
 * — the six style words, `Upload a background`, `From this post's story`,
 * the four logo rows, `Create a colour set`, `Let the story decide` — are
 * levels of that menu now. See PostMenu.jsx.
 */

const BY_KIND = {
  text: TEXT_ACTIONS,
  place: PLACE_ACTIONS,
  picture: PICTURE_ACTIONS,
  post: POST_ACTIONS,
  all: ALL_ACTIONS,
  artwork: ARTWORK_ACTIONS,
  mark: MARK_ACTIONS,
  /* the seventh subject, and the first that is not part of the picture — see
     `CAPTION_ACTIONS` (Leon, Sep 25) */
  caption: CAPTION_ACTIONS,
};

/* ══ RANKING ══════════════════════════════════════════════════════════════
 *
 * What the brief asks for in one line: "do not show everything upfront." So
 * each node is scored against the context and the best few are drawn. The
 * numbers are small and the rules are few on purpose — this is an order of
 * preference, not a model, and it has to stay legible to whoever reads it
 * next.
 */

/* what each slide role wants first, in the language of the catalogue above.
   Straight from the brief's own priorities, mapped onto the roles this
   product actually has (lib/narrative.js). */
const ROLE_WANTS = {
  /* `look` and `layout` are gone from every row of this table with the
     actions they weighted (Leon, Sep 25) */
  hook: { rewrite: 3, shorter: 2, simplify: 1, add: 2 },
  context: { detail: 2, simplify: 2, add: 1 },
  struggle: { rewrite: 2, detail: 2, add: 1 },
  shift: { detail: 3, simplify: 2, rewrite: 1, add: 1 },
  evidence: { detail: 2, project: 2, add: 2 },
  framework: { simplify: 2, detail: 2, shorter: 1 },
  takeaway: { shorter: 2, rewrite: 1 },
  cta: { tone: 3, rewrite: 2, shorter: 1, add: 1 },
};

/* and what each refinement wants, once its parent is armed: the same table,
   one level down, so a hook's rewrite leads with impact and a CTA's with
   voice. It is read at EVERY depth below the first, which is what keeps a
   third level from arriving in catalogue order. */
const ROLE_KID_WANTS = {
  hook: { impact: 3, curious: 2, concise: 1, title: 2 },
  context: { explan: 2, simpler: 2, context: 2, concise: 1, subtitle: 2 },
  struggle: { explan: 2, natural: 1 },
  shift: { explan: 3, why: 3, simpler: 2, context: 1 },
  evidence: { why: 1, concise: 1, support: 2 },
  framework: { simpler: 2, concise: 2, support: 1 },
  takeaway: { impact: 2, concise: 2 },
  cta: { natural: 3, conv: 2, warm: 1, concise: 1, cta: 3 },
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
    /* ── AND THE ONE THAT GETS MORE USEFUL THE LESS IT KNOWS (Leon,
       Sep 24) ──────────────────────────────────────────────────────────
       `Sound like me` is the only action here whose value runs the OTHER
       way to the rest: `Make it shorter` is worth offering on a long line
       and useless on a short one, and this is worth most on the first post
       a studio ever edits, when Bauhly knows nothing about how they write.
       So it leads the row while there are questions left and settles into
       an ordinary action once there are none — at which point it is still
       worth keeping, because it is then the one press that applies
       everything the studio has said about themselves (§7).
       Without a number of its own it sat sixth of six in a row that shows
       four, which is a Level 1 action nobody could reach. */
    if (a.id === 'soundlike') n += askAreas(c.dna || {}).length ? 3 : 1;
  }
  if (c.kind === 'post') {
    /* the brief's own example: a slide with nothing on it but type asks for
       something to look at before it asks for more decoration */
    if (a.id === 'add') n += c.hasArt ? 0 : 2;
    if (a.id === 'improve') n += c.heavy ? 2 : 0;
    /* WHAT USED TO BE HERE: the two lines that ranked `look` and `layout` —
       a post with no direction asking for one (the brief's step 11), and an
       arrangement being worth offering where there is something to arrange.
       Both actions are the ⋯ menu's now and a menu does not rank (Leon,
       Sep 25). */
  }
  /* ── AND THE CAROUSEL RANKS ON CAROUSEL FACTS (Leon, Sep 24, §9) ──────
     "Consider the current carousel, the narrative, the Brand DNA, existing
     inconsistencies… show around 3–5 useful actions."
     Not the slide's role, which is the whole of what ranks the row one level
     out: a role belongs to one slide and this row is about all of them, so
     reading it here would sort the carousel's actions by whichever slide the
     studio happened to be standing on. What is left are facts about the SET
     — how much of it is written, whether it has a direction — and they are
     the same four numbers the post-level row is scored with, asked of six
     slides instead of one. */
  if (c.kind === 'all') {
    /* the story leads while it is offered at all: it is the only action in
       the product that is about the relationship between slides, and it has
       already earned its place by passing `needs` */
    if (a.id === 'story') n += 3;
    /* a carousel with words in it asks to be read again before it asks to be
       re-typeset — and the more of it is written, the truer that is */
    if (a.id === 'write') n += (c.written || 0) > 1 ? 2 : 1;
    if (a.id === 'type') n += (c.written || 0) > 1 ? 1 : 0;
  }
  /* ── AND ONE ACTION ANSWERS A STATE (Leon, Sep 25, §5) ────────────────
     "Make the first/prominent contextual suggestion `Match caption to
     slides`. This should be much easier to discover than the normal caption
     suggestions."
     Eight, which is more than any other number in this file and deliberately
     so: it has to clear `Rewrite it` at four with room nobody could mistake
     for a tie. With nothing out of step it scores its resting two and sits
     mid-row, which is §7 — the action does not appear out of an error, it
     moves to the front of a row it was already in. */
  if (c.kind === 'caption' && a.id === 'match') n += c.needsReview ? 8 : 0;
  if (c.kind === 'caption') {
    /* the same two length rules a selected line is scored by, asked of the
       caption: a long one asks to be cut, a short one asks for more */
    if (a.id === 'caprewrite') n += (c.len || 0) > 600 ? 1 : 0;
    if (a.id === 'capsay') n += (c.len || 0) < 240 ? 2 : 0;
    if (a.id === 'capshape') n += (c.len || 0) > 600 ? 1 : 0;
  }
  return n;
};

const liveKids = (a, c) => (a?.kids || []).filter((k) => allowed(k, c));

function allowed(a, c) {
  if (a.needs && !a.needs(c)) return false;
  /* a door nobody can open is not offered — the caller says which acts it
     has, and an action whose only outcome is a missing flow is dropped
     rather than drawn dead (the brief's step 10: no dead ends) */
  if (a.act && c.acts && !c.acts.includes(a.act)) return false;
  /* ── AND NEITHER IS A LEVEL WITH NOTHING LEFT IN IT ─────────────────────
     A grouping node earns its place by what it opens. `Add → A graphic` is
     the case this was written for: its one row is the studio's logo, and on a
     post whose logo is already on the slide there is nothing under it. Drawn,
     it would be a chip that opens an empty row — the dead end the brief is
     most explicit about. */
  if (a.kids && !sayOf(a, c) && !liveKids(a, c).length) return false;
  return true;
}

/* ── WALKING THE PATH ─────────────────────────────────────────────────────
 * The state the caller holds is a list of ids — `['add', 'text']` — and
 * everything below reads it the same way: step down one level per id,
 * stopping the moment an id names nothing, so a stale path from a previous
 * selection can never resolve to a node that is not on screen.
 */
export function trailOf(kind, path) {
  const out = [];
  let list = BY_KIND[kind] || [];
  (path || []).forEach((id) => {
    const node = list.find((a) => a.id === id);
    if (!node) { list = []; return; }
    out.push(node);
    list = node.kids || [];
  });
  return out;
}

export const nodeAt = (kind, path) => {
  const trail = trailOf(kind, path);
  return trail.length ? trail[trail.length - 1] : null;
};

/* ── AND THE END OF THE ROAD IS A NODE WITH NOTHING UNDER IT ──────────────
 * The one question the row, the badge and Submit all turn on. It is not a
 * depth: `Make it shorter` is the end at level two and `A subtitle` is the
 * end at level three, and what they have in common is that there is nothing
 * left to choose.
 */
export function endOf(ctx) {
  const c = ctx || {};
  const trail = trailOf(c.kind, c.path);
  if (!trail.length || trail.length !== (c.path || []).length) return null;
  const last = trail[trail.length - 1];
  return liveKids(last, c).length ? null : last;
}

/* ── AND THE ROW IS WHATEVER LEVEL THE STUDIO IS ON ───────────────────────
 * Nothing armed: the actions for what is selected. Something armed: its
 * children.
 *
 * ── AND AT THE END IT IS THE LEVEL THEY CHOSE FROM (Leon, Sep 24) ────────
 * "We always have to see the suggestion flow; when it gets to the end,
 * disable it or turn the suggestion into selected, so it doesn't hide from
 * the view."
 * WHAT THIS REPLACES: returning nothing, on the reading that a complete
 * instruction has nothing left to offer and the row should make way for the
 * field. What that actually drew was a band of white with one back button in
 * it, and the studio's last three presses gone from the screen — no way to
 * see what the alternatives were without walking back to find out.
 * So the row keeps the level the choice was made ON, with the chosen one
 * marked (the caller lights it; see `askPress`, where pressing a sibling
 * swaps rather than descends). The flow stays on screen, the choice is
 * visible as a choice, and changing your mind is one press instead of three.
 */
export function actionsFor(ctx) {
  const c = ctx || {};
  const path = c.path || [];
  const trail = trailOf(c.kind, path);
  /* a path that no longer resolves offers the top level again rather than
     nothing: the subject changed under it, and a live badge over an empty row
     is the one state this cannot be in */
  const deep = trail.length === path.length;
  let here = deep && trail.length ? trail[trail.length - 1] : null;
  /* at the end, step back up one and list what the studio was choosing from */
  if (here && !liveKids(here, c).length) here = trail.length > 1 ? trail[trail.length - 2] : null;
  const list = here ? liveKids(here, c) : (BY_KIND[c.kind] || []).filter((a) => allowed(a, c));
  const top = !here;
  /* the carousel is not scored by the standing slide's job in the story —
     see `scoreOf`, where its own four facts are. An empty table here means
     the levels under it keep catalogue order, which is the order §3 wrote
     them in. */
  /* ── AND A LEVEL MAY BRING ITS OWN TABLE (Leon, Sep 25) ─────────────
     `ROLE_KID_WANTS` is read at every depth below the first, which makes it
     one namespace shared by every refinement row in the product. That was
     fine while the ids in it were unique by accident; it stops being fine
     the moment a level has sixteen children of its own to order. A node that
     carries `wants` is ranked by ITS table, keyed the same way — by the
     slide's job in the story — and nothing it holds can reach another row.
     See `ROLE_WORDS` on the `Words` node. */
  /* the caption has no role in the story's arc — it is the post's own words,
     not a slide's — so its first level is ranked by its own table and the
     levels under it keep catalogue order (Leon, Sep 25) */
  const wants = c.kind === 'caption' ? (top ? CAPTION_WANTS : {})
    : (c.kind === 'all' && !here?.wants ? {}
      : (here?.wants ? (here.wants[c.role] || {})
        : ((top ? ROLE_WANTS : ROLE_KID_WANTS)[c.role] || {})));
  return list
    .map((a, i) => ({ a, n: (top ? scoreOf(a, c, wants) : (wants[a.id] || 0)) * 10 - i }))
    .sort((x, y) => y.n - x.n)
    /* ══ WHAT A TOP LEVEL SHOWS, AND WHY IT IS SIX (Leon, Sep 25) ══════
       §9 asks for "around 3-5 useful actions rather than every possible
       global action", and the caps written for it were 5 on the two post
       rows and 4 on an element's. Audited, and on two of the seven
       catalogues the number was not trimming a long list — it was hiding a
       short one:
         `text`     six actions, four drawn. `Say more about it` and
                    `Change how it sounds` — which is where a selected line's
                    professional/conversational answers live — were in the
                    catalogue and reachable from nowhere.
         `artwork`  six actions. Four are live with one piece on the slide
                    and all six once there are two to order, so the cap bit
                    exactly when the level had most to say: `Use different
                    artwork` and `Take it off` dropped off the moment a
                    second piece arrived.
         `post`     gained `Change the type` and it ranked out on every role.
       A cap exists to stop a row listing everything. None of these lists IS
       everything — the longest is six, every one of them is a door that
       opens, and the rail scrolls. So the number is six, once, for every
       level rather than three different numbers none of which was doing the
       job it was written for. `picture`, `place` and `mark` hold four, four
       and three, so nothing about them changes.
       Ranking is untouched: it still decides the ORDER, and what falls to
       the end of a six-long row is what scored lowest.
       ── AND THE LEVELS UNDER IT TAKE THE SAME NUMBER (Leon, Sep 25) ───
       They were five while the top was four or five, which was arbitrary
       then and is a hiding place now: merging `Move things around` into
       `Change the layout` gives that level seven children, of which six are
       live on a slide with no picture. One number for every row in this
       Editor, so a level's length is a fact about the level and not about
       which of three branches it happened to be read through. */
    .slice(0, 6)
    /* ── AND EACH ONE SAYS WHETHER IT OPENS ANOTHER LEVEL (Leon, Sep 24) ──
       "Add arrows for those suggestions that have sublevels."
       Which is a fact only this file can answer: whether a node has children
       depends on the same context that decided the row — `Add something` has
       three on one slide and two on another, and a `Graphic` with nothing in
       it has none at all. So it is answered here and carried on the node, and
       the caller draws a caret where it finds one rather than re-deriving a
       question it cannot see the inputs to. */
    /* ── AND AN ANSWER ALREADY GIVEN SAYS SO (Leon, Sep 24) ──────────────
       The `Sound like me` options are the one place the row shows a choice the
       studio made on a DIFFERENT post — `Warm` is not "do this now", it is
       "this is what you told me". Resolved here beside `deeper` for the same
       reason: it depends on the context that decided the row, and the caller
       cannot see those inputs. */
    .map((x) => {
      const a = liveKids(x.a, c).length ? { ...x.a, deeper: true } : x.a;
      return typeof a.chosen === 'function' ? { ...a, chosen: a.chosen(c) } : a;
    });
}

/* ── WHAT THE FIELD ASKS FOR, AT WHATEVER LEVEL IT IS ─────────────────────
 * "Suggestion chips answer what Bauhly can do. Placeholder text answers what
 * the user can optionally tell Bauhly." So it is a question about the ADDED
 * information, never a description of the action the badges already name.
 * The deepest node that has one wins, so `Add → Text` keeps asking what it
 * should say once `A subtitle` is chosen under it.
 */
export function askHint(ctx, fallback) {
  const c = ctx || {};
  const trail = trailOf(c.kind, c.path);
  if (!trail.length) return fallback;
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    /* a hint may be a FUNCTION of the context, for the same reason `say` may
       be (see `sayOf`): the beat's own ask differs slide to slide and a
       static string could only ever be one of the eight */
    const h = trail[i].hint;
    if (typeof h === 'function') { const said = h(c); if (said) return said; }
    else if (h) return h;
  }
  /* ── AND A HINT THAT NAMES NOTHING NAMES THE CHOICE (Leon, Sep 24) ────
     "This button is unclear for me — rather than `Add anything Bauhly should
     consider`, add context about the selected button so it is more obvious."
     Right: the generic line is the one place in this whole chain where the
     screen stops saying what is about to happen. The badge says it, the
     trail says it, and the field — the thing with the caret in it — asked a
     question that could have been asked about anything.
     So the deepest thing the studio chose is quoted back into it. Written
     from the LABEL rather than from a second string per node, because the
     label is what they pressed and what the badge beside the caret is
     showing; a hint that paraphrased it would be a third wording of one
     idea. */
  const last = trail[trail.length - 1];
  return last?.label
    ? `Anything to add about “${last.label}”?`
    : 'Add anything Bauhly should consider…';
}

/* which reader the finished sentence is handed to first. The deepest node
   that states one wins, and nothing stating one means the words — which is
   what every sentence in this Editor was read as before the row could ask
   for an arrangement or a direction. */
export function askMode(ctx, fallback = null) {
  const trail = trailOf(ctx?.kind, ctx?.path);
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    if (trail[i].mode) return trail[i].mode;
  }
  return fallback;
}

/* ── AND SUBMIT IS ONE SENTENCE, MADE OF WHAT IS ON SCREEN ────────────────
 * The badges are the instruction and the typed line is the addition to it, so
 * a studio who chose `Add → Text → A subtitle` and typed nothing has said
 * something complete: "Add a subtitle." What they type is appended rather
 * than merged, because it is theirs and the product does not get to rephrase
 * it.
 * Everything else the operation needs — which element, which slide, what the
 * post is about, the direction, the arrangement, the kit — is already carried
 * by the path this sentence travels (`onAskPart` and `onAsk` both take the
 * selection with them), which is why none of it is written into the words.
 */
export function askSay(ctx, typed = '') {
  const trail = trailOf(ctx?.kind, ctx?.path);
  let said = '';
  trail.forEach((node) => {
    const words = sayOf(node, ctx);
    if (!words) return;
    said = said ? `${said}${node.sep || ', '}${words}` : words;
  });
  const mine = (typed || '').trim();
  if (!said) return mine;
  const line = said.charAt(0).toUpperCase() + said.slice(1);
  return mine ? `${line}. ${mine}` : `${line}.`;
}

/* ── WHETHER THERE IS ENOUGH ON SCREEN TO SEND ────────────────────────────
 * "The user can submit at any level where the operation is sufficiently
 * defined. Typing is optional." Two things make it insufficient, and neither
 * is depth:
 *   a grouping node has no words at all — `Change the look` says which area,
 *   not which change;
 *   and a `part` node has half of them — `Add` waits on what to add, and its
 *   children finish the phrase rather than qualifying it.
 * Everything else stands alone: `Improve this slide` is a whole instruction
 * with three refinements available and none of them required, which is the
 * brief's own case for submitting mid-path (Leon, Sep 24).
 */
export const askReady = (ctx, typed = '') => {
  if ((typed || '').trim()) return true;
  const trail = trailOf(ctx?.kind, ctx?.path);
  const said = [...trail].reverse().find((n) => sayOf(n, ctx));
  if (!said) return false;
  /* `said` is by construction the DEEPEST node that contributed words, so a
     fragment being the one that spoke last means nothing has completed it —
     whatever levels sit under it were headings and added none. (Written first
     as "is it the last node in the trail", which read as complete at `Add ›
     Words`: `Words` is a heading, the sentence was still `Add.`) */
  if (said.part) return false;
  /* ── AND A NODE THAT IS STILL ASKING IS NOT DONE (Leon, Sep 25) ──────
     The third thing that makes an instruction insufficient, and it is not
     depth either: `Sound like me` speaks whatever it has learnt so far and
     its children are the questions it has not. While any of them is still
     live the studio is mid-interview, and the sentence in the field is a
     summary of what Bauhly knows rather than what they have just asked for.
     `asks` marks the one node this is true of; when its last question is
     answered it has no live children and this stops applying, which is the
     one-press case for an established studio. */
  if (said.asks && liveKids(said, ctx).length) return false;
  return true;
};
