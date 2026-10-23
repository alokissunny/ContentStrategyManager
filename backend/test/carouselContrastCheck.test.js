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
