const EarlyAccessRequest = require('../models/EarlyAccessRequest');

const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

function normalizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function normalizeName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

async function createRequest(req, res) {
  const name = normalizeName(req.body?.name);
  const instagramHandle = normalizeHandle(req.body?.instagramHandle);

  if (!name || name.length > 80) {
    return res.status(400).json({ message: 'Please enter your name.' });
  }
  if (!instagramHandle || !HANDLE_RE.test(instagramHandle)) {
    return res.status(400).json({ message: 'Please enter a valid Instagram handle.' });
  }

  const existing = await EarlyAccessRequest.findOne({ instagramHandle });
  if (existing) {
    return res.json({
      id: String(existing._id),
      alreadyRequested: true,
    });
  }

  try {
    const created = await EarlyAccessRequest.create({ name, instagramHandle });
    return res.status(201).json({
      id: String(created._id),
      alreadyRequested: false,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const dup = await EarlyAccessRequest.findOne({ instagramHandle });
      return res.json({
        id: dup ? String(dup._id) : undefined,
        alreadyRequested: true,
      });
    }
    throw err;
  }
}

module.exports = { createRequest };
