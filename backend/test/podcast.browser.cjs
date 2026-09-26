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
function stub(name, exports) { const id = require.resolve('../src/services/' + name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
stub('s3Client', { isS3Configured: () => true, getPresignedUploadUrl: async key => base + '/__store/' + key,
  uploadBytes: async (key, buffer) => objects.set(key, buffer), getPresignedDownloadUrl: async key => base + '/__store/' + key,
  deleteObjects: async keys => keys.forEach(key => objects.delete(key)) });
stub('reelEditorAgent', { transcribeWords: async () => ({ text: 'A complete thought.', segments: [{ start: 0, end: 1, text: 'A complete thought.' }] }) });
stub('llmComplete', { completeToolCall: async args => {
  calls.push(args.tool.description);
  const data = JSON.parse(args.userParts[0].text);
  return { parsed: args.tool.description === 'Transcript editor' ? { notes: 'Complete question and answer.', warnings: [] }
    : args.tool.description === 'Continuity critic' ? { approved: true, warnings: [] }
    : { title: 'Host meets guest', summary: 'Question followed by answer.', segments: data.assets.map(a => ({ assetId: a.id, sourceStart: a.startSec, sourceEnd: a.endSec, reason: 'Complete speaker turn.' })) } };
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
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR', e.message); });
  await page.route('**/__store/**', async route => {
    const key = new URL(route.request().url()).pathname.slice('/__store/'.length);
    if (route.request().method() === 'PUT') { objects.set(key, route.request().postDataBuffer()); return route.fulfill({ status: 200, body: '' }); }
    return route.fulfill({ contentType: key.endsWith('.png') ? 'image/png' : 'video/mp4', body: objects.get(key) });
  });
  await page.route('**/api/reels/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const parts = url.pathname.split('/');
    const action = url.pathname.endsWith('/sign') ? signUpload : request.method() === 'DELETE' ? controller.cancel
      : request.method() === 'GET' ? controller.status : url.pathname.endsWith('/render') ? controller.render : controller.create;
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = JSON.stringify(body); return this; } };
    await action({ method: request.method(), user: { _id: owner }, params: { id: parts[url.pathname.endsWith('/render') ? parts.length - 2 : parts.length - 1] }, body: request.postData() ? request.postDataJSON() : {} }, res);
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
    createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Podcast,{brandKit:kit})));
  </script>` }));
  await page.goto(base + '/__podcast-test');
  await page.locator('input[type=file]').setInputFiles(['host', 'guest'].map(name => ({ name: name + '.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(output, name + '.mp4')) })));
  await page.getByText('guest.mp4', { exact: true }).waitFor();
  await page.getByLabel('Recording type').selectOption('segments');
  await page.getByRole('button', { name: 'Create episode plan' }).click();
  await page.getByRole('button', { name: 'Approve cuts & render MP4' }).waitFor({ timeout: 30000 });
  assert.deepEqual(calls, ['Transcript editor', 'Episode director', 'Continuity critic']);
  await page.getByRole('button', { name: 'Approve cuts & render MP4' }).click();
  await page.getByRole('button', { name: 'Download MP4', exact: true }).waitFor({ timeout: 60000 });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download MP4', exact: true }).click();
  const target = path.join(output, 'podcast.mp4'); await (await downloading).saveAs(target);
  assert.ok(fs.statSync(target).size > 10000);
  // The real branding plate must reach FFmpeg and survive in the output.
  for (const [second, expected] of [[0.2, 'red'], [1.2, 'blue']]) {
    const pixel = (x, y) => execFileSync(ffmpeg, ['-loglevel', 'error', '-ss', String(second), '-i', target, '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
    const center = pixel(640, 300); assert.ok(expected === 'red' ? center[0] > 200 && center[2] < 40 : center[2] > 200 && center[0] < 40, 'Camera sequence');
    const logo = pixel(1100, 60); assert.ok(logo[1] > 200 && logo[0] < 50 && logo[2] < 50, 'Brand logo burned into video');
    const band = pixel(200, 630); assert.ok(band[0] > 230 && band[1] > 230 && band[2] > 230, 'Brand theme background');
  }
  await page.screenshot({ path: path.join(output, 'podcast-ui.png'), fullPage: true });
  await page.getByRole('button', { name: 'Revise sources / start a new plan' }).click();
  await page.getByRole('button', { name: 'Create episode plan' }).click();
  await page.getByRole('button', { name: 'Approve cuts & render MP4' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Revise sources / start a new plan' }).click();
  await page.getByRole('button', { name: 'Create episode plan' }).waitFor();
  await page.route('**/api/auth/me', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { _id: owner, business: { name: 'Studio test' } } }) }));
  await page.route('**/__studio-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const studioSource=await (await fetch('/src/pages/reeleditor/ReelEditor.jsx')).text();
    const routerUrl=studioSource.match(/from ["']([^"']*react-router-dom[^"']*)["']/)[1];
    const {MemoryRouter} = await import(routerUrl);
    const {AuthProvider} = await import('/src/context/AuthContext.jsx');
    const {default:Studio}=await import('/src/pages/reeleditor/ReelEditor.jsx');
    await import('/src/index.css');
    createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(AuthProvider,null,React.createElement(Studio))));
  </script>` }));
  await page.evaluate(() => { localStorage.setItem('widesignals_token', 'test'); localStorage.setItem('bauhly.ff.reelEditor', '1'); });
  await page.goto(base + '/__studio-test');
  await page.getByRole('tab', { name: 'Podcast generator' }).click();
  await page.getByLabel('Production brief').fill('Keep this direction across tabs');
  await page.getByRole('tab', { name: 'Reel editor', exact: true }).click();
  await page.getByRole('tab', { name: 'Reel editor', exact: true }).press('ArrowRight');
  assert.equal(await page.getByLabel('Production brief').inputValue(), 'Keep this direction across tabs');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile layout must not overflow');
  await page.evaluate(() => localStorage.setItem('bauhly.ff.reelEditor', '0'));
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes('Experimental'));
  assert.equal(await page.getByRole('tab').count(), 0, 'Feature flag gates both tabs');
  assert.deepEqual(errors, []);
  console.log('PASS: upload, three editorial agents, review, branded FFmpeg MP4, host/guest interleave, download and revise. Artifacts:', output);
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
