// Start Vite first: npm --prefix frontend run dev -- --host 127.0.0.1 --port 5188
// Run with Playwright available (or set PLAYWRIGHT_MODULE to its installed path).
// Optional: CHROMIUM_PATH, REEL_TEST_URL. Uses real encoding/muxing; no live S3/AI.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const baseUrl = process.env.REEL_TEST_URL || 'http://127.0.0.1:5188';
const outputDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'reel-export-browser-'));
const { execFileSync } = require('node:child_process');
const ffmpeg = require(root + '/backend/node_modules/ffmpeg-static');
const clipSeconds = process.env.REEL_BENCHMARK === '1' ? 3 : 0.8;
const objects = new Map();
function stub(name, exports) { const id = require.resolve(root + '/backend/src/services/' + name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
stub('s3Client', { isS3Configured: () => true, getPresignedUploadUrl: async (key) => baseUrl + '/__store/' + key,
 getObjectBytes: async (key) => ({ buffer: objects.get(key) }), deleteObjects: async (keys) => keys.forEach(k => objects.delete(k)) });
stub('reelEditorAgent', { runReelEditor: async () => ({}) });
const { signUpload, exportReel, cleanupReelExport } = require(root + '/backend/src/controllers/reelController');
execFileSync(ffmpeg, ['-y','-loglevel','error','-i',root+'/frontend/public/assets/photo/ph/ph-reel-write.mp4','-f','lavfi','-i',`sine=frequency=880:duration=${clipSeconds}`,'-map','0:v:0','-map','1:a:0','-t',String(clipSeconds),'-vf','scale=360:-2','-c:v','libx264','-c:a','aac',path.join(outputDir, 'source.mp4')]);
(async () => {
 const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || undefined});
 try {
  const page = await browser.newPage({viewport:{width:1100,height:900},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',e=>{errors.push(e.message); console.log('PAGE ERROR',e.message)});
  page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,300))});
  await page.route('**/__source.mp4',r=>r.fulfill({contentType:'video/mp4',body:fs.readFileSync(path.join(outputDir, 'source.mp4'))}));
  await page.route('**/__store/**',async r=>{objects.set(new URL(r.request().url()).pathname.slice('/__store/'.length),r.request().postDataBuffer());await r.fulfill({status:200,body:''})});
  await page.route('**/api/reels/**',async r=>{
    const res={statusCode:200,headers:{},status(c){this.statusCode=c;return this},json(body){this.body=JSON.stringify(body);this.headers['content-type']='application/json';return this},set(k,v){this.headers[k]=v;return this},send(body){this.body=body;return this}};
    await (r.request().url().endsWith('/sign')?signUpload:r.request().url().endsWith('/cleanup')?cleanupReelExport:exportReel)({user:{_id:'123456789012345678901234'},body:r.request().postDataJSON()},res);
    await r.fulfill({status:res.statusCode,headers:res.headers,body:res.body});
  });
  await page.route('**/__reel-export-test',r=>r.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {default:Button}=await import('/src/pages/reeleditor/ReelExportButton.jsx');
    const {default:Scene}=await import('/src/pages/reeleditor/ReelScene.jsx');
    await import('/src/index.css'); await import('/src/pages/reeleditor/reelEditor.css');
    const sourceFile=await (await fetch('/__source.mp4')).blob();
    const url=URL.createObjectURL(sourceFile);
    const tile=document.createElement('canvas');tile.width=80;tile.height=80;tile.getContext('2d').fillStyle='red';tile.getContext('2d').fillRect(0,0,80,80);
    const initial={meta:{durationSec:${clipSeconds}},background:'original',grade:true,brand:{name:'TEST BRAND',tag:'export'},strategy:{hook:'MOVE THIS TITLE',position:{x:50,y:28}},captions:{style:'karaoke',cues:[{start:0,end:${clipSeconds},text:'Export every word',position:{x:50,y:63}}]},animations:[{type:'pointer',start:0,end:${clipSeconds},position:{x:20,y:50}},{type:'zoom',start:0,end:${clipSeconds}},{type:'callout',text:'Look here',start:0,end:${clipSeconds},position:{x:60,y:48},motion:'pop'}],sections:[{start:0,end:${clipSeconds},headline:'Finished reel',eyebrow:'INCLUDED'}],visualAssets:[{id:'tile',kind:'image',url:tile.toDataURL(),name:'Red tile'},{id:'clip',kind:'video',url,name:'Video insert'}],mediaOverlays:[{assetId:'tile',start:0,end:${clipSeconds},width:20,position:{x:80,y:76}},{assetId:'clip',start:.2,end:.6,width:22,sourceStart:0,position:{x:20,y:75}}]};
    function App(){const [spec,setSpec]=React.useState(initial);window.setSpec=setSpec;const video=React.useRef(null);return React.createElement(React.Fragment,null,React.createElement('div',{style:{width:300,height:533.333333},id:'preview'},React.createElement(Scene,{spec,videoRef:video,videoUrl:url,time:0})),React.createElement(Button,{videoUrl:url,spec,sourceFile}));}
    createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));
    </script>`}));
  await page.goto(baseUrl + '/__reel-export-test');
  await page.getByRole('button',{name:'Export finished MP4',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#preview video')?.readyState >= 2);
  await page.locator('#preview').screenshot({path:path.join(outputDir, 'preview.png')});
  for(const background of ['original','ocean']){
   if(background!=='original')await page.evaluate(()=>window.setSpec(s=>({...s,background:'ocean'})));
   const started = performance.now();
   await page.getByRole('button',{name:'Export finished MP4',exact:true}).click();
   await Promise.race([page.getByRole('link',{name:'Download MP4',exact:true}).waitFor({timeout:120000}),page.getByRole('alert').waitFor({timeout:120000}).then(async()=>{throw Error(await page.getByRole('alert').innerText())})]);
   const event=page.waitForEvent('download');await page.getByRole('link',{name:'Download MP4',exact:true}).click();await (await event).saveAs(path.join(outputDir, background+'.mp4'));
   console.log('EXPORTED', background, { clipSeconds, elapsedMs: Math.round(performance.now() - started) });
  }
  await page.getByRole('button',{name:'Export finished MP4',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByText('Export cancelled. Your edits are saved.',{exact:true}).waitFor();
  await page.evaluate(()=>window.setSpec(s=>({...s,background:'original',mediaOverlays:[{assetId:'missing',start:0,end:.8}]})));
  await page.getByRole('button',{name:'Export finished MP4',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'An overlay is missing'}).waitFor();
  assert.equal(objects.size,0,'temporary uploads must be removed');
  const comparison = require('node:child_process').spawnSync(ffmpeg, ['-hide_banner',
    '-i', path.join(outputDir, 'original.mp4'), '-i', path.join(outputDir, 'preview.png'),
    '-filter_complex', '[0:v]scale=300:533,crop=260:493:20:20,format=yuv444p[a];[1:v]crop=260:493:20:20,format=yuv444p[b];[a][b]ssim',
    '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(comparison.status, 0);
  const similarity = Number(comparison.stderr.match(/All:([0-9.]+)/)?.[1]);
  assert.ok(similarity > .95, `Export must visually match preview; SSIM=${similarity}`);
  assert.deepEqual(errors,[]);
  console.log('PASS: original/background MP4, overlays, cancellation, missing media and cleanup. Artifacts:', outputDir);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
