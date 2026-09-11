/* eslint-disable no-console */
/**
 * Standalone test harness for the Animated Carousel Cover agent.
 *
 *   node scripts/test-carousel-cover.js            # render the built-in sample spec (no LLM)
 *   node scripts/test-carousel-cover.js --llm      # brief+structure -> LLM spec -> MP4 (needs API key)
 *   node scripts/test-carousel-cover.js --spec-only # LLM spec only, print JSON, no render
 *
 * Output MP4s land in backend/remotion/out/.
 */
require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');
const {
  generateCoverSpec, renderCoverVideo,
} = require('../src/services/carouselCoverAgent');

const OUT_DIR = path.join(__dirname, '..', 'remotion', 'out');
const REMOTION_DIR = path.join(__dirname, '..', 'remotion');

// A realistic strategist brief for the reference post.
const sampleBrief = {
  pillar: 'discovery',
  format: 'Carousel',
  angle: 'A fully furnished room can still feel unfinished — the walls are the tell.',
  hookTerritory: 'The quiet dissatisfaction of a "done" room that still feels flat.',
  audienceTension: 'They spent money furnishing and it still does not feel like a home.',
  centralFact: 'Empty wall areas above and around furniture read as unfinished.',
  uniqueJob: 'Reframe blank walls as the unfinished job, then point to art as the fix.',
  ownedTerritory: 'Considered, editorial styling advice for real homes.',
  verifiedTruth: [
    'Blank wall space above a sofa is a common styling gap.',
    'Grouped framed pieces give a wall a defined focal point.',
  ],
  observableDetails: ['sofa against a plain wall', 'large empty area above the seat'],
};

// The content-structure output for the opening surface.
const sampleStructure = {
  status: 'ready',
  format: 'Carousel',
  totalSlidesOrScenes: 3,
  slidesOrScenes: [
    {
      index: 1,
      role: 'Hook / recognition',
      purpose: 'Name the tension: a furnished room that still feels unfinished.',
      informationShape: 'statement',
      primaryStructure: 'Short_Statement',
      contentGuidance: 'Open on the everyday state, then pivot to the doubt as a question.',
      visual: { truthBoundary: 'Do not imply a specific product or a guaranteed result.' },
    },
  ],
};

const sampleBrand = {
  offer: 'Editorial art & styling for considered homes',
  voice: 'calm, editorial, quietly confident',
  visualStyle: 'warm neutral paper tones, one terracotta accent, elegant serif headlines',
};

function renderSample() {
  return new Promise((resolve, reject) => {
    console.log('▶ Rendering built-in sample spec (no LLM)…');
    const out = path.join(OUT_DIR, 'sample.mp4');
    const child = spawn('node', ['render.mjs', '--sample', out], { cwd: REMOTION_DIR, stdio: 'inherit' });
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`render exited ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const useLlm = args.includes('--llm') || args.includes('--spec-only');
  const specOnly = args.includes('--spec-only');

  if (!useLlm) {
    const out = await renderSample();
    console.log(`✅ Sample rendered → ${out}`);
    return;
  }

  console.log('▶ Calling cover agent (brief + structure → spec)…');
  const { spec, raw, model, usage } = await generateCoverSpec({
    brief: sampleBrief, structure: sampleStructure, brand: sampleBrand,
  });
  console.log(`   model=${model} tokens=${JSON.stringify(usage)}`);
  console.log('── cover spec ─────────────────────────────');
  console.log(JSON.stringify(spec, null, 2));
  if (specOnly) return;

  console.log('▶ Rendering agent spec → MP4…');
  const out = path.join(OUT_DIR, 'agent.mp4');
  const videoPath = await renderCoverVideo({ spec, outPath: out });
  console.log(`✅ Agent cover rendered → ${videoPath}`);
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
