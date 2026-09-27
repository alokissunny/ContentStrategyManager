// Start Vite on port 5188; set PLAYWRIGHT_MODULE and optional CHROMIUM_PATH.
// Real browser upload, branding rasterization, job lifecycle, FFmpeg, and download.
// Only storage, transcription, and LLM provider boundaries are mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const base = process.env.REEL_TEST_URL || 'http://127.0.0.1:5188';
const owner = 'a'.repeat(24), objects = new Map();
const output = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'podcast-browser-'));
const ffmpeg = require('ffmpeg-static');
const calls = [];
let speechCalls = 0;
let simulateExpiredJob = false;
function stub(name, exports) { const id = require.resolve('../src/services/' + name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
stub('s3Client', { isS3Configured: () => true, getPresignedUploadUrl: async key => base + '/__store/' + key,
  uploadBytes: async (key, buffer) => objects.set(key, buffer), getPresignedDownloadUrl: async key => base + '/__store/' + key,
  deleteObjects: async keys => keys.forEach(key => objects.delete(key)) });
stub('reelEditorAgent', { transcribeWords: async () => (speechCalls++, { text: 'A complete thought.', segments: [{ start: 0, end: 1, text: 'A complete thought.' }] }) });
stub('llmComplete', { completeToolCall: async args => {
  calls.push(args.tool.description);
  const data = JSON.parse(args.userParts[0].text);
  return { model: 'gpt-5.6-terra', usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 100 }, parsed: args.tool.description === 'Caption editor' ? { emphasisIndices: [0] }
    : args.tool.description === 'Overlay director' ? { captionIndices: [0] }
    : { approved: true, warnings: [] } };
} });
require('@aws-sdk/client-s3').S3Client.prototype.send = async command => {
  const buffer = objects.get(command.input.Key); assert.ok(buffer, command.input.Key);
  return { ContentLength: buffer.length, Body: Readable.from([buffer]) };
};
const controller = require('../src/controllers/podcastController');
const { signUpload } = require('../src/controllers/reelController');
for (const [name, color, frequency] of [['host', 'red', 440], ['guest', 'blue', 880]]) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=30:d=1`, '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(output, name + '.mp4')]);
}
(async () => {
 const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await page.addInitScript(() => localStorage.setItem('bauhly.debugPrompts', '1'));
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR', e.message); });
  await page.route('**/__store/**', async route => {
    const key = new URL(route.request().url()).pathname.slice('/__store/'.length);
    if (route.request().method() === 'PUT') { objects.set(key, route.request().postDataBuffer()); return route.fulfill({ status: 200, body: '' }); }
    return route.fulfill({ contentType: key.endsWith('.png') ? 'image/png' : 'video/mp4', body: objects.get(key) });
  });
  await page.route('**/api/reels/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const parts = url.pathname.split('/');
    const action = url.pathname.endsWith('/podcast/output') ? controller.output : url.pathname.endsWith('/sign') ? signUpload : request.method() === 'DELETE' ? controller.cancel
      : request.method() === 'GET' ? controller.status : url.pathname.endsWith('/render') ? controller.render : controller.create;
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = JSON.stringify(body); return this; } };
    await action({ method: request.method(), query: Object.fromEntries(url.searchParams), user: { _id: owner }, params: { id: parts[url.pathname.endsWith('/render') ? parts.length - 2 : parts.length - 1] }, body: request.postData() ? request.postDataJSON() : {} }, res);
    if (request.method() === 'DELETE' && simulateExpiredJob) {
      simulateExpiredJob = false;
      await new Promise(resolve => setTimeout(resolve, 1000));
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Podcast job not found or expired.' }) });
    }
    await route.fulfill({ status: res.code, contentType: 'application/json', body: res.body });
  });
  await page.route('**/__podcast-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {default:Podcast}=await import('/src/pages/reeleditor/PodcastGenerator.jsx');
    await import('/src/index.css');
    const tile=document.createElement('canvas');tile.width=120;tile.height=60;const c=tile.getContext('2d');c.fillStyle='#00ff00';c.fillRect(0,0,120,60);
    const kit={name:'TEST BRAND',palette:{accent:'#ff00ff',ground:'#ffffff',fg:'#111111'},typography:Object.fromEntries(['headline','body','detail'].map(k=>[k,{name:'Arial',stack:'Arial, sans-serif'}])),fonts:[],logo:{url:tile.toDataURL(),position:'top-right'}};
    createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Podcast,{brandKit:kit,owner:'browser-test'})));
  </script>` }));
  await page.goto(base + '/__podcast-test');
  for (const name of ['host', 'guest']) {
    await page.getByLabel(`Add ${name === 'host' ? 'Host' : 'Guest'} video`, { exact: true }).setInputFiles({ name: name + '.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(output, name + '.mp4')) });
    await page.getByText(name + '.mp4', { exact: true }).waitFor();
  }
  await page.getByLabel('Host start time (sec)').fill('0.2');
  await page.getByLabel('Guest start time (sec)').fill('0.1');
  await page.getByLabel('Primary audio source').selectOption('guest');
  const preview = page.getByRole('region', { name: 'Episode cut preview' });
  await page.waitForFunction(() => {
    const videos = [...document.querySelectorAll('.podcast-cut-screen video')];
    return videos.length === 2 && videos.every(v => v.readyState >= 2) && Math.abs(videos[0].currentTime - .2) < .05 && Math.abs(videos[1].currentTime - .1) < .05;
  });
  assert.equal(await preview.locator('video[data-visible=true]').count(), 2);
  assert.ok(await preview.locator('video').evaluateAll(videos => videos.every(v => v.muted)));
  assert.equal(objects.size, 0, 'Preview works before upload');
  await preview.getByRole('button', { name: 'Play preview', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.podcast-cut-preview audio').currentTime > .25);
  await preview.getByRole('button', { name: 'Pause preview', exact: true }).click();
  await page.getByRole('button', { name: 'Generate podcast', exact: true }).click();
  await page.getByRole('button', { name: 'Download MP4', exact: true }).waitFor({ timeout: 60000 });
  assert.deepEqual(calls, ['Caption editor', 'Overlay director', 'Decoration critic']);
  const costCheck = await page.evaluate(async () => {
    let entries = JSON.parse(localStorage.getItem('bauhly.debugPromptLog'));
    const summary = entries.find(e => e.source === 'Podcast generation — estimated cost');
    const id = JSON.parse(summary.output).jobId;
    const api = await import('/src/api/podcasts.js');
    await api.getPodcastJob(id); await api.getPodcastJob(id);
    entries = JSON.parse(localStorage.getItem('bauhly.debugPromptLog')).filter(e => e.id.startsWith(`podcast:${id}:`));
    return { entries, summary: entries.find(e => e.id.endsWith(':total')) };
  });
  assert.equal(costCheck.entries.length, 5, 'Polling does not duplicate costs');
  assert.equal(costCheck.summary.totalTokens, 3600);
  const detailsCost = costCheck.entries.filter(e => !e.id.endsWith(':total')).reduce((sum, e) => sum + e.estimatedCostUsd, 0);
  assert.ok(Math.abs(costCheck.summary.estimatedCostUsd - detailsCost) < .000001);
  assert.ok(costCheck.summary.estimatedCostUsd > 0);

  assert.equal(await page.getByRole('button', { name: 'Approve cuts & render MP4' }).count(), 0, 'Generate renders without an approval gate');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download MP4', exact: true }).click();
  const target = path.join(output, 'podcast.mp4'); await (await downloading).saveAs(target);
  assert.ok(fs.statSync(target).size > 10000);
  const pixel = (x, y) => execFileSync(ffmpeg, ['-loglevel', 'error', '-ss', '0.4', '-i', target, '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
  const left = pixel(320, 360), right = pixel(960, 360);
  assert.ok(left[0] > 200 && left[2] < 40 && right[2] > 200 && right[0] < 40, 'Host left, guest right in MP4');
  const logo = pixel(1100, 60); assert.ok(logo[1] > 200 && logo[0] < 50, 'Brand logo exported');
  const pcm = execFileSync(ffmpeg, ['-v', 'error', '-i', target, '-t', '0.5', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1']);
  let crossings = 0; for (let i = 2; i < pcm.length; i += 2) if (pcm.readInt16LE(i - 2) < 0 && pcm.readInt16LE(i) >= 0) crossings++;
  assert.ok(crossings > 380 && crossings < 500, 'Guest audio (880 Hz), not host (440 Hz), is exported');
  await page.screenshot({ path: path.join(output, 'podcast-ui.png'), fullPage: true });
  await page.getByText('Podcast saved on this browser.', { exact: true }).waitFor({ timeout: 30000 });
  // A completed local video must survive without the process-local job.
  await page.route('**/api/reels/podcast/jobs/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({message:'Expired job'}) }));
  await page.reload();
  await page.getByRole('button', { name: 'Download MP4', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.podcast-result video')?.src.startsWith('blob:'));
  assert.equal(await page.getByLabel('Primary audio source').inputValue(), 'guest');
  assert.equal(await page.getByLabel('Host start time (sec)').inputValue(), '0.2');
  assert.equal(await page.getByLabel('Guest start time (sec)').inputValue(), '0.1');
  await page.getByText('host.mp4', { exact: true }).waitFor();
  const restoredDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download MP4', exact: true }).click();
  const restoredPath = path.join(output, 'restored.mp4'); await (await restoredDownload).saveAs(restoredPath);
  assert.deepEqual(fs.readFileSync(restoredPath), fs.readFileSync(target), 'Reload restores the exact rendered bytes');
  await page.getByRole('button', { name: 'Edit podcast', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Podcast edit mode' });
  await editor.locator('.podcast-edit-list button').filter({ hasText: 'Caption' }).first().click();
  await editor.getByLabel('Text', { exact: true }).fill('Revised podcast caption');
  await editor.getByRole('button', { name: 'Middle', exact: true }).click();
  await editor.getByLabel('Text size', { exact: true }).fill('42');
  await editor.getByLabel('Animation', { exact: true }).selectOption('none');
  await editor.getByRole('button', { name: 'Add overlay', exact: true }).click();
  await editor.getByLabel('Text', { exact: true }).fill('My added callout');
  await editor.getByRole('button', { name: 'Delete text', exact: true }).click();
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByText('Podcast saved on this browser.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Edit podcast', exact: true }).click();
  await editor.locator('.podcast-edit-list button').filter({ hasText: 'Revised podcast caption' }).click();
  assert.equal(await editor.getByLabel('Text size', { exact: true }).inputValue(), '42');
  assert.equal(await editor.locator('.podcast-edit-list button').filter({ hasText: 'My added callout' }).count(), 1, 'Undo and edits persist after reload');
  await page.unroute('**/api/reels/podcast/jobs/**');
  await editor.getByRole('button', { name: 'Export edited MP4', exact: true }).click();
  await page.getByRole('button', { name: 'Download MP4', exact: true }).waitFor({ timeout: 60000 });
  assert.equal(calls.length, 3, 'Manual export does not rerun editorial agents');
  assert.equal(speechCalls, 1, 'Manual export does not retranscribe');
  const editedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download MP4', exact: true }).click();
  const editedPath = path.join(output, 'edited.mp4'); await (await editedDownload).saveAs(editedPath);
  assert.notDeepEqual(fs.readFileSync(editedPath), fs.readFileSync(target), 'Edits produce a new rendered video');
  const textPixels = execFileSync(ffmpeg, ['-v', 'error', '-ss', '0.4', '-i', editedPath, '-frames:v', '1', '-vf', 'crop=640:120:320:250,format=rgb24', '-f', 'rawvideo', 'pipe:1']);
  let editedWhite = 0; for (let i = 0; i < textPixels.length; i += 3) if (textPixels[i] > 200 && textPixels[i + 1] > 200 && textPixels[i + 2] > 200) editedWhite++;
  assert.ok(editedWhite > 100, 'Repositioned caption is burned into the middle of the exported frame');



  await page.getByRole('button', { name: 'Edit videos & generate again' }).click();
  assert.equal(await page.getByLabel('Host start time (sec)').isEnabled(), true);
  assert.equal(await page.getByLabel('Guest start time (sec)').inputValue(), '0.1');
  await page.route('**/api/auth/me', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { _id: owner, business: { name: 'Studio test' } } }) }));
  await page.route('**/__studio-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const studioSource=await (await fetch('/src/pages/reeleditor/ReelEditor.jsx')).text();
    const routerUrl=studioSource.match(/from ["']([^"']*react-router-dom[^"']*)["']/)[1];
    const {MemoryRouter} = await import(routerUrl);
    const authUrl=studioSource.match(/from ["']([^"']*context[^"']*AuthContext[^"']*)["']/)[1];
    const {AuthProvider} = await import(authUrl);
    const {default:Studio}=await import('/src/pages/reeleditor/ReelEditor.jsx');
    await import('/src/index.css');
    createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(AuthProvider,null,React.createElement(Studio))));
  </script>` }));
  await page.evaluate(() => { localStorage.setItem('widesignals_token', 'test'); localStorage.setItem('bauhly.ff.reelEditor', '1'); });
  await page.goto(base + '/__studio-test');
  await page.getByRole('tab', { name: 'Podcast generator' }).click();
  await page.getByLabel('Production notes (optional)').fill('Keep this direction across tabs');
  await page.getByRole('tab', { name: 'Reel editor', exact: true }).click();
  await page.getByRole('tab', { name: 'Reel editor', exact: true }).press('ArrowRight');
  assert.equal(await page.getByLabel('Production notes (optional)').inputValue(), 'Keep this direction across tabs');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile layout must not overflow');
  await page.evaluate(() => localStorage.setItem('bauhly.ff.reelEditor', '0'));
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes('Experimental'));
  assert.equal(await page.getByRole('tab').count(), 0, 'Feature flag gates both tabs');
  assert.deepEqual(errors, []);
  console.log('PASS: two uploads, independent starts, chosen audio, live paired preview, three decoration agents, automatic branded/captioned render, download and revision. Artifacts:', output);
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
