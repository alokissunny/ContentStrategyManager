/*
 * THE TEXT ON A SLIDE, BY ROLE (Leon, Aug 9 — decision 852)
 *
 * A layout is not one line. `Preview` draws an eyebrow, a heading, a number, a
 * body and a detail — each in its own face, at its own size, in its own place —
 * and until now the post could carry exactly one of them: the heading. Everything
 * else came from the library's demonstration copy, which is why editing a slide
 * felt like editing a caption rather than editing a composition.
 *
 * Two things live here, because they are the same subject and neither belongs
 * to a view:
 *
 *   1 · WHICH ROLES A LAYOUT HAS, in the order it draws them, and which
 *       typography slot each one is set in. The slot matters because Library
 *       Settings owns the faces (`TYPE_SLOTS` in lib/identity.js) and the editor
 *       has to be able to say "Heading — uses Cabinet Grotesk" without ever
 *       offering to change it.
 *
 *   2 · HOW EMPHASIS IS STORED. A studio marking one word in their brand accent
 *       is the single piece of formatting this product allows, so it is stored
 *       the smallest way that survives being edited: inside the string, naming a
 *       PALETTE ROLE rather than a colour.
 *
 *         Beautiful projects aren't enough {{accent|anymore.}}
 *
 *       `fg` / `accent` / `ground` are the three roles in `COLOUR_ROLES`, and no
 *       other value can ever be written — which is the whole guarantee. A studio
 *       who later changes their accent in Library Settings sees every slide that
 *       used it change with them, because what was saved was "the accent", not
 *       an orange. A hex in this string would be a brand that had escaped.
 */

/* ── THE ROLES, IN DRAWING ORDER ─────────────────────────────────────────
 * Not alphabetical and not the order they happen to sit in the data: the order
 * the eye meets them in the composition, so the editor's fields and the picture
 * above it are read the same way down.
 * `slot` is the `TYPE_SLOTS` id whose face this role is set in. */
/* ── ONE FIELD PER TYPOGRAPHY ROLE, AND NOTHING ELSE (852, cut at 863) ───
 * `accent` was in this list and should never have been. It is not a role: it is
 * the layout's SECOND LINE, drawn in the accent colour — a colour treatment
 * inside the heading. Giving it a field of its own meant Edit text grew a box
 * because a line was orange, which is the one thing item 4 of the brief calls
 * out: a field exists for a typography ROLE, not for styling within one.
 * Colour lives inside the field it belongs to now — a word marked `{{accent|…}}`
 * in the heading — so there is one place to edit that sentence and the emphasis
 * travels with it. See `parseMarked`. */
export const TEXT_ROLES = [
  { key: 'eyebrow', label: 'Eyebrow', slot: 'detail', hint: 'The small line above.' },
  { key: 'big', label: 'Number', slot: 'headline', hint: 'The figure the slide is about.' },
  { key: 'head', label: 'Heading', slot: 'headline', hint: 'The line the slide is about.' },
  { key: 'body', label: 'Body', slot: 'body', hint: 'Everything under it.' },
  { key: 'detail', label: 'Detail', slot: 'detail', hint: 'The note at the foot.' },
];

const ROLE_BY_KEY = Object.fromEntries(TEXT_ROLES.map((r) => [r.key, r]));
export const roleOf = (key) => ROLE_BY_KEY[key] || null;

/* which roles a given layout actually has. Only fields the layout was authored
   with are offered: a `statement` has a heading and nothing else, and showing a
   studio three empty boxes on it would be inventing structure the composition
   does not have. */
/* ── AND A LIST IS A SET OF ROLES (Leon, Aug 10 — decision 925) ──────────
 * `art.items` is the numbered list a framework draws — "01 Discover, 02 Design"
 * — and it is an ARRAY, so the type test above skipped it and Edit text offered
 * nothing for it. A studio could choose the four-step layout and then not write
 * the four steps.
 * Each entry becomes a role of its own, keyed `items.0`, `items.1`, so
 * everything downstream — the store, the capacity, the editor — keeps working
 * on flat keys and only `dress` has to know they reassemble into a list. */
