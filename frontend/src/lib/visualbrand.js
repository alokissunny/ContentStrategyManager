/*
 * The Visual Brand — the pictures Bauhly is allowed to reason from.
 *
 * WHY THIS EXISTS (Leon, Aug 3 — phase 1 of the visual-brand brief).
 *
 * `lib/assets.js` answers "what can be made from THIS project's material".
 * It says nothing about how the result should LOOK, so every image prompt has
 * been carrying the studio's fonts and Bauhly's palette and nothing else. That
 * is why the same brief produces a different-looking slide every time: the look
 * is decided per generation instead of once, by the studio, from examples.
 *
 * So this is the other half of the contract. Not a settings panel — a library
 * of references, and the arithmetic over it that says what Bauhly can and
 * cannot honestly make yet.
 *
 * THREE RULES, and they are why this is not a twelve-slot upload form:
 *
 *   1 · What the studio already has counts. Their photographs are already in
 *       Projects; Bauhly has been looking at them since the first capture.
 *       Photography and light are LEARNED, not asked for. Only what a room
 *       photograph cannot teach is ever requested.
 *   2 · A reference exists to unlock something. Every dimension below names the
 *       slide kinds (`SLIDE_KINDS` in assets.js) it makes possible. A dimension
 *       that unlocks nothing does not belong here — that is exactly why the old
 *       free-text "visual language" field was removed once.
 *   3 · Nothing is invented. A missing dimension is reported as missing, with
 *       what it costs. It is never filled with a guess.
 *
 * Nothing here calls a model. It is arithmetic over the store, testable and
 * instant, like assets.js.
 */

/* ── 1 · the dimensions ────────────────────────────────────────────────────
 *
 * Five, not the brief's twelve. The brief's list mixes dimensions of a visual
 * language (colour, typography, lighting) with the CONTENT TYPES they get
 * applied to (carousel cover, before & after, quote slide) — and the content
 * types are phase 2's job, laid over these. Twelve empty slots on day one is a
 * configuration screen, which is the one thing the brief says this must not be.
 *
 * `teaches` is what the reference tells Bauhly. `unlocks` are the SLIDE_KINDS
 * that cannot be made honestly without it. `learned` marks the dimension the
 * studio never has to feed by hand.
 */
export const DIMENSIONS = [
  {
    id: 'photography',
    icon: 'image',
    label: 'Photography and light',
    teaches: 'How your rooms are shot — the light, the distance, what is in focus.',
    /* the only one Bauhly can read for itself: every capture is an example */
    learned: true,
    ask: 'Bauhly reads this from the photographs you already capture.',
    unlocks: ['hero', 'detail', 'material', 'process', 'plan'],
  },
  {
    id: 'layout',
    icon: 'brief',
    label: 'Words on a picture',
    teaches: 'Where text sits, how big it is, how much room it gets.',
    ask: 'Add a few posts — yours or anyone’s — where the words sit the way you like.',
    unlocks: ['type', 'quote', 'annotated', 'decision'],
  },
  {
    id: 'colour',
    icon: 'swatch',
    label: 'Colour and finish',
    teaches: 'The palette a made slide is allowed to use, and how heavy the graphics get.',
    ask: 'Add anything whose colour you would be happy to see on your own post.',
    unlocks: ['supporting'],
  },
  {
    id: 'comparison',
    icon: 'crop',
    label: 'Comparisons',
    teaches: 'How two states of one room are put side by side.',
    ask: 'Add one before-and-after you think is well done.',
    unlocks: ['beforeAfter', 'timeline'],
  },
  {
    id: 'mood',
    icon: 'sparkle',
    label: 'Mood',
    teaches: 'The feeling every slide should land on.',
    /* deliberately unlocks nothing: mood tunes what the others make possible,
       and a dimension that gates a slide type on "a feeling" would be Bauhly
       refusing to work until it had been complimented */
    unlocks: [],
    ask: 'Optional. Add it when a slide comes out correct and still wrong.',
  },
];

export const dimension = (id) => DIMENSIONS.find((d) => d.id === id) || null;

/* ── 1b · the things Bauhly actually makes ─────────────────────────────────
 *
 * PHASE 2 OF THE BRIEF, laid OVER the dimensions rather than beside them.
 *
 * A dimension is what a reference IS. A use case is what Bauhly DOES with it,
 * and it is the only one of the two a studio thinks in: nobody wants "layout
 * references", they want their covers to stop looking like everyone else's.
 *
 * EVERY ROW IS SOMETHING THE PLAN ALREADY BUILDS. `kinds` are `SLIDE_KINDS`
 * ids from lib/assets.js — the slide types `formatsFor` actually composes — so
 * this list cannot drift into describing a product that does not exist. The
 * brief's "animated image" and "motion graphics" are deliberately absent: the
 * motion library is phase 6, and a row that can never be satisfied is a dead
 * end dressed as a feature.
 *
 * `needs` are the dimensions that have to hold something before Bauhly can
 * make this honestly, in the order it would ask for them.
 */
