import React, { useEffect, useRef, useState } from 'react';
import { isSupportedVideo, uploadReelClip } from '../../api/reels';
import { createPodcastJob, getPodcastJob, renderPodcastJob, cancelPodcastJob } from '../../api/podcasts';
import { reelBrandBrief } from '../../lib/reelBrandKit';
import { preparePodcastBranding } from '../../lib/podcastBranding';
import './podcastGenerator.css';

const ACTIVE = new Set(['queued', 'analyzing', 'planning', 'rendering', 'processing']);
const message = (e) => e.response?.data?.error || e.response?.data?.message || e.message || 'Something went wrong. Please try again.';
const time = (n) => `${Math.floor((Number(n) || 0) / 60)}:${String(Math.floor((Number(n) || 0) % 60)).padStart(2, '0')}`;
function duration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (error) => { clearTimeout(timer); const value = video.duration; video.onloadedmetadata = null; video.onerror = null; video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => done(new Error('Could not read video duration. Try an MP4 file.')), 15000);
    video.onloadedmetadata = () => done();
    video.onerror = () => done(new Error(`Could not read ${file.name}.`));
    video.preload = 'metadata'; video.src = url;
  });
}

export default function PodcastGenerator({ brandKit }) {
  const [assets, setAssets] = useState([]);
  const [mode, setMode] = useState('conversation');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [guidance, setGuidance] = useState('');
  const [cleanAudio, setCleanAudio] = useState(true);
  const [useBrandKit, setUseBrandKit] = useState(true);
  const kitSnapshot = useRef(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');
  const [pollRetry, setPollRetry] = useState(0);
  const alive = useRef(true);
  const operation = useRef(null);
  const sequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; operation.current?.abort(); }; }, []);
  const active = ACTIVE.has(job?.status);
  const locked = Boolean(busy || active || job?.plan);
  useEffect(() => {
    if (!job?.jobId || !active) return;
    let disposed = false;
    let timer;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const next = await getPodcastJob(job.jobId, controller.signal);
        if (disposed) return;
        setJob(next); setError('');
        if (ACTIVE.has(next.status)) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (!disposed) setError(`Could not refresh this job. ${message(e)}`);
      }
    };
    timer = setTimeout(poll, 700);
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [job?.jobId, active, pollRetry]);

  async function addFiles(event) {
    const files = [...event.target.files]; event.target.value = '';
    setError('');
    if (files.length + assets.length > 8) { setError('Choose up to 8 videos in total.'); return; }
    if (files.some((f) => f.size > 250 * 1024 * 1024) || [...assets.map((a) => a.file), ...files].reduce((sum, f) => sum + f.size, 0) > 750 * 1024 * 1024) { setError('Use files up to 250 MB each and 750 MB total.'); return; }
    if (files.some((f) => !isSupportedVideo(f))) { setError('Use MP4, MOV, or WebM video files.'); return; }
    setBusy('Reading videos');
    const seq = ++sequence.current;
    try {
      const added = [];
      for (const file of files) {
        const seconds = await duration(file);
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 1200) throw new Error(`${file.name}: use a video up to 20 minutes long.`);
        added.push({ id: crypto.randomUUID(), file, durationSec: seconds, name: file.name.replace(/\.[^.]+$/, ''), role: assets.length + added.length === 0 ? 'host' : 'guest', startSec: 0, endSec: Number(seconds.toFixed(3)), offsetSec: 0 });
      }
      if (alive.current && sequence.current === seq) setAssets((prev) => [...prev, ...added]);
    } catch (e) { if (alive.current && sequence.current === seq) setError(message(e)); }
    finally { if (alive.current && sequence.current === seq) setBusy(''); }
  }
  function update(id, field, value) { setAssets((prev) => prev.map((a) => a.id === id ? { ...a, [field]: value } : a)); }
  async function start() {
    setError('');
    if (assets.length < 2 || !assets.some((a) => a.role === 'host') || !assets.some((a) => a.role === 'guest')) { setError('Add at least one host video and one guest video.'); return; }
    if (assets.some((a) => !a.name.trim() || !Number.isFinite(Number(a.startSec)) || !Number.isFinite(Number(a.endSec)) || Number(a.startSec) < 0 || Number(a.endSec) <= Number(a.startSec) || Number(a.endSec) > a.durationSec + 0.001 || !Number.isFinite(Number(a.offsetSec)))) { setError('Check speaker names, trim ranges, and timeline offsets.'); return; }
    kitSnapshot.current = useBrandKit && brandKit ? structuredClone(brandKit) : null;
    const seq = ++sequence.current;
    const controller = new AbortController(); operation.current = controller;
    setBusy('Uploading sources');
    try {
      const uploaded = [];
      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        let key = a.key;
        if (!key) {
          const result = await uploadReelClip(a.file, (p) => { if (alive.current && seq === sequence.current) setUploadProgress(`Video ${i + 1} of ${assets.length} · ${p}%`); }, controller.signal, 'podcast');
          key = result.key;
          if (alive.current && seq === sequence.current) update(a.id, 'key', key);
        }
        uploaded.push({ id: a.id, key, role: a.role, name: a.name.trim(), startSec: Number(a.startSec), endSec: Number(a.endSec), offsetSec: Number(a.offsetSec) });
      }
      if (!alive.current || seq !== sequence.current) return;
      setBusy('Starting production');
      const next = await createPodcastJob({ assets: uploaded, mode, aspectRatio, guidance, cleanAudio, ...(kitSnapshot.current ? { brand: reelBrandBrief(kitSnapshot.current) } : {}) }, controller.signal);
      if (alive.current && seq === sequence.current) setJob(next);
    } catch (e) { if (alive.current && seq === sequence.current && !controller.signal.aborted) setError(message(e)); }
    finally { if (alive.current && seq === sequence.current) { setBusy(''); setUploadProgress(''); } }
  }
  async function cancel() {
    const downloading = busy === 'Downloading';
    sequence.current++; operation.current?.abort(); setBusy('Cancelling');
    try { if (job?.jobId && !downloading) { const next = await cancelPodcastJob(job.jobId); if (alive.current) setJob(next); } }
    catch (e) { if (alive.current) setError(message(e)); }
    finally { if (alive.current) { setBusy(''); setUploadProgress(''); } }
  }
  async function revise() {
    setBusy('Releasing production'); setError('');
    try {
      if (job?.jobId && job.status === 'review') await cancelPodcastJob(job.jobId);
      if (alive.current) { setJob(null); kitSnapshot.current = null; }
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { if (alive.current) setBusy(''); }
  }
  async function render() {
    const controller = new AbortController(); operation.current = controller; setBusy('Starting render'); setError('');
    const seq = ++sequence.current;
    try {
      let brandingKey;
      if (kitSnapshot.current) {
        setBusy('Preparing Brand Kit');
        const blob = await preparePodcastBranding({ kit: kitSnapshot.current, title: job.plan?.title, aspectRatio, signal: controller.signal });
        if (blob) {
          const result = await uploadReelClip(new File([blob], 'podcast-branding.png', { type: 'image/png' }), null, controller.signal);
          brandingKey = result.key;
        }
      }
      if (!alive.current || seq !== sequence.current) return;
      setBusy('Starting render');
      const next = await renderPodcastJob(job.jobId, { brandingKey }, controller.signal);
      if (alive.current && seq === sequence.current) setJob(next);
    }
    catch (e) { if (alive.current && !controller.signal.aborted) setError(message(e)); }
    finally { if (alive.current && seq === sequence.current) setBusy(''); }
  }
  async function download() {
    const controller = new AbortController(); operation.current = controller; setBusy('Downloading'); setError('');
    try {
      const response = await fetch(job.result.url, { signal: controller.signal });
      if (!response.ok) throw new Error('Download failed. Please try again.');
      const blob = await response.blob();
      if (!alive.current) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'podcast.mp4'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { if (alive.current && !controller.signal.aborted) setError(message(e)); }
    finally { if (alive.current) setBusy(''); }
  }
  return <section className="podcast-generator">
    <header><span className="podcast-eyebrow">MULTI-AGENT PRODUCTION</span><h1>Podcast generator</h1><p>Bring your host and guest recordings together. Review the proposed cuts, then render one finished video.</p></header>
    <div className="podcast-layout"><div className="podcast-card">
      <h2>1. Add your recordings</h2><p className="podcast-muted">2–8 videos · Up to 20 min / 250 MB per source · 750 MB total</p>
      <label className={`podcast-upload ${locked ? 'is-disabled' : ''}`}>Choose host & guest videos<input type="file" accept="video/mp4,video/quicktime,video/webm" multiple disabled={locked} onChange={addFiles} /></label>
      <div className="podcast-sources">{assets.map((a, index) => <fieldset key={a.id} disabled={locked} className="podcast-source"><legend>Recording {index + 1} · {time(a.durationSec)}</legend><p className="podcast-filename">{a.file.name}</p><div className="podcast-fields"><label>Speaker name<input value={a.name} maxLength={80} onChange={(e) => update(a.id, 'name', e.target.value)} /></label><label>Role<select value={a.role} onChange={(e) => update(a.id, 'role', e.target.value)}><option value="host">Host</option><option value="guest">Guest</option></select></label></div><div className="podcast-fields"><label>Trim start (sec)<input type="number" min="0" max={a.durationSec} step="0.1" value={a.startSec} onChange={(e) => update(a.id, 'startSec', e.target.value)} /></label><label>Trim end (sec)<input type="number" min="0" max={a.durationSec} step="0.1" value={a.endSec} onChange={(e) => update(a.id, 'endSec', e.target.value)} /></label>{mode === 'conversation' && <label>Timeline offset (sec)<input type="number" step="0.1" value={a.offsetSec} onChange={(e) => update(a.id, 'offsetSec', e.target.value)} /></label>}</div><button type="button" className="podcast-link" onClick={() => setAssets((prev) => prev.filter((item) => item.id !== a.id))}>Remove recording</button></fieldset>)}</div>
      <h2>2. Direct the edit</h2><fieldset disabled={locked} className="podcast-settings"><label>Recording type<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="conversation">Same conversation · separate cameras</option><option value="segments">Separate takes · build an episode</option></select></label><p className="podcast-muted">{mode === 'conversation' ? 'Use recordings of the same conversation. The first host recording anchors time 0. Set when each other file begins relative to it; 0 means they start together. The agents propose camera switches from the transcripts. The first host recording supplies continuous episode audio and must contain both speakers. Guest audio is not mixed; offsets are manual.' : 'Use separately recorded questions, answers, or topics. The editorial agents arrange and interleave selected takes into an episode.'}</p><label>Output format<select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}><option value="16:9">Landscape · 16:9</option><option value="9:16">Portrait · 9:16</option></select></label><label>Production brief<textarea rows={3} maxLength={2000} value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="Topic, preferred opening, pacing, and anything to keep or avoid…" /></label><label className="podcast-checkbox"><input type="checkbox" checked={cleanAudio} onChange={(e) => setCleanAudio(e.target.checked)} /> Clean and normalize audio</label><label className="podcast-checkbox"><input type="checkbox" checked={useBrandKit} disabled={!brandKit} onChange={(e) => setUseBrandKit(e.target.checked)} /> Use Brand Kit logo, typography & colors</label>{!brandKit && <p className="podcast-muted">Set up a Brand Kit for this account to brand your podcast.</p>}</fieldset>
      <button className="podcast-primary" disabled={locked || assets.length < 2} onClick={start}>Create episode plan</button>
    </div><div className="podcast-card podcast-production"><h2>Production room</h2><p className="podcast-muted">Source analysis → editorial direction → cut planning → quality review → rendering</p>
      {(busy || active) && <div role="status" aria-live="polite" className="podcast-status"><strong>{busy || job.stage || job.status}</strong>{uploadProgress && <p>{uploadProgress}</p>}{active && Number.isFinite(job.progress) && <progress max="100" value={job.progress} />}</div>}
      {Array.isArray(job?.agents) && <ul className="podcast-agents">{job.agents.map((agent, index) => <li key={agent.id || agent.name || index}><strong>{agent.name || agent.role || `Agent ${index + 1}`}</strong><span>{agent.status}</span>{agent.summary && <p>{agent.summary}</p>}</li>)}</ul>}
      {error && <div role="alert" className="podcast-error">{error}{active && <button onClick={() => setPollRetry((x) => x + 1)}>Retry status</button>}</div>}
      {job?.error && <p role="alert" className="podcast-error">{typeof job.error === 'string' ? job.error : job.error.message || 'Production failed.'}</p>}
      {(job?.warnings || job?.plan?.warnings)?.length > 0 && <ul className="podcast-warnings">{[...new Set([...(job?.warnings || []), ...(job?.plan?.warnings || [])])].map((w, i) => <li key={i}>{typeof w === 'string' ? w : w.message}</li>)}</ul>}
      {!job && !busy && <div className="podcast-empty"><h3>Your episode starts here</h3><p>Upload both sides of the conversation. Each stage reports its real progress here, and you approve the cut plan before rendering.</p><p>Maximum finished episode: 30 minutes.</p></div>}
      {job?.plan && <div className="podcast-plan"><h3>{job.plan.title || 'Episode plan'}</h3><p>{job.plan.summary}</p><p className="podcast-muted">{time(job.plan.durationSec)} · {job.plan.segments?.length || 0} cuts</p><ol>{job.plan.segments?.map((segment, i) => <li key={segment.id || i}><div><strong>{time(segment.start)}–{time(segment.end)} · {segment.speaker || assets.find((a) => a.id === segment.assetId)?.name}</strong><span>Source {time(segment.sourceStart)}–{time(segment.sourceEnd)}</span></div><p>{segment.reason}</p></li>)}</ol>{!active && !job.result && !['cancelled', 'failed'].includes(job.status) && <button className="podcast-primary" disabled={Boolean(busy)} onClick={render}>Approve cuts & render MP4</button>}</div>}
      {job?.result?.url && <div className="podcast-result"><h3>Your podcast is ready</h3><video controls playsInline src={job.result.url} /><button className="podcast-primary" disabled={Boolean(busy)} onClick={download}>Download MP4</button></div>}
      {(active || (busy && busy !== 'Cancelling' && busy !== 'Reading videos' && busy !== 'Releasing production')) && <button className="podcast-link" onClick={cancel}>Cancel {busy === 'Downloading' ? 'download' : 'production'}</button>}
      {job && !active && !busy && <button className="podcast-link" onClick={revise}>Revise sources / start a new plan</button>}
    </div></div>
  </section>;
}
