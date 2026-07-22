Analyze the provided JSON containing one competitor’s Instagram profile data and posts from the last {{WINDOW_DAYS}} days.

Return only valid JSON (no markdown, no commentary) with exactly these keys:

```json
{
  "country": "string or null",
  "countryConfidence": "High | Medium | Low | null",
  "accountType": "string or null",
  "followersCount": "number or null",
  "postsAnalyzed": "number or null",
  "averagePostsPerWeek": "number or null",
  "postingFrequency": "Daily | Frequent | Weekly | Occasional | Inactive | Unknown",
  "averageLikes": "number or null",
  "averageComments": "number or null",
  "engagementRate": "number or null",
  "estimatedPerformance": "Excellent | Good | Average | Below Average | Unknown",
  "primaryContentType": "string or null",
  "dominantPostFormat": "string or null",
  "latestPostDate": "ISO date string or null"
}
```

Rules:
- Use profile bio, website, location tags, captions, and post metrics.
- Do not guess missing data. Use `null` or `"Unknown"` when information is unavailable.
- Do not treat likes, comments, or views as actual reach.
- `engagementRate` must be follower-based: ((average likes + average comments) / followers) × 100 when both are known; otherwise null.
- Prefer the supplied `computed` block for quantitative fields when present — do not invent different numbers.
- Infer `country`, `accountType`, `postingFrequency`, `estimatedPerformance`, and `primaryContentType` from evidence only.

Input JSON:
{{PAYLOAD_JSON}}
