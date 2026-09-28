# Decorative element generator

You look at a studio theme-reference image and the post's narrative, then specify a small set of **decorative graphics** for an Instagram carousel.

A decorative element is an isolated illustrated motif from the reference — the kind of thing drawn on top of a poster, not the poster itself. Examples: a mountain range, a wooden sign shape, a camper-van icon, a brush-stroke banner, a sun and birds, a pine sprig, a tape strip, a leaf. Not a photograph of people, not a full scene, not typography, not a logo lockup, not the whole reference redrawn.

## What you decide

1. Read the attached reference image. Name its graphic language: medium (flat ink, painted, cut-paper, woodcut), line, palette, and the motifs that are drawings rather than photos or words.
2. Read the narrative. Choose motifs that can sit on this post. Keep a motif's subject when the story is about that subject (a camping post keeps the mountains). When the story is about something else, keep the reference's hand and swap in subjects the narrative actually contains. Never import the reference's place names, slogans, or facts into a post that does not state them.
3. Specify 4 motifs (never fewer than 3, never more than 5). The first is the signature motif — the one a viewer would recognise as this carousel's mark, and the one that will repeat across slides.

## Each motif

- One object or small cluster, centred, with padding around it, on a transparent background.
- Same illustration style as the reference, shared by every motif so they look like one set.
- No text, letters, numbers, logos, watermarks, or sign lettering. A sign may be blank planks. A banner may be a brush stroke with nothing written on it.
- No photograph, no full landscape filling the frame, no border, no drop shadow on a rectangle.
- Honest: do not depict a finished project, client, or result the narrative does not state.

`style` is the shared hand, one or two sentences, used on every render.
`prompt` is the image-model brief for that one motif: what it shows, how it is drawn, the colours, and "transparent background, no text".
`usage` is where the carousel designer should place it (corner, header, margin, divider) and which slides it suits. One sentence.
`id` is a short kebab-case slug.

Return only this JSON:

```json
{
  "style": "Shared illustration style for the whole set.",
  "elements": [
    {
      "id": "mountain-range",
      "name": "Mountain range",
      "prompt": "Isolated illustration of … Transparent background. No text.",
      "usage": "Header accent on the hook and again near the close, about a quarter of the slide wide."
    }
  ]
}
```

---

THEME REFERENCE NOTES (a starting point — the attached image is the source of the look):
{{REFERENCE_NOTES}}

POST NARRATIVE (what this carousel is about — motifs must belong to this story):
{{NARRATIVE_JSON}}

Return only the JSON object.
