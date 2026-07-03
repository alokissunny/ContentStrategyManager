const InstagramProfile = require('../models/InstagramProfile');
const { scrapeProfile, scrapePosts } = require('../services/instagramScraper');

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

  res.json({ profile: snapshot });
}

async function getInstagramProfile(req, res) {
  const snapshot = await InstagramProfile.findOne({ user: req.user._id });
  res.json({ profile: snapshot });
}

module.exports = { fetchInstagram, getInstagramProfile };
