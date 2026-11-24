Design a high quality Instagram Story from the given format strategy. The Story strategist has already decided the frames, their words, their photos and the one interaction (`formatStrategy` in the strategy output) — your job is the design: how each vertical frame looks.

Return one self-contained HTML document only:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1" data-role="hook" data-aspect="9:16">...</article>
</section>
```

- One `<article class="slide" data-index="N" data-role="…" data-aspect="9:16">` per frame in `formatStrategy.frames`, in the same order and number — never add or drop a frame. Each is exactly `width:1080px;height:1920px`, `position:relative; overflow:hidden`. Px sizes only — no vw/vh or viewport clamp(). `data-role` = the frame's `role`.
- `data-slot` on every text run: `title` (the frame's `text`), `supporting-text` (its `subtext`), `sticker` (the interaction). Photos: `<img data-slot="image" data-asset-key="…">` with the frame's `photo.assetKey` exactly.
- Compact HTML: one `<style>` block with shared classes for what repeats, per-frame rules only for what differs. No comments except each photo frame's focal comment.
{{COMPOSITION_RULES}}
{{BRAND_ROLES}}
- HTML only. No explanation.

## Use the strategy's words exactly

- Each frame's `text` and `subtext` word for word (subtext only when not empty). Never add a headline, eyebrow, caption or extra line the strategy did not write.

## Story design principles

- **Instagram's safe zones.** The top 250px (profile row, progress bars) and the bottom 340px (reply bar) are covered by Instagram's own UI: no text, sticker or important part of the photo there. Keep text 72px inside the side edges.
- **Full-screen photo frames.** The photo is `position:absolute; inset:0; width:100%; height:100%; object-fit:cover`, `object-position` keeping the frame's `keepInFrame` in view of a 9:16 crop. Start each photo frame with `<!-- focal: what the frame is about, where it sits, and where the text will go -->`. Look at the attached photo before placing anything.
- **Big, quick text.** One line per frame, read in two seconds: the brand display font, 600–700 weight, roughly 72–110px, line-height 1.05–1.12, `text-wrap: balance`, `max-width` about 12em; the subtext 34–42px body font. Group text + subtext in ONE flex-column (16–24px gap) placed on the frame's `textArea` (top / middle / bottom within the safe zone) or another calm part of the photo — never over the subject.
- **Native Story texture, on brand.** Stories feel immediate: a text group may sit on a rounded label behind each line (`background` in a brand colour, 12–18px radius, generous padding — the Story "text background" look), or directly on a calm area of the photo. Pick one treatment and keep it across the frames. Light brand colour on dark areas, dark on pale ones; a soft gradient behind the group only where contrast still falls short. Accent colour for one emphasised word at most.
- **The interaction as a sticker.** On the frame whose `interaction.type` is not `none`, draw it as an Instagram-style sticker (`data-slot="sticker"`): a white rounded card (24–32px radius, soft shadow) in the middle third, holding the `prompt` in the body font and — for a poll — the two `options` as two equal pill rows; for a question box, an empty "Type something…" field; for a slider, a track with an emoji knob; for a link, a pill with a link icon and the prompt. It must sit clear of the text group and the subject.
- **Text-only frames** (no `assetKey`): a full solid Brand Kit ground, the line composed large with intent; may use the brand accent as the ground for the closing frame.
- **One sequence.** Same type system, margins and text treatment on every frame so the Story reads as one piece; vary placement only where the photo asks for it.
- **Brand consistency.** Respect the Brand Kit; use only the real photos.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
