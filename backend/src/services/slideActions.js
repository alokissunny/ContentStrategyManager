/**
 * Editor mode's suggestion chips, as the backend understands them.
 *
 * The chat under the post (frontend lib/askactions.js, from bauhly-v3) builds
 * an instruction as a PATH of chip ids — `text: rewrite › impact` — and sends
 * both the sentence it reads as and the path itself (`intent`). The sentence is
 * written for a person; the path says exactly what was pressed. This file turns
 * the path into:
 *
 *   - a precise brief for the Slide Edit agent (what the action means, what it
 *     may touch and what it must leave alone), or
 *   - a PICTURE operation the agent cannot do by rewriting html:
 *       `replace`     make a new picture for the selected image / empty frame
 *       `perspective` correct the selected photo's perspective (image edit)
 *       `add`         make a picture and let the agent place it on the slide
 *
 * Unknown ids fall back to the chip labels, so a catalogue update in the
 * frontend never breaks an edit — it only loses the extra precision.
 */

const TEXT_SCOPE = 'Change ONLY the element marked data-bauhly-focus — its words. Keep its style, size, position and every other element exactly as they are.';
const SLIDE_WORDS_SCOPE = 'Change the words on this slide only; keep the layout, styles, pictures and positions exactly as they are.';
const LOOK_SCOPE = 'Change only how the text LOOKS (size, weight, spacing, alignment, hierarchy) — never the words, pictures or order.';

// ── what each chip means ────────────────────────────────────────────────────
const REWRITE = {
  _: 'Rewrite the selected words. Keep the meaning and every fact; roughly the same length unless a refinement below says otherwise.',
  impact: 'Make it land harder: a sharper verb, a concrete noun, no hedging — put the strongest word first or last.',
  curious: 'Make the reader want the next slide: open a question or tension the carousel goes on to answer. Never clickbait, never a promise the post does not keep.',
  concise: 'Shorter and tighter: cut at least a third of the words and keep the point.',
  explan: 'Explain it a little more: add the missing "because" or "so what" in a few words — still one line if it was one line.',
  simpler: 'Use plain, everyday words a client would use. No jargon.',
  message: 'So the opening lands: make the first words carry the point.',
  shorter: 'Shorter: cut at least a third of the words.',
  clearer: 'Clearer and less wordy: one idea per sentence, no filler.',
  pro: 'More formal and less casual.',
  conv: 'More casual and relaxed, like talking to a client.',
};
const VOICE = {
  _: 'Write it in the studio\'s own voice — follow BRAND VOICE closely: their register, their wording habits and their never-do lines.',
  'voice-pro': 'Their voice, more professional.',
  'voice-conv': 'Their voice, more like talking to a client.',
  'voice-warm': 'Their voice, warmer.',
  'voice-direct': 'Their voice, more direct — say it plainly.',
  'voice-refined': 'Their voice, more refined.',
  'depth-short': 'Short and sharp.',
  'depth-balanced': 'At a balanced length.',
  'depth-deep': 'With a little more depth — one more clause, not another block of text.',
  'avoid-salesy': 'Never salesy: no pitch, no urgency, no superlatives.',
  'avoid-corporate': 'Never corporate: no business jargon.',
  'avoid-casual': 'Never too casual: no slang.',
  'avoid-buzzwords': 'No buzzwords.',
  'avoid-emojis': 'No emojis.',
  'angle-decisions': 'Framed around the design decisions they made.',
  'angle-story': 'Told as a small story.',
  'angle-process': 'About how it was done.',
  'angle-result': 'About the result — only what STRATEGY verifies.',
};
const DETAIL = {
  _: 'Say more about it: add ONE short line next to the selected words, using only what STRATEGY supports. If STRATEGY has nothing for it, sharpen the existing line instead of inventing. Keep the layout safe — the new line must fit without overlapping anything.',
  why: 'The line says why this mattered.',
  context: 'The line gives the context.',
  example: 'The line gives one concrete example.',
  process: 'The line says how it was done.',
  result: 'The line says what the result was (only if verified).',
};
const TONE = {
  _: 'Change how it sounds; keep the meaning and the facts.',
  pro: 'More professional.',
  conv: 'Warmer and more casual.',
  warm: 'Warmer.',
  minimal: 'Plainer — fewer adjectives, shorter words.',
};
const TYPE = {
  _: 'Adjust the type on this slide.',
  bigger: 'Make the title larger — it must still fit its column and leave room for the lines under it.',
  smaller: 'Make the title smaller.',
  hier: 'Stronger hierarchy: a clearer difference between title, supporting text and details (size and weight).',
  air: 'More air: more spacing between and around the text blocks, nothing crowded.',
  left: 'Align the text blocks left.',
  centre: 'Centre the text blocks.',
  right: 'Align the text blocks right.',
};

