/* The four content missions — the ONE job a post does for the business (backend prompts/next-post-idea.md,
   prompts/mission-coverage.md). Shared by the idea card and Analysis › Mission coverage. Order = the funnel. */
export const MISSION_ORDER = ['attract', 'nurture', 'position', 'convert'];
export const MISSIONS = {
  attract: { mark: '📣', say: 'Attract', purpose: 'Reach relevant new audiences', shows: 'Before/after, transformations, surprising details' },
  nurture: { mark: '❤️', say: 'Nurture', purpose: 'Build connection and trust', shows: 'Behind-the-scenes, site visits, work in progress' },
  position: { mark: '🧑🏽‍💻', say: 'Position', purpose: 'Demonstrate expertise and authority', shows: 'Design decisions, sketches, material comparisons' },
  convert: { mark: '🎯', say: 'Convert', purpose: 'Encourage qualified inquiries', shows: 'How your service solves a client\'s problem, with real proof' },
};
export const PILLAR_SAY = { passion: 'Passion', skills: 'Skills', story: 'Story' };
/* The three content pillars — WHAT a post talks about (backend prompts/content-pillars.md). */
export const PILLAR_ORDER = ['skills', 'passion', 'story'];
export const PILLARS = {
  skills: { say: 'Skills', purpose: 'What you know and do well', shows: 'Expertise, processes, design decisions' },
  passion: { say: 'Passion', purpose: 'What inspires you and shapes your work', shows: 'Inspirations, materials, design philosophy' },
  story: { say: 'Story', purpose: 'The experiences behind your studio', shows: 'Real projects, challenges, solutions' },
};
