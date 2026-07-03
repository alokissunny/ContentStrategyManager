const User = require('../models/User');
const generateToken = require('../utils/generateToken');

function toPublicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    business: user.business,
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
  res.status(201).json({
    user: toPublicUser(user),
    token: generateToken(user._id),
  });
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  res.json({
    user: toPublicUser(user),
    token: generateToken(user._id),
  });
}

async function getMe(req, res) {
  res.json({ user: toPublicUser(req.user) });
}

const DEMO_EMAIL = 'demo@widesignals.com';
const DEMO_PASSWORD = 'demo-password-1234';

async function demoLogin(req, res) {
  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) {
    user = await User.create({ name: 'Demo User', email: DEMO_EMAIL, password: DEMO_PASSWORD });
  }

  res.json({
    user: toPublicUser(user),
    token: generateToken(user._id),
  });
}

module.exports = { register, login, getMe, demoLogin };
