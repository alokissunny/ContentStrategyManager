/**
 * Seed (or promote) an admin account.
 *
 *   node src/scripts/seedAdmin.js
 *
 * Reads MONGO_URI from the environment (same as the API). The admin's
 * credentials come from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME, falling
 * back to sensible defaults. If a user with that email already exists it is
 * promoted to `admin` (its password is left untouched); otherwise a new
 * local-auth admin is created.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const InstagramProfile = require('../models/InstagramProfile');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@widesignals.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin-password-1234';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin';

async function seedAdmin() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  // Older databases have a single-field unique index on InstagramProfile.user
  // (from when each user could only have one handle). Drop it so admins can
  // connect multiple handles; the model now enforces uniqueness on user+username.
  try {
    const indexes = await InstagramProfile.collection.indexes();
    if (indexes.some((ix) => ix.name === 'user_1')) {
      await InstagramProfile.collection.dropIndex('user_1');
      console.log('Dropped stale unique index InstagramProfile.user_1');
    }
  } catch (err) {
    console.warn(`Could not check/drop stale index: ${err.message}`);
  }
  await InstagramProfile.syncIndexes();

  let user = await User.findOne({ email: ADMIN_EMAIL });

  if (user) {
    if (user.role === 'admin') {
      console.log(`Already an admin: ${ADMIN_EMAIL}`);
    } else {
      user.role = 'admin';
      await user.save();
      console.log(`Promoted existing user to admin: ${ADMIN_EMAIL}`);
    }
  } else {
    user = await User.create({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'admin',
    });
    console.log(`Created admin: ${ADMIN_EMAIL} (password: ${ADMIN_PASSWORD})`);
  }

  await mongoose.disconnect();
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to seed admin:', err.message);
    process.exit(1);
  });
