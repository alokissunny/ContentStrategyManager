# Batch memo prompt (map step)

You are summarising a **batch** of condensed competitor Instagram accounts for a
renovation / interior-design competitive-intelligence system.

The accounts were already compressed locally: window rollups + a few exemplar
posts each. Do **not** invent metrics that contradict the numbers given.

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
      "exampleUsernames": ["studio.one"]
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

### Rules
- 3–6 themes, 3–6 hooks, 2–4 formats, 4–8 topics, ≤8 hashtags, ≤5 anomalies, ≤8 evidence rows.
- Prefer patterns that appear across multiple accounts in **this** batch.
- Keep strings short. JSON only.

## Batch data

{{BATCH_JSON}}
