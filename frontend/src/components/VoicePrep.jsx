/*
 * Capture › Reel › Include voiceover — "Record your voiceover." (bauhly-v3 checkin/VoicePrep.jsx).
 * One card per script part (Part n of N · Suggested: a–b sec · the question it answers · SAY THIS),
 * each with Record voiceover / Upload audio. Every take is kept (the last one of a part is used);
 * a take is uploaded the moment it lands. Continue hands the takes back; it is not a gate —
 * "Continue without a take" builds the Reel without a voice.
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { useRecorder } from '../pages/checkin/recorder';
import { uploadFiles } from '../api/projects';
import { getVoiceClone, speakWithClone } from '../api/voiceClone';
import VoiceClone from './VoiceClone';
import './formatPicker.css';

const fmtMs = (ms) => {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function VoicePrep({ parts = [], loading = false, error = '', onRetry, onDone, busy = false }) {
  const rec = useRecorder({ liveCorrect: false });
  const [recAt, setRecAt] = useState(null); // the part being recorded
  const [voices, setVoices] = useState({}); // part → [{ key, ms, name, state }]
  const head = useRef(null);
  const recFor = useRef(null);
  // "Try it with your cloned voice" (ElevenLabs): { configured, cloned } once the server answers
  const [clone, setClone] = useState(null);
  const [cloningAll, setCloningAll] = useState(false);

  useEffect(() => {
    let on = true;
    getVoiceClone().then((c) => { if (on) setClone(c); }).catch(() => { if (on) setClone({ configured: false, cloned: false }); });
    return () => { on = false; };
  }, []);

  useEffect(() => {
    const el = head.current;
    if (!el) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  }, [loading]);

  const addTake = async (part, file, meta) => {
    const id = `${part}-${Date.now()}`;
    setVoices((v) => ({ ...v, [part]: [...(v[part] || []), { id, ...meta, state: 'saving' }] }));
    try {
      const [up] = await uploadFiles([file]);
      setVoices((v) => ({ ...v, [part]: (v[part] || []).map((t) => (t.id === id ? { ...t, key: up?.key || '', state: up?.key ? 'saved' : 'failed' } : t)) }));
    } catch {
      setVoices((v) => ({ ...v, [part]: (v[part] || []).map((t) => (t.id === id ? { ...t, state: 'failed' } : t)) }));
    }
  };

  // the part's script read in the cloned voice — saved server-side, so it lands as a take like a recording
  const addClonedTake = async (part) => {
    const text = parts[part]?.say;
    if (!text) return;
    const id = `${part}-c${Date.now()}`;
    setVoices((v) => ({ ...v, [part]: [...(v[part] || []), { id, kind: 'cloned', state: 'saving' }] }));
    try {
      const out = await speakWithClone({ text, part, script: parts.map((p) => p.say || '') });
      setVoices((v) => ({ ...v, [part]: (v[part] || []).map((t) => (t.id === id ? { ...t, key: out?.key || '', ms: out?.ms || 0, url: out?.url || '', tone: out?.tone || '', state: out?.key ? 'saved' : 'failed' } : t)) }));
    } catch (e) {
      const why = e?.response?.data?.message || '';
      setVoices((v) => ({ ...v, [part]: (v[part] || []).map((t) => (t.id === id ? { ...t, state: 'failed', why } : t)) }));
    }
  };
  const cloneAll = async () => {
    setCloningAll(true);
    try {
      for (let i = 0; i < parts.length; i += 1) await addClonedTake(i); // one at a time: ElevenLabs limits concurrent requests
    } finally {
      setCloningAll(false);
    }
  };

  // a finished recording becomes a take of the part it was recorded for
  useEffect(() => {
    if (rec.status !== 'done' || recFor.current == null) return;
    const part = recFor.current;
    recFor.current = null;
    setRecAt(null);
    if (rec.blob && rec.blob.size) {
      const type = rec.blob.type || 'audio/webm';
      const ext = /mp4|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
      addTake(part, new File([rec.blob], `voiceover-${part + 1}.${ext}`, { type }), { kind: 'recorded', ms: rec.ms });
    }
    rec.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.status, rec.blob]);
  useEffect(() => {
    if (rec.status === 'denied') { setRecAt(null); recFor.current = null; }
  }, [rec.status]);

  const record = (part) => {
    if (recAt != null) return;
    recFor.current = part;
    setRecAt(part);
    rec.reset();
    rec.start();
  };
  const drop = (part, id) => setVoices((v) => ({ ...v, [part]: (v[part] || []).filter((t) => t.id !== id) }));

  const saving = Object.values(voices).some((list) => list.some((t) => t.state === 'saving'));
  const takes = Object.entries(voices)
    .flatMap(([part, list]) => list.filter((t) => t.state === 'saved' && t.key).map((t) => ({ part: Number(part), key: t.key })));
  const got = new Set(takes.map((t) => t.part)).size;

  if (loading) {
    return (
      <div className="ck-turn ck-turn--bauhly rst-warm" aria-live="polite" ref={head}>
        <div className="ck-body">
          Writing your voiceover script&hellip;
          <div className="ck-typing" aria-label="Writing your voiceover script"><i /><i /><i /></div>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="ck-stage ck-gr" ref={head}>
        <p className="ck-body">{error}</p>
        <div className="ck-gr__outs">
          <button type="button" className="btn btn--primary btn--sm" onClick={onRetry}>Try again</button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => onDone([])}>Continue without a voiceover</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ck-stage ck-gr ck-gr--fit vprep">
      <h3 className="ck-body ck-q" ref={head}>Record your voiceover.</h3>
      <p className="ck-gr__later">
        One take for each part of your Reel, in your own words. Every take is kept — record again as often as you like.
      </p>
      <VoiceClone clone={clone} onChange={setClone} onCloneAll={cloneAll} cloning={cloningAll} disabled={recAt != null} />
      {parts.map((p, i) => {
        const list = voices[i] || [];
        const live = recAt === i;
        return (
          <section className="ck-scard ck-gr__make" key={i}>
            <div className="ck-gr__meta">
              {parts.length > 1 && <span className="ck-gr__of">Part {i + 1} of {parts.length}</span>}
              {Array.isArray(p.seconds) && (
                <span className="ck-card__status ck-scard__len ck-gr__len">
                  <Icon name="clock" size={12} strokeWidth={2.2} />
                  Suggested: {p.seconds[0]}–{p.seconds[1]} sec
                </span>
              )}
            </div>
            {p.ask && <p className="ck-scard__q">{p.ask}</p>}
            <div className="ck-say">
              <div className="ck-say__head"><p className="ck-say__label">Say this</p></div>
              <p className="ck-say__text">
                <span className="ck-say__mark" aria-hidden="true">&ldquo;</span>
                {p.say}
                <span className="ck-say__mark" aria-hidden="true">&rdquo;</span>
              </p>
            </div>
            {list.length > 0 && (
              <ul className="ck-takes ck-takes--tight">
                {list.map((t, ix) => (
                  <li className="ck-take" key={t.id}>
                    <span className="ck-take__tick" aria-hidden="true"><Icon name="mic" size={13} strokeWidth={2} /></span>
                    <span className="ck-take__say">
                      {list.length > 1 ? `Take ${ix + 1}` : t.kind === 'cloned' ? 'Your cloned voice' : 'Your recording'}
                      {list.length > 1 && t.kind === 'cloned' ? ' · cloned voice' : ''}
                      {t.kind === 'cloned' && t.tone ? ` · ${t.tone}` : ''}
                      {t.kind === 'uploaded' && t.name ? ` · ${t.name}` : ''}
                      {t.ms ? ` · ${fmtMs(t.ms)}` : ''}
                      {t.state === 'saving' ? (t.kind === 'cloned' ? ' · Reading in your voice…' : ' · Saving…') : t.state === 'failed' ? ` · ${t.why || 'Could not save'}` : ''}
                    </span>
                    {t.kind === 'cloned' && t.url && <audio className="vprep__play" src={t.url} controls preload="none" />}
                    <button type="button" className="btn btn--quiet btn--sm ck-take__act" onClick={() => drop(i, t.id)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="ck-gr__acts">
              {live ? (
                <button type="button" className="btn btn--primary btn--sm ck-gr__act" onClick={() => rec.stop()}>
                  <span className="ck-rec__bead" /> Stop · {fmtMs(rec.ms)}
                </button>
              ) : (
                <button type="button" className="btn btn--sm ck-gr__act vprep__rec" onClick={() => record(i)} disabled={recAt != null}>
                  <span className="ck-rec__bead" />
                  {list.length ? 'Record another take' : 'Record voiceover'}
                </button>
              )}
              <label className={`btn btn--sm ck-gr__act vprep__upload${recAt != null ? ' is-off' : ''}`}>
                <Icon name="upload" size={15} strokeWidth={2} />
                Upload audio
                <input
                  type="file"
                  accept="audio/*"
                  hidden
                  disabled={recAt != null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) addTake(i, f, { kind: 'uploaded', name: f.name });
                  }}
                />
              </label>
            </div>
            {clone?.cloned && (
              <div className="ck-gr__acts vprep__clone">
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => addClonedTake(i)} disabled={recAt != null || cloningAll || list.some((t) => t.state === 'saving')}>
                  <Icon name="sparkle" size={13} strokeWidth={2} /> {list.some((t) => t.kind === 'cloned') ? 'Read it again in my cloned voice' : 'Use my cloned voice'}
                </button>
              </div>
            )}
            {live && rec.liveText && <p className="vprep__live">{rec.liveText}</p>}
          </section>
        );
      })}
      {rec.status === 'denied' && (
        <p className="ck-stage__note">Bauhly could not reach your microphone. Upload an audio file instead.</p>
      )}
      <div className="ck-gr__outs">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => onDone(takes)} disabled={busy || saving || cloningAll || recAt != null}>
          {saving ? 'Saving your takes…' : got ? 'Continue' : 'Continue without a take'}
        </button>
      </div>
    </div>
  );
}
