/*
 * THE FULL STORY — the Reel's shot guide, inside the Capture modal (port of bauhly-v3 ReelPrep's Full Story,
 * Nov 19–20, decisions 1105–1127). Build Reel › Create with my footage › a recording method › Continue › the
 * idea's questions › saved → this:
 *
 *   "Preparing your Reel…"  (POST /api/ideas/:id/reel-plan in the method's format)
 *   "Here's your complete Reel, from start to finish. Film it here, one shot at a time — or add footage you
 *    already have."
 *   one card per sequence:
 *     SHOT n OF N                                   ⏱ SUGGESTED: a–b SEC
 *     [framing illustration]  the question this shot answers (plan `ask`)
 *                             how to frame it / what to film
 *     ATTACHED ASSETS   the capture's own photos, shared out across the shots
 *     ⌄ Show suggested script  Optional   → "Say this" (plan `say`)
 *     takes · Record shot (in-app camera, ReelPlanner SequenceRecorder)
 *   Upload footage (loose clips for the whole Reel) · Make my reel (once there is footage) · I'll film it later
 *
 * The illustration follows the recording method across all three options (bauhly-v3 shotsFor):
 *   Face camera        → the person framings: close-up / knees up / head to toe, by the shot's place in the story
 *   Speak while filming→ the filming library (detail close-up, hands at work, walkthrough, wide…), by what the
 *                        shot films
 *   Show and explain   → person framings for the shots spoken to camera, the filming library for the rest
 *
 * Make my reel = the ReelPlanner path: takes are uploaded onto the capture and tagged with their sequence + role,
 * then POST /api/capture-reels { ideaId } cuts the reel to the plan.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import FrameShot from './FrameShot';
import { SequenceRecorder, STAGE } from './ReelPlanner';
import { getIdeaReelPlan, updateIdea } from '../api/ideas';
import { createCaptureReel, getCaptureReel } from '../api/captureReels';
import { uploadFiles, updateEntry } from '../lib/projectsStore';
import { formatForMode } from './IdeaOffer';
import './contentOpportunity.css';

/* ── framing references (bauhly-v3 lib/reelprep.js SHOTS / FILMING / WANTS) ─────────────────────────────── */
const PERSON = {
  close: { id: 'close', title: 'Close-up', say: 'Frame your face and shoulders, looking straight at the camera.' },
  knees: { id: 'knees', title: 'Knees up', say: 'Show yourself from the knees up, with some of the room around you.' },
  whole: { id: 'whole', title: 'Head to toe', say: 'Stand in the space and show it with you in it, head to toe.' },
};
/* by place in the story (bauhly-v3: the hook close, the second shot knees up, the payoff head to toe), so two
   neighbouring shots never share a framing */