export const USE_CASES = [
  {
    id: 'cover',
    label: 'Carousel cover',
    what: 'The first slide — the one that decides whether anyone swipes.',
    kinds: ['hero', 'type'],
    needs: ['layout', 'photography'],
  },
  {
    id: 'showcase',
    label: 'Project showcase',
    what: 'The finished room, given the whole frame.',
    kinds: ['hero'],
    needs: ['photography'],
  },
  {
    id: 'detail',
    label: 'Detail crop',
    what: 'One corner of a shot you already took, made the whole slide.',
    kinds: ['detail'],
    needs: ['photography'],
  },
  {
    id: 'material',
    label: 'Material highlight',
    what: 'The samples, the grain, the finish — close.',
    kinds: ['material'],
    needs: ['photography'],
  },
  {
    id: 'process',
    label: 'Process slide',
    what: 'The work half-done, which is the part nobody else posts.',
    kinds: ['process'],
    needs: ['photography'],
  },
  {
    id: 'plan',
    label: 'Floor plan explained',
    what: 'The drawing, with the decision written onto it.',
    kinds: ['plan'],
    needs: ['photography', 'layout'],
  },
  {
    id: 'educational',
    label: 'Educational slide',
    what: 'One thing taught, pointed at on a real photograph.',
    kinds: ['annotated'],
    needs: ['layout'],
  },
  {
    id: 'decision',
    label: 'Design decision',
    what: 'Why it is this and not that.',
    kinds: ['decision'],
    needs: ['layout'],
  },
  {
    id: 'quote',
    label: 'Quote slide',
    what: 'A line of yours, set large enough to stop a thumb.',
    kinds: ['quote'],
    needs: ['layout'],
  },
  {
    id: 'beforeAfter',
    label: 'Before and after',
    what: 'Two states of one room, side by side.',
    kinds: ['beforeAfter'],
    needs: ['comparison'],
  },
  {
    id: 'timeline',
    label: 'Project timeline',
    what: 'A project as a sequence rather than a result.',
    kinds: ['timeline'],
    needs: ['comparison', 'layout'],
  },
  {
    id: 'story',
    label: 'Story cover',
    what: 'Nine-by-sixteen, with room for the tap targets.',
    kinds: ['type'],
    needs: ['layout', 'photography'],
  },
  {
    id: 'reel',
    label: 'Reel cover',
    what: 'The frame that has to work as a thumbnail on your grid.',
    kinds: ['type'],
    needs: ['layout', 'photography'],
  },
  {
    id: 'cta',
    label: 'Call to action',
    what: 'The ask at the end, in your own type.',
    kinds: ['type'],
    needs: ['layout', 'colour'],
  },
  {
    id: 'supporting',
    label: 'Supporting visual',
    what: 'The only one made rather than used — where nothing you have fits.',
    kinds: ['supporting'],
    needs: ['colour'],
  },
];

export const caseOf = (id) => USE_CASES.find((u) => u.id === id) || null;

/* ── 2 · what the studio's own work already contributes ────────────────────
 *
 * A view over Projects, never a second copy of the material (the Library's
 * rule, and for the same reason: two places holding one photograph is how they
 * disagree). Every still the studio has captured is a photography reference,
 * newest first, carrying the project it came from.
 */
