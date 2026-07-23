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

/** True when Mongo already has at least one Brand Profile field — no S3 round-trip needed. */
function hasStoredBrandDna(report) {
  return BRAND_DNA_FIELDS.some(({ key }) => String(report[key] || '').trim().length > 0);
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
  const report = await BrandAnalysisReport.findOne({ user: req.user._id })
    .sort({ createdAt: -1 })
    .select(['_id', 's3Key', ...BRAND_DNA_FIELDS.map(({ key }) => key)].join(' '))
    .lean();

  if (!report) {
    return res.status(404).json({
      message: 'No analysis report yet. Connect your Instagram to generate one.',
    });
  }

  // Fast path: Brand Profile fields live on the report document. Avoid a
  // blocking S3 download on every Brand profile tab open.
  let parsed = {};
  if (!hasStoredBrandDna(report) && report.s3Key) {
    try {
      const markdown = await getObjectText(report.s3Key);
      parsed = parseBrandDna(markdown);
      // Backfill Mongo so the next load stays on the fast path.
      if (Object.keys(parsed).length > 0) {
        const $set = {};
        for (const { key } of BRAND_DNA_FIELDS) {
          if (parsed[key]) $set[key] = parsed[key];
        }
        if (Object.keys($set).length > 0) {
          BrandAnalysisReport.updateOne({ _id: report._id }, { $set }).catch((err) => {
            console.warn('[brandDna] backfill failed:', err.message);
          });
        }
      }
    } catch (err) {
      console.warn('[brandDna] S3 fallback failed:', err.message);
    }
  }

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

  await report.save();

  // Respond from Mongo first — S3 markdown sync is best-effort and must not
  // block Save on the Brand profile page.
  res.json({ reportId: report._id, ...buildBrandDnaSections(report, fields) });

  if (report.s3Key) {
    getObjectText(report.s3Key)
      .then((existingMarkdown) =>
        uploadMarkdown(report.s3Key, mergeBrandDna(existingMarkdown, fields)),
      )
      .catch((err) => console.warn('[brandDna] S3 sync failed:', err.message));
  }
}

module.exports = { listReports, getReportDownloadUrl, confirmReport, getLatestBrandDna, updateBrandDna };
