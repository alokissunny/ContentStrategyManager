/*
 * The three steps of a queued plan run (see services/planQueue). Each is the
 * matching slice of the synchronous path — postController.generateAndSavePosts
 * → weeklyPlan.generateWeeklyPlan → planOrchestrator.runMultiAgentPlan — so a
 * queued run saves the same posts the sync path would. They know nothing about
 * BullMQ: workers/planWorkers.js calls them.
 */
const PlanRun = require('../models/PlanRun');
const PlanRunPost = require('../models/PlanRunPost');
const PlannedPost = require('../models/PlannedPost');
const InstagramProfile = require('../models/InstagramProfile');
const { generateWeeklyPlan, prepareWeeklyPlan, multiAgentArgsOf, finishWeeklyPlan } = require('./weeklyPlan');
const { runStrategistPhase, writePlanDay, assemblePlanResult } = require('./planOrchestrator');
const { loadProjectAssets } = require('./planInputs');
const { loadRuntimeSettings } = require('./runtimeSettings');
const { seconds } = require('./planRunLog');

// Lazy: postController requires planQueue, which must not pull these steps in.
function posts() {
  return require('../controllers/postController');
}

function planSourceOf(run) {
  const src = run.planSource || {};
  return {
    sessionId: src.sessionId || '',
    captureIds: Array.isArray(src.captureIds) ? src.captureIds : [],
    allowedWeekdays: Array.isArray(src.allowedWeekdays) ? src.allowedWeekdays : null,
  };
}

function readState(run) {
  if (!run?.state) throw new Error(`plan run ${run?._id} has no stored state`);
  return JSON.parse(run.state);
}

// Same loader (and same empty-on-error fallback) as loadGenerationInputs.
function reloadProjects(run) {
  return loadProjectAssets(run.user, run.instagramUsername).catch((err) => {
    console.error('[planRun] could not load projects for plan:', err.message);
    return [];
  });
}

// Store what POST /posts/generate would have answered and close the run.
async function completeRun(run, out) {
  const count = Number(out?.count) || 0;
  // Mirrors generatePlan's response: an emptyReason with no posts is a 422
  // (needs-input when the Strategist asked for more); otherwise it's a 200, even
  // with 0 posts (every slot got filled meanwhile).
  const status = (!count && out?.emptyReason)
    ? (out.needsInput ? 'needs-input' : 'failed')
    : 'done';
  await PlanRun.updateOne({ _id: run._id }, {
    $set: {
      status,
      result: {
        postIds: (out?.posts || []).map((p) => p._id).filter(Boolean),
        count,
        emptyReason: out?.emptyReason || '',
        needsInput: Boolean(out?.needsInput),
        debug: out?.debug ? JSON.stringify(out.debug) : '',
      },
      error: status === 'failed' ? (out?.emptyReason || posts().PLAN_FAILED_REASON) : '',
      finishedAt: new Date(),
      ...(status !== 'failed' ? { state: '' } : {}),
    },
  });
  if (status !== 'failed') await PlanRunPost.deleteMany({ run: run._id }).catch(() => {});
  const total = run.createdAt ? Date.now() - new Date(run.createdAt).getTime() : 0;
  console.log(
    `[planRun] run ${status} · ${count} post(s)` +
      ((out?.posts || []).length ? ` on ${(out.posts || []).map((p) => p.date).filter(Boolean).join(', ')}` : '') +
      (out?.emptyReason && !count ? ` · reason: ${out.emptyReason}` : '') +
      (total ? ` · ${seconds(total)} from click to saved` : ''),
  );
  return status;
}

async function failRun(runId, message) {
  await PlanRun.updateOne(
    { _id: runId, status: { $nin: ['done', 'needs-input', 'failed'] } },
    { $set: { status: 'failed', error: message || posts().PLAN_FAILED_REASON, finishedAt: new Date() } },
  );
}

