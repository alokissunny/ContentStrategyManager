const mongoose = require('mongoose');

const routeItemSchema = new mongoose.Schema(
  {
    signal: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal' },
    action: { type: String, required: true, trim: true },
    stage: { type: String, enum: ['educate', 'prove', 'engage'], required: true },
    done: { type: Boolean, default: false },
  },
  { _id: false }
);

const weeklyRouteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    weekOf: { type: Date, required: true },
    items: [routeItemSchema],
    performance: {
      metric: { type: String, default: 'Engagement' },
      value: { type: Number, default: 0 },
      changePercent: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WeeklyRoute', weeklyRouteSchema);
