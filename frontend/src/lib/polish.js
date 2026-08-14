/*
 * Polishing a caption — a narrow tool, not a chat box.
 *
 * The field under the caption takes instructions about THIS caption: make it
 * shorter, warm it up, take the exclamation marks out, pull the hashtags. It
 * is deliberately not an assistant. Anything that isn't an edit to the text in
 * front of it — "how do I get more followers", "write me a blog post", "what
 * should I post next week" — is declined and pointed somewhere that can answer
 * it, because a box that answers everything is a box nobody can predict, and
 * the one thing a caption editor must never do is quietly rewrite the meaning
 * of a sentence a studio is about to publish under its own name.
 *
 * Every transform here is deterministic and reversible ("Undo edits" restores
 * Bauhly's original). They edit STRUCTURE and REGISTER — length, punctuation,
 * contractions, emoji, tags, the opening — and never invent a claim, a number,
 * or a fact about the studio's work. That limit is the point: in the demo
 * there is no model behind this field, and a rewrite that made things up would
 * be indistinguishable from one that lied.
 */

/* the variation selector is matched on its own rather than inside the class —
 * inside it, it reads as a combining sequence and the linter is right to
 * complain about what that silently matches */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\u{FE0F}?|\u{FE0F}/gu;

/* CASE WAS LOSING HALF THE MATCHES (Leon, Aug 4). The pairs below are written
   lower case and were applied literally, so a line beginning "It is just…" —
   which is most slide headlines, since they start with a capital — matched
   nothing and "More human" reported there was nothing to loosen. Applied
   case-insensitively now, with the first letter put back the way it was
   found. */
const swap = (text, pairs) => pairs.reduce((out, [re, to]) => out.replace(
  new RegExp(re.source, `${re.flags.replace(/i/g, '')}i`),
  (m) => (m[0] === m[0].toUpperCase() ? to.charAt(0).toUpperCase() + to.slice(1) : to),
), text);

