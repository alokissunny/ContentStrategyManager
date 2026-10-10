/*
 * Brand Voice — read the account's last 10 Instagram posts as whole posts
 * (caption + every carousel slide + frames sampled across each reel) and describe how it actually
 * communicates: tone, writing style, vocabulary, positioning, content themes,
 * how decisions get explained, and what the posts look like. Stored on the report as `brandVoice`
 * and folded into Business memory (compileBrandMemory → voiceProfile).
 *
 * Source: Meta Graph when the handle is connected; Apify otherwise (or when
 * Graph fails). Model: OpenAI by default; Settings › Brand voice model can
 * switch it to Claude (runtime setting brandVoice.provider).
 *
 * Instagram media URLs expire, so every image read (slides, reel frames) is
 * shrunk and stored in S3 (post.frameKeys) when first seen; reused posts later
 * in the month read those back instead of re-downloading.
 */

const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');

const { completeText } = require('./llmComplete');
const { brandVoiceLlm } = require('./runtimeSettings');
const { fetchViaGraph, fetchGraphMediaItems } = require('./graphInstagram');
const { scrapePosts } = require('./instagramScraper');
const InstagramProfile = require('../models/InstagramProfile');
const { isS3Configured, uploadBytes, getObjectBytes } = require('./s3Client');

const POST_LIMIT = 10;
const MAX_CAPTION = 2200;
// Whole-post reading: every carousel slide, several frames of a reel.
const MEDIA_VERSION = 2;
const IMAGE_EDGE = 640;
const IMAGE_FETCH_MS = 15000;
const VIDEO_FETCH_MS = 60000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_SLIDES_PER_POST = Number(process.env.BRAND_VOICE_MAX_SLIDES) || 10;
const REEL_FRAMES = Number(process.env.BRAND_VOICE_REEL_FRAMES) || 4;
const MAX_IMAGES = Number(process.env.BRAND_VOICE_MAX_IMAGES) || 60;
const MEDIA_CONCURRENCY = 3;
const execFileP = promisify(execFile);

