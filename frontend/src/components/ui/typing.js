/*
 * ══ A FIELD THAT TYPES ITS OWN EXAMPLES ═════════════════════════
 *
 * Written for the review screen's ask on 1 Nov (Leon: "I want the chatfield
 * placeholder to cycle through different example phrases with a typing
 * animation, so we can show more than one example") and moved here on 2 Nov
 * when the Editor's field asked for the same thing while a slide is being
 * added. Its own file rather than a second export on `index.jsx`, which is
 * what `place.js` and `navhide.js` are the precedent for: a behaviour with
 * no markup of its own does not belong in the file of components.
 *
 * THE FADE IS THE CALLER'S. This owns the cadence and says WHEN a finished
 * phrase is on its way out; the transition that makes it fade is a rule in
 * the caller's own stylesheet, on the caller's own class, because the two
 * fields it serves sit in different places and neither wants the other's
 * look (`.fpv__ask.is-fading` and `.obc.edm-typing`).
 */
import { useEffect, useRef, useState } from 'react';

/* 45ms a character is a hand typing, not a teleprinter. The hold is long
   enough to read a sentence of this length twice over at 200wpm, and the fade
   is `--dur-base` written again in JS — the stylesheet owns the transition and
   this owns when the class comes off, so the two have to agree. The rest are
   plain numbers because `--dur-*` are the lengths of a TRANSITION and none of
   them is a per-character interval; the sentence §3a.3 asks for is that the
   motion scale carries no value for a cadence. */
const TYPE_MS = 45;
const HOLD_MS = 1900;
const FADE_MS = 240;
const GAP_MS = 180;
/*
 * Returns `[text, fading]` — the sentence to show, or `null` when it is not
 * animating and the caller's own placeholder should stand, and whether that
 * sentence is on its way out.
 *
 * A PHRASE IS TYPED IN AND FADED OUT, which is not symmetrical on purpose
 * (Leon, 1 Nov): "fade out the text at the end of each phrase, but keep the
 * typing animation when the next phrase appears". Typing is the field showing
 * what a studio would do; un-typing is nothing a studio does, and the first
 * version's backspacing read as a sentence being taken away rather than one
 * making room for the next.
 *
 * `live` is the caller's whole say in when this runs. It does not stop for
 * the caret — opening `Ask` focuses the field on purpose, so focus is this
 * field's resting state and pausing on it meant the animation never ran once
 * (MEASURED: the examples only appeared after a scripted `blur()`). It stops
 * for a placeholder nobody can see and for the refusal, which has to stay
 * readable.
 * IT LIVES HERE BECAUSE IT HAS TWO CALLERS (Leon, 2 Nov). It was written in
 * `FirstPostPreview` with a note saying it would move when a second one
 * arrived, and one has: the Editor's field cycles examples of its own while
 * a slide is being added before or after this one. Nothing about it changed
 * on the way over — the phrases, when it runs and what the fading class is
 * worn by are all the caller's.
 */
export function useTypedPlaceholder(phrases, live) {
  const at = useRef(0);
  const [text, setText] = useState(() => phrases[0]);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    /* §5: motion explains a state change, and nothing here is a state
       change — it is an advertisement. Under reduced motion the field keeps
       the one sentence it has always had, which is also the kinder answer
       for a reader who is told the field's name every time it changes. */
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setText(null);
      setFading(false);
      return undefined;
    }
    /* ── AND A NEW SET STARTS AT ITS OWN FIRST LINE (MEASURED, 2 Nov) ──
       The Editor hands a different list depending on which side of the slide
       is being added, and this effect re-runs when the list changes — but the
       live branch below never SET the text, it only measured it, so the
       sentence left over from the other list stayed on screen until the
       cycle came round. MEASURED: `Add slide after slide 1` under `Explain
       what happened before this…`, which is the one example that cannot be
       true of it.
       Reset here rather than in an effect of its own, because this runs on
       exactly the two occasions that call for it: the list changed, or the
       field has just opened. Inside a cycle nothing re-runs and the index
       advances as it did. */
    at.current = 0;
    const whole = () => phrases[at.current % phrases.length];
    if (!live) { setText(whole()); setFading(false); return undefined; }
    /* the field opens on a complete sentence rather than an empty box, so
       the first thing it says is readable before anything moves */
    setText(whole());
    let n = whole().length;
    let t = setTimeout(hold, HOLD_MS);
    function hold() { setFading(true); t = setTimeout(next, FADE_MS); }
    function next() {
      at.current += 1;
      n = 0;
      /* cleared and un-faded in one commit, while there is nothing on screen
         to see either happen */
      setText('');
      setFading(false);
      t = setTimeout(tick, GAP_MS);
    }
    function tick() {
      n += 1;
      setText(whole().slice(0, n));
      if (n >= whole().length) { t = setTimeout(hold, HOLD_MS); return; }
      t = setTimeout(tick, TYPE_MS);
    }
    return () => clearTimeout(t);
  }, [live, phrases]);
  return [text, fading];
}

/* ══ AND IT STAYS ON ONE LINE (Leon, 2 Nov) ════════════════════════════════
 *
 * "Fix the typing animation so the placeholder stays on a single line of the
 *  chat field. When the text doesn't fit, truncate it from the beginning
 *  rather than wrapping onto a second line."
 *
 * TRUNCATED AT THE HEAD, which is the part that matters: the end of the
 * sentence is the part being typed, so cutting there would hide the thing
 * that is moving. The field reads like a line being written past the left
 * edge instead — the same way a long path or a long number is shown in this
 * kind of box.
 *
 * MEASURED ON A CANVAS, not in the DOM. The question is asked for every
 * character typed, and a DOM measurement means a write, a reflow and a read
 * forty times a second; `measureText` answers from the same font metrics the
 * field is painted with and touches no layout at all. The pen is made once
 * and kept.
 *
 * `fit` is the caller's: the font the field is set in and the room it has,
 * which only the caller can know (its padding, and the indent a label in
 * front of the sentence takes). A caller with nothing to pass gets the text
 * back untouched, which is what the review screen does — its examples were
 * written to fit.
 */
let pen = null;
const inkOf = (text, font) => {
  if (!pen) pen = document.createElement('canvas').getContext('2d');
  pen.font = font;
  return pen.measureText(text).width;
};
export function clipHead(text, fit) {
  if (!text || !fit?.font || !(fit.width > 0)) return text;
  /* a pixel of slack: the canvas measures the ink and the field paints it
     with hinting, and a sentence that lands exactly on the edge is the one
     that wraps */
  const room = fit.width - 1;
  if (inkOf(text, fit.font) <= room) return text;
  let i = 1;
  while (i < text.length && inkOf(`…${text.slice(i)}`, fit.font) > room) i += 1;
  return `…${text.slice(i)}`;
}
