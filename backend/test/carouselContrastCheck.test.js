// Dark type on a full-bleed photo must be caught against the real pixels, and
// the readability wash must clear it — including a headline that already
// passed, which gets recoloured with the rest of the group.
// Run: node --test test/carouselContrastCheck.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { carouselContrastFailures, makeCarouselReadable } = require('../src/services/carouselContrastCheck');

const KEY = 'terrace.jpg';

async function photo() {
  const w = 540;
  const h = 675;
  const raw = Buffer.alloc(w * h * 3);
  const split = Math.round(h * 0.22);
  for (let y = 0; y < h; y += 1) {
    const c = y < split ? [198, 204, 196] : [42, 44, 48];
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 3;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
    }
  }
  return (await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer()).toString('base64');
}

function doc(body) {
  return `<section data-direction="warm-editorial"><style>
    :root { --brand-primary: #14352C; --brand-background: #F5EFE6; --brand-accent: #B5613D; }
    .slide { position: relative; width: 1080px; height: 1350px; overflow: hidden; }
    .slide img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .copy { position: absolute; top: 72px; left: 80px; width: 720px; display: flex; flex-direction: column; gap: 24px; color: var(--brand-primary); }
    .copy h1 { font-size: 72px; line-height: 1.05; margin: 0; }
    .copy p { font-size: 36px; line-height: 1.4; margin: 0; }
    .copy .eye { font-size: 22px; line-height: 1.3; margin: 0; }
  </style>
  <article class="slide" data-index="2">
    <img data-slot="image" data-asset-key="${KEY}" alt="">
    <div class="copy">${body}</div>
  </article></section>`;
}

const spilled = doc(`
  <p class="eye" data-slot="eyebrow">Material brief</p>
  <h1 data-slot="title">Outdoor finishes, chosen with care</h1>
  <p data-slot="supporting-text">The terrace required beautiful, durable, low-maintenance outdoor materials and high-quality finishes.</p>
`);

const onTheWall = doc(`
  <h1 data-slot="title">Outdoor finishes, chosen with care</h1>
`);

test('dark type that runs off the pale wall onto the counter fails contrast', async () => {
  const photos = new Map([[KEY, await photo()]]);
  const failures = await carouselContrastFailures(spilled, photos);
  assert.ok(failures.length >= 1, 'expected the supporting line to fail');
  assert.ok(failures.some((f) => /supporting-text|eyebrow|title/.test(f.problem)));
  assert.ok(failures.every((f) => f.group && f.group.h > f.box.h - 1));
});

test('the same dark type stays readable when it sits only on the pale wall', async () => {
  const photos = new Map([[KEY, await photo()]]);
  const failures = await carouselContrastFailures(onTheWall, photos);
  assert.equal(failures.length, 0);
});

test('the readability wash clears a spilled text group, headline included', async () => {
  const photos = new Map([[KEY, await photo()]]);
  const failures = await carouselContrastFailures(spilled, photos);
  assert.ok(failures.length >= 1);
  const washed = makeCarouselReadable(spilled, failures);
  assert.match(washed, /data-wash="readability"/);
  assert.match(washed, /color: var\(--brand-background\) !important/);
  const still = await carouselContrastFailures(washed, photos);
  assert.deepEqual(still.map((f) => f.problem), []);
});

// Accent words: corrected in place, same hue, on solid grounds and on photos.
const { accentContrastFailures, fixAccentContrast } = require('../src/services/carouselContrastCheck');

const ACCENT_CSS = `<style>
:root{--brand-primary:#1B100D;--brand-background:#F4F2EE;--brand-accent:#FF5227}
.slide{position:relative;width:1080px;height:1350px;overflow:hidden}
.light{background:var(--brand-background);color:var(--brand-primary)}
.photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.group{position:absolute;left:64px;right:64px;bottom:120px;display:flex;flex-direction:column;gap:24px;color:var(--brand-background)}
h2{font-size:72px;line-height:1.05;margin:0}
.ac{color:var(--brand-accent)}
.eyebrow{font-size:22px;letter-spacing:.2em;color:var(--brand-accent)}
</style>`;

test('an accent kicker on the light ground is darkened until it reads', async () => {
  const html = `<section>${ACCENT_CSS}<article class="slide light" data-index="1"><p class="eyebrow" data-slot="eyebrow">KICKER</p><h2 data-slot="title">Plain headline</h2></article></section>`;
  assert.equal((await accentContrastFailures(html)).length, 1);
  const { html: out, fixed } = await fixAccentContrast(html);
  assert.equal(fixed.length, 1);
  assert.match(out, /<p class="eyebrow" data-slot="eyebrow" style="color: #[0-9A-F]{6} !important;">/);
  assert.equal((await accentContrastFailures(out)).length, 0);
});

test('an accent phrase on a mid-tone photo is lightened until it reads', async () => {
  const img = await sharp({ create: { width: 600, height: 750, channels: 3, background: { r: 150, g: 120, b: 100 } } }).jpeg().toBuffer();
  const key = 'projects/aaaaaaaaaaaaaaaaaaaaaaaa/wall.jpg';
  const photos = new Map([[key, img.toString('base64')]]);
  const html = `<section>${ACCENT_CSS}<article class="slide" data-index="1"><img class="photo" data-slot="image" data-asset-key="${key}">`
    + '<div class="group"><h2 data-slot="title">Bajo el yeso, <span class="ac">recuperar la esencia</span></h2></div></article></section>';
  const { html: out, fixed } = await fixAccentContrast(html, photos);
  assert.equal(fixed.length, 1);
  const hex = out.match(/<span class="ac" style="color: (#[0-9A-F]{6}) !important;">/)[1];
  assert.ok(parseInt(hex.slice(3, 5), 16) > 0x52, `lighter than the accent: ${hex}`);
  assert.equal((await accentContrastFailures(out, photos)).length, 0);
});
