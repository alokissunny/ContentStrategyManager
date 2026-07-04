const InstagramProfile = require('../models/InstagramProfile');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const { scrapeProfile, scrapePosts } = require('../services/instagramScraper');
const { generateBrandAnalysis } = require('../services/brandAnalysis');
const { uploadMarkdown, getPresignedDownloadUrl } = require('../services/s3Client');

function extractUsername(input) {
  return (input || '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?].*$/, '')
    .trim()
    .toLowerCase();
}

async function fetchInstagram(req, res) {
  const username = extractUsername(req.body.username);
  if (!username) {
    return res.status(400).json({ message: 'Instagram username or profile URL is required' });
  }

  const [profile, posts] = await Promise.all([scrapeProfile(username), scrapePosts(username)]);

  if (!profile) {
    return res.status(404).json({ message: 'Could not read this Instagram profile. It may be private or the username may be wrong.' });
  }

  const snapshot = await InstagramProfile.findOneAndUpdate(
    { user: req.user._id },
    { ...profile, user: req.user._id, username, posts, fetchedAt: new Date() },
    { new: true, upsert: true }
  );

  let report = null;
  let reportError = null;
  try {
    const { markdown, quickSummary, model } = await generateBrandAnalysis(snapshot);
    const s3Key = `reports/${req.user._id}/${username}-${Date.now()}.md`;
    await uploadMarkdown(s3Key, markdown);
    const reportDoc = await BrandAnalysisReport.create({
      user: req.user._id,
      instagramUsername: username,
      s3Key,
      model,
      whoYouHelp: quickSummary?.whoYouHelp || '',
      whatYouOffer: quickSummary?.whatYouOffer || '',
      howYouSound: quickSummary?.howYouSound || '',
    });
    report = {
      id: reportDoc._id,
      createdAt: reportDoc.createdAt,
      downloadUrl: await getPresignedDownloadUrl(s3Key),
      whoYouHelp: reportDoc.whoYouHelp,
      whatYouOffer: reportDoc.whatYouOffer,
      howYouSound: reportDoc.howYouSound,
    };
  } catch (err) {
    reportError = err.message;
  }

  res.json({ profile: snapshot, report, reportError });
}

async function getInstagramProfile(req, res) {
  const snapshot = await InstagramProfile.findOne({ user: req.user._id });
  res.json({ profile: snapshot });
}

module.exports = { fetchInstagram, getInstagramProfile };