export function ownReferences(projects, limit = 12) {
  const out = [];
  (projects || []).forEach((p) => {
    (p.captures || []).forEach((c) => {
      const stills = (c.attachments || []).filter((att) => att.type !== 'video');
      /* the studio's own first words about the shot — never a caption written
         for them. One capture can hold five photographs, and five cards reading
         "Could be a strong reel opener" name nothing: when a capture carries
         more than one, they are numbered (the same fix `suggestionsFor` in
         assets.js already needed). */
      const said = (c.text || '').split(/[.—]/)[0].trim().split(/\s+/).slice(0, 6).join(' ');
      stills.forEach((att, n) => {
        out.push({
          id: `own-${att.id}`,
          kind: 'photography',
          url: att.thumbnailUrl || att.url,
          title: `${said}${stills.length > 1 ? ` · ${n + 1}` : ''}`,
          source: 'own',
          projectId: p.id,
          projectName: p.name,
          createdAt: c.createdAt,
        });
      });
    });
  });
  return out
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

/* everything the library holds. WHAT WAS ADDED ON PURPOSE COMES FIRST: the
   studio's own photographs are a standing dozen, and a reference dropped in
   behind them is one the person who just chose it has to go looking for. */
export function allReferences(added, projects) {
  return [...(added || [])].reverse().concat(ownReferences(projects));
}

/* ── 3 · coverage ──────────────────────────────────────────────────────────
 *
 * Per dimension: how many references stand behind it, and whether that is
 * enough to work from. The thresholds are small on purpose — one example is a
 * preference, three is a pattern — and they are stated rather than hidden,
 * because the studio is owed the reason a slide type is still locked.
 */
export const ENOUGH = 3;

export function coverageOf(refs) {
  return DIMENSIONS.map((d) => {
    const list = (refs || []).filter((r) => r.kind === d.id);
    const n = list.length;
    /* three states, and no percentages: "seen twice" is the language this
       product uses about small n everywhere else.
       A dimension that gates nothing (Mood) is never "missing" — nothing is
       waiting on it, so an empty one is `optional`, not a warning. Colouring it
       amber would be the page inventing a job for the studio. */
    const state = n === 0
      ? (d.unlocks.length ? 'none' : 'optional')
      : n < ENOUGH ? 'thin' : 'ready';
    return { ...d, count: n, state, refs: list };
  });
}

/* which slide kinds cannot be made yet, and which dimension would unlock each.
 * This is what phase 4 and 7 read: an empty slide asks here before it asks the
 * studio for anything. */
export function lockedKinds(refs) {
  const cover = coverageOf(refs);
  const out = {};
  cover.forEach((d) => {
    if (d.state !== 'none') return;
    d.unlocks.forEach((k) => { out[k] = d.id; });
  });
  return out;
}

/* ── 4 · what Bauhly can make, one use case at a time ─────────────────────
 *
 * The same coverage, read the way a studio thinks about it. A use case is
 * `ready` when every dimension it needs holds at least one reference, and
 * `waiting` otherwise — on the FIRST need that is empty, because asking for
 * three things at once is how none of them get added.
 *
 * `refs` are the references tagged to this use case specifically. That tag is
 * what makes the phase-2 objective real: not "we have layout references
 * somewhere" but "this is how your covers are supposed to look".
 */
export function casesOf(refs, cover) {
  const state = Object.fromEntries((cover || coverageOf(refs)).map((d) => [d.id, d.state]));
  return USE_CASES.map((u) => {
    const missing = u.needs.filter((n) => state[n] === 'none');
    return {
      ...u,
      state: missing.length ? 'waiting' : 'ready',
      /* one ask, not a list: the first thing standing in the way */
      missing: missing[0] ? dimension(missing[0]) : null,
      refs: (refs || []).filter((r) => r.useCase === u.id),
    };
  });
}

/* ── 4b · what a PARTICULAR slide is waiting on ───────────────────────────
 *
 * PHASE 4/7 OF THE BRIEF (Leon, Aug 4). An empty slide used to offer three
 * ways to make a picture whether or not Bauhly had any idea what the studio's
 * pictures are supposed to look like. That is the failure the brief names: it
 * would have generated a style it invented and called it theirs.
 *
 * So the slide asks here first. `slideCase` reads the slide's own job — the
 * role `slideRole()` already gives every slide, plus the post's format — and
 * `readinessFor` answers the only two questions the panel has: can Bauhly make
 * this yet, and if not, exactly what is missing.
 */
const ROLE_CASES = {
  Cover: 'cover',
  Hook: 'cover',
  CTA: 'cta',
  Setup: 'showcase',
  Process: 'process',
  Result: 'showcase',
  Poll: 'story',
};

export function slideCase(role, format = '') {
  const id = ROLE_CASES[role] || 'showcase';
  /* the same slide in a different container is a different picture: a cover
     that has to work as a grid thumbnail is a Reel cover, not a carousel one */
  if (id === 'cover' && /reel/i.test(format)) return caseOf('reel');
  if (id === 'cover' && /story/i.test(format)) return caseOf('story');
  return caseOf(id);
}

export function readinessFor(refs, role, format) {
  const u = slideCase(role, format);
  const cover = coverageOf(refs);
  const state = Object.fromEntries(cover.map((d) => [d.id, d]));
  const missing = u.needs.map((n) => state[n]).filter((d) => d.state === 'none');
  /* WHICH REFERENCES THIS SLIDE IS ACTUALLY MADE FROM. The ones the studio
     tagged to this use case if they exist — "here is how my covers should
     look" is a more specific instruction than "here are my layout references"
     — and otherwise everything standing behind the dimensions it needs. */
  const tagged = (refs || []).filter((r) => r.useCase === u.id);
  const applied = tagged.length
    ? tagged
    : (refs || []).filter((r) => u.needs.includes(r.kind));
  return {
    useCase: u,
    ready: missing.length === 0,
    /* one ask, never a list — see `casesOf` */
    missing: missing[0] || null,
    tagged: tagged.length > 0,
    applied,
    /* the dimensions it draws on, for the line that names them */
    from: u.needs.map((n) => state[n]).filter(Boolean),
  };
}

/* one honest sentence for the top of the page — never a score.
 *
 * Counted in what Bauhly can BUILD rather than in dimensions covered: "3 of 5
 * covered" is a fact about the library's own filing, and nobody opened this
 * page to hear about filing. */
export function summaryOf(uses) {
  const ready = uses.filter((u) => u.state === 'ready').length;
  if (ready === uses.length) {
    return `Bauhly can make every one of the ${uses.length} kinds of slide it plans.`;
  }
  return ready === 0
    ? `Bauhly cannot make any of the ${uses.length} kinds of slide it plans yet.`
    : `Bauhly can make ${ready} of the ${uses.length} kinds of slide it plans.`;
}

/* ── 5 · the layout system ────────────────────────────────────────────────
 *
 * The shapes a slide can take, and the rule for choosing one (Leon, Aug 4 —
 * from the Layout System reference).
 *
 * WHY IT IS A LIST OF LAYOUTS AND NOT A LIST OF RULES. The reference carries
 * both: a library of templates and a "Layout rules" panel of guidelines
 * underneath. The guidelines went — a rule the studio cannot act on and Bauhly
 * does not read is a paragraph pretending to be a setting. What is left is the
 * library, and every entry in it declares the three things that decide whether
 * Bauhly reaches for it:
 *
 *   `kinds`  the SLIDE_KINDS (lib/assets.js) it can carry — the content
 *   `needs`  the DIMENSIONS it has to have seen an example of — the look
 *   `shots`  how many photographs it takes — the material
 *
 * So the claim the page makes ("Bauhly picks the layout from your content,
 * your assets and your references") is a description of this table rather than
 * a promise about a model. `layoutsOf()` below is the whole of it.
 *
 * `shape` names the composition, and the preview draws it: see LayoutSystem.jsx.
 */
export const LAYOUT_GROUPS = [
  { id: 'hook', label: 'Hooks' },
  { id: 'educational', label: 'Educational' },
  { id: 'project', label: 'Project story' },
  { id: 'results', label: 'Results' },
  { id: 'details', label: 'Details' },
];

/* WHICH CATEGORY A SLIDE'S JOB BELONGS TO (Leon, Aug 4).
 *
 * The plan names a slide's job — Hook, Setup, Process, Result, CTA, Cover,
 * Poll (see `slideRole` in demo.js) — and the Layout System files layouts by
 * what a slide is FOR. This is the one mapping between them, so the plan can
 * offer a slide the layouts that were made for its job rather than all sixteen.
 */
const GROUP_FOR_ROLE = {
  Hook: 'hook', Cover: 'hook', Poll: 'hook',
  Setup: 'educational', Process: 'educational',
  Result: 'results',
  CTA: 'details',
};
export function groupForRole(role) {
  return GROUP_FOR_ROLE[role] || 'hook';
}

/* Each layout carries a WORKED EXAMPLE, not a wireframe (Leon, Aug 4).
 *
 * `img` is one of the product's own Quiet-Studio stills — the same set the
 * plan's previews use, so a layout is demonstrated on the kind of photograph a
 * studio actually hands over. `sample` is the copy shown in it: real sentences
 * an interior studio would publish, in the demo persona's voice, so the card
 * reads as a post rather than as a diagram of one.
 *
 * The copy is illustrative and belongs to the LAYOUT, not to the studio —
 * nothing here is presented as something Bauhly wrote for them.
 */
export const LAYOUTS = [
  /* ── the one that is not a layout ──
   * PUBLISH THE PHOTOGRAPH (Leon, Aug 4). Every other entry here is a way of
   * putting the studio's words and colours onto a picture; sometimes the
   * picture is the post and the right answer is to do nothing to it. It has no
   * ground, no type, no mark and no treatment, and it belongs to every category
   * because "leave it alone" is a valid answer to any slide's job. */
  {
    id: 'X0', group: 'any', name: 'Image only', shape: 'plain', shots: 1,
    when: 'The photograph is the post. Nothing is drawn on it.',
    kinds: ['hero'], needs: [],
    img: '/assets/photo/ph/ph-tue-6.jpg',
    sample: {},
  },
  /* ── the one that makes a picture rather than shaping one ──
   * ASK FOR A FRAME YOU DO NOT HAVE (Leon, Aug 4). Every other entry arranges
   * something the studio has photographed. This is the other case: the slide
   * needs a picture nobody took. It is deliberately last in the carousel and
   * deliberately marked — generation is the optional mode, not the default,
   * and the product's whole argument is that most slides do not need it. */
  {
    id: 'GEN', group: 'any', name: 'Create image', shape: 'gen', shots: 0,
    when: 'Bauhly makes the picture, in your visual brand.',
    kinds: ['hero'], needs: [],
    img: null,
    sample: {},
  },
  /* ── hooks ── the first frame, which is the only one everybody sees ── */
  {
    id: 'H1', group: 'hook', name: 'Full-bleed headline', shape: 'bleed', shots: 1,
    when: 'The room carries it and the line sits on the photograph.',
    kinds: ['hero'], needs: ['layout'],
    img: '/assets/photo/ph/ph-mon-1.jpg',
    sample: { eyebrow: 'Project insight', head: 'Why we aligned the materials with the architecture', body: '' },
  },
  {
    id: 'H2', group: 'hook', name: 'Split hook', shape: 'split', shots: 1,
    when: 'A longer opening line, with the picture beside it rather than under it.',
    kinds: ['hero', 'type'], needs: ['layout'],
    img: '/assets/photo/ph/ph-tue-1.jpg',
    sample: { eyebrow: '', head: 'A strong opening line that captures attention', body: '' },
  },
  {
    id: 'H3', group: 'hook', name: 'Statement', shape: 'poster', shots: 0,
    when: 'The sentence is the whole hook and no photograph would add to it.',
    kinds: ['type'], needs: ['layout', 'colour'],
    img: null,
    sample: { eyebrow: 'Atelier Noor', head: 'Your living room probably isn’t too small.', body: 'It’s spaced wrong.' },
  },

  /* ── educational ── */
  {
    id: 'E1', group: 'educational', name: 'One point, one picture', shape: 'split-rt', shots: 1,
    when: 'A single idea taught against a shot that shows it.',
    kinds: ['annotated'], needs: ['layout'],
    img: '/assets/photo/ph/ph-tue-3.jpg',
    sample: { eyebrow: '', head: 'A clear point that teaches something valuable.', body: 'Supporting explanation goes here to add context and help your audience understand.' },
  },
  {
    id: 'E2', group: 'educational', name: 'Numbered steps', shape: 'steps', shots: 1,
    when: 'Three or four points in order — the shape people screenshot.',
    kinds: ['annotated', 'decision'], needs: ['layout'],
    img: '/assets/photo/ph/ph-mon-3.jpg',
    sample: {
      eyebrow: '', head: 'Key insight explained step by step.',
      steps: ['Measure before you choose the rug', 'Leave 30cm between sofa and table', 'Hang the light 75cm above'],
    },
  },
  {
    /* `teach` — Bauhly cannot build this one from the shapes it knows: an
       annotation is the studio's own hand, and there is no honest way to
       invent where they would point or what they would say. It is offered ONLY
       where they have filed an example of it in the Visual Brand, and hidden
       completely otherwise (see `layoutsFor` in YourWeek.jsx). */
    id: 'E3', group: 'educational', name: 'Annotated photo', shape: 'annotate', shots: 1, teach: true,
    when: 'Pointing at what you did, on the photograph you did it in.',
    kinds: ['annotated'], needs: ['layout', 'photography'],
    img: '/assets/photo/ph/ph-mon-4.jpg',
    sample: { eyebrow: 'Design detail', head: '', body: 'The lamp sits 75cm above the table — low enough to hold the room together.' },
  },

  /* ── project story ── */
  {
    id: 'P1', group: 'project', name: 'Project cover', shape: 'bleed-top', shots: 1,
    when: 'Opens a story: the finished room and the project named on it.',
    kinds: ['hero'], needs: ['layout'],
    img: '/assets/photo/ph/ph-tue-4.jpg',
    sample: { eyebrow: 'Project story', head: 'From concept to a space that feels intentional.', body: '' },
  },
  {
    id: 'P2', group: 'project', name: 'The decision', shape: 'stack', shots: 1,
    when: 'One choice that shaped the room, with the reason under it.',
    kinds: ['decision'], needs: ['layout'],
    img: '/assets/photo/ph/ph-tue-2.jpg',
    sample: { eyebrow: '', head: 'The story behind this project.', body: 'A look at the ideas, decisions and details that shaped it.' },
  },
  {
    id: 'P3', group: 'project', name: 'Process frame', shape: 'bleed', shots: 1,
    when: 'The work half-done, which is the part nobody else posts.',
    kinds: ['process'], needs: ['photography'],
    img: '/assets/photo/ph/ph-mon-5.jpg',
    sample: { eyebrow: 'Behind the scenes', head: 'Six weeks in, and the light finally works.', body: '' },
  },

  /* ── results ── the proof: what changed, and who says so ── */
  {
    id: 'R1', group: 'results', name: 'Before and after', shape: 'duo', shots: 2,
    when: 'Two states of one room in one frame — the change read at a glance.',
    kinds: ['beforeAfter'], needs: ['comparison'],
    img: '/assets/photo/ph/ph-sun.jpg', imgB: '/assets/photo/ph/ph-tue-4.jpg',
    sample: { eyebrow: 'Before & after', head: 'Same room. Six months apart.', body: '' },
  },
  {
    id: 'R2', group: 'results', name: 'The finished room', shape: 'bleed', shots: 1,
    when: 'Closes a story on the finished room, quietly.',
    kinds: ['hero'], needs: ['photography'],
    img: '/assets/photo/ph/ph-sat.jpg',
    sample: { eyebrow: 'Completed project', head: 'Calm, timeless and made for everyday living.', body: '' },
  },
  {
    id: 'R3', group: 'results', name: 'Client words', shape: 'quote', shots: 0,
    when: 'What a client said, set large enough to stop a thumb.',
    kinds: ['quote'], needs: ['layout', 'colour'],
    img: null,
    sample: { eyebrow: '', head: 'It finally feels like the home we described on the first call.', body: 'Prinsengracht apartment · 2026' },
  },
  {
    id: 'R4', group: 'results', name: 'Portfolio grid', shape: 'grid4', shots: 4,
    when: 'A body of work in one frame, when there are enough rooms to show.',
    kinds: ['hero'], needs: ['photography'],
    img: '/assets/photo/ph/ph-mon-1.jpg',
    imgs: ['/assets/photo/ph/ph-mon-1.jpg', '/assets/photo/ph/ph-tue-1.jpg', '/assets/photo/ph/ph-sat.jpg', '/assets/photo/ph/ph-tue-4.jpg'],
    sample: { eyebrow: '', head: 'Four homes, one way of working.', body: '' },
  },

  /* ── details ── the close work: materials, textures, the small decisions ── */
  {
    id: 'D1', group: 'details', name: 'Material close crop', shape: 'crop', shots: 1,
    when: 'One material, close enough to read the grain.',
    kinds: ['material'], needs: ['photography'],
    img: '/assets/photo/ph/ph-tue-6.jpg',
    sample: { eyebrow: 'Material detail', head: 'It’s all in the details.', body: '' },
  },
  {
    id: 'D2', group: 'details', name: 'Material board', shape: 'swatches', shots: 1,
    when: 'The palette of a project, laid out as samples.',
    kinds: ['material'], needs: ['photography', 'colour'],
    img: '/assets/photo/ph/ph-tue-5.jpg',
    sample: { eyebrow: 'Material choice', head: 'Natural materials, real impact.', body: 'Oak · Travertine · Linen' },
  },
  {
    id: 'D3', group: 'details', name: 'Detail with a caption', shape: 'stack', shots: 1,
    when: 'A corner of a room, and the one sentence that explains it.',
    kinds: ['detail'], needs: ['layout'],
    img: '/assets/photo/ph/ph-mon-2.jpg',
    sample: { eyebrow: '', head: 'Every detail serves the whole space.', body: 'Textures, edges and transitions that elevate the experience.' },
  },
];

export const layoutGroup = (id) => LAYOUT_GROUPS.find((g) => g.id === id) || null;

/* Each layout, with the one thing standing between it and being usable.
 *
 * `ready` where every dimension it needs holds a reference AND the project has
 * the photographs it takes. `missing` is the first thing that does not — one
 * ask, never a list, the same rule the empty slide follows. */
export function layoutsOf(refs, assets) {
  const state = Object.fromEntries(coverageOf(refs).map((d) => [d.id, d]));
  const stills = assets?.photos || 0;
  return LAYOUTS.map((l) => {
    const gap = l.needs.map((n) => state[n]).find((d) => d && d.state === 'none');
    const short = l.shots > stills;
    return {
      ...l,
      ready: !gap && !short,
      missing: gap || null,
      /* the material is its own kind of missing: no reference can supply a
         photograph the studio has not taken */
      shortBy: short ? l.shots - stills : 0,
      groupLabel: layoutGroup(l.group)?.label || '',
    };
  });
}

/* ── 6 · reading a layout reference ───────────────────────────────────────
 *
 * The brief: a studio drops in a reference, Bauhly works out which kind of
 * slide it is an example of, files it there, and pulls the reusable design
 * characteristics out of it so that category builds its own visual language.
 *
 * WHAT THIS BUILD CAN HONESTLY DO, AND WHAT IT CANNOT.
 *
 * There is no vision model here. So this does the part that is real arithmetic
 * over the file — and says so — and is explicit about the part that is not:
 *
 *   REAL, computed from the picture in the browser:
 *     · the palette (pixels, sampled and quantised — see `paletteOf`)
 *     · the shape (4:5, 1:1, 9:16 — from the natural dimensions)
 *     · how much of the frame is dark, which is the closest honest proxy for
 *       "type over a photograph" versus "type on a canvas"
 *   REAL, but read from the file rather than the image:
 *     · the category, where the studio's own file name says it
 *       ("hook-cover.jpg", "before-after.png") — that is evidence, and the
 *       panel names it as the file name rather than as an analysis
 *   NOT AVAILABLE YET, and never claimed:
 *     · composition, typographic hierarchy, font style, image-to-text ratio,
 *       spacing, white space, graphic elements, visual rhythm
 *
 * `TRAITS` carries all nine so the contract is written down: `reads` marks the
 * ones this build fills in, and the panel shows the rest as what the analysis
 * pass will add. Nothing is ever populated with a guess.
 */
export const TRAITS = [
  { id: 'palette', label: 'Colour palette', reads: true },
  { id: 'shape', label: 'Frame and crop', reads: true },
  { id: 'weight', label: 'Light or dark ground', reads: true },
  { id: 'composition', label: 'Layout composition' },
  { id: 'hierarchy', label: 'Typographic hierarchy' },
  { id: 'font', label: 'Font style' },
  { id: 'ratio', label: 'Image-to-text ratio' },
  { id: 'spacing', label: 'Spacing and white space' },
  { id: 'graphics', label: 'Graphic elements' },
  { id: 'rhythm', label: 'Visual rhythm' },
];

/* the words a studio actually puts in a file name, per category */
const NAME_HINTS = {
  hook: /\b(hook|cover|opening|headline|title)\b/i,
  educational: /\b(educat|tip|tips|how ?to|guide|steps?|lesson|teach)\b/i,
  project: /\b(project|story|case ?study|journey|process)\b/i,
  results: /\b(before|after|result|finished|testimonial|review|portfolio|grid)\b/i,
  details: /\b(detail|material|texture|swatch|close ?up|crop|palette)\b/i,
};

/* ── the palette, from the pixels ─────────────────────────────────────────
 * Drawn small and sampled: a 32px thumbnail is plenty to find the four or five
 * colours a reference is actually built from, and it costs one paint. Buckets
 * are coarse on purpose — a studio's palette is "warm oak, off-white, black",
 * not 4,000 near-identical beiges. */
export function paletteOf(img, take = 5) {
  try {
    const c = document.createElement('canvas');
    const w = 32;
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w)) || 32;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const bins = new Map();
    let dark = 0; let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      n += 1;
      if ((r * 299 + g * 587 + b * 114) / 1000 < 110) dark += 1;
      /* 32 steps per channel: coarse enough to group a photograph's shades,
         fine enough to keep an accent apart from the wall behind it */
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const cur = bins.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      cur.r += r; cur.g += g; cur.b += b; cur.n += 1;
      bins.set(key, cur);
    }
    const sorted = [...bins.values()].sort((a, b) => b.n - a.n).slice(0, take);
    return {
      colours: sorted.map((s) => `#${[s.r, s.g, s.b]
        .map((v) => Math.round(v / s.n).toString(16).padStart(2, '0')).join('')}`),
      dark: n ? dark / n : 0,
    };
  } catch {
    /* a cross-origin picture taints the canvas; the reference is still a
       reference, it simply arrives without a palette */
    return { colours: [], dark: 0 };
  }
}

