# Batch memo prompt (map step)

You are summarising a **batch** of condensed competitor Instagram accounts for a
renovation / interior-design competitive-intelligence system.

The accounts were already compressed locally: window rollups + a few exemplar
posts each. Each exemplar includes `engagementRate` =
`(likes + comments) / followers × 100` when followers are known.

Do **not** invent metrics that contradict the numbers given. Copy
`engagementRate` from the exemplar when classifying a post.

Produce a compact **batch memo** as JSON only (no Markdown fences, no preamble).

## Authority pillars

| Pillar | When to use |
|--------|-------------|
| `discovery` | Reach / curiosity / hooks that stop the scroll |
| `credibility` | Expertise / teaching / educational authority |
| `trust` | Proof / process / client stories / before-after |

## Output shape

```json
{
  "batchIndex": 0,
  "accountCount": 0,
  "themes": [
    {
      "theme": "short label",
      "pillar": "discovery|credibility|trust",
      "support": "1 sentence grounded in this batch",
      "exampleUsernames": ["studio.one"]
    }
  ],
  "hooks": [
    {
      "hookType": "Question hook",
      "structure": "Abstract structure, not a copied caption",
      "pillar": "discovery",
      "posts": [
        {
          "username": "studio.one",
          "platformPostId": "id-from-exemplar",
          "engagementRate": 2.4
        }
      ]
    }
  ],
  "formats": [
    {
      "format": "reel|carousel|image",
      "observation": "What this batch does with the format",
      "relativeStrength": "strong|moderate|weak|mixed"
    }
  ],
  "topics": [
    {
      "topic": "Kitchen projects",
      "pillar": "credibility",
      "accounts": 0,
      "note": "optional short note"
    }
  ],
  "hashtags": [
    { "tag": "#example", "note": "why it stood out in this batch" }
  ],
  "postingPatterns": [
    {
      "pattern": "e.g. weekday mornings",
      "note": "grounded in postingDays / exemplars"
    }
  ],
  "captionPatterns": [
    {
      "name": "Educational Misconception",
      "pillar": "discovery|credibility|trust",
      "summary": "One-line description of the recurring caption shape",
      "structure": [
        { "step": "Misconception", "detail": "The belief the reader already holds" },
        { "step": "Explanation", "detail": "Why it does not always hold up" }
      ],
      "exampleUsername": "studio.one",
      "examplePlatformPostId": "id-from-exemplar",
      "matchCount": 0
    }
  ],
  "anomalies": [
    {
      "username": "studio.one",
      "note": "outlier worth carrying to the reduce step"
    }
  ],
  "evidence": [
    {
      "username": "studio.one",
      "platformPostId": "id",
      "note": "why this exemplar matters"
    }
  ]
}
```

### Hook rules (critical)
- 3–6 hooks. Classify **real exemplars** from the batch into each hook.
- Every hook **must** include a `posts` array of exemplars that use that opener.
- Copy `platformPostId` and `engagementRate` from the exemplar (do not invent ER).
- Prefer patterns that appear across multiple accounts in **this** batch.
- Keep strings short. JSON only.

### Caption-pattern rules (critical)
- 3–5 `captionPatterns`. Each is a **recurring caption structure** — how the
  competitor *writes*, not what they post about. Group similar captions in this
  batch into one pattern.
- Describe frequency / prevalence only — **never** performance, reach or results.
- `structure` = 2–3 ordered steps ({ step, detail }); keep each `detail` to a
  short phrase. Keep `summary` to one short sentence.
- `exampleUsername` + `examplePlatformPostId` **must** reference a real exemplar
  from this batch (so the reduce step can pull the actual caption). Do not invent.
- `matchCount` = how many captions in this batch fit the pattern.

### Other rules
- 3–6 themes, 2–4 formats, 4–8 topics, ≤8 hashtags, ≤5 anomalies, ≤8 evidence rows.

## Batch data

{{BATCH_JSON}}
