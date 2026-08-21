const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const signalRoutes = require('./routes/signalRoutes');
const routeRoutes = require('./routes/routeRoutes');
const projectRoutes = require('./routes/projectRoutes');
const instagramRoutes = require('./routes/instagramRoutes');
const competitorRoutes = require('./routes/competitorRoutes');
const analysisRoutes = require('./routes/analysisRoutes');
const metaRoutes = require('./routes/metaRoutes');
const imageRoutes = require('./routes/imageRoutes');
const visualBrandRoutes = require('./routes/visualBrandRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const debugRoutes = require('./routes/debugRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
const jsonParser = express.json();
const debugJsonParser = express.json({ limit: '4mb' });
app.use((req, res, next) => {
  // Voice-note transcription sends a raw audio body, not JSON.
  if (req.originalUrl.includes('/projects/captures/transcribe')) return next();
  // Prompt-debug reruns send the full captured Input, which can exceed the
  // default 100kb JSON limit (weekly-plan prompts especially).
  if (req.originalUrl.includes('/debug/rerun-prompt')) return debugJsonParser(req, res, next);
  return jsonParser(req, res, next);
});
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/signals', signalRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/competitors', competitorRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/visual-brand', visualBrandRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/debug', debugRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
