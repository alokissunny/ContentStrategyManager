const mongoose = require('mongoose');

// App-wide key/value settings that must persist across restarts and be read by
// the server at request time (e.g. which model + reasoning effort the carousel
// agent runs with). One document per key.
const appSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, collection: 'appsettings' },
);

module.exports = mongoose.model('AppSetting', appSettingSchema);
