/*
 * (Ported from bauhly-v3 lib/discovery.js, Nov 10.)
 * What a landing visit's Capture asks about the studio, once the visitor has said what the project
 * is and shown what they have (Leon, Nov 6, the Flow B brief; decision 674): their Instagram (read at
 * once, in the background), then three questions, which must be answered. The conversation is in
 * `CaptureChat`; this is the words. The answers go to Business memory in the words of the option they
 * pressed, or their own — nothing inferred (backend services/visitorInstagram.js `rememberAnswers`).
 */

export const IG_ASK = {
  say: 'Want me to understand your studio better?\n\nShare your Instagram profile and I’ll review up to 10 recent public posts to help tailor your content.',
  note: 'Optional · No Instagram login needed',
  field: 'instagram.com/yourstudio',
  /* the two lines of the reference's card, as they are (Leon's screenshots, Nov 6) */
  skip: { title: 'No, for now', line: 'I’ll tell you a bit about my business instead.' },
  invalid: 'That doesn’t look like an Instagram profile. Try instagram.com/yourstudio or @yourstudio, or choose No, for now.',
  /* a handle given: the read stands in for the studio questions, so none are asked (bauhly-v3 `readyForAccount`) */
  held: (handle) => `Thanks — I’m looking through @${handle} in the background. That’s everything I need. Ready to become your first post.`,
  skipped: 'No problem. A few quick questions will help me understand your studio.',
  enough: 'No problem. I have what I need from what you told me.',
};

export const QUESTIONS = [
  {
    id: 'studio',
    ask: 'What best describes your studio and the clients you work with?',
    hint: 'Choose all that apply.',
    max: null,
    otherField: 'Describe your studio…',
    /* `Other` stands alone: pressing it clears the rest and they step back, pressing one of them while it
       is on puts it down (Leon, Nov 7, then "Yes, all three" on Nov 8; decision 690) */
    otherAlone: true,
    options: [
      { id: 'residential', title: 'Residential design', line: 'Homes, renovations, private clients.' },
      { id: 'architecture', title: 'Architecture studio', line: 'Buildings, architecture, new construction.' },
      { id: 'commercial', title: 'Commercial spaces', line: 'Offices, hospitality, retail, businesses.' },
      { id: 'highend', title: 'High-end interiors', line: 'Bespoke spaces, premium clients.' },
      { id: 'mixed', title: 'Mixed projects', line: 'Different project types and clients.' },
      { id: 'other', title: 'Other', line: 'Describe your studio.' },
    ],
  },
  {
    id: 'voice',
    ask: 'How would you like your studio to come across when you share your work?',
    hint: 'Choose up to two.',
    max: 2,
    otherField: 'Describe your voice…',
    otherAlone: true,
    options: [
      { id: 'professional', title: 'Professional & knowledgeable', line: 'Explain design decisions with confidence and expertise.' },
      { id: 'warm', title: 'Warm & approachable', line: 'Friendly, natural language that feels personal.' },
      { id: 'refined', title: 'Refined & aspirational', line: 'Elegant, considered language emphasizing design quality.' },
      { id: 'educational', title: 'Educational & practical', line: 'Clear explanations, useful advice, and practical details.' },
      { id: 'creative', title: 'Creative & expressive', line: 'Distinctive personality, ideas, and creative storytelling.' },
      { id: 'other', title: 'Other', line: 'Describe your own voice.' },
    ],
  },
  {
    id: 'value',
    ask: 'What do clients value most about working with your studio?',
    hint: 'Choose up to two.',
    max: 2,
    otherField: 'What makes you different?',
    otherAlone: true,
    options: [
      { id: 'vision', title: 'Creative vision', line: 'Distinctive design ideas and aesthetic direction.' },
      { id: 'technical', title: 'Technical expertise', line: 'Practical solutions, construction knowledge, and attention to detail.' },
      { id: 'service', title: 'Personalized service', line: 'Understanding clients and adapting designs to their needs.' },
      { id: 'management', title: 'Project management', line: 'Coordinating the process and making projects easier for clients.' },
      { id: 'materials', title: 'Materials & craftsmanship', line: 'Quality, custom solutions, and thoughtful material choices.' },
      { id: 'sustainability', title: 'Sustainability & functionality', line: 'Responsible design, comfort, and long-term value.' },
      { id: 'other', title: 'Other', line: 'Describe what makes your studio different.' },
    ],
  },
];

export const questionById = (id) => QUESTIONS.find((q) => q.id === id) || null;

/* ── THE PROFILE ─────────────────────────────────────────────────────────────── */
const NOT_A_PROFILE = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts', 'direct']);

/* a profile address or a handle, as the handle, or null. Null for a sentence, an email address, and
   any other site: asked to read something, it must be sure which account it is being asked about */
export function instagramHandle(text) {
  const said = String(text || '').trim();
  if (!said || /\s/.test(said)) return null;
  const inUrl = said.match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!inUrl && /[/:]/.test(said)) return null;
  const handle = (inUrl ? inUrl[1] : said.replace(/^@/, '')).toLowerCase();
  if (NOT_A_PROFILE.has(handle) || /\.(com|net|org|io|es|co|app)$/.test(handle)) return null;
  return /^[a-z0-9._]{1,30}$/.test(handle) && !handle.includes('..') && !handle.startsWith('.') && !handle.endsWith('.')
    ? handle
    : null;
}

/* typed instead of pressing `No, for now`, which would otherwise be read as a handle */
export const saysNo = (text) => /^(no|nope|none|skip|later|not now|no thanks|no thank you)[.!]?$/i.test(String(text || '').trim());

/* the next question still to ask, or null */
export function nextQuestion(answers) {
  return QUESTIONS.find((q) => !answers[q.id]) || null;
}

/* what the studio's own turn says after answering */
export function answerSay(q, picked, other) {
  const titles = picked.map((id) => q.options.find((o) => o.id === id)?.title).filter(Boolean);
  return [...titles, other].filter(Boolean).join(', ');
}

