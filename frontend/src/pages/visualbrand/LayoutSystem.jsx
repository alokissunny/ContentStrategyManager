/*
 * The Layout System — the shapes a slide can take.
 *
 * Built to the Layout System reference (Leon, Aug 4), in Bauhly's own system:
 * a header with the counts, a filter row by content type, a grid of layouts
 * each with a drawn preview and one line saying when Bauhly reaches for it,
 * and a foot that states the selection rule.
 *
 * TWO DEPARTURES FROM THE REFERENCE, both deliberate.
 *
 * 1 · **The "Layout rules" panel is gone**, as asked — six paragraphs of
 *     guidance ("always leave room to breathe") that the studio cannot act on
 *     and Bauhly does not read. What replaced it is the foot line, which says
 *     the one thing a rules panel was reaching for: how a layout gets chosen.
 *
 * 2 · **"Active" became READY / WAITING.** The reference marks every card
 *     Active, which for us would be decoration — every layout in a library is
 *     available. What is worth saying is whether Bauhly can reach for THIS one
 *     today, and that is real arithmetic: the dimensions it needs an example of
 *     (lib/visualbrand.js) and the number of photographs it takes. A layout the
 *     studio cannot have yet says which of the two is missing.
 *
 * THE PREVIEWS ARE DRAWN, NOT PHOTOGRAPHED. The reference fills each card with
 * a real interior; ours would either need eighteen photographs Bauhly does not
 * have or would show the same stand-in eighteen times. A layout is a
 * composition, so the preview draws the composition — where the picture sits,
 * where the words go — on the post canvas, in the product's own ink.
 */

import { useMemo, useState } from 'react';
import Icon from '../../brand/Icon.jsx';
import { LAYOUT_GROUPS, layoutsOf, refsForGroup } from '../../lib/visualbrand.js';
import ReferenceIntake from './ReferenceIntake.jsx';

/* how many before "Show the rest" — two rows on a desktop */
const FIRST = 8;

/* ── the previews ────────────────────────────────────────────────────────
 *
 * WORKED EXAMPLES, NOT WIREFRAMES (Leon, Aug 4). The first pass drew grey bars
 * where the type would go; you could see the composition and not the post. A
 * layout is only understood when you can read it, so each preview is a real
 * slide: one of the product's own Quiet-Studio photographs, a real headline in
 * the display face, real supporting text in the UI face, at the spacing the
 * slide would actually use.
 *
 * Everything scales with the card. The frame is a container, and every size in
 * here is in `cqw` — so the same markup reads at 250px in the gallery and would
 * read at 1000px if the card ever grew, and nothing is hand-tuned per breakpoint.
 */
