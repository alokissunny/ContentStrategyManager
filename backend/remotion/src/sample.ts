import type { CoverSpec } from './schema';

/**
 * Reference spec reproducing the "Considered Home" editorial hook cover.
 * Used as Studio default props and by the render smoke test.
 */
export const sampleSpec: CoverSpec = {
  composition: 'editorial-stack',
  format: { width: 1080, height: 1350, fps: 30, durationInFrames: 240 },
  brand: {
    bg: '#EDE6D9',
    ink: '#20201C',
    accent: '#B0472C',
    muted: '#8C8578',
    hairline: '#CFC5B4',
    headlineFont: 'Playfair Display',
    bodyFont: 'Inter',
    serif: 'Playfair Display',
    sans: 'Inter',
  },
  header: { eyebrow: 'The Considered Home', counter: '01 / 03' },
  headline: {
    reveal: 'line',
    lines: [
      { text: 'Furnished.', italic: false, accent: false },
      { text: 'Still feels', italic: false, accent: false },
      { text: 'unfinished?', italic: true, accent: true },
    ],
  },
  subtext: { text: 'The missing piece may be on your walls.' },
  stat: { value: '', label: '' },
  footer: { label: 'Give blank areas a job.', cta: 'Swipe to explore the idea', arrow: true },
  illustration: {
    mode: 'primitives',
    caption: 'Concept study · proposed artwork',
    imageAssetKey: '',
    imageUrl: '',
    elements: [
      // back wall + floor shadow
      { type: 'polyline', points: [[6, 20], [94, 26], [94, 78], [6, 74]], closed: true, stroke: 'hairline', fill: 'none', strokeWidth: 1, appearAt: 0, drawFrames: 22 },
      // sofa body
      { type: 'rect', x: 14, y: 58, w: 62, h: 16, radius: 2, stroke: 'ink', fill: 'none', strokeWidth: 1.4, appearAt: 6, drawFrames: 20 },
      { type: 'rect', x: 14, y: 50, w: 62, h: 10, radius: 2, stroke: 'ink', fill: 'none', strokeWidth: 1.4, appearAt: 10, drawFrames: 18 },
      { type: 'line', x1: 45, y1: 50, x2: 45, y2: 74, stroke: 'ink', strokeWidth: 1, appearAt: 16, drawFrames: 12 },
      { type: 'line', x1: 16, y1: 74, x2: 16, y2: 80, stroke: 'ink', strokeWidth: 1.2, appearAt: 18, drawFrames: 8 },
      { type: 'line', x1: 74, y1: 74, x2: 74, y2: 80, stroke: 'ink', strokeWidth: 1.2, appearAt: 18, drawFrames: 8 },
      // three proposed frames on the wall (accent, draw on later)
      { type: 'rect', x: 22, y: 26, w: 14, h: 16, stroke: 'accent', fill: 'none', strokeWidth: 1.2, appearAt: 40, drawFrames: 16 },
      { type: 'rect', x: 40, y: 30, w: 11, h: 9, stroke: 'accent', fill: 'none', strokeWidth: 1.2, appearAt: 48, drawFrames: 14 },
      { type: 'rect', x: 55, y: 25, w: 9, h: 13, stroke: 'accent', fill: 'none', strokeWidth: 1.2, appearAt: 56, drawFrames: 14 },
      // leader annotation
      { type: 'leader', x1: 47, y1: 44, x2: 60, y2: 47, text: 'Blank space', stroke: 'accent', strokeWidth: 1, size: 2.2, appearAt: 68, drawFrames: 12 },
    ],
  },
  timeline: { header: 0, headline: 8, illustration: 30, subtext: 84, footer: 60 },
  motion: { headline: 'rise', ease: 'outCubic', stagger: 7, background: 'none' },
};
