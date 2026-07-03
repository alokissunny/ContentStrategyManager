const mongoose = require('mongoose');

const signalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: {
      type: String,
      enum: ['audience', 'market', 'opportunity'],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    source: { type: String, trim: true, default: '' },
    score: { type: Number, min: 0, max: 100, default: 0 },
    status: {
      type: String,
      enum: ['new', 'reviewed', 'actioned', 'dismissed'],
      default: 'new',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Signal', signalSchema);
