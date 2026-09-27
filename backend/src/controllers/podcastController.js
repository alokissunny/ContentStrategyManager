const jobs = require('../services/podcastJobs');
const respond = action => async (req, res) => {
  try { const result = await action(req); res.status(req.method === 'POST' ? 202 : 200).json(result); }
  catch (error) { res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Podcast request could not be completed.' }); }
};
exports.create = respond(req => jobs.create(req.body || {}, req.user._id));
exports.status = respond(req => jobs.refreshStatus(req.params.id, req.user._id));
exports.render = respond(req => jobs.render(req.params.id, req.user._id, req.body || {}));
exports.cancel = respond(req => jobs.cancel(req.params.id, req.user._id));

exports.output = respond(async req => {
  const key = req.query.key;
  if (typeof key !== 'string' || !key.startsWith(`projects/${req.user._id}/`) || !/^projects\/[a-f0-9]{24}\/[A-Za-z0-9_-]+-podcast\.mp4$/i.test(key)) throw Object.assign(new Error('Podcast output does not belong to this account.'), { statusCode: 400 });
  return { key, url: await require('../services/s3Client').getPresignedDownloadUrl(key) };
});