export const LIST_KEY = 'items';
export const isListRole = (key) => String(key).startsWith(`${LIST_KEY}.`);
export const listIndexOf = (key) => Number(String(key).split('.')[1]);

export function rolesOf(layout) {
  const art = layout?.art || {};
  const flat = TEXT_ROLES.filter((r) => typeof art[r.key] === 'string');
  const list = Array.isArray(art[LIST_KEY])
    ? art[LIST_KEY].map((_, i) => ({
      key: `${LIST_KEY}.${i}`,
      label: `Step ${i + 1}`,
      slot: 'body',
      hint: 'One line of the list.',
    }))
    : [];
  /* the list is drawn under the heading, so it is offered under it */
  return [...flat, ...list];
}

/* ── THE MARKUP ──────────────────────────────────────────────────────────
 * One form, one vocabulary, and a parser that cannot be surprised: anything
 * that is not an exact `{{role|…}}` with a known role is plain text, including
 * a stray `{{`. Text a studio typed is never a syntax error.
 */
const MARK = /\{\{(fg|accent|ground)\|([^{}]*)\}\}/g;
export const PALETTE_KEYS = ['fg', 'accent', 'ground'];

/* → [{ text, mark: 'accent' | null }, …] */
export function parseMarked(value) {
  const src = String(value ?? '');
  const out = [];
  let at = 0;
  src.replace(MARK, (whole, role, text, i) => {
    if (i > at) out.push({ text: src.slice(at, i), mark: null });
    if (text) out.push({ text, mark: role });
    at = i + whole.length;
    return whole;
  });
  if (at < src.length) out.push({ text: src.slice(at), mark: null });
  return out.length ? out : [{ text: '', mark: null }];
}

/* the words without any of it — what a length check, a comparison or a plain
   `<textarea>` should ever see */
export const plainOf = (value) => parseMarked(value).map((p) => p.text).join('');

/* the inverse: a run list back into one string. Runs that carry no mark are
   written as-is, which is what keeps an untouched line byte-identical to what
   the library shipped. */
export function toMarked(runs) {
  return (runs || [])
    .filter((r) => r && r.text)
    .map((r) => (r.mark && PALETTE_KEYS.includes(r.mark) ? `{{${r.mark}|${r.text}}}` : r.text))
    .join('');
}

/* does this value carry any emphasis at all — used to decide whether "Remove
   emphasis" is worth offering */
export const hasMark = (value) => parseMarked(value).some((p) => p.mark);

/* the custom property a palette role paints with. The artwork already reads
   these three (see `paintOf`), so emphasis inherits the studio's palette for
   free and changes with it. */
export const COLOUR_VAR = {
  fg: 'var(--t-ground-fg, var(--ink-900))',
  accent: 'var(--t-accent-bg, var(--signal-500))',
  ground: 'var(--t-ground-bg, var(--surface-sunken))',
};

/* Ordered runs for rendering. Accent is only an explicit {{accent|…}} mark
   from Day Writer or the editor — never a guessed last sentence or last beat. */
export function titleRuns(text) {
  const src = String(text || '').trim();
  if (!src) return [];
  return parseMarked(src).filter((p) => p.text);
}