export function Preview({ l }) {
  const s = l.sample || {};
  const eyebrow = s.eyebrow ? <span className="lp__eyebrow">{s.eyebrow}</span> : null;
  const head = s.head ? <span className="lp__h">{s.head}</span> : null;
  const body = s.body ? <span className="lp__b">{s.body}</span> : null;
  /* A LAYOUT WITH NO PICTURE IS STILL A LAYOUT (Leon, Aug 4). The plan draws
     these for slides that have no photograph yet — the shape and the studio's
     own words are the point, and a library photograph in the post preview
     would read as a picture they have. `null` draws the ground it would sit on
     instead of `<img src="null">`. */
  const photo = (src, cls = '') => (
    <span className={`lp__ph ${cls} ${src ? '' : 'is-empty'}`}>
      {src && <img src={src} alt="" loading="lazy" />}
    </span>
  );

  switch (l.shape) {
    /* the photograph, and nothing else — see `X0` in lib/visualbrand.js */
    case 'plain':
      return <span className="lp lp--plain">{photo(l.img)}</span>;
    /* not a shape at all: the card for asking Bauhly to make the picture. In
       the post's own frame the mark is hidden and the slide's words stand on
       their own — a slide always shows its copy, whatever is happening to its
       picture (Leon, Aug 4). */
    case 'gen':
      return (
        <span className="lp lp--gen">
          <span className="lp__gen"><Icon name="sparkle" size={18} strokeWidth={1.9} /></span>
          {s.head ? <span className="lp__words">{head}</span> : null}
        </span>
      );
    /* the photograph is the slide; the words sit on it, at the foot */
    case 'bleed':
    case 'bleed-top':
      return (
        <span className={`lp lp--bleed ${l.shape === 'bleed-top' ? 'is-top' : ''}`}>
          {photo(l.img)}
          <span className="lp__scrim" />
          <span className="lp__words is-on-photo">{eyebrow}{head}{body}</span>
        </span>
      );
    /* words left, picture right — and its mirror */
    case 'split':
    case 'split-rt':
      return (
        <span className={`lp lp--split ${l.shape === 'split-rt' ? 'is-flip' : ''}`}>
          <span className="lp__words">{eyebrow}{head}{body}</span>
          {photo(l.img)}
        </span>
      );
    /* type alone on the studio's canvas */
    case 'poster':
      return (
        <span className="lp lp--poster">
          <span className="lp__words">{eyebrow}{head}{body}</span>
        </span>
      );
    /* picture over the words */
    case 'stack':
      return (
        <span className="lp lp--stack">
          {photo(l.img)}
          <span className="lp__words">{eyebrow}{head}{body}</span>
        </span>
      );
    /* the shape people screenshot: a point, then the steps under it */
    case 'steps':
      return (
        <span className="lp lp--steps">
          <span className="lp__words">
            {head}
            <span className="lp__steps">
              {(s.steps || []).map((t, i) => (
                <span key={t} className="lp__step"><i>{String(i + 1).padStart(2, '0')}</i>{t}</span>
              ))}
            </span>
          </span>
          {photo(l.img)}
        </span>
      );
    /* a mark on the photograph, and the note it points at */
    case 'annotate':
      return (
        <span className="lp lp--bleed">
          {photo(l.img)}
          <span className="lp__pin" />
          <span className="lp__note">{eyebrow}{body}</span>
        </span>
      );
    /* two states of one room */
    case 'duo':
      return (
        <span className="lp lp--duo">
          <span className="lp__half">{photo(l.img)}<em>Before</em></span>
          <span className="lp__half">{photo(l.imgB || l.img)}<em>After</em></span>
          <span className="lp__words is-foot">{head}</span>
        </span>
      );
    /* four rooms, one way of working */
    case 'grid4':
      return (
        <span className="lp lp--grid4">
          <span className="lp__cells">{(l.imgs || []).map((src) => photo(src))}</span>
          <span className="lp__words is-foot">{head}</span>
        </span>
      );
    /* a line worth setting large */
    case 'quote':
      return (
        <span className="lp lp--quote">
          <span className="lp__mark">“</span>
          <span className="lp__words">{head}{body}</span>
        </span>
      );
    /* the crop IS the composition */
    case 'crop':
      return (
        <span className="lp lp--bleed lp--crop">
          {photo(l.img)}
          <span className="lp__cropbox" />
          <span className="lp__scrim" />
          <span className="lp__words is-on-photo">{eyebrow}{head}</span>
        </span>
      );
    /* the palette of a project */
    case 'swatches':
      return (
        <span className="lp lp--swatch">
          {photo(l.img)}
          <span className="lp__words">{eyebrow}{head}{body}</span>
        </span>
      );
    default:
      return (
        <span className="lp lp--poster"><span className="lp__words">{head}</span></span>
      );
  }
}

/* ── one layout ───────────────────────────────────────────────────────────
 * The code and the content type read as one line above the name, the way the
 * reference labels its cards ("Hook · H1").
 *
 * THE STATE ROW WENT (Leon, Aug 4). It sat at the foot of every card saying
 * "Ready" or "Needs words on a picture" — a readiness verdict repeated sixteen
 * times down a gallery whose job is to be browsed. It also made half the page
 * read as unavailable, which is not what a library of shapes is: these are the
 * layouts Bauhly works in, and what is missing to run one is a fact about a
 * SLIDE, not about the layout. The empty slide already says it, in the one
 * place it can be acted on.
 *
 * `layoutsOf()` still computes it — the arithmetic is right and the panel on a
 * slide reads it. It is simply not printed here.
 */
function LayoutCard({ l }) {
  return (
    <li className="ls-card">
      <span className="ls-card__frame"><Preview l={l} /></span>
      <span className="ls-card__meta">{l.groupLabel} · {l.id}</span>
      <b className="ls-card__name">{l.name}</b>
      <span className="ls-card__when">{l.when}</span>
    </li>
  );
}

