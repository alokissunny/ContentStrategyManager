/*
 * In-browser reel preview — plays a capture reel's timeline with Remotion's
 * Player while the server is still rendering the MP4. It is the SAME
 * composition the server renders (backend/remotion/src via the @reel alias,
 * see vite.config.js), so what plays here is what the file will be.
 * Lazy-loaded by ReelStudio: Remotion only downloads when a preview shows.
 */
import React from 'react';
import { Player } from '@remotion/player';
import { CaptureReel } from '@reel/CaptureReel';

export default function ReelPreview({ timeline }) {
  const f = timeline.format;
  return (
    <Player
      component={CaptureReel}
      inputProps={{ reel: timeline }}
      durationInFrames={f.durationInFrames}
      fps={f.fps}
      compositionWidth={f.width}
      compositionHeight={f.height}
      style={{ width: '100%', height: '100%' }}
      controls
      autoPlay
      loop
      // browsers block autoplay with sound; the player's controls unmute
      initiallyMuted
      clickToPlay
    />
  );
}
