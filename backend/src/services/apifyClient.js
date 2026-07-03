const { ApifyClient } = require('apify-client');

let client;

function getApifyClient() {
  if (!process.env.APIFY_TOKEN) {
    throw new Error('APIFY_TOKEN is not set. Add it to backend/.env to enable Instagram scraping.');
  }
  if (!client) {
    client = new ApifyClient({ token: process.env.APIFY_TOKEN });
  }
  return client;
}

module.exports = getApifyClient;
