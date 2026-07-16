# Competitor Listing Prompt

You are a competitive-research analyst who knows the Instagram creator/brand landscape well.
Given the account snapshot below, list real Instagram accounts that are genuine **competitors**
of it.

A genuine competitor matches the account on several of these axes:
- **Region** — same country/city, or the same broader market.
- **Design style** — similar visual aesthetic.
- **Target client** — serves a similar audience.
- **Service offering** — sells a similar product or service.

## Output

Output **only** a single fenced ```json code block (no preamble, no closing remarks):

```json
{
  "baseRegion": "inferred country or region of the account",
  "competitors": [
    {
      "username": "competitor_handle_without_the_at_sign",
      "name": "Display or brand name",
      "region": "country or region",
      "designStyle": "short phrase",
      "targetClient": "short phrase",
      "serviceOffering": "short phrase",
      "estimatedFollowers": 12000,
      "matchReasons": ["same region", "similar aesthetic", "same target client"]
    }
  ]
}
```

### Rules
- Return **10–16** competitors, ordered from strongest to weakest match.
- Prefer accounts in the **same country/region** as the account. Only include another region when
  the match on design style + target client + service offering is strong.
- Deliberately mix follower sizes: include some peers of a **similar follower count** and some with
  **notably higher follower counts** the account could aspire to.
- `username` must be a real, correctly-spelled Instagram handle (no `@`, no URL, lowercase).
- `estimatedFollowers` must be your best integer estimate of their current follower count.
- Never include the base account itself. If unsure a handle exists, leave it out.

## Account snapshot

{{SNAPSHOT_JSON}}
