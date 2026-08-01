/*
 * PlanLoom — the wait while the week is built (ported from bauhly-v3 RouteLoom).
 *
 * The real generation (POST /routes/generate) runs the competitor + brand +
 * plan chain, which is slower and less predictable than the demo's ~9s. So this
 * is purely presentational: it walks the stage lines and HOLDS on the last one
 * ("Sequencing your posts") until the parent's request resolves — the wait is
 * a beat that describes real work, not a timer racing the backend.
 */

import React, { useEffect, useState } from 'react';
import './plans.css';

const STAGE_MS = 1500;

const STAGES = [
  'Reading your notes',
  'Checking similar studios',
  'Reading your brand',
  'Finding this week\'s focus',
  'Sequencing your posts',
];

export default function PlanLoom() {
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (at >= STAGES.length - 1) return undefined; // hold on the last line
    const t = setTimeout(() => setAt((i) => i + 1), STAGE_MS);
    return () => clearTimeout(t);
  }, [at]);

  return (
    <div className="loom--quiet" role="status" aria-label="Building your week">
      <div className="lm-dots" aria-hidden="true"><i /><i /><i /></div>
      <p className="lm-stage" aria-live="polite" key={at}>{STAGES[Math.min(at, STAGES.length - 1)]}</p>
      <p className="lm-eta">Building a week of posts from your own work — this can take a moment.</p>
    </div>
  );
}
