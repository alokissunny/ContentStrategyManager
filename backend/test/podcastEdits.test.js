const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePodcastEdits } = require('../src/services/podcastEdits');
const { podcastSubtitles } = require('../src/services/podcastSubtitles');
const edits = { title: 'My podcast', captions: [{ text: 'Corrected caption', start: 1, end: 2, position: { x: 30, y: 60 }, fontSize: 42, motion: 'none' }], overlays: [{ text: 'New quote', start: 0, end: 3, motion: 'slide' }] };
test('manual text, timing, positions and animation are validated and rendered into subtitle data', () => {
  const parsed = validatePodcastEdits(edits, 5);
  const ass = podcastSubtitles({ ...parsed, durationSec: 5 }, 1280, 720);
  assert.match(ass, /\\pos\(384,432\)\\fs42/);
  assert.match(ass, /Corrected caption/);
  assert.match(ass, /\\move\(/);
  assert.deepEqual(validatePodcastEdits({ captions: [], overlays: [] }, 5).captions, []);
});
test('rejects invalid edited ranges, sizes, positions and animation injection', () => {
  for (const patch of [{ start: -1 }, { end: 7 }, { start: 2, end: 1 }, { position: { x: NaN, y: 50 } }, { fontSize: 500 }, { motion: 'drawtext=file' }, { text: '' }]) {
    assert.throws(() => validatePodcastEdits({ ...edits, captions: [{ ...edits.captions[0], ...patch }] }, 5));
  }
  const ass = podcastSubtitles({ durationSec: 5, captions: [{ text: '{\\pos(0,0)} unsafe', start: 0, end: 1 }] }, 1280, 720);
  assert.doesNotMatch(ass, /\{\\pos\(0,0\)\}/);
});
