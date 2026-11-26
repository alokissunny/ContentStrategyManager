/*
 * Recommended post → Reel (studio's flow, 2026-11-18). Opens once an explored
 * next-post idea has been saved in Capture (IdeaCard › Explore idea):
 *
 *   loading → recommend ("Your next recommended post", always a REEL)
 *     ├ Continue with recommendation → sequences (proposed reel, story sequences)
 *     └ Explore alternatives → formats ("How should we tell this story?")
 *          ├ another reel format → re-planned → sequences
 *          └ Carousel → the normal plan generation writes a carousel instead
 *   sequences → Continue to footage → guide (one recording guide per sequence)
 *   guide → Finish → footage ("Ready to add your footage")
 *     ├ Upload all videos / Make my reel → readiness check → making (capture reel)
 *     └ I'll upload later → idea saved; the capture + plan wait in Captures
 *
 * The plan comes from POST /api/ideas/:id/reel-plan (backend services/ideaReelPlan.js);
 * the reel from POST /api/capture-reels { ideaId } (cut follows the plan; lands on the calendar).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../brand/Icon';
import { getIdeaReelPlan, updateIdea } from '../api/ideas';
import { createCaptureReel, getCaptureReel } from '../api/captureReels';
import { uploadFiles, updateEntry } from '../lib/projectsStore';
import { startPlanGeneration } from '../lib/planGeneration';
import { MISSIONS } from '../lib/missions';
import { openReelStudio } from '../lib/reelJobs';
import './reelPlanner.css';

/* ── one open path (IdeaCard calls openReelPlanner; DashboardLayout mounts the host) ── */
let current = null;
const subs = new Set();
const emit = () => subs.forEach((fn) => fn());
export function openReelPlanner(opts) { current = { ...opts, key: Date.now() }; emit(); }
function closeReelPlanner() { current = null; emit(); }
const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export function ReelPlannerHost() {
  const open = useSyncExternalStore(subscribe, () => current, () => null);
  if (!open) return null;
  return createPortal(<ReelPlanner key={open.key} {...open} onClose={closeReelPlanner} />, document.body);
}

/* ── vocabulary ─────────────────────────────────────────────────────────── */
const MusicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);
const FORMATS = [
  { id: 'faceless_text', name: 'Faceless · Text', desc: 'Project footage, text overlays, and music', icon: 'type',
    fit: 'Your project footage carries the story, with short lines on screen and an original music bed. Nothing to say on camera.' },
  { id: 'faceless_voiceover', name: 'Faceless · Voiceover', desc: 'Project footage with spoken explanation', icon: 'mic',
    fit: 'You explain the decision in your own voice over project footage — expertise without being on camera.' },
  { id: 'talking_head', name: 'Talking head', desc: 'You speak directly to camera', icon: 'user',
    fit: 'You speak straight to camera. The most personal way to show how your studio thinks.' },
  { id: 'talking_head_broll', name: 'Talking head + B-roll', desc: 'Your explanation combined with project footage', icon: 'film',
    fit: 'You explain the decision on camera, while project footage (B-roll) illustrates the key points.' },
  { id: 'music_led', name: 'Music-led', desc: 'Visual sequence synchronized with music', icon: null,
    fit: 'A visual sequence cut to the beat of an original track — best when the space speaks for itself.' },
  { id: 'motion_graphics', name: 'Motion graphics', desc: 'Animated text, labels and diagrams explain the idea', icon: 'wand',
    fit: 'Animated text, labels, arrows and transitions explain your design idea over project footage, photos, plans or renders. Nothing to say on camera.' },
];
const CAROUSEL = { id: 'carousel', name: 'Carousel', desc: 'Photos and text across slides — nothing to record', icon: 'layers',
  fit: 'Bauhly writes a carousel from your capture and photos instead of a reel. Nothing to record.' };
