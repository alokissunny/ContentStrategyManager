const EarlyAccessRequest = require('../models/EarlyAccessRequest');
const WaitlistEntry = require('../models/WaitlistEntry');
const InviteCode = require('../models/InviteCode');
const { normalizeInviteCode, isInviteCodeShape } = require('../services/inviteCodes');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Looks a code up without using it: the invitation step checks it before Create account is shown. The
   account itself still claims it atomically at /auth/register (withInviteCode). */
async function checkInvite(req, res) {
  const code = normalizeInviteCode(req.body?.code);
  if (!code) return res.status(400).json({ ok: false, reason: 'empty' });
  if (!isInviteCodeShape(code)) return res.json({ ok: false, reason: 'invalid' });
  const invite = await InviteCode.findOne({ code }).lean();
  if (!invite || invite.revokedAt) return res.json({ ok: false, reason: 'invalid' });
  if (invite.usedAt) return res.json({ ok: false, reason: 'redeemed' });
  return res.json({ ok: true, code });
}

async function joinWaitlist(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, reason: 'email', message: 'Enter a valid email address.' });
  }
  const source = ['capture', 'login'].includes(req.body?.source) ? req.body.source : '';
  const was = await WaitlistEntry.findOneAndUpdate(
    { email },
    { $setOnInsert: { email, source }, $inc: { joinedCount: 1 } },
    { upsert: true, new: false },
  );
  return res.status(was ? 200 : 201).json({ ok: true, already: Boolean(was) });
}

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

module.exports = { createRequest, checkInvite, joinWaitlist };
