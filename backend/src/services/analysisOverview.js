/*
 * Analysis Overview — structured "Your analysis" modal payload.
 *
 * Grounded only in: Instagram snapshot, Brand DNA, authority funnel,
 * assigned cohort dashboard (when present), and the current weekly route.
 * Peer figures appear only when the cohort analysis actually provides them.
 */

const { computeAuthorityFunnel } = require('./authorityFunnel');

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const BUSINESS_LABELS = {
  'interior-designer': 'Interior design studios',
  'bauhly-competitor': 'Instagram content strategists',
  other: 'Similar businesses',
};

const FOCUS = {
  discovery: {
    label: 'Get noticed',
    tagline: 'Helps people outside your current audience find and notice your work.',
    icon: 'discovery',
  },
  credibility: {
    label: 'Show expertise',
    tagline: 'Makes people trust how you think — the reason they save and quote you.',
    icon: 'credibility',
  },
  trust: {
    label: 'Build confidence',
    tagline: 'Turns admiration into enquiries — proof that you can do it for them.',
    icon: 'trust',
  },
};

// Same keyword families as authorityFunnel so shares stay consistent.
const EDUCATIONAL_KEYWORDS = [
  'how to', 'how i', 'tips', 'tip:', 'guide', 'why ', 'step', 'learn', 'mistake',
  'avoid', 'process', 'tutorial', 'lesson', 'framework', 'the truth about', 'things you',
];
const PROOF_KEYWORDS = [
  'client', 'project', 'result', 'before', 'after', 'testimonial', 'review',
  'case study', 'delivered', 'completed', 'finished', 'proud', 'launch', 'shipped', 'outcome',
];

function captionOf(p) {
  return String(p?.caption || '').toLowerCase();
}

function matches(caption, keywords) {
  return keywords.some((k) => caption.includes(k));
}

