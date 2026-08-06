/**
 * Seed a local test user for Postman / API debugging.
 *
 *   npm run seed:test
 *
 * Credentials (overridable via env):
 *   TEST_EMAIL / TEST_PASSWORD / TEST_NAME
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const TEST_EMAIL = (process.env.TEST_EMAIL || 'test@bauhly.com').toLowerCase();
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'test-password-1234';
const TEST_NAME = process.env.TEST_NAME || 'Test User';

async function seedTestUser() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  let user = await User.findOne({ email: TEST_EMAIL }).select('+password');

  if (user) {
    // Reset password so the known test credentials always work.
    user.password = TEST_PASSWORD;
    user.name = TEST_NAME;
    user.authProvider = 'local';
    await user.save();
    console.log(`Updated test user: ${TEST_EMAIL}`);
  } else {
    user = await User.create({
      name: TEST_NAME,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      authProvider: 'local',
      role: 'user',
    });
    console.log(`Created test user: ${TEST_EMAIL}`);
  }

  console.log('');
  console.log('Postman → Auth → Test Login');
  console.log(`  POST {{baseUrl}}/api/auth/login`);
  console.log(`  email:    ${TEST_EMAIL}`);
  console.log(`  password: ${TEST_PASSWORD}`);
  console.log('');

  await mongoose.disconnect();
}

seedTestUser()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to seed test user:', err.message);
    process.exit(1);
  });
