const mongoose = require('mongoose');
const { currentUsername } = require('../utils/currentProfile');
const { appLocaleOf } = require('../utils/appLocale');
const { wantsPromptDebug } = require('../utils/promptDebug');
const { nextIdeas, decideIdea } = require('../services/nextPostIdea');
const { ideaReelPlan } = require('../services/ideaReelPlan');

// GET /api/ideas/next[?refresh=1] — "What could you share next?" for the current handle.
async function getNextIdeas(req, res) {
  const username = await currentUsername(req.user._id);
  if (!username) return res.json({ ideas: [], username: null });
  const debug = wantsPromptDebug(req) ? [] : null;
  const started = Date.now();
  try {
    const out = await nextIdeas(req.user._id, username, {
      locale: appLocaleOf(req),
      refresh: req.query.refresh === '1' || req.query.refresh === 'true',
      debug,
    });
    res.json({
      ...out,
      username,
      ...(debug && debug.length ? {
        debug: {
          mode: 'next-post idea',
          model: debug[0].model,
          elapsedMs: Date.now() - started,
          agents: debug,
          usage: { estimatedCostUsd: debug.reduce((n, r) => n + (r.usage?.estimatedCostUsd || 0), 0) },
        },
      } : {}),
    });
  } catch (err) {
    console.error(`[ideas] next idea for @${username} failed:`, err.message);
    res.status(502).json({ message: 'Bauhly could not think of a next post just now. Please try again.' });
  }
}

// PATCH /api/ideas/:id { status: accepted | saved | dismissed, captureId? }
async function updateIdea(req, res) {
  const { id } = req.params;
  const status = String(req.body?.status || '');
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Idea not found.' });
  if (!['accepted', 'saved', 'dismissed'].includes(status)) {
    return res.status(400).json({ message: 'status must be accepted, saved or dismissed.' });
  }
  try {
    const idea = await decideIdea(req.user._id, id, { status, captureId: req.body?.captureId });
    if (!idea) return res.status(404).json({ message: 'Idea not found.' });
    res.json({ idea });
  } catch (err) {
    if (err.statusCode === 409) return res.status(409).json({ message: err.message });
    throw err;
  }
}

// POST /api/ideas/from-capture { captureIds } — Captures › Generate reel opens the
// same reel planner as a recommended post (studio, 2026-11-19). The planner is
// keyed on an idea, so the capture gets one of its own: batchId `capture:<id>`,
// status accepted — never a GenPill suggestion. Reused on every later open.
async function ideaFromCapture(req, res) {
  const ids = (Array.isArray(req.body?.captureIds) ? req.body.captureIds : [req.body?.captureId])
    .map(String).filter((id) => mongoose.isValidObjectId(id)).slice(0, 12);
  if (!ids.length) return res.status(400).json({ message: 'Pick a capture first.' });
  const Project = require('../models/Project');
  const PostIdea = require('../models/PostIdea');
  const project = await Project.findOne({ user: req.user._id, 'captures._id': ids[0] }).select('name instagramUsername captures');
  const caps = ids.map((id) => project?.captures?.id(id)).filter(Boolean);
  if (!caps.length) return res.status(404).json({ message: 'That capture no longer exists.' });
  const lead = caps[caps.length - 1]; // the newest member carries the conversation
  const batchId = `capture:${ids[0]}`;
  const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const known = caps.flatMap((c) => (c.understanding?.verifiedFacts || []).map((f) => clip(typeof f === 'string' ? f : f?.fact, 240)))
    .filter(Boolean).slice(0, 10);
  const title = clip(lead.conversationTitle || lead.sessionTitle || lead.understanding?.summary || lead.sessionSummary || lead.text, 110) || 'Your capture';
  let doc = await PostIdea.findOne({ user: req.user._id, batchId });
  if (!doc) {
    doc = await PostIdea.create({
      user: req.user._id,
      instagramUsername: project.instagramUsername || '',
      batchId, rank: 1, status: 'accepted', pillar: 'story', mission: '',
      title,
      why: clip(lead.sessionSummary || lead.understanding?.summary, 400),
      known,
      sources: ids.map((id) => ({ kind: 'capture', id, label: project.name || '' })),
      captureId: String(lead._id),
      decidedAt: new Date(),
    });
  } else if (!doc.reelPlan) {
    // the capture may have grown since: refresh what the planner reads
    doc.title = title;
    doc.known = known;
    await doc.save();
  }
  res.json({
    idea: { id: String(doc._id), title: doc.title, mission: '', missionWhy: '', why: doc.why, known: doc.known, questions: [], assets: [], fromCapture: true },
    captureId: String(lead._id),
  });
}

// POST /api/ideas/:id/reel-plan { captureId, format?, refresh? } — the recommended reel
// for an explored idea (format + story sequences + recording guide)
async function getIdeaReelPlan(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Idea not found.' });
  const debug = wantsPromptDebug(req) ? [] : null;
  const started = Date.now();
  try {
    const out = await ideaReelPlan(req.user._id, id, {
      captureId: mongoose.isValidObjectId(req.body?.captureId) ? String(req.body.captureId) : '',
      format: String(req.body?.format || ''),
      refresh: Boolean(req.body?.refresh),
      locale: appLocaleOf(req),
      debug,
    });
    if (!out) return res.status(404).json({ message: 'Idea not found.' });
    res.json({
      ...out,
      ...(debug && debug.length ? {
        debug: {
          mode: 'idea reel plan',
          model: debug[0].model,
          elapsedMs: Date.now() - started,
          agents: debug,
          usage: { estimatedCostUsd: debug.reduce((n, r) => n + (r.usage?.estimatedCostUsd || 0), 0) },
        },
      } : {}),
    });
  } catch (err) {
    console.error(`[ideas] reel plan for ${id} failed:`, err.message);
    res.status(502).json({ message: 'Bauhly could not plan this reel just now. Please try again.' });
  }
}

module.exports = {
  ideaFromCapture, getNextIdeas, updateIdea, getIdeaReelPlan };
