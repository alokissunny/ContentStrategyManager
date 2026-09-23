import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import ReelScene from './ReelScene';
import { renderReelVideo, checkAbort } from '../../lib/reelExport';
import { uploadReelClip, finishReelExport, cleanupReelExport } from '../../api/reels';

export default function ReelExportButton({ videoUrl, spec, sourceFile }) {
  const [job, setJob] = useState(null), [time, setTime] = useState(0);
  const [progress, setProgress] = useState(0), [status, setStatus] = useState('');
  const [error, setError] = useState(''), [download, setDownload] = useState('');
  const video = useRef(null), scene = useRef(null), controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), [videoUrl, spec, sourceFile]);
  useEffect(() => { setDownload(''); }, [videoUrl, spec, sourceFile]);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
  useEffect(() => {
    if (!job) return;
    let mounted = true;
    const abort = new AbortController();
    controller.current = abort;
    const signal = abort.signal;
    (async () => {
      const temporaryKeys = [];
      try {
        setStatus('Rendering your reel…');
        const rendered = await renderReelVideo({ scene: scene.current, video: video.current, spec: job.spec, signal,
          setTime: (value) => flushSync(() => setTime(value)), onProgress: (value) => setProgress((previous) => { const next = Math.round(value * 85); return previous === next ? previous : next; }) });
        checkAbort(signal);
        setStatus('Adding the selected audio…');
        const picture = await uploadReelClip(rendered, (value) => setProgress(85 + Math.round(value * .05)), signal, 'reel-export');
        temporaryKeys.push(picture.key);
        checkAbort(signal);
        const source = await uploadReelClip(job.sourceFile, (value) => setProgress(90 + Math.round(value * .05)), signal, 'reel-export');
        temporaryKeys.push(source.key);
        checkAbort(signal);
        const blob = await finishReelExport({ videoKey: picture.key, audioKey: source.key }, signal);
        checkAbort(signal);
        if (mounted) { setDownload(URL.createObjectURL(blob)); setProgress(100); setStatus('Your MP4 is ready.'); }
      } catch (cause) {
        if (mounted) {
          if (signal.aborted) setStatus('Export cancelled. Your edits are saved.');
          else { setError(cause.message || 'Could not export this reel. Please retry.'); setStatus(''); }
        }
      } finally {
        if (mounted) setJob(null);
        // This independent request must run even when the export was cancelled.
        cleanupReelExport(temporaryKeys).catch(() => {});
      }
    })();
    return () => { mounted = false; abort.abort(); };
  }, [job]);
  const start = () => {
    if (job) return;
    setError(''); setDownload(''); setProgress(0); setTime(0);
    setJob({ spec: structuredClone(spec), videoUrl, sourceFile });
  };
  return <div className="reel-download">
    <button type="button" className="btn btn--primary btn--sm" disabled={!!job} onClick={start}>{job ? `Exporting… ${progress}%` : 'Export finished MP4'}</button>
    {job && <button type="button" className="btn btn--ghost btn--sm" onClick={() => controller.current?.abort()}>Cancel</button>}
    {download && <a className="btn btn--primary btn--sm" href={download} download="finished-reel.mp4">Download MP4</a>}
    {job && <progress aria-label="Reel export progress" max="100" value={progress} />}
    {status && <p className="reel-field__hint" role="status">{status}</p>}
    {error && <p className="reel-err" role="alert">{error}</p>}
    <p className="reel-field__hint">Includes captions, graphics, visual overlays, background and selected audio. Keep this tab open while exporting.</p>
    {job && <div className="reel-export-stage" aria-hidden="true"><ReelScene exporting sceneRef={scene} videoRef={video} videoUrl={job.videoUrl} spec={job.spec} time={time} videoProps={{ muted: true }} /></div>}
  </div>;
}
