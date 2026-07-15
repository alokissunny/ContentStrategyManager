/*
 * Authority Funnel — derives the Discovery → Credibility → Trust status shown
 * in the post-onboarding "Build Your Authority Foundation" modal.
 *
 * Everything here is computed deterministically from the scraped Instagram
 * snapshot (post volume, recency, Reels, captions, engagement). No metrics are
 * invented — when there isn't enough history the funnel says so honestly and
 * the copy shifts to "we're starting from assumptions".
 */

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const PILLAR_COPY = {
  discovery: {
    label: 'Discovery',
    whyMatters:
      'Discovery creates opportunities for new people to find your business. Before we can optimise performance, Instagram needs enough consistent content to distribute.',
  },
  credibility: {
    label: 'Credibility',
    whyMatters:
      'People need repeated evidence of your expertise before they recognise your account as a trusted source of knowledge.',
  },
  trust: {
    label: 'Trust',
    whyMatters:
      'People trust businesses that demonstrate experience, results and consistency. Without proof, new visitors have little reason to believe in your expertise yet.',
  },
};

const EDUCATIONAL_KEYWORDS = ['how to', 'how i', 'tips', 'tip:', 'guide', 'why ', 'step', 'learn', 'mistake', 'avoid', 'process', 'tutorial', 'lesson', 'framework', 'the truth about', 'things you'];
const PROOF_KEYWORDS = ['client', 'project', 'result', 'before', 'after', 'testimonial', 'review', 'case study', 'delivered', 'completed', 'finished', 'proud', 'launch', 'shipped', 'outcome'];
const PERSONAL_KEYWORDS = ['behind the scenes', 'meet ', 'my story', 'our team', 'i started', 'when i', 'personal', 'a day in', 'why i'];

function isReel(type) {
  return /video|reel|clip/i.test(type || '');
}

function captionMatches(caption, keywords) {
  const text = (caption || '').toLowerCase();
  return keywords.some((k) => text.includes(k));
}

function round(n) {
  return Math.round(n || 0);
}

// verdict → label; the frontend maps the label to a coloured dot.
function verdictFor(score) {
  if (score === 'strong') return 'Strong';
  if (score === 'moderate') return 'Moderate';
  if (score === 'early') return 'Early stage';
  return 'Not established';
}

