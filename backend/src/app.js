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
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());
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

app.use(notFound);
app.use(errorHandler);

module.exports = app;
