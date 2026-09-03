/*
 * Voice capture — the recorder hook and the waveform glyph that represents it.
 *
 * Shared by every surface that can take a voice note: the project capture flow
 * and onboarding both record the same way, so they record with the same code.
 * The hook owns the MediaRecorder lifecycle (including releasing the mic) and
 * reports a denied state honestly rather than pretending to record.
 *
 * While the mic is open, the browser's speech recognizer paints words into
 * the sheet as they are spoken. A pause runs an AI cleanup on those words.
 * After Stop, speech-to-text plus another AI pass replace the draft — unless
 * they have already started editing.
 */

import { useEffect, useRef, useState } from 'react';
import { correctTranscriptLive } from '../../api/projects';

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

/* Swap in a polished transcript only if they have not started editing. */
export function refreshDraftIfUnedited(setDraft, seedRef, next) {
  const polished = String(next || '').trim();
  if (!polished) return;
  setDraft((cur) => {
    const current = String(cur || '');
    if (!current || current === seedRef.current) {
      seedRef.current = polished;
      return polished;
    }
    return cur;
  });
}

function SpeechCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function joinSpoken(left, right) {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`.replace(/\s+/g, ' ');
}

function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function foldWords(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function alreadyHeard(haystack, piece) {
  const a = foldWords(haystack);
  const b = foldWords(piece);
  if (!b) return true;
  return a.endsWith(b);
}

function bestAlternative(result) {
  let best = result[0];
  for (let i = 1; i < result.length; i += 1) {
    if ((result[i].confidence || 0) > (best.confidence || 0)) best = result[i];
  }
  return best?.transcript || '';
}

const SPEECH_LANG_KEY = 'bauhly.captureSpeechLang';
export const CAPTURE_SPEECH_LANGS = [
  { id: 'auto', label: 'Auto' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'hi', label: 'हिन्दी' },
];

export function captureSttLanguages(id) {
  const all = ['en', 'es', 'hi'];
  if (!id || id === 'auto') return all;
  if (all.includes(id)) return [id, ...all.filter((code) => code !== id)];
  return all;
}

function readSpeechLang() {
  try {
    const v = localStorage.getItem(SPEECH_LANG_KEY);
    if (v === 'auto' || v === 'en' || v === 'es' || v === 'hi') return v;
  } catch { /* */ }
  return 'auto';
}

function liveSpeechBcp47(id) {
  if (id === 'es') return 'es-ES';
  if (id === 'hi') return 'hi-IN';
  if (id === 'en') return 'en-US';
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  if (/^hi/i.test(nav)) return 'hi-IN';
  if (/^es/i.test(nav)) return 'es-ES';
  if (/^en/i.test(nav)) return 'en-US';
  return '';
}

/* The recorder, on its own screen (Leon, July 31).
 *
 * It used to sit in the row where the answers go, with the whole conversation
 * still around it — so a studio talking into their phone was also reading the
 * questions they had already answered. Recording is one thing at a time: the
 * thread goes behind a scrim until the recording is stopped. */
export function RecordingSheet({ rec, note, label = 'Recording' }) {
  const liveRef = useRef(null);
  const finishing = rec.status === 'done';
  const showLive = Boolean(rec.liveText);
  useEffect(() => {
    const el = liveRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rec.liveText]);

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
          {showLive && (
            <p
              ref={liveRef}
              className={`cvrec__live${rec.status === 'recording' ? ' is-listening' : ''}`}
              aria-live="polite"
            >
              {rec.liveText}
            </p>
          )}
          {rec.correcting && rec.status === 'recording' && (
            <span className="cvrec__polish">Cleaning the words up…</span>
          )}
          {rec.status === 'recording' && (
            <div className="cvrec__langs" role="radiogroup" aria-label="Spoken language">
              {CAPTURE_SPEECH_LANGS.map((lang) => (
                <button
                  key={lang.id}
                  type="button"
                  role="radio"
                  aria-checked={rec.speechLang === lang.id}
                  className={`cvrec__lang${rec.speechLang === lang.id ? ' is-on' : ''}`}
                  onClick={() => rec.setSpeechLang?.(lang.id)}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
          {finishing ? (
            <span className="cvrec__finishing">Writing it down…</span>
          ) : (
            <button className="ck-chip ck-chip--primary" onClick={rec.stop}>
              <span className="cvrec__stop" /> Stop
            </button>
          )}
          <span className="cvrec__note">{note}</span>
        </div>
      </div>
    </>
  );
}

export function useRecorder(opts = {}) {
  const [status, setStatus] = useState('idle'); // idle | recording | done | denied
  const [url, setUrl] = useState(null);
  const [blob, setBlob] = useState(null);
  const [ms, setMs] = useState(0);
  const [liveText, setLiveText] = useState('');
  const [liveSupported, setLiveSupported] = useState(() => !!SpeechCtor());
  const [correcting, setCorrecting] = useState(false);
  const [speechLang, setSpeechLangState] = useState(readSpeechLang);
  const rec = useRef(null);
  const speech = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const pauseTimer = useRef(null);
  const started = useRef(0);
  const listening = useRef(false);
  const spokenFinal = useRef('');
  const liveTextRef = useRef('');
  const lastPolished = useRef('');
  const lastSent = useRef('');
  const pauseInFlight = useRef(false);
  const keywordsRef = useRef(opts.keywords);
  keywordsRef.current = opts.keywords;
  const speechLangRef = useRef(speechLang);
  speechLangRef.current = speechLang;

  const setLive = (text) => {
    liveTextRef.current = text;
    setLiveText(text);
  };

  const clearPauseTimer = () => {
    if (pauseTimer.current) {
      clearTimeout(pauseTimer.current);
      pauseTimer.current = null;
    }
  };

  const stopRecognitionOnly = () => {
    const recognition = speech.current;
    speech.current = null;
    if (!recognition) return;
    try { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; } catch { /* */ }
    try { recognition.abort(); } catch { /* already stopped */ }
  };

  const releaseSpeech = () => {
    listening.current = false;
    clearPauseTimer();
    stopRecognitionOnly();
  };

  const applyPauseClean = (snapshot, cleaned) => {
    if (!listening.current) return;
    const polished = String(cleaned || '').trim();
    if (!polished) return;
    const finals = String(spokenFinal.current || '').trim();
    if (finals !== snapshot && !finals.startsWith(snapshot)) return;
    const finalTail = finals.startsWith(snapshot) ? finals.slice(snapshot.length).trim() : '';
    spokenFinal.current = joinSpoken(polished, finalTail);
    lastPolished.current = spokenFinal.current;
    const current = String(liveTextRef.current || '').trim();
    const leftover = current.startsWith(snapshot) ? current.slice(snapshot.length).trim() : '';
    const interim = leftover.startsWith(finalTail) ? leftover.slice(finalTail.length).trim() : leftover;
    setLive(joinSpoken(spokenFinal.current, interim));
  };

  const runPauseClean = async () => {
    if (!listening.current || pauseInFlight.current) return;
    const snapshot = String(spokenFinal.current || liveTextRef.current || '').trim();
    if (snapshot.length < 12) return;
    if (snapshot === lastPolished.current || snapshot === lastSent.current) return;
    pauseInFlight.current = true;
    lastSent.current = snapshot;
    setCorrecting(true);
    try {
      const result = await correctTranscriptLive(snapshot, {
        keywords: keywordsRef.current,
        languages: captureSttLanguages(speechLangRef.current),
      });
      applyPauseClean(snapshot, result?.text || '');
    } catch {
      /* keep the live words */
    } finally {
      pauseInFlight.current = false;
      setCorrecting(false);
      if (listening.current) {
        const now = String(spokenFinal.current || liveTextRef.current || '').trim();
        if (now && now !== lastPolished.current) schedulePauseClean(false);
      }
    }
  };

  const schedulePauseClean = (hasInterim) => {
    clearPauseTimer();
    if (!listening.current) return;
    pauseTimer.current = window.setTimeout(runPauseClean, hasInterim ? 1700 : 1200);
  };

  const startLiveSpeech = () => {
    const Ctor = SpeechCtor();
    if (!Ctor) {
      setLiveSupported(false);
      return;
    }
    try {
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;
      const lang = liveSpeechBcp47(speechLangRef.current);
      if (lang) recognition.lang = lang;
      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const piece = bestAlternative(event.results[i]);
          if (event.results[i].isFinal) {
            if (!alreadyHeard(spokenFinal.current, piece)) {
              spokenFinal.current = joinSpoken(spokenFinal.current, piece);
            }
          } else interim += piece;
        }
        setLive(joinSpoken(spokenFinal.current, interim));
        schedulePauseClean(Boolean(interim.trim()));
      };
      recognition.onerror = (event) => {
        const fatal = event.error === 'not-allowed' || event.error === 'service-not-allowed';
        if (fatal) setLiveSupported(false);
      };
      recognition.onend = () => {
        if (!listening.current) return;
        try { recognition.start(); } catch { /* already running */ }
      };
      speech.current = recognition;
      listening.current = true;
      setLiveSupported(true);
      recognition.start();
    } catch {
      setLiveSupported(false);
    }
  };

  const setSpeechLang = (id) => {
    if (id !== 'auto' && id !== 'en' && id !== 'es' && id !== 'hi') return;
    speechLangRef.current = id;
    setSpeechLangState(id);
    try { localStorage.setItem(SPEECH_LANG_KEY, id); } catch { /* */ }
    if (!listening.current) return;
    stopRecognitionOnly();
    startLiveSpeech();
  };

  const start = async () => {
    try {
      spokenFinal.current = '';
      lastPolished.current = '';
      lastSent.current = '';
      pauseInFlight.current = false;
      setCorrecting(false);
      setLive('');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const mimeType = pickRecorderMime();
      const mr = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = () => {
        const recorded = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
        setBlob(recorded);
        setUrl(URL.createObjectURL(recorded));
        stream.getTracks().forEach((t) => t.stop());
        releaseSpeech();
        setCorrecting(false);
        setStatus('done');
      };
      rec.current = mr;
      mr.start();
      startLiveSpeech();
      started.current = Date.now();
      timer.current = setInterval(() => setMs(Date.now() - started.current), 100);
      setStatus('recording');
    } catch {
      releaseSpeech();
      setCorrecting(false);
      setStatus('denied');
    }
  };
  const stop = () => {
    clearInterval(timer.current);
    clearPauseTimer();
    listening.current = false;
    const mr = rec.current;
    const recognition = speech.current;
    let finished = false;
    const finishRecorder = () => {
      if (finished) return;
      finished = true;
      try { mr?.stop(); } catch { /* already stopped */ }
    };
    if (recognition) {
      recognition.onend = finishRecorder;
      try { recognition.stop(); } catch { finishRecorder(); }
      window.setTimeout(finishRecorder, 450);
    } else {
      finishRecorder();
    }
  };
  /* back to the beginning — so "record again" starts a clean take rather than
   * resuming a finished one (Leon, July 31) */
  const reset = () => {
    clearInterval(timer.current);
    clearPauseTimer();
    releaseSpeech();
    chunks.current = [];
    spokenFinal.current = '';
    lastPolished.current = '';
    lastSent.current = '';
    pauseInFlight.current = false;
    setCorrecting(false);
    setLive('');
    setLiveSupported(!!SpeechCtor());
    setMs(0);
    setUrl(null);
    setBlob(null);
    setStatus('idle');
  };
  useEffect(() => () => {
    clearInterval(timer.current);
    clearPauseTimer();
    releaseSpeech();
    try { rec.current?.stop(); } catch { /* already stopped */ }
  }, []);
  return {
    status,
    url,
    blob,
    ms,
    liveText,
    liveSupported,
    correcting,
    speechLang,
    setSpeechLang,
    getLiveText: () => liveTextRef.current,
    start,
    stop,
    reset,
  };
}
