/*
 * Visual Brand — the library of pictures Bauhly reasons about the LOOK from.
 *
 * Phases 1–2 of the visual-brand brief. The model, the rules and the
 * arithmetic live in `lib/visualbrand.js`; this is the page over it.
 *
 * THE PAGE READS TOP-DOWN AS: what Bauhly can make → what it is holding back
 * on and why → what it learns from → the pictures themselves. Phase 2 put the
 * use cases at the top and demoted the dimensions: "3 of 5 dimensions covered"
 * is a fact about the library's own filing, and nobody opens this page to hear
 * about filing. They open it to find out whether their covers are going to
 * come out right.
 *
 * WHAT IT IS NOT. Not a settings screen, and not twelve empty upload slots.
 * The brief's principle — "the user should never feel they are configuring
 * AI" — rules out both. So the page opens with what Bauhly can ALREADY see
 * (the studio's own photographs, which have been in Projects all along), and
 * asks only for what a room photograph cannot teach: how words sit on a
 * picture, what colour a made slide may use, how two states of a room are
 * compared.
 *
 * Every ask states what it unlocks. A reference that opens no door is a
 * question Bauhly has no business putting to a studio at 9pm — that is why
 * the free-text "visual language" field was removed from Brand profile once
 * before (see BrandProfile.jsx).
 *
 * HONESTY. Nothing on this page is seeded. A demo account has real
 * photographs (its projects are seeded) and no references, so it opens
 * showing photography covered and three dimensions genuinely empty. That is
 * the true state of a studio that has not curated anything yet, and it is the
 * state the rest of the brief — the empty slide that explains what is missing
 * — is built to respond to.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../brand/Icon.jsx';
import { useStore, setState } from '../../lib/store.js';
import { seedProjects, SEED_VERSION } from '../../lib/projects.js';
import { SLIDE_KINDS, assetsOf } from '../../lib/assets.js';
import LayoutSystem from './LayoutSystem.jsx';
import VisualStyle from './VisualStyle.jsx';
import {
  DIMENSIONS, USE_CASES, dimension, caseOf, allReferences, coverageOf,
  casesOf, summaryOf, ENOUGH,
} from '../../lib/visualbrand.js';
import './visualbrand.css';

/* the slide kinds a dimension unlocks, in the studio's words rather than as
   keys — "Detail crop, Quote, Before / after", never `beforeAfter` */
const unlockNames = (d) => d.unlocks.map((k) => SLIDE_KINDS[k]?.label).filter(Boolean);

/* WHICH DIMENSION AN EXAMPLE OF A USE CASE ACTUALLY IS.
 *
 * "Here is how I want my covers to look" is, mechanically, a lesson about
 * where the words sit — so it files under `layout`, not under a "cover"
 * dimension that would exist only to hold it. The learned dimension is skipped
 * where there is a choice: a picture chosen to demonstrate a cover teaches
 * more about the type on it than about how the room was lit. */
const tagKind = (u) => u.needs.find((n) => !dimension(n)?.learned) || u.needs[0];

/* the bottom line of a dimension card: where it stands, and — where something
 * is actually waiting — what that costs. Never a percentage and never a score;
 * this product states small numbers in counts (see CLAUDE.md §6). */
function stateLine(d, blocked) {
  /* the one dimension nobody feeds by hand says where it came from: a bare
     count with no source reads as a claim */
  if (d.learned) {
    return d.count
      ? `Read from ${d.count} of your own ${d.count === 1 ? 'photo' : 'photos'}`
      : 'Nothing captured yet — every photo you take teaches this';
  }
  /* nothing is waiting on Mood, so it must not say anything is */
  if (d.state === 'optional') return 'Optional — nothing is waiting on it';
  /* COUNTED IN THE SAME THINGS THE GAP ROW NAMES (measured: this card said "4
     slide types waiting" while the row beneath it listed eight posts by name —
     two numbers for one fact on one screen). Both count use cases now. */
  if (d.state === 'none') return `Nothing yet — ${blocked} ${blocked === 1 ? 'kind of slide is' : 'kinds of slide are'} waiting`;
  if (d.state === 'thin') return `${d.count} so far — ${ENOUGH - d.count} more makes it a pattern`;
  return `${d.count} references`;
}