const personFor = (i, n) => (i === 0 ? 'close' : n > 2 && i === n - 1 ? 'whole' : i % 2 ? 'knees' : 'close');
const FILMING = [
  { id: 'beforeafter', title: 'Before and after', say: 'Film how it looks now — the photos you added are the before.', wants: 'change', needs: 1 },
  { id: 'sidebyside', title: 'Side-by-side comparison', say: 'Film both of the things you are comparing, one after the other.', wants: 'compare', needs: 2 },
  { id: 'closeup', title: 'Detail close-up', say: 'Film the detail, showing its texture and how it looks in the space.', wants: 'thing' },
  { id: 'hands', title: 'Hands at work', say: 'Film the work being done, so the step itself is clear.', wants: 'work' },
  { id: 'progress', title: 'Work in progress', say: 'Film how far the work has got, and what is still to come.', wants: 'progress' },
  { id: 'walk', title: 'Slow walkthrough', say: 'Film the space as you move through it, so the layout reads.', wants: 'move' },
  { id: 'pov', title: 'Point-of-view shot', say: 'Film what you see as you go through it, as if someone were arriving.', wants: 'arrive' },
  { id: 'wide', title: 'Wide shot', say: 'Film the whole space, or the whole subject, so people can see where everything sits.' },
];
const WANTS = {
  move: /\bwalk|\bthrough\b|\balong\b|\bflow\b|\blayout\b|\bpan\b|\bopens? (up|into|onto)\b|\bleads? (to|into)\b/i,
  arrive: /\barriv|\bentr(y|ance|ing)\b|\bdoorway\b|\bpoint of view\b|\bpov\b/i,
  change: /\bbefore\b|\bused to\b|\btransform|\bnow it\b|\bchanged\b|\bopened up\b/i,
  compare: /\bcompar|\bversus\b|\bvs\.?\b|\bside by side\b|\bside-by-side\b|\bsamples?\b/i,
  work: /\binstall|\bfitting\b|\bjoiner|\bhands?\b|\bbuild(ing)?\b|\bassembl|\bpaint(ing)?\b/i,
  progress: /\bon site\b|\bprogress\b|\bwork in\b|\bunfinished\b|\bhalf\b|\bconstruction\b/i,
  thing: /\bclose-?up\b|\bdetail\b|\bmaterial\b|\btexture\b|\bjoinery\b|\bhandle\b|\bthreshold\b|\bedge\b|\bfinish(es)?\b|\btiles?\b|\btimber\b|\boak\b|\bstone\b|\bmarble\b|\bfabric\b|\btap\b|\blamp\b/i,
};
const libraryShot = (words, stills, skip = new Set()) => {
  const fits = FILMING.filter((r) => (!r.wants || WANTS[r.wants].test(words)) && (!r.needs || stills >= r.needs));
  return fits.find((r) => !skip.has(r.id)) || fits[0] || FILMING[FILMING.length - 1];
};

/* which framing each shot gets, for the chosen recording method — neighbours never repeat a library shot
   when another one fits */
function framingsFor(seqs, mode, stills) {
  const used = new Set();
  return seqs.map((s, i) => {
    const words = `${s.record || ''} ${s.broll || ''} ${s.title || ''} ${s.say || ''}`;
    const spoken = s.shot === 'talking_head' || (s.shot === 'talking_head_broll' && (s.role === 'hook' || !s.broll));
    const person = mode === 'face' || (mode === 'show' && spoken);
    if (person) return { ...PERSON[personFor(i, seqs.length)], person: true };
    const ref = libraryShot(words, stills, used);
    used.add(ref.id);
    return { ...ref, person: false };
  });
}

const lengthOf = (t) => {
  const [a, b] = Array.isArray(t) ? t : [];
  if (!a && !b) return '';
  return a && b && a !== b ? `${a}–${b} sec` : `${a || b} sec`;
};
const PICS_SHOWN = 4;

/* takes already saved to a capture, remembered across closing / reloading (per capture) */
const takesKey = (captureId) => `bauhly.reelTakes.${captureId}`;
function readTakes(captureId) {
  if (!captureId) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(takesKey(captureId)) || '{}');
    return Object.fromEntries(Object.entries(raw).map(([i, list]) => [i, (list || []).filter((t) => t?.key).map((t) => ({ ...t, status: 'saved' }))]));
  } catch { return {}; }
}
function writeTakes(captureId, takes) {
  if (!captureId) return;
  try {
    const saved = Object.fromEntries(Object.entries(takes || {})
      .map(([i, list]) => [i, (list || []).filter((t) => t.status === 'saved' && t.key).map(({ id, name, key, role }) => ({ id, name, key, role }))])
      .filter(([, list]) => list.length));
    if (Object.keys(saved).length) localStorage.setItem(takesKey(captureId), JSON.stringify(saved));
    else localStorage.removeItem(takesKey(captureId));
  } catch { /* this visit only */ }
}

