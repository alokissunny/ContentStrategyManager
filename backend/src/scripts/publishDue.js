/**
 * Daily scheduled-publish run.
 *
 *   node src/scripts/publishDue.js
 *
 * Posts to POST /api/internal/publish-due when API_BASE_URL is set (Render cron
 * waking the web service). Otherwise runs the job in-process against MongoDB
 * (local / fallback).
 */
require('dotenv').config();
const connectDB = require('../config/db');
const { runPublishDue, cronSecret } = require('../services/schedulePublish');

async function postToApi() {
  const base = String(process.env.API_BASE_URL || '').replace(/\/$/, '');
  const secret = cronSecret();
  if (!base || !secret) return null;
  const res = await fetch(`${base}/api/internal/publish-due`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || `publish-due failed (${res.status})`);
  }
  return json;
}

async function main() {
  try {
    if (process.env.API_BASE_URL && cronSecret()) {
      try {
        const viaApi = await postToApi();
        console.log('[schedule] via API', viaApi);
        return;
      } catch (err) {
        console.warn('[schedule] API publish-due failed, running in-process:', err.message);
      }
    }
    await connectDB();
    const summary = await runPublishDue();
    console.log('[schedule] in-process', summary);
  } catch (err) {
    console.error('[schedule] publishDue failed:', err.message);
    process.exitCode = 1;
  } finally {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState) await mongoose.disconnect();
    } catch (_) {
      /* ignore */
    }
  }
}

main();