export default function LayoutSystem({ refs, assets, onAdd, group: opened = null }) {
  const layouts = useMemo(() => layoutsOf(refs, assets), [refs, assets]);
  /* ARRIVING FROM A SLIDE (Leon, Aug 4). The plan's layout picker sends the
     studio here with the category the slide draws from, so they land among the
     layouts they were just choosing between rather than among all sixteen. */
  const [group, setGroup] = useState(opened || 'all');
  const [all, setAll] = useState(false);
  /* the file waiting to be read — see ReferenceIntake */
  const [intake, setIntake] = useState(null);

  const shown = group === 'all' ? layouts : layouts.filter((l) => l.group === group);
  const list = all || group !== 'all' ? shown : shown.slice(0, FIRST);
  const rest = shown.length - list.length;

  return (
    <section className="ls">
      {/* ONE SENTENCE, ONE PLACE (Leon, Aug 4).
        *
        * This row held a three-line rule on the left and a button with its own
        * caption on the right — two blocks of text side by side, competing,
        * and neither obviously about the other. The rule is a description of
        * the tab, so it is in the page head, which is the slot this page
        * already keeps for exactly that. The caption went with it: the intake
        * panel states the scoping at the moment it matters ("Used for hooks
        * layouts only"), which is worth more than a permanent line saying it
        * about nothing in particular.
        *
        * What is left here is the control, alone. */}
      <div className="ls__head">
        <label className="btn btn--primary btn--sm ls__add">
          <Icon name="plus" size={14} strokeWidth={2.5} />
          Add a layout reference
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setIntake(f); }}
          />
        </label>
      </div>

      <div className="ls__filters" role="tablist" aria-label="Filter layouts by content type">
        <button
          role="tab"
          aria-selected={group === 'all'}
          className={`vb-filter ${group === 'all' ? 'is-on' : ''}`}
          onClick={() => setGroup('all')}
        >
          All layouts <span className="vb-filter__n">{layouts.length}</span>
        </button>
        {LAYOUT_GROUPS.map((g) => {
          const n = layouts.filter((l) => l.group === g.id).length;
          /* the references filed under this category — the whole point of the
             intake is that they inform these layouts and no others */
          const own = refsForGroup(refs, g.id).length;
          return (
            <button
              key={g.id}
              role="tab"
              aria-selected={group === g.id}
              className={`vb-filter ${group === g.id ? 'is-on' : ''}`}
              onClick={() => setGroup(g.id)}
            >
              {g.label} <span className="vb-filter__n">{n}</span>
              {own > 0 && <i className="ls-ref" title={`${own} of your references inform these`} />}
            </button>
          );
        })}
      </div>

      {/* ONLY WHEN THERE IS SOMETHING TO SHOW (Leon, Aug 4). The empty branch
        * read "No references for hooks yet — these layouts follow your overall
        * style", which is a sentence about an absence: it appeared on four
        * categories out of five and told the studio nothing they could act on.
        * A category with references says so; one without says nothing. */}
      {group !== 'all' && refsForGroup(refs, group).length > 0 && (() => {
        const own = refsForGroup(refs, group);
        const label = LAYOUT_GROUPS.find((g) => g.id === group)?.label || '';
        return (
          <div className="ls-taught">
            <span className="ls-taught__label">
              <Icon name="swatch" size={13} strokeWidth={2} />
              {own.length} of your references shape {label.toLowerCase()} layouts
            </span>
            <span className="ls-taught__row">
              {own.slice(0, 6).map((r) => (
                <span key={r.id} className="ls-taught__ref">
                  <img src={r.url} alt="" loading="lazy" />
                  {r.traits?.palette?.length > 0 && (
                    <em>{r.traits.palette.slice(0, 4).map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}</em>
                  )}
                </span>
              ))}
            </span>
          </div>
        );
      })()}

      <ul className="ls-grid">
        {list.map((l) => <LayoutCard key={l.id} l={l} />)}
      </ul>

      {rest > 0 && (
        <button className="btn btn--tertiary btn--sm ls__more" onClick={() => setAll(true)}>
          Show {rest} more {rest === 1 ? 'layout' : 'layouts'}
          <Icon name="chevron-right" size={14} strokeWidth={2.5} style={{ transform: 'rotate(90deg)' }} />
        </button>
      )}

      {intake && (
        <ReferenceIntake
          file={intake}
          onClose={() => setIntake(null)}
          onSave={(r) => { onAdd?.(intake, r); setIntake(null); setGroup(r.group); }}
        />
      )}
    </section>
  );
}
