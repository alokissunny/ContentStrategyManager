/*
 * ══ WHAT "SOUND LIKE ME" MEANS, FOR THIS STUDIO ══════════════════════════
 *
 * (Leon, Sep 24: "Use Sound like me as an opportunity for Bauhly to
 * progressively understand the user's writing preferences. Ask only what
 * Bauhly does not already know → apply the answer → update Brand DNA → do not
 * ask the same thing again.")
 *
 * WHAT THIS IS NOT. Not a settings screen, not an onboarding step, not a
 * questionnaire. Every question here is asked inside the suggestion row, one
 * level at a time, in the middle of a change the studio was already making —
 * and it is asked exactly once. The row is the only surface; there is no page
 * where these can be edited, by instruction, and none is needed: returning to
 * the question shows the known answer marked, and pressing a different one
 * swaps it.
 *
 * ── WHY A PRESS IS SAVED AND A SENTENCE IS NOT (Leon, Sep 24) ────────────
 * `lib/prefs.js` says, and is right to say, that nothing typed is stored until
 * the studio presses Remember this: reading a rule out of free text is an
 * INFERENCE, and an inference that saves itself is one you cannot correct.
 * A chip is not an inference. The studio pressed `Warm`; there is nothing to
 * get wrong and nothing to confirm, and asking them to confirm it is the
 * "continuously configure your tone" outcome this feature exists to end. So
 * the two paths stay different on purpose: a press writes here, a typed rule
 * still goes to the queue.
 *
 * ── AND A PREFERENCE IS BOTH HALVES ──────────────────────────────────────
 * Each option carries `say`, the words the product's own reader is handed for
 * the change being made RIGHT NOW, and `value`, what is remembered. One press
 * does both: the caption in front of them changes, and the next one starts
 * closer. Neither half is worth having alone — applying without remembering is
 * the studio saying it again next week, remembering without applying is a
 * setting that did nothing.
 */

/* ── the areas, in the order they are worth asking ────────────────────────
 * `rank` is what §3 calls the highest-value unknown: voice first because every
 * other answer is read through it, then how much is said, then what to avoid —
 * a studio who says "never salesy" has told Bauhly more than one who picks a
 * confidence level. The row never shows more than a handful (see `askAreas`),
 * so the order is what decides which questions a studio actually meets.
 */
export const DNA_AREAS = [
  {
    key: 'voice', rank: 1,
    chip: 'How should this feel?',
    hint: 'Anything else about how it should sound?',
    options: [
      { id: 'pro', label: 'Professional', say: 'more professional', value: 'professional' },
      { id: 'conv', label: 'Conversational', say: 'more like talking', value: 'conversational' },
      { id: 'warm', label: 'Warm', say: 'warmer', value: 'warm' },
      { id: 'direct', label: 'Direct', say: 'more direct', value: 'direct' },
      { id: 'refined', label: 'Refined', say: 'more refined', value: 'refined' },
    ],
  },
  {
    key: 'depth', rank: 2,
    chip: 'How much should it say?',
    hint: 'Anything else about the length?',
    options: [
      { id: 'short', label: 'Short and sharp', say: 'shorter and sharper', value: 'short' },
      { id: 'balanced', label: 'Balanced', say: 'at a balanced length', value: 'balanced' },
      { id: 'deep', label: 'More depth', say: 'with more depth', value: 'deep' },
    ],
  },
  {
    key: 'avoid', rank: 3, multi: true,
    chip: 'Anything to avoid?',
    hint: 'Anything else to keep out of it?',
    options: [
      { id: 'salesy', label: 'Salesy', say: 'never salesy', value: 'salesy' },
      { id: 'corporate', label: 'Corporate', say: 'never corporate', value: 'corporate' },
      { id: 'casual', label: 'Too casual', say: 'never too casual', value: 'casual' },
      { id: 'buzzwords', label: 'Buzzwords', say: 'without buzzwords', value: 'buzzwords' },
      { id: 'emojis', label: 'Emojis', say: 'without emojis', value: 'emojis' },
    ],
  },
  {
    key: 'angle', rank: 4,
    chip: 'What should it talk about?',
    hint: 'Anything else it should lead with?',
    options: [
      { id: 'decisions', label: 'My decisions', say: 'about the decisions I made', value: 'decisions' },
      { id: 'story', label: 'The story', say: 'as a story', value: 'story' },
      { id: 'process', label: 'The process', say: 'about how it was done', value: 'process' },
      { id: 'result', label: 'The result', say: 'about the result', value: 'result' },
    ],
  },
  {
    key: 'explain', rank: 5,
    chip: 'How should it explain?',
    hint: 'Anything else about how much to explain?',
    options: [
      { id: 'simple', label: 'Simply', say: 'explained simply', value: 'simple' },
      { id: 'detailed', label: 'In detail', say: 'explained in detail', value: 'detailed' },
      { id: 'teach', label: 'Teach it', say: 'so it teaches the reader', value: 'educational' },
      { id: 'point', label: 'Straight to the point', say: 'straight to the point', value: 'direct' },
    ],
  },
  {
    key: 'person', rank: 6,
    chip: 'How much of you?',
    hint: 'Anything else about how personal it is?',
    options: [
      { id: 'neutral', label: 'Keep it neutral', say: 'kept neutral', value: 'neutral' },
      { id: 'little', label: 'A little personal', say: 'a little more personal', value: 'little' },
      { id: 'more', label: 'More of me', say: 'more personal', value: 'more' },
    ],
  },
  {
    key: 'confidence', rank: 7,
    chip: 'How sure should it sound?',
    hint: 'Anything else about the tone of it?',
    options: [
      { id: 'understated', label: 'Understated', say: 'more understated', value: 'understated' },
      { id: 'confident', label: 'Confident', say: 'more confident', value: 'confident' },
      { id: 'bold', label: 'Bold', say: 'bolder', value: 'bold' },
    ],
  },
];

