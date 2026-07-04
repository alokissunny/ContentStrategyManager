const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const signalRoutes = require('./routes/signalRoutes');
const routeRoutes = require('./routes/routeRoutes');
const instagramRoutes = require('./routes/instagramRoutes');
const analysisRoutes = require('./routes/analysisRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/signals', signalRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/analysis', analysisRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
