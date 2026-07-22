import { z } from 'zod'
import { authorityPillar, id, isoDateTime } from './common'

/*
 * AI-assisted content classification (section 30 of the brief).
 *
 * Classifications are stored separately from raw post data and never
 * overwrite it. Every classification carries full model provenance plus an
 * optional human correction; when a correction exists it wins over the model
 * value everywhere.
 */

export const contentType = z.enum([
  'finished-project',
  'before-and-after',
  'project-walkthrough',
  'client-story',
  'testimonial',
  'educational-advice',
  'common-mistake',
  'design-decision',
  'process',
  'behind-the-scenes',
  'work-in-progress',
  'material-selection',
  'product-selection',
  'founder-perspective',
  'team-introduction',
  'press',
  'award',
  'faq',
  'service-explanation',
  'objection-handling',
  'promotion',
  'lifestyle',
  'other',
  'unclear',
])
export type ContentType = z.infer<typeof contentType>

/** Strategic purpose — the pillar set plus recruitment/unclear. */
export const strategicPurpose = z.enum([
  ...authorityPillar.options,
  'recruitment',
  'unclear',
])
export type StrategicPurpose = z.infer<typeof strategicPurpose>

export const hookType = z.enum([
  'common-mistake',
  'question',
  'contrarian-statement',
  'unexpected-fact',
  'direct-promise',
  'transformation',
  'result-first',
  'client-problem',
  'warning',
  'comparison',
  'myth-correction',
  'personal-confession',
  'story-opening',
  'curiosity-gap',
  'no-clear-hook',
])
export type HookType = z.infer<typeof hookType>

export const captionStructure = z.enum([
  'educational',
  'project-story',
  'client-story',
  'list',
  'problem-and-solution',
  'personal-reflection',
  'process-explanation',
  'faq',
  'opinion',
  'promotional',
  'testimonial',
  'short-statement',
])
export type CaptionStructure = z.infer<typeof captionStructure>

/** Topics are open-ended (kitchen, lighting, budget, …) — a curated string,
 * not an enum, so new topics don't require a schema change. */
export const topic = z.string().min(1)

export const creativeAttribute = z.enum([
  'founder-visible',
  'team-visible',
  'client-visible',
  'talking-head',
  'voice-over',
  'text-overlay',
  'professional-photography',
  'smartphone-footage',
  'finished-space',
  'work-in-progress',
  'before-and-after',
  'branded-graphic',
  'collaboration',
  'strong-opening-motion',
  'static-opening',
])
export type CreativeAttribute = z.infer<typeof creativeAttribute>

export const classificationReviewStatus = z.enum([
  'unreviewed',
  'confirmed',
  'corrected',
  'flagged',
])

/** Which classified dimension this record carries. */
export const classificationDimension = z.enum([
  'strategic-purpose',
  'content-type',
  'topic',
  'hook',
  'caption-structure',
  'creative-attributes',
])
export type ClassificationDimension = z.infer<typeof classificationDimension>

export const classification = z.object({
  id,
  postId: id,
  dimension: classificationDimension,
  /** The model's value(s) for the dimension, validated per-dimension at the
   * call site. Arrays are used for multi-valued dimensions (creative
   * attributes, topics). */
  value: z.union([z.string(), z.array(z.string())]),
  confidence: z.number().min(0).max(1).nullable(),

  /* Model provenance — required for every AI output, cached so unchanged
   * posts are never reclassified. */
  model: z.string(),
  modelVersion: z.string().nullable(),
  promptVersion: z.string(),
  classifiedAt: isoDateTime,
  /** Reference to the exact input sent (for cache-keying and audits). */
  inputRef: z.string(),

  /* Human review */
  reviewStatus: classificationReviewStatus,
  correction: z.union([z.string(), z.array(z.string())]).nullable(),
  correctionAuthor: z.string().nullable(),
  correctionAt: isoDateTime.nullable(),
})
export type Classification = z.infer<typeof classification>
