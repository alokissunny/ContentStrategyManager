const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    externalId: String,
    caption: String,
    likesCount: Number,
    commentsCount: Number,
    timestamp: Date,
    type: String,
    url: String,
    displayUrl: String,
  },
  { _id: false }
);

const instagramProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true, trim: true, lowercase: true },
    fullName: { type: String, default: '' },
    biography: { type: String, default: '' },
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    postsCount: { type: Number, default: 0 },
    profilePicUrl: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },
    externalUrl: { type: String, default: '' },
    posts: [postSchema],
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One document per (user, handle). Admins can connect several handles;
// non-admins are held to a single profile in the controller.
instagramProfileSchema.index({ user: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('InstagramProfile', instagramProfileSchema);
