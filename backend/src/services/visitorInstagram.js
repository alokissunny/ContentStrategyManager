/*
 * A landing visitor's Instagram and studio answers, carried into their new account
 * (bauhly-v3 Flow B, Nov 10).
 *
 * startVisitorRead  — the visitor types their profile in Capture: the onboarding read (public profile,
 *                     recent posts, brand analysis) starts at once, in the background, under a token.
 *                     A handle read in the last 30 days is reused rather than scraped again.
 * claimVisitorRead  — after sign-up, at `Generate your first post`: the read is attached to the account
 *                     as its Instagram profile and Business memory report (waiting for it if it is still
 *                     running), and the studio answers are written into Business memory. A visitor who
 *                     chose `No, for now`, or whose read failed, gets a profile all the same, because the
 *                     planner needs one to make a post.
 */
const crypto = require('crypto');
const VisitorInstagramRead = require('../models/VisitorInstagramRead');
const InstagramProfile = require('../models/InstagramProfile');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const { scrapeProfile, scrapePosts } = require('./instagramScraper');
const { generateBrandAnalysis, assessBrandDnaGaps, BRAND_DNA_FIELDS } = require('./brandAnalysis');
const { buildBrandVoice } = require('./brandVoice');
const { uploadMarkdown } = require('./s3Client');
const { cacheProfilePicture } = require('./profileAvatar');
const { invalidateCurrentUsername } = require('../utils/currentProfile');

const REUSE_MS = 30 * 24 * 3600 * 1000;
const CLAIM_WAIT_MS = 100 * 1000;
/* the profile a studio with no Instagram is planned under: a hyphen can never be a real handle */
const PLACEHOLDER_HANDLE = 'my-studio';
/* a background Brand Voice read older than this is taken as dead (a restart) and may start again */
const VOICE_STALE_MS = 15 * 60 * 1000;

const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
function cleanHandle(raw) {
  const h = String(raw || '').trim().replace(/^@+/, '').toLowerCase();
  return HANDLE_RE.test(h) && !h.includes('..') && !h.startsWith('.') && !h.endsWith('.') ? h : null;
}

const PROFILE_FIELDS = ['fullName', 'biography', 'followersCount', 'followingCount', 'postsCount', 'profilePicUrl', 'isVerified', 'externalUrl'];
function profileOf(scraped) {
  const out = {};
  for (const k of PROFILE_FIELDS) if (scraped?.[k] !== undefined) out[k] = scraped[k];
  return out;
}

async function runRead(id) {
  const read = await VisitorInstagramRead.findById(id);
  if (!read) return;
  try {
    const [profile, posts] = await Promise.all([scrapeProfile(read.handle), scrapePosts(read.handle)]);
    if (!profile) throw new Error('Could not read this Instagram profile. It may be private or the username may be wrong.');
    read.profile = profileOf(profile);
    read.posts = posts || [];
    try {
      read.analysis = await generateBrandAnalysis({ username: read.handle, ...read.profile, posts: read.posts });
    } catch (err) {
      // the profile and posts are still worth keeping; Business memory can be filled later
      console.error(`[visitorInstagram] brand analysis failed for @${read.handle}:`, err.message);
    }
    read.status = 'done';
  } catch (err) {
    console.error(`[visitorInstagram] read failed for @${read.handle}:`, err.message);
    read.status = 'failed';
    read.error = err.message;
  }
  read.markModified('profile');
  read.markModified('posts');
  read.markModified('analysis');
  await read.save();
  // claimed while it ran: attach it now
  // (read afresh: the claim sets claimedBy on the stored read, not on this copy)
  const now = await VisitorInstagramRead.findById(read._id).select('claimedBy attachedAt').lean();
  if (now?.claimedBy && !now.attachedAt) {
    const late = await attachRead(read, now.claimedBy).catch((err) => { console.error('[visitorInstagram] late attach failed:', err.message); return null; });
    if (late?.report) brandVoiceInBackground(now.claimedBy, late.report);
  }
}

async function startVisitorRead(rawHandle, ip = '') {
  const handle = cleanHandle(rawHandle);
  if (!handle) {
    const err = new Error('That doesn’t look like an Instagram profile.');
    err.status = 400;
    throw err;
  }
  const token = crypto.randomBytes(18).toString('hex');
  const recent = await VisitorInstagramRead.findOne({
    handle, status: 'done', createdAt: { $gt: new Date(Date.now() - REUSE_MS) },
  }).sort({ createdAt: -1 }).lean();
  if (recent) {
    await VisitorInstagramRead.create({
      token, handle, status: 'done', profile: recent.profile, posts: recent.posts, analysis: recent.analysis, ip,
    });
    return { token, handle, reused: true };
  }
  const read = await VisitorInstagramRead.create({ token, handle, ip });
  setImmediate(() => { runRead(read._id).catch((err) => console.error('[visitorInstagram] run crashed:', err.message)); });
  return { token, handle, reused: false };
}

