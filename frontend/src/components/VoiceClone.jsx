/*
 * Capture › Reel › Include voiceover › "Try it with your cloned voice".
 * Sits at the top of VoicePrep. Not cloned yet → a short setup: read a passage
 * aloud for about a minute (or upload a recording of yourself), confirm it is
 * your voice, Create my voice (ElevenLabs Instant Voice Cloning, backend
 * services/voiceClone.js). Cloned → "Voice every part" reads each script part in
 * the clone; each reading lands as a take of its part (VoicePrep onCloneAll).
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { useRecorder } from '../pages/checkin/recorder';
import { uploadFiles } from '../api/projects';
import { createVoiceClone, deleteVoiceClone } from '../api/voiceClone';

const PASSAGE = 'Every project starts with a conversation. I want to know how you live in your space — where the morning light falls, '
  + 'where everyone ends up at the end of the day, and what never quite works. Then we sketch, we test materials, and we change our minds a few times. '
  + 'Good design is mostly patience: choosing one clear idea and letting every detail follow it. When a client walks in on handover day and goes quiet for a second, '
  + 'that is the moment I do this for. If you are planning something for your own home, send me a message — I would love to hear about it.';

const fmtMs = (ms) => {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function VoiceClone({ clone, onChange, onCloneAll, cloning = false, disabled = false }) {
  const rec = useRecorder({ liveCorrect: false, raw: true });
  const [setup, setSetup] = useState(false);
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

  if (!clone) return null; // still asking the server
  const sampleMs = samples.reduce((n, s) => n + (s.ms || 0), 0);
  const hasUpload = samples.some((s) => !s.ms);
  const enough = hasUpload || sampleMs >= 30000;

  const create = async () => {
    setErr('');
    setBusy('Uploading your sample…');
    try {
      const ups = await uploadFiles(samples.map((s) => s.file));
      const keys = ups.map((u) => u?.key).filter(Boolean);
      if (!keys.length) throw new Error('upload');
      setBusy('Creating your voice…');
      await createVoiceClone({ keys, consent });
      setSetup(false);
      setSamples([]);
      setConsent(false);
      onChange?.({ ...clone, cloned: true, createdAt: new Date().toISOString() });
    } catch (e) {
      setErr(e?.response?.data?.message || 'Your voice could not be created just now — try again.');
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    setBusy('Removing…');
    try {
      await deleteVoiceClone();
      onChange?.({ ...clone, cloned: false, createdAt: null });
    } catch (e) {
      setErr(e?.response?.data?.message || 'Could not remove your voice just now.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="ck-scard vclone">
      <div className="vclone__head">
        <span className="vclone__icon" aria-hidden="true"><Icon name="mic" size={15} strokeWidth={2} /></span>
        <div className="vclone__copy">
          <p className="ck-scard__q vclone__title">{clone.cloned ? 'Your cloned voice is ready' : 'Try it with your cloned voice'}</p>
          <p className="vclone__sub">
            {clone.cloned
              ? 'Bauhly reads each part in your voice. Listen, keep it, or record your own take instead.'
              : 'No time to record? Clone your voice once — about a minute of reading — and Bauhly reads the script for you.'}
          </p>
        </div>
      </div>

      {!clone.configured && <p className="ck-stage__note">Voice cloning isn&rsquo;t switched on for this account yet.</p>}

      {clone.configured && clone.cloned && !setup && (
        <div className="ck-gr__acts">
          <button type="button" className="btn btn--primary btn--sm ck-gr__act" onClick={onCloneAll} disabled={disabled || cloning || Boolean(busy)}>
            {cloning ? 'Reading in your voice…' : 'Voice every part with my clone'}
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => { setErr(''); setSetup(true); }} disabled={cloning || Boolean(busy)}>Redo my voice</button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={remove} disabled={cloning || Boolean(busy)}>Remove</button>
        </div>
      )}

      {clone.configured && !clone.cloned && !setup && (
        <div className="ck-gr__acts">
          <button type="button" className="btn btn--sm ck-gr__act vprep__rec" onClick={() => setSetup(true)} disabled={disabled}>
            <Icon name="sparkle" size={14} strokeWidth={2} /> Clone my voice
          </button>
        </div>
      )}

      {clone.configured && setup && (
        <div className="vclone__setup">
          <div className="ck-say">
            <div className="ck-say__head"><p className="ck-say__label">Say this the way you'd tell a client · one to two minutes</p></div>
            <p className="ck-say__text vclone__passage">{PASSAGE}</p>
          </div>
          <p className="vclone__tip">
            Your clone copies how you sound here, so talk it, don&rsquo;t read it: your normal energy, smiles and pauses included —
            go off-script if you like. A quiet room with soft furnishings (no echo), the phone or laptop about a hand&rsquo;s width away.
            Or upload a clean recording of just you talking, like a voice note or a talking video.
          </p>

          {samples.length > 0 && (
            <ul className="ck-takes ck-takes--tight">
              {samples.map((s, ix) => (
                <li className="ck-take" key={s.id}>
                  <span className="ck-take__tick" aria-hidden="true"><Icon name="mic" size={13} strokeWidth={2} /></span>
                  <span className="ck-take__say">{s.name || `Sample ${ix + 1}`}{s.ms ? ` · ${fmtMs(s.ms)}` : ''}</span>
                  <button type="button" className="btn btn--quiet btn--sm ck-take__act" onClick={() => setSamples((l) => l.filter((x) => x.id !== s.id))} disabled={Boolean(busy)}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          <div className="ck-gr__acts">
            {recording ? (
              <button type="button" className="btn btn--primary btn--sm ck-gr__act" onClick={() => rec.stop()}>
                <span className="ck-rec__bead" /> Stop · {fmtMs(rec.ms)}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--sm ck-gr__act vprep__rec"
                onClick={() => { wanted.current = true; rec.reset(); rec.start(); }}
                disabled={Boolean(busy) || disabled || samples.length >= 5}
              >
                <span className="ck-rec__bead" />
                {samples.length ? 'Record more' : 'Record sample'}
              </button>
            )}
            <label className={`btn btn--sm ck-gr__act vprep__upload${recording || busy || samples.length >= 5 ? ' is-off' : ''}`}>
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
          {rec.status === 'denied' && <p className="ck-stage__note">Bauhly could not reach your microphone. Upload a recording instead.</p>}
          {samples.length > 0 && !enough && <p className="vclone__tip">Keep going — at least 30 seconds in all (one to two minutes sounds most like you).</p>}

          <label className="vclone__consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={Boolean(busy)} />
            <span>This is my own voice, and I agree to Bauhly creating a voice clone of it with ElevenLabs to read my voiceovers. I can remove it at any time.</span>
          </label>
          {err && <p className="ck-stage__note vclone__err">{err}</p>}

          <div className="ck-gr__acts">
            <button type="button" className="btn btn--primary btn--sm ck-gr__act" onClick={create} disabled={!samples.length || !enough || !consent || recording || Boolean(busy)}>
              {busy || 'Create my voice'}
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => { if (recording) { wanted.current = false; rec.stop(); } setSetup(false); setErr(''); }} disabled={Boolean(busy)}>Cancel</button>
          </div>
        </div>
      )}
      {err && !setup && <p className="ck-stage__note vclone__err">{err}</p>}
    </section>
  );
}
