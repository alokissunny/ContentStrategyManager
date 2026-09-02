const crypto = require('crypto');
const Project = require('../models/Project');
const { currentUsername } = require('../utils/currentProfile');
const {
  isS3Configured,
  getPresignedUploadUrl,
  getMediaUrl,
  MEDIA_CACHE_CONTROL,
  deleteObjects,
} = require('../services/s3Client');
const { analyzeImageAsset } = require('../services/imageAnalysis');
  const {
    understandCapture,
    sanitizeUnderstanding,
    serializeUnderstanding,
    sanitizeStories,
    serializeStories,
    composeSessionSummary,
  } = require('../services/captureUnderstand');
const { understandCheckin } = require('../services/checkinUnderstand');
const { transcribeAudio } = require('../services/transcribeAudio');

function wantsPromptDebug(req) {
  return String(req.get('x-debug-prompts') || '').trim() === '1';
}

function withOptionalDebug(result, req) {
  if (!result || typeof result !== 'object') return result;
  const { debug, ...rest } = result;
  if (wantsPromptDebug(req) && debug) rest.debug = debug;
  return rest;
}

// ── serialization ─────────────────────────────────────────────────────────
// The DB stores S3 object keys; the client receives short-lived presigned read
// URLs (and the key, so it can echo an existing attachment back on an edit).

function serializeAnalysis(an) {
  if (!an) return null;
  return {
    status: an.status,
    summary: an.summary || '',
    description: an.description || '',
    tags: an.tags || [],
    colors: an.colors || [],
    mood: an.mood || '',
    subjects: an.subjects || [],
    text: an.text || '',
    model: an.model || '',
    inputTokens: an.inputTokens || 0,
    outputTokens: an.outputTokens || 0,
    costUsd: an.costUsd || 0,
    error: an.error || '',
    analyzedAt: an.analyzedAt || null,
  };
}

async function serializeAttachment(a) {
  // The client loads media from getMediaUrl: a stable, cacheable CDN URL when a
  // CDN is configured (MEDIA_CDN_BASE_URL), otherwise a short-lived presigned
  // S3 URL. Either way the DB only ever stores the object key.
  let url = '';
  if (a.key && isS3Configured()) {
    try {
      url = await getMediaUrl(a.key);
    } catch (err) {
      console.error('[projects] could not resolve media url for', a.key, err.message);
    }
  }
  return { id: a._id.toString(), type: a.type, key: a.key, url, thumbnailUrl: url, analysis: serializeAnalysis(a.analysis) };
}

async function serializeCapture(c) {
  const stories = serializeStories(c.stories);
  const understanding = serializeUnderstanding(c.understanding);
  return {
    id: c._id.toString(),
    type: c.type,
    text: c.text || '',
    createdAt: c.createdAt,
    sessionId: c.sessionId || '',
    sessionKind: c.sessionKind || '',
    sessionSummary: c.sessionSummary || '',
    understanding,
    stories: stories.length ? stories : (understanding ? [understanding] : []),
    attachments: await Promise.all((c.attachments || []).map(serializeAttachment)),
  };
}

