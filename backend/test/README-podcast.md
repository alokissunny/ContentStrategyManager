# Podcast generator

Open the experimental Reel editor and select **Podcast generator**. Add host and guest files, select the recording type, review speaker names/trims and give an optional production brief. Choose landscape or portrait, audio cleanup and Brand Kit. Create an episode plan, review the proposed source cuts, then approve and download the MP4. Switching editor tabs preserves the in-progress session; refreshing the browser does not restore it.

## Production architecture

1. Media inspector checks the uploaded recordings and extracts audio for timestamped transcription.
2. Transcript editor identifies complete thoughts and question/answer boundaries.
3. Episode director proposes an interleaved timeline using actual source ranges.
4. Continuity critic independently reviews meaning and cut continuity. Rejected or unavailable analysis falls back to a clearly labeled conservative assembly.
5. Server validation enforces ownership, source bounds, chronology and conversation synchronization before the user reviews the plan.
6. Deterministic FFmpeg workers assemble shots, finish audio and apply the branding plate. A final media probe checks duration, dimensions and audio before uploading the MP4.

The first three editorial roles use separate model calls and prompts; audio finishing and render validation are deterministic tools. Brand Kit uses the active account's logo, selected palette and actual font files. The browser renders these into a transparent plate for FFmpeg, so podcast export does not substitute server fonts. Reel preview and export use the same Brand Kit styling.

`POST /api/reels/podcast/jobs` accepts 2–8 already-uploaded videos belonging to the authenticated user, host/guest roles, optional trims and manual offsets. The worker inspects media, transcribes speech, runs separately prompted transcript editor, episode director and independent continuity critic, and returns a reviewable edit plan. Invalid or unavailable editorial analysis produces an explicit conservative fallback.

`GET /api/reels/podcast/jobs/:id` polls status. `POST .../:id/render` approves the plan and optionally accepts an edited plan plus an account-owned `brandingKey` PNG. `DELETE .../:id` cancels work. The finished result contains a downloadable real H.264/AAC MP4. Portrait and landscape output are 720p at 30fps.

Conversation mode uses the FIRST host's selected recording as uninterrupted audio. It must contain the entire conversation. Guest recording offsets are relative to the host's original timeline: positive means the guest recording starts later; guest source time = host original time - offset. No automatic synchronization or speaker diarization is claimed. Separate-segment mode concatenates each chosen source's video and audio while enforcing source chronology.

Limits: 250MB per source, 750MB total, 20 minutes per source, 30 minutes output, 240 shots, two active workers, two pending jobs per account and eight pending jobs globally. Review jobs expire after two hours; temporary local inputs and rendering files are removed on finish, cancellation, failure, or expiry. Finished S3 outputs remain available as user artifacts. Jobs are process-local and do not survive restarts: use a single API instance or sticky routing. A persistent distributed job queue is required before horizontally scaling this feature.

Test without provider access: `node --test backend/test/podcastPlan.test.js backend/test/podcastJobs.test.js backend/test/podcastRender.test.js`. Tests include real FFmpeg render/audio/pixel checks; provider and storage boundaries are mocked for lifecycle tests.

Browser integration: start Vite on port 5188, then run `node backend/test/podcast.browser.cjs` with `PLAYWRIGHT_MODULE` pointing to Playwright and optionally `CHROMIUM_PATH` to an installed Chromium. It exercises uploads, all three editorial roles, review, branding, real FFmpeg output, download, revision, tab state, keyboard navigation and responsive layout. Storage, speech and model providers are mocked; no paid provider calls are made. Override the Vite URL with `REEL_TEST_URL`.

The existing reel export browser test additionally accepts `REEL_TEST_FONT=/absolute/path/to/font.ttf` to verify a custom Brand Kit font, theme and logo in preview and export.