/* ══ WHAT A LAYOUT CAN HOLD, AND FITTING COPY TO IT ══════════════════════
 * (Leon, Aug 9 — decision 878)
 *
 * The rule this file now enforces is the brief's own: the LAYOUT decides how
 * much content there is room for, and the copy is adapted to fit — never the
 * other way round, and never by shrinking the type.
 *
 * ── WHERE THE CAPACITY COMES FROM ───────────────────────────────────────
 * Not a table somebody maintains alongside the layouts, which would be a second
 * source of truth drifting away from the first. Every layout in the Visual
 * Library ships with example copy that was authored FOR it — that example IS
 * the demonstration of the right density, which is exactly what the library is
 * for. So the capacity of a role is the size of the example the library shows
 * in it, with a little room either side.
 *
 * Three things follow, and all three are asked for:
 *   · the library can never look overcrowded, because its own copy defines the
 *     measure it is judged against;
 *   · a studio's content is adapted to the same density the library
 *     demonstrated, so a clean layout stays clean when real words arrive;
 *   · and one definition drives the library, the carousel, the post preview and
 *     Edit text, because they all read it from the layout.
 *
 * ── AND WHAT "ADAPTED" HONESTLY MEANS HERE ──────────────────────────────
 * There is no model in this build (see lib/polish.js). `fit` does not write
 * anything: it CHOOSES and CONDENSES the studio's own sentences, using the same
 * deterministic transforms the ask field runs — drop the filler, drop the
 * run-up, drop the trailing clause after a dash, then fall back to the first
 * sentence. Meaning is preserved because nothing is invented and nothing is cut
 * mid-thought; what goes is the padding, in the order a person would drop it.
 * It is not the intelligent rewriting the brief describes, and it should be
 * replaced at this one function the day a generator exists.
 */

/* the tolerance either side of the example's own length. Under it, a line is
   comfortably inside the composition; over it, the layout starts filling up. */
const ROOM = 1.25;
/* a floor, so a layout whose example is two words does not reject every real
   sentence a studio has ever written */
const FLOOR = { head: 42, big: 6, eyebrow: 26, body: 90, detail: 64 };
/* a list entry is a label, not a sentence — the floor is the shortest thing
   that can still be a step ("Discover") plus room to say it differently */
const LIST_FLOOR = 22;

export function capacityOf(layout, key) {
  const shipped = isListRole(key)
    ? String(layout?.art?.[LIST_KEY]?.[listIndexOf(key)] ?? '')
    : String(layout?.art?.[key] ?? '');
  const own = Math.round(shipped.length * ROOM);
  return Math.max(isListRole(key) ? LIST_FLOOR : (FLOOR[key] || 60), own);
}

const FILLER = /\b(very|really|just|quite|actually|simply|truly|honestly|literally|basically)\s+/gi;
const HEDGE = /^(here(?:'s| is) (?:why|how|what)|let(?:'s| us) talk about|a (?:quick )?(?:note|word) (?:on|about)|when it comes to|one thing about|the truth (?:is )?about)\s+/i;
const tidy = (t) => t.replace(/\s{2,}/g, ' ').trim();
const firstSentence = (t) => (t.match(/[^.!?]+[.!?]?/)?.[0] || t).trim();

/* → a line that fits `cap`, or '' when nothing of it survives honestly */
export function fit(text, cap) {
  let out = tidy(String(text || ''));
  if (!out) return '';
  if (out.length <= cap) return out;

  /* 1 · the padding */
  out = tidy(out.replace(FILLER, '').replace(HEDGE, ''));
  if (out.length <= cap) return out;

  /* 2 · the explanation hanging off the end */
  const cut = out.match(/^(.{12,}?)\s*[—–-]\s+\S.*$/);
  if (cut) {
    const head = tidy(cut[1]).replace(/[,;:]$/, '');
    if (head.length <= cap) return head;
    out = head;
  }

  /* 3 · as many whole sentences as the role has room for. Taking only the
     first would hand a roomy editorial body the same one line as a tight
     heading — the layout's capacity is the point, so it is spent. */
  const sentences = out.match(/[^.!?]+[.!?]?/g)?.map((t) => t.trim()).filter(Boolean) || [out];
  let kept = '';
  for (const sentence of sentences) {
    const join = kept ? `${kept} ${sentence}` : sentence;
    if (join.length > cap) break;
    kept = join;
  }
  if (kept) return kept;
  const one = firstSentence(out);
  if (one.length <= cap) return one;

  /* 4 · the first clause of that. Never a mid-word cut: a line that cannot be
     shortened without breaking a word is a line this layout cannot hold, and
     saying nothing is more honest than saying half a thought. */
  const clause = one.split(/,\s+/)[0];
  return clause.length <= cap ? tidy(clause).replace(/[,;:]$/, '') : '';
}