export const areaOf = (key) => DNA_AREAS.find((a) => a.key === key) || null;

/* the stored shape, read defensively: this is a slice a studio's browser has
   been carrying since before the feature existed */
export function dnaOf(state) {
  const raw = (state && state.dna) || {};
  const out = {};
  for (const area of DNA_AREAS) {
    const v = raw[area.key];
    if (area.multi) out[area.key] = Array.isArray(v) ? v.filter((x) => area.options.some((o) => o.value === x)) : [];
    else if (area.options.some((o) => o.value === v)) out[area.key] = v;
  }
  return out;
}

/* ── AND "KNOWN" IS NOT THE SAME QUESTION FOR EVERY AREA ─────────────────
 * A voice is one answer and the studio has given it or not. What to AVOID is
 * a list that is never finished — a studio who has said "no emojis" may still
 * want to say "never salesy" — so it counts as known once there is something
 * in it, and stays offerable with what is already chosen marked. Otherwise the
 * one area where more answers are genuinely better would be the first to go
 * quiet.
 */
export const knows = (dna, key) => {
  const area = areaOf(key);
  if (!area) return false;
  return area.multi ? (dna[key] || []).length > 0 : Boolean(dna[key]);
};

/* what is still worth asking, best first — §3's "highest-value preference
   Bauhly does not confidently know yet". `avoid` keeps its place while it has
   room left, because a second thing to avoid is worth more than a first
   confidence level. */
export function askAreas(dna, limit = 4) {
  return DNA_AREAS
    .filter((a) => (a.multi ? (dna[a.key] || []).length < a.options.length : !knows(dna, a.key)))
    .sort((x, y) => x.rank - y.rank)
    .slice(0, limit);
}

/* ── AND WHAT BAUHLY ALREADY KNOWS IS AN INSTRUCTION, NOT A PROFILE ──────
 * §7: an established studio pressing `Sound like me` should have it APPLIED,
 * not be asked more questions. So everything known is written back out as the
 * sentence a studio would have typed — in the vocabulary `lib/polish.js`
 * reads, same as every other `say` in the row. With nothing known it returns
 * the plain phrase, which is exactly what the old `Sound more like me` leaf
 * said before this feature replaced it, so the worst case is no worse than
 * what was there.
 */
export function dnaSentence(dna) {
  const parts = [];
  for (const area of DNA_AREAS) {
    if (area.multi) {
      for (const v of dna[area.key] || []) {
        const o = area.options.find((x) => x.value === v);
        if (o) parts.push(o.say);
      }
    } else if (dna[area.key]) {
      const o = area.options.find((x) => x.value === dna[area.key]);
      if (o) parts.push(o.say);
    }
  }
  if (!parts.length) return 'warmer, more like me';
  return `in my voice — ${parts.join(', ')}`;
}

/* the one write. A multi area appends and never repeats; a single area
   replaces, which is how a studio changes their mind about it. */
export function withDna(dna, key, value) {
  const area = areaOf(key);
  if (!area || !area.options.some((o) => o.value === value)) return dna;
  if (!area.multi) return { ...dna, [key]: value };
  const had = dna[key] || [];
  return { ...dna, [key]: had.includes(value) ? had.filter((v) => v !== value) : [...had, value] };
}

/* ── AND A TYPED RULE CAN ANSWER ONE OF THESE TOO (Leon, Sep 24, §6) ──────
 * "Do not restrict Brand DNA learning to suggestion clicks. Make it less
 * salesy, don't use emojis — these can also become Brand DNA signals."
 *
 * They can, and only where the reading is not a guess. `detectPreference`
 * has already done the hard half: it decided the studio was stating a RULE
 * rather than asking for a change, and the studio has confirmed it by
 * pressing Remember this. What is left is whether the rule happens to name
 * something this file has a chip for — and that is a word match, on the
 * studio's own words, or nothing.
 *
 * ONLY `avoid`, AND ONLY FOR NOW. It is the one area whose options are
 * things people name in passing, and the one that is a LIST, so adding to it
 * from a sentence cannot overwrite an answer given deliberately. A typed
 * "keep it warm" is not treated as the voice answer: warmth in one caption is
 * not the same claim as `Warm` pressed under How should this feel?, and the
 * spec's own warning — do not treat a clearly one-off instruction as a
 * permanent preference — is about exactly that distance.
 */
const AVOID_WORDS = {
  salesy: /\bsales[-\s]?y\b|\bsell(ing)?\s+too\s+hard\b|\bpushy\b/i,
  corporate: /\bcorporate\b|\bcorporate[-\s]?speak\b/i,
  casual: /\btoo\s+casual\b|\bslang\b/i,
  buzzwords: /\bbuzz\s?words?\b|\bjargon\b/i,
  emojis: /\bemoji(s|es)?\b/i,
};

/* the value a confirmed rule teaches, or null when it teaches nothing here */
export function avoidFromRule(line) {
  const text = String(line || '');
  /* the rule has to be about keeping something OUT — `detectPreference`'s
     avoid shapes all read this way, and a line that merely mentions emojis
     while asking for more of them must not land in the same bucket */
  if (!/\b(avoid|never|no more|without|stop|don'?t|do not)\b/i.test(text)) return null;
  for (const [value, re] of Object.entries(AVOID_WORDS)) if (re.test(text)) return value;
  return null;
}