async function reportFromAnalysis(userId, handle, analysis) {
  const markdown = analysis?.markdown || `# @${handle}\n\nRead from the landing page.`;
  const s3Key = `reports/${userId}/${handle}-${Date.now()}.md`;
  try { await uploadMarkdown(s3Key, markdown); } catch (err) { console.warn('[visitorInstagram] report upload failed:', err.message); }
  const bp = analysis?.brandProfile || {};
  const fields = {
    whatYouOffer: bp.whatYouOffer || '',
    whoYouHelp: bp.whoYouHelp || '',
    firstProblem: bp.firstProblem || '',
    position: bp.position || '',
    proof: bp.proof || '',
    howYouSound: bp.howYouSound || '',
    visualStyle: bp.visualStyle || '',
    neverDo: bp.neverDo || '',
  };
  let memoryGaps = [];
  if (analysis) {
    try { memoryGaps = await assessBrandDnaGaps(fields); } catch (err) { console.warn('[visitorInstagram] gap assessment failed:', err.message); }
  }
  return BrandAnalysisReport.create({
    user: userId,
    instagramUsername: handle,
    s3Key,
    model: analysis?.model || 'landing-capture',
    ...fields,
    memoryGaps,
    memoryGapsAssessedAt: new Date(),
  });
}

async function attachRead(read, userId) {
  const handle = read.handle;
  /* one attach per read: the finishing job and the claim can both get here */
  const mine = await VisitorInstagramRead.findOneAndUpdate(
    { _id: read._id, attachedAt: null, attaching: { $ne: true } },
    { $set: { attaching: true } },
  );
  if (!mine) {
    const until = Date.now() + 30_000;
    let now = await VisitorInstagramRead.findById(read._id).lean();
    while (now && !now.attachedAt && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      now = await VisitorInstagramRead.findById(read._id).lean();
    }
    return {
      profile: await InstagramProfile.findOne({ user: userId, username: handle }),
      report: await BrandAnalysisReport.findOne({ user: userId, instagramUsername: handle }).sort({ createdAt: -1 }),
    };
  }
  let profilePicKey = '';
  if (read.profile?.profilePicUrl) {
    try { profilePicKey = await cacheProfilePicture(userId, handle, read.profile.profilePicUrl); } catch { /* the avatar is optional */ }
  }
  const profile = await InstagramProfile.findOneAndUpdate(
    { user: userId, username: handle },
    {
      ...(read.profile || {}),
      user: userId,
      username: handle,
      posts: read.posts || [],
      dataSource: 'apify',
      insights: null,
      ...(profilePicKey ? { profilePicKey } : {}),
      fetchedAt: new Date(),
      activatedAt: new Date(),
    },
    { new: true, upsert: true }
  );
  invalidateCurrentUsername(userId);
  const existing = await BrandAnalysisReport.findOne({ user: userId, instagramUsername: handle }).sort({ createdAt: -1 });
  const report = existing || await reportFromAnalysis(userId, handle, read.status === 'done' ? read.analysis : null);
  await VisitorInstagramRead.updateOne({ _id: read._id }, { claimedBy: userId, attachedAt: new Date() });
  return { profile, report };
}

/* a profile to plan under when there is no Instagram to read (or the read failed) */
async function ensureProfile(userId, handle, fullName) {
  const any = await InstagramProfile.findOne({ user: userId }).select('_id username').lean();
  if (any && !handle) return { profile: any, report: await BrandAnalysisReport.findOne({ user: userId }).sort({ createdAt: -1 }) };
  const username = handle || PLACEHOLDER_HANDLE;
  const profile = await InstagramProfile.findOneAndUpdate(
    { user: userId, username },
    { $setOnInsert: { user: userId, username, fullName: fullName || '', posts: [], dataSource: 'apify', placeholder: !handle }, $set: { activatedAt: new Date() } },
    { new: true, upsert: true }
  );
  invalidateCurrentUsername(userId);
  const report = await BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({ createdAt: -1 })
    || await reportFromAnalysis(userId, username, null);
  return { profile, report };
}

/* ── BRAND VOICE, IN THE BACKGROUND ─────────────────────────────────────────────────────────────
   Once the account has its report, Business memory's "Fetch brand voice" runs by itself (the same
   buildBrandVoice: last 10 posts, Graph or Apify, the Settings model), so it is there without a press.
   The posts the visitor read were just stored on the profile, so it normally reuses them rather than
   scraping again. Never awaited by onboarding; a failure is only logged. Runs at most once per report:
   not when a brand voice is already stored, nor while another run holds `brandVoiceRunningAt`. */
