const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  // Deterministic ID makes each user/request pair atomic even before secondary indexes exist.
  _id: String,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  payloadHash: { type: String, required: true },
  organization: { type: String, required: true },
  preview: String,
  status: { type: String, enum: ['pending', 'published', 'failed', 'unknown'], default: 'pending' },
  postUrn: String,
  permalink: String,
  message: String,
}, { timestamps: true });

module.exports = mongoose.model('LinkedInPublication', schema);
