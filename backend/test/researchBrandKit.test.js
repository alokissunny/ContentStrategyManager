const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settingsOf } = require('../src/services/researchBrandKit');
const { slideDocuments } = require('../src/services/researchCarousel');
const { aiLogger, usageOf } = require('../src/services/researchDebug');
test('uses only the active handle kit, selected palette and matching logo/background', () => {
 const kit = settingsOf({ visualBrand: { settings: [{ handle:'mine', data:{libraryEdits:{ activeThemeId:'b', themes:[{id:'a',palette:{ground:'#ffffff'}},{id:'b',name:'Night',palette:{ground:'#111111',fg:'#ffffff',accent:'#ff8800'}}],type:{headline:{face:'annotation'},body:{face:'mono'}},logoPosition:'bottom-right',background:{key:'mine-bg'}}}}], logos:[{handle:'other',slot:'fullInverted',key:'wrong'},{handle:'mine',slot:'fullInverted',key:'mine-logo'}], backgrounds:[{handle:'other',key:'mine-bg'}] } },'mine');
 assert.equal(kit.name,'Night'); assert.equal(kit.palette.ground,'#111111'); assert.equal(kit.fonts.heading,'Instrument Serif'); assert.equal(kit.fonts.body,'Spline Sans Mono'); assert.equal(kit.fonts.detail,'Spline Sans Mono'); assert.equal(kit.logoKey,'mine-logo'); assert.equal(kit.backgroundKey,undefined); assert.equal(kit.logoPosition,'bottom-right');
});
test('brand defaults and browser-only font limitations are explicit', () => {
 const kit = settingsOf({visualBrand:{settings:[{handle:'mine',data:{libraryEdits:{type:{headline:{face:'own-1'}},fonts:[{id:'own-1',name:'My Font',url:null}]}}}]}},'mine');
 assert.equal(kit.fonts.heading,'Inter'); assert.equal(kit.warnings.length,1); assert.equal(kit.palette.ground,'#F4F2EE');
});
test('brand colors and role fonts override every template with embedded logo', async () => {
 const kit={...settingsOf({},'mine'),logoData:'data:image/png;base64,aGVsbG8=',fontCss:'@font-face{font-family:Inter;src:url(data:font/woff2;base64,AA==)}'};
 for(const theme of ['default','bold','technical']) {
  const [html] = await slideDocuments({slides:[{title:'Hello',body:'World'}],sources:[]},theme,kit);
  assert.match(html,/--bg:#F4F2EE/); assert.match(html,/font-family:'Cabinet Grotesk'/); assert.match(html,/font-src data:/); assert.match(html,/class="research-logo"/); assert.match(html,/top:48px;left:72px/);
 }
});
test('debug logs prompts, usage and tentative cached-token costs on success and failure', async () => {
 const entries=[];const log=aiLogger(e=>entries.push(e));
 await log('Research: test',{model:'gpt-5.6-terra',system:'System',userParts:[{text:'Input'}],tool:{name:'test'}},async()=>({parsed:{answer:'Output'},usage:{input_tokens:1000,output_tokens:100,cached_tokens:500}}));
 assert.equal(entries[0].systemPrompt,'System');assert.match(entries[0].prompt,/Input/);assert.match(entries[0].output,/Output/);assert.equal(entries[0].usage.totalTokens,1100);assert.ok(entries[0].usage.estimatedCostUsd>0);assert.match(entries[0].note,/excludes web-search/);
 await assert.rejects(log('Research: failed',{model:'gpt-5.6-terra',input:'Topic'},async()=>{throw new Error('Provider unavailable');}));
 assert.equal(entries.length,2);assert.match(entries[1].output,/Provider unavailable/);assert.match(entries[1].note,/Usage unavailable/);
 assert.equal(usageOf('gpt-5.6-terra',{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:500}}).estimatedCostUsd,entries[0].usage.estimatedCostUsd);
});
test('embeds available custom font bytes but rejects remote font URLs', () => {
 const user={visualBrand:{settings:[{handle:'mine',data:{libraryEdits:{type:{headline:{face:'own-1'}},fonts:[{id:'own-1',name:'Custom Font'}]}}}]}};
 const kit=settingsOf(user,'mine',{'own-1':'data:font/woff2;base64,AA=='});
 assert.equal(kit.fonts.heading,'Custom Font');assert.match(kit.customCss,/data:font\/woff2/);assert.equal(kit.warnings.length,0);
 assert.equal(settingsOf(user,'mine',{'own-1':'https://example.com/font.woff'}).fonts.heading,'Inter');
});
