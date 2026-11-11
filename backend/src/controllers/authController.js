const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { currentUsername } = require('../utils/currentProfile');
const generateToken = require('../utils/generateToken');
const { withInviteCode } = require('../services/inviteCodes');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function toPublicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar || '',
    role: user.role || 'user',
    business: user.business,
  };
}

async function userHasInstagramProfile(userId) {
  // Reuses the current-username cache so /auth/me does not pay a second Atlas RTT.
  return Boolean(await currentUsername(userId));
}

async function authPayload(user) {
  const hasInstagramProfile = await userHasInstagramProfile(user._id);
  return {
    user: { ...toPublicUser(user), hasInstagramProfile },
    token: generateToken(user._id),
    hasInstagramProfile,
  };
}

async function register(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required' });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ message: 'An account with this email already exists' });
  }

  const at = new Date();
  const legal = req.body.acceptTerms
    ? { termsAcceptedAt: at, termsVersion: String(req.body.termsVersion || '').slice(0, 64), marketing: Boolean(req.body.marketing), marketingAt: req.body.marketing ? at : null }
    : undefined;
  let user;
  try {
    user = await withInviteCode(req.body.inviteCode, email, (inviteCode) =>
      User.create({ name, email, password, inviteCode, ...(legal ? { legal } : {}) }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message, code: err.code });
    throw err;
  }
  res.status(201).json(await authPayload(user));
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !user.password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  if (!(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  res.json(await authPayload(user));
}

async function getMe(req, res) {
  const hasInstagramProfile = await userHasInstagramProfile(req.user._id);
  res.json({
    user: { ...toPublicUser(req.user), hasInstagramProfile },
  });
}

const DEMO_EMAIL = 'demo@widesignals.com';
const DEMO_PASSWORD = 'test123';

async function demoLogin(req, res) {
  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) {
    user = await User.create({ name: 'Demo User', email: DEMO_EMAIL, password: DEMO_PASSWORD });
  }

  res.json(await authPayload(user));
}

/* `accessToken` (the custom-styled "Continue with Google" button, implicit flow): checked against our
   client id with Google's tokeninfo, then the profile read from userinfo. */
async function googleProfileFromAccessToken(accessToken) {
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!info.ok) throw new Error('tokeninfo failed');
  const tok = await info.json();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (tok.aud !== clientId && tok.azp !== clientId) throw new Error('wrong audience');
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error('userinfo failed');
  const p = await res.json();
  if (!p.sub || p.sub !== tok.sub) throw new Error('subject mismatch');
  if (p.email && p.email_verified === false) throw new Error('email not verified');
  return p;
}

async function googleAuth(req, res) {
  const { credential, accessToken } = req.body;
  if (!credential && !accessToken) {
    return res.status(400).json({ message: 'Google credential is required' });
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ message: 'Google sign-in is not configured' });
  }

  let payload;
  try {
    if (credential) {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } else {
      payload = await googleProfileFromAccessToken(String(accessToken));
    }
  } catch {
    return res.status(401).json({ message: 'Invalid Google credential' });
  }

  const { sub: googleId, email, name, picture } = payload;
  if (!email) {
    return res.status(400).json({ message: 'Google account must have an email address' });
  }

  const normalizedEmail = email.toLowerCase();
  let user = await User.findOne({ googleId });
  let created = false;

  if (!user) {
    user = await User.findOne({ email: normalizedEmail });
    if (user) {
      if (user.googleId && user.googleId !== googleId) {
        return res.status(409).json({ message: 'Email is linked to a different Google account' });
      }
      user.googleId = googleId;
      if (picture) user.avatar = picture;
      await user.save();
    } else {
      // a new account: what the Create account form agreed to (Terms required there, news optional)
      const at = new Date();
      const legal = req.body.acceptTerms
        ? { termsAcceptedAt: at, termsVersion: String(req.body.termsVersion || '').slice(0, 64), marketing: Boolean(req.body.marketing), marketingAt: req.body.marketing ? at : null }
        : undefined;
      // a new account needs an invitation code, as email sign-up does; an existing one never does
      try {
        user = await withInviteCode(req.body.inviteCode, normalizedEmail, (inviteCode) => User.create({
          name: name || normalizedEmail.split('@')[0],
          email: normalizedEmail,
          googleId,
          authProvider: 'google',
          avatar: picture || '',
          inviteCode,
          ...(legal ? { legal } : {}),
        }));
      } catch (err) {
        if (err.status) return res.status(err.status).json({ message: err.message, code: err.code });
        throw err;
      }
      created = true;
    }
  } else if (picture && user.avatar !== picture) {
    user.avatar = picture;
    await user.save();
  }

  res.status(created ? 201 : 200).json({ ...(await authPayload(user)), created });
}

module.exports = { register, login, getMe, demoLogin, googleAuth };
