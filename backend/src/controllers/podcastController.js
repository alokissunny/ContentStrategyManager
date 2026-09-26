const jobs = require('../services/podcastJobs');
const respond = action => async (req, res) => {
  try { const result = await action(req); res.status(req.method === 'POST' ? 202 : 200).json(result); }
  catch (error) { res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Podcast request could not be completed.' }); }
};
exports.create = respond(req => jobs.create(req.body || {}, req.user._id));
exports.status = respond(req => jobs.refreshStatus(req.params.id, req.user._id));
exports.render = respond(req => jobs.render(req.params.id, req.user._id, req.body || {}));
exports.cancel = respond(req => jobs.cancel(req.params.id, req.user._id));
