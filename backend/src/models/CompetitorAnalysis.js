const mongoose = require('mongoose');

/*
 * Read-only view of the back office's `competitoranalyses` collection in the
 * shared database. The back office owns the schema and writes these documents;
 * the customer app only reads the latest completed dashboard to show a user the
 * analysis for their assigned competitor cohort. `strict: false` lets the full
 * dashboard payload pass through untouched.
 */
const competitorAnalysisSchema = new mongoose.Schema(
  {
    status: String,
    dashboard: mongoose.Schema.Types.Mixed,
    markdown: String,
    accountsAnalyzed: Number,
    postsAnalyzed: Number,
    filterScope: mongoose.Schema.Types.Mixed,
    startedAt: Date,
    finishedAt: Date,
  },
  { collection: 'competitoranalyses', strict: false },
);

module.exports =
  mongoose.models.CompetitorAnalysis ||
  mongoose.model('CompetitorAnalysis', competitorAnalysisSchema);
