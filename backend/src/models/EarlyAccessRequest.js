const mongoose = require('mongoose');

const earlyAccessRequestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    instagramHandle: { type: String, required: true, trim: true, lowercase: true },
  },
  { timestamps: true, collection: 'earlyaccessrequests' },
);

earlyAccessRequestSchema.index({ instagramHandle: 1 }, { unique: true });

module.exports = mongoose.model('EarlyAccessRequest', earlyAccessRequestSchema);
