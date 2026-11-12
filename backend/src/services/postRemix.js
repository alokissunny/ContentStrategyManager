/*
 * Post remix (experimental) — the studio picks one of its last 10 Instagram
 * posts, adds something new through Capture, and the usual Strategist →
 * Carousel pipeline writes a NEW carousel that builds on it.
 *
 * The 3 posts come from the same sources Brand Voice uses (this month's cached
 * posts — Brand Voice snapshot or the analysed profile — else a fresh Graph /
 * Apify fetch). Instagram media URLs expire, so every image is stored in S3
 * once (brandVoice.preparePostMedia → frameKeys) and the list is kept on the
 * report as `remixPosts` for the rest of the calendar month.
 */

const sharp = require('sharp');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const Project = require('../models/Project');
const { cachedPostsThisMonth, fetchRecentPosts, plainPost, preparePostMedia, download } = require('./brandVoice');
const { fetchGraphMediaItems } = require('./graphInstagram');
const { isS3Configured, getPresignedMediaUrl, getObjectBytes, uploadBytes } = require('./s3Client');

const REMIX_LIMIT = 10;
const MAX_CAPTION = 2200;

function sameMonth(a, b = new Date()) {
  if (!a) return false;
  const d = new Date(a);
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === b.getUTCFullYear() && d.getUTCMonth() === b.getUTCMonth();
}

function reportFor(userId, username) {
  return BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({ createdAt: -1 });
}

function postIdOf(p) {
  return String(p?.externalId || p?.url || '').trim();
}

/** The last 10 posts with stored images, newest first. `refresh` skips the month cache. */
async function loadRemixPosts(userId, username, { refresh = false } = {}) {
  const report = await reportFor(userId, username);
  const stored = report?.remixPosts;
  // a list stored under a smaller limit (the first version kept 3) is read again
  if (!refresh && stored && sameMonth(stored.fetchedAt) && Array.isArray(stored.posts) && stored.posts.length
    && Number(stored.limit) >= REMIX_LIMIT) {
    return { posts: stored.posts, source: stored.source || '', fetchedAt: stored.fetchedAt };
  }

  let found = refresh ? null : await cachedPostsThisMonth(userId, username, report?.brandVoicePosts, REMIX_LIMIT);
  if (!found || !found.posts?.length) {
    const fresh = await fetchRecentPosts(userId, username, REMIX_LIMIT);
    found = { ...fresh, fetchedAt: new Date() };
  }
  const plain = (found.posts || []).slice(0, REMIX_LIMIT).map(plainPost);
  if (!plain.length) return { posts: [], source: found.source || '', fetchedAt: found.fetchedAt || null };

  // reads every slide / reel frame and stores it in S3 (frameKeys) — reused
  // when the post already carries this month's keys
  const prepared = await preparePostMedia(userId, username, plain);
  const posts = prepared.posts.map(plainPost);
  const snapshot = { fetchedAt: found.fetchedAt || new Date(), source: found.source || '', limit: REMIX_LIMIT, posts };
  if (report) {
    report.remixPosts = snapshot;
    report.markModified('remixPosts');
    await report.save().catch((e) => console.warn('[postRemix] could not store remix posts:', e.message));
  }
  return snapshot;
}

/** Client shape: what a card shows. Images are signed S3 URLs. */
async function remixPostsForClient(snapshot) {
  const canSign = isS3Configured();
  return Promise.all((snapshot.posts || []).map(async (p) => {
    let images = [];
    if (canSign && p.frameKeys?.length) {
      images = await Promise.all(p.frameKeys.map((k) => getPresignedMediaUrl(k).catch(() => '')));
    }
    images = images.filter(Boolean);
    if (!images.length && p.displayUrl) images = [p.displayUrl];
    return {
      id: postIdOf(p),
      type: p.type || 'post',
      caption: String(p.caption || '').slice(0, MAX_CAPTION),
      timestamp: p.timestamp || null,
      likes: Number(p.likesCount) || 0,
      comments: Number(p.commentsCount) || 0,
      url: p.url || '',
      images,
      imageLabels: p.frameLabels || [],
    };
  }));
}

