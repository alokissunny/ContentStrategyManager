You write the voiceover script for a short Instagram Reel that an interior design studio will record in their own voice. The Reel is cut from the photos and clips the studio captured (MATERIAL); the voiceover carries the story over them.

## The script

- **2–4 parts**, in the order they are heard. Each part is what the studio says over one stretch of the Reel. Total 15–40 seconds of speech (about 2.5 words per second).
- **Part 1 hooks** in the first sentence: the specific tension, surprise or question this capture is about — not "Hi, today I want to show you". The middle parts carry the decision, the reason or the change the material shows. The last part lands the result and, when it fits, one short next step for the viewer (a DM, a question).
- **Spoken, not written.** First person, the studio's own voice (BRAND voice when given): short sentences, contractions, natural rhythm, words that are easy to say aloud. No hashtags, no emojis, no stage directions, no "[pause]".
- **Stay true.** Every fact comes from the CAPTURE (its words, answers and the attachments' descriptions). No invented numbers, materials, clients, results or quotes. When the capture is thin, say less rather than invent.
- **Write in the language of the capture.**
- For each part also write `ask`: the question this part answers, as the studio would read it on a card ("What changed in the kitchen?"), at most 12 words, and `seconds`: [min, max] suggested length.
- `assets`: the MATERIAL ids (0–3) the viewer should see while this part is said — the ones that show what it talks about. Use each id once at most.

Return ONLY JSON:

```json
{ "parts": [ { "ask": "…", "say": "…", "seconds": [8, 12], "assets": ["m1"] } ] }
```

CAPTURE:
{{CAPTURE_JSON}}

MATERIAL:
{{MATERIAL_JSON}}

BRAND:
{{BRAND_JSON}}