// Save a finished plan's posts, tagged with the run so a retried finalize can
// tell its own earlier inserts from posts that were already on the calendar.
async function savePlan(run, plan) {
  const { savePlanAsPosts, markCapturesUsed } = posts();
  const already = await PlannedPost.find({ planRunId: run._id });
  if (already.length) console.log(`[planRun] ${already.length} post(s) already saved by an earlier attempt — not inserting again`);
  const out = already.length
    ? { posts: already, count: already.length, debug: plan.debug || null, emptyReason: '' }
    : await savePlanAsPosts(run.user, run.instagramUsername, run.trigger, plan, { planRunId: run._id });
  if (out.count) await markCapturesUsed(run.user, planSourceOf(run).captureIds, out.posts);
  return out;
}

/**
 * plan-run job: load inputs, run the Strategist, store the dated briefs.
 * Returns { posts } — how many post jobs to start — or { done: true } when the
 * run finished here (nothing to fill, or the single-agent planner).
 */
async function runPlanStep(runId) {
  const run = await PlanRun.findById(runId);
  if (!run) return { done: true };
  if (['done', 'needs-input', 'failed'].includes(run.status)) return { done: true };
  // A retried job whose Strategist output is already stored only re-adds the
  // post jobs (their ids are deterministic, so nothing runs twice).
  if (run.state && ['writing', 'finalizing'].includes(run.status)) {
    return { posts: run.totalPosts };
  }

  await PlanRun.updateOne({ _id: run._id }, { $set: { status: 'planning', startedAt: run.startedAt || new Date() } });
  await loadRuntimeSettings(); // pick up Settings changes made since this worker booted

  const profile = await InstagramProfile.findOne({ user: run.user, username: run.instagramUsername });
  if (!profile) {
    await failRun(run._id, 'No Instagram profile found. Connect and analyze a handle before generating posts.');
    return { done: true };
  }
  const planSource = planSourceOf(run);
  const { loadGenerationInputs, planOptionsOf } = posts();
  const inputs = await loadGenerationInputs(run.user, profile, run.trigger, planSource);
  const options = planOptionsOf(inputs, run.user, planSource);
  const pre = prepareWeeklyPlan(profile, inputs.brandDna, inputs.competitorInsights, inputs.projects, options);

  if (pre.earlyResult || !pre.useMulti) {
    // Nothing to fill, or PLAN_MULTI_AGENT=0: one call does it all, in this job.
    const plan = pre.earlyResult
      || await generateWeeklyPlan(profile, inputs.brandDna, inputs.competitorInsights, inputs.projects, options);
    await completeRun(run, await savePlan(run, plan));
    return { done: true };
  }

  const strategistStarted = Date.now();
  const phase = await runStrategistPhase(
    multiAgentArgsOf(pre, profile, inputs.brandDna, inputs.competitorInsights, inputs.projects, options),
  );
  const total = phase.plannedDays.length;
  await PlanRun.updateOne({ _id: run._id }, {
    $set: {
      state: JSON.stringify({ pre, phase, usedAssetKeys: [...(inputs.usedAssetKeys || [])] }),
      totalPosts: total,
      status: total ? 'writing' : 'finalizing',
    },
  });
  console.log(
    `[planRun] Strategist → ${total} brief(s) in ${seconds(Date.now() - strategistStarted)}` +
      (total ? ` · dates ${phase.plannedDays.map((d) => d.date).join(', ')}` : '') +
      (!total && phase.constraints?.insufficientContext ? ` · needs input: ${phase.constraints.insufficientContext}` : ''),
  );
  return { posts: total };
}

/**
 * plan-post job: write one post (Structure → Carousel → Visuals) and store it.
 * On the last attempt an error is recorded as a skipped day instead of thrown,
 * so the rest of the plan still finalizes.
 */
