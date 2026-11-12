import React from 'react';
import { Composition } from 'remotion';
import { z } from 'zod';
import { AnimatedCover } from './AnimatedCover';
import { coverSpecSchema } from './schema';
import { sampleSpec } from './sample';
import { CaptureReel } from './CaptureReel';
import { sampleReel, type ReelSpec } from './reelSchema';

const propsSchema = z.object({ spec: coverSpecSchema });

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="AnimatedCover"
      component={AnimatedCover}
      schema={propsSchema}
      defaultProps={{ spec: sampleSpec }}
      // Dimensions/fps/duration come from the spec so any 4:5, 9:16, or 1:1
      // cover renders from the same composition.
      width={sampleSpec.format.width}
      height={sampleSpec.format.height}
      fps={sampleSpec.format.fps}
      durationInFrames={sampleSpec.format.durationInFrames}
      calculateMetadata={({ props }) => {
        const f = props.spec?.format ?? sampleSpec.format;
        return {
          width: f.width,
          height: f.height,
          fps: f.fps,
          durationInFrames: f.durationInFrames,
        };
      }}
    />
    {/* Capture → reel (services/captureReelAgent.js). Props are validated in
        the backend; the composition only reads them. */}
    <Composition
      id="CaptureReel"
      component={CaptureReel as unknown as React.FC<Record<string, unknown>>}
      defaultProps={{ reel: sampleReel } as Record<string, unknown>}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={sampleReel.format.durationInFrames}
      calculateMetadata={({ props }) => {
        const f = ((props as { reel?: ReelSpec }).reel ?? sampleReel).format;
        return { width: f.width, height: f.height, fps: f.fps, durationInFrames: f.durationInFrames };
      }}
    />
    </>
  );
};