function isReel(type) {
  return /video|reel|clip/i.test(type || '');
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function pct(n, d) {
  if (!d) return 0;
  return round1((n / d) * 100);
}

function formatPct(n) {
  return `${round1(n)}%`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function formatValue(v, unit) {
  if (v == null || Number.isNaN(Number(v))) return null;
  if (unit === 'percent-of-posts' || unit === 'percent-of-accounts' || unit === 'ratio') {
    return formatPct(v);
  }
  if (unit === 'per-week') return String(round1(v));
  return String(Number.isInteger(Number(v)) ? Number(v) : round1(v));
}

function computeProfileMetrics(profile) {
  const posts = Array.isArray(profile?.posts) ? profile.posts : [];
  const now = Date.now();
  const recent = posts.filter((p) => p.timestamp && now - new Date(p.timestamp).getTime() <= THIRTY_DAYS);
  const window = recent.length ? recent : posts;
  const n = window.length;

  const eduPosts = window.filter((p) => matches(captionOf(p), EDUCATIONAL_KEYWORDS)).length;
  const proofPosts = window.filter((p) => matches(captionOf(p), PROOF_KEYWORDS)).length;
  const reelPosts = window.filter((p) => isReel(p.type)).length;

  const engaged = window.filter((p) => p.likesCount != null || p.commentsCount != null);
  const avgComments = engaged.length
    ? Math.round(engaged.reduce((s, p) => s + (p.commentsCount || 0), 0) / engaged.length)
    : 0;
  const avgLikes = engaged.length
    ? Math.round(engaged.reduce((s, p) => s + (p.likesCount || 0), 0) / engaged.length)
    : 0;

  return {
    totalInWindow: n,
    usedRecentWindow: recent.length > 0,
    postsPerWeek: n ? round1(n / (30 / 7)) : 0,
    eduShare: pct(eduPosts, n),
    proofShare: pct(proofPosts, n),
    reelShare: pct(reelPosts, n),
    eduPosts,
    proofPosts,
    reelPosts,
    avgComments,
    avgLikes,
  };
}

function buildAccountSummary(brandDna, metrics, profile) {
  const bits = [];
  if (brandDna?.whatYouOffer) bits.push(brandDna.whatYouOffer.replace(/\.\s*$/, ''));
  if (brandDna?.whoYouHelp) bits.push(`Built for ${brandDna.whoYouHelp.replace(/\.\s*$/, '').toLowerCase()}`);
  if (brandDna?.position) bits.push(brandDna.position.replace(/\.\s*$/, ''));
  if (brandDna?.howYouSound && bits.length < 3) {
    bits.push(`Voice: ${brandDna.howYouSound.replace(/\.\s*$/, '')}`);
  }
  if (bits.length) return `${bits.join('. ')}.`;

  if (metrics.totalInWindow === 0) {
    return 'Not enough recent posts yet to summarise this account from public activity.';
  }
  const handle = profile?.username ? `@${profile.username}` : 'This account';
  return `${handle} published ${plural(metrics.totalInWindow, 'post')} in the analysed window (~${metrics.postsPerWeek}/week), with about ${formatPct(metrics.eduShare)} educational-style and ${formatPct(metrics.proofShare)} proof-style captions.`;
}

function pickCohortFinding(dashboard) {
  const findings = Array.isArray(dashboard?.findings) ? dashboard.findings : [];
  const withValues = findings.filter((f) => f.focusValue != null);
  return (
    withValues.find((f) => f.recommendationReady && f.evidenceStrength === 'strong')
    || withValues.find((f) => f.recommendationReady)
    || withValues.find((f) => f.evidenceStrength === 'strong')
    || withValues[0]
    || null
  );
}

function cohortReelShare(dashboard) {
  const formats = dashboard?.captionAnalysis?.formats || [];
  const reel = formats.find((f) => /reel|video/i.test(`${f.name || ''} ${f.format || ''} ${f.label || ''}`));
  if (!reel) return null;
  if (reel.sharePct != null) return Number(reel.sharePct);
  if (reel.share != null) return Number(reel.share);
  const total = formats.reduce((s, f) => s + (f.posts || 0), 0);
  if (total && reel.posts != null) return pct(reel.posts, total);
  return null;
}

/**
 * Build a You-vs-peer comparison only when both sides are measurable from real data.
 */
function buildPeerComparison(metrics, cohortOverview, finding) {
  if (!cohortOverview?.dashboard) return null;
  const dashboard = cohortOverview.dashboard;
  const summary = dashboard.summary || {};
  const peerWeek = summary.medianPostsPerWeek != null ? Number(summary.medianPostsPerWeek) : null;

  // 1) Cadence — both sides are measured numbers.
  if (peerWeek != null && metrics.totalInWindow > 0) {
    return {
      metric: 'Posts per week (last 30 days)',
      unit: 'per-week',
      you: metrics.postsPerWeek,
      peer: peerWeek,
      youDisplay: String(metrics.postsPerWeek),
      peerDisplay: String(round1(peerWeek)),
      peerLabel: 'Similar studios',
    };
  }

  // 2) Reel mix — user share vs cohort format mix.
  const peerReel = cohortReelShare(dashboard);
  if (peerReel != null && metrics.totalInWindow > 0) {
    return {
      metric: 'Share of posts that are Reels',
      unit: 'percent-of-posts',
      you: metrics.reelShare,
      peer: peerReel,
      youDisplay: formatPct(metrics.reelShare),
      peerDisplay: formatPct(peerReel),
      peerLabel: 'Similar studios',
    };
  }

  // 3) Finding whose unit we can mirror on the user account.
  if (finding?.focusValue != null) {
    const title = `${finding.title || ''} ${finding.explanation || ''} ${finding.dimension || ''}`.toLowerCase();
    const unit = finding.valueUnit || 'percent-of-posts';
    let you = null;
    let metric = finding.title || 'Key difference vs similar studios';

    if (unit === 'per-week') {
      you = metrics.postsPerWeek;
      metric = finding.title || 'Posts per week';
    } else if (unit === 'percent-of-posts' || unit === 'percent-of-accounts') {
      if (/reel|video|clip/.test(title)) you = metrics.reelShare;
      else if (/educat|teach|tip|how[- ]to|explainer|authority|credibility/.test(title)) you = metrics.eduShare;
      else if (/proof|project|case|client|before|after|testimonial|result|trust/.test(title)) you = metrics.proofShare;
    }

    if (you != null) {
      const peer = Number(finding.focusValue);
      return {
        metric,
        unit,
        you,
        peer,
        youDisplay: formatValue(you, unit),
        peerDisplay: formatValue(peer, unit),
        peerLabel: 'Similar studios',
        finding,
      };
    }
  }

  return null;
}

function buildStrengths(metrics, funnel, comparison) {
  const out = [];

  for (const row of funnel) {
    if (row.verdict === 'Strong' || row.verdict === 'Moderate') {
      const evidence = (row.evidence || []).find((e) => e && !/no |not |limited|too little/i.test(e));
      if (evidence) out.push(`${row.pillar[0].toUpperCase()}${row.pillar.slice(1)}: ${evidence}.`);
    }
  }

  if (metrics.avgComments > 0) {
    out.push(`Public comments average ${metrics.avgComments} per analysed post (~${metrics.avgLikes} likes).`);
  }

  if (comparison?.unit === 'per-week' && metrics.postsPerWeek >= comparison.peer) {
    out.push(`You publish ${metrics.postsPerWeek}/week versus ${comparison.peerDisplay}/week for similar studios.`);
  } else if (metrics.postsPerWeek >= 3) {
    out.push(`Publishing rhythm is ${metrics.postsPerWeek} posts/week across the analysed window.`);
  }

  if (metrics.eduPosts > 0) {
    out.push(`${plural(metrics.eduPosts, 'educational-style post')} detected (${formatPct(metrics.eduShare)} of the window).`);
  }

  // Dedupe while preserving order.
  const seen = new Set();
  return out.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  }).slice(0, 4);
}

