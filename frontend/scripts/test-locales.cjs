const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const root = path.join(__dirname, '..');
const en = require('../src/i18n/locales/en.json');
const es = require('../src/i18n/locales/es.json');
const slots = value => [...value.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort();
for (const [key, value] of Object.entries(en)) {
  assert.ok(es[key], `Missing Spanish translation: ${key}`);
  assert.deepEqual(slots(value), slots(es[key]), `Interpolation mismatch: ${key}`);
}
let stored = 'es';
let storageHandler;
const document = { documentElement: {} };
const runtime = fs.readFileSync(path.join(root, 'src/i18n/index.jsx'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/export /g, '');
const ctx = vm.createContext({ spanish: es, document, localStorage: {
  getItem: () => stored, setItem: (key, value) => { stored = value; },
}, window: { addEventListener: (name, fn) => { storageHandler = fn; } }, useSyncExternalStore: () => {} });
vm.runInContext(runtime, ctx);
assert.equal(ctx.getLocale(), 'es');
assert.equal(document.documentElement.lang, 'es');
assert.equal(ctx.translate(' Settings '), ' Configuración ');
assert.equal(ctx.translate('My original post'), 'My original post');
assert.equal(ctx.translate('On · {{v0}} prompts logged', {v0: 3}), 'Activado · 3 instrucciones registradas');
assert.equal(ctx.translate(null), null);
ctx.setLocale('en');
assert.equal(stored, 'en');
assert.equal(ctx.translate('Settings'), 'Settings');
stored = 'es'; storageHandler({key:'bauhly.locale'});
assert.equal(ctx.intlLocale(), 'es-ES');
ctx.setLocale('invalid'); assert.equal(ctx.getLocale(), 'en');
ctx.localStorage.setItem = () => { throw Error('Storage blocked'); };
ctx.setLocale('es'); assert.equal(ctx.getLocale(), 'es');
const source = `const formats=['Stories']; function Example({post,on}) { return <><p>{post.title}</p><button aria-label={\`\${on ? 'Exclude' : 'Include'} Stories\`}>Save</button><select><option>Stories</option></select><b translate="no">in</b>{formats.map(f=><span>{f}</span>)}</>; }`;
const output = babel.transformSync(source, {configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[require('../build/localize.cjs')]}).code;
assert.match(output, /__useUiLocale\(\);/);
assert.match(output, /__uiT\("Save"\)/);
assert.match(output, /value="Stories"/);
assert.match(output, /\{post.title\}/);
assert.match(output, /<b translate="no">in<\/b>/);
assert.match(output, /__uiT\('Exclude'\)/);
assert.match(output, /__uiT\(f\)/);
assert.equal((output.match(/__useUiLocale\(\)/g)||[]).length, 1);
console.log(`Locale checks passed: ${Object.keys(en).length} messages, runtime persistence/fallback, interpolation and JSX transform.`);
