import React from 'react';
import { Composition } from 'remotion';
import { z } from 'zod';
import { AnimatedCover } from './AnimatedCover';
import { coverSpecSchema } from './schema';
import { sampleSpec } from './sample';

const propsSchema = z.object({ spec: coverSpecSchema });

export const RemotionRoot: React.FC = () => {
  return (
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
  );
};
