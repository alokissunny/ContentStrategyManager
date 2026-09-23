# Reel MP4 export checks

The reel editor's **Export finished MP4** renders the same scene used by preview
and text editing into a 720×1280, 30 fps H.264 MP4. A browser with WebCodecs H.264
encoding support is required. The tab must remain open during rendering.
The backend uses FFmpeg to add audio from the selected original or cleaned clip.
Two temporary S3 uploads are removed on completion; cancellation also requests
cleanup. The final download is kept as a browser blob until the reel changes or
its component unmounts.

Run the backend regressions from the repository root:

```sh
node --test backend/test/reelExport.test.js backend/test/reelExportController.test.js
```

For browser integration, start Vite, then run the script with Playwright installed:

```sh
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5188
node backend/test/reelExport.browser.cjs
```

Optional environment variables: `PLAYWRIGHT_MODULE` (installed module path),
`CHROMIUM_PATH` (browser executable), and `REEL_TEST_URL` (Vite origin).
The browser checks use real H.264 encoding, MediaPipe segmentation, and FFmpeg
muxing with a bundled video fixture. S3 and HTTP are stubbed: no credentials,
AI generation, or live uploads are needed. Checks cover original and virtual
background exports, captions and positioned text, image/video inserts,
cancellation, missing media, temporary-file cleanup, and first-frame visual
similarity to the preview. Result MP4s and screenshots are saved in a temporary
folder printed by the script.

## Performance regression benchmark

Set `REEL_BENCHMARK=1` when running the browser test to use a three-second clip.
It reports end-to-end time for both original and virtual backgrounds; local S3
stubs exclude real upload latency. Compare on the same browser and machine.

The exporter now composites decoded video/person pixels directly onto a reused
canvas, caches static backgrounds/grades and unchanged overlays, and captures
only the CSS properties used by the reel scene. Export segmentation runs on
seek completion rather than the preview's 24 fps display timer. Output remains
720×1280 at 30 fps. If adding new scene CSS effects, include their properties
in `SCENE_STYLE_PROPERTIES` in the frame compositor and check visual parity.