/* ── one dimension, as a card in the top strip ────────────────────────────
 *
 * The strip is the page's answer to the only question a studio has here: what
 * can Bauhly do with what it has? So each card leads with its state, not with
 * a count — the count is the evidence under it.
 */
function DimensionCard({ d, onAdd, onShow, active, blocked = 0 }) {
  return (
    <button
      className={`vb-dim is-${d.state} ${active ? 'is-active' : ''}`}
      onClick={() => (d.count ? onShow() : onAdd())}
    >
      <span className="vb-dim__top">
        <span className="vb-dim__ico"><Icon name={d.icon} size={17} strokeWidth={1.9} /></span>
        <b className="vb-dim__label">{d.label}</b>
        {d.state === 'ready' && (
          <span className="vb-dim__tick"><Icon name="check" size={12} strokeWidth={3} /></span>
        )}
      </span>
      <span className="vb-dim__teaches">{d.teaches}</span>
      <span className="vb-dim__state">{stateLine(d, blocked)}</span>
    </button>
  );
}

/* ── one reference ────────────────────────────────────────────────────────
 *
 * The studio's own photographs carry the project they came from and have no
 * delete: they live in Projects, and a picture that vanished from a client's
 * file because it was tidied out of a moodboard would be the library editing
 * the material it is only supposed to be reading.
 */