function buildOpportunities(metrics, funnel, comparison, finding) {
  const out = [];

  for (const row of funnel) {
    if (row.verdict === 'Not established' || row.verdict === 'Early stage') {
      if (row.recommendation) out.push(row.recommendation);
      const gapEvidence = (row.evidence || []).find((e) => /no |not |limited|unclear|too little/i.test(e));
      if (gapEvidence) out.push(gapEvidence);
    }
  }

  if (comparison && comparison.you < comparison.peer - (comparison.unit === 'per-week' ? 0.3 : 2)) {
    out.push(
      `On “${comparison.metric}” you are at ${comparison.youDisplay} vs ${comparison.peerDisplay} for similar studios.`,
    );
  }

  if (finding?.suggestedExperiment) {
    out.push(finding.suggestedExperiment);
  } else if (finding?.title && finding?.explanation && out.length < 3) {
    out.push(`${finding.title}: ${finding.explanation}`);
  }

  if (!out.length && metrics.proofPosts === 0) {
    out.push('No proof-style posts detected in the analysed window — client results, projects, or before/after work are not showing up in captions yet.');
  }

  const seen = new Set();
  return out.filter((s) => {
    if (!s || seen.has(s)) return false;
    seen.add(s);
    return true;
  }).slice(0, 4);
}

