const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const { getPresignedDownloadUrl, getObjectText, uploadMarkdown } = require('../services/s3Client');
const { mergeConfirmedSummary, BRAND_DNA_FIELDS, parseBrandDna, mergeBrandDna } = require('../services/brandAnalysis');

function buildBrandDnaSections(report, parsedFromMarkdown) {
  const sections = BRAND_DNA_FIELDS.map(({ key, label, description, inferred }) => ({
    key,
    label,
    description,
    inferred,
    value: report[key] || parsedFromMarkdown[key] || '',
  }));
  const completedCount = sections.filter((s) => s.value.trim().length > 0).length;
  return { sections, completedCount, totalSections: sections.length };
}

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

async function getLatestBrandDna(req, res) {
  const report = await BrandAnalysisReport.findOne({ user: req.user._id }).sort({ createdAt: -1 });
  if (!report) {
    return res.status(404).json({ message: 'No analysis report yet. Connect your Instagram to generate one.' });
  }

  const markdown = await getObjectText(report.s3Key);
  const parsed = parseBrandDna(markdown);
  res.json({ reportId: report._id, ...buildBrandDnaSections(report, parsed) });
}

async function updateBrandDna(req, res) {
  const report = await BrandAnalysisReport.findOne({ _id: req.params.id, user: req.user._id });
  if (!report) {
    return res.status(404).json({ message: 'Report not found' });
  }

  const fields = {};
  BRAND_DNA_FIELDS.forEach(({ key }) => {
    fields[key] = req.body.sections?.[key] ?? report[key] ?? '';
    report[key] = fields[key];
  });

  const existingMarkdown = await getObjectText(report.s3Key);
  const mergedMarkdown = mergeBrandDna(existingMarkdown, fields);
  await uploadMarkdown(report.s3Key, mergedMarkdown);

  await report.save();

  res.json({ reportId: report._id, ...buildBrandDnaSections(report, fields) });
}

module.exports = { listReports, getReportDownloadUrl, confirmReport, getLatestBrandDna, updateBrandDna };