/** The stored post the studio picked, as the plan's reference — null if it is not in the stored list. */
async function referencePostFor(userId, username, postId) {
  const id = String(postId || '').trim();
  if (!id) return null;
  const report = await reportFor(userId, username).select('remixPosts').lean();
  const post = (report?.remixPosts?.posts || []).find((p) => postIdOf(p) === id);
  if (!post) return null;
  return {
    id,
    type: post.type || 'post',
    date: post.timestamp ? new Date(post.timestamp).toISOString().slice(0, 10) : '',
    likes: Number(post.likesCount) || 0,
    comments: Number(post.commentsCount) || 0,
    url: post.url || '',
    caption: String(post.caption || '').slice(0, MAX_CAPTION),
    frameKeys: post.frameKeys || [],
    frameLabels: post.frameLabels || [],
    // for attachReferenceMedia (dropped from the brief by referenceSummary)
    externalId: String(post.externalId || ''),
    mediaItems: Array.isArray(post.mediaItems) ? post.mediaItems : [],
    allFrameKeys: post.frameKeys || [],
  };
}

// ── the post's own media → the remix capture's attachments ─────────────────
// The new carousel is built from the chosen post's real photos / video: they
// are copied into the capture (projects/<userId>/…) so the normal pipeline
// reads them — image vision, video stills + transcript, carousel photos.

const MAX_MEDIA_ITEMS = 10;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_CLIP_BYTES = 80 * 1024 * 1024;
const CLIP_FETCH_MS = 60000;
const PHOTO_FETCH_MS = 20000;

function safeId(id) {
  return String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'post';
}

async function asJpeg(buffer) {
  return sharp(buffer).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

/** Fresh media URLs (Graph) when possible — stored Instagram URLs expire. */
async function freshMediaItems(userId, username, ref) {
  if (ref.externalId) {
    try {
      const byId = await fetchGraphMediaItems(userId, username, [ref.externalId]);
      if (byId?.[ref.externalId]?.length) return byId[ref.externalId];
    } catch (err) {
      console.warn('[postRemix] Graph media details failed:', err.message);
    }
  }
  return ref.mediaItems || [];
}

/**
 * Copy the reference post's slides (full size) and reel video into the capture.
 * Falls back to the stored 640px frames when Instagram's URLs no longer load.
 * Idempotent: a capture that already holds this post's media is left alone.
 * → { images, videos } added
 */
async function attachReferenceMedia(userId, username, captureId, ref, maxItems = MAX_MEDIA_ITEMS) {
  if (!ref || !captureId || !isS3Configured()) return { images: 0, videos: 0 };
  const project = await Project.findOne({ user: userId, 'captures._id': captureId });
  const capture = project?.captures.id(captureId);
  if (!capture) return { images: 0, videos: 0 };
  const prefix = `projects/${userId}/remix-${safeId(ref.externalId || ref.id)}-`;
  if ((capture.attachments || []).some((a) => String(a.key || '').startsWith(prefix))) {
    return { images: 0, videos: 0, reused: true };
  }

  const items = (await freshMediaItems(userId, username, ref)).slice(0, maxItems);
  const added = [];
  for (const [i, item] of items.entries()) {
    const n = String(i + 1).padStart(2, '0');
    if (item.type === 'video' && item.videoUrl) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const buf = await download(item.videoUrl, MAX_CLIP_BYTES, CLIP_FETCH_MS);
        // eslint-disable-next-line no-await-in-loop
        const key = await uploadBytes(`${prefix}${n}.mp4`, buf, 'video/mp4');
        added.push({ type: 'video', key });
        continue;
      } catch (err) {
        console.warn(`[postRemix] video ${i + 1} of ${ref.id} unavailable — using its cover:`, err.message);
      }
    }
    if (!item.imageUrl) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const buf = await asJpeg(await download(item.imageUrl, MAX_PHOTO_BYTES, PHOTO_FETCH_MS));
      // eslint-disable-next-line no-await-in-loop
      const key = await uploadBytes(`${prefix}${n}.jpg`, buf, 'image/jpeg');
      added.push({ type: 'image', key });
    } catch (err) {
      console.warn(`[postRemix] image ${i + 1} of ${ref.id} unavailable:`, err.message);
    }
  }

  // nothing loaded from Instagram: the frames stored when the list was read
  if (!added.length) {
    for (const [i, frameKey] of (ref.allFrameKeys || []).slice(0, maxItems).entries()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { buffer } = await getObjectBytes(frameKey);
        // eslint-disable-next-line no-await-in-loop
        const key = await uploadBytes(`${prefix}f${String(i + 1).padStart(2, '0')}.jpg`, buffer, 'image/jpeg');
        added.push({ type: 'image', key });
      } catch (err) {
        console.warn(`[postRemix] stored frame ${frameKey} unreadable:`, err.message);
      }
    }
  }
  if (!added.length) return { images: 0, videos: 0 };

  // re-read so edits made meanwhile are kept
  const latest = await Project.findOne({ user: userId, 'captures._id': captureId });
  const cap = latest?.captures.id(captureId);
  if (!cap) return { images: 0, videos: 0 };
  added.forEach((a) => cap.attachments.push(a));
  latest.markModified('captures');
  await latest.save();
  const counts = {
    images: added.filter((a) => a.type === 'image').length,
    videos: added.filter((a) => a.type === 'video').length,
  };
  console.log(`[postRemix] capture ${captureId}: attached ${counts.images} image(s), ${counts.videos} video(s) from post ${ref.id}`);
  return counts;
}

