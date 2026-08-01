/*
 * "There's more below."
 *
 * The conversation surfaces lift the current turn to the TOP of the view, which
 * means there is often content beneath the fold — and a permanent scrollbar down
 * the side of a calm screen is exactly the kind of chrome this product avoids.
 * So the scrollbar is hidden and this takes its job: a single round button that
 * appears only when you are not at the bottom, and takes you there.
 *
 * It has to watch two different scrollers. On desktop the thread itself scrolls;
 * on mobile the thread just grows and the page scrolls. Which one is live is
 * read from the computed style rather than a breakpoint, so it stays correct if
 * the layout changes.
 */

import { useCallback, useEffect, useState } from 'react';
import Icon from '../../brand/Icon';

/* how close to the bottom still counts as "at the bottom" */
const SLACK = 40;

export default function ScrollJump({ threadRef, tailRef, deps }) {
  const [show, setShow] = useState(false);

  const scroller = useCallback(() => {
    const thread = threadRef.current;
    if (!thread) return null;
    return getComputedStyle(thread).overflowY === 'auto' ? thread : null;
  }, [threadRef]);

  useEffect(() => {
    const el = scroller();
    const read = () => {
      /* the tail is deliberate empty space below the last turn — it exists so
       * the current turn can travel to the top. Counting it as content would
       * leave this button permanently on, pointing at nothing. */
      const tail = tailRef?.current?.offsetHeight || 0;
      if (el) {
        setShow(el.scrollHeight - tail - el.scrollTop - el.clientHeight > SLACK);
      } else {
        const doc = document.documentElement;
        setShow(doc.scrollHeight - tail - window.scrollY - window.innerHeight > SLACK);
      }
    };
    read();
    const target = el || window;
    target.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    /* the thread grows as Bauhly speaks — poll the size, not just the scroll */
    const ro = new ResizeObserver(read);
    if (threadRef.current) ro.observe(threadRef.current);
    return () => {
      target.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
      ro.disconnect();
    };
  }, [scroller, threadRef, tailRef, deps]);

  const jump = () => {
    const el = scroller();
    const tail = tailRef?.current?.offsetHeight || 0;
    if (el) el.scrollTo({ top: el.scrollHeight - tail - el.clientHeight, behavior: 'smooth' });
    else window.scrollTo({ top: document.documentElement.scrollHeight - tail - window.innerHeight, behavior: 'smooth' });
  };

  return (
    <button
      className={`ck__jump ${show ? 'is-on' : ''}`}
      onClick={jump}
      aria-label="Scroll to the latest"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
    >
      <Icon name="arrow-down" size={17} strokeWidth={2.2} />
    </button>
  );
}
