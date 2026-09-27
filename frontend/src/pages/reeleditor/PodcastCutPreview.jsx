import React, { useEffect, useRef, useState } from 'react';

const clock = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

// The selected audio recording supplies the playback clock. Camera elements
// stay muted and seek relative to their own start times in the simple workflow.
export default function PodcastCutPreview({ assets, plan, aspectRatio, layout = 'camera-cuts', primaryAudioSource = 'host', simple = false, overlayRenderer, onTimeChange, seekRequest }) {
  const [urls, setUrls] = useState({});
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef(null);
  const cameras = useRef({});
  const container = useRef(null);
  const audioAsset = simple ? assets.find(a => a.role === primaryAudioSource) || assets[0] : assets[0];
  const masterStart = Number(audioAsset?.startSec) || 0;
  const duration = plan.durationSec;
  const shot = plan.segments.find(s => time >= s.start && time < s.end) || plan.segments.at(-1);
  const split = layout === 'side-by-side';
  const companion = shot?.assetId === assets[0]?.id ? assets[1] : assets.find(a => a.id === shot?.assetId);
  function placement(asset) {
    const local = simple ? Number(asset.startSec || 0) + time : masterStart + time - (asset.id === assets[0]?.id ? 0 : Number(asset.offsetSec) || 0);
    const inRange = local >= Number(asset.startSec || 0) && local < Number(asset.endSec ?? asset.durationSec);
    return { local, visible: split ? inRange && (asset.id === assets[0]?.id || asset.id === companion?.id) : asset.id === shot?.assetId };
  }
  useEffect(() => {
    const next = Object.fromEntries(assets.map(a => [a.id, URL.createObjectURL(a.file)]));
    setUrls(next);
    return () => Object.values(next).forEach(URL.revokeObjectURL);
  }, [assets.map(a => a.id).join('|')]);
  useEffect(() => {
    audio.current?.pause(); setPlaying(false); setTime(0);
    if (audio.current?.readyState >= 1) audio.current.currentTime = masterStart;
  }, [masterStart, audioAsset?.id, assets.map(a => a.startSec).join('|')]);
  useEffect(() => {
    if (!playing) return;
    let frame;
    const tick = () => {
      const next = Math.max(0, (audio.current?.currentTime || masterStart) - masterStart);
      setTime(Math.min(next, duration));
      if (next >= duration) { audio.current?.pause(); setPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, masterStart]);
  useEffect(() => {
    for (const [id, video] of Object.entries(cameras.current)) {
      if (!video) continue;
      video.muted = true;
      const asset = assets.find(a => a.id === id);
      if (!asset) continue;
      const view = placement(asset);
      if (!view.visible) { video.pause(); continue; }
      const target = split ? view.local : Math.min(shot.sourceEnd, shot.sourceStart + time - shot.start);
      if (video.readyState >= 1 && Math.abs(video.currentTime - target) > (playing ? 0.12 : 0.01)) video.currentTime = target;
      if (playing && video.paused) void video.play().catch(() => {});
      if (!playing) video.pause();
    }
  }, [time, playing, shot, urls, layout, masterStart]);
  function seek(next) {
    setTime(next);
    if (audio.current) audio.current.currentTime = masterStart + next;
  }
  useEffect(() => { onTimeChange?.(time); }, [time, onTimeChange]);
  useEffect(() => { if (seekRequest) { audio.current?.pause(); setPlaying(false); seek(Math.max(0, Math.min(duration, seekRequest.time))); } }, [seekRequest]);
  async function toggle() {
    if (playing) { audio.current?.pause(); return; }
    setError('');
    container.current?.closest('.podcast-generator')?.querySelectorAll('video, audio').forEach(media => {
      if (!container.current.contains(media)) media.pause();
    });
    if (time >= duration) seek(0);
    try { await audio.current.play(); } catch { setError('Could not play the cut preview. Check that the selected audio recording plays in this browser.'); }
  }
  return <section className="podcast-cut-preview" ref={container} aria-label="Episode cut preview">
    <h3>{simple ? 'Host + guest' : 'Preview the proposed edit'}</h3>
    <p className="podcast-muted">{simple ? `Audio: ${primaryAudioSource === 'host' ? 'Host' : 'Guest'} video. The other recording is muted.` : split ? 'Both cameras play together on the same timeline, with audio only from Recording 1. Black panels indicate a recording outside its selected range.' : 'Watch the camera cuts with continuous audio from Recording 1.'}</p>
    <div className="podcast-cut-screen" style={{ containerType: 'inline-size', aspectRatio: aspectRatio === '9:16' ? '9 / 16' : '16 / 9' }}>
      {assets.map(a => urls[a.id] && <video key={a.id} ref={node => { cameras.current[a.id] = node; }} src={urls[a.id]} muted playsInline preload="auto"
        data-active={shot?.assetId === a.id} data-visible={placement(a).visible} style={{ visibility: placement(a).visible ? 'visible' : 'hidden', width: split ? '50%' : '100%', left: split && a.id !== assets[0]?.id ? '50%' : 0 }}
        onLoadedData={() => { if (placement(a).visible) cameras.current[a.id].currentTime = split ? placement(a).local : shot.sourceStart + time - shot.start; }}
        onError={() => setError('A source video cannot be previewed in this browser. Try an H.264 MP4.')} />)}
      {overlayRenderer?.(time)}
      {simple && !overlayRenderer && <div className="podcast-camera-labels"><span>Host</span><span>Guest</span></div>}
    </div>
    {urls[audioAsset?.id] && <audio ref={audio} src={urls[audioAsset.id]} preload="auto" onLoadedMetadata={() => { audio.current.currentTime = masterStart; }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setTime(duration); }} onError={() => setError('Could not play the selected recording’s audio.')} />}
    <div className="podcast-preview-controls"><button type="button" onClick={toggle} disabled={!urls[audioAsset?.id]}>{playing ? 'Pause preview' : 'Play preview'}</button><span>{clock(time)} / {clock(duration)}</span></div>
    <input aria-label="Preview timeline" type="range" min="0" max={duration} step="0.01" value={time} onChange={e => seek(Number(e.target.value))} />
    {!simple && <p className="podcast-muted">{split ? `Side by side: ${assets[0]?.name} + ${companion?.name}` : `Camera: ${shot?.speaker}`} · {plan.segments.length} {plan.segments.length === 1 ? 'shot — no camera switches' : 'shots'}</p>}
    {!simple && <div className="podcast-preview-cuts">{plan.segments.map((s, i) => <button type="button" key={s.id || i} aria-pressed={shot === s} onClick={() => seek(s.start)}>Cut {i + 1} · {clock(s.start)}</button>)}</div>}
    {error && <p role="alert" className="podcast-error">{error}</p>}
  </section>;
}