function brief(ids, table, scope) {
  const lines = [table._];
  ids.forEach((id) => { if (table[id]) lines.push(table[id]); });
  if (scope) lines.push(scope);
  return lines.filter(Boolean).join(' ');
}

/**
 * @param {object} intent  { kind: 'text'|'picture'|'place'|'post', path: string[], labels: string[] }
 * @returns {{ op: ''|'replace'|'perspective'|'add', brief: string, pressed: string, style?: string, unsupported?: string }}
 */
function planIntent(intent) {
  const kind = String(intent?.kind || '');
  const path = (Array.isArray(intent?.path) ? intent.path : []).map((x) => String(x || '')).filter(Boolean).slice(0, 6);
  const labels = (Array.isArray(intent?.labels) ? intent.labels : []).map((x) => String(x || '').slice(0, 80)).slice(0, 6);
  const pressed = labels.length ? labels.join(' › ') : path.join(' › ');
  const out = { op: '', brief: '', pressed };
  if (!path.length) return out;
  const [head, ...rest] = path;

  if (kind === 'picture') {
    if (head === 'make' || head === 'regen' || head === 'narrative') return { ...out, op: 'replace' };
    if (head === 'perspective') return { ...out, op: 'perspective' };
  }
  if (kind === 'place' && (head === 'narrative' || head === 'make')) return { ...out, op: 'replace' };

  if (kind === 'text') {
    if (head === 'rewrite') return { ...out, brief: brief(rest, REWRITE, TEXT_SCOPE) };
    if (head === 'soundlike') return { ...out, brief: brief(rest.slice(-1), VOICE, TEXT_SCOPE) };
    if (head === 'shorter') return { ...out, brief: `${REWRITE.concise} ${TEXT_SCOPE}` };
    if (head === 'simplify') return { ...out, brief: `${REWRITE.simpler} Same meaning. ${TEXT_SCOPE}` };
    if (head === 'detail') return { ...out, brief: brief(rest, DETAIL, '') };
    if (head === 'tone') return { ...out, brief: brief(rest, TONE, TEXT_SCOPE) };
  }

  if (kind === 'post') {
    if (head === 'rewrite') {
      if (rest[0] === 'soundlike') return { ...out, brief: brief(rest.slice(-1), VOICE, SLIDE_WORDS_SCOPE) };
      return { ...out, brief: brief(rest, { ...REWRITE, _: 'Rewrite the words on this slide; keep the meaning and every fact.' }, SLIDE_WORDS_SCOPE) };
    }
    if (head === 'type') return { ...out, brief: brief(rest, TYPE, LOOK_SCOPE) };
    if (head === 'add') {
      if (rest[0] === 'visual') return { ...out, op: 'add', style: 'photo' };
      if (rest[0] === 'graphic') return { ...out, op: 'add', style: 'illustration' };
      if (rest[0] === 'artwork') return { ...out, unsupported: 'There is no artwork library on this account yet — upload a picture instead.' };
    }
  }
  // `All slides` in the chat: the same change on every slide, which the refine
  // runs per slide with a one-line outline of the others for context
  if (kind === 'all') {
    const EVERY = 'Apply it to THIS slide the way it applies to every slide of the carousel, so the slides still read as one story and look like one set.';
    if (head === 'write') {
      if (rest[0] === 'soundlike') return { ...out, brief: brief(rest.slice(-1), VOICE, `${SLIDE_WORDS_SCOPE} ${EVERY}`) };
      return { ...out, brief: brief(rest, { ...REWRITE, _: 'Rewrite the words on this slide; keep the meaning and every fact.' }, `${SLIDE_WORDS_SCOPE} ${EVERY}`) };
    }
    if (head === 'type') return { ...out, brief: brief(rest, TYPE, `${LOOK_SCOPE} ${EVERY}`) };
    if (head === 'visuals') {
      return { ...out, unsupported: 'Pictures are made one slide at a time — switch to This post, pick the slide, and choose Make something › An image.' };
    }
  }
  // anything else: the labels say what was pressed; the sentence says the rest
  return out;
}

