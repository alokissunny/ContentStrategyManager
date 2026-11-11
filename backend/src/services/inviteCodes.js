const InviteCode = require('../models/InviteCode');

/* 4 letters/digits; typed in any case, with spaces or dashes tolerated */
function normalizeInviteCode(raw) {
  return String(raw || '').replace(/[\s-]/g, '').toUpperCase();
}

function isInviteCodeShape(code) {
  return /^[A-Z0-9]{4}$/.test(code);
}

/*
 * Takes the code for this sign-up in ONE atomic update (unused, not revoked → used), so two people
 * racing the same code can't both get in. Returns the claimed doc, or null when the code is unknown,
 * revoked or already used. If the account then fails to be made, `releaseInviteCode` gives it back.
 */
async function claimInviteCode(code, email) {
  return InviteCode.findOneAndUpdate(
    { code, usedAt: null, revokedAt: null },
    { $set: { usedAt: new Date(), usedByEmail: String(email || '').toLowerCase() } },
    { new: true },
  );
}

async function attachInviteCode(inviteId, userId) {
  await InviteCode.updateOne({ _id: inviteId }, { $set: { usedBy: userId } });
}

async function releaseInviteCode(inviteId) {
  await InviteCode.updateOne({ _id: inviteId, usedBy: null }, { $set: { usedAt: null, usedByEmail: '' } });
}

const INVITE_MESSAGES = {
  required: 'Enter your 4-character invitation code to create an account.',
  invalid: 'That invitation code isn’t valid or has already been used.',
};

/*
 * Runs `create()` (which makes the user) under a claimed code. Throws an error with `status` for a
 * missing/bad code, and hands the code back if `create` fails.
 */
async function withInviteCode(rawCode, email, create) {
  const code = normalizeInviteCode(rawCode);
  if (!code) throw Object.assign(new Error(INVITE_MESSAGES.required), { status: 403, code: 'INVITE_REQUIRED' });
  if (!isInviteCodeShape(code)) throw Object.assign(new Error(INVITE_MESSAGES.invalid), { status: 400, code: 'INVITE_INVALID' });
  const invite = await claimInviteCode(code, email);
  if (!invite) throw Object.assign(new Error(INVITE_MESSAGES.invalid), { status: 400, code: 'INVITE_INVALID' });
  let user;
  try {
    user = await create(invite.code);
  } catch (err) {
    await releaseInviteCode(invite._id).catch(() => {});
    throw err;
  }
  await attachInviteCode(invite._id, user._id);
  return user;
}

module.exports = { normalizeInviteCode, isInviteCodeShape, claimInviteCode, releaseInviteCode, withInviteCode, INVITE_MESSAGES };
