const InstagramProfile = require('../models/InstagramProfile');

// Older DBs may still have a unique index on `user` alone (single-handle era).
// Drop it and sync the compound unique index so any user can connect multiple
// Instagram accounts.
async function ensureInstagramIndexes() {
  try {
    const indexes = await InstagramProfile.collection.indexes();
    if (indexes.some((ix) => ix.name === 'user_1')) {
      await InstagramProfile.collection.dropIndex('user_1');
      console.log('Dropped stale unique index InstagramProfile.user_1');
    }
  } catch (err) {
    console.warn(`Could not check/drop stale InstagramProfile index: ${err.message}`);
  }
  await InstagramProfile.syncIndexes();
}

module.exports = ensureInstagramIndexes;