export function shapeOfImage(img) {
  const r = img.naturalWidth / img.naturalHeight;
  if (!r || !Number.isFinite(r)) return null;
  if (r > 1.15) return 'Landscape';
  if (r < 0.62) return '9:16 — story or reel';
  if (r < 0.92) return '4:5 — feed';
  return '1:1 — square';
}

/* ── the whole read ───────────────────────────────────────────────────────
 * Returns the category Bauhly is prepared to stand behind, WHY it thinks so,
 * and the traits it actually managed to fill in. A null category is the honest
 * answer most of the time in this build, and the panel asks. */
export function analyseReference(fileName, img) {
  const hit = Object.entries(NAME_HINTS).find(([, re]) => re.test(fileName || ''));
  const { colours, dark } = paletteOf(img);
  return {
    group: hit ? hit[0] : null,
    /* the only confidence this build can honestly claim is "your own file name
       said so" — never a percentage, and never a claim about the picture */
    basis: hit ? `Read from the file name — “${fileName}”` : null,
    traits: {
      palette: colours,
      shape: shapeOfImage(img),
      weight: dark > 0.45 ? 'Dark ground — type reads white' : 'Light ground — type reads dark',
    },
  };
}

/* every layout reference filed under one category — this is the scoping the
 * brief asks for: a Hooks reference informs Hook layouts and nothing else */
