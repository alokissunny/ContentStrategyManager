# Podcast generator

The UI has one Host upload, one Guest upload, independent start times, and a Host/Guest primary-audio selector. The host is always left and the guest right. Both videos start at their own selected source times at output time zero; output lasts until the shorter remaining recording finishes. Only selected primary audio is used. The browser offers a live paired source preview before upload. Generate uploads, plans decoration, prepares Brand Kit, renders and exposes the finished MP4 without an approval gate. The final MP4 preview includes rendered captions/overlays; the source preview does not.

## Multi-agent production

1. Inspect source metadata and transcribe only the selected audio, with timestamps.
2. Caption editor selects meaningful transcript passages for emphasis. Caption wording/timing is grounded deterministically in the transcript, grouped into readable phrases.
3. Overlay director chooses restrained exact-quote callouts (maximum eight, separated by ten seconds).
4. Independent decoration critic rejects misleading or incomplete quotations. Failed review omits overlays while retaining transcript captions.
5. FFmpeg places host/guest side by side, applies audio cleanup, caption fades and animated quote entrances, and composites the Brand Kit plate. A final probe validates dimensions, duration and audio.

No reliable transcript means no invented captions or quotes; the output contains the original audio/video and a production warning. Model/storage providers are mocked in tests; live provider quality is not asserted by those tests.

## API

POST `/api/reels/podcast/jobs`: `{workflow:'simple',mode:'conversation',layout:'side-by-side',assets:[host,guest],primaryAudioSource:'host'|'guest',aspectRatio:'16:9'|'9:16',cleanAudio,guidance,brand?}`. Each asset has `{id,key,role,name,startSec,endSec?}`. Authenticated account ownership is enforced. The job reaches internal `review` status once decoration is ready; the frontend automatically calls POST `.../:id/render` with optional account-owned `brandingKey`. GET `.../:id` polls progress, and DELETE cancels. Legacy camera-cut/segment requests remain supported without `workflow:'simple'`.

Limits: 250 MB per source, 20 minutes per source, two active workers, two pending jobs per account, eight pending jobs globally. Jobs expire after two hours. Jobs are process-local, do not survive restarts, and require a single API instance/sticky routing. Use a persistent queue before horizontal scaling. Browser refresh restores source files, start times, audio selection and the finished MP4 from account/handle-scoped IndexedDB storage. Unfinished jobs resume status polling when still present; expired jobs retain editable recordings and report that generation must restart. Saved output keys can renew download URLs through authenticated GET `/api/reels/podcast/output?key=...`, independently of process-local job expiry. Local saves remain on this browser/device and may fail when browser storage is full. Finished S3 artifacts persist; temporary render files are cleaned up.

## Verification

`node --test backend/test/podcastPlan.test.js backend/test/podcastDecoration.test.js backend/test/podcastJobs.test.js backend/test/podcastRender.test.js`

Start Vite on port 5188, then run `node backend/test/podcast.browser.cjs`. Set `PLAYWRIGHT_MODULE` and optionally `CHROMIUM_PATH` for your local installation, or `REEL_TEST_URL` for another Vite URL. This exercises separate uploads, preview, distinct starts, selected guest audio, automatic decorated/brand render, download, revision, tabs and responsive layout using actual Chromium and FFmpeg.

## Edit mode

After generation, Edit podcast opens a paired source preview with editable caption and overlay tracks. Users can add/remove text, adjust timing, font size, position (including drag), and none/fade/slide motion, with undo and account-scoped draft persistence. Done saves the draft; Export edited MP4 creates a new render from the source files. Manual edits are validated server-side (3000 captions, 50 overlays, episode-bounded timing, bounded positions/sizes) and skip transcription/editorial calls. The source preview shows text edits; Brand Kit and audio cleanup are applied in the final render. The previous MP4 does not include unsaved-to-video edits; use Export edited MP4 to render them.
