const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const InstagramProfile = require('../models/InstagramProfile');
const generateToken = require('../utils/generateToken');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function toPublicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar || '',
    business: user.business,
  };
}

async function userHasInstagramProfile(userId) {
  return Boolean(await InstagramProfile.exists({ user: userId }));
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

  const user = await User.create({ name, email, password });
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
const DEMO_PASSWORD = 'demo-password-1234';

async function demoLogin(req, res) {
  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) {
    user = await User.create({ name: 'Demo User', email: DEMO_EMAIL, password: DEMO_PASSWORD });
  }

  res.json(await authPayload(user));
}

async function googleAuth(req, res) {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ message: 'Google credential is required' });
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ message: 'Google sign-in is not configured' });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ message: 'Invalid Google credential' });
  }

  const { sub: googleId, email, name, picture } = payload;
  if (!email) {
    return res.status(400).json({ message: 'Google account must have an email address' });
  }

  const normalizedEmail = email.toLowerCase();
  let user = await User.findOne({ googleId });

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
      user = await User.create({
        name: name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        googleId,
        authProvider: 'google',
        avatar: picture || '',
      });
    }
  } else if (picture && user.avatar !== picture) {
    user.avatar = picture;
    await user.save();
  }

  res.json(await authPayload(user));
}

module.exports = { register, login, getMe, demoLogin, googleAuth };
