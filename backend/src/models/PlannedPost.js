const mongoose = require('mongoose');

// One planned Instagram post, placed on a single calendar date (its "slot").
//
// This replaces the old week-bucketed WeeklyRoute: instead of a document per
// week holding an embedded days[] array, each post is its own top-level
// document. Generation no longer reasons about months or weeks — it simply
// fills empty calendar dates (see postController.generateAndSavePosts). Smarter
// placement will come later from a dedicated schedule agent.
//
// The `content` sub-shape and all scheduling/publish fields are lifted verbatim
// from WeeklyRoute's former daySchema so the agents, layout system, and publish
// pipeline keep working unchanged — only the container changed.
const plannedPostSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The Instagram handle this post belongs to — posts follow the header
    // account switcher, so each handle sees only its own calendar.
    instagramUsername: { type: String, trim: true, lowercase: true, default: '' },

    // ── Calendar slot ──────────────────────────────────────────────────────
    // The single day this post occupies, as a "YYYY-MM-DD" calendar-day string
    // (NOT a Date — a Date serializes to a UTC instant and reads back off-by-one
    // east/west of UTC; the day is a calendar day, not a moment). One post per
    // (user, handle, date) — the unique index below is what makes "an empty
    // slot" well-defined. Lexicographic order on this string is chronological.
    date: { type: String, required: true },
    day: { type: String, default: '' }, // weekday name, e.g. "Tuesday"
    dateLabel: { type: String, default: '' },
    time: { type: String, default: '' }, // preferred publish time "HH:MM"

    // ── Direction ──────────────────────────────────────────────────────────
    format: { type: String, enum: ['Reel', 'Carousel', 'Post', 'Story'], default: 'Post' },
    contentType: { type: String, default: '' },
    pillar: { type: String, enum: ['discovery', 'credibility', 'trust'], default: 'discovery' },
    goalTag: { type: String, default: '' },
    title: { type: String, default: '' },
    direction: { type: String, default: '' },

    // ── Publish / schedule ─────────────────────────────────────────────────
    published: { type: Boolean, default: false },
    // When the studio schedules this post to go out. Null = not scheduled.
    // Cleared automatically once the post is published.
    scheduledAt: { type: Date, default: null },
    // Rendered JPEG keys (projects/<userId>/…) captured at Schedule time so the
    // daily job can publish without a browser. Cleared on unschedule.
    publishImageKeys: { type: [String], default: [] },
    // ready = waiting for the daily job; publishing = claimed; failed = last run errored.
    scheduleStatus: {
      type: String,
      enum: ['', 'ready', 'publishing', 'failed'],
      default: '',
    },
    scheduleError: { type: String, default: '' },
    scheduleClaimedAt: { type: Date, default: null },
    igMediaId: { type: String, default: '' },
    // The live post's instagram.com URL, fetched from Graph right after publish.
    permalink: { type: String, default: '' },
    // "Save for review" — the studio wants this post kept in the calendar as a
    // draft to look over, explicitly NOT queued to auto-publish. Distinct from a
    // plain unscheduled post: it's a deliberate "hold, don't publish yet" flag.
    // Cleared automatically when the post is scheduled or published.
    savedForReview: { type: Boolean, default: false },

    // ── Content (verbatim from the former daySchema.content) ────────────────
    content: {
      // Structured slides for carousels / multi-frame posts. Roles like Hook,
      // Setup, Process, Result, CTA. assetKey ties a slide to a project photo.
      slides: {
        type: [
          {
            role: { type: String, default: '' },
            title: { type: String, default: '' },
            // The supporting line under the title — the second piece of on-slide
            // copy the layout can show (e.g. a subtitle beneath a hook). Real
            // words written with the plan, so a layout's body slot is never a
            // placeholder. Empty is fine — the slide is then title-only.
            subtitle: { type: String, default: '' },
            body: { type: String, default: '' },
            structure: { type: String, default: '' },
            items: { type: [String], default: [] },
            itemsA: { type: [String], default: [] },
            itemsB: { type: [String], default: [] },
            stat: { type: String, default: '' },
            quote: { type: String, default: '' },
            action: { type: String, default: '' },
            comparisonA: { type: String, default: '' },
            comparisonB: { type: String, default: '' },
            labels: { type: [String], default: [] },
            image: { type: String, default: '' },
            // A rich, self-contained BASE image prompt for this slide, written
            // while the plan is built so it already carries the post's topic,
            // this slide's role and message, subject, setting and composition.
            // The studio's live Visual Brand (palette, type) and Visual Mood are
            // layered on at generation time (see WeekView CreateImageChat) — this
            // is only the context-heavy base, never the brand/mood.
            imagePrompt: { type: String, default: '' },
            assetKey: { type: String, default: '' },
            // Extra photographs for multi-slot layouts (collage, grid, duo…).
            // Index-aligned with the composition's picture places; empty string
            // is an unfilled place. `assetKey` stays the lead (slot 0) so
            // older clients and the planner keep working.
            assetKeys: { type: [String], default: [] },
            // Layout id from the Layout Agent / Visual Brand layout system.
            // Empty = the post view falls back to a default composition.
            layout: { type: String, default: '' },
            // Dynamic HTML composition from the Layout Agent. Empty = the post
            // view uses the default stacked preview. This is the currently-applied
            // option (the top-ranked one unless the studio picked another).
            layoutHtml: { type: String, default: '' },
            // Ranked alternative compositions the Layout Agent generated for
            // this slide, best-first: [{ rank, label, reason, html }]. Surfaced
            // in the Change layout picker; `layoutHtml` mirrors the chosen one.
            // Empty = only the single applied composition exists.
            layoutOptions: { type: [mongoose.Schema.Types.Mixed], default: [] },
            // Carousel-agent theme currently applied (architectural-minimal, quiet-luxury, …).
            layoutTheme: { type: String, default: '' },
            // On-photo callout (handwritten label + arrow) when Structure
            // locked Annotation on a photograph with a relevant subject.
            annotation: { type: mongoose.Schema.Types.Mixed, default: null },
            // Day Writer / Structure visual recommendation — shown in the
            // studio as an empty image placeholder plus an info hint when no
            // photograph is assigned yet.
            visualNeed: { type: mongoose.Schema.Types.Mixed, default: null },
          },
        ],
        default: [],
      },
      onScreenText: { type: [String], default: [] },
      caption: { type: String, default: '' },
      cta: { type: String, default: '' },
      hashtags: { type: [String], default: [] },
      strategy: { type: String, default: '' },
      prompts: { type: [String], default: [] },
      plan: { type: String, default: '' },
      notes: { type: String, default: '' },
      // Full carousel-agent HTML document. The post view crops one slide from
      // this so the Instagram preview matches the debug iframe.
      carouselHtml: { type: String, default: '' },
      // Studio-picked carousel theme id (Change theme → catalog slug).
      themeId: { type: String, default: '' },
      // Applied Animated Carousel Cover: { key } of the rendered MP4 in S3.
      // When set, the post view plays it in place of the static hook (slide 1).
      // The full spec + render metadata live on agentTrace.cover.
      coverVideo: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    // Parsed outputs from Strategist / Structure / Day Writer / Layout for this
    // post. Shown when AI prompt debug is on. layoutHtml on each slide is what
    // the preview renders; the trace is the agent's reasoning.
    agentTrace: { type: mongoose.Schema.Types.Mixed, default: null },

    model: { type: String, default: '' },
    generatedAt: { type: Date, default: Date.now },
    // LLM usage attributed to this post's generation (cost / token display).
    usage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
      estimatedCostUsd: { type: Number, default: 0 },
      elapsedMs: { type: Number, default: 0 },
      model: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

// One post per calendar slot per handle. This uniqueness is what defines an
// "empty slot": generation upserts by (user, handle, date) and skips dates that
// already hold a post.
plannedPostSchema.index({ user: 1, instagramUsername: 1, date: 1 }, { unique: true });
// The daily publish job scans by schedule state.
plannedPostSchema.index({ scheduledAt: 1, scheduleStatus: 1 });

module.exports = mongoose.model('PlannedPost', plannedPostSchema);
