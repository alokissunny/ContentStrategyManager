/*
 * THE CONTENT OPPORTUNITY — port of bauhly-v3 `checkin/ContentOpportunity.jsx` (Nov 20, decisions 1133–1146).
 *
 * One card, two appearances: `dark` in the GenPill queue, `light` inside the Capture modal. Same markup and
 * handlers; the tone only swaps a palette (contentOpportunity.css).
 *
 *   head   sparkle · "What could you share next?" · "1 of 3 ›" (only with more than one idea; wraps)
 *   goal   [Reel]  ∿ the mission's goal ("Show your expertise.")
 *   body   the idea's own first photo · title · why, measured to fill the space beside the photo,
 *          with an inline "Show more" at the end of the last visible line
 *   acts   Build Reel (lime) + Discard — each drawn only where it has a handler
 *
 * `lean` is the compact summary once Build Reel has been pressed; `buildDone` keeps that press on the card,
 * greyed (bauhly-v3 decision 1143: "Show it disabled").
 *
 * Fed by the live next-post ideas (GET /api/ideas/next), not the mock's derived offers: the title and the why
 * are the idea agent's own words; the goal line is the mock's authored goal for the idea's content mission.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { mediaDisplayUrl } from '../api/media';
import './contentOpportunity.css';

/* bauhly-v3 lib/opportunity.js GOALS (base reading per mission) */
const GOALS = {
  attract: { goal: 'Reach more potential clients.', why: 'Increase awareness of your studio among relevant audiences who haven’t discovered your work yet.' },
  nurture: { goal: 'Build stronger connections.', why: 'Help people get to know your studio, understand your values, and develop trust over time.' },
  position: { goal: 'Show your expertise.', why: 'Demonstrate your professional knowledge and judgment so potential clients recognize the value of your work.' },
  convert: { goal: 'Turn interest into inquiries.', why: 'Help potential clients understand how your services address their needs and encourage them to take the next step.' },
};
export const goalOf = (mission) => GOALS[mission] || null;

/* the pictures the card can show for an idea, best first: each photo, a clip's poster frame —
   as the light display copy (a small WebP from the CDN, HEIC-safe, never expires), else the URL */
export const ideaShots = (idea) => [
  ...(idea?.assets || []).map((a) => {
    const key = a?.type === 'video' ? a.posterKey : a?.key;
    const url = a?.type === 'video' ? a.posterUrl : a?.url;
    return mediaDisplayUrl(key, 320) || url || '';
  }),
  // an idea with no picture of its own: a display-only cover from the studio's work (server picks it)
  ...(idea?.cover ? [mediaDisplayUrl(idea.cover.key, 320) || idea.cover.url || ''] : []),
].filter(Boolean);
export const ideaShot = (idea) => ideaShots(idea)[0] || null;

/* The description fills the space beside the picture and is measured to do it — a probe paragraph with the
   live node's width and type; binary search over word boundaries for the longest text (plus the tail) that
   fits the budget. Recalculated on text, budget, width and font load. */
const useFittedText = (ref, text, budget, open, tail) => {
  const [cut, setCut] = useState(null);
  const fit = useCallback(() => {
    const el = ref.current;
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!el || open || !budget || !words.length) { setCut(null); return; }
    const probe = document.createElement('p');
    const cs = window.getComputedStyle(el);
    probe.style.cssText = [
      'position:absolute', 'left:-9999px', 'top:0', 'visibility:hidden', 'pointer-events:none',
      'margin:0', 'white-space:normal', 'overflow-wrap:break-word',
      `width:${el.clientWidth}px`,
      `font:${cs.font}`, `line-height:${cs.lineHeight}`, `letter-spacing:${cs.letterSpacing}`,
    ].join(';');
    document.body.appendChild(probe);
    try {
      probe.textContent = String(text);
      if (probe.scrollHeight <= budget) { setCut(null); return; }
      let lo = 0;
      let hi = words.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        probe.textContent = `${words.slice(0, mid).join(' ')}${tail}`;
        if (probe.scrollHeight <= budget) lo = mid; else hi = mid - 1;
      }
      setCut(lo > 0 ? lo : 1);
    } finally {
      probe.remove();
    }
  }, [ref, text, budget, open, tail]);

  useLayoutEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    document.fonts?.ready?.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [ref, fit]);
  return cut;
};