const formatOf = (id) => FORMATS.find((f) => f.id === id) || FORMATS[3];
const ROLE = { hook: 'Hook', context: 'Context', value: 'Value', proof: 'Proof', payoff: 'Payoff' };
const SHOT = {
  talking_head: 'Talking head', broll: 'B-roll', talking_head_broll: 'Talking head + B-roll',
  text: 'Text on footage', voiceover: 'Voiceover',
};
export const STAGE = {
  queued: 'Waiting for its turn', reading: 'Watching your footage', writing: 'Cutting the story',
  voicing: 'Preparing the sound', scoring: 'Composing the music', cutting: 'Editing the cut',
  rendering: 'Rendering the video', saving: 'Saving your reel', retrying: 'Trying again',
};
const secsSay = ([a, b] = []) => (a && b && a !== b ? `${a}–${b}` : `${a || b || 0}`);
const FormatIcon = ({ f }) => (f.icon ? <Icon name={f.icon} size={16} strokeWidth={2} /> : <MusicIcon />);

/* ── in-browser camera recorder for one sequence (Record button) ─────────────
   Live preview with the line to say on screen, a timer against the target
   length, front/back camera. A take comes back as a File (mp4 on Safari/iOS,
   webm elsewhere) and is uploaded with the rest at "Make my reel". */
const REC_TYPES = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const recType = () => (typeof MediaRecorder === 'undefined' ? ''
  : REC_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '');
const clock = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export function SequenceRecorder({ name, facing: firstFacing, prompter, targetSec, onTake, onCancel }) {
  // talking shots face the speaker; B-roll films the space (back camera)
  const [facing, setFacing] = useState(firstFacing);
  const [phase, setPhase] = useState('starting'); // starting | ready | recording | review | failed
  const [err, setErr] = useState('');
  const [ms, setMs] = useState(0);
  const [take, setTake] = useState(null); // { file, url }
  const live = useRef(null);
  const stream = useRef(null);
  const rec = useRef(null);
  const chunks = useRef([]);
  const t0 = useRef(0);
  const fallback = useRef(null);

  const stopStream = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };

  useEffect(() => {
    let gone = false;
    setPhase('starting');
    if (!navigator.mediaDevices?.getUserMedia || !recType()) {
      setErr('This browser cannot record video here.');
      setPhase('failed');
      return undefined;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    }).then((s) => {
      if (gone) { s.getTracks().forEach((t) => t.stop()); return; }
      stopStream();
      stream.current = s;
      if (live.current) { live.current.srcObject = s; live.current.play().catch(() => {}); }
      setPhase('ready');
    }).catch((e) => {
      if (gone) return;
      setErr(e?.name === 'NotAllowedError'
        ? 'Bauhly needs your camera and microphone. Allow them in your browser, then try again.'
        : 'The camera could not start.');
      setPhase('failed');
    });
    return () => { gone = true; };
  }, [facing]);

  useEffect(() => () => {
    if (rec.current?.state === 'recording') rec.current.stop();
    stopStream();
  }, []);
  useEffect(() => () => { if (take?.url) URL.revokeObjectURL(take.url); }, [take]);

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const id = setInterval(() => setMs(Date.now() - t0.current), 200);
    return () => clearInterval(id);
  }, [phase]);

  const start = () => {
    const type = recType();
    chunks.current = [];
    const r = new MediaRecorder(stream.current, { mimeType: type, videoBitsPerSecond: 6_000_000 });
    r.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const base = type.split(';')[0];
      const blob = new Blob(chunks.current, { type: base });
      const file0 = `${name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase().slice(0, 40) || 'take'}.${base === 'video/mp4' ? 'mp4' : 'webm'}`;
      const file = new File([blob], file0, { type: base });
      setTake({ file, url: URL.createObjectURL(blob) });
      setPhase('review');
    };
    rec.current = r;
    r.start(500);
    t0.current = Date.now();
    setMs(0);
    setPhase('recording');
  };
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };
  const retake = () => {
    setTake(null);
    setPhase('ready');
    if (live.current && stream.current) { live.current.srcObject = stream.current; live.current.play().catch(() => {}); }
  };
  const use = () => { const f = take.file; stopStream(); onTake(f); };

  const target = targetSec?.[1] || targetSec?.[0] || 0;
  const over = target && ms / 1000 > target + 1;

  if (phase === 'failed') {
    return (
      <div className="rpl__rec rpl__rec--failed">
        <p className="rpl__warn">{err}</p>
        <input
          ref={fallback}
          type="file"
          accept="video/*"
          capture={facing === 'user' ? 'user' : 'environment'}
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onTake(f); }}
        />
        <button type="button" className="rpl__btn rpl__btn--ink" onClick={() => fallback.current?.click()}>
          <Icon name="film" size={14} strokeWidth={2} /> Use the phone camera instead
        </button>
        <button type="button" className="rpl__link" onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="rpl__rec">
      <div className={`rpl__stage ${facing === 'user' && phase !== 'review' ? 'is-mirror' : ''}`}>
        {phase === 'review' && take
          ? <video key="take" src={take.url} controls autoPlay playsInline />
          : <video key="live" ref={live} muted playsInline autoPlay />}
        {phase !== 'review' && prompter && <p className="rpl__prompter">{prompter}</p>}
        {phase === 'recording' && (
          <span className={`rpl__timer ${over ? 'is-over' : ''}`}>
            <span className="rpl__recdot" aria-hidden="true" /> {clock(ms)}{target ? ` / ${target}s` : ''}
          </span>
        )}
        {(phase === 'ready' || phase === 'starting') && (
          <button
            type="button"
            className="rpl__flip"
            onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
            aria-label="Switch camera"
            title="Switch camera"
          >
            <Icon name="refresh" size={16} strokeWidth={2} />
          </button>
        )}
        {phase === 'starting' && <span className="rpl__spin rpl__spin--stage" aria-hidden="true" />}
      </div>
      {phase === 'review' ? (
        <div className="rpl__recacts">
          <button type="button" className="rpl__btn rpl__btn--line" onClick={retake}>Retake</button>
          <button type="button" className="rpl__btn rpl__btn--ink" onClick={use}>
            Use this take <Icon name="check" size={14} strokeWidth={2.25} />
          </button>
        </div>
      ) : (
        <div className="rpl__recacts rpl__recacts--shutter">
          <button type="button" className="rpl__link" onClick={() => { stop(); stopStream(); onCancel(); }}>Cancel</button>
          <button
            type="button"
            className={`rpl__shutter ${phase === 'recording' ? 'is-on' : ''}`}
            onClick={phase === 'recording' ? stop : start}
            disabled={phase === 'starting'}
            aria-label={phase === 'recording' ? 'Stop recording' : 'Start recording'}
          />
          <span className="rpl__small rpl__shuttertip">{phase === 'recording' ? 'Tap to stop' : 'Tap to record'}</span>
        </div>
      )}
    </div>
  );
}

