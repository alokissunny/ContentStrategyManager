const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, minlength: 6, select: false },
    googleId: { type: String, unique: true, sparse: true },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
    avatar: { type: String, trim: true, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    business: {
      name: { type: String, trim: true, default: '' },
      goals: { type: String, trim: true, default: '' },
      audience: { type: String, trim: true, default: '' },
      positioning: { type: String, trim: true, default: '' },
    },
    // The studio's visual brand. `moodImages` are the reference pictures added on
    // the Library Settings page ("Visual Mood") — the DB keeps only the S3 object
    // key; the bytes live in S3 and the client is handed short-lived presigned
    // read URLs (see visualBrandController). Each image is tagged with the
    // Instagram `handle` it was added under, so switching accounts in the header
    // shows that account's own mood — the same account-scoping as projects/plans.
    visualBrand: {
      moodImages: {
        type: [
          {
            key: { type: String, required: true },
            title: { type: String, trim: true, default: '' },
            handle: { type: String, trim: true, lowercase: true, default: '' },
            addedAt: { type: Number, default: () => Date.now() },
          },
        ],
        default: [],
      },
      // The Library Settings the studio applies — palette, type/fonts, which
      // layouts are on, and the palette readings from each mood image. These
      // used to live only in the browser's localStorage, so the same account saw
      // different settings on different origins (localhost vs prod) and nothing
      // survived a cleared cache. Now they persist server-side, one blob per
      // Instagram `handle` (same account-scoping as moodImages), so the library
      // follows the account, not the browser. `data` is an opaque client blob
      // (the store's synced fields); the server only scopes and stores it.
      settings: {
        type: [
          {
            handle: { type: String, trim: true, lowercase: true, default: '' },
            data: { type: mongoose.Schema.Types.Mixed, default: {} },
            updatedAt: { type: Number, default: () => Date.now() },
          },
        ],
        default: [],
      },
    },
    // Pictures the studio generated in WeekView's "Create image" flow. The DB keeps
    // only the S3 object key (bytes live in S3, handed back as short-lived
    // presigned URLs) plus the prompt/model for reference. Tagged with the
    // Instagram `handle` it was made under, so — like mood images and plans — the
    // "Generated" asset folder switches with the account in the header. Persisting
    // these is what lets a generated image survive a tab switch / reload (its
    // slide's assetKey resolves against this list, not just session state).
    generatedImages: {
      type: [
        {
          key: { type: String, required: true },
          prompt: { type: String, default: '' },
          model: { type: String, default: '' },
          handle: { type: String, trim: true, lowercase: true, default: '' },
          addedAt: { type: Number, default: () => Date.now() },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