export default function ContentOpportunity({
  ideas = [],
  at = null, // driven position (the queue); null → the card pages itself
  onShow = null, // (index) — a change of position
  tone = 'light',
  lean = false,
  buildDone = false,
  busy = false,
  onBuild = null,
  onDismiss = null,
  tabIndex = 0,
}) {
  const shotEl = useRef(null);
  const titleEl = useRef(null);
  const sayEl = useRef(null);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState(0);
  const [shotAt, setShotAt] = useState(0); // which of the idea's pictures is showing (the next on a failed load)
  const here = ideas.length ? Math.min(at ?? mine, ideas.length - 1) : 0;
  const o = ideas[here] || null;
  const [budget, setBudget] = useState(0);

  // a new idea on screen starts collapsed, on its first picture
  useEffect(() => { setOpen(false); setShotAt(0); }, [o?.id]);

  /* the space beside the picture after the title; two lines is the floor (bauhly-v3: a phone's 3-line
     title would otherwise leave one line and the card would say nothing) */
  const gauge = useCallback(() => {
    const shot = shotEl.current;
    const title = titleEl.current;
    const say = sayEl.current;
    if (!shot || !title || !say) return;
    const cs = window.getComputedStyle(say);
    const gap = parseFloat(cs.marginTop) || 0;
    const line = parseFloat(cs.lineHeight) || 0;
    const beside = shot.getBoundingClientRect().height - title.getBoundingClientRect().height - gap;
    setBudget(Math.max(Math.round(line * 2), Math.round(beside)));
  }, []);
  useLayoutEffect(() => { gauge(); });
  useEffect(() => {
    const shot = shotEl.current;
    if (!shot) return undefined;
    const ro = new ResizeObserver(gauge);
    ro.observe(shot);
    if (titleEl.current) ro.observe(titleEl.current);
    return () => ro.disconnect();
  }, [gauge]);

  const goal = o ? goalOf(o.mission) : null;
  // an idea that fills a content-audit gap says which, in numbers ("Convert is 0 of your last 20 posts.")
  const say = [o?.gap ? o.missionWhy : '', o?.why || goal?.why || ''].filter(Boolean).join(' ').trim();
  const cut = useFittedText(sayEl, say, budget, open, '… Show more');

  if (!o) return null;

  const shots = ideaShots(o);
  const shot = shots[shotAt] || null;
  const words = say.split(/\s+/).filter(Boolean);
  const shown = cut === null ? say : words.slice(0, cut).join(' ');
  const step = () => {
    const next = (here + 1) % ideas.length;
    if (at == null) setMine(next);
    onShow?.(next);
  };

  return (
    <section className={`copp copp--${tone}${lean ? ' copp--lean' : ''}`} aria-label="What could you share next?">
      <header className="copp__head">
        <span className="copp__spark" aria-hidden="true">
          <Icon name="sparkle-ai" size={18} strokeWidth={1.9} />
        </span>
        <h3 className="copp__ask">What could you share next?</h3>
        {ideas.length > 1 && (
          <span className="copp__pager">
            <span className="copp__count">{here + 1} of {ideas.length}</span>
            <button type="button" className="copp__step" onClick={step} aria-label="Next idea" title="Next idea" tabIndex={tabIndex}>
              <Icon name="chevron-right" size={16} strokeWidth={2.2} />
            </button>
          </span>
        )}
      </header>

      <p className="copp__goal">
        <span className="copp__kind">Reel</span>
        {goal && (
          <span className="copp__why">
            <Icon name="pulse" size={14} strokeWidth={2} />
            {goal.goal}
          </span>
        )}
      </p>

      <div className="copp__body">
        <span className="copp__shot" ref={shotEl}>
          {shot
            ? <img key={shot} className="copp__img" src={shot} alt="" loading="lazy" onError={() => setShotAt((n) => n + 1)} />
            : <Icon name="image" size={20} strokeWidth={1.8} />}
        </span>
        <div className="copp__text">
          <h4 className="copp__title" ref={titleEl}>{o.title}</h4>
          {say && (
            <p className="copp__say" ref={sayEl}>
              {shown}
              {cut !== null && !open && (
                <>
                  {'… '}
                  <button type="button" className="copp__more" onClick={() => setOpen(true)} tabIndex={tabIndex}>Show more</button>
                </>
              )}
              {open && (
                <>
                  {' '}
                  <button type="button" className="copp__more" onClick={() => setOpen(false)} tabIndex={tabIndex}>Show less</button>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {(onBuild || onDismiss) && (
        <div className="copp__acts">
          {onBuild && (
            <button
              type="button"
              className="copp__act copp__act--go"
              disabled={buildDone || busy}
              onClick={() => onBuild(o, here)}
              tabIndex={tabIndex}
            >
              Build Reel
            </button>
          )}
          {onDismiss && (
            <button type="button" className="copp__act copp__act--no" onClick={() => onDismiss(o, here)} tabIndex={tabIndex}>
              Discard
            </button>
          )}
        </div>
      )}
    </section>
  );
}