export default function ReelStory({ idea, captured, mode, onReady, onClose }) {
  const [phase, setPhase] = useState('warm'); // warm | story | failed | making
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [scriptOpen, setScriptOpen] = useState(-1);
  const [picsOpen, setPicsOpen] = useState(-1);
  const [recFor, setRecFor] = useState(-1);
  // sequence index → [{ id, name, status: 'saving'|'saved'|'failed', key, role, file? }]
  // Each take is uploaded and saved to the capture the moment it is recorded (studio, 2026-11-21:
  // recordings held only in memory were lost before "Make my Reel"), and remembered per capture so
  // closing or reloading the window brings them back.
  const [takes, setTakes] = useState(() => readTakes(captured?.captureId));
  const [confirmMissing, setConfirmMissing] = useState(false);
  // the capture's attachments as the server has them — including takes saved earlier in this
  // capture (restored above): a list sent without them would delete them from the capture
  const attachmentsRef = useRef((() => {
    const list = (captured?.attachments || []).map((a) => ({ type: a.type, key: a.key, ...(a.reelTake ? { reelTake: a.reelTake } : {}) }));
    const have = new Set(list.map((a) => a.key));
    Object.values(readTakes(captured?.captureId)).flat().forEach((t) => {
      if (t.key && !have.has(t.key)) { list.push({ type: 'video', key: t.key, reelTake: t.role }); have.add(t.key); }
    });
    return list;
  })());
  const saveChain = useRef(Promise.resolve());
  const [loose, setLoose] = useState([]); // footage for the whole Reel
  const [reel, setReel] = useState(null);
  const [later, setLater] = useState(false);
  const ledeRef = useRef(null);
  const captureId = captured?.captureId || '';
  const format = formatForMode(mode);

  const load = () => {
    setPhase('warm');
    setError('');
    getIdeaReelPlan(idea.id, { captureId, format })
      .then((data) => { setPlan(data.plan); setPhase('story'); })
      .catch((err) => { setError(err?.response?.data?.message || 'Bauhly could not plan this Reel just now.'); setPhase('failed'); });
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the story arrives at the top of the thread (bauhly-v3 decision 1085)
  useEffect(() => {
    if (phase !== 'story') return undefined;
    onReady?.();
    const t = setTimeout(() => ledeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => clearTimeout(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // the reel being made: poll until done / error
  useEffect(() => {
    if (!reel?.id || reel.status === 'done' || reel.status === 'error') return undefined;
    const t = setTimeout(() => getCaptureReel(reel.id).then(setReel).catch(() => {}), 4000);
    return () => clearTimeout(t);
  }, [reel]);

  /* the capture's own pictures (and the idea's), shared out across the shots */
  const stills = useMemo(() => {
    const seen = new Set();
    // a reel's spoken takes are never shown as project photos (studio, 2026-11-21)
    return [...(captured?.attachments || []), ...(idea?.assets || [])]
      .filter((a) => a?.url && a.type !== 'video' && a.reelTake !== 'say' && !seen.has(a.key || a.url) && seen.add(a.key || a.url));
  }, [captured, idea]);
  const seqs = plan?.sequences || [];
  const frames = useMemo(() => framingsFor(seqs, mode, stills.length), [seqs, mode, stills.length]);
  /* every picture with a URL: the plan's own signed media, then the capture's and the idea's */
  const media = useMemo(() => {
    const m = {};
    [...(plan?.assetMedia || []), ...(captured?.attachments || []), ...(idea?.assets || [])]
      .forEach((a) => { if (a?.key && a.url && a.reelTake !== 'say' && !m[a.key]) m[a.key] = a; });
    return m;
  }, [plan, captured, idea]);
  /* a shot's reference photos are only the ones the planner matched to it (plan `assetKeys`), each
     under one shot at most (studio, 2026-11-21: "dont repeat… if there is no relevant asset, don't
     show it") — no dealing photos out to fill every card */
  const picsByShot = useMemo(() => {
    const taken = new Set();
    return seqs.map((s) => (s.assetKeys || []).filter((k) => media[k] && !taken.has(k) && taken.add(k)).map((k) => media[k]));
  }, [seqs, media]);
  const picsFor = (i) => picsByShot[i] || [];
  const allTakes = Object.values(takes).flat();
  const saving = allTakes.some((t) => t.status === 'saving');
  const anyFootage = allTakes.some((t) => t.status === 'saved') || loose.length > 0;
  // spoken shots with no recording yet (the reel would be shorter without them)
  const missing = seqs.map((s, i) => ({ s, i })).filter(({ s, i }) => s.say && !(takes[i] || []).some((t) => t.status === 'saved'));

  useEffect(() => { writeTakes(captureId, takes); }, [captureId, takes]);
  const patchTake = (i, id, patch) => setTakes((t) => ({ ...t, [i]: (t[i] || []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  /* upload one take and add it to the capture (marked as a reel take), one save at a time */
  const saveTake = (i, entry) => {
    saveChain.current = saveChain.current.then(async () => {
      try {
        const [up] = await uploadFiles([entry.file]);
        attachmentsRef.current = [...attachmentsRef.current, { type: up.type, key: up.key, reelTake: entry.role }];
        await updateEntry(captured.projectId, captureId, { attachments: attachmentsRef.current });
        patchTake(i, entry.id, { status: 'saved', key: up.key, file: undefined });
      } catch {
        patchTake(i, entry.id, { status: 'failed' });
      }
    });
  };
  const addTake = (i, file) => {
    const s = seqs[i];
    // a take with words in it carries the voice; a silent one is B-roll the editor lays over it
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, status: 'saving', role: s?.say ? 'say' : 'broll', file };
    setTakes((t) => ({ ...t, [i]: [...(t[i] || []), entry] }));
    saveTake(i, entry);
  };

  const make = async (force = false) => {
    if (saving) return;
    if (!force && missing.length) { setConfirmMissing(true); return; }
    setConfirmMissing(false);
    const tk = Object.entries(takes).flatMap(([i, list]) => list.filter((t) => t.status === 'saved' && t.key)
      .map((t) => ({ key: t.key, sequence: Number(i), role: t.role })));
    setPhase('making');
    setReel(null);
    try {
      if (loose.length) {
        const up = await uploadFiles(loose);
        attachmentsRef.current = [...attachmentsRef.current, ...up.map((u) => ({ type: u.type, key: u.key }))];
        await updateEntry(captured.projectId, captureId, { attachments: attachmentsRef.current });
      }
      const made = await createCaptureReel({ projectId: captured.projectId, captureIds: [captureId], ideaId: idea.id, takes: tk });
      writeTakes(captureId, {});
      setReel(made);
    } catch (err) {
      setReel({ status: 'error', error: err?.response?.data?.message || err?.message || 'Something went wrong.' });
    }
  };
  const filmLater = () => {
    updateIdea(idea.id, 'saved', captureId).catch(() => {});
    setLater(true);
  };

  if (phase === 'warm') {
    return (
      <div className="ck-turn ck-turn--bauhly rst-warm" aria-live="polite">
        <div className="ck-body">
          Preparing your Reel&hellip;
          <div className="ck-typing" aria-label="Preparing your Reel"><i /><i /><i /></div>
        </div>
      </div>
    );
  }
  if (phase === 'failed') {
    return (
      <div className="rst">
        <p className="ck-q">{error}</p>
        <div className="ck-gr__outs">
          <button type="button" className="ck-task__go" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  if (phase === 'making') {
    const done = reel?.status === 'done';
    const failed = reel?.status === 'error';
    return (
      <div className="rst">
        <p className="ck-q" ref={ledeRef}>
          {done ? 'Your Reel is ready.' : failed ? 'The Reel could not be made.' : 'Making your Reel…'}
        </p>
        <section className="ck-scard rst-made" aria-live="polite">
          {!done && !failed && (
            <>
              <p className="ck-scard__q">{reel ? `${STAGE[reel.stage] || 'Working on it'}…` : 'Uploading your footage…'}</p>
              <p className="ck-scard__note">It takes a few minutes. You can close this — the Reel lands on your calendar when it is ready.</p>
            </>
          )}
          {done && (
            <div className="rst-done">
              {reel.posterUrl && <img src={reel.posterUrl} alt="" />}
              <p className="ck-scard__note">{reel.post ? 'It is on your calendar, ready to review and schedule.' : 'Find it in Captures.'}</p>
            </div>
          )}
          {failed && <p className="ck-scard__note">{reel.error}</p>}
        </section>
        <div className="ck-gr__outs">
          {failed && <button type="button" className="ck-task__go" onClick={() => { setReel(null); setPhase('story'); }}>Back to the shots</button>}
          <button type="button" className={failed ? 'rst-btn' : 'ck-task__go'} onClick={onClose}>
            {done || failed ? 'Close' : 'Keep making it in the background'}
          </button>
        </div>
      </div>
    );
  }

  if (later) {
    return (
      <div className="rst">
        <p className="ck-q" ref={ledeRef}>Saved for later. Your capture and this Reel plan are kept — pick it up from Captures when your footage is ready.</p>
        <div className="ck-gr__outs"><button type="button" className="ck-task__go" onClick={onClose}>Done</button></div>
      </div>
    );
  }

  return (
    <div className="rst">
      <p className="ck-q" ref={ledeRef}>
        Here&rsquo;s your complete Reel, from start to finish. Film it here, one shot at a time &mdash; or add footage you already have.
      </p>
      <div className="ck-gr__shots">
        {seqs.map((s, i) => {
          const ref = frames[i];
          const len = lengthOf(s.targetSec);
          const all = picsFor(i);
          const pics = picsOpen === i ? all : all.slice(0, PICS_SHOWN);
          const note = ref.person ? ref.say : (s.broll || s.record || ref.say);
          const mine = takes[i] || [];
          const showScript = scriptOpen === i;
          return (
            <section className="ck-scard ck-gr__make" key={i}>
              <div className="ck-gr__meta">
                {seqs.length > 1 && <span className="ck-gr__of">Shot {i + 1} of {seqs.length}</span>}
                {len && (
                  <span className="ck-card__status ck-scard__len ck-gr__len">
                    <Icon name="clock" size={12} strokeWidth={2.2} />
                    Suggested: {len}
                  </span>
                )}
              </div>
              <div className="ck-shot ck-scard__lead">
                <FrameShot shot={ref.id} />
                <span className="ck-shot__body">
                  <p className="ck-scard__q">{s.ask || s.title}</p>
                  <p className="ck-scard__note">{note}</p>
                </span>
              </div>
              {all.length > 0 && (
                <div className="ck-gr__pics">
                  <p className="ck-gr__label">Attached assets</p>
                  <ul className="ck-pics" style={{ '--pics': PICS_SHOWN }}>
                    {pics.map((a) => (
                      <li className="ck-pic" key={a.key || a.url}>
                        {a.type === 'video'
                          ? <video src={a.url} muted playsInline preload="metadata" />
                          : <img src={a.url} alt="" loading="lazy" />}
                      </li>
                    ))}
                  </ul>
                  {all.length > PICS_SHOWN && (
                    <button type="button" className="rst-more" onClick={() => setPicsOpen(picsOpen === i ? -1 : i)}>
                      <Icon name={picsOpen === i ? 'chevron-up' : 'chevron-down'} size={14} strokeWidth={2} />
                      {picsOpen === i ? 'Show fewer' : `Show ${all.length - PICS_SHOWN} more`}
                    </button>
                  )}
                </div>
              )}
              {mine.length > 0 && (
                <ul className="ck-takes">
                  {mine.map((f, k) => (
                    <li className="ck-take" key={f.id}>
                      {f.status === 'saved'
                        ? <span className="ck-take__tick" aria-hidden="true"><Icon name="check" size={11} strokeWidth={3} /></span>
                        : null}
                      <span className="ck-take__say">
                        {mine.length > 1 ? `Take ${k + 1}` : 'Your take'}
                        {' · '}
                        {f.status === 'saving' ? 'Saving…' : f.status === 'failed' ? 'Could not save' : 'Saved to this capture'}
                      </span>
                      {f.status === 'failed' && f.file ? (
                        <button type="button" className="rst-link ck-take__act" onClick={() => { patchTake(i, f.id, { status: 'saving' }); saveTake(i, f); }}>Try again</button>
                      ) : null}
                      {f.status !== 'saving' && (
                        <button
                          type="button"
                          className="rst-link ck-take__act"
                          onClick={() => setTakes((t) => ({ ...t, [i]: (t[i] || []).filter((x) => x.id !== f.id) }))}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {recFor === i ? (
                <SequenceRecorder
                  name={s.title}
                  facing={ref.person ? 'user' : 'environment'}
                  prompter={s.say}
                  targetSec={s.targetSec}
                  onTake={(file) => { addTake(i, file); setRecFor(-1); }}
                  onCancel={() => setRecFor(-1)}
                />
              ) : (
                <div className="ck-gr__acts">
                  <button type="button" className="rst-btn" onClick={() => setRecFor(i)}>
                    <span className="ck-rec__bead" aria-hidden="true" />
                    {mine.length ? 'Record another' : 'Record shot'}
                  </button>
                </div>
              )}
              {s.say && (
                <button
                  type="button"
                  className="ck-gr__scriptrow"
                  onClick={() => setScriptOpen(showScript ? -1 : i)}
                  aria-expanded={showScript}
                >
                  <Icon name={showScript ? 'chevron-up' : 'chevron-down'} size={14} strokeWidth={2} />
                  {showScript ? 'Hide suggested script' : 'Show suggested script'}
                  <span className="ck-gr__opt">Optional</span>
                </button>
              )}
              {showScript && (
                <div className="ck-say">
                  <p className="ck-say__label">Say this</p>
                  <p className="ck-say__text">
                    <span className="ck-say__mark" aria-hidden="true">&ldquo;</span>
                    {s.say}
                    <span className="ck-say__mark" aria-hidden="true">&rdquo;</span>
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {loose.length > 0 && (
        <section className="ck-scard ck-gr__reel">
          <div className="ck-scard__head">
            <p className="ck-gr__label">Reel footage</p>
            <label className="rst-link rst-up">
              <Icon name="upload" size={14} strokeWidth={1.9} /> Upload footage
              <input type="file" accept="video/*" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) setLoose((l) => [...l, ...f]); }} />
            </label>
          </div>
          <ul className="ck-takes">
            {loose.map((f, k) => (
              <li className="ck-take" key={`${f.name}-${k}`}>
                <span className="ck-take__say">{f.name}</span>
                <button type="button" className="rst-link ck-take__act" onClick={() => setLoose((l) => l.filter((_, x) => x !== k))}>Remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {confirmMissing && missing.length > 0 && (
        <div className="rst-missing" role="alert">
          <p className="ck-scard__q">
            {missing.length === 1 ? `Shot ${missing[0].i + 1} has` : `Shots ${missing.map((m) => m.i + 1).join(', ')} have`} no recording yet.
          </p>
          <p className="ck-scard__note">Without {missing.length === 1 ? 'it' : 'them'} your Reel will be shorter and skip {missing.length === 1 ? 'that part' : 'those parts'} of the story.</p>
          <div className="ck-gr__outs">
            <button type="button" className="ck-task__go" onClick={() => { setConfirmMissing(false); setRecFor(missing[0].i); }}>Record shot {missing[0].i + 1}</button>
            <button type="button" className="rst-btn" onClick={() => make(true)}>Make it anyway</button>
          </div>
        </div>
      )}
      <div className="ck-gr__outs rst-outs">
        {loose.length === 0 && (
          <label className="rst-btn">
            <Icon name="upload" size={14} strokeWidth={1.9} /> Upload footage
            <input type="file" accept="video/*" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) setLoose(f); }} />
          </label>
        )}
        {anyFootage && (
          <button type="button" className="ck-task__go" onClick={() => make(false)} disabled={saving}>
            {saving ? 'Saving your takes…' : 'Make my Reel'}
          </button>
        )}
        <button type="button" className="rst-link" onClick={filmLater}>I&rsquo;ll film it later</button>
      </div>
    </div>
  );
}
