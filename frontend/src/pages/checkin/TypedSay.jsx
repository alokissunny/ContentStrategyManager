/* The line the example's hand writes beside itself where it stops (DemoCursor `rest`). Its own file because a file that
   exports a hook as well as defining a component loses fast refresh (oxlint `only-export-components`). */
import { useEffect, useState } from 'react';

/* ── AND IT IS WRITTEN, AGAIN AND AGAIN, QUIETLY (Leon, Nov 11 — decision 827: "Add a typing animation that reveals the
   text naturally. Once fully typed, keep it visible for a few seconds, then smoothly fade it out and start typing again
   in a loop. Add enough pause between loops so the animation feels subtle and doesn't become distracting or flashy") ──
   a letter every `TYPE_MS` give or take a little (a hand's rhythm, not a ticker's), a beat longer after a space; held
   `HOLD_MS`; faded over `FADE_OUT_MS`, the CSS's `--dur-slow`; nothing for `GAP_MS`; again. */
const TYPE_MS = 55;
const HOLD_MS = 3200;
const FADE_OUT_MS = 420;
const GAP_MS = 2400;
export default function TypedSay({ text }) {
  const [n, setN] = useState(0);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(text.length); return undefined; }
    let t = 0;
    let at = 0;
    const type = () => {
      at += 1;
      setN(at);
      if (at < text.length) {
        const jitter = Math.round((Math.random() - 0.5) * 30);
        t = setTimeout(type, TYPE_MS + jitter + (text[at - 1] === ' ' ? 40 : 0));
        return;
      }
      t = setTimeout(() => {
        setOut(true);
        t = setTimeout(() => {
          at = 0;
          setN(0);
          setOut(false);
          t = setTimeout(type, GAP_MS);
        }, FADE_OUT_MS);
      }, HOLD_MS);
    };
    t = setTimeout(type, 200);
    return () => clearTimeout(t);
  }, [text]);
  /* the whole sentence is held in place from the start (the rest unseen), so nothing beside it moves as it is written */
  return (
    <span className={`ck-cursor__say ${out ? 'is-out' : ''}`.trim()} aria-hidden="true">
      {text.slice(0, n)}
      <span className="ck-cursor__say-rest">{text.slice(n)}</span>
    </span>
  );
}
