/**
 * The content-mission guidelines (Attract / Nurture / Position / Convert)
 * shared by the Mission coverage tagger and the Next-post idea agent —
 * prompts/content-missions.md, spliced in at {{CONTENT_MISSIONS}}.
 *
 * MISSION_TAG_V: bump when the rules change. Stored mission tags made under an
 * older version (BrandAnalysisReport.igMissionTagsV, missionCoverage.posts[k].v,
 * PlannedPost.contentMissionV) are treated as missing and re-tagged lazily.
 *   2 (2026-11-19): primary purpose decides, a CTA alone never makes a post convert.
 *   3 (2026-11-19): pillar definitions (prompts/content-pillars.md, {{CONTENT_PILLARS}}) —
 *      Skills = expertise/process/decisions, Passion = inspirations/materials/philosophy,
 *      Story = projects/challenges/solutions.
 */
const fs = require('fs');
const path = require('path');

const MISSION_TAG_V = 4; // 4: Convert = explains the real service / offer / process and the next step (studio, 2026-11-21)
const FILE = path.join(__dirname, '..', '..', 'prompts', 'content-missions.md');
const PILLARS_FILE = path.join(__dirname, '..', '..', 'prompts', 'content-pillars.md');
let cache = null;
let pillarCache = null;

const missionRules = () => (cache ||= fs.readFileSync(FILE, 'utf8').trim());
const pillarRules = () => (pillarCache ||= fs.readFileSync(PILLARS_FILE, 'utf8').trim());
/** Splices the shared guidelines in at {{CONTENT_MISSIONS}} / {{CONTENT_PILLARS}}. */
const withMissionRules = (prompt) => String(prompt)
  .replace('{{CONTENT_MISSIONS}}', missionRules())
  .replace('{{CONTENT_PILLARS}}', pillarRules());

module.exports = { MISSION_TAG_V, missionRules, pillarRules, withMissionRules };