async function serializeProject(p) {
  return {
    id: p._id.toString(),
    name: p.name,
    captures: await Promise.all((p.captures || []).map(serializeCapture)),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// Every S3 key held by a project or a single capture — for cleanup on delete.
const projectKeys = (p) => (p.captures || []).flatMap((c) => (c.attachments || []).map((a) => a.key));
const captureKeys = (c) => (c.attachments || []).map((a) => a.key);

// Only keys the API generated — never trust a client-supplied key that points
// outside this user's own upload prefix.
function prefixOf(userId) {
  return `projects/${userId}/`;
}
function sanitizeAttachments(attachments, userId) {
  const prefix = prefixOf(userId);
  return (attachments || [])
    .filter((a) => a && (a.type === 'image' || a.type === 'video') && typeof a.key === 'string' && a.key.startsWith(prefix))
    .map((a) => ({ type: a.type, key: a.key }));
}

// ── uploads ────────────────────────────────────────────────────────────────
const EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'video/webm': 'webm',
};

// Hand the browser presigned PUT URLs so it can upload media straight to S3.
// Body: { files: [{ contentType }] } → { uploads: [{ key, uploadUrl }] }.
async function signUploads(req, res) {
  if (!isS3Configured()) {
    return res.status(503).json({ message: 'Media storage is not configured (set S3_BUCKET_NAME).' });
  }
  const files = Array.isArray(req.body.files) ? req.body.files : [];
  if (!files.length) return res.status(400).json({ message: 'No files to sign' });
  if (files.length > 20) return res.status(400).json({ message: 'Too many files in one request' });

  const uploads = await Promise.all(
    files.map(async ({ contentType }) => {
      const ext = EXT[contentType] || 'bin';
      const key = `${prefixOf(req.user._id)}${crypto.randomUUID()}.${ext}`;
      const uploadUrl = await getPresignedUploadUrl(key, contentType);
      // The presigned PUT signs an immutable Cache-Control header, so the browser
      // must echo this exact value on the upload (see api/projects.uploadFiles).
      return { key, uploadUrl, cacheControl: MEDIA_CACHE_CONTROL };
    })
  );
  res.json({ uploads });
}

// ── projects ─────────────────────────────────────────────────────────────
// Projects belong to the user's current Instagram account (see
// utils/currentProfile), so they switch together with the header account.
async function listProjects(req, res) {
  const username = await currentUsername(req.user._id);
  const filter = { user: req.user._id };
  if (username) {
    // Adopt legacy projects (created before projects were tied to a handle) into
    // the current account so nothing disappears now that projects are scoped.
    await Project.updateMany(
      { user: req.user._id, instagramUsername: { $in: [null, ''] } },
      { $set: { instagramUsername: username } }
    );
    filter.instagramUsername = username;
  }
  const projects = await Project.find(filter).sort({ updatedAt: -1 });
  res.json({ projects: await Promise.all(projects.map(serializeProject)) });
}

async function createProject(req, res) {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Project name is required' });
  const instagramUsername = await currentUsername(req.user._id);
  const project = await Project.create({ user: req.user._id, name, captures: [], instagramUsername });
  res.status(201).json({ project: await serializeProject(project) });
}

async function renameProject(req, res) {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Project name is required' });
  const project = await Project.findOne({ _id: req.params.id, user: req.user._id });
  if (!project) return res.status(404).json({ message: 'Project not found' });
  project.name = name;
  await project.save();
  res.json({ project: await serializeProject(project) });
}

async function deleteProject(req, res) {
  const project = await Project.findOne({ _id: req.params.id, user: req.user._id });
  if (!project) return res.status(404).json({ message: 'Project not found' });
  await deleteObjects(projectKeys(project));
  await project.deleteOne();
  res.json({ id: req.params.id });
}

// ── captures ─────────────────────────────────────────────────────────────
async function addCapture(req, res) {
  const project = await Project.findOne({ _id: req.params.id, user: req.user._id });
  if (!project) return res.status(404).json({ message: 'Project not found' });

  const attachments = sanitizeAttachments(req.body.attachments, req.user._id);
  const text = (req.body.text || '').trim();
  if (!text && attachments.length === 0) {
    return res.status(400).json({ message: 'A capture needs a note or a file' });
  }
  const type = ['note', 'photo', 'video'].includes(req.body.type) ? req.body.type : 'note';
  const understanding = sanitizeUnderstanding(req.body.understanding);
  const stories = sanitizeStories(req.body.stories);
  const storyRows = stories.length ? stories : (understanding ? [understanding] : []);
  const sessionKind = req.body.sessionKind === 'checkin' ? 'checkin' : (req.body.sessionKind === 'capture' ? 'capture' : '');
  const sessionId = String(req.body.sessionId || '').trim() || crypto.randomUUID();
  const sessionSummary = String(req.body.sessionSummary || '').trim()
    || composeSessionSummary(storyRows, text);

  project.captures.push({
    type,
    text: sessionSummary || text,
    attachments,
    understanding: storyRows[0] || understanding,
    stories: storyRows,
    sessionId,
    sessionKind,
    sessionSummary,
    createdAt: new Date(),
  });
  // Persist the files first so a slow vision call cannot lose the upload.
  await project.save();
  const created = project.captures[project.captures.length - 1];
  await analyzeNewImageAttachments(created.attachments);
  await project.save();
  res.status(201).json({ project: await serializeProject(project) });
}

async function updateCapture(req, res) {
  const project = await Project.findOne({ _id: req.params.id, user: req.user._id });
  if (!project) return res.status(404).json({ message: 'Project not found' });
  const capture = project.captures.id(req.params.captureId);
  if (!capture) return res.status(404).json({ message: 'Capture not found' });

  if (req.body.text !== undefined) capture.text = String(req.body.text);
  if (req.body.sessionSummary !== undefined) capture.sessionSummary = String(req.body.sessionSummary);
  if (req.body.attachments !== undefined) {
    const next = sanitizeAttachments(req.body.attachments, req.user._id);
    const nextKeys = new Set(next.map((a) => a.key));
    // objects dropped from the note are removed from the bucket too
    await deleteObjects(captureKeys(capture).filter((k) => !nextKeys.has(k)));
    // carry any existing AI analysis across the edit — a re-uploaded client
    // payload only carries { type, key }, so re-key it from what we hold
    const priorAnalysis = new Map((capture.attachments || []).map((a) => [a.key, a.analysis]));
    capture.attachments = next.map((a) => (priorAnalysis.get(a.key) ? { ...a, analysis: priorAnalysis.get(a.key) } : a));
    await project.save();
    await analyzeNewImageAttachments(capture.attachments);
  }
  await project.save();
  res.json({ project: await serializeProject(project) });
}

async function deleteCapture(req, res) {
  const project = await Project.findOne({ _id: req.params.id, user: req.user._id });
  if (!project) return res.status(404).json({ message: 'Project not found' });
  const capture = project.captures.id(req.params.captureId);
  if (!capture) return res.status(404).json({ message: 'Capture not found' });
  await deleteObjects(captureKeys(capture));
  capture.deleteOne();
  await project.save();
  res.json({ project: await serializeProject(project) });
}

// Move a capture to another of the user's projects (its media keys travel with
// it — no re-upload, no S3 cleanup).
async function moveCapture(req, res) {
  const [from, to] = await Promise.all([
    Project.findOne({ _id: req.params.id, user: req.user._id }),
    Project.findOne({ _id: req.body.toProjectId, user: req.user._id }),
  ]);
  if (!from || !to) return res.status(404).json({ message: 'Project not found' });
  const capture = from.captures.id(req.params.captureId);
  if (!capture) return res.status(404).json({ message: 'Capture not found' });

  to.captures.push(capture.toObject());
  capture.deleteOne();
  await Promise.all([from.save(), to.save()]);
  res.json({ from: await serializeProject(from), to: await serializeProject(to) });
}

// ── AI asset analysis ──────────────────────────────────────────────────────
// Run one image asset through the vision model and store the result on the
// attachment. Mutates `attachment.analysis` in place and returns nothing; the
// caller saves the project. Errors are captured onto the analysis record so a
// bulk run over many assets never fails as a whole because one image was bad.
async function runAssetAnalysis(attachment) {
  if (attachment.type !== 'image') {
    attachment.analysis = { status: 'error', error: 'Only images can be analysed', analyzedAt: new Date() };
    return;
  }
  try {
    const result = await analyzeImageAsset(attachment.key, { type: attachment.type });
    attachment.analysis = { status: 'done', ...result, error: '', analyzedAt: new Date() };
  } catch (err) {
    console.error('[projects] analysis failed for', attachment.key, err.message);
    attachment.analysis = {
      status: 'error',
      error: err.message || 'Analysis failed',
      analyzedAt: new Date(),
    };
  }
}

/** Vision metadata for any image that does not already have a completed analysis. */
async function analyzeNewImageAttachments(attachments) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  for (const a of attachments || []) {
    if (a.type !== 'image') continue;
    if (a.analysis && a.analysis.status === 'done') continue;
    // eslint-disable-next-line no-await-in-loop
    await runAssetAnalysis(a);
  }
}

