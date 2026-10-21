const mongoose = require('mongoose');

// A studio's link to its Canva account through Canva's MCP server
// (experimental "Design in Canva"). The OAuth client is registered with
// Canva per redirect URI (dynamic client registration), so it is kept here
// with the tokens. Tokens are encrypted (services/canvaMcp).
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  // { client_id, client_secret? } as Canva's /register answered, + the redirect it was registered for
  clientInformation: { type: mongoose.Schema.Types.Mixed, default: null },
  redirectUri: { type: String, default: '' },
  encryptedAccessToken: { type: String, select: false },
  encryptedRefreshToken: { type: String, select: false },
  tokenExpiresAt: Date,
  scopes: [String],
  connectedAt: Date,
  // pending authorization (PKCE verifier stays server-side)
  stateHash: { type: String, select: false },
  codeVerifier: { type: String, select: false },
  stateExpiresAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('CanvaConnection', schema);