function brandVoiceInBackground(userId, report) {
  const handle = report?.instagramUsername;
  if (!report?._id || !handle || handle === PLACEHOLDER_HANDLE) return;
  setImmediate(async () => {
    const reportId = report._id;
    const claimed = await BrandAnalysisReport.findOneAndUpdate(
      {
        _id: reportId,
        user: userId,
        brandVoice: null,
        $or: [{ brandVoiceRunningAt: null }, { brandVoiceRunningAt: { $lt: new Date(Date.now() - VOICE_STALE_MS) } }],
      },
      { $set: { brandVoiceRunningAt: new Date() } },
      { new: true },
    );
    if (!claimed) return;
    try {
      const currentFields = {};
      for (const { key } of BRAND_DNA_FIELDS) currentFields[key] = String(claimed[key] || '').trim();
      const result = await buildBrandVoice({ userId, username: handle, currentFields, snapshot: claimed.brandVoicePosts });
      // a manual Fetch brand voice that finished first wins
      await BrandAnalysisReport.updateOne(
        { _id: reportId, brandVoice: null },
        { $set: { brandVoice: result.brandVoice, brandVoicePosts: result.postsSnapshot } },
      );
      console.log(`[visitorInstagram] brand voice ready for @${handle}`);
    } catch (err) {
      console.warn(`[visitorInstagram] background brand voice failed for @${handle}:`, err.message);
    } finally {
      await BrandAnalysisReport.updateOne({ _id: reportId }, { $set: { brandVoiceRunningAt: null } })
        .catch(() => {});
    }
  });
}

/* ── THE STUDIO ANSWERS, INTO BUSINESS MEMORY ──────────────────────────────────────────────────
   What they said, in the words of the options they pressed or their own (bauhly-v3 discovery.js
   `declaredLines`): nothing inferred. Added to the report's fields, after anything already there. */
const QUESTION_FIELDS = { studio: ['whatYouOffer', 'whoYouHelp'], voice: ['howYouSound'], value: ['position'] };
function linesOf(answers) {
  const out = {};
  const add = (field, text) => { if (text) (out[field] = out[field] || []).push(text); };
  const a = answers || {};
  const titles = (q) => (Array.isArray(a[q]?.picked) ? a[q].picked.map((p) => String(p?.title || p || '')).filter(Boolean) : []);
  const notes = (q) => (Array.isArray(a[q]?.picked) ? a[q].picked.map((p) => String(p?.line || '')).filter(Boolean) : []);
  const own = (q) => String(a[q]?.other || '').trim().slice(0, 400);
  if (titles('studio').length) add('whatYouOffer', `Describes the studio as: ${titles('studio').join(', ').toLowerCase()}.`);
  if (notes('studio').length) add('whoYouHelp', `Typical projects and clients, as they put it: ${notes('studio').map((l) => l.replace(/\.$/, '').toLowerCase()).join('; ')}.`);
  if (own('studio')) add('whatYouOffer', `In their words: ${own('studio')}`);
  if (titles('voice').length) add('howYouSound', `Wants to come across as ${titles('voice').join(' and ').toLowerCase()}. A direction, not a template.`);
  if (own('voice')) add('howYouSound', `In their words: ${own('voice')}`);
  if (titles('value').length) add('position', `Says clients value most: ${titles('value').join(' and ').toLowerCase()}.`);
  if (own('value')) add('position', `In their words: ${own('value')}`);
  return out;
}
async function rememberAnswers(report, answers) {
  if (!report) return;
  const lines = linesOf(answers);
  let changed = false;
  for (const fields of Object.values(QUESTION_FIELDS)) {
    for (const f of fields) {
      for (const line of lines[f] || []) {
        const was = String(report[f] || '').trim();
        if (was.includes(line)) continue;
        report[f] = was ? `${was}\n${line}` : line;
        changed = true;
      }
    }
  }
  if (changed) await report.save();
}

async function claimVisitorRead(user, { token, answers } = {}) {
  const userId = user._id;
  let attached = null;
  let read = token ? await VisitorInstagramRead.findOne({ token: String(token) }) : null;
  if (read && read.claimedBy && String(read.claimedBy) !== String(userId)) read = null;
  if (read) {
    if (!read.claimedBy) await VisitorInstagramRead.updateOne({ _id: read._id }, { claimedBy: userId });
    // still reading: wait for it, up to a point (the post's own progress is on screen meanwhile)
    const until = Date.now() + CLAIM_WAIT_MS;
    while (read && read.status === 'running' && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2000));
      read = await VisitorInstagramRead.findById(read._id);
    }
    if (read?.attachedAt || read?.attaching) {
      if (!read.attachedAt) await attachRead(read, userId);
      attached = {
        profile: await InstagramProfile.findOne({ user: userId, username: read.handle }),
        report: await BrandAnalysisReport.findOne({ user: userId, instagramUsername: read.handle }).sort({ createdAt: -1 }),
      };
    } else if (read?.status === 'done') {
      attached = await attachRead(read, userId);
    }
  }
  // no read, a failed one, or one that is taking too long: plan under the handle they gave, or none
  const result = attached || await ensureProfile(userId, read?.handle || null, user.name);
  await rememberAnswers(result.report, answers);
  // after the answers, so the voice read sees them; a read still running attaches (and starts it) later
  if (attached || (read?.handle && read.status !== 'running')) brandVoiceInBackground(userId, result.report);
  return {
    username: result.profile?.username || null,
    instagram: read ? read.status : 'none',
  };
}

module.exports = { startVisitorRead, claimVisitorRead, cleanHandle, PLACEHOLDER_HANDLE };