function buildVerdict({ week, funnel, metrics, comparison, finding }) {
  const focusRow = funnel.find((r) => r.pillar === week.focus) || funnel[0];
  const focusLabel = FOCUS[week.focus]?.label || focusRow?.pillar || 'focus';

  const clauses = [];
  if (week.confidence === 'low') {
    clauses.push('There is not enough recent activity for a confident read.');
    clauses.push('The next job is building a measurable publishing foundation.');
  } else if (comparison) {
    const behind = comparison.you < comparison.peer - (comparison.unit === 'per-week' ? 0.3 : 2);
    const ahead = comparison.you > comparison.peer + (comparison.unit === 'per-week' ? 0.3 : 2);
    if (behind) {
      clauses.push(`${focusLabel} still has the most room to grow.`);
      clauses.push('Similar studios are ahead on the metric that matters most right now.');
    } else if (ahead) {
      clauses.push(`You are ahead of similar studios on ${comparison.metric.toLowerCase()}.`);
      clauses.push(`Next: strengthen ${focusLabel.toLowerCase()} so that lead compounds.`);
    } else {
      clauses.push(`You are roughly in line with similar studios on ${comparison.metric.toLowerCase()}.`);
      clauses.push(`${focusLabel} is still the pillar with the most leverage.`);
    }
  } else {
    clauses.push(`${focusRow?.verdict || 'Early stage'} on ${focusLabel.toLowerCase()}.`);
    if (week.observation) clauses.push(week.observation);
  }

  let proof = null;
  if (comparison) {
    const max = Math.max(Number(comparison.you) || 0, Number(comparison.peer) || 0, 0.0001);
    const behind = comparison.you < comparison.peer - (comparison.unit === 'per-week' ? 0.3 : 2);
    const ahead = comparison.you > comparison.peer + (comparison.unit === 'per-week' ? 0.3 : 2);
    proof = {
      metric: comparison.metric,
      you: { display: comparison.youDisplay, bar: (Number(comparison.you) || 0) / max },
      peer: { display: comparison.peerDisplay, bar: (Number(comparison.peer) || 0) / max },
      peerLabel: comparison.peerLabel || 'Similar studios',
      dir: behind ? 'behind' : ahead ? 'ahead' : 'even',
    };
  } else if (metrics.totalInWindow > 0) {
    // No cohort peer available — show one measured figure from this account only.
    const max = Math.max(metrics.postsPerWeek, 1);
    proof = {
      metric: 'Your posts per week (analysed window)',
      you: { display: String(metrics.postsPerWeek), bar: Math.min(1, metrics.postsPerWeek / max) },
      peer: null,
      youLabel: 'You',
      dir: '',
      solo: true,
    };
  }

  const rows = [];

  if (comparison) {
    const delta = round1(Math.abs(comparison.you - comparison.peer));
    const unitSuffix = comparison.unit === 'per-week' ? ' posts/week' : comparison.unit?.includes('percent') ? ' points' : '';
    rows.push({
      kind: comparison.you < comparison.peer ? 'warn' : 'good',
      label: 'The gap',
      text: `You: ${comparison.youDisplay}. Similar studios: ${comparison.peerDisplay}. Difference: ${delta}${unitSuffix}.`,
    });
  } else if (focusRow?.evidence?.length) {
    rows.push({
      kind: 'warn',
      label: 'The gap',
      text: focusRow.evidence.filter(Boolean).slice(0, 2).join(' · '),
    });
  }

  const strong = funnel.find((r) => r.verdict === 'Strong') || funnel.find((r) => r.verdict === 'Moderate');
  if (strong?.evidence?.[0]) {
    rows.push({ kind: 'good', label: "What it's worth", text: `${strong.pillar[0].toUpperCase()}${strong.pillar.slice(1)} already shows signal: ${strong.evidence[0]}.` });
  } else if (metrics.avgComments > 0 || metrics.avgLikes > 0) {
    rows.push({
      kind: 'good',
      label: "What it's worth",
      text: `Public engagement on analysed posts averages ~${metrics.avgLikes} likes and ${metrics.avgComments} comments.`,
    });
  } else if (finding?.explanation) {
    rows.push({ kind: 'good', label: "What it's worth", text: finding.explanation });
  }

  const start =
    (typeof week.recommendation?.[0] === 'object' ? week.recommendation[0].move : week.recommendation?.[0])
    || focusRow?.recommendation
    || null;
  if (start) {
    rows.push({ kind: 'act', label: 'Where to start', text: start });
  }

  return { clauses: clauses.filter(Boolean).slice(0, 2), proof, rows };
}

function buildSimilarAccounts(cohortOverview, comparison, finding) {
  if (!cohortOverview?.cohort) return null;

  const scope = cohortOverview.scopeUsed || cohortOverview.cohort;
  const business = BUSINESS_LABELS[scope.businessCategory] || 'Similar businesses';
  const location = scope.location || 'Global';
  const n =
    cohortOverview.dashboard?.captionAnalysis?.kpis?.competitors
    ?? cohortOverview.dashboard?.summary?.accountsAnalyzed
    ?? cohortOverview.accountsAnalyzed
    ?? null;

  const basis = n != null
    ? `Compared with ${n} similar accounts — ${business} in ${location}, measured over the last 30 days.`
    : `Compared with ${business} in ${location} (cohort assigned; waiting on account count).`;

  if (!cohortOverview.dashboard) {
    return {
      basis,
      insight: `Cohort is assigned (${business} · ${location}), but no completed competitor analysis is stored for it yet.`,
      comparison: null,
    };
  }

  const insight = finding?.explanation || null;

  let comparisonBlock = null;
  if (comparison) {
    comparisonBlock = {
      metric: comparison.metric,
      you: comparison.youDisplay,
      peer: comparison.peerDisplay,
      peerLabel: comparison.peerLabel || 'Similar studios',
      footing: n != null ? `Based on ${n} similar accounts` : 'Based on your assigned cohort',
    };
  } else if (finding?.focusValue != null && finding?.comparisonValue != null) {
    // Cohort finding without a mirrored user metric: show the cohort's own comparison honestly.
    comparisonBlock = {
      metric: finding.title || 'Cohort finding',
      you: formatValue(finding.comparisonValue, finding.valueUnit),
      peer: formatValue(finding.focusValue, finding.valueUnit),
      youLabel: 'Comparison group',
      peerLabel: 'Your cohort',
      footing: n != null ? `Based on ${n} similar accounts` : 'Based on your assigned cohort',
    };
  }

  return { basis, insight, comparison: comparisonBlock };
}

