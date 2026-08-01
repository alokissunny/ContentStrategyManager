/*
 * The conversation engine behind every Bauhly chat surface.
 *
 * One shared hook so the weekly check-in and onboarding speak with exactly the
 * same rhythm: a typing beat, then the message. `say` returns the total delay so
 * callers can sequence what happens next (`after`), which is how a script stays
 * readable — say this, then open that step.
 *
 * Extracted from Checkin.jsx when onboarding became conversational; the capture
 * flow in Projects.jsx still carries its own copy (see TECH_DEBT.md).
 */

import { useEffect, useRef, useState } from 'react';

let nextId = 1;

export function useConversation() {
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const push = (msg) => setMessages((m) => [...m, { id: nextId++, ...msg }]);

  /* Bauhly speaks: a typing beat, then the message(s). Returns total delay
   * so callers can sequence what comes after. */
  const say = (texts, extra = 0) => {
    const list = Array.isArray(texts) ? texts : [texts];
    let delay = 0;
    list.forEach((text, i) => {
      delay += i === 0 ? 550 : 900;
      const at = delay;
      timers.current.push(
        setTimeout(() => setTyping(true), at - 450),
        setTimeout(() => {
          setTyping(false);
          push(typeof text === 'string' ? { from: 'bauhly', text } : { from: 'bauhly', ...text });
        }, at)
      );
    });
    return delay + extra;
  };

  const after = (ms, fn) => timers.current.push(setTimeout(fn, ms));

  /* turns that were already said somewhere else — onboarding starts at
   * /onboarding and continues inside /app, and a thread that restarts at the
   * route boundary makes one conversation look like two. Seeded messages arrive
   * whole, with no typing beat: they are history, not something being said now. */
  const seed = (list) => {
    if (!list?.length) return;
    setMessages((m) => (m.length ? m : list.map((msg) => ({ id: nextId++, ...msg }))));
  };

  /* clear the thread. Used exactly once — when onboarding ends and the weekly
   * planner begins. Leaving the setup conversation on screen above the first
   * real question would keep the user standing in onboarding after it's over. */
  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setTyping(false);
    setMessages([]);
  };

  return { messages, typing, push, say, after, seed, reset };
}

export default useConversation;
