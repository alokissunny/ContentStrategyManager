const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const plugin = require('../build/localize.cjs');
const messages = new Set();
const add = s => { s = s.trim().replace(/\s+/g, ' '); if (/[A-Za-z]/.test(s)) messages.add(s); };
const root = path.join(__dirname, '../src');
function walk(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes:true})) { const file=path.join(dir,entry.name);if(entry.isDirectory()){if(entry.name!=='i18n')walk(file);continue;}if(!/\.[jt]sx?$/.test(file))continue;const source=fs.readFileSync(file,'utf8');
 babel.transformSync(source,{filename:file,configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{onMessage:add}]],code:false});
 // Static copy from navigation/config arrays, labels, dialogs and error messages.
 const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
 traverse(ast,{StringLiteral(p){const s=p.node.value;if(s.length>600||/[<>{}\n]|https?:|^[/#.]|^[\w-]+\//.test(s))return;
 if((p.parent.type==='ObjectProperty' && !p.parent.computed && ['label','title','description','empty','hint','help','lead','name','sub','text','message','placeholder'].includes(p.parent.key.name)) || (p.parent.type==='ArrayExpression' && /^[A-Z][a-z]+(?:[ -][A-Za-z]+)*$/.test(s)) || (p.parent.type==='CallExpression' && /(?:Error|alert|confirm|setError|setErr|setToast|^t$)/.test(p.parent.callee?.name||'')))add(s);
 }});
 }}walk(root);
fs.writeFileSync(path.join(root,'i18n/locales/en.json'),JSON.stringify(Object.fromEntries([...messages].sort().map(s=>[s,s])),null,2)+'\n');
console.log(`${messages.size} messages extracted`);