// ── the selected picture, inside a slide's <article> ─────────────────────────
// The client marks the selected element with data-bauhly-focus. For a picture
// that is the <img> itself or a frame around it; the image is the first <img>
// from the marked element on.
function focusedImage(article) {
  const html = String(article || '');
  const at = html.search(/\sdata-bauhly-focus\s*=/i);
  if (at < 0) return null;
  const open = html.lastIndexOf('<', at);
  const from = open >= 0 ? open : at;
  const re = /<img\b[^>]*>/gi;
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) return null;
  // the marked element must not end before this <img> (a sibling after it)
  const markedTag = html.slice(from, html.indexOf('>', at) + 1);
  const tagName = (markedTag.match(/^<([a-z0-9]+)/i) || [])[1] || '';
  if (tagName && tagName.toLowerCase() !== 'img') {
    const close = html.toLowerCase().indexOf(`</${tagName.toLowerCase()}>`, from);
    if (close >= 0 && close < m.index) return null;
  }
  return { index: m.index, tag: m[0] };
}

function attrOf(tag, name) {
  const m = String(tag || '').match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
}

// Put a new picture in the selected image's place: same element, same box and
// classes — only what it shows changes.
function swapFocusedImage(article, { key, src, alt }) {
  const hit = focusedImage(article);
  if (!hit) return '';
  let tag = hit.tag
    .replace(/\s(src|data-asset-key|data-image-request|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sclass\s*=\s*("|')([^"']*)\1/i, (all, q, cls) => ` class=${q}${cls.split(/\s+/).filter((c) => c && c !== 'is-placeholder' && c !== 'is-loaded').join(' ')}${q}`);
  if (!/\sdata-slot\s*=/i.test(tag)) tag = tag.replace(/^<img\b/i, '<img data-slot="image"');
  const esc = (v) => String(v || '').replace(/"/g, '&quot;');
  if (alt && !/\salt\s*=/i.test(tag)) tag = tag.replace(/^<img\b/i, `<img alt="${esc(alt)}"`);
  tag = tag.replace(/\s*\/?>$/, ` data-asset-key="${esc(key)}"${src ? ` src="${esc(src)}"` : ''}>`);
  const out = article.slice(0, hit.index) + tag + article.slice(hit.index + hit.tag.length);
  return out.replace(/\sdata-bauhly-focus\s*=\s*("[^"]*"|'[^']*')/gi, '');
}

const PERSPECTIVE_PROMPT = [
  'Correct the perspective of this photograph like an architectural shift-lens correction:',
  'make vertical lines truly vertical and horizontal lines level.',
  'Keep everything else identical — the same room, objects, materials, colours, light and framing.',
  'Crop as little as possible. Do not add, remove or restyle anything. No text.',
].join(' ');

module.exports = { planIntent, focusedImage, swapFocusedImage, attrOf, PERSPECTIVE_PROMPT };