export function refsForGroup(refs, group) {
  return (refs || []).filter((r) => r.layoutGroup === group);
}

/* ── 7 · the studio's palette, read rather than picked ────────────────────
 *
 * A DOCUMENTED REVERSAL, NARROWLY (Leon, Aug 4). "The palette is Bauhly's own
 * and is not the studio's to set" was decided when the only way to have one
 * was a colour picker in a settings page — a studio hand-tuning six swatches
 * is exactly the configuration screen this whole profile exists to avoid.
 *
 * What has changed is that the palette no longer has to be PICKED. It can be
 * READ: from the references the studio added and from the photographs they
 * have already captured, both of which are same-origin and both of which are
 * the real evidence of what their work looks like. So the Visual Style page
 * shows a palette with a source on it, and there is still no picker.
 *
 * `neutrals` and `accents` are split on saturation, because that is the split
 * a designer works in: the greys and warm off-whites a room is built from, and
 * the two or three colours that are a choice.
 */
function hsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/* how close two colours are, cheaply — enough to stop a palette showing six
   shades of the same beige */
function near(a, b, tol = 26) {
  const pa = parseInt(a.slice(1), 16); const pb = parseInt(b.slice(1), 16);
  return Math.abs((pa >> 16 & 255) - (pb >> 16 & 255)) < tol
    && Math.abs((pa >> 8 & 255) - (pb >> 8 & 255)) < tol
    && Math.abs((pa & 255) - (pb & 255)) < tol;
}

