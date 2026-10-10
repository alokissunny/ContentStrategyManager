/*
 * Brand Voice — read the account's last 10 Instagram posts and describe how it
 * actually communicates: tone, writing style, vocabulary, positioning, content
 * themes and how decisions get explained. Stored on the report as `brandVoice`
 * and folded into Business memory (compileBrandMemory → voiceProfile).
 *
 * Source: Meta Graph when the handle is connected; Apify otherwise (or when
 * Graph fails). Model: OpenAI by default; Settings › Brand voice model can
 * switch it to Claude (runtime setting brandVoice.provider).
 */

const { completeText } = require('./llmComplete');
const { brandVoiceLlm } = require('./runtimeSettings');
const { fetchViaGraph } = require('./graphInstagram');
const { scrapePosts } = require('./instagramScraper');
const InstagramProfile = require('../models/InstagramProfile');

const POST_LIMIT = 10;
const MAX_CAPTION = 2200;

const VOICE_KEYS = [
  'tone',
  'writingStyle',
  'vocabulary',
  'positioning',
  'contentThemes',
  'communicationPatterns',
];

function sameMonth(a, b = new Date()) {
  if (!a) return false;
  const d = new Date(a);
  return !Number.isNaN(d.getTime())
    && d.getFullYear() === b.getFullYear()
    && d.getMonth() === b.getMonth();
}

/**
 * Posts already fetched this calendar month — the report's own snapshot from
 * a previous Fetch brand voice, else the handle's stored profile posts. Null
 * when neither is from this month (→ fetch from Instagram).
 */
async function cachedPostsThisMonth(userId, username, snapshot, limit = POST_LIMIT) {
  if (snapshot && sameMonth(snapshot.fetchedAt) && Array.isArray(snapshot.posts) && snapshot.posts.length) {
    return {
      posts: newestFirst(snapshot.posts).slice(0, limit),
      source: snapshot.source || '',
      fetchedAt: snapshot.fetchedAt,
    };
  }
  const profile = await InstagramProfile.findOne({ user: userId, username })
    .select('posts fetchedAt dataSource')
    .lean();
  if (profile && sameMonth(profile.fetchedAt) && Array.isArray(profile.posts) && profile.posts.length) {
    return {
      posts: newestFirst(profile.posts).slice(0, limit),
      source: profile.dataSource || '',
      fetchedAt: profile.fetchedAt,
    };
  }
  return null;
}

/** Last N posts, newest first, with the source that served them. */
async function fetchRecentPosts(userId, username, limit = POST_LIMIT) {
  try {
    const graph = await fetchViaGraph(userId, username);
    if (graph && Array.isArray(graph.posts)) {
      return { posts: newestFirst(graph.posts).slice(0, limit), source: 'graph' };
    }
  } catch (err) {
    console.warn(`[brandVoice] Graph fetch failed for @${username}, falling back to Apify:`, err.message);
  }
  const posts = await scrapePosts(username, limit);
  return { posts: newestFirst(posts).slice(0, limit), source: 'apify' };
}

function newestFirst(posts) {
  return [...(posts || [])].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });
}

function postsForPrompt(posts) {
  return posts.map((p, i) => ({
    n: i + 1,
    type: p.type || 'post',
    date: p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 10) : '',
    likes: Number(p.likesCount) || 0,
    comments: Number(p.commentsCount) || 0,
    caption: String(p.caption || '').slice(0, MAX_CAPTION),
  }));
}

function cleanList(value, max = 6) {
  const arr = Array.isArray(value) ? value : String(value || '').split(/[,;\n]+/);
  return arr
    .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, max);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** { labels: string[], summary: string } per axis; contentThemes is labels only. */
function sanitizeVoice(raw) {
  const out = {};
  for (const key of VOICE_KEYS) {
    const v = raw && typeof raw === 'object' ? raw[key] : null;
    out[key] = {
      labels: cleanList(v?.labels),
      summary: cleanText(v?.summary),
    };
  }
  return out;
}