// ── prompt blocks ──────────────────────────────────────────────────────────
// Everything below takes the LIST of reference posts the studio picked (one or
// several). With several, the new carousel combines them into one story.

const MAX_REFERENCE_POSTS = 5;
// images of the picked posts shown to the Strategist, across all of them
const MAX_STRATEGIST_IMAGES = Number(process.env.REMIX_STRATEGIST_IMAGES) || 12;

const listOf = (refs) => (Array.isArray(refs) ? refs : (refs ? [refs] : [])).filter(Boolean);

function referenceFacts(refs, imageLabels) {
  return JSON.stringify(listOf(refs).map((ref, i) => ({
    post: i + 1,
    type: ref.type,
    publishedOn: ref.date,
    likes: ref.likes,
    comments: ref.comments,
    caption: ref.caption,
    ...(imageLabels ? { images: imageLabels[i] || [] } : {}),
  })), null, 2);
}

/** Appended to the Strategist's user message. `imageLabels[i]` = labels of post i's attached images. */
function strategistReferenceBlock(refs, imageLabels = null) {
  const list = listOf(refs);
  if (!list.length) return '';
  const many = list.length > 1;
  return [
    '---',
    many
      ? `REFERENCE POSTS (Post remix). The studio picked these ${list.length} posts they already published on Instagram and added the capture above as new content for them.`
      : 'REFERENCE POST (Post remix). The studio picked this post they already published on Instagram and added the capture above as new content for it.',
    many
      ? 'Write the brief for ONE new carousel that brings these posts together — a round-up, a comparison, a common thread, a before/after or the next chapter — using the new capture as the guide to what this post is about.'
      : 'Write the brief for a NEW carousel that builds on this post: a follow-up, a deeper take, a sequel or the next chapter, using the new capture as the main material.',
    `- Keep what worked: the subject${many ? 's' : ''} the audience already responded to, the voice and the promise of the original${many ? 's' : ''}.`,
    '- Do not repeat: a new hook, a new angle, new evidence from the capture. Never copy a caption or slide copy word for word.',
    `- Facts about the studio's work come only from the capture and the reference post${many ? 's' : ''} — do not invent.`,
    `- The capture now holds ${many ? 'these posts\'' : 'this post\'s'} own photos / video (and video stills) as its assets: build the new carousel from them together with anything new the studio added${many ? ', drawing on every picked post where the story allows' : ''}. The attached images are the same post${many ? 's\'' : '\'s'} slides/frames, shown so you can see ${many ? 'them' : 'it'} as published.`,
    referenceFacts(list, imageLabels),
  ].join('\n');
}

