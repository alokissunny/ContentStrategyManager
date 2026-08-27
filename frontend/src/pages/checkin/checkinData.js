/*
 * Check-in copy + pillars — the words Bauhly says, ported verbatim from
 * bauhly-v3 data/demo.js (CHECKIN + PILLARS). Checkin.jsx owns the flow;
 * this owns every line. Kept self-contained so the app has no demo-store dep.
 */

export const PILLARS = {
  discovery: {
    id: 'discovery',
    /* The label IS the outcome (Leon, July 30). "Discovery", "Credibility" and
     * "Trust" are our taxonomy — a studio should never have to learn three nouns
     * to read their own plan, and the goal chips already said it in plain words. */
    label: 'Attract new people',
    icon: 'discovery',
    color: 'var(--discovery-500)',
    soft: 'var(--discovery-50)',
    tint: 'var(--discovery-100)',
    strong: 'var(--discovery-600)',
    question: 'Do new people find your work?',
    plain: 'Found',
    goalChip: 'Attract new people',
    /* the user-facing outcome — always leads; the internal pillar name is
     * secondary vocabulary, never the only explanation (v2 IA rule) */
    outcome: 'Attract new people',
    outcomeLine: 'Helps people outside your current audience find and notice your work.',
    /* what tells you it worked — PUBLIC signals only. Reach and saves would say
     * more and are deliberately not promised here: they are private until
     * Insights is connected (see the data contract in doc 07). */
    outcomeSignal: 'Comments from accounts you don\'t recognise, and Reel views running above your usual.',
    outcomePace: 'This one moves fastest of the three — a Reel that travels can show up within a day.',
  },
  credibility: {
    id: 'credibility',
    label: 'Show your expertise',
    icon: 'credibility',
    color: 'var(--credibility-500)',
    soft: 'var(--credibility-50)',
    tint: 'var(--credibility-100)',
    strong: 'var(--credibility-600)',
    question: 'Do they trust your eye?',
    plain: 'Trusted',
    goalChip: 'Show your expertise',
    outcome: 'Show your expertise',
    outcomeLine: 'Makes people trust how you think about space — the reason they save and quote you.',
    outcomeSignal: 'Questions in the comments. "Which tile is that?" is someone thinking it through with you.',
    outcomePace: 'This one builds over weeks, not posts — one explainer rarely moves it, four in a row do.',
  },
  trust: {
    id: 'trust',
    label: 'Build confidence',
    icon: 'trust',
    color: 'var(--trust-500)',
    soft: 'var(--trust-50)',
    tint: 'var(--trust-100)',
    strong: 'var(--trust-600)',
    question: 'Do they reach out?',
    plain: 'Hired',
    goalChip: 'Build confidence',
    outcome: 'Build confidence',
    outcomeLine: 'Turns admiration into enquiries — proof that you can do it for them.',
    outcomeSignal: 'People naming their own project in the comments. That is an enquiry forming in public.',
    outcomePace: 'This is the slowest to move and the one that pays — it needs the other two underneath it.',
  },
};