const CONTRACTIONS = [
  [/\bdo not\b/gi, "don't"],
  [/\bit is\b/g, "it's"],
  [/\bthat is\b/g, "that's"],
  [/\bcannot\b/gi, "can't"],
  [/\byou are\b/g, "you're"],
  [/\bwe are\b/g, "we're"],
  [/\bwe will\b/g, "we'll"],
  [/\bthere is\b/g, "there's"],
];
const EXPANSIONS = [
  [/\bdon't\b/gi, 'do not'],
  [/\bcan't\b/gi, 'cannot'],
  [/\bit's\b/g, 'it is'],
  [/\bthat's\b/g, 'that is'],
  [/\bwe'll\b/g, 'we will'],
  [/\bwon't\b/gi, 'will not'],
];

/* ── ONE LINE IS NOT A CAPTION (Leon, Aug 4) ──────────────────────────────
 *
 * Every intent below was written for a caption: paragraphs to drop, sentences
 * to keep, contractions to loosen. The words ON a slide are one short line, and
 * against those the tools had nothing to do — so the "Make it" chips on the
 * Content tab pressed and nothing happened, every time.
 *
 * These are the operations that are real on a headline, and they are all
 * SUBTRACTION. Nothing here writes a word the studio did not: a tool with no
 * model behind it that invents a new line would be putting words in their
 * mouth, which is the one thing this box has never done.
 */
const ONE_LINE = (t) => !/\n/.test(String(t).trim()) && String(t).trim().length <= 120;

/* the words a line is never worse without */
const FILLER = /\b(very|really|just|quite|actually|simply|truly|honestly|literally|basically|pretty much|kind of|sort of)\s+/gi;
/* the run-ups people put in front of the point */
const HEDGE = /^(here(?:'s| is) (?:why|how|what)|let(?:'s| us) talk about|a (?:quick )?(?:note|word) (?:on|about)|when it comes to|one thing about|the truth (?:is )?about)\s+/i;

const trimLine = (t) => t.replace(/\s{2,}/g, ' ').trim();

const paras = (t) => t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
const join = (list) => list.join('\n\n');
/* split on sentence ends, keeping the punctuation */
const sentences = (p) => p.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) || [p];

const tagsIn = (t) => t.match(/#[\wÀ-ɏ]+/g) || [];
const stripTags = (t) =>
  t
    .replace(/#[\wÀ-ɏ]+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();

/* ── the intents, in the order they're matched ─────────────────────────────
 * `test` is deliberately keyword-based rather than clever: a field that guesses
 * is a field that surprises, and the chips below it teach the vocabulary. */
const INTENTS = [
  /* ── THE STRATEGY IS THE CONTEXT, AND IT IS A REAL THING ───────────────
   * (Leon, Aug 9 — decision 835)
   *
   * "Align this with the strategy", "adapt it to the pillar", "make it stronger
   * for Discovery" all mean one thing this product can actually answer: Bauhly
   * already wrote a line for this slide, from this week's focus and this post's
   * pillar, and it is `overlays[slide]` / `post.caption`. Asking for the
   * strategy version is asking for THAT — so this restores it rather than
   * inventing a new one.
   *
   * `opts.strategy` is passed explicitly instead of being guessed at from
   * `extras[0]`: the first extra is only Bauhly's line when there IS one, and
   * on a post it has not written the first extra is a neighbouring slide.
   * Handing back a different slide's words as "the strategy version" would be
   * the exact kind of quiet invention this file exists to avoid. */
  {
    id: 'strategy',
    test: /\b(strateg\w*|pillar|objective|discovery|trust|authority|align\w*|adapt\w*|on.?brand|this week)\b/i,
    run: (text, extras = [], opts = {}) => {
      const line = String(opts.strategy || '').trim();
      if (!line) {
        return {
          text,
          noop: 'Bauhly has not written a version of this one, so there is nothing of its own to go back to. Tell me what to change and I will shape what is here.',
        };
      }
      if (line === String(text || '').trim()) {
        return { text, noop: 'This is already Bauhly\'s own line for this slide — written from the week\'s focus and this post\'s pillar.' };
      }
      return {
        text: line,
        note: 'Back to Bauhly\'s own line for this, written from the week\'s focus and this post\'s pillar.',
      };
    },
  },
  /* ── the one intent that ADDS ──────────────────────────────────────────
   * Everything else here edits what is in front of it. A studio asking for "one
   * more line" is a fair ask (Leon, July 30), and refusing it was the box being
   * narrow for its own sake — so this one exists, and it adds real text: a line
   * from the post's own caption that isn't already used. If there is nothing
   * left to draw on it says so rather than writing something. */
  {
    id: 'add',
    /* ── AND IT IS ALSO HOW AN EMPTY LAYOUT GETS FILLED (835) ──────────
     * A slide with nothing on it has one obvious ask — "generate text", "fill
     * this layout", "write the headline" — and the vocabulary did not know any
     * of those words, so the fastest way into an empty composition answered
     * with a refusal. They are the same intent as "add a line": take the next
     * thing this post actually says and put it there. Same rule as ever — the
     * text comes from the post, nothing is written from nothing. */
    test: /\b(add|more text|another line|one more|longer|extend|expand|fill|fill in|generate|create|write|populate|copy|words|text|headline|caption for this)\b/i,
    run: (text, extras = []) => {
      const have = String(text || '').toLowerCase();
      const next = extras.find((line) => line && !have.includes(line.toLowerCase()));
      if (!next) {
        return {
          text,
          noop: 'Nothing left to pull from this post — write the line and I\'ll shape it with you.',
        };
      }
      const joined = String(text || '').trim();
      return {
        text: joined ? `${joined}\n\n${next}` : next,
        note: 'Added a line from this post\'s own caption — nothing invented.',
      };
    },
  },
  {
    id: 'shorter',
    test: /\b(shorter|shorten|trim|cut|tighten|condense|brief|less text|too long)\b/i,
    /* the opening and the ask are what a caption is for; the middle is where
     * it gets long. Keep both ends, drop the explanation between them. */
    run: (text) => {
      /* a headline: there are no paragraphs to drop and no second sentence to
         cut, so shortening it means taking out what it does not need — the
         filler, the run-up, and the clause hanging off the end */
      if (ONE_LINE(text)) {
        let out = trimLine(String(text).replace(FILLER, '').replace(HEDGE, ''));
        /* a trailing clause after a dash or a comma is the explanation; the
           headline is what comes before it */
        const cut = out.match(/^(.{10,}?)\s*[—–,-]\s+\S.*$/);
        /* two words is a headline ("Negative space"); one is a fragment */
        if (cut && cut[1].split(/\s+/).length >= 2) out = cut[1];
        out = trimLine(out).replace(/[,;:]$/, '');
        /* a line that lost its run-up starts with whatever followed it — and
           that word has to be capitalised, or the fix reads like a typo */
        out = out.charAt(0).toUpperCase() + out.slice(1);
        return {
          text: out,
          note: 'Took out what the line did not need. The words are still yours.',
          noop: 'Already as tight as it goes — there is no filler and no trailing clause to cut.',
        };
      }
      const tags = tagsIn(text);
      const body = paras(stripTags(text));
      let out;
      if (body.length > 2) out = [body[0], body[body.length - 1]];
      else out = body.map((p) => sentences(p).slice(0, 2).join(' '));
      const kept = join(out);
      return {
        text: tags.length ? `${kept}\n\n${tags.join(' ')}` : kept,
        note: body.length > 2
          ? `Kept the opening and the ask, dropped ${body.length - 2} paragraph${body.length - 2 > 1 ? 's' : ''} in between.`
          : 'Kept the first two sentences of each paragraph.',
      };
    },
  },
  {
    id: 'professional',
    test: /\b(professional|formal|serious|business|corporate|restrained|drier|less casual)\b/i,
    run: (text) => {
      let out = swap(text.replace(EMOJI, '').replace(/!+/g, '.'), EXPANSIONS);
      out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
      return {
        text: out.trim(),
        note: 'Emoji and exclamation marks out, contractions spelled out.',
        noop: 'Already formal — no emoji, no exclamation marks, nothing to spell out.',
      };
    },
  },
  {
    id: 'playful',
    test: /\b(playful|warmer|warm|friendly|lighter|casual|human|relaxed|less stiff)\b/i,
    run: (text) => {
      let out = swap(text, CONTRACTIONS);
      return {
        text: out.trim(),
        note: 'Loosened the phrasing — contractions back in. The words are still yours; I don\'t invent jokes.',
        /* the `noop` line went (Leon, Aug 9 — 669). The general one below it in
           `polish.js` says the same thing in fewer words, and this one was long
           enough to wrap into a second line under the asks. */
      };
    },
  },
  {
    id: 'opening',
    test: /\b(opening|first line|hook|start|lead|beginning|stronger open)\b/i,
    /* the first line is the only one most people read, so sharpening it means
     * removing everything hedging in front of the point */
    run: (text) => {
      const body = paras(text);
      if (!body.length) return { text, note: null };
      const first = sentences(body[0]);
      if (first.length < 2) return { text, note: 'The opening is already one line — nothing to cut in front of it.' };
      const rest = first.slice(1).join(' ');
      const next = [rest, ...body.slice(1)].filter(Boolean);
      return {
        text: join([first[0], ...next]),
        note: 'Opening is one line now; the rest moved down a paragraph.',
      };
    },
  },
  /* ── PLAIN, WITHOUT BEING SHORTER (Leon, Aug 9 — 835) ─────────────────
   * "Simplify the wording" and "keep the meaning but improve readability" both
   * asked for something the box could not name, so they fell out of scope —
   * and `shorter` is the wrong answer to them: that one DROPS material, and
   * these two explicitly ask to keep it. What they mean is the run-up and the
   * padding: "we really just wanted to…" → "we wanted to…". Every paragraph,
   * every sentence kept. */
  {
    id: 'simplify',
    test: /\b(simplify|simpler|simple|plain|plainer|readab\w*|clearer|clarity|easier to read|straightforward|less wordy|wordy)\b/i,
    run: (text) => {
      const out = paras(text)
        .map((p) => trimLine(p.replace(FILLER, '').replace(HEDGE, '')))
        .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
        .filter(Boolean);
      return {
        text: join(out),
        note: 'Took the filler and the run-up out. Every sentence is still there.',
        noop: 'Already plain — no filler and nothing hedging in front of the point.',
      };
    },
  },
  {
    id: 'notags',
    test: /\b(hashtags?|tags)\b/i,
    run: (text) => {
      if (!tagsIn(text).length) return { text, note: 'There are no hashtags in this caption.' };
      return { text: stripTags(text), note: 'Hashtags removed. The panel below puts them back one at a time.' };
    },
  },
  {
    id: 'emoji',
    test: /\bemoji|emojis|smiley|icons?\b/i,
    run: (text) => {
      const had = text.match(EMOJI);
      if (!had) return { text, note: 'No emoji in this caption.' };
      return { text: text.replace(EMOJI, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '').trim(), note: 'Emoji removed.' };
    },
  },
];

/* what the field can do, said in the user's own words — shown as chips and
 * repeated when something out of scope is asked */
export const POLISH_TIPS = [
  { id: 'add', label: 'Fill this out with more detail', note: 'Give it one more beat' },
  { id: 'shorter', label: 'Tighten it — shorter, punchier', note: 'Make it punchier' },
  { id: 'opening', label: 'Rewrite the opening so it lands', note: 'Cut to the point sooner' },
  { id: 'professional', label: 'Make it read more professional', note: 'Steadier, less casual' },
  { id: 'playful', label: 'Warmer, more like you', note: 'Warmer, more like you' },
  { id: 'notags', label: 'Lift the hashtags out of the words', note: 'Move them out of the words' },
];

/* WHAT THE SUGGESTIONS KNOW — AND WHAT THEY MUST NOT PROMISE (Leon, Aug 1).
 *
 * One list answered every field, so a hook and a closing line were offered the
 * same edits, and "remove the hashtags" appeared on a slide, which has none.
 * Which part of the vocabulary is on offer now depends on what is being edited:
 * the slide's role, or the post's authority pillar for the caption.
 *
 * THE HARD LIMIT. Every label here is an instruction `polish` can actually
 * carry out. The brief for this pass asked for chips like "make it more
 * personal", "show the expertise", "add a client's perspective" — and this
 * module is a deterministic text tool with no model behind it, so those would
 * fill the field and then answer "that's outside this box". A chip that cannot
 * do what it says is worse than no chip. The ordering carries the strategy
 * instead: a hook leads with its opening, a teaching slide leads with adding a
 * line, a trust caption leads with warmth.
 *
 * When there is a model behind this, the labels in the brief are the right
 * ones and they belong here — with the intents to match. */
const ROLE_TIPS = {
  Hook: [
    { id: 'opening', label: 'Rewrite the opening so it lands', note: 'Cut to the point sooner' },
    { id: 'shorter', label: 'Tighten it — shorter, punchier', note: 'Make it punchier' },
    { id: 'add', label: 'Fill this out with more detail', note: 'Give it one more beat' },
    { id: 'playful', label: 'Warmer, more like you', note: 'More like you, less like copy' },
    { id: 'professional', label: 'Make it read more professional', note: 'Steadier, less casual' },
  ],
  CTA: [
    { id: 'shorter', label: 'Tighten it — shorter, punchier', note: 'Make it punchier' },
    { id: 'playful', label: 'Warmer, more like you', note: 'Warmer, more like you' },
    { id: 'add', label: 'Fill this out with more detail', note: 'Give it one more beat' },
    { id: 'opening', label: 'Rewrite the opening so it lands', note: 'Cut to the point sooner' },
    { id: 'professional', label: 'Make it read more professional', note: 'Steadier, less casual' },
  ],
  /* Setup / Process / Result — the teaching middle of a carousel */
  point: [
    { id: 'add', label: 'Fill this out with more detail', note: 'Give it one more beat' },
    { id: 'shorter', label: 'Tighten it — shorter, punchier', note: 'Make it punchier' },
    { id: 'professional', label: 'Make it read more professional', note: 'Steadier, less casual' },
    { id: 'opening', label: 'Rewrite the opening so it lands', note: 'Cut to the point sooner' },
    { id: 'playful', label: 'Warmer, more like you', note: 'More like you, less like copy' },
  ],
  /* a single-frame post: cover or poll, one line doing everything */
  Cover: [
    { id: 'opening', label: 'Rewrite the opening so it lands', note: 'Cut to the point sooner' },
    { id: 'shorter', label: 'Tighten it — shorter, punchier', note: 'Make it punchier' },
    { id: 'add', label: 'Fill this out with more detail', note: 'Give it one more beat' },
    { id: 'playful', label: 'Warmer, more like you', note: 'More like you, less like copy' },
  ],
};

const PILLAR_TIPS = {
  discovery: [
    { id: 'opening', label: 'Rewrite the opening so it lands', note: 'Cut to the point sooner' },
    { id: 'shorter', label: 'Tighten it — shorter, punchier', note: 'Make it punchier' },
    { id: 'playful', label: 'Warmer, more like you', note: 'Warmer, more like you' },
  ],
  credibility: [
    { id: 'add', label: 'Fill this out with more detail', note: 'Give it one more beat' },
    { id: 'professional', label: 'Make it read more professional', note: 'Steadier, less casual' },
    { id: 'shorter', label: 'Tighten it — shorter, punchier', note: 'Make it punchier' },
  ],
  trust: [
    { id: 'playful', label: 'Warmer, more like you', note: 'Warmer, more like you' },
    { id: 'add', label: 'Fill this out with more detail', note: 'Give it one more beat' },
    { id: 'opening', label: 'Rewrite the opening so it lands', note: 'Cut to the point sooner' },
  ],
};

/* the set on offer for this field. Caption keeps its own edits — length, tone,
 * hashtags — because those are true of a caption and of nothing else. */
export function tipsFor({ subject = 'caption', role, pillar } = {}) {
  if (subject === 'words') {
    if (ROLE_TIPS[role]) return ROLE_TIPS[role];
    return role ? ROLE_TIPS.point : ROLE_TIPS.Cover;
  }
  const byPillar = PILLAR_TIPS[pillar] || [];
  /* the caption-only edits sit after the strategy ones: they are always true,
     and they are not what the plan is asking for */
  return [...byPillar, { id: 'notags', label: 'Lift the hashtags out of the words', note: 'Move them out of the words' }];
}

/* Which suggestions answer what is being typed.
 *
 * It lives here rather than in the view because the matching IS part of the
 * vocabulary: the words that mean something ("shorter", "hashtags", "warmer") and
 * the words that don't. Without the stop list, "make it warmer" matched "Make it
 * shorter" on the word "make", and anything containing "the" matched everything
 * (Leon, July 30). */
const STOP = new Set([
  'a', 'an', 'and', 'are', 'be', 'can', 'could', 'do', 'for', 'in', 'is', 'it',
  'its', 'make', 'me', 'my', 'of', 'on', 'or', 'please', 'the', 'them', 'these',
  'this', 'to', 'up', 'was', 'with', 'you', 'your',
]);
export function polishTipsFor(query, context) {
  const words = (query || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return [];
  /* the pool is what this field offers, not everything the vocabulary knows */
  return (context ? tipsFor(context) : POLISH_TIPS).filter((tip) => {
    const hay = `${tip.label} ${tip.id}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  });
}

/* The field carries its own instructions now (Leon, July 30): the label above it
 * went, so the placeholder has to say what this box does — and an example is the
 * shortest way to teach the vocabulary it understands.
 *
 * ── AN EXAMPLE NOBODY CAN READ TEACHES NOTHING (Leon, Aug 9 — 764) ────────
 * 42 characters, in a field that also carries a send button: inside the post
 * it came out as 'Change the caption — e.g. "make it sho', so the half doing
 * the teaching was the half that was cut. The instruction is the first three
 * words; the example is the two that follow it. Both fit. */
export const POLISH_PLACEHOLDER = 'Change it — e.g. "make it shorter"';
export const POLISH_PLACEHOLDER_WORDS = 'Change them — e.g. "add a line"';
export const POLISH_HINT =
  'Edits to this caption only — length, tone, punctuation, hashtags. I won\'t add claims about your work that you haven\'t made.';

/* the one thing it says when asked something else. Names where the answer
 * actually lives rather than just refusing. */
/* the asks that would need sentences written, not sentences reshaped */
const NO_MODEL = /\b(persuasive|educational|curiosity|curious|intriguing|compelling|engaging|creative|catchy|punchy idea|new angle|different angle|rewrite it from scratch)\b/i;
const NO_MODEL_MESSAGE =
  'That one needs new sentences written, and this box reshapes the ones in front of it rather than inventing any. What I can do: tighten it, simplify it, sharpen the opening, make it steadier or warmer — or put back Bauhly\'s own line for this, written from your strategy.';

/* which asks can act on an empty field. Exported so the view and the intents
   cannot end up with two different vocabularies for the same question (835) */
export const canFillEmpty = (instruction) =>
  INTENTS.filter((i) => i.id === 'add' || i.id === 'strategy').some((i) => i.test.test(String(instruction || '')));

/* ── AND AN ASK IT CANNOT PLACE SAYS NOTHING (Leon, Aug 12 — 960) ────────
 * This used to answer with a paragraph — where strategy questions go, where
 * voice and audience live — which was written to be helpful and read as a
 * lecture: three sentences of routing, under the caption, in reply to one line
 * the studio typed. It also claimed to know what they had asked for, which this
 * box cannot do; all it actually knows is that no intent matched.
 * It says nothing now. The field keeps what they typed, the caption is
 * untouched, and the studio can try again — which is the whole of what the old
 * paragraph was worth. */
const OUT_OF_SCOPE = '';

/**
 * @returns {{ ok: true, caption: string, note: string|null, intent: string }
 *          | { ok: false, message: string }}
 */
export function polish(caption, instruction, extras = [], opts = {}) {
  const ask = String(instruction || '').trim();
  if (!ask) return { ok: false, message: 'Tell me what to change — shorter, warmer, sharper opening.' };
  /* ── THE ONE ANSWER THIS BOX MUST NOT FAKE (Leon, Aug 9 — 835) ────────
   * "More persuasive", "more educational", "add some curiosity" are rewrites:
   * they need new sentences, and there is no model behind this box (see the
   * note on `add`). They used to fall into OUT_OF_SCOPE, which says the ask
   * belongs somewhere else — it does not, it belongs exactly here and cannot
   * be done yet. Said plainly, with the two things that ARE real in the same
   * breath, rather than a refusal that sounds like a category error. */
  if (NO_MODEL.test(ask) && !/\b(shorter|longer|hashtags?|emoji)\b/i.test(ask)) {
    return { ok: false, message: NO_MODEL_MESSAGE };
  }
  const intent = INTENTS.find((i) => i.test.test(ask));
  if (!intent) return { ok: false, message: OUT_OF_SCOPE };
  const { text, note, noop } = intent.run(String(caption || ''), extras, opts);
  /* nothing changed. That is an answer, not a failure — but it must not be
   * reported in the past tense, which is what made "contractions back in" show
   * up under a caption that already had them. */
  if (text === caption) {
    return { ok: false, message: noop || note || 'That would leave the caption exactly as it is.' };
  }
  return { ok: true, caption: text, note, intent: intent.id };
}

export default polish;