function computeAuthorityFunnel(profile) {
  const posts = Array.isArray(profile?.posts) ? profile.posts : [];
  const totalPosts = posts.length;
  const now = Date.now();

  const recent = posts.filter((p) => p.timestamp && now - new Date(p.timestamp).getTime() <= THIRTY_DAYS);
  const postsLast30 = recent.length;
  const reelCount = posts.filter((p) => isReel(p.type)).length;

  // Rough "rhythm" read: how many distinct ISO weeks the posts fall across.
  const weeks = new Set(
    posts
      .filter((p) => p.timestamp)
      .map((p) => {
        const d = new Date(p.timestamp);
        const onejan = new Date(d.getFullYear(), 0, 1);
        return `${d.getFullYear()}-${Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)}`;
      })
  );
  const consistentRhythm = weeks.size >= 4 && postsLast30 >= 4;

  const eduPosts = posts.filter((p) => captionMatches(p.caption, EDUCATIONAL_KEYWORDS)).length;
  const proofPosts = posts.filter((p) => captionMatches(p.caption, PROOF_KEYWORDS)).length;
  const personalPosts = posts.filter((p) => captionMatches(p.caption, PERSONAL_KEYWORDS)).length;

  const engaged = posts.filter((p) => p.likesCount != null || p.commentsCount != null);
  const avgLikes = engaged.length ? round(engaged.reduce((s, p) => s + (p.likesCount || 0), 0) / engaged.length) : 0;
  const avgComments = engaged.length ? round(engaged.reduce((s, p) => s + (p.commentsCount || 0), 0) / engaged.length) : 0;
  const hasEngagement = avgLikes > 0 || avgComments > 0;

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // ── Discovery ──
  let discoveryScore = 'low';
  if (postsLast30 >= 12 && consistentRhythm) discoveryScore = 'strong';
  else if (postsLast30 >= 4) discoveryScore = 'early';
  const discovery = {
    pillar: 'discovery',
    verdict: verdictFor(discoveryScore),
    evidence: [
      `${plural(postsLast30, 'post')} in the last 30 days`,
      reelCount ? `${plural(reelCount, 'Reel')} published` : 'No Reels published',
      consistentRhythm ? 'Consistent publishing rhythm' : 'No consistent publishing rhythm',
      postsLast30 < 4 ? 'Limited recent activity' : `${plural(totalPosts, 'post')} analysed in total`,
    ],
    whyMatters: PILLAR_COPY.discovery.whyMatters,
    recommendation:
      discoveryScore === 'strong'
        ? 'Keep your publishing rhythm steady and lean into the Reel formats already reaching new people.'
        : discoveryScore === 'early'
        ? 'Increase your cadence and publish more Reels — they earn the widest reach with new audiences.'
        : 'Build a consistent publishing rhythm this week — start with your first discovery-focused Reel and one educational post.',
  };

  // ── Credibility ──
  let credibilityScore = 'low';
  if (eduPosts >= 4 && postsLast30 >= 8) credibilityScore = 'strong';
  else if (eduPosts >= 1) credibilityScore = 'early';
  const credibility = {
    pillar: 'credibility',
    verdict: verdictFor(credibilityScore),
    evidence: [
      eduPosts ? `${plural(eduPosts, 'educational-style post')} detected` : 'No clearly educational posts detected',
      totalPosts < 6 ? 'Too little recent content to identify expertise patterns' : 'Expertise patterns are starting to emerge',
      credibilityScore === 'strong' ? 'A clear core topic is coming through' : 'Topic positioning is still unclear',
    ],
    whyMatters: PILLAR_COPY.credibility.whyMatters,
    recommendation:
      credibilityScore === 'strong'
        ? 'Keep teaching around your core topics — your expertise is landing.'
        : 'Publish practical educational content around one core topic to begin establishing your authority.',
  };

  // ── Trust ──
  let trustScore = 'low';
  if (proofPosts >= 2 && hasEngagement) trustScore = 'moderate';
  else if (proofPosts >= 1 || personalPosts >= 1) trustScore = 'early';
  const trust = {
    pillar: 'trust',
    verdict: verdictFor(trustScore),
    evidence: [
      proofPosts ? `${plural(proofPosts, 'proof-style post')}` : 'No proof-based content',
      personalPosts ? `${plural(personalPosts, 'personal post')}` : 'No personal content',
      hasEngagement ? `~${avgLikes} likes and ${avgComments} comments per post` : 'No visible audience interaction',
      totalPosts < 10 ? 'Limited publishing history' : `${plural(totalPosts, 'post')} total`,
    ],
    whyMatters: PILLAR_COPY.trust.whyMatters,
    recommendation:
      trustScore === 'moderate'
        ? 'Keep sharing proof and engaging your audience — trust is compounding.'
        : "Share your first proof-based post — a previous project, a client outcome, or why you're qualified to help.",
  };

  const funnel = [discovery, credibility, trust];

  // Focus = the earliest pillar that most needs work (Discovery first).
  const focusRow =
    funnel.find((r) => r.verdict === 'Not established') ||
    funnel.find((r) => r.verdict === 'Early stage') ||
    discovery;
  const focus = focusRow.pillar;
  const focusLabel = PILLAR_COPY[focus].label;

  const confidence = postsLast30 < 4 ? 'low' : postsLast30 < 12 ? 'medium' : 'high';

  const week = {
    focus,
    confidence,
    headline: confidence === 'low' ? 'Build Your Authority Foundation' : `Strengthen Your ${focusLabel}`,
    observation:
      confidence === 'low'
        ? "There isn't enough recent content to evaluate your performance confidently."
        : `Over the last 30 days you published ${plural(postsLast30, 'post')}${reelCount ? ` and ${plural(reelCount, 'Reel')}` : ''}. Your ${focusLabel} pillar has the most room to grow.`,
    hypothesis:
      confidence === 'low'
        ? 'If we establish a consistent publishing rhythm, real audience signals will replace assumptions within a few weeks.'
        : `If we focus on ${focusLabel} this week, we can turn your existing momentum into measurable growth.`,
    whyMatters:
      confidence === 'low'
        ? "There isn't enough recent content to evaluate your performance confidently. Before we can optimise what works, we need a consistent content foundation that lets us learn from real audience signals."
        : focusRow.whyMatters,
    recommendation: [
      { move: 'Start a consistent publishing rhythm', pillar: 'discovery' },
      { move: 'Post your first educational content', pillar: 'credibility' },
      { move: 'Share one piece of proof', pillar: 'trust' },
    ],
    note: "As you publish, we'll replace assumptions with real performance data and adapt your strategy each week.",
  };

  return { week, funnel };
}

module.exports = { computeAuthorityFunnel };
