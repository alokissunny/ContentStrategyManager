const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const { getPresignedDownloadUrl, getObjectText, uploadMarkdown } = require('../services/s3Client');
const { mergeConfirmedSummary } = require('../services/brandAnalysis');

async function listReports(req, res) {
  const reports = await BrandAnalysisReport.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ reports });
}

async function getReportDownloadUrl(req, res) {
  const report = await BrandAnalysisReport.findOne({ _id: req.params.id, user: req.user._id });
  if (!report) {
    return res.status(404).json({ message: 'Report not found' });
  }
  const downloadUrl = await getPresignedDownloadUrl(report.s3Key);
  res.json({ downloadUrl });
}

async function confirmReport(req, res) {
  const report = await BrandAnalysisReport.findOne({ _id: req.params.id, user: req.user._id });
  if (!report) {
    return res.status(404).json({ message: 'Report not found' });
  }

  const summary = {
    whoYouHelp: req.body.whoYouHelp || report.whoYouHelp,
    whatYouOffer: req.body.whatYouOffer || report.whatYouOffer,
    howYouSound: req.body.howYouSound || report.howYouSound,
  };

  const existingMarkdown = await getObjectText(report.s3Key);
  const mergedMarkdown = mergeConfirmedSummary(existingMarkdown, summary);
  await uploadMarkdown(report.s3Key, mergedMarkdown);

  report.whoYouHelp = summary.whoYouHelp;
  report.whatYouOffer = summary.whatYouOffer;
  report.howYouSound = summary.howYouSound;
  report.confirmedAt = new Date();
  await report.save();

  const downloadUrl = await getPresignedDownloadUrl(report.s3Key);
  res.json({ report, downloadUrl });
}

module.exports = { listReports, getReportDownloadUrl, confirmReport };
