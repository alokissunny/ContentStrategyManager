const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  memberId: String,
  name: String,
  connectedAt: Date,
  companyAuthorizedAt: Date,
  encryptedAccessToken: { type: String, select: false },
  tokenExpiresAt: Date,
  scopes: [String],
  selectedOrganization: String,
  stateHash: { type: String, select: false },
  stateExpiresAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('LinkedInConnection', schema);