function buildStrategicFocus(week, brandDna, funnel) {
  const pillar = week?.focus || 'trust';
  const meta = FOCUS[pillar] || FOCUS.trust;
  const focusRow = (funnel || []).find((r) => r.pillar === pillar);

  let explanation = focusRow?.whyMatters || meta.tagline;
  if (focusRow?.recommendation) {
    explanation = focusRow.recommendation;
  }
  if (brandDna?.firstProblem) {
    explanation = `${explanation} Your Brand profile flags the first audience problem as: ${brandDna.firstProblem.replace(/\.\s*$/, '')}.`;
  }

  return {
    pillar,
    label: meta.label,
    tagline: meta.tagline,
    explanation,
    icon: meta.icon,
  };
}

function buildShapesWeek(week, weeklyRoute, strategicFocus) {
  if (weeklyRoute?.focus?.recommendation) return weeklyRoute.focus.recommendation;
  if (weeklyRoute?.focus?.hypothesis) return weeklyRoute.focus.hypothesis;
  if (weeklyRoute?.focus?.whyMatters) return weeklyRoute.focus.whyMatters;
  if (weeklyRoute?.focus?.observation) return weeklyRoute.focus.observation;

  const move = typeof week?.recommendation?.[0] === 'object'
    ? week.recommendation[0].move
    : week?.recommendation?.[0];
  if (week?.hypothesis && move) {
    return `${week.hypothesis} This week starts with: ${move}.`;
  }
  if (week?.hypothesis) return week.hypothesis;
  if (move) return `This week starts with: ${move}.`;
  return `This week focuses on ${strategicFocus.label.toLowerCase()} — ${strategicFocus.tagline}`;
}

/**
 * @param {object} profile InstagramProfile doc
 * @param {object|null} brandDna Brand DNA axes
 * @param {object|null} cohortOverview from loadCompetitorOverviewForUser
 * @param {object|null} weeklyRoute optional current route
 */
function buildAnalysisOverview(profile, brandDna = null, cohortOverview = null, weeklyRoute = null) {
  const { week, funnel } = computeAuthorityFunnel(profile);
  const metrics = computeProfileMetrics(profile);

  // Prefer the live weekly plan's focus pillar when one exists.
  if (weeklyRoute?.focus?.pillar) {
    week.focus = weeklyRoute.focus.pillar;
    if (weeklyRoute.focus.headline) week.headline = weeklyRoute.focus.headline;
    if (weeklyRoute.focus.observation) week.observation = weeklyRoute.focus.observation;
    if (weeklyRoute.focus.hypothesis) week.hypothesis = weeklyRoute.focus.hypothesis;
    if (weeklyRoute.focus.recommendation) {
      week.recommendation = [{ move: weeklyRoute.focus.recommendation, pillar: week.focus }];
    }
  }

  const finding = cohortOverview?.dashboard ? pickCohortFinding(cohortOverview.dashboard) : null;
  const comparison = buildPeerComparison(metrics, cohortOverview, finding);

  const strategicFocus = buildStrategicFocus(week, brandDna, funnel);
  const shapesWeek = buildShapesWeek(week, weeklyRoute, strategicFocus);

  return {
    username: profile.username,
    headline: "Here's what Bauhly found in your account.",
    verdict: buildVerdict({ week, funnel, metrics, comparison, finding }),
    accountSummary: buildAccountSummary(brandDna, metrics, profile),
    strengths: buildStrengths(metrics, funnel, comparison),
    opportunities: buildOpportunities(metrics, funnel, comparison, finding),
    similarAccounts: buildSimilarAccounts(cohortOverview, comparison, finding),
    strategicFocus,
    shapesWeek,
    week,
    funnel,
  };
}

module.exports = { buildAnalysisOverview };
