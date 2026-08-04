const mongoose = require('mongoose');

/*
 * Read-only view of the back office's `backoffice_customer_cohorts` collection
 * in the shared database. An operator assigns each Instagram handle a competitor
 * cohort (Business Type + Location) in the back office; the customer app reads
 * it (scoped to the active handle) to pick which competitor analysis to show.
 */
const customerCohortSchema = new mongoose.Schema(
  {
    user: mongoose.Schema.Types.ObjectId,
    instagramUsername: String,
    businessCategory: String,
    location: String,
  },
  { collection: 'backoffice_customer_cohorts', strict: false },
);

module.exports =
  mongoose.models.CustomerCohort ||
  mongoose.model('CustomerCohort', customerCohortSchema);