// POST /projects/:id/captures/:captureId/attachments/:attachmentId/analyze
// Analyse a single asset (re-runs even if already analysed).
async function analyzeAsset(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ message: 'AI analysis is not configured (set ANTHROPIC_API_KEY).' });
  }
  const project = await Project.findOne({ _id: req.params.id, user: req.user._id });
  if (!project) return res.status(404).json({ message: 'Project not found' });
  const capture = project.captures.id(req.params.captureId);
  if (!capture) return res.status(404).json({ message: 'Capture not found' });
  const attachment = capture.attachments.id(req.params.attachmentId);
  if (!attachment) return res.status(404).json({ message: 'Asset not found' });

  await runAssetAnalysis(attachment);
  await project.save();
  res.json({ project: await serializeProject(project) });
}

// POST /projects/:id/analyze — analyse every image asset in the project.
// By default only assets without a completed analysis are (re)run; pass
// { force: true } to re-analyse all of them. Video assets are skipped.
async function analyzeProject(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ message: 'AI analysis is not configured (set ANTHROPIC_API_KEY).' });
  }
  const project = await Project.findOne({ _id: req.params.id, user: req.user._id });
  if (!project) return res.status(404).json({ message: 'Project not found' });

  const force = Boolean(req.body && req.body.force);
  const targets = [];
  for (const capture of project.captures) {
    for (const a of capture.attachments || []) {
      if (a.type !== 'image') continue;
      if (!force && a.analysis && a.analysis.status === 'done') continue;
      targets.push(a);
    }
  }

  // Run sequentially to stay gentle on the vision API's rate limits; errors are
  // recorded per-asset by runAssetAnalysis, so one bad image won't abort the run.
  for (const a of targets) {
    // eslint-disable-next-line no-await-in-loop
    await runAssetAnalysis(a);
  }
  await project.save();

  // Totals for this run — what the studio just spent analysing these assets.
  const usage = targets.reduce(
    (acc, a) => {
      if (a.analysis?.status === 'done') {
        acc.inputTokens += a.analysis.inputTokens || 0;
        acc.outputTokens += a.analysis.outputTokens || 0;
        acc.costUsd += a.analysis.costUsd || 0;
      }
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, costUsd: 0 }
  );

  res.json({ project: await serializeProject(project), analyzed: targets.length, usage });
}