export function paletteFrom(colours) {
  const uniq = [];
  (colours || []).forEach((c) => {
    if (!/^#[0-9a-f]{6}$/i.test(c)) return;
    if (!uniq.some((u) => near(u, c))) uniq.push(c);
  });
  /* 0.3, not 0.22 (measured on the demo account): a warm off-white oak wall
     sits around 0.2–0.28, and at the lower threshold three shades of beige
     were being presented as this studio's ACCENT COLOURS. A neutral that
     happens to be warm is still a neutral — an accent is a decision. */
  const neutrals = uniq.filter((c) => hsl(c).s < 0.3).sort((a, b) => hsl(b).l - hsl(a).l);
  const accents = uniq.filter((c) => hsl(c).s >= 0.3).sort((a, b) => hsl(b).s - hsl(a).s);
  return { neutrals: neutrals.slice(0, 6), accents: accents.slice(0, 3) };
}

/* load a handful of the studio's own pictures and sample them. Same-origin, so
   the canvas is readable; capped at six because a palette is a summary, not a
   census, and every extra image is a decode. */
export function readPalette(urls, done) {
  const take = (urls || []).slice(0, 6);
  /* RAW COLOURS BACK, NOT A SPLIT ONE (Leon, Aug 4). It used to return a
     finished palette, which forced the page to choose between the references'
     colours and the photographs' — and choosing the references gave a
     three-swatch palette under a line saying it had read thirteen pictures.
     The page merges the two lists and splits once. */
  if (!take.length) { done([]); return; }
  const all = [];
  let left = take.length;
  const finish = () => { left -= 1; if (left === 0) done(all); };
  take.forEach((src) => {
    const img = new Image();
    img.onload = () => { all.push(...paletteOf(img, 4).colours); finish(); };
    img.onerror = finish;
    img.src = src;
  });
}

/* ── 8 · the type scale the layouts actually use ──────────────────────────
 * Not a menu of options: the four roles every generated slide is built from,
 * at the sizes and weights `LayoutSystem`'s previews already draw them. Naming
 * them here is what makes them a system rather than four decisions taken
 * separately in eighteen templates. */
export const TYPE_ROLES = [
  { id: 'eyebrow', label: 'Eyebrow', use: 'Names the kind of post — Project insight, Design detail.', face: 'ui' },
  { id: 'headline', label: 'Headline', use: 'The one sentence the slide is about.', face: 'display' },
  { id: 'body', label: 'Supporting text', use: 'The explanation under a headline, and step text.', face: 'ui' },
  { id: 'caption', label: 'Caption', use: 'Sources, project names, dates.', face: 'ui' },
];

/* the two grounds a slide is ever drawn on, and what happens to a photograph
   when the words have to sit on it — both read off the layout previews */
export const GROUNDS = [
  { id: 'canvas', label: 'Studio canvas', use: 'Type-only slides — quotes, statements, checklists.' },
  { id: 'photo', label: 'Photograph', use: 'Everything with a room in it. Type sits on a soft wash so it stays readable.' },
];

/* ── 9 · the visual system, once the studio has a hand in it ──────────────
 *
 * Everything above this line is READ — the palette off their pictures, the
 * type roles off the layouts. That is the right default and it stays the
 * default; what was missing is the ability to disagree with it.
 *
 * So the store holds `brandStyle`, and it is null until something is changed.
 * `styleOf()` merges what Bauhly proposed with what the studio adjusted, so a
 * palette they have never touched keeps improving as they capture more work,
 * and one they have edited stays exactly as they left it.
 */
/* ── THREE COLOURS, EACH WITH A JOB (Leon, Aug 4) ─────────────────────────
 *
 * The first pass at this let a studio keep any number of colours, each with a
 * hex field, a Neutral/Accent dropdown and a drag handle. It was a palette
 * MANAGER: legible only to someone who already knew what the order meant, and
 * the answer to "where does this one get used?" was nowhere on the page.
 *
 * Three roles now, because three is what a generated slide actually reaches
 * for, and each one is shown doing its job rather than described.
 */
export const COLOUR_ROLES = [
  { id: 'primary', label: 'Primary', use: 'Headlines and body text' },
  { id: 'accent', label: 'Accent', use: 'Numbers, marks, one line at a time' },
  { id: 'neutral', label: 'Neutral', use: 'Backgrounds and quiet surfaces' },
];

/* the two roles a slide sets type in. Not four, and nothing adjustable per
 * role: a studio hands over the faces, Bauhly decides the sizes — that is the
 * whole bargain of this product, and a size dropdown per role was it leaking. */
export const TYPE_ROLES_MIN = [
  { id: 'heading', label: 'Heading', face: 'display', use: 'The line the slide is about.' },
  { id: 'body', label: 'Body', face: 'body', use: 'Everything under it.' },
];

/* the grounds a slide can be drawn on. The first is Bauhly's and cannot be
 * removed — every layout needs somewhere to put type when there is no room to
 * photograph, and a studio that has uploaded nothing still gets good slides —
 * and everything after is the studio's own. */
export const BASE_GROUNDS = [
  { id: 'canvas', label: 'Studio canvas', fixed: true, use: 'Your Neutral, flat. Quotes, statements, checklists.' },
];

/* THE WASH UNDER TYPE stayed, the CONTROL for it went (Leon, Aug 4). How dark
   a photograph goes behind a headline is a readability decision, not a taste
   one — it depends on the picture, and asking a studio to pick a strength for
   every room is exactly the work they handed over. Medium is the default and
   the layouts still read it. */
export const SCRIMS = [
  { id: 'light', label: 'Light', v: 0.4 },
  { id: 'medium', label: 'Medium', v: 0.62 },
  { id: 'strong', label: 'Strong', v: 0.78 },
];

/* THE FIVE SLIDES the style is shown on — one per layout category, chosen so
   that between them they use all three colours and both faces: a statement on
   the ground, numbered steps carrying the accent, a photograph, a quote and a
   detail. Real layout ids, drawn with the real `Preview`. */
export const IN_ACTION = ['H3', 'E2', 'P1', 'R3', 'D3'];

export const DEFAULT_STYLE = {
  colours: null, // null = still whatever was read from the pictures
  grounds: [],
  /* WHICH ONE IS THE DEFAULT (Leon, Aug 4). One id, and it is the only thing a
     studio decides about backgrounds: everything else — how it crops, where it
     sits, how far the type has to lift off it — is Bauhly's, per layout. An id
     that no longer resolves (an upload lost with the document) falls back to
     the canvas rather than drawing nothing; see `groundOf`. */
  ground: 'canvas',
  treatment: { scrim: 'medium' },
  logo: { url: null, name: null, spot: 'none' },
};

export function styleOf(stored) {
  const s = stored || {};
  return {
    ...DEFAULT_STYLE,
    ...s,
    /* an array is the old free-list shape — treated as unset rather than
       migrated, because three named roles are read back off the pictures in
       one pass and nothing is lost */
    colours: Array.isArray(s.colours) ? null : (s.colours || null),
    treatment: { ...DEFAULT_STYLE.treatment, ...(s.treatment || {}) },
    logo: { ...DEFAULT_STYLE.logo, ...(s.logo || {}) },
    grounds: s.grounds || [],
    ground: s.ground || DEFAULT_STYLE.ground,
  };
}

/* the ground to draw on: an override id if one was given (a single slide in the
 * plan), otherwise the studio's default, otherwise the canvas. */
export function groundOf(style, override) {
  const want = override || style.ground || 'canvas';
  const own = (style.grounds || []).find((g) => g.id === want);
  if (own) return { id: own.id, label: own.label, url: own.url, own: true };
  const base = BASE_GROUNDS.find((g) => g.id === want) || BASE_GROUNDS[0];
  return { id: base.id, label: base.label, url: null, own: false };
}

/* what a ground is worth as CSS. One place, because the Visual Style previews
 * and the plan's own frames have to agree about what a background looks like —
 * two implementations would be two answers to "how will this look in use".
 *
 * A PHOTOGRAPHIC GROUND CARRIES A WASH, and the type on it goes white. That is
 * not a setting: type has to be readable on whatever was uploaded, and deciding
 * it per slide is the work the studio handed over. */
export function groundVars(g, neutral) {
  return g.own
    ? { '--vs-ground': neutral, '--vs-ground-img': `url(${g.url})` }
    : { '--vs-ground': neutral, '--vs-ground-img': 'none' };
}

/* WHICH THREE, OUT OF WHAT WAS READ. The darkest thing in a studio's pictures
 * is what their type wants to be; the lightest is the ground it sits on; the
 * one colour that is a decision is the accent. Sensible, and — more to the
 * point — derived, so nobody has to choose three hexes to get started. */
/* how dark a colour is, 0–1 — the standard luma weights */
function lum(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (Number.isNaN(n)) return 1;
  return (((n >> 16 & 255) * 299) + ((n >> 8 & 255) * 587) + ((n & 255) * 114)) / 255000;
}

export function rolesOf(style, palette) {
  if (style.colours) return { ...style.colours };
  const n = palette?.neutrals || [];
  const a = palette?.accents || [];
  const darkest = n[n.length - 1];
  return {
    /* PRIMARY IS TYPE, SO IT HAS TO BE READABLE (measured: the darkest thing
       in a warm interior set is a mid-brown at 0.45 luma, and a headline in it
       on an off-white ground is a washed-out headline). The studio's own
       darkest tone is used where it is genuinely dark; otherwise the product's
       ink, which is the honest answer — their pictures simply do not contain a
       colour you can set type in. They can still change it. */
    primary: darkest && lum(darkest) < 0.34 ? darkest : '#16161a',
    accent: a[0] || darkest || '#8d7157',
    neutral: n[0] || '#f5f0e8',
  };
}
