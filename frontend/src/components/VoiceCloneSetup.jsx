/*
 * Clone a voice: talk a passage for one to two minutes (or upload a recording of
 * just you), confirm it is your voice, submit. Shared by Brand Kit › Voice
 * profiles (add / re-record) and Capture › Reel › voiceover (first clone).
 * Samples are recorded from the raw microphone (useRecorder raw) — the browser's
 * noise suppression leaves a texture the clone copies. `submit({ keys, consent })`
 * does the cloning (create or re-clone); this uploads the samples first.
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { useRecorder } from '../pages/checkin/recorder';
import { uploadFiles } from '../api/projects';
import './voiceCloneSetup.css';

export const VOICE_PASSAGE = 'Every project starts with a conversation. I want to know how you live in your space — where the morning light falls, '
  + 'where everyone ends up at the end of the day, and what never quite works. Then we sketch, we test materials, and we change our minds a few times. '
  + 'Good design is mostly patience: choosing one clear idea and letting every detail follow it. When a client walks in on handover day and goes quiet for a second, '
  + 'that is the moment I do this for. If you are planning something for your own home, send me a message — I would love to hear about it.';

const fmtMs = (ms) => {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function VoiceCloneSetup({ submit, submitLabel = 'Create my voice', onCancel, disabled = false, canSubmit = true }) {
  const rec = useRecorder({ liveCorrect: false, raw: true });
  const [samples, setSamples] = useState([]); // { id, file, ms, name }
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const recording = rec.status === 'recording' || rec.status === 'paused';
  const wanted = useRef(false);

  useEffect(() => {
    if (rec.status !== 'done' || !wanted.current) return;
    wanted.current = false;
    if (rec.blob && rec.blob.size) {
      const type = rec.blob.type || 'audio/webm';
      const ext = /mp4|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
      setSamples((s) => [...s, { id: `r${Date.now()}`, file: new File([rec.blob], `voice-sample.${ext}`, { type }), ms: rec.ms }]);
    }
    rec.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.status, rec.blob]);

  const sampleMs = samples.reduce((n, s) => n + (s.ms || 0), 0);
  const hasUpload = samples.some((s) => !s.ms);
  const enough = hasUpload || sampleMs >= 30000;

  const go = async () => {
    setErr('');
    setBusy('Uploading your sample…');
    try {
      const ups = await uploadFiles(samples.map((s) => s.file));
      const keys = ups.map((u) => u?.key).filter(Boolean);
      if (!keys.length) throw new Error('upload');
      setBusy('Creating your voice…');
      await submit({ keys, consent });
      setSamples([]);
      setConsent(false);
    } catch (e) {
      setErr(e?.response?.data?.message || 'Your voice could not be created just now — try again.');
    } finally {
      setBusy('');
    }
  };
  const cancel = () => {
    if (recording) { wanted.current = false; rec.stop(); }
    setErr('');
    onCancel?.();
  };

  return (
    <div className="vcs">
      <div className="vcs__passage">
        <p className="vcs__label">Say this the way you&rsquo;d tell a client · one to two minutes</p>
        <p className="vcs__text">{VOICE_PASSAGE}</p>
      </div>
      <p className="vcs__tip">
        Your clone copies how you sound here, so talk it, don&rsquo;t read it: your normal energy, smiles and pauses included —
        go off-script if you like. A quiet room with soft furnishings (no echo), the phone or laptop about a hand&rsquo;s width away.
        Or upload a clean recording of just you talking, like a voice note or a talking video.
      </p>

      {samples.length > 0 && (
        <ul className="vcs__samples">
          {samples.map((s, ix) => (
            <li className="vcs__sample" key={s.id}>
              <Icon name="mic" size={14} strokeWidth={2} />
              <span className="vcs__sample-name">{s.name || `Sample ${ix + 1}`}{s.ms ? ` · ${fmtMs(s.ms)}` : ''}</span>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setSamples((l) => l.filter((x) => x.id !== s.id))} disabled={Boolean(busy)}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <div className="vcs__acts">
        {recording ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => rec.stop()}>
            <span className="vcs__bead" /> Stop · {fmtMs(rec.ms)}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => { wanted.current = true; rec.reset(); rec.start(); }}
            disabled={Boolean(busy) || disabled || samples.length >= 5}
          >
            <span className="vcs__bead" />
            {samples.length ? 'Record more' : 'Record sample'}
          </button>
        )}
        <label className={`btn btn--tertiary btn--sm vcs__upload${recording || busy || samples.length >= 5 ? ' is-off' : ''}`}>
          <Icon name="upload" size={15} strokeWidth={2} />
          Upload recording
          <input
            type="file"
            accept="audio/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              const fs = [...(e.target.files || [])].slice(0, 5 - samples.length);
              e.target.value = '';
              if (fs.length) setSamples((l) => [...l, ...fs.map((f, i) => ({ id: `u${Date.now()}-${i}`, file: f, name: f.name }))]);
            }}
          />
        </label>
      </div>
      {rec.status === 'denied' && <p className="vcs__note">Bauhly could not reach your microphone. Upload a recording instead.</p>}
      {samples.length > 0 && !enough && <p className="vcs__tip">Keep going — at least 30 seconds in all (one to two minutes sounds most like you).</p>}

      <label className="vcs__consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={Boolean(busy)} />
        <span>This is my own voice, and I agree to Bauhly creating a voice clone of it with ElevenLabs to read my voiceovers. I can remove it at any time.</span>
      </label>
      {err && <p className="vcs__note vcs__err">{err}</p>}

      <div className="vcs__acts">
        <button type="button" className="btn btn--primary btn--sm" onClick={go} disabled={!canSubmit || !samples.length || !enough || !consent || recording || Boolean(busy)}>
          {busy || submitLabel}
        </button>
        {onCancel && <button type="button" className="btn btn--quiet btn--sm" onClick={cancel} disabled={Boolean(busy)}>Cancel</button>}
      </div>
    </div>
  );
}