// ── Capture-time understanding ─────────────────────────────────────────────
// POST /projects/captures/understand
// Capture Conversation: detect internal stories for clarification, preserve
// one unified Capture for strategy. Never blocks filing if the model is down.
async function understandDraft(req, res) {
  const text = (req.body.text || '').trim();
  const attachments = sanitizeAttachments(req.body.attachments, req.user._id);
  const projectName = (req.body.projectName || '').trim();
  const alreadyAsked = Boolean(req.body.alreadyAsked);
  const askedQuestion = (req.body.askedQuestion || '').trim();
  const askedAnswer = (req.body.askedAnswer || '').trim();
  const turns = Array.isArray(req.body.turns)
    ? req.body.turns
      .slice(-24)
      .map((t) => ({
        role: String(t?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
        text: String(t?.text || '').trim(),
      }))
      .filter((t) => t.text)
    : [];
  const confirmedIds = Array.isArray(req.body.confirmedIds)
    ? req.body.confirmedIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 10)
    : [];

  if (!text && attachments.length === 0 && turns.length === 0) {
    return res.status(400).json({ message: 'A capture needs a note or a file' });
  }

  try {
    const result = await understandCapture({
      text,
      attachments,
      projectName,
      alreadyAsked,
      askedQuestion,
      askedAnswer,
      turns,
      confirmedIds,
    });
    res.json(withOptionalDebug(result, req));
  } catch (err) {
    console.error('[projects] capture understand failed', err.message);
    // Capture must never stall because the understander is down — store as-is.
    const fallback = {
      action: 'ready',
      question: null,
      conversationSummary: text,
      captures: [{ originalCapture: text, captureSummary: text }],
      understanding: {
        happened: text,
        intent: '',
        difficulty: '',
        actionTaken: '',
        outcome: '',
        summary: text,
        presentSignals: text ? ['happened'] : [],
        missingPiece: '',
        askedQuestion: alreadyAsked ? askedQuestion : '',
        askedAnswer: alreadyAsked ? askedAnswer : '',
        model: '',
        understoodAt: new Date(),
      },
    };
    if (wantsPromptDebug(req)) {
      fallback.debug = {
        source: 'Capture conversation',
        model: '',
        systemPrompt: '',
        finalPrompt: text,
        output: '',
        note: err.message,
      };
    }
    res.json(fallback);
  }
}

