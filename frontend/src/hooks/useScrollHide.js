import { useEffect, useState } from 'react';

/* Travels with the scroll gesture so the bottom tab bar can leave and return
 * in step with the finger, the way bauhly-v3's AppShell does. */
export function useScrollHide({ travel = 110, from = 80, ref = null } = {}) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const node = ref?.current || null;
    const posOf = () => (node ? node.scrollTop : window.scrollY);
    const target = node || window;
    let last = posOf();
    let acc = 0;
    let raf = 0;
    const onScroll = () => {
      const y = posOf();
      const d = y - last;
      last = y;
      acc = y < from ? 0 : Math.min(travel, Math.max(0, acc + d));
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setP(acc / travel);
        });
      }
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [travel, from, ref]);
  return p;
}