async function runPostStep(runId, index, { finalAttempt = true } = {}) {
  const existing = await PlanRunPost.findOne({ run: runId, index }).select('_id').lean();
  if (existing) {
    console.log(`[planRun] post ${index + 1} already written — nothing to do`);
    return { skipped: 'already written' };
  }
  const run = await PlanRun.findById(runId);
  if (!run || ['done', 'needs-input', 'failed'].includes(run.status)) return { skipped: 'run closed' };

  const { phase } = readState(run);
  const planned = phase.plannedDays[index];
  if (!planned) throw new Error(`plan run ${runId} has no brief ${index}`);

  await loadRuntimeSettings();
  const projects = await reloadProjects(run);
  console.log(`[planRun] writing post ${index + 1}/${phase.plannedDays.length} · ${planned.date} · ${planned.pillar || '?'} · "${String(planned.angle || '').slice(0, 60)}"`);
  const writeStarted = Date.now();
  let result;
  let status = 'done';
  let error = '';
  try {
    result = await writePlanDay(phase, projects, planned, index);
  } catch (err) {
    if (!finalAttempt) throw err;
    console.warn(`[planRun] post ${index + 1} failed on its last attempt — skipping it: ${err.message}`);
    status = 'failed';
    error = err.message;
    result = {
      index,
      dayBrief: { index, date: planned.date, day: planned.day },
      result: null,
      skipped: err.message,
      debugEntries: [],
      runUsages: [],
    };
  }
  if (status === 'done') {
    const slides = result?.content?.slides?.length || 0;
    const images = (result?.content?.visualTrace || []).filter((v) => v?.status === 'generated').length;
    console.log(
      `[planRun] post ${index + 1} ${result?.result ? 'written' : `skipped (${result?.skipped || 'no result'})`}` +
        ` in ${seconds(Date.now() - writeStarted)} · slides=${slides} · carousel=${result?.layout ? 'yes' : 'no'} · images=${images}`,
    );
  }
  await PlanRunPost.updateOne(
    { run: runId, index },
    { $set: { date: planned.date || '', status, error, result: JSON.stringify(result) } },
    { upsert: true },
  );
  return { status };
}

/**
 * plan-finalize job: every post job has finished. Assemble the day results in
 * brief order and save them — the same assembly and insert as the sync path.
 */
async function runFinalizeStep(runId) {
  const run = await PlanRun.findById(runId);
  if (!run || ['done', 'needs-input', 'failed'].includes(run.status)) return { status: run?.status || 'missing' };
  await PlanRun.updateOne({ _id: run._id }, { $set: { status: 'finalizing' } });

  const { pre, phase, usedAssetKeys } = readState(run);
  const rows = await PlanRunPost.find({ run: run._id }).sort({ index: 1 }).lean();
  const byIndex = new Map(rows.map((r) => [r.index, JSON.parse(r.result)]));
  // A post job that never stored a result (lost or failed outright) is a skipped day.
  const dayResults = phase.plannedDays.map((planned, index) => byIndex.get(index) || {
    index,
    dayBrief: { index, date: planned.date, day: planned.day },
    result: null,
    skipped: 'post job did not finish',
    debugEntries: [],
    runUsages: [],
  });

  const missing = phase.plannedDays.map((_, i) => i).filter((i) => !byIndex.has(i));
  const failed = rows.filter((r) => r.status === 'failed').map((r) => r.index);
  console.log(
    `[planRun] assembling ${rows.length}/${phase.plannedDays.length} post result(s)` +
      (failed.length ? ` · failed: ${failed.map((i) => i + 1).join(', ')}` : '') +
      (missing.length ? ` · never finished: ${missing.map((i) => i + 1).join(', ')}` : ''),
  );
  const projects = await reloadProjects(run);
  const generated = assemblePlanResult(phase, dayResults);
  const plan = finishWeeklyPlan(pre, generated, projects, { usedAssetKeys: new Set(usedAssetKeys || []) });
  const status = await completeRun(run, await savePlan(run, plan));
  return { status };
}

module.exports = {
  runPlanStep,
  runPostStep,
  runFinalizeStep,
  failRun,
};