async function analyzeBrandVoice({ username, posts, currentFields }) {
  const { model } = brandVoiceLlm();
  const withCaptions = posts.filter((p) => String(p.caption || '').trim());
  if (!withCaptions.length) {
    throw new Error('Those posts have no captions to read a voice from.');
  }

  const prompt = [
    `You read the last ${posts.length} Instagram posts of @${username} and describe how this account communicates.`,
    'Base every claim on the captions below. Do not invent. When the evidence is thin, say so in the summary.',
    '',
    'Return ONLY a JSON object, no markdown fences, with exactly these keys. Each value is',
    '{ "labels": [1–4 short lowercase labels], "summary": "1–2 sentences citing what in the captions shows it" }.',
    '',
    '- tone: e.g. professional, friendly, educational, personal, playful, authoritative.',
    '- writingStyle: e.g. short, detailed, storytelling, list-based, Q&A. Mention typical caption length and structure (hooks, line breaks, emojis, hashtags, CTAs).',
    '- vocabulary: e.g. technical, conversational, emotional, trade jargon. Quote 2–3 characteristic words or phrases.',
    '- positioning: e.g. luxury, practical, sustainable, affordable, bespoke. ONLY labels the captions explicitly support; otherwise labels [] and summary "Not stated in recent posts."',
    '- contentThemes: recurring subjects, e.g. projects, processes, materials, client problems, behind the scenes, before/after. Up to 6 labels.',
    '- communicationPatterns: how they explain their decisions and reasoning (e.g. problem → solution, why a material was chosen, budget trade-offs, client brief → outcome).',
    '',
    `Existing Business memory, for context only (do not copy it as evidence): ${JSON.stringify(currentFields || {})}`,
    '',
    `Posts (newest first): ${JSON.stringify(postsForPrompt(posts))}`,
  ].join('\n');

  const { text } = await completeText({
    model,
    prompt,
    maxTokens: 4096,
    reasoningEffort: 'low',
    timeoutMs: 120000,
  });

  const jsonMatch = String(text || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not read a brand voice from those posts.');
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Could not read a brand voice from those posts.');
  }
  return { voice: sanitizeVoice(parsed), model };
}

/** Fetch posts + analyze. Returns the object stored as report.brandVoice. */
/**
 * Posts fetched this month are reused — Instagram (Graph/Apify) is only hit
 * when nothing from this calendar month is stored. Returns
 * { brandVoice, postsSnapshot } — the snapshot is stored on the report so the
 * next fetch this month can reuse it.
 */
async function buildBrandVoice({ userId, username, currentFields, snapshot }) {
  const cached = await cachedPostsThisMonth(userId, username, snapshot);
  let posts;
  let source;
  let postsFetchedAt;
  if (cached) {
    ({ posts, source } = cached);
    postsFetchedAt = new Date(cached.fetchedAt);
    console.log(`[brandVoice] @${username}: reusing ${posts.length} posts fetched ${postsFetchedAt.toISOString()}`);
  } else {
    ({ posts, source } = await fetchRecentPosts(userId, username));
    postsFetchedAt = new Date();
  }
  if (!posts.length) {
    throw new Error(`No recent posts found for @${username}.`);
  }
  const { voice, model } = await analyzeBrandVoice({ username, posts, currentFields });
  return {
    brandVoice: {
      ...voice,
      source,
      postsAnalyzed: posts.length,
      postsFetchedAt,
      postsReused: Boolean(cached),
      model,
      fetchedAt: new Date(),
    },
    postsSnapshot: { fetchedAt: postsFetchedAt, source, posts },
  };
}

function hasBrandVoice(bv) {
  return Boolean(bv && VOICE_KEYS.some((k) => bv[k]?.labels?.length || bv[k]?.summary));
}

/** Compact prompt-ready form for plan agents; null when nothing stored. */
function brandVoiceForMemory(bv) {
  if (!hasBrandVoice(bv)) return null;
  const out = {};
  for (const key of VOICE_KEYS) {
    const labels = cleanList(bv[key]?.labels);
    const summary = cleanText(bv[key]?.summary);
    if (labels.length || summary) out[key] = { labels, summary };
  }
  return out;
}

module.exports = {
  VOICE_KEYS,
  buildBrandVoice,
  hasBrandVoice,
  brandVoiceForMemory,
  sanitizeVoice,
};
