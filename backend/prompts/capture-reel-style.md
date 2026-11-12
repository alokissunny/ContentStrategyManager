## Follow the reel style

The studio picked a reference reel's style (REEL STYLE below). Reproduce its EDITING PATTERN with THIS capture's footage and THIS studio's truth. The style decides the form; the capture decides every fact.

- **Audio.** If `audio.mode` is `music`: set `audioMode` to `music`, leave every `voiceLine` empty, and tell the story in on-screen words (`overlayText`). If it is `voiceover` or `voiceover+music`: set `audioMode` to `voiceover` (or `original` when a clip has someone clearly talking and that fits the style), and write narration with the style's voice tone and pace. A music bed is added automatically when the style has one.
- **Pacing.** Open on the strongest shot and hold it about `pacing.hookHoldSec`. After that, shots run about `pacing.shotSec`. In music mode set each `durationSec` near `pacing.shotSec` (cuts are snapped to the beat afterwards). In voiceover mode give each shot one short line; for fast styles (`shotSec` under 1.5) write MORE shots with shorter lines (4–8 words) — longer lines are also split across extra shots automatically. Aim for `pacing.targetLengthSec` overall (never over 45 s).
- **Hook.** Build it with the same mechanic as `hook.pattern` / `hook.example` (a repeated chant word, a numbered-list promise, a before/after line…) using this capture's own subject. `hook.text` is what appears in the first seconds; for a chant, repeat the word with spaces (e.g. "Look look look").
- **On-screen words.** `overlayText` follows `text.perShot` and `text.wording`: short (≤ 6 words), in the studio's language, and empty where the style shows nothing. A repeated single word on every shot is fine when that is the style.
- **Chapters.** Only when `chapters.numbered` is true and `chapters.card` is `white-card`: insert chapter cards as scenes with `assetId` "CARD", `cardNumber` 1, 2, 3…, `overlayText` = the chapter title (≤ 5 words) and, in voiceover mode, `voiceLine` = the spoken chapter intro. Otherwise every `cardNumber` is 0.
- **Ending.** Follow `cta.pattern`; keep `cta.line` short.
- **Long takes.** A still photo cannot hold a long take — it reads as a frozen frame after ~5 s. When the style holds long shots (`pacing.shotSec` over 4, or a single continuous take), use 3–5 photos of about 4–6 s each with slow camera moves (`push-in`, `pan-left`, `pan-right`, `pull-out`) so it keeps the same calm, unhurried feel. A real clip can hold longer.
- Never put the same photo in two shots in a row — a repeated still reads as a cut that did nothing. (Two different trims of one clip are fine.)
- `kicker` stays empty in a styled reel.
- Never copy the reference's words, names, places or claims, and never mention the reference.
