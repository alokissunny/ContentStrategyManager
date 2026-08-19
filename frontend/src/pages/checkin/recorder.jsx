/*
 * Voice capture — the recorder hook and the waveform glyph that represents it.
 *
 * Shared by every surface that can take a voice note: the project capture flow
 * and onboarding both record the same way, so they record with the same code.
 * The hook owns the MediaRecorder lifecycle (including releasing the mic) and
 * reports a denied state honestly rather than pretending to record.
 */

import { useEffect, useRef, useState } from 'react';

/* a waveform glyph — the capture identity */
export function Waveform({ size = 44 }) {
  const h = [10, 20, 34, 16, 44, 22, 30, 12];
  const w = 4;
  const gap = 3;
  const total = h.length * w + (h.length - 1) * gap;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${total} 48`} fill="currentColor" aria-hidden="true">
      {h.map((y, i) => (
        <rect key={i} x={i * (w + gap)} y={(48 - y) / 2} width={w} height={y} rx={w / 2} />
      ))}
    </svg>
  );
}

const two = (n) => String(n).padStart(2, '0');
export const fmtDur = (s) => (s == null ? '' : `${two(Math.floor(s / 60))}:${two(Math.round(s % 60))}`);
export const fmtDurMs = (ms) => fmtDur(Math.round(ms / 1000));

/* The recorder, on its own screen (Leon, July 31).
 *
 * It used to sit in the row where the answers go, with the whole conversation
 * still around it — so a studio talking into their phone was also reading the
 * questions they had already answered. Recording is one thing at a time: the
 * thread goes behind a scrim until the recording is stopped. */
export function RecordingSheet({ rec, note, label = 'Recording' }) {
  return (
    <>
      <div className="recsheet__scrim" />
      <div className="recsheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="cvrec">
          <span className={`cap-orb cap-orb--chat ${rec.status === 'recording' ? 'is-live' : ''}`}>
            <span className="cap-orb__ring" />
            <span className="cap-orb__ring cap-orb__ring--2" />
            <span className="cap-orb__core"><Waveform size={38} /></span>
          </span>
          <span className="cvrec__time">{fmtDurMs(rec.ms)}</span>
          <button className="ck-chip ck-chip--primary" onClick={rec.stop}>
            <span className="cvrec__stop" /> Stop
          </button>
          <span className="cvrec__note">{note}</span>
        </div>
      </div>
    </>
  );
}

export function useRecorder() {
  const [status, setStatus] = useState('idle'); // idle | recording | done | denied
  const [url, setUrl] = useState(null);
  const [blob, setBlob] = useState(null);
  const [ms, setMs] = useState(0);
  const rec = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const started = useRef(0);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = () => {
        const recorded = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
        setBlob(recorded);
        setUrl(URL.createObjectURL(recorded));
        stream.getTracks().forEach((t) => t.stop());
        setStatus('done');
      };
      rec.current = mr;
      mr.start();
      started.current = Date.now();
      timer.current = setInterval(() => setMs(Date.now() - started.current), 100);
      setStatus('recording');
    } catch {
      setStatus('denied');
    }
  };
  const stop = () => {
    clearInterval(timer.current);
    try { rec.current?.stop(); } catch { /* already stopped */ }
  };
  /* back to the beginning — so "record again" starts a clean take rather than
   * resuming a finished one (Leon, July 31) */
  const reset = () => {
    clearInterval(timer.current);
    chunks.current = [];
    setMs(0);
    setUrl(null);
    setBlob(null);
    setStatus('idle');
  };
  useEffect(() => () => clearInterval(timer.current), []);
  return { status, url, blob, ms, start, stop, reset };
}
