/*
 * The check-in — a conversation, not a form.
 *
 * Not "the weekly check-in": how far ahead to plan is the last question it
 * asks, so for the whole conversation it doesn't know whether it is building a
 * week or a month (Leon, July 30).
 *
 * After the studio speaks, understanding decides the next turn — the same
 * Capture Conversation rules as Projects. At most one clarifying question,
 * and only when meaning is actually missing. Project and asset questions are
 * skipped when the turn already answered them. Strategy paths (pick a project
 * / let Bauhly decide) stay as menus; the scripted "which project / any photo
 * / anything else" chain is no longer automatic.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../brand/Icon';
import { Mark } from '../../brand/Logo';
import { AutoTextarea, useBodyScrollLock } from './ui';
import { RecordingSheet, useRecorder } from './recorder';
import { CHECKIN, PILLARS } from './checkinData';
import { useConversation } from './useConversation.js';
import ScrollJump from './ScrollJump.jsx';
import { understandCheckin, transcribeCapture, uploadFiles } from '../../api/projects';
import './checkin.css';

export default function Checkin({ projects, filingProjects, week, name, lastWeek, lastProjectId, hasPlanned, brandGaps = [], onFillGap, onGenerate, onCancel, cancelLabel = "Keep this week's route" }) {
  const { messages, typing, push, say, after } = useConversation();
  const [step, setStep] = useState('boot'); // which interactive block is live
  const ctx = useRef({
    path: null, projectId: null, projectName: null, custom: null, followup: 0,
    understanding: null, askedQuestion: '', askedAnswer: '',
    attachments: [], askForAssets: null,
  });
  const endRef = useRef(null);
  const threadRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  /* planning the week owns the screen, like onboarding and capture do. The nav
   * would invite the user to wander off mid-conversation and come back to a
   * half-answered plan — and "Keep this week's plan" is already the way out. */
  useEffect(() => {
    document.body.classList.add('is-immersive');
    return () => document.body.classList.remove('is-immersive');
  }, []);
  /* on steps that also offer chips, free text is opt-in ("Something else…") —
   * the field is never sitting there open by default */
  const [freeText, setFreeText] = useState(false);
  /* the same recorder the capture conversation uses — talking about the week is
   * easier than typing about it, and this question is the one people have the
   * most to say to (Leon, July 31) */
  const rec = useRecorder();
  /* a short "thinking" beat before a step's option cards/chips appear, so the
   * reveal feels like Bauhly deciding rather than a form popping in */
  const [optionsReady, setOptionsReady] = useState(false);

  const hasProjects = projects.length > 0;
  /* a first-time / low-data account that has never planned a week — the welcome
   * runs exactly once. Once a first week exists, the normal path takes over
   * (the same one growing / high-engagement accounts see). */
  const isNewUser = week?.confidence === 'low' && !hasPlanned;
  const firstName = (name || 'there').split(' ')[0];
  const focus = week?.focus ? PILLARS[week.focus] : null;

  /* projects ranked by how well they fit what people are talking about now */
  const RANK = { strong: 0, some: 1, weak: 2 };
  const rankedProjects = [...projects].sort(
    (a, b) => (RANK[a.trendMatch?.strength] ?? 3) - (RANK[b.trendMatch?.strength] ?? 3)
  );

  /* object URLs for uploaded photos — revoked on unmount */
  const urls = useRef([]);
  useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), []);

  /* keep the newest message in view — scrolling the tall tail into view lifts
   * the latest turn up the screen (ChatGPT-style) rather than pinning it to
   * the composer. Instant, not smooth (smooth is a no-op in the preview). */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, typing, step]);

  /* ── opening ── */
  useEffect(() => {
    if (lastWeek) {
      // end-of-week: the mandatory survey (what published) opens the flow
      const d = say(CHECKIN.review.executedQ);
      after(d, () => askPost(0));
    } else if (isNewUser) {
      // a short welcome, the focus and the question in one breath, then the
      // field itself — no "Let's start" button in front of it (Leon, July 30)
      const focusLabel = focus?.label || 'your foundation';
      const d = say([
        CHECKIN.newWelcome.replace('{name}', firstName),
        CHECKIN.newIdeaQ.replace('{focus}', focusLabel),
      ]);
      after(d, () => setStep('newIdea'));
    } else if (!hasPlanned) {
      /* arriving straight from onboarding: say what this is before asking, or
       * the question reads as one more setup step rather than the weekly habit
       * the whole product is built around */
      const d = say([...CHECKIN.firstWeekWelcome, CHECKIN.opening]);
      after(d, () => setStep('opening'));
    } else {
      const d = say(CHECKIN.opening);
      after(d, () => setStep('opening'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const userSays = (text) => push({ from: 'user', text });

  /* the field, opened as if the words had just been transcribed into it */
  const toWriting = (line) => {
    setStep('boot');
    setDraft('');
    const d = say(line);
    after(d, () => { keepField.current = true; setStep('opening'); });
  };
  /* whether the field on screen came from a recording — only then is "record it
   * again" a real answer */
  const fromVoice = useRef(false);
  const startRecording = () => {
    userSays(CHECKIN.recordChip);
    fromVoice.current = true;
    /* a second attempt after a refusal leaves the hook's status unchanged, so
     * the effect below never fires — this is the same dead end, caught early */
    if (rec.status === 'denied') { toWriting(CHECKIN.recordDenied); return; }
    rec.reset();
    rec.start();
    setStep('recording');
  };
  /* Voice notes are transcribed the same way Capture does — the field opens
   * with the words, not empty, so they can check them before sending. */
  useEffect(() => {
    if (step !== 'recording') return undefined;
    if (rec.status === 'denied') { toWriting(CHECKIN.recordDenied); return undefined; }
    if (rec.status !== 'done') return undefined;
    setStep('boot');
    const blob = rec.blob;
    (async () => {
      setBusy(true);
      try {
        if (blob) {
          const { text } = await transcribeCapture(blob);
          setDraft(text || '');
          const d = text
            ? say([CHECKIN.recordKept, CHECKIN.recordCheck])
            : say("I couldn't quite catch that — write it in, or record again.");
          after(d, () => {
            keepField.current = true;
            keepDraft.current = true;
            setStep('opening');
          });
        } else {
          toWriting(CHECKIN.recordDenied);
        }
      } catch {
        const d = say("I couldn't transcribe that — write it in, or record again.");
        after(d, () => { keepField.current = true; setStep('opening'); });
      } finally {
        setBusy(false);
      }
    })();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.status, step]);

  /* ── the end-of-week review ──
   * One post at a time, shown as the post: people remember what they published,
   * not which weekday it sat on. Each gets three honest outcomes — posted,
   * posted-but-changed, didn't. Then a summary to confirm before we plan. */
  const days = lastWeek?.days || [];
  const [reviewIdx, setReviewIdx] = useState(0);
  /* the index also lives in a ref: two quick taps land in the same React batch,
   * and a handler reading stale state would review the same post twice */
  const reviewIdxRef = useRef(0);
  const [outcomes, setOutcomes] = useState({}); // { [postId]: 'posted'|'edited'|'skipped' }
  const reviewPost = days[reviewIdx];

  const askPost = (i) => {
    reviewIdxRef.current = i;
    setReviewIdx(i);
    if (!days[i]) return;
    setStep('reviewPost');
  };

  const answerPost = (outcome) => {
    const i = reviewIdxRef.current;
    const post = days[i];
    if (!post) return;
    setStep('boot');
    setOutcomes((o) => ({ ...o, [post.id]: outcome }));
    userSays(`${post.day} — ${CHECKIN.review.outcomeLabels[outcome].toLowerCase()}`);
    const next = i + 1;
    if (next < days.length) {
      askPost(next);
    } else {
      const d = say(CHECKIN.review.summaryQ);
      after(d, () => setStep('reviewSummary'));
    }
  };

  /* the summary is a confirmation, not a second survey — one button out */
  const confirmSummary = () => {
    setStep('boot');
    const posted = days.filter((d) => outcomes[d.id] && outcomes[d.id] !== 'skipped');
    userSays(CHECKIN.review.summaryConfirm);
    ctx.current.executed = posted.map((d) => d.id);
    ctx.current.outcomes = outcomes;
    const d = say([
      posted.length ? CHECKIN.review.executedAck : CHECKIN.review.executedNoneAck,
      CHECKIN.review.metaNudge,
    ]);
    after(d, () => setStep('metaNudge'));
  };
  const redoSummary = () => {
    setStep('boot');
    userSays(CHECKIN.review.summaryRedo);
    setOutcomes({});
    askPost(0);
  };
  const answerMeta = (connect) => {
    setStep('boot');
    userSays(connect ? CHECKIN.review.metaChips.connect : CHECKIN.review.metaChips.later);
    ctx.current.metaConnect = connect;
    const d = say(connect ? CHECKIN.review.metaConnectAck : CHECKIN.review.metaLaterAck);
    after(d, askInquiry);
  };
  const askInquiry = () => {
    const d = say(CHECKIN.review.enquiryQ);
    after(d, () => setStep('inquiry'));
  };
  const answerInquiry = (val) => {
    setStep('boot');
    userSays(val);
    ctx.current.inquiry = val;
    // one belief update, then hand off to planning
    const n = lastWeek.editedPosts?.length || 0;
    const belief = n
      ? CHECKIN.review.beliefEdited.replace('{n}', n).replace('{s}', n > 1 ? 's' : '')
      : (ctx.current.executed || []).length
        ? CHECKIN.review.beliefPublished
            .replace('{n}', (ctx.current.executed || []).length)
            .replace('{total}', days.length)
        : CHECKIN.review.beliefQuiet;
    const d = say([CHECKIN.review.enquiryAck[val], { text: belief, kind: 'belief' }, CHECKIN.opening]);
    after(d, () => setStep('opening'));
  };

  /* ── first-time path — ask for one real idea or piece of work and build the
   * foundation week around it (the same "tell me what you're working on" move
   * the other flows make, framed for a fresh account) ── */
  /* the escape from the blank page: Bauhly starts from the profile himself,
   * rather than asking a user with no idea to pick how to find one */
  const noIdea = () => {
    setStep('boot');
    userSays(CHECKIN.newIdeaEscape);
    ctx.current.path = 'foundation';
    ctx.current.custom = 'the brand profile';
    /* the encouragement to keep feeding the week waits for the next question —
     * see CHECKIN.keepAdding */
    ctx.current.keepAdding = true;
    const d = say(CHECKIN.newIdeaEscapeQ);
    after(d, askGap);
  };

  const projectPayload = () => (projects || []).map((p) => ({ id: p.id, name: p.name }));
  const matchProjectInText = (text, list) => {
    const t = String(text || '').toLowerCase();
    if (!t) return null;
    const hits = (list || []).filter((p) => {
      const n = String(p.name || '').toLowerCase();
      return n.length >= 3 && t.includes(n);
    });
    return hits.length === 1 ? hits[0] : null;
  };
  const attachmentPayload = () =>
    (ctx.current.attachments || []).map((a) => ({ type: a.type, key: a.key }));

  const runUnderstand = async ({ alreadyAsked = false, askedQuestion = '', askedAnswer = '' } = {}) => {
    try {
      return await understandCheckin({
        text: ctx.current.custom || '',
        attachments: attachmentPayload(),
        projects: projectPayload(),
        alreadyAsked,
        askedQuestion,
        askedAnswer,
      });
    } catch {
      return {
        action: 'ready',
        question: null,
        ack: '',
        matchedProjectId: null,
        matchedProjectName: '',
        askForAssets: !(ctx.current.attachments || []).length,
        understanding: null,
      };
    }
  };

  const applyMatch = (result) => {
    if (ctx.current.projectId) return;
    const id = result?.matchedProjectId;
    const name = result?.matchedProjectName;
    const p = (projects || []).find((x) => x.id === id)
      || (projects || []).find((x) => name && x.name === name)
      || matchProjectInText(ctx.current.custom, projects);
    if (p) {
      ctx.current.projectId = p.id;
      ctx.current.projectName = p.name;
    } else if (name) {
      ctx.current.projectName = name;
    }
  };

  /* After understanding: skip questions the turn already answered. */
  const continueAfterIdea = (result) => {
    applyMatch(result);
    if (result?.askForAssets === false) ctx.current.askForAssets = false;
    else if (result?.askForAssets === true) ctx.current.askForAssets = true;

    const ack = (result?.ack || '').trim();
    const named = ctx.current.projectName;
    const preamble = ack
      || (named ? CHECKIN.matchedProjectAck.replace('{name}', named) : '');

    if (ctx.current.path === 'foundation' && !hasProjects) {
      const d = say(preamble || CHECKIN.newIdeaAck);
      after(d, askGap);
      return;
    }

    if (ctx.current.projectId || ctx.current.projectName) {
      afterProjectChosen(preamble);
      return;
    }
    if (hasProjects) {
      const d = say(preamble ? [preamble, CHECKIN.projectQuestion] : CHECKIN.projectQuestion);
      after(d, () => setStep('projectAsk'));
      return;
    }
    const d = say(preamble ? [preamble, CHECKIN.nameProjectQ] : CHECKIN.nameProjectQ);
    after(d, () => setPickerOpen('new'));
  };

  const afterUnderstood = (result) => {
    if (result?.understanding) ctx.current.understanding = result.understanding;
    if (result?.action === 'ask' && result.question) {
      ctx.current.askedQuestion = result.question;
      const d = say(result.question);
      after(d, () => setStep('clarify'));
      return false;
    }
    continueAfterIdea(result);
    return false;
  };

  const ingestIdea = async (text, { fromNewIdea = false } = {}) => {
    setStep('boot');
    userSays(text);
    ctx.current.path = fromNewIdea ? 'foundation' : 'custom';
    ctx.current.custom = text;
    setBusy(true);
    try {
      afterUnderstood(await runUnderstand());
    } catch {
      continueAfterIdea(null);
    } finally {
      setBusy(false);
    }
  };

  const submitClarify = async (answer) => {
    const text = (typeof answer === 'string' ? answer : draft).trim();
    if (!text) return;
    setDraft('');
    setStep('boot');
    userSays(text);
    ctx.current.askedAnswer = text;
    ctx.current.custom = [ctx.current.custom, text].filter(Boolean).join('\n\n');
    setBusy(true);
    try {
      const result = await runUnderstand({
        alreadyAsked: true,
        askedQuestion: ctx.current.askedQuestion,
        askedAnswer: text,
      });
      afterUnderstood({ ...result, action: 'ready', question: null });
    } catch {
      continueAfterIdea(null);
    } finally {
      setBusy(false);
    }
  };

  const skipClarify = async () => {
    setDraft('');
    setStep('boot');
    userSays(CHECKIN.clarifySkip);
    setBusy(true);
    try {
      const result = await runUnderstand({
        alreadyAsked: true,
        askedQuestion: ctx.current.askedQuestion,
        askedAnswer: '',
      });
      afterUnderstood({ ...result, action: 'ready', question: null });
    } catch {
      continueAfterIdea(null);
    } finally {
      setBusy(false);
    }
  };

  /* ── path selection ── */
  const chooseSuggestion = (sug) => {
    setStep('boot');
    userSays(sug.label);
    if (sug.id === 'projects') {
      ctx.current.path = 'projects';
      // Bauhly checks current conversations, then ranks the projects by fit
      const d = say([CHECKIN.projectTrendIntro, CHECKIN.projectTrendResult]);
      after(d, () => setStep('projectPick'));
    } else {
      // "let Bauhly plan" — offer a small menu of directions, not one proposal
      const d = say(CHECKIN.strategyIntro);
      after(d, () => setStep('strategy'));
    }
  };

  /* the "let Bauhly plan my strategy" menu */
  const pickStrategy = (opt) => {
    setStep('boot');
    userSays(opt.title);
    if (opt.id === 'trend-project') {
      ctx.current.path = 'projects';
      const d = say(CHECKIN.projectTrendResult);
      after(d, () => setStep('projectPick'));
    } else if (opt.id === 'compilation') {
      ctx.current.path = 'compilation';
      ctx.current.projectName = 'Portfolio week';
      const d = say(CHECKIN.compilationConfirm);
      after(d, askImage);
    } else {
      // a trending topic — the honest experiment flow
      const d = say(CHECKIN.experimentIntro);
      after(d, () => setStep('experimentPick'));
    }
  };


  const pickProject = (p) => {
    setStep('boot');
    userSays(p.name);
    ctx.current.projectId = p.id;
    ctx.current.projectName = p.name;
    if (!ctx.current.path) ctx.current.path = 'projects';
    const d = say(CHECKIN.projectConfirm.replace('{name}', p.name));
    after(d, afterProjectChosen);
  };

  /* ── the honest experiment path — when the work doesn't match the moment,
   * pivot to a low-competition topic and treat it as a watched experiment ── */
  const chooseExperiment = () => {
    setStep('boot');
    userSays(CHECKIN.experimentChip);
    const d = say(CHECKIN.experimentIntro);
    after(d, () => setStep('experimentPick'));
  };
  const pickExperiment = (topic) => {
    setStep('boot');
    userSays(topic.title);
    /* the angle comes OUT of a project on file (Leon, July 30) — so the week is
     * filed under it and its photographs are already there, which is why the next
     * question offers to reuse them instead of asking for an upload */
    const proj = projects.find((p) => p.id === topic.project);
    ctx.current.path = 'experiment';
    ctx.current.projectId = proj?.id || null;
    ctx.current.projectName = proj?.name || topic.title;
    ctx.current.experiment = topic.id;
    const d = say(
      CHECKIN.experimentConfirm
        .replace('{title}', topic.title)
        .replace('{name}', proj?.name || 'what you have'),
    );
    // Bauhly already knows the project — no "what's changed", straight to material
    after(d, askImage);
  };

  const answerPropose = (kind) => {
    if (kind === 'confirm') {
      setStep('boot');
      userSays(CHECKIN.proposeChips.confirm);
      afterProjectChosen();
    } else if (kind === 'directions') {
      setStep('boot');
      userSays(CHECKIN.proposeChips.directions);
      const d = say(CHECKIN.directionsIntro);
      after(d, () => setStep('directions'));
    } else {
      setStep('boot');
      userSays(CHECKIN.proposeChips.otherProject);
      const d = say(CHECKIN.projectTrendResult);
      after(d, () => setStep('projectPick'));
    }
  };

  const pickDirection = (dir) => {
    setStep('boot');
    userSays(dir.title);
    const proj = projects.find((p) => p.id === dir.project);
    ctx.current.path = 'projects';
    ctx.current.projectId = proj?.id || null;
    ctx.current.projectName = proj?.name || dir.title;
    const d = say(CHECKIN.directionPicked.replace('{title}', dir.title));
    after(d, afterProjectChosen);
  };

  /* ── after a project is chosen: value-add questions only when they would
   * change the plan. Understanding already skipped anything the studio answered. ── */
  const afterProjectChosen = (preamble) => {
    const hasFiles = ctx.current.hasUpload || (ctx.current.attachments || []).length > 0;
    const skipAsset = ctx.current.askForAssets === false || hasFiles;
    const lead = typeof preamble === 'string' && preamble.trim() ? preamble.trim() : '';
    if (skipAsset) {
      if (ctx.current.projectId) ctx.current.reuseImages = true;
      const lines = [];
      if (lead) lines.push(lead);
      lines.push(CHECKIN.moreQ);
      const d = say(lines);
      after(d, () => setStep('more'));
      return;
    }
    if (ctx.current.projectId) {
      const d = say(lead ? [lead, CHECKIN.assetQuestion] : CHECKIN.assetQuestion);
      after(d, () => setStep('asset'));
    } else {
      const d = say(lead ? [lead, CHECKIN.imageQuestionNew] : CHECKIN.imageQuestionNew);
      after(d, () => setStep('image'));
    }
  };

  /* ── the material step — what raw references exist to build the visuals from.
   * Grounds the week in real assets before the reuse/upload/none image ask. ── */
  /* The only answer that lands here is "Nothing yet" — a file goes through
   * handleUpload, which asks what it is and then moves on.
   *
   * "Photos next — I can use this project's own shots" used to follow (Leon,
   * July 31). Asked straight after "anything to support this? / nothing yet" it
   * is the same question twice, so the answer it was fishing for is simply
   * taken: a project on file has photographs, and Bauhly says it is using
   * them. */
  const answerAsset = (label) => {
    setStep('boot');
    userSays(label);
    const own = Boolean(ctx.current.projectId) || ctx.current.path === 'compilation';
    if (own) ctx.current.reuseImages = true;
    const d = say(own
      ? CHECKIN.assetAckOwn.replace('{name}', ctx.current.projectName || 'this project')
      : CHECKIN.assetAckNone);
    after(d, own ? showPlanPreview : askImage);
  };

  /* ── the image question — asked in conversation. At least one real photo is
   * required: reuse the project's shots, or upload one (an inline file input
   * appears). There's no "skip" — the photo is the source for the whole week. ── */
  // reuse makes sense when there's project material to draw on — an existing
  // project, or a portfolio compilation across past projects
  const canReuseImages = () => Boolean(ctx.current.projectId) || ctx.current.path === 'compilation';
  const askImage = () => {
    const d = say(canReuseImages() ? CHECKIN.imageQuestion : CHECKIN.imageQuestionNew);
    after(d, () => setStep('image'));
  };
  const answerImage = (kind) => {
    setStep('boot');
    if (kind === 'none' || kind === 'skip') {
      userSays(kind === 'skip' ? CHECKIN.imageChips.skip : CHECKIN.imageChips.none);
      const d = say(kind === 'skip' ? CHECKIN.imageSkipAck : CHECKIN.imageNoneAck);
      after(d, showPlanPreview);
      return;
    }
    if (kind === 'reuse') {
      userSays(CHECKIN.imageChips.reuse);
      ctx.current.reuseImages = true;
      const d = say(CHECKIN.imageReuseAck.replace('{name}', ctx.current.projectName || 'this project'));
      after(d, showPlanPreview);
    } else {
      userSays(CHECKIN.imageChips.upload);
      const d = say(CHECKIN.uploadPrompt);
      after(d, () => setStep('upload'));
    }
  };

  /* the generate gate — instead of previewing the week, ask for a clear
   * go-ahead (image generation uses tokens), with the option to build just the
   * plan without images */
  /* One more door before the gate (Leon, July 31): whatever the studio answered
   * about material, the moment before a plan is built is the moment they
   * remember the other photo. Answering it is one tap, and adding something
   * comes back here — the same loop the capture conversation runs. */
  const showPlanPreview = () => {
    const d = say(CHECKIN.moreQ);
    after(d, () => setStep('more'));
  };
  /* The credits question is gone (Leon, July 31). "Your real photos come first —
   * I never invent rooms or results", then a question about recropping, then two
   * chips, arrived one answer before the plan and re-litigated a decision the
   * studio makes in Settings. Going ahead is now the second answer to the
   * question already on screen. */
  /* not everything worth adding is a file — a line about what the client wants
   * kept quiet, or what happened on site, belongs here too */
  const askMoreNote = () => {
    setStep('boot');
    userSays(CHECKIN.moreNote);
    const d = say(CHECKIN.moreNoteQ);
    after(d, () => setStep('moreNote'));
  };
  const answerMoreNote = (text) => {
    setStep('boot');
    setDraft('');
    if (text) {
      ctx.current.notes = [...(ctx.current.notes || []), text];
      userSays(text);
    } else {
      userSays(CHECKIN.uploadNoteSkip);
    }
    showPlanPreview();
  };

  const answerMore = () => {
    setStep('boot');
    ctx.current.skipImages = false;
    userSays(CHECKIN.moreDone);
    askFiling();
  };

  /* ── filing — the last question ──
   *
   * Every week ends up under a project: that is how the work is found again
   * months later, and Projects is where the captures live that the next week is
   * planned from. It used to be asked only on the paths that happened to start
   * from a project; on the others the week was filed under nothing.
   *
   * Asked at the END, because by now the conversation has decided what the week
   * is about — so the answer is obvious and usually one tap on the default. */
  const [filingSel, setFilingSel] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /* the one project the "which project is this?" question offers — the last one
   * planned, or the first on file, until the studio changes it */
  const [askProject, setAskProject] = useState(null);
  /* newest first.
   *
   * A project you made minutes ago is the one this week most likely belongs to;
   * the one from eight months back is the one you scroll past. `createdAt` is
   * the honest order — `updatedAt` would reshuffle the list every time a note
   * was added, so the position of a project would change for reasons that have
   * nothing to do with what you are filing now. */
  const filingList = useMemo(
    () => [...(filingProjects || projects)].sort(
      (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    ),
    [filingProjects, projects],
  );
  const askFiling = () => {
    /* Asked once (Leon, July 31). On any path that already named a project —
     * the opening question, a direction card, an experiment angle — the plan is
     * filed under it and asking again at the end is the same question a second
     * time, with the answer already given. */
    if (ctx.current.projectId || ctx.current.projectName) {
      setFilingSel(ctx.current.projectId || 'ASKED');
      askGap();
      return;
    }
    /* pre-select what the week is already about: the project this conversation
     * chose, else the one last week was filed under. Most weeks continue the
     * work of the one before. */
    const preset = (filingList.some((p) => p.id === ctx.current.projectId) ? ctx.current.projectId : null)
      || (filingList.some((p) => p.id === lastProjectId) ? lastProjectId : filingList[0]?.id)
      || null;
    setFilingSel(preset);
    if (!filingList.length) setFilingSel('ASKED');
    const d = say(filingList.length ? CHECKIN.filingQ : CHECKIN.filingQOne);
    after(d, () => (filingList.length ? setStep('filing') : setPickerOpen('new')));
  };
  const confirmFiling = () => {
    const p = filingList.find((x) => x.id === filingSel);
    if (!p) return;
    setStep('boot');
    userSays(p.name);
    ctx.current.projectId = p.id;
    ctx.current.projectName = p.name;
    const d = say(CHECKIN.filingAck.replace('{name}', p.name));
    after(d, askGap);
  };
  /* Bauhly names it — and says the name, so nothing is filed somewhere the user
   * can't picture. It comes from what the conversation was actually about. */
  const autoName = () => {
    const c = ctx.current;
    const from = c.custom || c.projectName;
    if (from) return from.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
    /* the pillar name used to be the fallback project name ("Trust week"), which
     * is our vocabulary and now reads as a sentence besides — see PILLARS.label */
    return 'This week\'s plan';
  };
  const fileAuto = () => {
    setStep('boot');
    userSays(CHECKIN.filingUnsure);
    const nm = autoName();
    ctx.current.projectId = null;
    ctx.current.projectName = nm;
    const d = say(CHECKIN.filingAuto.replace('{name}', nm));
    after(d, askGap);
  };


  /* No format question.
   *
   * "Any formats you want more or less of this week?" was the last thing asked
   * before every single week, and it asked the user to art-direct the mix — the
   * one part of the plan Bauhly is supposed to have reasoned about from the
   * pillar it is strengthening and what the format data says. A preference
   * expressed once a week, every week, is a setting; the ones that are genuinely
   * standing (which formats exist at all) now live in Brand profile. So the
   * conversation ends where it has something to say, and generates. */

  /* ── typed input — the opening idea, a project name, or a value-add answer ── */
  const submitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    if (step === 'photoNote') {
      answerPhotoNote(text);
    } else if (step === 'moreNote') {
      answerMoreNote(text);
    } else if (step === 'newIdea') {
      ingestIdea(text, { fromNewIdea: true });
    } else if (step === 'opening') {
      fromVoice.current = false;
      ingestIdea(text);
    } else if (step === 'clarify') {
      submitClarify(text);
    } else if (step === 'gap') {
      answerGap(text);
    }
  };

  /* photo upload — a real file to S3, then a note about what it is */
  const handleUpload = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const preview = URL.createObjectURL(files[0]);
    urls.current.push(preview);
    setStep('boot');
    setBusy(true);
    try {
      const added = await uploadFiles(files);
      ctx.current.attachments = [...(ctx.current.attachments || []), ...added];
      ctx.current.hasUpload = true;
      push({ from: 'user', image: added[0]?.url || preview });
      const d = say([CHECKIN.uploadAck, CHECKIN.uploadNoteQ]);
      after(d, () => setStep('photoNote'));
    } catch {
      const d = say("That upload didn't go through — want to try again?");
      after(d, () => setStep('more'));
    } finally {
      setBusy(false);
    }
  };

  const fromOpeningFiles = async (files) => {
    const arr = [...files];
    if (!arr.length) return;
    setStep('boot');
    userSays(CHECKIN.uploadOpening);
    setBusy(true);
    try {
      const added = await uploadFiles(arr);
      ctx.current.path = 'custom';
      ctx.current.attachments = [...(ctx.current.attachments || []), ...added];
      ctx.current.hasUpload = true;
      push({ from: 'user', image: added[0]?.url });
      afterUnderstood(await runUnderstand());
    } catch {
      const d = say("That upload didn't go through — want to try again?");
      after(d, () => setStep('opening'));
    } finally {
      setBusy(false);
    }
  };

  /* the note that belongs to the photo just uploaded; skipping keeps the photo */
  const answerPhotoNote = (text) => {
    setStep('boot');
    if (text) {
      ctx.current.uploadNote = text;
      userSays(text);
    } else {
      userSays(CHECKIN.uploadNoteSkip);
    }
    /* no acknowledgement either way — the next question is right there, and a
     * line saying "noted" before it is a turn nobody asked for */
    showPlanPreview();
  };

  const answerProjectAsk = (p) => {
    if (p === 'new') {
      /* naming happens in the picker, which is where every other new project in
       * this conversation is made (Leon, July 31) — a naming field in the thread
       * was a second place to do one thing */
      setPickerOpen('new');
    } else {
      ctx.current.projectId = p.id;
      ctx.current.projectName = p.name;
      setStep('boot');
      userSays(p.name);
      afterProjectChosen();
    }
  };

  /* ── the one fact onboarding never got ──
   * Asked here rather than anywhere else because here is where it visibly
   * matters: the next thing that happens is a plan built out of it. One per
   * check-in, no matter how many are missing — see CHECKIN.gapAsk. */
  /* one line that owes itself to the previous step, said here so it doesn't arrive
   * as a second paragraph of the same turn (see CHECKIN.keepAdding) */
  const withPending = (lines) => {
    if (!ctx.current.keepAdding) return lines;
    ctx.current.keepAdding = false;
    return [CHECKIN.keepAdding, ...lines];
  };
  const askGap = () => {
    const gap = brandGaps[0];
    if (!gap || ctx.current.gapAsked) { askPeriod(); return; }
    ctx.current.gapAsked = true;
    setStep('boot');
    const q = gap.question.charAt(0).toLowerCase() + gap.question.slice(1);
    const d = say(withPending([CHECKIN.gapAsk.replace('{question}', q)]));
    after(d, () => setStep('gap'));
  };
  const answerGap = (text) => {
    const gap = brandGaps[0];
    setStep('boot');
    userSays(text);
    onFillGap?.(gap.key, text);
    const d = say(CHECKIN.gapAck);
    after(d, askPeriod);
  };
  const skipGap = () => {
    setStep('boot');
    userSays('Skip for now');
    const d = say(CHECKIN.gapSkipAck);
    after(d, askPeriod);
  };

  /* ── generate ──
   * No "how far ahead" question. The planner fills the next empty future
   * dates from what this check-in just filed — the conversation ends, then
   * the month plan runs on its own. */
  const askPeriod = () => {
    ctx.current.period = 'month';
    generate();
  };

  const generate = () => {
    setStep('boot');
    ctx.current.period = ctx.current.period || 'month';
    const d = say(CHECKIN.readyMonth);
    after(d + 700, () => {
      const c = ctx.current;
      onGenerate({
        routeChoice:
          c.path === 'custom' ? `custom:${c.custom}` : c.projectId ? `project:${c.projectId}` : 'auto',
        /* a real project id or nothing. It used to fall back to
         * `c.projectName`, which on the compilation path is the invented string
         * "Portfolio week" — so the rest of the app then said "your Portfolio
         * week" about something the user has never seen in Projects. */
        project: c.projectId || null,
        /* a project the user named (or let Bauhly name) doesn't exist yet.
         * Passing the name up is what lets `YourWeek` create it and file the
         * week under a real id — without this the week was "filed" under a
         * label nothing could find, which is the whole thing this step is for. */
        newProject: c.projectId ? null : (c.projectName || null),
        projectLabel: c.projectName || c.custom,
        hasUpload: !!c.hasUpload,
        reuseImages: !!c.reuseImages,
        skipImages: !!c.skipImages,
        period: c.period || 'month',
        custom: c.custom || null,
        notes: [...(c.uploadNote ? [c.uploadNote] : []), ...(c.notes || [])],
        attachments: c.attachments || [],
        understanding: c.understanding || null,
      });
    });
  };

  /* a step's free-text field — rendered inside the thread, only when that step
   * actually needs typing. Every step change closes it again. */
  /* every step change closes the field — except the one that IS the field: a
   * finished (or refused) recording lands the studio in it, so `keepField` says
   * so across the step change rather than fighting this effect with a timer */
  const keepField = useRef(false);
  const keepDraft = useRef(false);
  useEffect(() => {
    setFreeText(keepField.current);
    keepField.current = false;
    if (!keepDraft.current) setDraft('');
    keepDraft.current = false;
  }, [step]);
  const placeholder =
    step === 'moreNote' ? CHECKIN.moreNotePlaceholder
    : step === 'photoNote' ? CHECKIN.uploadNotePlaceholder
    : step === 'newIdea' ? CHECKIN.newIdeaPlaceholder
    : step === 'gap' ? (brandGaps[0]?.placeholder || 'In your own words…')
    : step === 'clarify' ? CHECKIN.clarifyPlaceholder
    : step === 'opening' ? CHECKIN.inputPlaceholder
    : 'Type your answer…';
  /* `alongside` is for a way past the question — it belongs beside the send
   * button, as the other half of one decision, not stacked under the field as a
   * third thing to weigh. Same shape as the onboarding conversation. */
  const textField = (label = 'Send', alongside = null) => (
    <div className="cvtype">
      <AutoTextarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        minHeight={88}
        autoFocus
        placeholder={placeholder}
        aria-label="Your answer"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || step === 'clarify')) {
            e.preventDefault();
            submitDraft();
          }
        }}
      />
      <div className="cvtype__acts">
        <button className="ck-chip ck-chip--primary cvtype__send" disabled={!draft.trim()} onClick={submitDraft}>
          <Icon name="arrow-up-right" size={14} /> {label}
        </button>
        {alongside}
      </div>
    </div>
  );
  const backToChips = (
    <button className="btn btn--quiet btn--sm" onClick={() => { setFreeText(false); setDraft(''); }}>
      Back to the answers
    </button>
  );

  /* Not an escape hatch — the answer we actually want.
   *
   * It was the quiet ghost chip next to a bordered "Nothing new — you decide",
   * which had the emphasis exactly backwards: the option that gives Bauhly
   * nothing to work with looked like the real button, and the one that gives it
   * a week's worth of material looked like a footnote. A plan built from what
   * happened in the studio beats one built from an account scan every time, so
   * this is the primary chip and it is listed first. */
  /* Neither of these is the recommended answer.
   *
   * "I'll write my own answer" was a filled orange primary, which made typing
   * look like the thing Bauhly wanted — when the honest position is that both
   * are fine and the user knows which they are. So: bordered secondary for
   * writing your own, borderless tertiary for handing it over (Leon, July 29). */
  const somethingElse = (
    <button className="ck-chip" onClick={() => setFreeText(true)}>
      I'll write my own answer
    </button>
  );

  /* the current step's controls — rendered in the action zone above the
   * composer (not inline in the thread), so the conversation stays the focus */
  const renderActions = () => {
    switch (step) {
      /* the field is the step, with one way past it: a new account is exactly
       * the account least likely to have an idea ready, and this question used
       * to be the only door out of the first week */
      case 'newIdea':
        return textField(
          'That’s it',
          <button className="btn btn--quiet btn--sm" onClick={noIdea}>
            {CHECKIN.newIdeaEscape}
          </button>,
        );
      case 'clarify':
        return textField(
          'Answer',
          <button className="btn btn--quiet btn--sm" onClick={skipClarify}>
            {CHECKIN.clarifySkip}
          </button>,
        );
      /* naming is not a wall (Leon, July 30): a blank field and one button meant a
        * studio who hadn't decided on a name couldn't finish the check-in. Bauhly
        * will name it from what the conversation was about, and if there are older
        * projects on file, one of those can take it instead. */
      /* the same shape as the photo's note: type it, or say there is nothing */
      case 'moreNote':
        return textField(
          'Add it',
          <button className="btn btn--quiet btn--sm" onClick={() => answerMoreNote('')}>
            {CHECKIN.uploadNoteSkip}
          </button>,
        );
      /* the photo is already in — the words are the optional half */
      case 'photoNote':
        return textField(
          'Add it',
          <button className="btn btn--quiet btn--sm" onClick={() => answerPhotoNote('')}>
            {CHECKIN.uploadNoteSkip}
          </button>,
        );
      /* one post, shown as the post — deliberately stripped back: the image,
       * the day, the caption's first line, and the three answers. Anything
       * more would turn a quick review into another editing screen. */
      case 'reviewPost': {
        if (!reviewPost) return null;
        return (
          <div className="ck-review">
            {/* the whole post, as it went out — you can't honestly answer "did
              * this go out?" from a thumbnail and a day name */}
            <div className="ck-post">
              <div className="ck-post__head">
                <span className="ck-post__day">
                  <b>{reviewPost.day}</b>
                  <span>{reviewPost.date}</span>
                </span>
                <span className="ck-post__type">{reviewPost.type} · {reviewPost.format}</span>
                <span className="ck-post__count">{reviewIdx + 1}/{days.length}</span>
              </div>
              <div className="ck-post__media">
                {reviewPost.image ? (
                  <img src={reviewPost.image} alt="" loading="lazy" />
                ) : (
                  <span className="ck-review__art" aria-hidden="true" />
                )}
                {reviewPost.cover && <span className="ck-post__cover">{reviewPost.cover}</span>}
              </div>
              <p className="ck-post__caption">{reviewPost.caption}</p>
            </div>
            <div className="ck-review__acts">
              <button className="btn btn--primary btn--sm" onClick={() => answerPost('posted')}>
                {CHECKIN.review.postChips.posted}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => answerPost('edited')}>
                {CHECKIN.review.postChips.edited}
              </button>
              <button className="btn btn--quiet btn--sm" onClick={() => answerPost('skipped')}>
                {CHECKIN.review.postChips.skipped}
              </button>
            </div>
          </div>
        );
      }
      /* the summary — a read-back, not a second survey */
      case 'reviewSummary':
        return (
          <div className="ck-review">
            <ul className="ck-sum">
              {days.map((d) => {
                const o = outcomes[d.id] || 'skipped';
                return (
                  <li key={d.id} className={`ck-sum__row is-${o}`}>
                    <Icon name={o === 'skipped' ? 'x' : 'check'} size={14} strokeWidth={2.5} />
                    <b>{d.day}</b>
                    <span>{CHECKIN.review.outcomeLabels[o]}</span>
                  </li>
                );
              })}
            </ul>
            <div className="ck-review__acts">
              <button className="btn btn--primary btn--sm" onClick={confirmSummary}>
                {CHECKIN.review.summaryConfirm}
              </button>
              <button className="btn btn--quiet btn--sm" onClick={redoSummary}>
                {CHECKIN.review.summaryRedo}
              </button>
            </div>
          </div>
        );
      case 'metaNudge':
        return (
          <>
            <button className="ck-chip ck-chip--primary" onClick={() => answerMeta(true)}>
              <Icon name="instagram" size={14} />
              {CHECKIN.review.metaChips.connect}
            </button>
            <button className="ck-chip" onClick={() => answerMeta(false)}>{CHECKIN.review.metaChips.later}</button>
          </>
        );
      case 'inquiry':
        return CHECKIN.review.enquiryChips.map((c) => (
          <button key={c} className="ck-chip" onClick={() => answerInquiry(c)}>{c}</button>
        ));
      /* the missing fact — a field, and the same honest way past it that
       * onboarding offered. Answering writes it to the Brand profile. */
      case 'gap':
        return textField(
          'Save it',
          <button className="btn btn--quiet btn--sm" onClick={skipGap}>Skip for now</button>,
        );
      case 'opening':
        /* the way past the field is the ANSWER it replaced (Leon, July 31), not
         * a door back to a list of one: "Back to the answers" led to a single
         * chip, which is a step to reach a step */
        if (freeText) {
          const auto = CHECKIN.suggestions.find((sug) => sug.id === 'auto');
          return textField(
            'Send',
            <>
              {/* a machine's guess at what was said is worth a second take */}
              {fromVoice.current && (
                <button className="btn btn--quiet btn--sm" onClick={startRecording}>
                  {CHECKIN.recordAgain}
                </button>
              )}
              {auto && (
                <button
                  className="btn btn--quiet btn--sm"
                  onClick={() => { setFreeText(false); setDraft(''); chooseSuggestion(auto); }}
                >
                  {auto.label}
                </button>
              )}
            </>,
          );
        }
        return (
          <>
            {somethingElse}
            {/* the second way to answer the same question, offered beside it:
              * a studio with its hands full talks rather than types */}
            <button className="ck-chip" onClick={startRecording}>
              <Icon name="pulse" size={14} />
              {CHECKIN.recordChip}
            </button>
            <label className="ck-chip">
              <input
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={(e) => { if (e.target.files?.length) fromOpeningFiles(e.target.files); e.target.value = ''; }}
              />
              <Icon name="attach" size={14} />
              {CHECKIN.uploadOpening}
            </label>
            {/* the fallback, and it looks like one: handing the week over is a
              * real answer, it is just never the better one. Bordered rather
              * than borderless — beside a filled primary a ghost read as barely
              * offered, and this IS offered; it just isn't recommended. */}
            {CHECKIN.suggestions
              .filter((sug) => !sug.needsProjects || hasProjects)
              .map((sug) => (
                <button key={sug.id} className="ck-chip ck-chip--quiet" onClick={() => chooseSuggestion(sug)}>
                  <Icon name={sug.icon} size={14} />
                  {sug.label}
                </button>
              ))}
          </>
        );
      case 'projectPick':
        return (
          <div className="ck-stack">
            <div className="ck-cards">
              {/* recommend at most two — the projects that best fit what people
               * are talking about now; a third would dilute the signal */}
              {rankedProjects.slice(0, 2).map((p, i) => (
                <button key={p.id} className={`ck-card ${i === 0 && p.trendMatch?.strength === 'strong' ? 'is-best' : ''}`} onClick={() => pickProject(p)}>
                  <span className="ck-card__top">
                    <b>{p.name}</b>
                    {i === 0 && p.trendMatch?.strength === 'strong' ? (
                      <span className="ck-card__best">{CHECKIN.projectBestTag}</span>
                    ) : (
                      <span className={`ck-card__status ${p.status === 'In progress' ? 'is-live' : ''}`}>{p.status}</span>
                    )}
                  </span>
                  {p.trendMatch && (
                    <span className="ck-card__trend">
                      <Icon name="pulse" size={12} />
                      {p.trendMatch.line}
                    </span>
                  )}
                  <span className="ck-card__assets">
                    <Icon name="bookmark" size={12} />
                    {p.assets.join(' · ')}
                  </span>
                </button>
              ))}
            </div>
            {/* the honest alternative — none of these have to fit the moment */}
            {/* a real alternative, drawn as one (Leon, July 30): as a borderless
              * ghost it read as a footnote under the two project cards */}
            <button className="btn btn--tertiary btn--sm" onClick={chooseExperiment}>
              <Icon name="pulse" size={14} />
              {CHECKIN.experimentChip}
            </button>
          </div>
        );
      case 'strategy':
        return (
          <div className="ck-cards">
            {CHECKIN.strategyOptions.map((o) => (
              <button key={o.id} className="ck-card ck-card--illus" onClick={() => pickStrategy(o)}>
                {/* one drawn mark per card. Three cards of identical text are
                  * three paragraphs to read before choosing; with a mark each,
                  * they are told apart at a glance and read second. */}
                <span className="ck-card__ico" aria-hidden="true"><Icon name={o.icon || 'sparkle'} size={20} strokeWidth={1.9} /></span>
                <span className="ck-card__top"><b>{o.title}</b></span>
                <span className="ck-card__line">{o.line}</span>
              </button>
            ))}
          </div>
        );
      case 'experimentPick':
        return (
          <div className="ck-cards">
            <span className="ck-cards__label">{CHECKIN.experimentLabel}</span>
            {CHECKIN.experimentTopics.map((t) => (
              <button key={t.id} className="ck-card" onClick={() => pickExperiment(t)}>
                <span className="ck-card__top"><b>{t.title}</b></span>
                <span className="ck-card__line">{t.line}</span>
              </button>
            ))}
          </div>
        );
      case 'propose':
        if (freeText) return textField('Send', backToChips);
        return (
          <>
            <button className="ck-chip ck-chip--primary" onClick={() => answerPropose('confirm')}>{CHECKIN.proposeChips.confirm}</button>
            {hasProjects && (
              <>
                <button className="ck-chip" onClick={() => answerPropose('directions')}>{CHECKIN.proposeChips.directions}</button>
                <button className="ck-chip" onClick={() => answerPropose('other')}>{CHECKIN.proposeChips.otherProject}</button>
              </>
            )}
            {/* an account with no projects had ONE button here — agreeing was the
              * only way on, which is not a proposal, it is a notice */}
            {!hasProjects && somethingElse}
          </>
        );
      case 'directions':
        return (
          <div className="ck-cards">
            {CHECKIN.directions.map((dir) => (
              <button key={dir.id} className="ck-card" onClick={() => pickDirection(dir)}>
                <span className="ck-card__top"><b>{dir.title}</b></span>
                <span className="ck-card__line">{dir.goalFit}</span>
                <span className="ck-card__line ck-card__line--soft">{dir.audienceWhy}</span>
                <span className="ck-card__assets"><Icon name="bookmark" size={12} />{dir.asset}</span>
              </button>
            ))}
          </div>
        );
      /* No chips (Leon, July 31). Four guesses at what changed on a project
        * Bauhly cannot see is four wrong answers and one field hidden behind
        * "Something else" — what changed is the one thing only the studio knows,
        * so the field IS the question. */
      /* nothing in the answer row: recording owns the screen (see RecordingSheet) */
      case 'recording':
        return null;
      /* the last chance to hand something over, and the loop back into it */
      case 'more':
        return (
          <>
            <label className="ck-chip">
              <input type="file" accept="image/*" hidden onChange={handleUpload} />
              <Icon name="attach" size={14} />
              {CHECKIN.moreUpload}
            </label>
            <button className="ck-chip" onClick={askMoreNote}>{CHECKIN.moreNote}</button>
            <button className="ck-chip" onClick={answerMore}>{CHECKIN.moreDone}</button>
          </>
        );
      /* Hand it over, or say there isn't one (Leon, July 31). Naming what KIND
        * of material exists was a survey: Bauhly never saw the floor plan, so
        * the answer changed nothing about the week. */
      case 'asset':
        return (
          <>
            {/* a label, but the same chip as the answer beside it — it is one of
              * two answers to one question, not a different kind of control */}
            <label className="ck-chip">
              <input type="file" accept="image/*" hidden onChange={handleUpload} />
              <Icon name="attach" size={14} />
              {CHECKIN.assetUpload}
            </label>
            <button className="ck-chip" onClick={() => answerAsset(CHECKIN.assetNone)}>{CHECKIN.assetNone}</button>
          </>
        );
      case 'image': {
        // when Bauhly already has the material (existing project or portfolio
        // compilation) reuse is the only option — asking to upload would be
        // misleading. Only a from-scratch path (no material) shows upload.
        return canReuseImages() ? (
          <>
            <button className="ck-chip" onClick={() => answerImage('reuse')}>
              <Icon name="swatch" size={14} />
              {CHECKIN.imageChips.reuse}
            </button>
            {/* never one button on a turn — see imageSkipAck */}
            <button className="ck-chip" onClick={() => answerImage('skip')}>
              {CHECKIN.imageChips.skip}
            </button>
          </>
        ) : (
          <>
            <button className="ck-chip" onClick={() => answerImage('upload')}>
              <Icon name="attach" size={14} />
              {CHECKIN.imageChips.upload}
            </button>
            {/* nobody is stuck here for want of a photograph — see imageNoneAck */}
            <button className="ck-chip" onClick={() => answerImage('none')}>
              {CHECKIN.imageChips.none}
            </button>
          </>
        );
      }
      case 'upload':
        return (
          <>
            <label className="ck-upload">
              <input type="file" accept="image/*" hidden onChange={handleUpload} />
              <Icon name="attach" size={16} />
              Choose a photo to upload
            </label>
            {/* the file dialog is not the only way forward */}
            <button className="ck-chip" onClick={() => answerImage('skip')}>{CHECKIN.uploadSkip}</button>
          </>
        );
      /* ONE project, already chosen, exactly like the filing question at the
        * other end of the conversation (Leon, July 31) — same row, same
        * "Change", same pair of answers under it. A studio has one project it
        * is in this week; a list of all of them is a decision it doesn't need
        * to make twice. */
      case 'projectAsk': {
        const here = askProject
          || projects.find((p) => p.id === lastProjectId)
          || projects[0];
        return (
          <div className="ck-stack">
            <div className="ck-picked">
              <span className="ck-picked__ico" aria-hidden="true"><Icon name="plan" size={17} strokeWidth={2} /></span>
              <span className="ck-picked__body">
                <b>{here ? here.name : 'No project yet'}</b>
                {here && here.id === lastProjectId && <span className="ck-picked__tag">{CHECKIN.filingRecent}</span>}
              </span>
              <button className="btn btn--ghost btn--sm" onClick={() => setPickerOpen('ask')}>Change</button>
            </div>
            <div className="ck-file__alts">
              <button className="ck-chip ck-chip--primary" disabled={!here} onClick={() => answerProjectAsk(here)}>
                {CHECKIN.projectPickedApply}
              </button>
              <button className="btn btn--quiet btn--sm" onClick={() => answerProjectAsk('new')}>
                {CHECKIN.filingUnsure}
              </button>
            </div>
          </div>
        );
      }
      /* the projects, pre-selected, then the two ways out of the list. Radios
        * rather than chips: picking one is not an action, it is a choice you
        * confirm — and with a sensible default already selected, most weeks are
        * one tap on "File it there". */
      /* The whole project list, in a picker — not three radios in the chat.
       *
       * The list used to be printed into the conversation, which worked for a
       * studio with three projects and became a wall for one with twenty; and
       * "A new project" sat beside it as a third button rather than as part of
       * choosing. Now the thread shows the ONE project it has picked for you,
       * and "Change" opens the full list, where making a new one is the first
       * thing in it. */
      case 'filing': {
        const chosen = filingList.find((p) => p.id === filingSel);
        return (
          <div className="ck-stack">
            <div className="ck-picked">
              <span className="ck-picked__ico" aria-hidden="true"><Icon name="plan" size={17} strokeWidth={2} /></span>
              <span className="ck-picked__body">
                <b>{chosen ? chosen.name : 'No project yet'}</b>
                {chosen && chosen.id === lastProjectId && <span className="ck-picked__tag">{CHECKIN.filingRecent}</span>}
              </span>
              <button className="btn btn--ghost btn--sm" onClick={() => setPickerOpen(true)}>Change</button>
            </div>
            {/* one row, two answers — "You decide" sat UNDER the primary as if
              * it were a different kind of decision. It is the same decision,
              * answered differently, so it sits beside it, borderless. */}
            <div className="ck-file__alts">
              <button className="ck-chip ck-chip--primary" disabled={!filingSel} onClick={confirmFiling}>
                Save it here
              </button>
              <button className="btn btn--quiet btn--sm" onClick={fileAuto}>{CHECKIN.filingUnsure}</button>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  const actions = renderActions();
  const actionsAreCards =
    step === 'projectPick' || step === 'projectAsk' || step === 'directions'
    || step === 'experimentPick' || step === 'strategy'
    || step === 'reviewPost' || step === 'reviewSummary';
  /* every choice — and every text field — lives inside the conversation thread;
   * there is no docked composer */
  const actionsInThread = Boolean(actions);

  /* whenever a new in-thread step arrives, hold its options behind a brief
   * typing beat; opening quick actions above the input reveal immediately */
  useEffect(() => {
    if (!actionsInThread) { setOptionsReady(true); return; }
    setOptionsReady(false);
    const t = setTimeout(() => setOptionsReady(true), 620);
    return () => clearTimeout(t);
  }, [step, actionsInThread]);
  const thinkingForOptions = actionsInThread && !optionsReady && !typing;

  return (
    <div className="ck">
      {onCancel && (
        <button className="btn btn--quiet btn--sm ck__keep" onClick={onCancel}>
          <Icon name="arrow-left" size={15} />
          {cancelLabel}
        </button>
      )}

      <div className="ck__thread" aria-live="polite" ref={threadRef}>
        <div className="ck__intro">
          <span className="ck__intro-mark">
            <Mark size={30} />
          </span>
          <span className="eyebrow">Check-in</span>
        </div>

        {messages.map((m, i) =>
          m.from === 'user' ? (
            <div className="ck-turn ck-turn--user" key={m.id}>
              {m.image ? (
                <img className="ck-photo" src={m.image} alt="Uploaded reference" />
              ) : (
                <span className="ck-said">{m.text}</span>
              )}
            </div>
          ) : (
            /* consecutive Bauhly turns are one utterance, so only the first
             * carries the mark — a dot per line reads as separate speakers.
             * A belief card is its own statement, so it always keeps its mark. */
            <div
              className={`ck-turn ck-turn--bauhly ${m.kind === 'belief' ? 'ck-turn--belief' : ''} ${
                messages[i - 1]?.from === 'bauhly' && m.kind !== 'belief' ? 'ck-turn--cont' : ''
              }`}
              key={m.id}
            >
              {messages[i - 1]?.from === 'bauhly' && m.kind !== 'belief' ? (
                <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
              ) : (
                <span className="ck-avatar" aria-hidden="true">
                  <Mark size={15} />
                </span>
              )}
              <div className="ck-body">
                {m.kind === 'belief' && (
                  <span className="ck-belief-label">
                    <Icon name="pulse" size={12} /> What Bauhly is carrying forward
                  </span>
                )}
                {m.text}
                {/* the generation plan — a text preview of each day's asset,
                 * shown before any image is generated */}
                {m.plan && (
                  <ul className="ck-plan">
                    {m.plan.map((it) => (
                      <li className="ck-plan__item" key={it.day}>
                        <span className="ck-plan__day">{it.day}</span>
                        <span className="ck-plan__body">
                          <span className="ck-plan__label">{it.label}</span>
                          <span className="ck-plan__line">{it.line}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )
        )}

        {(typing || thinkingForOptions || busy) && (
          <div className="ck-turn ck-turn--bauhly">
            <span className="ck-avatar" aria-hidden="true">
              <Mark size={15} />
            </span>
            <div className="ck-typing" aria-label="Bauhly is thinking">
              <i /><i /><i />
            </div>
          </div>
        )}

        {/* the current step's choices live inside the conversation — a Bauhly
         * turn is followed by its cards/chips, so decisions stay in the thread */}
        {actionsInThread && optionsReady && !typing && !busy && (
          <div className="ck-turn ck-turn--bauhly ck-turn--actions ck-turn--cont">
            <span className="ck-avatar ck-avatar--ghost" aria-hidden="true" />
            <div className={`ck-inline ${actionsAreCards ? 'ck-inline--cards' : ''}`}>{actions}</div>
          </div>
        )}

        <div ref={endRef} className="ck__tail" aria-hidden="true" />
      </div>

      <ScrollJump threadRef={threadRef} tailRef={endRef} deps={messages.length} />

      {step === 'recording' && <RecordingSheet rec={rec} note={CHECKIN.recordNote} />}

      {pickerOpen && (
        <ProjectPicker
          projects={filingList}
          selected={filingSel}
          recentId={lastProjectId}
          startNaming={pickerOpen === 'new'}
          onPick={(id) => {
            setFilingSel(id);
            const opened = pickerOpen;
            setPickerOpen(false);
            /* opened from "which project is this?", picking only changes which
               project the row is offering — the answer is still the button */
            if (opened === 'ask') {
              const p = filingList.find((x) => x.id === id);
              if (p) setAskProject(p);
              return;
            }
            /* opened to make a new project, there is no button behind the modal
             * to confirm with — so picking one instead IS the answer */
            if (opened === 'new') {
              const p = filingList.find((x) => x.id === id);
              if (!p) return;
              setStep('boot');
              userSays(p.name);
              ctx.current.projectId = p.id;
              ctx.current.projectName = p.name;
              const d = say(CHECKIN.filingAck.replace('{name}', p.name));
              after(d, filingSel === 'ASKED' ? askGap : afterProjectChosen);
            }
          }}
          onCreate={(name) => {
            const opened = pickerOpen;
            setPickerOpen(false);
            /* a new project mid-conversation carries on where the thread was;
             * one made at the filing question is the last thing left to decide */
            if (opened === 'new') {
              setStep('boot');
              userSays(name);
              ctx.current.projectId = null;
              ctx.current.projectName = name;
              const d = say(CHECKIN.filingAck.replace('{name}', name));
              after(d, filingSel === 'ASKED' ? askGap : afterProjectChosen);
              return;
            }
            /* a project that doesn't exist yet is carried as a NAME; YourWeek
             * creates it on generation, so "filed under X" is true and X is
             * somewhere the user can open */
            ctx.current.projectId = null;
            ctx.current.projectName = name;
            setFilingSel('ASKED');
            setStep('boot');
            userSays(name);
            const d = say(CHECKIN.filingAck.replace('{name}', name));
            after(d, askGap);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/* ── the project picker ───────────────────────────────────────────────────
 * Every project, not the first three, and making a new one is the first row
 * rather than a button somewhere else. A modal because the list is as long as
 * the studio's history and the conversation behind it should stay put. */
function ProjectPicker({ projects, selected, recentId, onPick, onCreate, onClose, startNaming = false }) {
  /* the page behind an overlay must not move — scrolling "through" a modal is
   * the clearest way to tell someone the thing on top isn't really modal */
  useBodyScrollLock();
  const [name, setName] = useState('');
  /* opened from "Something new", it IS the naming form — the list is still
   * under it, because changing your mind is one tap either way */
  const [naming, setNaming] = useState(startNaming);
  const [q, setQ] = useState('');
  const shown = q.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
    : projects;
  return (
    <>
      <div className="ckpick__scrim" onClick={onClose} />
      <div className="ckpick" role="dialog" aria-modal="true" aria-label="Choose a project">
        <div className="ckpick__head">
          <h2>File this plan under</h2>
          <button className="ckpick__close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} strokeWidth={2.25} />
          </button>
        </div>

        {/* search appears only when the list is long enough to need it — a
          * search box above four projects is a box that says "this will be
          * hard" about something that isn't */}
        {projects.length > 6 && (
          <input
            className="ckpick__search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
          />
        )}

        <div className="ckpick__list">
          {naming ? (
            <div className="ckpick__new">
              <input
                className="ckpick__search"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name.trim()); }}
                placeholder={CHECKIN.nameProjectPlaceholder}
                aria-label="New project name"
              />
              <div className="ckpick__newacts">
                <button className="btn btn--primary btn--sm" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
                  Create project
                </button>
                <button className="btn btn--quiet btn--sm" onClick={() => setNaming(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="ckpick__row ckpick__row--new" onClick={() => setNaming(true)}>
              <span className="ckpick__ico"><Icon name="plus" size={16} strokeWidth={2.25} /></span>
              <span className="ckpick__name">New project</span>
            </button>
          )}

          {shown.map((p) => {
            const on = p.id === selected;
            return (
              <button
                key={p.id}
                className={`ckpick__row ${on ? 'is-on' : ''}`}
                onClick={() => onPick(p.id)}
              >
                <span className="ckpick__ico"><Icon name="plan" size={16} strokeWidth={2} /></span>
                <span className="ckpick__name">{p.name}</span>
                {p.id === recentId && <span className="ckpick__tag">{CHECKIN.filingRecent}</span>}
                {on && <Icon name="check" size={16} strokeWidth={2.5} className="ckpick__on" />}
              </button>
            );
          })}
          {!shown.length && <p className="ckpick__empty">No project by that name.</p>}
        </div>
      </div>
    </>
  );
}