function RefCard({ r, onNote, onRemove, showKind }) {
  const d = dimension(r.kind);
  const [noting, setNoting] = useState(false);
  return (
    <li className="vb-ref">
      <span className="vb-ref__shot">
        <img src={r.url} alt="" loading="lazy" />
        {/* The tag wins where there is one: what the studio chose this picture
            FOR outranks the drawer it files under. Failing that, the dimension
            chip — and only while the grid holds more than one, since under a
            filter it is the filter's own label repeated down twelve cards. */}
        {r.useCase
          ? <span className="vb-ref__kind is-use">For {caseOf(r.useCase)?.label.toLowerCase()}</span>
          : showKind && <span className="vb-ref__kind">{d?.label}</span>}
      </span>
      <div className="vb-ref__body">
        <b className="vb-ref__title">{r.title || 'Untitled reference'}</b>
        {/* the note is the studio's, so only they can write one — a photograph
            read out of Projects carries its project instead, which is the only
            thing about it Bauhly actually knows */}
        {onNote ? (noting ? (
          <input
            className="vb-ref__input"
            autoFocus
            defaultValue={r.note || ''}
            placeholder="What do you like about it?"
            onBlur={(e) => { onNote(e.target.value.trim()); setNoting(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
          />
        ) : (
          <button className={`vb-ref__note ${r.note ? '' : 'is-empty'}`} onClick={() => setNoting(true)}>
            {r.note || 'What do you like about it?'}
          </button>
        )) : (
          <span className="vb-ref__src">From {r.projectName}</span>
        )}
      </div>
      {onRemove && (
        <button className="icobtn vb-ref__x" onClick={onRemove} aria-label="Remove this reference">
          <Icon name="x" size={15} strokeWidth={2.25} />
        </button>
      )}
    </li>
  );
}

export default function VisualBrand({ focus = null, group = null, tab = 'overview' }) {
  const s = useStore();
  const projects = s.projects && s.projectsSeedV === SEED_VERSION ? s.projects : seedProjects();
  /* read straight off the store, not `|| []`: a fresh array every render makes
     the memo below useless (and oxlint says so) — DEFAULTS already guarantees it */
  const added = s.visualRefs;
  const refs = useMemo(() => allReferences(added, projects), [added, projects]);
  const cover = useMemo(() => coverageOf(refs), [refs]);
  /* what the studio has photographed, across every project — the layout
     system asks it how many shots a composition can count on */
  const assets = useMemo(
    () => (projects || []).reduce((a, p) => {
      const n = assetsOf(p);
      return { ...a, photos: a.photos + n.photos, videos: a.videos + n.videos };
    }, { photos: 0, videos: 0 }),
    [projects],
  );
  const [filter, setFilter] = useState('all');

  const write = (next) => setState({ visualRefs: next });

  /* SENT HERE BY A SLIDE (Leon, Aug 4). The studio pressed "Add Visual Brand
   * references" on a frame that could not be generated; landing at the top of
   * a page of five dimensions leaves them to find the one they were sent for.
   * The row is scrolled to and marked — marked, not opened: a file chooser
   * springing up from a navigation is the page taking a decision that was not
   * made yet. */
  const gapRef = useRef(null);
  useEffect(() => {
    if (!focus || !gapRef.current) return;
    gapRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus]);

  /* THE FILE IS THE REFERENCE (Leon, Aug 3). Everything else on this page — the
   * dimension it belongs to, what it teaches — is already known from WHERE the
   * studio pressed add. Asking them to fill a form about a picture they just
   * pointed at is the configuration screen this page exists to avoid; the one
   * optional line ("what do you like about it?") is on the card afterwards,
   * where it can be skipped.
   *
   * ON STORAGE, honestly: the picture is an object URL, exactly like every
   * upload in Projects. This build has no backend, so it lasts the session.
   * The note under the grid says so — a moodboard that quietly empties
   * overnight is worse than one that warned you. */
  const add = (kind, files, tag) => {
    const next = [...added];
    [...files].forEach((f) => {
      if (!f.type.startsWith('image/')) return;
      next.push({
        id: `ref-${kind}-${next.length}-${f.name}`,
        kind,
        /* set only when the picture was chosen against a specific thing Bauhly
           makes. A reference added to close a gap teaches every use case that
           gap was blocking, and tagging it to one of them would be a claim
           nobody made. */
        useCase: tag,
        url: URL.createObjectURL(f),
        title: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '),
        note: '',
        source: 'added',
        addedAt: new Date().toISOString(),
      });
    });
    write(next);
    setFilter(kind);
  };

  /* a filter whose last reference has just been removed is a view of nothing
     that also marks a dimension as the one being looked at — it falls back */
  const at = filter !== 'all' && !refs.some((r) => r.kind === filter) ? 'all' : filter;
  const shown = at === 'all' ? refs : refs.filter((r) => r.kind === at);

  /* PHASE 2. What Bauhly makes, not what the library holds. */
  const uses = useMemo(() => casesOf(refs, cover), [refs, cover]);
  const ready = uses.filter((u) => u.state === 'ready');
  const waiting = uses.filter((u) => u.state === 'waiting');
  /* the gaps, still one row per missing DIMENSION rather than one per locked
     use case: eleven rows each asking for the same photograph is eleven ways
     of saying one thing. What changed in phase 2 is what the row names — the
     posts the studio would recognise, not the slide types Bauhly calls them. */
  const gaps = cover
    .filter((d) => !d.learned && d.state === 'none' && d.unlocks.length)
    .map((d) => ({ ...d, opens: waiting.filter((u) => u.missing?.id === d.id) }));

  return (
    <div className="vb">
      {/* ONE SECTION PER TAB (Leon, Aug 4). The Visual Brand had grown into
        * one long page — what Bauhly can make, the gaps, the layouts, the
        * dimensions, the pictures — and a studio looking for their references
        * scrolled past three sections to reach them. The tab row is the same
        * four the reference carries, and each one is now a page. */}
      {tab === 'overview' && (<>
      {/* ── what Bauhly can make ─────────────────────────────────────────
        * The page leads with this now (phase 2). "3 of 5 dimensions covered"
        * is a fact about the library's own filing; a studio opened this page
        * to find out whether their covers are going to come out right. */}
      <section className="vb-sum">
        <div className="vb-sum__head">
          <span className="yw-sec__label">What Bauhly can make</span>
          <p className="vb-sum__line">{summaryOf(uses)}</p>
        </div>

        {ready.length > 0 && (
          <ul className="vb-uses">
            {ready.map((u) => (
              <li key={u.id} className="vb-use">
                <div className="vb-use__body">
                  <b className="vb-use__label">{u.label}</b>
                  <span className="vb-use__what">{u.what}</span>
                </div>
                {/* THE TREATMENT, SHOWN (the phase-2 objective). A use case with
                    its own examples says how THIS kind of slide should look —
                    which is the thing a dimension can only say in general. */}
                {u.refs.length > 0 && (
                  <span className="vb-use__shots">
                    {u.refs.slice(0, 3).map((r) => (
                      <img key={r.id} src={r.url} alt="" loading="lazy" />
                    ))}
                  </span>
                )}
                <button
                  className="vb-use__add"
                  onClick={() => document.getElementById(`vb-file-use-${u.id}`)?.click()}
                >
                  <Icon name="plus" size={13} strokeWidth={2.5} />
                  {u.refs.length ? 'Add another' : 'Show Bauhly how'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* WHAT IS MISSING, AND WHAT IT COSTS (the brief's phase 7, said here
        * first). A gap is not a chore — it is work Bauhly is holding back on
        * rather than guessing at, and the row names that work. */}
      {gaps.length > 0 && (
        <section className="vb-gaps">
          <h2 className="vb-gaps__title">What Bauhly is still holding back on</h2>
          <ul className="vb-gaps__list">
            {gaps.map((d) => (
              <li
                key={d.id}
                ref={d.id === focus ? gapRef : undefined}
                className={`vb-gap ${d.id === focus ? 'is-focus' : ''}`}
              >
                <div className="vb-gap__body">
                  <b className="vb-gap__label">{d.label}</b>
                  <p className="vb-gap__why">{d.ask}</p>
                  <p className="vb-gap__unlocks">
                    <Icon name="lock" size={12} strokeWidth={2} />
                    {d.opens.length
                      ? `Waiting on it: ${d.opens.map((u) => u.label).join(' · ')}`
                      : `Waiting on it: ${unlockNames(d).join(' · ')}`}
                  </p>
                </div>
                <button
                  className="btn btn--tertiary btn--sm"
                  onClick={() => document.getElementById(`vb-file-${d.id}`)?.click()}
                >
                  <Icon name="plus" size={14} strokeWidth={2.5} />
                  Add examples
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      </>)}

      {tab === 'layouts' && (
        <LayoutSystem
          refs={refs}
          assets={assets}
          /* the category a slide sent them here for — see `?layouts=` in
             BrandProfile */
          group={group}
          /* A LAYOUT REFERENCE IS STILL A REFERENCE (Leon, Aug 4). It files
             under `layout` — words on a picture — like any other, so it counts
             towards that dimension and unlocks what that dimension unlocks.
             What is new is `layoutGroup`: the category it was read into, which
             is what scopes it to those layouts and no others. */
          onAdd={(file, r) => write([...added, {
            id: `ref-layout-${added.length}-${file.name}`,
            kind: 'layout',
            layoutGroup: r.group,
            traits: r.traits,
            url: r.url,
            title: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '),
            note: '',
            source: 'added',
            addedAt: new Date().toISOString(),
          }])}
        />
      )}

      {tab === 'style' && <VisualStyle refs={refs} />}

      {tab === 'library' && (<>
      <section className="vb-lib">
        <div className="vb-lib__head">
          <h2 className="vb-lib__title">Your references</h2>
          <div className="vb-filters" role="tablist" aria-label="Filter references">
            <button
              role="tab"
              aria-selected={at === 'all'}
              className={`vb-filter ${at === 'all' ? 'is-on' : ''}`}
              onClick={() => setFilter('all')}
            >
              All <span className="vb-filter__n">{refs.length}</span>
            </button>
            {cover.filter((d) => d.count).map((d) => (
              <button
                key={d.id}
                role="tab"
                aria-selected={at === d.id}
                className={`vb-filter ${at === d.id ? 'is-on' : ''}`}
                onClick={() => setFilter(d.id)}
              >
                {d.label} <span className="vb-filter__n">{d.count}</span>
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 && (
          <p className="vb-refs__none">
            Nothing here yet. Capture a project — or add a few examples above — and this
            fills itself.
          </p>
        )}

        <ul className="vb-refs">
          {shown.map((r) => (
            <RefCard
              key={r.id}
              r={r}
              showKind={at === 'all'}
              onNote={r.source === 'added'
                ? (note) => write(added.map((a) => (a.id === r.id ? { ...a, note } : a)))
                : undefined}
              onRemove={r.source === 'added'
                ? () => write(added.filter((a) => a.id !== r.id))
                : undefined}
            />
          ))}
        </ul>

        <p className="vb-note">
          <Icon name="info" size={13} strokeWidth={2} />
          Your own photographs are read from Projects — they are not copied here, and
          removing one from a project removes it from this library too. References you
          add live in this browser for the session: this build has no backend to keep
          the files in.
        </p>
      </section>
      </>)}
    </div>
  );
}
