/*
 * Visual Style — the studio's design system, and the little of it they set.
 *
 * WHAT THIS PAGE IS NOW (Leon, Aug 4). It was a read-out: Bauhly sampled the
 * palette off their photographs, showed the type roles it draws, and there was
 * nothing to disagree with. Reading is still the right DEFAULT — a studio
 * should not have to build a palette to get a good one — but a system nobody
 * can correct is a dashboard, not a system.
 *
 * So: Bauhly proposes, the studio adjusts, and the store only holds what they
 * actually changed (`brandStyle`, null until then). A palette they have never
 * touched keeps improving as they capture more work; one they have edited
 * stays exactly as they left it. Every section says which of the two it is on.
 *
 * FIVE SECTIONS, EACH ITS OWN PANEL — Brand colours · Typography ·
 * Backgrounds · Image treatment · Logo.
 *
 * AND EACH ONE ANSWERS ONE QUESTION (Leon, Aug 4 — second pass). The first
 * editable version had a hex field, a role dropdown, a drag handle and a
 * remove on every colour, and four type roles with a face, a size, a weight
 * and a caps toggle each: thirty-odd controls on a page whose whole promise is
 * that the studio does not have to make these decisions. It had become a small
 * design tool, which is the opposite of the product.
 *
 * What is left is choose, upload, replace — and previews doing the explaining:
 *   Colours     three roles, each SHOWN doing its job
 *   Typography  two specimens; the only control is the typeface file
 *   Backgrounds upload and remove
 *   Logo        upload or replace
 *   In action   the whole system on five real slides
 *
 * Bauhly still decides everything else — sizes, weights, spacing, rhythm, how
 * dark a photograph goes behind a headline — because deciding those is what
 * the studio is paying it for.
 *
 * THE STRIP AT THE FOOT IS BACK (Leon, Aug 4). It was cut in §461 as a
 * duplicate of the Layout System tab, and that was the wrong read: there the
 * previews answer "what shapes can a slide take", here they are the only place
 * the studio sees their palette and their faces working together on a finished
 * slide. Same `Preview` component, but the strip hands it their colours — so
 * every swatch above changes five slides in front of them.
 */

import { useEffect, useMemo, useState } from 'react';
import Icon from '../../brand/Icon.jsx';
import { DEMO } from '../../data/demo.js';
import { useStore, setState } from '../../lib/store.js';
import {
  COLOUR_ROLES, TYPE_ROLES_MIN, BASE_GROUNDS, LAYOUTS, LAYOUT_GROUPS, IN_ACTION,
  paletteFrom, readPalette, styleOf, rolesOf, groundOf, groundVars,
} from '../../lib/visualbrand.js';
import { FontsField } from '../../components/FontsField.jsx';
import { Preview } from './LayoutSystem.jsx';

function Section({ title, lead, state, children, actions }) {
  return (
    <section className="vs-sec">
      <header className="vs-sec__head">
        <div className="vs-sec__title">
          <h2>{title}</h2>
          <p>{lead}</p>
        </div>
        {actions}
      </header>
      {state && <span className="vs-sec__state">{state}</span>}
      <div className="vs-sec__body">{children}</div>
    </section>
  );
}

/* ── one colour, doing its job ────────────────────────────────────────────
 * The preview IS the explanation. A studio should not have to read "used for
 * headlines" — they should see a headline in it. The only control is the
 * swatch, which is a colour input wearing the colour.
 */
function ColourCard({ role, hex, roles, onChange }) {
  return (
    <li className="vs-role">
      <span className="vs-role__demo" style={{ background: roles.neutral }}>
        {role.id === 'primary' && (
          <>
            <b style={{ color: hex }}>Why we aligned the materials</b>
            <i style={{ color: hex }}>The stone and timber carry through.</i>
          </>
        )}
        {role.id === 'accent' && (
          <>
            <em style={{ background: hex }}>01</em>
            <b style={{ color: roles.primary }}>Measure before you choose</b>
            <u style={{ background: hex }} />
          </>
        )}
        {role.id === 'neutral' && (
          <>
            <b style={{ color: roles.primary }}>It’s all in the details</b>
            <i style={{ color: roles.primary }}>The ground every type slide sits on.</i>
          </>
        )}
      </span>
      <label className="vs-role__pick">
        <span className="vs-role__chip" style={{ background: hex }}>
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
        </span>
        <span className="vs-role__meta">
          <b>{role.label}</b>
          <span>{role.use}</span>
        </span>
      </label>
    </li>
  );
}

