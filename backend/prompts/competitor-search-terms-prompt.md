# Competitor Search-Terms Prompt

You are helping find Instagram competitors for a business. From the account snapshot below,
produce the **Instagram hashtags** that real competitors in the same niche and region would
post under. These hashtags will be used to search Instagram for actual competing accounts.

## Output

Output **only** a single fenced ```json code block:

```json
{
  "region": "inferred country or region of the account",
  "hashtags": ["nichehashtag", "regionalnichehashtag", "servicehashtag"]
}
```

### Rules
- Return **6–10** hashtags, without the leading `#`, lowercase, no spaces.
- Mix these kinds so the search surfaces both local peers and larger aspirational accounts:
  - **region-specific** hashtags (country/city + niche, e.g. `interiordesignspain`, `reformasbaño`)
    to find local competitors of a similar size;
  - **audience** hashtags (who they serve);
  - at least **2 broad, high-volume niche hashtags** with no region (e.g. `bathroomdesign`,
    `interiordesign`) — these surface the bigger, higher-follower accounts in the field.
- Prefer hashtags that real businesses in this niche actually use — popular enough to return
  results, specific enough to stay on-topic. Avoid generic tags like `#love` or `#instagood`.
- Base every hashtag on the snapshot's bio, captions, and Brand DNA. Do not invent a region that
  isn't supported by the data — if region is unclear, omit region-specific hashtags.

## Account snapshot

{{SNAPSHOT_JSON}}