/* What to record for one sequence: the main take, plus a separate B-roll take
   when the person talks on camera (B-roll is filmed apart, back camera, silent —
   the editor lays it over their voice). */
function slotsOf(s) {
  const talking = s.shot === 'talking_head' || s.shot === 'talking_head_broll';
  const out = [];
  if (talking) {
    out.push({ role: 'say', icon: 'user', label: 'Your line', what: s.record, facing: 'user', prompter: s.say, button: 'Record your line' });
    if (s.broll) {
      out.push({ role: 'broll', icon: 'film', label: 'B-roll', what: s.broll, facing: 'environment', prompter: '', button: 'Record B-roll',
        note: 'Film the space without talking — your voice plays over it. 5–10 seconds, slow and steady.' });
    }
  } else if (s.shot === 'voiceover') {
    out.push({ role: 'say', icon: 'mic', label: 'Film the space while you say it', what: s.broll || s.record, facing: 'environment', prompter: s.say, button: 'Record' });
  } else {
    out.push({ role: 'broll', icon: 'film', label: 'What to film', what: s.broll || s.record, facing: 'environment', prompter: '', button: 'Record' });
  }
  return out;
}

function ReelPlanner({ idea, captured, format: chosenFormat = '', onClose, onMade }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('loading');
  const [planning, setPlanning] = useState(''); // the format being planned (loading copy)
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState('');
  const [open, setOpen] = useState(0); // expanded sequence
  const [at, setAt] = useState(0); // recording guide index
  const [files, setFiles] = useState({}); // `${sequence}:say` | `${sequence}:broll` → File
  const [extra, setExtra] = useState([]); // Upload all videos
  const [copied, setCopied] = useState(-1);
  const [reel, setReel] = useState(null);
  const [note, setNote] = useState('');
  const recommended = useRef('');
  const [recording, setRecording] = useState(false);
  const pickAll = useRef(null);
  const mission = MISSIONS[idea?.mission] || null;
  const captureId = captured?.captureId || '';

  const thumb = useMemo(() => (captured?.attachments || []).find((a) => a.url && a.type === 'image')?.url
    || (idea?.assets || []).find((a) => a.url && a.type !== 'video')?.url || '', [captured, idea]);
  const thumbVideo = !thumb ? (captured?.attachments || []).find((a) => a.url && a.type === 'video')?.url || '' : '';

  const load = (format = '') => {
    setPlanning(format);
    setStep('loading');
    setError('');
    getIdeaReelPlan(idea.id, { captureId, format })
      .then((data) => {
        setPlan(data.plan);
        if (!recommended.current) recommended.current = data.plan.format;
        setOpen(0);
        setAt(0);
        setStep(format ? 'sequences' : 'recommend');
      })
      .catch((err) => {
        setError(err?.response?.data?.message || 'Bauhly could not plan this reel just now.');
        setStep('failed');
      });
  };
  // Build Reel › Create with my footage › a recording method: planned straight in that format
  useEffect(() => { load(chosenFormat); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && step !== 'making') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  /* the reel being made: poll until done / error */
  useEffect(() => {
    if (!reel?.id || reel.status === 'done' || reel.status === 'error') return undefined;
    const t = setTimeout(() => getCaptureReel(reel.id).then(setReel).catch(() => {}), 4000);
    return () => clearTimeout(t);
  }, [reel]);

  const seqs = plan?.sequences || [];
  const motion = plan?.format === 'motion_graphics';
  const fmt = plan ? formatOf(plan.format) : null;
  const takeUrls = useMemo(() => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, URL.createObjectURL(f)])), [files]);
  useEffect(() => () => Object.values(takeUrls).forEach((u) => URL.revokeObjectURL(u)), [takeUrls]);
  const newFiles = [...Object.values(files), ...extra];

  const goCarousel = () => {
    onClose();
    startPlanGeneration('idea', {
      label: idea.fromCapture ? `From your capture · ${idea.title}` : `Next idea · ${idea.title}`,
      captureIds: captureId ? [captureId] : [],
    }).catch(() => {});
  };
  const later = () => {
    updateIdea(idea.id, 'saved', captureId).catch(() => {});
    setStep('later');
  };
  const copy = (i, text) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(i); setTimeout(() => setCopied(-1), 1400); }).catch(() => {});
  };

  /* Check readiness and adapt → make the reel */
  const make = async (more = []) => {
    // recorded takes keep their sequence + role (the editor matches them to the story)
    const tagged = Object.entries(files).map(([k, file]) => {
      const [seq, role] = k.split(':');
      return { file, sequence: Number(seq), role };
    });
    const fresh = [...tagged, ...[...extra, ...more].map((file) => ({ file }))];
    const have = captured?.attachments || [];
    // Motion graphics needs no pictures: without any it is drawn on brand colours
    if (!fresh.length && !have.length && !motion) {
      setNote('Add at least one video or photo — the reel is cut from your footage.');
      return;
    }
    const talking = ['talking_head', 'talking_head_broll', 'faceless_voiceover'].includes(plan.format);
    const anyVideo = fresh.some((f) => String(f.file.type).startsWith('video')) || have.some((a) => a.type === 'video');
    const brollTakes = tagged.filter((t) => t.role === 'broll').length + extra.length + more.length;
    setNote(talking && !anyVideo
      ? 'No spoken footage yet — Bauhly will tell the story in on-screen text over your photos, with music. Record your lines any time to remake it.'
      : plan.format === 'talking_head_broll' && !brollTakes && !have.some((a) => a.type === 'image')
        ? 'No B-roll recorded — Bauhly will cut away to your project photos where it finds matching ones.'
        : '');
    setStep('making');
    try {
      let attachments = have;
      let takes = [];
      if (fresh.length) {
        const up = await uploadFiles(fresh.map((f) => f.file));
        attachments = [...have, ...up];
        await updateEntry(captured.projectId, captureId, { attachments });
        takes = up.map((u, i) => (fresh[i]?.role ? { key: u.key, sequence: fresh[i].sequence, role: fresh[i].role } : null)).filter(Boolean);
      }
      const made = await createCaptureReel({ projectId: captured.projectId, captureIds: [captureId], ideaId: idea.id, takes });
      setReel(made);
      onMade?.(made);
      // straight to the Reel studio's progress screen
      if (made?.id && made.status !== 'error') { onClose?.(); openReelStudio(navigate, made); }
    } catch (err) {
      setReel({ status: 'error', error: err?.response?.data?.message || err?.message || 'Something went wrong.' });
    }
  };

  const head = (right) => (
    <div className="rpl__head">
      <span className="rpl__brand"><Icon name="sparkle" size={14} strokeWidth={2} /> Bauhly · Capture</span>
      {right && <span className="rpl__headtag">{right}</span>}
      <button type="button" className="rpl__x" onClick={onClose} aria-label="Close"><Icon name="x" size={14} strokeWidth={2.25} /></button>
    </div>
  );
  const missionChip = mission ? <span className={`rpl__chip rpl__chip--mission rpl__chip--${idea.mission}`}>{mission.say}</span> : null;

  let body = null;
  if (step === 'loading') {
    body = (
      <>
        {head(null)}
        <div className="rpl__wait" aria-live="polite">
          <span className="rpl__spin" aria-hidden="true" />
          <p>{planning === 'motion_graphics'
            ? 'Planning a motion graphics reel from the photos you already shared…'
            : 'Planning your reel — the story, the sequences and what to record…'}</p>
        </div>
      </>
    );
  } else if (step === 'failed') {
    body = (
      <>
        {head(null)}
        <div className="rpl__wait">
          <p>{error}</p>
          <button type="button" className="rpl__btn rpl__btn--ink" onClick={() => load()}>Try again</button>
          <button type="button" className="rpl__btn rpl__btn--line" onClick={goCarousel}>Make a carousel instead</button>
        </div>
      </>
    );
  } else if (step === 'recommend') {
    body = (
      <>
        <div className="rpl__head">
          <span className="rpl__brand rpl__brand--lg"><Icon name="sparkle" size={15} strokeWidth={2} /> {idea.fromCapture ? 'Your reel plan' : 'Your next recommended post'}</span>
          <span className="rpl__chip rpl__chip--ok">Strategy aligned</span>
          <button type="button" className="rpl__x" onClick={onClose} aria-label="Close"><Icon name="x" size={14} strokeWidth={2.25} /></button>
        </div>
        <div className="rpl__box">
          <div className="rpl__boxtop"><span className="rpl__eyebrow">Strategic priority</span>{missionChip}</div>
          <p className="rpl__strong">{plan.priority.headline}</p>
          {plan.priority.body && <p className="rpl__muted">{plan.priority.body}</p>}
        </div>
        <span className="rpl__eyebrow">Recommended content</span>
        <h3 className="rpl__title">{plan.title}</h3>
        <div className="rpl__format">
          <span className="rpl__ico"><FormatIcon f={fmt} /></span>
          <div className="rpl__formatwords">
            <strong>{fmt.name}</strong>
            <p className="rpl__muted">{plan.formatSummary || fmt.desc}</p>
          </div>
          {(thumb || thumbVideo) && (
            <span className="rpl__thumb">
              {thumb ? <img src={thumb} alt="" /> : <video src={thumbVideo} muted playsInline preload="metadata" />}
              <span className="rpl__play" aria-hidden="true"><Icon name="play" size={14} strokeWidth={2} /></span>
            </span>
          )}
        </div>
        <button type="button" className="rpl__btn rpl__btn--ink" onClick={() => setStep('sequences')}>
          Continue with recommendation <Icon name="arrow-right" size={14} strokeWidth={2.25} />
        </button>
        <button type="button" className="rpl__btn rpl__btn--line" onClick={() => { setPick(plan.format); setStep('formats'); }}>
          Explore alternatives
        </button>
      </>
    );
  } else if (step === 'formats') {
    const sel = pick === 'carousel' ? CAROUSEL : formatOf(pick);
    const why = pick === recommended.current && plan?.format === pick && plan.formatWhy ? plan.formatWhy : sel.fit;
    body = (
      <>
        <div className="rpl__head">
          <span className="rpl__brand rpl__brand--lg">How should we tell this story?</span>
          <span className="rpl__headtag rpl__headtag--pill">Reel style</span>
          <button type="button" className="rpl__x" onClick={onClose} aria-label="Close"><Icon name="x" size={14} strokeWidth={2.25} /></button>
        </div>
        <p className="rpl__muted">Choose how you&apos;d like to present this story. Bauhly recommends the option that fits your available material and your strategic goal.</p>
        <div className="rpl__opts" role="radiogroup" aria-label="Reel style">
          {[...FORMATS, CAROUSEL].map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={pick === f.id}
              className={`rpl__opt ${pick === f.id ? 'is-on' : ''} ${f.id === 'carousel' ? 'rpl__opt--alt' : ''}`}
              onClick={() => setPick(f.id)}
            >
              <span className="rpl__ico"><FormatIcon f={f} /></span>
              <span className="rpl__optwords">
                <strong>{f.name}{f.id === recommended.current && <span className="rpl__chip rpl__chip--ok">Suggested</span>}</strong>
                <span>{f.desc}</span>
              </span>
              <span className="rpl__radio" aria-hidden="true">{pick === f.id ? <Icon name="check-circle" size={18} strokeWidth={2} /> : null}</span>
            </button>
          ))}
        </div>
        <div className="rpl__box">
          <p className="rpl__strong"><Icon name="sparkle" size={13} strokeWidth={2} /> {sel.name}</p>
          <p className="rpl__muted">{why}</p>
        </div>
        <button
          type="button"
          className="rpl__btn rpl__btn--ink"
          onClick={() => {
            if (pick === 'carousel') goCarousel();
            else if (pick === plan?.format) setStep('sequences');
            else load(pick);
          }}
        >
          {pick === 'carousel' ? 'Make a carousel instead' : 'Apply Reel style'} <Icon name="arrow-right" size={14} strokeWidth={2.25} />
        </button>
        <button type="button" className="rpl__link" onClick={() => setStep('recommend')}>Back to recommendation</button>
      </>
    );
  } else if (step === 'sequences') {
    body = (
      <>
        {head(missionChip)}
        <div className="rpl__box">
          <span className="rpl__eyebrow">Proposed reel</span>
          <p className="rpl__strong">{plan.title}</p>
          <p className="rpl__small"><FormatIcon f={fmt} /> {fmt.name} · Estimated {secsSay(plan.estimatedSec)} sec</p>
        </div>
        <p className="rpl__label">Story sequences</p>
        <ol className="rpl__seqs">
          {seqs.map((s, i) => (
            <li key={i} className={`rpl__seq ${open === i ? 'is-open' : ''}`}>
              <button type="button" className="rpl__seqhead" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                <span className="rpl__num">{i + 1}</span>
                <span className="rpl__seqwords">
                  <span className="rpl__seqtitle">{s.title} <span className="rpl__chip">{ROLE[s.role] || s.role}</span></span>
                  <span className="rpl__small">{motion ? 'Motion graphics · from your photos' : (SHOT[s.shot] || s.shot)}</span>
                  <span className="rpl__quote">{s.say ? `“${s.say}”` : s.record}</span>
                </span>
                <Icon name="chevron-down" size={14} strokeWidth={2} />
              </button>
              {open === i && (
                <div className="rpl__seqbody">
                  <span className="rpl__eyebrow">{motion ? 'What it shows' : 'What to show / record'}</span>
                  <p>{s.record}</p>
                  {s.onScreenText && (
                    <>
                      <span className="rpl__eyebrow">Optional on-screen text</span>
                      <p className="rpl__well">“{s.onScreenText}”</p>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
        {/* Motion graphics is made from the photos, plans and renders already
            on file: nothing to film, so no recording guide (studio, 2026-11-19) */}
        {motion ? (
          <button type="button" className="rpl__btn rpl__btn--ink" onClick={() => make()}>
            Make the reel <Icon name="arrow-right" size={14} strokeWidth={2.25} />
          </button>
        ) : (
          <button type="button" className="rpl__btn rpl__btn--ink" onClick={() => { setAt(0); setStep('guide'); }}>
            Continue to footage <Icon name="arrow-right" size={14} strokeWidth={2.25} />
          </button>
        )}
        <button type="button" className="rpl__link" onClick={() => { setPick(plan.format); setStep('formats'); }}>Change reel style</button>
      </>
    );
  } else if (step === 'guide') {
    const s = seqs[at];
    const last = at === seqs.length - 1;
    const next = () => { setRecording(false); if (last) setStep('footage'); else setAt(at + 1); };
    body = (
      <>
        {head('Recording guide')}
        <p className="rpl__small">Sequence {at + 1} of {seqs.length}</p>
        <div className="rpl__bars" aria-hidden="true">
          {seqs.map((_, i) => <span key={i} className={i === at ? 'is-on' : i < at ? 'is-done' : ''} />)}
        </div>
        <div className="rpl__guidetop">
          <div>
            <h3 className="rpl__h">{s.title}</h3>
            <span className="rpl__chip">{ROLE[s.role] || s.role}</span>
          </div>
          <div className="rpl__target"><strong>{secsSay(s.targetSec)}</strong> sec<span>Target length</span></div>
        </div>
        {s.say && (
          <div className="rpl__box">
            <div className="rpl__boxtop">
              <span className="rpl__eyebrow">What to say</span>
              <button type="button" className="rpl__copy" onClick={() => copy(at, s.say)}>
                <Icon name={copied === at ? 'check' : 'copy'} size={12} strokeWidth={2} /> {copied === at ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="rpl__strong">“{s.say}”</p>
          </div>
        )}
        {s.guidance && (
          <>
            <p className="rpl__label"><Icon name="bulb" size={14} strokeWidth={2} /> Recording guidance</p>
            <p className="rpl__muted">{s.guidance}</p>
          </>
        )}
        {s.existing && <p className="rpl__ok">Your capture already has footage for this — nothing new needed.</p>}
        {slotsOf(s).map((slot) => {
          const key = `${at}:${slot.role}`;
          const file = files[key];
          return (
            <div key={key} className="rpl__slot">
              <p className="rpl__label"><Icon name={slot.icon} size={14} strokeWidth={2} /> {slot.label}</p>
              <p className="rpl__muted">{slot.what}</p>
              {slot.note && <p className="rpl__small">{slot.note}</p>}
              {recording === slot.role ? (
                <SequenceRecorder
                  key={`rec-${key}`}
                  name={`${s.title} ${slot.role}`}
                  facing={slot.facing}
                  prompter={slot.prompter}
                  targetSec={s.targetSec}
                  onCancel={() => setRecording(false)}
                  onTake={(f) => { setFiles((m) => ({ ...m, [key]: f })); setRecording(false); }}
                />
              ) : file ? (
                <div className="rpl__take">
                  <video src={takeUrls[key]} controls playsInline preload="metadata" />
                  <div className="rpl__takewords">
                    <strong><Icon name="check" size={14} strokeWidth={2.5} /> {slot.role === 'broll' ? 'B-roll recorded' : 'Take recorded'}</strong>
                    <span className="rpl__small">{file.name}</span>
                    <button type="button" className="rpl__btn rpl__btn--line" onClick={() => setRecording(slot.role)}>Retake</button>
                  </div>
                </div>
              ) : (
                <button type="button" className={`rpl__btn ${slot.role === 'say' ? 'rpl__btn--rec' : 'rpl__btn--line'}`} onClick={() => setRecording(slot.role)}>
                  <span className="rpl__recdot" aria-hidden="true" /> {slot.button}
                </button>
              )}
            </div>
          );
        })}
        {!slotsOf(s).some((slot) => files[`${at}:${slot.role}`]) && !recording && (
          <button type="button" className="rpl__link" onClick={next}>Skip for now <Icon name="arrow-right" size={12} strokeWidth={2} /></button>
        )}
        <p className="rpl__foot">Record each part here, or upload your videos together at the end.</p>
        <div className="rpl__nav">
          <button type="button" className="rpl__link" onClick={() => { setRecording(false); if (at) setAt(at - 1); else setStep('sequences'); }}>
            <Icon name="arrow-left" size={12} strokeWidth={2} /> Previous
          </button>
          <button type="button" className="rpl__link" onClick={next}>
            {last ? 'Finish' : 'Next sequence'} <Icon name="arrow-right" size={12} strokeWidth={2} />
          </button>
        </div>
      </>
    );
  } else if (step === 'footage') {
    body = (
      <>
        {head('Recording guide')}
        <h3 className="rpl__h rpl__h--lg">Ready to add your footage</h3>
        <p className="rpl__muted">Upload your videos together. Bauhly will match suitable footage to each sequence.</p>
        <ol className="rpl__list">
          {seqs.map((s, i) => (
            <li key={i}>
              <span>{i + 1}. {s.title}{(files[`${i}:say`] || files[`${i}:broll`]) && <Icon name="check" size={13} strokeWidth={2.5} />}</span>
              <span className="rpl__small">{secsSay(s.targetSec)} sec</span>
            </li>
          ))}
        </ol>
        {extra.length > 0 && <p className="rpl__small">{extra.length} more file{extra.length > 1 ? 's' : ''} added</p>}
        {note && <p className="rpl__warn">{note}</p>}
        <input
          ref={pickAll}
          type="file"
          accept="video/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            const picked = Array.from(e.target.files || []);
            e.target.value = '';
            if (!picked.length) return;
            setExtra((x) => [...x, ...picked]);
            if (!newFiles.length) make(picked);
          }}
        />
        {newFiles.length ? (
          <>
            <button type="button" className="rpl__btn rpl__btn--ink" onClick={() => make()}>
              Make my reel <Icon name="arrow-right" size={14} strokeWidth={2.25} />
            </button>
            <button type="button" className="rpl__btn rpl__btn--line" onClick={() => pickAll.current?.click()}>
              <Icon name="upload" size={14} strokeWidth={2} /> Add more videos
            </button>
          </>
        ) : (
          <button type="button" className="rpl__btn rpl__btn--ink" onClick={() => pickAll.current?.click()}>
            <Icon name="upload" size={14} strokeWidth={2} /> Upload all videos
          </button>
        )}
        <button type="button" className="rpl__btn rpl__btn--line" onClick={later}>I&apos;ll upload later</button>
        {!newFiles.length && (captured?.attachments || []).length > 0 && (
          <button type="button" className="rpl__link" onClick={() => make()}>Make it with the footage I already shared</button>
        )}
        <button type="button" className="rpl__link" onClick={() => { setAt(0); setStep('guide'); }}>Back to recording guide</button>
      </>
    );
  } else if (step === 'making') {
    const failed = reel?.status === 'error';
    const done = reel?.status === 'done';
    body = (
      <>
        {head('Your reel')}
        <h3 className="rpl__h rpl__h--lg">{done ? 'Your reel is ready' : failed ? 'The reel could not be made' : 'Making your reel'}</h3>
        {note && !failed && <p className="rpl__warn">{note}</p>}
        {!reel && <div className="rpl__wait"><span className="rpl__spin" aria-hidden="true" /><p>{motion && !newFiles.length ? 'Starting your reel…' : 'Uploading your footage…'}</p></div>}
        {reel && !done && !failed && (
          <div className="rpl__wait">
            <span className="rpl__spin" aria-hidden="true" />
            <p>{STAGE[reel.stage] || 'Working on it'}…</p>
            <p className="rpl__small">It takes a few minutes. You can close this — the reel lands on your calendar when it is ready.</p>
          </div>
        )}
        {done && (
          <>
            {reel.posterUrl && <img className="rpl__poster" src={reel.posterUrl} alt="" />}
            <p className="rpl__muted">{reel.post ? 'It is on your calendar, ready to review and schedule.' : 'Find it in Captures.'}</p>
          </>
        )}
        {failed && <p className="rpl__warn">{reel.error}</p>}
        {failed && <button type="button" className="rpl__btn rpl__btn--ink" onClick={() => { setReel(null); setStep(motion ? 'sequences' : 'footage'); }}>Back</button>}
        <button type="button" className="rpl__btn rpl__btn--line" onClick={onClose}>{done || failed ? 'Close' : 'Keep making it in the background'}</button>
      </>
    );
  } else if (step === 'later') {
    body = (
      <>
        {head(null)}
        <h3 className="rpl__h rpl__h--lg">Saved for later</h3>
        <p className="rpl__muted">Your capture and this reel plan are kept. Pick it up from Captures when your footage is ready.</p>
        <button type="button" className="rpl__btn rpl__btn--ink" onClick={onClose}>Done</button>
      </>
    );
  }

  return (
    <div className="rpl-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && step !== 'making') onClose(); }}>
      <section className="rpl" role="dialog" aria-modal="true" aria-label="Recommended post">
        {body}
      </section>
    </div>
  );
}

export default ReelPlanner;