export const CHECKIN = {
  /* the third answer to the opening question: say it out loud */
  recordChip: 'Record a voice note',
  /* a transcript is a machine's guess — a second take is a real answer to it */
  recordAgain: 'Record it again',
  recordKept: 'Recorded — I keep the words, not the audio.',
  recordCheck: 'Check I got this right:',
  recordDenied: 'I can\'t reach the microphone — write it instead.',
  recordNote: 'Your recording is only used to plan. It is never shared or posted.',

  /* The opening question. It used to say "this week", which is only right for
   * one of the three plan lengths (Leon, July 31) — a studio coming back to
   * build a month is being asked about the wrong span before it has said
   * anything. It asks about the work, and the length is chosen later. */
  opening: 'What are you working on, or what\'s happened recently that could be worth sharing?',
  /* the first time through, the question arrives cold: the user has just
   * finished setup and has no idea this is a weekly habit. Name the moment,
   * place the habit, then ask the same question every week asks. */
  /* One line, not three (Leon, July 30).
   *
   * It used to say "Welcome to your first week plan", then explain that this is
   * the check-in, that it runs once a week, that it takes a minute, and that
   * every plan is built this way — before asking anything. Four claims to
   * introduce one question, and the first of them ("week") is no longer even
   * true, since a plan can be a month. */
  firstWeekWelcome: [
    'This is the check-in — it\'s how every plan gets built.',
  ],
  inputPlaceholder: 'Tell Bauhly what you\'re working on…',

  /* the global quick actions — shortcuts kept above the input. Everything
   * else (recommendations, choices, confirmations) happens inside the chat. */
  /* phrased as the answer a person would give to the question above them, like
   * every other button in a Bauhly conversation — never as a command to the
   * software ("Generate…"), which is the one voice this product doesn't use. */
  suggestions: [
    { id: 'auto', label: 'Nothing new, you decide', icon: 'signal' },
  ],

  /* first-time / low-data welcome — no history to plan from. Bauhly reassures,
   * names the focus, then asks for one real idea or piece of work (the same
   * "what are you working on" move the other flows make) and builds from it.
   * Only ever shown once: after the first week exists, the normal path runs. */
  /* Short, and one step fewer (Leon, July 30). It was four paragraphs and a
   * "Let's start" button before the first question — a wall of reassurance in
   * front of an empty field. Two lines now, the second carrying the focus and
   * the ask together, and the field is open underneath. */
  newWelcome: 'Welcome to Bauhly, {name} 👋 You\'re just starting, so I have no past posts to learn from yet — that\'s normal.',
  newIdeaQ: 'This first week builds your base, aimed at {focus}. So tell me one thing worth posting about: an idea you keep coming back to, a lesson from your work, or something you made recently.',
  newIdeaPlaceholder: 'An idea, a lesson, a piece of work…',
  newIdeaAck: 'Good — that\'s a real starting point. I\'ll build your first week around it.',
  /* The blank page has a way out — one, not a menu (Leon, July 30).
   *
   * Being asked to choose a starting method is another decision at the exact
   * moment the user has none. So Bauhly just starts, from the profile they
   * already filled in, and says what happens next: the week is where the real
   * material comes from. Nothing invented, nothing they haven't told him. */
  newIdeaEscape: 'Nothing comes to mind',
  newIdeaEscapeQ: 'No problem. I\'ll start from your brand profile: what you do, who you do it for, and the problem they arrive with.',
  /* Said at the NEXT step, not with the line above (Leon, July 30). Two paragraphs
   * arriving together is a briefing; the second one is about what happens after this
   * conversation, so it waits until the conversation has moved on. */
  keepAdding: 'And as the week goes, add anything that comes up — an idea, a site visit, a client moment, a photo or a file. That\'s what turns a plan into stories only you can tell.',

  /* the "let Bauhly plan" path — a small menu of directions rather than jumping
   * straight to one proposal */
  /* Three ways to start, in plain words.
   *
   * These used to be written the way a strategist talks to another strategist
   * ("resequenced into fresh posts", "angles gaining traction"). Every card is
   * now one short sentence saying what Bauhly will actually do, readable first
   * time by someone whose second language this is. The icon carries the shape
   * of the idea so the three are told apart before they're read. */
  /* the length is the LAST thing this conversation asks, so nothing before it may
   * call the plan a week (Leon, July 30) */
  strategyIntro: 'Happy to steer. Which of these fits right now?',
  strategyOptions: [
    { id: 'trend-project', icon: 'site', title: 'One of your projects', line: 'I pick a real project of yours that matches what people are looking for right now.' },
    { id: 'compilation', icon: 'copy', title: 'Your best past work', line: 'A "best of" week: your strongest rooms and details, made into new posts.' },
    { id: 'trend-topic', icon: 'pulse', title: 'A popular topic', line: 'Post about something people are talking about now. No finished project needed.' },
  ],
  compilationConfirm: 'Good — your strongest work, nothing invented.',

  /* previous-project path — Bauhly checks current conversations, then
   * recommends at most two projects that fit, each with the reason */
  projectTrendIntro: 'Good — your own work is the best material. One second while I check what people are talking about…',
  projectTrendResult: 'Two of your projects line up with what\'s being talked about right now:',
  projectBestTag: 'Best match',
  projectConfirm: 'The {name} it is. I already know the project — I\'ll only ask what\'s changed since.',

  /* the honest "nothing aligns" pivot — offered as an option beside the project
   * picks: when your work doesn't match the moment, the opening is to say what
   * everyone else is avoiding (an experiment, watched closely) */
  experimentChip: 'Or run an experiment instead',
  /* The opening is in work they have ALREADY DONE (Leon, July 30). This used to
   * open with "none of your projects match", which is both deflating and beside
   * the point: the gap is not that their work doesn't fit the conversation, it is
   * that nobody in their field is posting these angles — and each angle here comes
   * straight out of a project on file, so the photos exist too. */
  /* Read the demand first, then match a project to it (Leon, July 31). It used to
   * lead with what nobody posts, which is a gap in the feed — the reason to make
   * one of these is that people are ALREADY asking, and the studio has the project
   * that answers it. The gap is the second half of each line, not the headline. */
  experimentIntro: 'Here\'s an opening — three of your projects that answer what people are asking about right now.',
  /* named above the cards, so where they came from is legible before they are read */
  experimentLabel: 'From your projects',
  experimentTopics: [
    {
      id: 'money',
      project: 'prinsengracht',
      title: 'What a renovation really costs',
      line: 'Budget is the question under half the comments in your field — and almost no one answers it with real numbers.',
    },
    {
      id: 'regret',
      project: 'jordaan',
      title: 'The design choice I\'d undo',
      line: 'People keep asking what to avoid. Designers rarely say it about their own work.',
    },
    {
      id: 'no-buy',
      project: 'bloemgracht',
      title: 'What I tell clients NOT to buy',
      line: 'Shopping advice is what gets asked for most; the honest version of it is rare.',
    },
  ],
  experimentConfirm: '"{title}" — good. I\'ll build it from {name} and tell you next week how it landed.',

  /* "Anything changed on this project since we last spoke?" used to sit here,
   * and before it "anything new worth folding in?" (Leon, July 31). Bauhly asks
   * next what material there is, which is the part of that answer it can
   * actually use; the rest was a paragraph the studio had to compose before it
   * could get on with the plan.  */

  /* images — asked in conversation. At least one real photo is required: real
   * photos come first, placed with each post; reused shots get an angle shift.
   *
   * Every line here was three sentences long and said the same thing as the
   * next one (Leon, July 29). The rule — your photos first, nothing invented —
   * is stated ONCE, at the gate where it matters, and everything else is the
   * question. */
  imageQuestion: 'Photos next. I can use this project\'s own shots.',
  imageQuestionNew: 'Photos next. Upload one real photo and I\'ll build around it.',
  imageChips: {
    reuse: 'Reuse the project\'s images',
    upload: 'Upload a photo',
    /* the way through when there is nothing to upload (Leon, July 30) — an
     * upload was the only door out of this question, so a studio without a
     * photo to hand could not finish the check-in at all */
    none: 'Use what I already have',
    /* the way past a reuse offer (Leon, July 30): "reuse these" was the only
     * button on that turn, so a studio who wanted to choose the pictures later
     * had nothing to press */
    skip: 'Leave the pictures to me',
  },
  imageReuseAck: 'Done — one {name} shot per post.',
  /* what happens with no new photograph: existing material, and a direction read
   * off the accounts that are already winning this subject */
  imageNoneAck: 'Fine — I\'ll work with the material on file, and shape the angle from what\'s working for the studios ahead of you. Add a photo any time and I\'ll fit it in.',
  imageSkipAck: 'Done — the slides come through empty and you can drop pictures in as you go. I\'ll still shape the words from what\'s working for the studios ahead of you.',
  uploadPrompt: 'Drop it in. One clear photo is enough.',
  uploadSkip: 'Not now',
  /* No promise about what the photo will do (Leon, July 31): "your photo leads
   * the plan" is a claim about a plan that doesn't exist yet, and the question
   * after it explained itself instead of asking. Ask for the context, plainly. */
  uploadAck: 'Got it.',
  /* asked WITH the file, because this is the only moment the answer is known */
  uploadNoteQ: 'What is this photo about? The more you tell me, the more the posts can say.',
  uploadNotePlaceholder: 'e.g. Kitchen the morning after the rewire',
  uploadNoteSkip: 'Nothing to add',
  /* asked before the generate gate, however the material questions went — this
   * is the moment a studio remembers the other photo */
  moreQ: 'Anything else you want to add before I build it?',
  moreUpload: 'Add a file',
  moreNote: 'Add a note',
  moreNoteQ: 'Go ahead — anything I should know before I write it.',
  moreNotePlaceholder: 'e.g. The client wants the before-and-after kept quiet until October',
  /* the go-ahead, said as the answer to "anything else?" — there is no separate
   * confirmation step behind it any more */
  moreDone: 'Build the full plan',

  /* the generate gate — real photos come first; where a post has no matching
   * shot, Bauhly can AI-adapt an original (same photo, new direction) to fill
   * the gap. That costs the user credits, so it needs a clear go-ahead.
   *
   * Split across three short turns: this is a decision point, and a hundred
   * words in one bubble is where people stop reading. ("Tokens" was the old
   * wording — that's our billing plumbing, not their vocabulary.) */
  /* The generate confirmation used to sit here: "Your real photos come first — I
   * never invent rooms or results", then an offer to recrop a shot for the posts
   * with no matching photograph, then two chips. It asked for permission one
   * answer before the plan, for something the studio already decided when it
   * chose its plan; "Build the full plan" on the question before it is the same
   * go-ahead without the paragraph (Leon, July 31). */

  /* Bauhly-decides proposals — per persona, grounded in the week's focus */
  propose: {
    established:
      'People find you and trust your eye, but few reach out. That\'s a proof gap. I\'d build this week around the {project} story: the brief, the messy middle, how it ended.',
    growing:
      'Your page is readable now, and the pattern is clear: teaching works, proof is thin. I\'d build this week around the {project} story to close that gap.',
    new:
      'With almost nothing published yet, this week lays the foundation: who you are, one useful idea, your first Reel, your honest reason, and one question for your audience.',
  },
  proposeChips: {
    confirm: 'Sounds right, build it',
    directions: 'Show me other directions',
    otherProject: 'Use a different project',
  },

  /* Path B — five specific directions (spec: title · why the goal · why the
   * audience cares · what asset supports it). Anti-generic by rule. */
  directions: [
    {
      id: 'load-bearing',
      title: 'The load-bearing month',
      project: 'prinsengracht',
       goalFit: 'Builds confidence — the setback is what makes the reveal believable.',
      audienceWhy: 'Everyone planning a renovation fears the surprise. Show one, survived.',
      asset: 'Timeline photos from the site',
    },
    {
      id: 'budget-honest',
      title: 'What the budget actually bought',
      project: 'prinsengracht',
       goalFit: 'Builds confidence — money honesty is the rarest proof in interior design.',
      audienceWhy: 'Couples comparing quotes need numbers, not adjectives.',
      asset: 'The material board',
    },
    {
      id: 'sample-lost',
      title: 'The sample that lost',
      project: 'jordaan',
       goalFit: 'Shows your expertise — rejected options show judgment, not just taste.',
      audienceWhy: 'People can\'t choose between fabrics either — show how you do it.',
      asset: 'Fabric samples on the desk',
    },
    {
      id: 'empty-room',
      title: 'Before the furniture arrives',
      project: 'jordaan',
       goalFit: 'Shows your expertise — a room that already works while empty is the argument.',
      audienceWhy: 'It teaches that layout, not shopping, makes the space.',
      asset: 'A phone walkthrough on site',
    },
    {
      id: 'dark-floor',
      title: 'A dark ground floor, fixed',
      project: 'bloemgracht',
       goalFit: 'Attracts new people — a relatable problem with visible before/after logic.',
      audienceWhy: 'Half the city lives with this exact problem.',
      asset: 'Before/after photos',
    },
  ],
  directionsIntro: 'Fair enough. From what I know of your work, five directions worth a week:',
  directionPicked: '"{title}" — good week. Two quick questions to sharpen it.',

  /* Path A follow-ups — per authority goal, from the spec's question banks.
   * Chips are quick answers; typed answers are always accepted. */
  followups: {
    discovery: [
      {
        q: 'What do people usually get wrong about this kind of project?',
        chips: ['They think it needs a bigger budget', 'They start with shopping, not layout', 'They copy rooms that don\'t fit their life'],
      },
      {
        q: 'What would you tell someone about to start the same thing tomorrow?',
        chips: ['Decide how you live first', 'Fix the light before the furniture', 'One good decision beats ten purchases'],
      },
    ],
    credibility: [
      {
        q: 'Which decision on this project would other designers argue with?',
        chips: ['Keeping the awkward wall', 'The dark ceiling', 'Spending the budget on light, not furniture'],
      },
      {
        q: 'What did you reject before landing on it?',
        chips: ['The obvious open-plan layout', 'Three "safe" fabric options', 'A showroom-perfect arrangement'],
      },
    ],
    trust: [
      {
        q: 'What changed for the client — the moment it stopped being a site and became their home?',
        chips: ['The first dinner they cooked there', 'The kids claiming their rooms', 'The "it doesn\'t look designed" comment'],
      },
      {
        q: 'Was there a hard moment worth keeping in the story?',
        chips: ['The load-bearing surprise', 'The budget conversation', 'The week everything was late'],
      },
    ],
  },

  /* the asset question — verbatim from the spec, asked naturally */
  assetQuestion: 'Anything that could support this — a photo, a sketch, a floor plan, a material sample?',
  /* Naming categories of material Bauhly then never sees is a survey (Leon,
   * July 31). Either the file is handed over here, or there isn't one. */
  assetUpload: 'Upload a file',
  assetNone: 'Nothing yet',
  assetAck: 'Plenty to work with — I\'ll shape the visuals around it.',
  /* said instead of asking "shall I use the project's own shots?" — the answer
   * to that was never in doubt once the studio said it had nothing new */
  assetAckOwn: 'Fine — I\'ll use {name}\'s own shots, one per post.',
  assetAckNone: 'Fine — we\'ll lean on words and graphics, and I\'ll flag where one phone photo would help.',

  /* format personalization — stored, used to shape future weeks */
  /* The format question is gone entirely.
   *
   * "Any formats you want more or less of this week?" ran before every week and
   * asked the user to art-direct the mix — the one part of the plan Bauhly is
   * meant to have reasoned about, from the pillar it is strengthening and what
   * the format data says. "Remove a format entirely" went with it: which
   * formats exist at all is a standing decision and lives in Brand profile
   * (see `FORMATS`). `formatPrefs` stays in the store for now — the route
   * generator still reads it — but nothing writes to it. */

  /* typed-idea path — after understanding, only asked if the project is unknown */
  projectQuestion: 'Which project does this belong to?',
  /* at most one clarifying question, same rule as Capture */
  clarifySkip: 'Skip this question',
  clarifyPlaceholder: 'Answer in your own words…',
  uploadOpening: 'Upload a file',
  matchedProjectAck: "I'll file this under {name}.",
  projectNewChip: 'Something new',
  projectNewLine: 'A project that isn\'t on file yet.',
  /* the same shape as the filing question at the other end of the conversation:
   * ONE project, already chosen, and the two ways to disagree with it */
  projectPickedApply: 'Use this one',
  /* not "this week": the length is chosen two questions later and can be a
   * fortnight or a month (Leon, July 31) */
  nameProjectQ: 'Give it a short name — that\'s how this plan will be filed.',
  nameProjectPlaceholder: 'e.g. Herengracht townhouse',

  /* ── filing, the last thing asked ──
   * Every week ends up under a project, because that is how the work is found
   * again months later — and because Projects is where the captures live that
   * the next week is planned from. It was only asked on the paths that happened
   * to start from a project; on the others the week was filed under nothing.
   *
   * Asked at the END rather than the start: by now the conversation has decided
   * what the week is about, so the answer is obvious and usually one tap. */
  filingQ: 'Which project should this plan be filed under?',
  filingQOne: 'I\'ll file this plan under a project so you can find it again.',
  filingNew: 'A new project',
  filingUnsure: 'Create a new project',
  /* when there are older projects and no name in mind */
  filingExisting: 'Use one I already have',
  /* on the naming step, where "create a new project" is what the field already
   * does — this button is the one for having no name in mind */
  nameForMe: 'Name it for me',
  filingRecent: 'Last week\'s',
  filingAck: 'Filed under {name}.',
  /* Bauhly naming it is a real answer, not a fallback that hides what happened:
   * it says the name it chose, so the user can change it in Projects. */
  filingAuto: 'I\'ll open one called "{name}" — rename it in Projects any time.',

  /* ── a fact onboarding never got ──────────────────────────────────────────
   *
   * "I'll answer later" during setup is a real answer, and this is the later
   * (Leon, July 30). The gap is raised in the check-in instead of on a settings
   * page nobody visits, at the one moment it demonstrably matters: just before
   * a plan gets built out of it.
   *
   * Strictly ONE per check-in, whatever else is missing. A studio that skipped
   * three questions during setup skipped them for a reason, and re-running the
   * interview a week later — inside the conversation they came here to have —
   * is the same mistake with a delay on it. The rest keep waiting; there is a
   * check-in every week. */
  gapAsk: 'One thing I still don\'t know, and it changes what I\'d plan — {question}',
  gapAck: 'That helps. Saved to your Brand profile.',
  gapSkipAck: 'No problem — I\'ll plan without it.',

  /* ── how far ahead to plan — the last question, asked once everything else
   * is settled. It comes here rather than at the start because it is a
   * question about effort, and effort is easier to judge when you already
   * know what the plan is going to be about. ── */
  periodQ: 'How far ahead should I plan?',
  /* No explanation under the question (Leon, July 30): the three answers say what
   * they are, and the acknowledgement after each one carries the caveat. */
  periodWeek: 'One week',
  periodTwo: 'Two weeks',
  periodMonth: 'One month',
  periodAckWeek: 'A week it is.',
  periodAckTwo: 'Two weeks, then — both built on what I know today.',
  /* honest about what a month actually is here — four weeks of the same
   * structure, not four times the certainty */
  periodAckMonth: 'A month, then — four weeks from what I know today. You\'ll probably want to replan the later ones once it\'s running.',

  /* closing line before generation. Check-in always builds the rest of the month. */
  ready: 'That\'s everything I need. Building your plan now.',
  readyTwo: 'That\'s everything I need. Building your plan now.',
  readyMonth: 'That\'s everything I need. Building your plan now.',

  /* ── the weekly review — opens the check-in when a previous route had
   * published posts. Outcome question verbatim from the moat playbook;
   * belief updates use calibrated language, never percentages. ── */
  review: {
    /* end-of-week survey — a mandatory quick check while there's no Meta
     * Business connection to read it automatically. Two questions: what
     * actually published, and whether any real interest came in. */
    executedQ: 'Last week\'s done. Quick look at what actually went out — one post at a time.',
    /* the per-post review. Showing the post itself beats naming the day: people
     * remember what they published, not which weekday it sat on. */
    postQ: 'Did this one go out?',
    postChips: {
      posted: 'Posted it',
      edited: 'Posted, but I changed it',
      skipped: 'Didn\'t post it',
    },
    /* the outcomes, in the summary's own words */
    outcomeLabels: {
      posted: 'Posted as planned',
      edited: 'Posted with changes',
      skipped: 'Didn\'t go out',
    },
    summaryQ: 'Here\'s the week as you\'ve marked it.',
    summaryConfirm: 'That\'s right',
    summaryRedo: 'Let me redo it',
    executedConfirm: 'That\'s what I posted',
    executedAck: 'Got it — that\'s the real record for the week.',
    executedNoneAck: 'Nothing went out last week — that\'s useful too. Let\'s make this one easier to ship.',
    /* the nudge to remove this manual step by connecting Meta */
    metaNudge: 'Logging this by hand every week is friction I\'d rather remove. Connect Meta Business and I\'ll read what published on its own.',
    metaChips: {
      connect: 'Connect Meta Business',
      later: 'I\'ll keep logging for now',
    },
    metaConnectAck: 'Nice — I\'ll walk you through it from Settings after this. Once it\'s linked, this step disappears.',
    metaLaterAck: 'No problem — this quick check stays for now. You can connect Meta from Settings any time.',
    /* the outcome question — real business signal, calibrated */
    enquiryQ: 'Did you receive any relevant enquiry, call, or message this week?',
    enquiryChips: ['Yes', 'No', 'Not sure'],
    enquiryAck: {
      Yes: 'That\'s the point — enquiries follow proof. I\'ll weight this week toward what worked.',
      No: 'Normal. Some weeks plant, some weeks harvest. We keep building.',
      'Not sure': 'No worries — with Meta connected I can check that for you, so you don\'t have to guess.',
    },
    beliefEdited:
      'You rewrote {n} caption{s} in your own words last week. I\'m drafting this one closer to that voice.',
    beliefPublished:
      '{n} of {total} posts went out last week. The rhythm is holding — same cadence this week.',
    beliefQuiet:
      'Nothing went out last week. No guilt — this week starts from what we already know.',
  },
};
