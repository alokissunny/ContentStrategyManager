const crypto = require('crypto');
const Project = require('../models/Project');
const InstagramProfile = require('../models/InstagramProfile');
const {
  isS3Configured,
  getPresignedUploadUrl,
  getPresignedMediaUrl,
  deleteObjects,
} = require('../services/s3Client');

// ── serialization ─────────────────────────────────────────────────────────
// The DB stores S3 object keys; the client receives short-lived presigned read
// URLs (and the key, so it can echo an existing attachment back on an edit).

async function serializeAttachment(a) {
  let url = '';
  if (a.key && isS3Configured()) {
    try {
      url = await getPresignedMediaUrl(a.key);
    } catch (err) {
      console.error('[projects] could not presign', a.key, err.message);
    }
  }
  return { id: a._id.toString(), type: a.type, key: a.key, url, thumbnailUrl: url };
}

async function serializeCapture(c) {
  return {
    id: c._id.toString(),
    type: c.type,
    text: c.text || '',
    createdAt: c.createdAt,
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
  'image/gif': 'gif', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
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
      return { key, uploadUrl };
    })
  );
  res.json({ uploads });
}

// ── projects ─────────────────────────────────────────────────────────────
// The handle projects belong to = the user's *current* Instagram account (the
// one most recently activated/switched in the header). Mirrors instagram
// controller's CURRENT_SORT so "current" means the same thing everywhere.
async function currentUsername(userId) {
  const profile = await InstagramProfile.findOne({ user: userId })
    .sort({ activatedAt: -1, fetchedAt: -1 })
    .select('username')
    .lean();
  return profile?.username || null;
}

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

  project.captures.push({ type, text, attachments, createdAt: new Date() });
  await project.save();
  res.status(201).json({ project: await serializeProject(project) });
}

async function updateCapture(req, res) {
  const project = await Project.findOne({ _id: req.params.id, user: req.user._id });
  if (!project) return res.status(404).json({ message: 'Project not found' });
  const capture = project.captures.id(req.params.captureId);
  if (!capture) return res.status(404).json({ message: 'Capture not found' });

  if (req.body.text !== undefined) capture.text = String(req.body.text);
  if (req.body.attachments !== undefined) {
    const next = sanitizeAttachments(req.body.attachments, req.user._id);
    const nextKeys = new Set(next.map((a) => a.key));
    // objects dropped from the note are removed from the bucket too
    await deleteObjects(captureKeys(capture).filter((k) => !nextKeys.has(k)));
    capture.attachments = next;
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
};