const VOICE_KEYS = [
  'tone',
  'writingStyle',
  'vocabulary',
  'positioning',
  'contentThemes',
  'communicationPatterns',
  'visualStyle',
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

/** Plain copy of a post with only the fields we store in the snapshot. */
function plainPost(p) {
  return {
    externalId: String(p.externalId || ''),
    caption: p.caption || '',
    likesCount: Number(p.likesCount) || 0,
    commentsCount: Number(p.commentsCount) || 0,
    timestamp: p.timestamp || null,
    type: p.type || 'post',
    url: p.url || '',
    displayUrl: p.displayUrl || '',
    mediaItems: Array.isArray(p.mediaItems) ? p.mediaItems : [],
    // S3 copies of every image the model read for this post, in order.
    frameKeys: Array.isArray(p.frameKeys) ? p.frameKeys : [],
    frameLabels: Array.isArray(p.frameLabels) ? p.frameLabels : [],
    mediaVersion: Number(p.mediaVersion) || 0,
  };
}

function frameKeyOf(username, post, n) {
  const id = String(post.externalId || '').replace(/[^\w-]/g, '')
    || crypto.createHash('sha1').update(String(post.displayUrl || post.url)).digest('hex').slice(0, 16);
  return `brand-voice/${username}/${id}/${String(n).padStart(2, '0')}.jpg`;
}

async function download(url, maxBytes = MAX_VIDEO_BYTES, timeoutMs = IMAGE_FETCH_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length')) || 0;
    if (len > maxBytes) throw new Error(`too large (${len} bytes)`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`too large (${buf.length} bytes)`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

function shrink(buffer) {
  return sharp(buffer)
    .rotate()
    .resize(IMAGE_EDGE, IMAGE_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 76 })
    .toBuffer();
}

function ffmpegBin() {
  return process.env.FFMPEG_PATH || require('ffmpeg-static');
}

/** Video length in seconds from ffmpeg's banner (no ffprobe in ffmpeg-static). */
async function videoDuration(file) {
  try {
    await execFileP(ffmpegBin(), ['-hide_banner', '-i', file], { timeout: 20000 });
  } catch (err) {
    const m = String(err.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return 0;
}

/** `count` frames spread across the video (middle of equal segments). */
async function videoFrames(url, count) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bv-'));
  try {
    const file = path.join(dir, 'v.mp4');
    await fs.writeFile(file, await download(url, MAX_VIDEO_BYTES, VIDEO_FETCH_MS));
    const duration = await videoDuration(file);
    const times = duration > 0
      ? Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count)
      : [0.5];
    const frames = [];
    for (const [i, t] of times.entries()) {
      const out = path.join(dir, `f${i}.jpg`);
      try {
        await execFileP(ffmpegBin(), [
          '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
          '-ss', t.toFixed(2), '-i', file, '-frames:v', '1',
          '-vf', `scale=${IMAGE_EDGE}:-2`, out,
        ], { timeout: 30000 });
        frames.push({ buffer: await shrink(await fs.readFile(out)), at: t });
      } catch (err) {
        console.warn(`[brandVoice] frame at ${t.toFixed(1)}s failed:`, err.message);
      }
    }
    return { frames, duration };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Fill in each post's slides (mediaItems). Apify returns them with the scrape;
 * Graph needs one details call per post. Falls back to the cover image.
 */
async function resolveMediaItems(userId, username, posts) {
  const missing = posts.filter((p) => !p.mediaItems.length && p.externalId);
  if (missing.length) {
    try {
      const byId = await fetchGraphMediaItems(userId, username, missing.map((p) => p.externalId));
      if (byId) missing.forEach((p) => { if (byId[p.externalId]?.length) p.mediaItems = byId[p.externalId]; });
    } catch (err) {
      console.warn('[brandVoice] Graph media details failed:', err.message);
    }
  }
  posts.forEach((p) => {
    if (!p.mediaItems.length && p.displayUrl) {
      p.mediaItems = [{ type: 'image', imageUrl: p.displayUrl, videoUrl: '' }];
    }
  });
  return posts;
}

/** Every slide of a carousel; several frames of a reel; the image of a single post. */
async function readPostMedia(username, post, canStore) {
  if (post.mediaVersion === MEDIA_VERSION && post.frameKeys.length && canStore) {
    try {
      const frames = await Promise.all(post.frameKeys.map(async (key, i) => ({
        buffer: (await getObjectBytes(key)).buffer,
        label: post.frameLabels[i] || `image ${i + 1}`,
      })));
      return { post, frames };
    } catch (err) {
      console.warn(`[brandVoice] stored media for ${post.externalId} unreadable — re-reading:`, err.message);
    }
  }

  const items = post.mediaItems.slice(0, MAX_SLIDES_PER_POST);
  const single = items.length === 1;
  const frames = [];
  for (const [i, item] of items.entries()) {
    const slide = single ? '' : `slide ${i + 1}/${post.mediaItems.length}`;
    if (item.type === 'video' && item.videoUrl) {
      try {
        const { frames: vf, duration } = await videoFrames(item.videoUrl, single ? REEL_FRAMES : 1);
        vf.forEach((f) => frames.push({
          buffer: f.buffer,
          label: [slide || 'reel', `frame at ${Math.round(f.at)}s of ${Math.round(duration)}s`].join(' · '),
        }));
        if (vf.length) continue;
      } catch (err) {
        console.warn(`[brandVoice] video for ${post.externalId || '?'} unavailable:`, err.message);
      }
    }
    if (!item.imageUrl) continue;
    try {
      frames.push({
        buffer: await shrink(await download(item.imageUrl, MAX_IMAGE_BYTES)),
        label: slide || (item.type === 'video' ? 'video cover' : 'image'),
      });
    } catch (err) {
      console.warn(`[brandVoice] image for ${post.externalId || '?'} unavailable:`, err.message);
    }
  }

  const next = { ...post, mediaVersion: MEDIA_VERSION, frameKeys: [], frameLabels: frames.map((f) => f.label) };
  if (canStore && frames.length) {
    try {
      next.frameKeys = await Promise.all(frames.map((f, i) => uploadBytes(frameKeyOf(username, post, i + 1), f.buffer, 'image/jpeg')));
    } catch (err) {
      console.warn('[brandVoice] media store failed:', err.message);
      next.frameKeys = [];
    }
  }
  return { post: next, frames };
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}

/**
 * Images for the vision model: whole posts, newest first, capped at
 * MAX_IMAGES overall. Each post records which image numbers are its own.
 */
async function preparePostMedia(userId, username, posts) {
  const canStore = isS3Configured();
  await resolveMediaItems(userId, username, posts);
  const results = await mapLimit(posts, MEDIA_CONCURRENCY, (p) => readPostMedia(username, p, canStore));

  const images = [];
  const withMedia = results.map(({ post, frames }) => {
    const room = Math.max(0, MAX_IMAGES - images.length);
    const used = frames.slice(0, room);
    const first = images.length + 1;
    used.forEach((f) => images.push({ mediaType: 'image/jpeg', data: f.buffer.toString('base64') }));
    return {
      ...post,
      promptMedia: used.length
        ? used.map((f, i) => `image ${first + i}: ${f.label}`)
        : [],
      mediaSkipped: frames.length - used.length,
    };
  });
  return { posts: withMedia, images };
}

function postsForPrompt(posts) {
  return posts.map((p, i) => ({
    n: i + 1,
    media: p.promptMedia?.length ? p.promptMedia : 'no images could be read',
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

function buildPrompt({ username, posts, currentFields, withImages }) {
  const evidence = withImages ? 'captions and images' : 'captions';
  return [
    `You read the last ${posts.length} Instagram posts of @${username} and describe how this account communicates.`,
    withImages
      ? 'Each post is given whole: its caption plus its images — every slide of a carousel in order, and frames sampled across each reel (with timestamps). The attached images are numbered in order; each post\'s `media` list says which image numbers are its own and what each one is. Read each post as a sequence: how the first slide hooks, how the story or explanation unfolds across slides/frames, and how it ends (CTA, result, reveal). Use what is IN the pictures (projects, rooms, materials, people, before/after, process shots, text on slides, graphics) as well as the words.'
      : 'Only captions are available (no images could be read).',
    `Base every claim on the ${evidence}. Do not invent. When the evidence is thin, say so in the summary.`,
    '',
    'Return ONLY a JSON object, no markdown fences, with exactly these keys. Each value is',
    `{ "labels": [1–4 short lowercase labels], "summary": "1–2 sentences citing what in the ${evidence} shows it" }.`,
    '',
    '- tone: e.g. professional, friendly, educational, personal, playful, authoritative.',
    '- writingStyle: e.g. short, detailed, storytelling, list-based, Q&A. Mention typical caption length and structure (hooks, line breaks, emojis, hashtags, CTAs).',
    '- vocabulary: e.g. technical, conversational, emotional, trade jargon. Quote 2–3 characteristic words or phrases.',
    '- positioning: e.g. luxury, practical, sustainable, affordable, bespoke. ONLY labels the captions explicitly support; otherwise labels [] and summary "Not stated in recent posts."',
    '- contentThemes: recurring subjects, e.g. projects, processes, materials, client problems, behind the scenes, before/after. Up to 6 labels. Use what the images show, not only the captions.',
    '- communicationPatterns: how they explain their decisions and reasoning (e.g. problem → solution, why a material was chosen, budget trade-offs, client brief → outcome) — in words and visually (annotated slides, side-by-side comparisons).',
    withImages
      ? '- visualStyle: what the posts look like — shot types (wide room, detail, flat lay, people, renders), colour and light, text-on-image vs clean photos, format mix (carousel / reel / single), how carousels are sequenced (cover → body → closing slide) and how reels are paced, recurring layouts such as before/after. Name the posts that show it.'
      : '- visualStyle: labels [] and summary "No images could be read."',
    '',
    `Existing Business memory, for context only (do not copy it as evidence): ${JSON.stringify(currentFields || {})}`,
    '',
    `Posts (newest first): ${JSON.stringify(postsForPrompt(posts))}`,
  ].join('\n');
}

function usageOf(model, usage) {
  const inputTokens = Number(usage?.input_tokens) || 0;
  const outputTokens = Number(usage?.output_tokens) || 0;
  // lazy: weeklyPlan → planContext → brandVoice would otherwise be circular
  const { estimatePlanCostUsd } = require('./weeklyPlan');
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimatePlanCostUsd(model, inputTokens, outputTokens, Number(usage?.cached_tokens) || 0),
  };
}

/** `debug` (array or null) collects one row per model call for the AI debug panel. */
async function analyzeBrandVoice({ username, posts, images, currentFields, debug = null }) {
  const { model } = brandVoiceLlm();
  const hasCaption = posts.some((p) => String(p.caption || '').trim());
  if (!hasCaption && !images.length) {
    throw new Error('Those posts have no captions or images to read a voice from.');
  }

  const call = async (withImages, note = '') => {
    const prompt = buildPrompt({ username, posts, currentFields, withImages });
    const started = Date.now();
    const imageNote = withImages ? `${images.length} image${images.length === 1 ? '' : 's'} attached` : 'captions only';
    try {
      const res = await completeText({
        model,
        prompt,
        images: withImages ? images : undefined,
        maxTokens: 4096,
        reasoningEffort: 'low',
        timeoutMs: 180000,
      });
      const usage = usageOf(res.model || model, res.usage);
      console.log(
        `[brandVoice] @${username} ${res.model || model} · ${imageNote} · ${usage.inputTokens}+${usage.outputTokens} tok` +
          ` · ~$${usage.estimatedCostUsd.toFixed(4)} · ${Date.now() - started}ms`,
      );
      debug?.push({
        source: 'Brand voice · analysis',
        model: res.model || model,
        prompt,
        output: res.text,
        elapsedMs: Date.now() - started,
        usage,
        note: [imageNote, note, res.stopReason === 'max_tokens' ? 'hit max tokens' : ''].filter(Boolean).join(' · '),
      });
      return res.text;
    } catch (err) {
      debug?.push({
        source: 'Brand voice · analysis',
        model,
        prompt,
        output: `Error — ${err.message}`,
        elapsedMs: Date.now() - started,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
        note: [imageNote, note, 'failed'].filter(Boolean).join(' · '),
      });
      throw err;
    }
  };

  let text;
  let imagesAnalyzed = images.length;
  try {
    text = await call(images.length > 0);
  } catch (err) {
    if (!images.length || !hasCaption) throw err;
    // A model/provider that rejects images still gets a caption-only read.
    console.warn(`[brandVoice] ${model} failed with images — retrying captions only:`, err.message);
    imagesAnalyzed = 0;
    text = await call(false, 'retry after the image call failed');
  }

  const jsonMatch = String(text || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not read a brand voice from those posts.');
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Could not read a brand voice from those posts.');
  }
  return { voice: sanitizeVoice(parsed), model, imagesAnalyzed };
}

/**
 * Posts fetched this month are reused — Instagram (Graph/Apify) is only hit
 * when nothing from this calendar month is stored. Returns
 * { brandVoice, postsSnapshot } — the snapshot is stored on the report so the
 * next fetch this month can reuse it.
 */
async function buildBrandVoice({ userId, username, currentFields, snapshot, debug = null }) {
  const fetchStarted = Date.now();
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
  const prepared = await preparePostMedia(userId, username, posts.map(plainPost));
  const sourceName = { graph: 'Meta Graph', apify: 'Apify' }[source] || source || 'stored';
  const skipped = prepared.posts.reduce((n, p) => n + (p.mediaSkipped || 0), 0);
  debug?.push({
    source: 'Brand voice · posts',
    model: cached ? `reused (${sourceName})` : sourceName,
    prompt: '',
    output: JSON.stringify(prepared.posts.map((p, i) => ({
      n: i + 1,
      type: p.type,
      url: p.url,
      media: p.promptMedia?.length ? p.promptMedia : 'none',
    })), null, 2),
    elapsedMs: Date.now() - fetchStarted,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    note: [
      `${posts.length} posts`,
      cached ? `reused — fetched ${postsFetchedAt.toISOString().slice(0, 10)}` : `fetched now via ${sourceName}${source === 'apify' ? ' (Apify run cost not included)' : ''}`,
      `${prepared.images.length} images prepared`,
      skipped ? `${skipped} over the image cap` : '',
      'no AI call',
    ].filter(Boolean).join(' · '),
  });
  const { voice, model, imagesAnalyzed } = await analyzeBrandVoice({
    username,
    posts: prepared.posts,
    images: prepared.images,
    currentFields,
    debug,
  });
  // Snapshot keeps frameKeys so later reuse this month needs no Instagram call.
  const snapshotPosts = prepared.posts.map(plainPost);
  return {
    brandVoice: {
      ...voice,
      source,
      postsAnalyzed: posts.length,
      imagesAnalyzed,
      postsFetchedAt,
      postsReused: Boolean(cached),
      model,
      fetchedAt: new Date(),
    },
    postsSnapshot: { fetchedAt: postsFetchedAt, source, posts: snapshotPosts },
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
