const mongoose = require('mongoose');

// A reference photo the studio uploaded for Editor › Themes › Upload a
// reference. Saved the first time it is applied so it shows under Choose from
// library › Your references and can be applied again without re-uploading.
// `designRules` is the Design Rules agent's read of it (services/themeDesignRules.js)
// — reused on every re-apply instead of extracting it again.
const themeReferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    key: { type: String, required: true, trim: true }, // projects/<uid>/<file>
    name: { type: String, trim: true, default: '' },
    designRules: { type: mongoose.Schema.Types.Mixed, default: null },
    rulesModel: { type: String, default: '' },
    lastUsedAt: { type: Date, default: Date.now },
    uses: { type: Number, default: 0 },
  },
  { timestamps: true }
);

themeReferenceSchema.index({ user: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('ThemeReference', themeReferenceSchema);
