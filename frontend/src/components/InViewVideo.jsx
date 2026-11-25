/**
 * <video> that plays while it is on screen and pauses when it leaves —
 * the way a reel behaves in a feed — with an Instagram-style speaker button.
 *
 * Why not just `autoPlay muted`: on mobile browsers that is unreliable.
 *  - React sets `muted` only as a DOM property, never the attribute; iOS Safari
 *    decides autoplay from the attribute, so it can refuse to start.
 *  - Unmuted autoplay is blocked outright on phones.
 *  - Several autoplaying videos in a scrolling feed fight for the decoder and
 *    off-screen ones keep downloading.
 * So: start muted (attribute + property), call play() ourselves when ≥50 % is
 * visible, pause when it scrolls away.
 *
 * Sound: phones only let a page play sound after a tap, so the speaker button
 * is how the viewer turns it on. The choice is shared by every reel on the
 * page (tap once, the next reel you scroll to plays with sound too). If the
 * browser still refuses sound for a reel, it plays muted rather than not at all.
 * A viewer's own pause is respected until the video leaves and comes back.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// one sound choice for every reel on the page
let soundOn = false;
const listeners = new Set();
function setSound(on) {
  if (soundOn === on) return;
  soundOn = on;
  listeners.forEach((fn) => fn(on));
}

const BTN = {
  position: 'absolute', right: 10, bottom: 10, zIndex: 3,
  width: 32, height: 32, borderRadius: '50%', border: 0, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(22,22,26,0.62)', color: '#fff', cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
};

function SpeakerIcon({ on }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" />
      {on
        ? <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>
        : <><path d="m23 9-6 6" /><path d="m17 9 6 6" /></>}
    </svg>
  );
}

const InViewVideo = forwardRef(function InViewVideo({ threshold = 0.5, soundButton = true, ...props }, outerRef) {
  const ref = useRef(null);
  const [audible, setAudible] = useState(false);
  useImperativeHandle(outerRef, () => ref.current);

  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');

    let visible = false;
    let userPaused = false;
    let ourPause = false;
    let ourVolume = false;

    const mute = (m) => {
      if (v.muted === m) return;
      ourVolume = true;
      v.muted = m;
    };
    const play = () => {
      if (!visible || userPaused || document.hidden) return;
      mute(!soundOn);
      const p = v.play();
      if (p && p.catch) {
        p.catch((err) => {
          // sound not allowed without a tap — play muted instead
          if (err && err.name === 'NotAllowedError' && !v.muted) {
            mute(true);
            v.play().catch(() => {});
          }
        });
      }
    };
    const pause = () => {
      if (v.paused) return;
      ourPause = true;
      v.pause();
    };
    const onPause = () => {
      if (ourPause) { ourPause = false; return; }
      if (visible && !document.hidden) userPaused = true;
    };
    const onPlay = () => { userPaused = false; };
    const onVolume = () => {
      setAudible(!v.muted);
      if (ourVolume) { ourVolume = false; return; }
      // the viewer used the native controls
      setSound(!v.muted);
    };
    const onSound = (on) => { if (visible) mute(!on); };
    const onVis = () => (document.hidden ? pause() : play());

    v.addEventListener('pause', onPause);
    v.addEventListener('play', onPlay);
    v.addEventListener('volumechange', onVolume);
    document.addEventListener('visibilitychange', onVis);
    listeners.add(onSound);

    let io = null;
    if (typeof IntersectionObserver === 'undefined') {
      visible = true;
      play();
    } else {
      io = new IntersectionObserver(([entry]) => {
        const now = entry.isIntersecting && entry.intersectionRatio >= threshold;
        if (now === visible) return;
        visible = now;
        if (now) { userPaused = false; play(); } else pause();
      }, { threshold: [0, threshold, 1] });
      io.observe(v);
    }

    return () => {
      if (io) io.disconnect();
      listeners.delete(onSound);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('volumechange', onVolume);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [threshold, props.src]);

  const stop = (e) => e.stopPropagation();
  const toggleSound = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const v = ref.current;
    if (!v) return;
    const on = v.muted; // muted now → turn sound on
    setSound(on);
    // inside the tap, so the phone allows sound
    v.muted = !on;
    if (v.paused) v.play().catch(() => {});
  };

  // autoPlay is driven by the observer, never the attribute
  const { autoPlay, ...rest } = props;
  const video = <video ref={ref} muted playsInline loop {...rest} />;
  if (!soundButton) return video;
  return (
    <>
      {video}
      <button
        type="button"
        // native controls own the bottom bar — sit top-left instead
        style={props.controls ? { ...BTN, right: 'auto', bottom: 'auto', top: 10, left: 10 } : BTN}
        aria-label={audible ? 'Mute reel' : 'Turn sound on'}
        aria-pressed={audible}
        onClick={toggleSound}
        onPointerDown={stop}
        onPointerUp={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        onMouseDown={stop}
      >
        <SpeakerIcon on={audible} />
      </button>
    </>
  );
});

export default InViewVideo;
