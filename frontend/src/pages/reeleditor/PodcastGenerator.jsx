import React, { useEffect, useRef, useState } from 'react';
import { isSupportedVideo, uploadReelClip } from '../../api/reels';
import { getPodcastOutput, createPodcastJob, getPodcastJob, renderPodcastJob, cancelPodcastJob } from '../../api/podcasts';
import { reelBrandBrief } from '../../lib/reelBrandKit';
import { preparePodcastBranding } from '../../lib/podcastBranding';
import './podcastGenerator.css';
import PodcastCutPreview from './PodcastCutPreview';
import PodcastEditView from './PodcastEditView';
import { loadReelDraft, saveReelDraft } from '../../lib/reelDraft';

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

export default function PodcastGenerator({ brandKit, owner }) {
  const [draftReady, setDraftReady] = useState(!owner);
  const [storageStatus, setStorageStatus] = useState('');
  const [outputBlob, setOutputBlob] = useState(null);
  const [outputUrl, setOutputUrl] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [assets, setAssets] = useState([]);
  const mode = 'conversation';
  const layout = 'side-by-side';
  const [primaryAudioSource, setPrimaryAudioSource] = useState('host');
  const renderAttempt = useRef(null);
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
  const retiredJob = useRef(null);
  const releaseRequest = useRef(null);
  const briefInput = useRef(null);
  const [revisionNotice, setRevisionNotice] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; operation.current?.abort(); }; }, []);
  useEffect(() => {
    if (!owner) return;
    let disposed = false;
    setStorageStatus('Restoring podcast…');
    loadReelDraft(`podcast:${owner}`).then(async draft => {
      if (disposed || !draft) return;
      setAssets((draft.assets || []).map((a, i) => ({ ...a, file: draft.assetFiles?.[i] })).filter(a => a.file));
      setPrimaryAudioSource(draft.primaryAudioSource || 'host'); setAspectRatio(draft.aspectRatio || '16:9');
      setGuidance(draft.guidance || ''); setCleanAudio(draft.cleanAudio !== false); setUseBrandKit(draft.useBrandKit !== false);
      kitSnapshot.current = draft.useBrandKit !== false ? brandKit : null;
      setOutputBlob(draft.assembledFile || null); setEditDraft(draft.editDraft || null);
      let restored = draft.job;
      if (restored?.jobId && restored.status !== 'completed') {
        try { restored = await getPodcastJob(restored.jobId); }
        catch (e) { restored = { ...restored, status: 'failed', error: e.response?.status === 404 ? 'This unfinished job expired or the server restarted. Your recordings are saved; edit and generate again.' : message(e) }; }
      }
      if (!disposed) setJob(restored || null);
    }).catch(() => { if (!disposed) setStorageStatus('Could not restore the saved podcast.'); })
      .finally(() => { if (!disposed) { setDraftReady(true); setStorageStatus(s => s.startsWith('Could not') ? s : ''); } });
    return () => { disposed = true; };
  }, [owner]);
  useEffect(() => {
    if (!outputBlob) { setOutputUrl(''); return; }
    const url = URL.createObjectURL(outputBlob); setOutputUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [outputBlob]);
  useEffect(() => {
    if (!owner || !draftReady) return;
    let disposed = false;
    const { debug, ...savedJob } = job || {};
    setStorageStatus('Saving podcast on this browser…');
    saveReelDraft(`podcast:${owner}`, { assetFiles: assets.map(a => a.file), assets: assets.map(({ file, ...a }) => a), assembledFile: outputBlob, editDraft, job: job ? savedJob : null, primaryAudioSource, aspectRatio, guidance, cleanAudio, useBrandKit })
      .then(() => { if (!disposed) setStorageStatus(outputBlob ? 'Podcast saved on this browser.' : 'Recordings and settings saved on this browser.'); })
      .catch(() => { if (!disposed) setStorageStatus('Could not save locally. Browser storage may be full; download your MP4 to keep a copy.'); });
    return () => { disposed = true; };
  }, [owner, draftReady, assets, outputBlob, editDraft, job, primaryAudioSource, aspectRatio, guidance, cleanAudio, useBrandKit]);
  useEffect(() => {
    if (!draftReady || job?.status !== 'completed' || !job.result?.key || outputBlob) return;
    const controller = new AbortController();
    (async () => {
      try {
        // Refresh from the durable object key, independently of the in-memory job.
        const result = await getPodcastOutput(job.result.key, controller.signal);
        const response = await fetch(result.url, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not save finished video');
        const blob = await response.blob();
        if (!controller.signal.aborted) setOutputBlob(blob);
      } catch (e) { if (!controller.signal.aborted) setStorageStatus('Could not save the finished video locally. Use Download MP4 to keep a copy.'); }
    })();
    return () => controller.abort();
  }, [draftReady, job?.status, job?.result?.key, outputBlob]);
  useEffect(() => {
    if (job?.status === 'completed' && job.plan) setEditDraft(previous => previous || { title: job.plan.title || 'Podcast', captions: structuredClone(job.plan.captions || []), overlays: structuredClone(job.plan.overlays || []) });
  }, [job?.status, job?.jobId]);
  const active = ACTIVE.has(job?.status);
  const locked = Boolean(!draftReady || busy || active || job?.plan);
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

  async function addFile(event, role) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > 250 * 1024 * 1024) { setError('Use a video up to 250 MB.'); return; }
    if (!isSupportedVideo(file)) { setError('Use MP4, MOV, or WebM video files.'); return; }
    setBusy('Reading video');
    const seq = ++sequence.current;
    try {
      const seconds = await duration(file);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 1200) throw new Error(`${file.name}: use a video up to 20 minutes long.`);
      const added = { id: crypto.randomUUID(), file, durationSec: seconds, name: role === 'host' ? 'Host' : 'Guest', role, startSec: 0, endSec: seconds, offsetSec: 0 };
      if (alive.current && sequence.current === seq) setAssets(prev => [...prev.filter(a => a.role !== role), added].sort((a, b) => a.role === 'host' ? -1 : 1));
    } catch (e) { if (alive.current && sequence.current === seq) setError(message(e)); }
    finally { if (alive.current && sequence.current === seq) setBusy(''); }
  }
  function update(id, field, value) { setAssets((prev) => prev.map((a) => a.id === id ? { ...a, [field]: value } : a)); }
  function releasePreviousPlan() {
    if (!retiredJob.current) return Promise.resolve();
    if (releaseRequest.current) return releaseRequest.current;
    releaseRequest.current = cancelPodcastJob(retiredJob.current)
      .catch(e => { if (e.response?.status !== 404) throw e; })
      .then(() => { retiredJob.current = null; })
      .finally(() => { releaseRequest.current = null; });
    return releaseRequest.current;
  }
  async function start(requestedEdits = null) {
    const edits = Array.isArray(requestedEdits?.captions) ? requestedEdits : null;
    setError(''); setRevisionNotice(''); renderAttempt.current = null;
    if (assets.length < 2 || !assets.some((a) => a.role === 'host') || !assets.some((a) => a.role === 'guest')) { setError('Add a host video and a guest video.'); return; }
    if (assets.some((a) => !a.name.trim() || !Number.isFinite(Number(a.startSec)) || !Number.isFinite(Number(a.endSec)) || Number(a.startSec) < 0 || Number(a.endSec) <= Number(a.startSec) || Number(a.endSec) > a.durationSec + 0.001 || !Number.isFinite(Number(a.offsetSec)))) { setError('Check speaker names and start times. Each start must be before the video ends.'); return; }
    kitSnapshot.current = useBrandKit && brandKit ? structuredClone(brandKit) : null;
    const seq = ++sequence.current;
    const controller = new AbortController(); operation.current = controller;
    setBusy('Uploading sources');
    try {
      await releasePreviousPlan();
      controller.signal.throwIfAborted();
      const uploaded = [];
      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        let key = a.key;
        if (!key) {
          update(a.id, 'uploadPercent', 0);
          const result = await uploadReelClip(a.file, (p) => { if (alive.current && seq === sequence.current) { setUploadProgress(`Video ${i + 1} of ${assets.length} · ${p}%`); update(a.id, 'uploadPercent', p); } }, controller.signal, 'podcast');
          key = result.key;
          if (alive.current && seq === sequence.current) update(a.id, 'key', key);
        }
        uploaded.push({ id: a.id, key, role: a.role, name: a.name.trim(), startSec: Number(a.startSec), endSec: Number(a.endSec), offsetSec: Number(a.offsetSec) });
      }
      if (!alive.current || seq !== sequence.current) return;
      setBusy('Starting production');
      const next = await createPodcastJob({ workflow: 'simple', ...(edits ? { edits } : {}), assets: uploaded, primaryAudioSource, mode, layout, aspectRatio, guidance, cleanAudio, ...(kitSnapshot.current ? { brand: reelBrandBrief(kitSnapshot.current) } : {}) }, controller.signal);
      if (alive.current && seq === sequence.current) { setOutputBlob(null); setEditDraft(edits); setEditMode(false); setJob(next); }
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
  function revise() {
    const seq = ++sequence.current;
    operation.current?.abort();
    if (job?.jobId && job.status === 'review') retiredJob.current = job.jobId;
    renderAttempt.current = null; setEditMode(false); setEditDraft(null); setOutputBlob(null); setJob(null); kitSnapshot.current = null; setBusy(''); setError(''); setUploadProgress('');
    setRevisionNotice('Ready to revise. Your recordings are kept. Update the settings, then click Generate podcast.');
    requestAnimationFrame(() => { briefInput.current?.focus({ preventScroll: true }); briefInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    // Unlock editing immediately. Expired jobs (including after a server restart)
    // are already released; a slow cleanup must not trap the editor in review.
    void releasePreviousPlan().catch(e => {
      if (alive.current && sequence.current === seq) setError(`Editing is ready, but the previous plan could not be released. Generate podcast will retry. ${message(e)}`);
    });
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
      const next = await renderPodcastJob(job.jobId, { brandingKey, layout }, controller.signal);
      if (alive.current && seq === sequence.current) setJob(next);
    }
    catch (e) { if (alive.current && !controller.signal.aborted) setError(message(e)); }
    finally { if (alive.current && seq === sequence.current) setBusy(''); }
  }
  useEffect(() => {
    if (draftReady && job?.status === 'review' && !busy && renderAttempt.current !== job.jobId) {
      renderAttempt.current = job.jobId;
      void render();
    }
  }, [draftReady, job?.jobId, job?.status, busy]);
  const previewDuration = assets.length === 2 ? Math.max(0, Math.min(...assets.map(a => a.durationSec - Number(a.startSec || 0)))) : 0;
  const previewPlan = { durationSec: previewDuration, segments: assets.length ? [{ id: 'paired', assetId: assets[0].id, sourceStart: Number(assets[0].startSec || 0), sourceEnd: Number(assets[0].startSec || 0) + previewDuration, start: 0, end: previewDuration }] : [] };
  async function download() {
    const controller = new AbortController(); operation.current = controller; setBusy('Downloading'); setError('');
    try {
      const downloadUrl = outputUrl || (await getPodcastOutput(job.result.key, controller.signal)).url;
      const response = await fetch(downloadUrl, { signal: controller.signal });
      if (!response.ok) throw new Error('Download failed. Please try again.');
      const blob = await response.blob();
      if (!alive.current) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'podcast.mp4'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { if (alive.current && !controller.signal.aborted) setError(message(e)); }
    finally { if (alive.current) setBusy(''); }
  }
  return <section className="podcast-generator">
    <header><span className="podcast-eyebrow">MULTI-AGENT PRODUCTION</span><h1>Podcast generator</h1><p>Two videos. One side-by-side podcast, with smart captions, subtle motion, and relevant overlays.</p></header>
    {storageStatus && <p role="status" className="podcast-muted">{storageStatus}</p>}
    {editMode && error && <p role="alert" className="podcast-error">{error}</p>}
    {editMode && editDraft && job?.plan && <PodcastEditView assets={assets} plan={job.plan} edits={editDraft} onChange={setEditDraft} aspectRatio={aspectRatio} primaryAudioSource={primaryAudioSource} onExit={() => setEditMode(false)} onExport={() => start(editDraft)} busy={Boolean(busy || active)} />}
    <div className="podcast-layout" style={editMode ? { display: 'none' } : undefined}><div className="podcast-card">
      <h2>1. Add host & guest</h2><p className="podcast-muted">One video each · Up to 20 minutes / 250 MB per video</p>
      <div className="podcast-sources">{['host', 'guest'].map(role => {
        const a = assets.find(item => item.role === role);
        const label = role === 'host' ? 'Host' : 'Guest';
        return <fieldset key={role} disabled={locked} className="podcast-source"><legend>{label} · {role === 'host' ? 'left' : 'right'}{a ? ` · ${time(a.durationSec)}` : ''}</legend>
          <label className={`podcast-upload ${locked ? 'is-disabled' : ''}`}>{a ? `Replace ${label.toLowerCase()} video` : `Add ${label} video`}<input aria-label={`Add ${label} video`} type="file" accept="video/mp4,video/quicktime,video/webm" disabled={locked} onChange={event => addFile(event, role)} /></label>
          {a && <><p className="podcast-filename">{a.file.name}</p><p className="podcast-file-status" role="status">{a.key ? 'Uploaded' : busy === 'Uploading sources' && a.uploadPercent != null ? `Uploading · ${a.uploadPercent}%` : 'Selected · ready to generate'}</p><div className="podcast-fields"><label>{label} name<input value={a.name} maxLength={80} onChange={e => update(a.id, 'name', e.target.value)} /></label><label>{label} start time (sec)<input type="number" min="0" max={a.durationSec} step="0.1" value={a.startSec} onChange={e => update(a.id, 'startSec', e.target.value)} /></label></div></>}
        </fieldset>;
      })}</div>
      <h2>2. Choose your audio</h2>{revisionNotice && <p role="status" className="podcast-file-status">{revisionNotice}</p>}
      <fieldset disabled={locked} className="podcast-settings">
        <label>Primary audio source<select value={primaryAudioSource} onChange={e => setPrimaryAudioSource(e.target.value)}><option value="host">Host video</option><option value="guest">Guest video</option></select></label>
        <p className="podcast-muted">Only this video's audio is used. Choose the recording containing both voices. Each video begins at its own start time; the podcast ends when either video finishes.</p>
        <label>Output format<select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}><option value="16:9">Landscape · 16:9</option><option value="9:16">Portrait · 9:16</option></select></label>
        <label>Production notes (optional)<textarea ref={briefInput} rows={3} maxLength={2000} value={guidance} onChange={e => setGuidance(e.target.value)} placeholder="Topic, names, terms to spell correctly, and anything to emphasize…" /></label>
        <label className="podcast-checkbox"><input type="checkbox" checked={cleanAudio} onChange={e => setCleanAudio(e.target.checked)} /> Clean and normalize audio</label>
        <label className="podcast-checkbox"><input type="checkbox" checked={useBrandKit} disabled={!brandKit} onChange={e => setUseBrandKit(e.target.checked)} /> Use Brand Kit logo, typography & colors</label>
      </fieldset>
      <button className="podcast-primary" disabled={locked || assets.length !== 2 || previewDuration < 0.5} onClick={start}>Generate podcast</button>
    </div><div className="podcast-card podcast-production"><h2>Podcast preview</h2>
      {assets.length === 2 && previewDuration > 0 ? <PodcastCutPreview layout="side-by-side" simple primaryAudioSource={primaryAudioSource} assets={assets} plan={previewPlan} aspectRatio={aspectRatio} /> : <div className="podcast-empty"><h3>Host left. Guest right.</h3><p>Add both videos to play them together here, then adjust each start time to align the conversation.</p></div>}
      <p className="podcast-muted">Generate transcribes the selected audio, runs caption, overlay and quality agents, then renders your finished video. Captions, overlays, Brand Kit and audio cleanup appear in the finished MP4.</p>
      {(busy || active) && <div role="status" aria-live="polite" className="podcast-status"><strong>{busy || job.stage || job.status}</strong>{uploadProgress && <p>{uploadProgress}</p>}{active && Number.isFinite(job.progress) && <progress max="100" value={job.progress} />}</div>}
      {Array.isArray(job?.agents) && <ul className="podcast-agents">{job.agents.map((agent, index) => <li key={agent.id || agent.name || index}><strong>{agent.name || agent.role || `Agent ${index + 1}`}</strong><span>{agent.status}</span>{agent.summary && <p>{agent.summary}</p>}</li>)}</ul>}
      {error && <div role="alert" className="podcast-error">{error}{active && <button onClick={() => setPollRetry(x => x + 1)}>Retry status</button>}{job?.status === 'review' && !busy && <button onClick={render}>Retry generation</button>}</div>}
      {job?.error && <p role="alert" className="podcast-error">{typeof job.error === 'string' ? job.error : job.error.message || 'Production failed.'}</p>}
      {(job?.warnings || job?.plan?.warnings)?.length > 0 && <details className="podcast-warnings"><summary>Production notes</summary><ul>{[...new Set([...(job?.warnings || []), ...(job?.plan?.warnings || [])])].map((w, i) => <li key={i}>{typeof w === 'string' ? w : w.message}</li>)}</ul></details>}
      {job?.result?.url && <div className="podcast-result"><h3>Your podcast is ready</h3>{editDraft && assets.length === 2 && <><button type="button" className="podcast-primary" disabled={Boolean(busy)} onClick={() => { document.querySelectorAll('.podcast-generator video, .podcast-generator audio').forEach(media => media.pause()); setEditMode(true); }}>Edit podcast</button><p className="podcast-muted">Caption and overlay edits save automatically. Use Export edited MP4 in Edit mode to update this finished video.</p></>}<video controls playsInline src={outputUrl || job.result.url} onPlay={event => event.currentTarget.closest('.podcast-generator')?.querySelectorAll('video, audio').forEach(media => { if (media !== event.currentTarget) media.pause(); })} /><button className="podcast-primary" disabled={Boolean(busy)} onClick={download}>Download MP4</button></div>}
      {(active || (busy && !['Cancelling', 'Reading video'].includes(busy))) && <button className="podcast-link" onClick={cancel}>Cancel {busy === 'Downloading' ? 'download' : 'production'}</button>}
      {job && !active && !busy && <button className="podcast-link" onClick={revise}>Edit videos & generate again</button>}
    </div></div>
  </section>;
}