// POST /projects/checkin/understand
// Same Capture Conversation agent as Projects, plus matching a project on file.
// Never blocks the conversation if the model is down.
async function understandCheckinDraft(req, res) {
  const text = (req.body.text || '').trim();
  const attachments = sanitizeAttachments(req.body.attachments, req.user._id);
  const alreadyAsked = Boolean(req.body.alreadyAsked);
  const askedQuestion = (req.body.askedQuestion || '').trim();
  const askedAnswer = (req.body.askedAnswer || '').trim();
  const turns = Array.isArray(req.body.turns)
    ? req.body.turns
      .slice(-24)
      .map((t) => ({
        role: String(t?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
        text: String(t?.text || '').trim(),
      }))
      .filter((t) => t.text)
    : [];
  const confirmedIds = Array.isArray(req.body.confirmedIds)
    ? req.body.confirmedIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 10)
    : [];
  const projects = Array.isArray(req.body.projects)
    ? req.body.projects
      .filter((p) => p && (p.id || p._id) && p.name)
      .map((p) => ({ id: String(p.id || p._id), name: String(p.name).trim() }))
      .filter((p) => p.name)
    : [];

  if (!text && attachments.length === 0 && turns.length === 0) {
    return res.status(400).json({ message: 'A check-in turn needs a note or a file' });
  }

  try {
    const result = await understandCheckin({
      text,
      attachments,
      projects,
      alreadyAsked,
      askedQuestion,
      askedAnswer,
      turns,
      confirmedIds,
    });
    res.json(withOptionalDebug(result, req));
  } catch (err) {
    console.error('[projects] checkin understand failed', err.message);
    res.json({
      action: 'ready',
      question: null,
      ack: '',
      matchedProjectId: null,
      matchedProjectName: '',
      askForAssets: attachments.length === 0,
      conversationSummary: text,
      captures: [{ originalCapture: text, captureSummary: text }],
      understanding: {
        happened: text,
        intent: '',
        difficulty: '',
        actionTaken: '',
        outcome: '',
        summary: text,
        presentSignals: text ? ['happened'] : [],
        missingPiece: '',
        askedQuestion: alreadyAsked ? askedQuestion : '',
        askedAnswer: alreadyAsked ? askedAnswer : '',
        model: '',
        understoodAt: new Date(),
      },
      ...(wantsPromptDebug(req) ? {
        debug: {
          source: 'Check-in conversation',
          model: '',
          systemPrompt: '',
          finalPrompt: text,
          output: '',
          note: err.message,
        },
      } : {}),
    });
  }
}

// POST /projects/captures/transcribe — raw audio body, words back.
async function transcribeDraft(req, res) {
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
  if (!buffer.length) {
    return res.status(400).json({ message: 'No audio to transcribe' });
  }
  try {
    const result = await transcribeAudio(buffer, req.headers['content-type']);
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ message: err.message || 'Transcription failed' });
  }
}

module.exports = {
  signUploads,
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  addCapture,
  updateCapture,
  deleteCapture,
  moveCapture,
  analyzeAsset,
  analyzeProject,
  understandDraft,
  understandCheckinDraft,
  transcribeDraft,
};