export default function VisualStyle({ refs }) {
  const s = useStore();
  const known = s.brand || {};
  const fonts = { ...DEMO.brand, ...known }.fonts || '';
  const style = useMemo(() => styleOf(s.brandStyle), [s.brandStyle]);
  const write = (patch) => setState({ brandStyle: { ...styleOf(s.brandStyle), ...patch } });

  /* ── the palette Bauhly proposes, read off their own pictures ── */
  const sources = useMemo(() => (refs || []).map((r) => r.url), [refs]);
  const tagged = useMemo(() => (refs || []).flatMap((r) => r.traits?.palette || []), [refs]);
  const [sampled, setSampled] = useState([]);
  useEffect(() => {
    let live = true;
    readPalette(sources, (colours) => { if (live) setSampled(colours); });
    return () => { live = false; };
  }, [sources]);
  const proposed = useMemo(() => paletteFrom([...tagged, ...sampled]), [tagged, sampled]);
  const roles = rolesOf(style, proposed);
  const edited = Boolean(style.colours);

  /* changing one takes all three over: the moment a studio picks a colour the
     palette is theirs and stops being re-read */
  const setRole = (id, hex) => write({ colours: { ...roles, [id]: hex } });

  const addGround = (files) => {
    const next = [...style.grounds];
    [...files].forEach((f) => {
      if (!f.type.startsWith('image/')) return;
      next.push({
        id: `g-${next.length}-${f.name}`,
        label: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '),
        url: URL.createObjectURL(f),
      });
    });
    write({ grounds: next });
  };

  /* ── the five slides at the foot ──
     The real layouts, drawn by the real `Preview`, handed the studio's own
     three colours through the same tokens the component already reads. Nothing
     here re-implements a slide: if the Layout System changes, this changes. */
  const shown = useMemo(
    () => IN_ACTION
      .map((id) => LAYOUTS.find((l) => l.id === id))
      .filter(Boolean)
      .map((l) => ({ l, group: LAYOUT_GROUPS.find((g) => g.id === l.group)?.label || '' })),
    []
  );
  /* the two type-only layouts a background actually reaches — a statement and
     a quote, the same `Preview`, resolved once */
  const ONTOP = useMemo(() => ['H3', 'R3'].map((id) => LAYOUTS.find((l) => l.id === id)).filter(Boolean), []);
  const ground = groundOf(style);

  const live = {
    '--ink-900': roles.primary,
    '--ink-800': roles.primary,
    '--ink-700': `color-mix(in srgb, ${roles.primary} 82%, ${roles.neutral})`,
    '--ink-600': `color-mix(in srgb, ${roles.primary} 74%, ${roles.neutral})`,
    '--ink-500': `color-mix(in srgb, ${roles.primary} 62%, ${roles.neutral})`,
    '--action-accent': roles.accent,
    /* the numerals read `--action-accent-text` first — the product's readable
       orange — and it would win over the studio's accent if it were left set */
    '--action-accent-text': roles.accent,
    '--vs-ground': roles.neutral,
  };


  return (
    <div className="vs-editor">
      {/* ══ BRAND COLOURS ══ */}
      <Section
        title="Brand colours"
        lead="The palette every generated slide draws from."
        state={edited ? (
          <><Icon name="edit" size={12} strokeWidth={2} />Yours — edited by hand, so Bauhly stops re-reading it.</>
        ) : (
          <><Icon name="eye" size={12} strokeWidth={2} />Read from {sources.length} of your own pictures. Change one and the palette becomes yours.</>
        )}
        actions={edited ? (
          <button className="btn btn--tertiary btn--sm" onClick={() => write({ colours: null })}>
            <Icon name="refresh" size={13} strokeWidth={2} />
            Read it again
          </button>
        ) : null}
      >
        <ul className="vs-roles">
          {COLOUR_ROLES.map((r) => (
            <ColourCard
              key={r.id}
              role={r}
              hex={roles[r.id]}
              roles={roles}
              onChange={(hex) => setRole(r.id, hex)}
            />
          ))}
        </ul>
      </Section>

      {/* ══ TYPOGRAPHY ══
          Two specimens and one control. The specimen IS the role — a heading
          set in the display face says more than a field called "Heading". */}
      <Section
        title="Typography"
        lead="The two faces your slides are set in."
        state={<><Icon name="brief" size={12} strokeWidth={2} />Sizes, weights and spacing are Bauhly's — they change with every layout.</>}
      >
        <ul className="vs-faces">
          {TYPE_ROLES_MIN.map((t) => (
            <li className="vs-face" key={t.id}>
              <span
                className={`vs-face__spec is-${t.id}`}
                style={{ fontFamily: t.face === 'display' ? 'var(--font-display)' : 'var(--font-ui)' }}
              >
                {t.id === 'heading'
                  ? 'Why we aligned the materials with the architecture'
                  : 'The stone and timber were selected to carry through the whole floor, so the kitchen reads as part of the room rather than an object in it.'}
              </span>
              <span className="vs-face__meta"><b>{t.label}</b> · {t.use}</span>
            </li>
          ))}
        </ul>
        <FontsField compact value={fonts} onChange={(next) => setState({ brand: { ...known, fonts: next } })} />
      </Section>

      {/* ══ BACKGROUNDS ══
          Upload, pick one, see it. The tile IS the choice — no "set as
          default" button beside it, because a gallery where you press the
          picture and a gallery where you press a link under the picture are
          the same gallery with one more thing to read. */}
      <Section
        title="Backgrounds"
        lead="What a slide is drawn on when there is no room to photograph."
        state={<><Icon name="image" size={12} strokeWidth={2} />The one you choose is the default for everything Bauhly makes from now on.</>}
      >
        <ul className="vs-grounds" role="radiogroup" aria-label="Default background">
          {BASE_GROUNDS.map((g) => (
            <li className="vs-ground" key={g.id}>
              <button
                type="button"
                role="radio"
                aria-checked={ground.id === g.id}
                className={`vs-ground__hit ${ground.id === g.id ? 'is-on' : ''}`}
                onClick={() => write({ ground: g.id })}
              >
                <span className="vs-ground__fill" style={{ background: roles.neutral }} />
                <b>{g.label}{ground.id === g.id && <em className="vs-ground__badge">Default</em>}</b>
                <span>{g.use}</span>
              </button>
            </li>
          ))}
          {style.grounds.map((g) => (
            <li className="vs-ground" key={g.id}>
              <button
                type="button"
                role="radio"
                aria-checked={ground.id === g.id}
                className={`vs-ground__hit ${ground.id === g.id ? 'is-on' : ''}`}
                onClick={() => write({ ground: g.id })}
              >
                <span className="vs-ground__fill" style={{ backgroundImage: `url(${g.url})` }} />
                <b>{g.label}{ground.id === g.id && <em className="vs-ground__badge">Default</em>}</b>
                <span>Yours — Bauhly crops and places it per layout.</span>
              </button>
              <button
                className="icobtn vs-ground__x"
                /* removing the default hands it back to the canvas rather than
                   leaving an id pointing at nothing */
                onClick={() => write({
                  grounds: style.grounds.filter((x) => x.id !== g.id),
                  ground: style.ground === g.id ? 'canvas' : style.ground,
                })}
                aria-label={`Remove ${g.label}`}
              >
                <Icon name="x" size={14} strokeWidth={2.25} />
              </button>
            </li>
          ))}
          <li className="vs-ground vs-ground--add">
            <label className="vs-ground__add">
              <Icon name="plus" size={18} strokeWidth={2.25} />
              Upload a background
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => { addGround(e.target.files); e.target.value = ''; }}
              />
            </label>
          </li>
        </ul>

        {/* ── the chosen one, in use ──
            Directly under the gallery, so choosing and understanding are one
            movement. Two real type-only layouts, because those are the slides
            a background ever reaches. */}
        <div className="vs-ontop" style={{ ...live, ...groundVars(ground, roles.neutral) }}>
          <span className="vs-ontop__label">
            <Icon name="eye" size={13} strokeWidth={2} />
            {ground.label} — how Bauhly will use it
          </span>
          <ul className={`vs-ontop__slides ${ground.own ? 'has-ground' : ''}`}>
            {ONTOP.map((l) => (
              <li key={l.id}>
                <span className="vs-live__frame"><Preview l={l} /></span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ══ LOGO ══
          One question — is there a mark, and what is it. Where it sits went
          with the treatment control: a corner is Bauhly's to pick per layout,
          and the studio was being asked to choose one for slides they had not
          seen yet. */}
      <Section
        title="Logo"
        lead="Your mark, if you want one on the slides."
        state={<><Icon name="info" size={12} strokeWidth={2} />Optional — most studios sign with the account name and nothing else.</>}
      >
        <div className="vs-logo">
          <span className="vs-logo__slot">
            {style.logo.url
              ? <img src={style.logo.url} alt="" />
              : <span className="vs-logo__none">No mark</span>}
          </span>
          <div className="vs-logo__ctrls">
            <div className="vs-logo__row">
              <label className="btn btn--tertiary btn--sm">
                <Icon name="upload" size={14} strokeWidth={2.25} />
                {style.logo.url ? 'Replace' : 'Upload a mark'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    write({ logo: { url: URL.createObjectURL(f), name: f.name, spot: 'auto' } });
                  }}
                />
              </label>
              {style.logo.url && (
                <button
                  className="btn btn--tertiary btn--sm"
                  onClick={() => write({ logo: { url: null, name: null, spot: 'none' } })}
                >
                  Remove
                </button>
              )}
            </div>
            <span className="vs-sec__note">
              Bauhly places it quietly, in the corner the layout leaves free. The file
              itself is not kept in this build — the name is, and it travels into every
              image prompt the way your typefaces do.
            </span>
          </div>
        </div>
      </Section>

      {/* ══ THE WHOLE THING, ON REAL SLIDES ══ */}
      <Section
        title="See your style in action"
        lead="Everything above, applied to one slide from each kind of post."
        state={<><Icon name="eye" size={12} strokeWidth={2} />Live — change a colour and these five change with it.</>}
      >
        <ul
          className={`vs-live ${ground.own ? 'has-ground' : ''}`}
          style={{ ...live, ...groundVars(ground, roles.neutral) }}
        >
          {shown.map(({ l, group }) => (
            <li className="vs-live__item" key={l.id}>
              <span className="vs-live__frame"><Preview l={l} /></span>
              <span className="vs-live__meta"><b>{group}</b>{l.name}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