/** Appended to the Carousel agent's user message. */
function carouselReferenceBlock(refs) {
  const list = listOf(refs);
  if (!list.length) return '';
  const many = list.length > 1;
  return [
    '---',
    many
      ? `REFERENCE POSTS (Post remix). This carousel brings together ${list.length} posts the studio already published (below) into one new story. A reader who saw them should recognise them, but write a new hook and new slides from this strategy, and use photos from across the posts. Never copy a caption or slide copy word for word.`
      : 'REFERENCE POST (Post remix). This carousel follows up a post the studio already published (below). Make the continuity readable — the reader who saw the original should recognise the thread — but write a new hook and new slides from this strategy. Never copy the original\'s caption or slide copy word for word.',
    JSON.stringify(list.map((ref) => ({ type: ref.type, publishedOn: ref.date, caption: ref.caption })), null, 2),
  ].join('\n');
}

/**
 * The picked posts' stored images, in the vision shape callAgent takes, shared
 * fairly across the posts (≤ MAX_STRATEGIST_IMAGES in all).
 * → { images, labels: [[...per post]] }
 */
async function referenceImages(refs) {
  const list = listOf(refs);
  if (!list.length || !isS3Configured()) return { images: [], labels: list.map(() => []) };
  const per = Math.max(2, Math.floor(MAX_STRATEGIST_IMAGES / list.length));
  const images = [];
  const labels = [];
  for (const [p, ref] of list.entries()) {
    const keys = (ref.frameKeys || []).slice(0, per);
    // eslint-disable-next-line no-await-in-loop
    const read = await Promise.all(keys.map(async (key, i) => {
      try {
        const { buffer } = await getObjectBytes(key);
        return { key, i, data: buffer.toString('base64') };
      } catch (err) {
        console.warn(`[postRemix] reference image ${key} unreadable:`, err.message);
        return null;
      }
    }));
    const mine = [];
    read.filter(Boolean).forEach((r) => {
      images.push({ mediaType: 'image/jpeg', data: r.data, debug: { label: `Reference post ${p + 1} image ${r.i + 1}`, key: r.key } });
      mine.push(`attached image ${images.length}: ${ref.frameLabels?.[r.i] || `image ${r.i + 1}`}`);
    });
    labels.push(mine);
  }
  return { images, labels };
}

/** The references without image keys — what travels on the brief / agentTrace. */
function referenceSummary(refs) {
  const list = listOf(refs);
  if (!list.length) return null;
  return list.map(({ frameKeys, frameLabels, externalId, mediaItems, allFrameKeys, ...rest }) => rest);
}

/** Several picked posts → their references, in the order picked. Unknown ids → null. */
async function referencePostsFor(userId, username, postIds) {
  const ids = [...new Set((postIds || []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, MAX_REFERENCE_POSTS);
  const refs = await Promise.all(ids.map((id) => referencePostFor(userId, username, id)));
  return refs.some((r) => !r) ? null : refs;
}

// several posts share one capture: each brings a fair share of its media
const MAX_TOTAL_MEDIA = 24;
async function attachReferencesMedia(userId, username, captureId, refs) {
  const list = listOf(refs);
  const per = Math.min(MAX_MEDIA_ITEMS, Math.max(3, Math.floor(MAX_TOTAL_MEDIA / Math.max(1, list.length))));
  const totals = { images: 0, videos: 0 };
  for (const ref of list) {
    // eslint-disable-next-line no-await-in-loop
    const got = await attachReferenceMedia(userId, username, captureId, ref, per);
    totals.images += got.images || 0;
    totals.videos += got.videos || 0;
  }
  return totals;
}

module.exports = {
  REMIX_LIMIT,
  loadRemixPosts,
  remixPostsForClient,
  MAX_REFERENCE_POSTS,
  referencePostFor,
  referencePostsFor,
  attachReferenceMedia,
  attachReferencesMedia,
  strategistReferenceBlock,
  carouselReferenceBlock,
  referenceImages,
  referenceSummary,
};
