/*
 * The Editor's ⋯ — ported from bauhly-v3 `src/pages/app/editor/PostMenu.jsx`
 * (`EditorMore`, Sep 25). One menu, three groups: what the slide is made of
 * (Layouts · Themes · Colours), what it wears (Image · Background · Logo), and
 * the carousel it sits in (Copy settings to · Slide · Remove all edits ·
 * Remove slide).
 *
 * Levels open IN PLACE with a back row at the top, as in the reference, rather
 * than as side flyouts. A row that asks "how far does this go?" on a carousel
 * walks one level further to This slide / All slides; on a single-slide post
 * it just applies.
 *
 * Everything the menu does is handed in as `acts` by WeekView; this file only
 * decides what to draw.
 */

import { useRef, useState } from 'react';
import Icon from '../../brand/Icon';
import { COLOUR_ROLES, DEFAULT_PALETTE } from '../../lib/identity';

function Rows({ rows, onClose }) {
  return rows.map((r) => (r.rule ? (
    <span key={r.id} className="wv-em__rule" role="separator" />
  ) : (
    <button
      key={r.id}
      type="button"
      role={r.on === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={r.on === undefined ? undefined : !!r.on}
      disabled={!!r.dead}
      className={`wv-em__row${r.back ? ' wv-em__row--back' : ''}${r.bad ? ' is-danger' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (r.dead) return;
        r.fn?.();
        // `stay`: the act opens its own panel, which hides the menu itself
        if (!r.into && !r.stay) onClose();
      }}
    >
      {r.swatches ? (
        <span className="wv-em__sw" aria-hidden="true">
          {r.swatches.map((hex, i) => <i key={`${r.id}-${i}`} style={{ background: hex || '#e5e2da' }} />)}
        </span>
      ) : (
        <Icon name={r.icon} size={17} strokeWidth={2} />
      )}
      <span className="wv-em__grow">
        <span className="wv-em__label">{r.label}</span>
        {r.hint && <em className="wv-em__hint">{r.hint}</em>}
      </span>
      {r.badge ? <span className="wv-em__chip">{r.badge}</span> : null}
      {r.on ? <Icon name="check" size={16} strokeWidth={2.4} /> : null}
      {((r.into && !r.back && r.on === undefined) || r.chevron)
        ? <Icon name="chevron-right" size={15} strokeWidth={2} /> : null}
    </button>
  )));
}

function FilePick({ inputRef, onFile }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) onFile(f);
      }}
    />
  );
}

export default function EditorMore({ acts, onClose }) {
  const [level, setLevel] = useState(null);
  const n = Math.max(1, acts.slides || 1);
  const many = n > 1;
  // the colour set / background pressed and waiting for its reach
  const [setPick, setSetPick] = useState(null);
  const [bgPick, setBgPick] = useState(false);
  // the direction marked in the theme library, before it is generated
  const [thmPick, setThmPick] = useState(null);
  // a new colour set, started from the set this slide wears (or the kit's)
  const [newHex, setNewHex] = useState(() => ({ ...DEFAULT_PALETTE, ...(acts.setHexes || {}) }));
  const refFile = useRef(null);
  const imgFile = useRef(null);
  const groundFile = useRef(null);
  const logoFile = useRef(null);

  const backRow = (label, to = null) => [
    { id: 'back', icon: 'chevron-left', label, fn: () => setLevel(to), into: true, back: true },
  ];
  // the reach pair every "how far" level ends on
  const reach = (put, { one, all }) => [
    { id: 'one', icon: 'brief', label: 'This slide', hint: one, fn: () => put(false) },
    { id: 'all', icon: 'copy', label: 'All slides', hint: all, fn: () => put(true) },
  ];

  /* ── Themes ─────────────────────────────────────────────────────────── */
  if (level === 'theme') {
    const list = acts.themes || [];
    const chosen = thmPick ? list.find((t) => t.id === thmPick) : null;
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Themes')} />
        <FilePick inputRef={refFile} onFile={(f) => { acts.onReference?.(f); onClose(); }} />
        {!chosen ? (
          <Rows
            onClose={onClose}
            rows={[
              { id: 'ref', icon: 'image-plus', label: 'Upload a reference', hint: 'A photograph you like the look of', dead: acts.busy, fn: () => refFile.current?.click(), into: true },
              { id: 'lib', icon: 'droplet', label: 'Choose from library', hint: `${list.length} directions`, dead: acts.busy, fn: () => setLevel('themelib'), into: true, chevron: true },
            ]}
          />
        ) : (
          <>
            <div className="wv-em__thm">
              <span className="wv-em__thmart"><img src={chosen.thumb} alt="" /></span>
              <span className="wv-em__thmsay">
                <span className="wv-em__thmname">{chosen.name}</span>
                <span className="wv-em__thmnote">From your library</span>
              </span>
              <button
                type="button"
                className="wv-em__thmx"
                aria-label="Choose a different direction"
                onClick={(e) => { e.stopPropagation(); setThmPick(null); }}
              >
                <Icon name="x" size={15} strokeWidth={2.2} />
              </button>
            </div>
            <Rows
              onClose={onClose}
              rows={[
                // the theme agent redraws the whole carousel, so there is one reach
                { id: 'go', icon: 'sparkle', label: 'Generate theme', hint: many ? 'Draws the whole carousel in this direction' : 'Draws this post in the direction above', dead: acts.busy, fn: () => { const t = chosen; setThmPick(null); acts.onTheme?.(t); } },
              ]}
            />
          </>
        )}
      </>
    );
  }
  if (level === 'themelib') {
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Choose from library', 'theme')} />
        <div className="wv-em__grid" role="radiogroup" aria-label="Themes">
          {(acts.themes || []).map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={thmPick === t.id}
              title={t.name}
              className={`wv-em__tile wv-em__tile--theme${acts.themeId === t.id ? ' is-on' : ''}`}
              onClick={(e) => { e.stopPropagation(); setThmPick(t.id); setLevel('theme'); }}
            >
              <img src={t.thumb} alt="" loading="lazy" decoding="async" />
              <span className="wv-em__tilename">{t.name}</span>
            </button>
          ))}
        </div>
      </>
    );
  }

  /* ── Colours ────────────────────────────────────────────────────────── */
  if (level === 'colour') {
    const sets = acts.sets || [];
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Theme colour'),
          ...sets.map((one) => ({
            id: `set-${one.id}`,
            swatches: one.swatches,
            label: one.name,
            hint: acts.setId === one.id ? 'On this slide' : undefined,
            badge: acts.defaultSetId === one.id ? 'Default' : null,
            fn: () => {
              if (!many) { acts.onColour?.(one.id, false); return; }
              setSetPick(one.id);
              setLevel('colour-reach');
            },
            into: many,
            chevron: many,
          })),
          ...(acts.setId ? [{
            id: 'original',
            icon: 'undo',
            label: 'Original colours',
            hint: 'The colours this carousel was made in',
            fn: () => {
              if (!many) { acts.onColour?.('', false); return; }
              setSetPick('');
              setLevel('colour-reach');
            },
            into: many,
            chevron: many,
          }] : []),
          { id: 'r-more', rule: true },
          {
            id: 'colournew',
            icon: 'plus',
            label: 'Create a colour set',
            hint: acts.canNewSet ? 'Three colours, saved to your Brand Kit' : 'Your Brand Kit is full',
            dead: !acts.canNewSet,
            fn: () => setLevel('colour-new'),
            into: true,
            chevron: true,
          },
          ...(many && sets.length > 1 ? [{
            id: 'colourstory',
            icon: 'sparkle',
            label: 'Let the story decide',
            hint: `Bauhly spends the ${sets.length} sets above across the arc`,
            fn: () => { setSetPick({ story: sets.map((x) => x.id) }); setLevel('colour-reach'); },
            into: true,
            chevron: true,
          }] : []),
        ]}
      />
    );
  }
  if (level === 'colour-reach') {
    const story = setPick?.story || null;
    const put = (every) => {
      if (story) acts.onStoryColour?.(story, every);
      else acts.onColour?.(setPick, every);
      setSetPick(null);
    };
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow(story ? 'Let the story decide' : 'Apply the colours', 'colour'),
          ...reach(put, story
            ? { one: 'The colour the story gives this beat', all: 'A colour per beat, across the arc' }
            : { one: 'The others keep theirs', all: 'The whole carousel wears it' }),
        ]}
      />
    );
  }
  if (level === 'colour-new') {
    return (
      <>
        <Rows onClose={onClose} rows={backRow('New colour set', 'colour')} />
        <div className="wv-em__roles">
          {COLOUR_ROLES.map((r) => (
            <label className="wv-em__role" key={r.id}>
              <span className="wv-em__rolecard" style={{ background: newHex[r.id] }} aria-hidden="true" />
              <b>{r.label}</b>
              <em>{String(newHex[r.id] || '').toUpperCase()}</em>
              <input
                type="color"
                value={newHex[r.id] || '#000000'}
                aria-label={`${r.label} colour`}
                onChange={(e) => setNewHex((was) => ({ ...was, [r.id]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <Rows
          onClose={onClose}
          rows={[
            { id: 'r-new', rule: true },
            {
              id: 'savenew',
              icon: 'check',
              label: 'Save and use it',
              hint: 'Kept in your Brand Kit',
              fn: () => {
                const made = acts.onNewSet?.(newHex);
                if (made) acts.onColour?.(made, false);
              },
            },
          ]}
        />
      </>
    );
  }

  /* ── Image ──────────────────────────────────────────────────────────── */
  if (level === 'image') {
    return (
      <>
        <FilePick inputRef={imgFile} onFile={(f) => { acts.onUploadImage?.(f); onClose(); }} />
        <Rows
          onClose={onClose}
          rows={[
            ...backRow('Image'),
            { id: 'imglib', icon: 'image', label: 'Choose from library', hint: 'The project’s own photographs', fn: () => acts.onImageLibrary?.(), stay: true },
            { id: 'imgup', icon: 'upload', label: 'Upload an image', hint: 'A file from this device', dead: acts.uploading, fn: () => imgFile.current?.click(), into: true },
            ...(acts.onAdjust ? [{ id: 'imgedit', icon: 'crop', label: 'Adjust the photo', hint: 'Crop, straighten and tune it', fn: () => acts.onAdjust() }] : []),
          ]}
        />
      </>
    );
  }

  /* ── Background ─────────────────────────────────────────────────────── */
  if (level === 'background') {
    const own = (acts.grounds || []).filter((g) => g.url);
    const wears = acts.groundId || '';
    const put = (id) => {
      if (!many) { acts.onGround?.(id, false); onClose(); return; }
      setBgPick(id);
      setLevel('background-reach');
    };
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Background')} />
        <FilePick inputRef={groundFile} onFile={(f) => { acts.onUploadGround?.(f); onClose(); }} />
        <div className="wv-em__grid" role="radiogroup" aria-label="Backgrounds">
          <button
            type="button"
            role="radio"
            aria-checked={wears === 'none'}
            title="Plain canvas"
            className={`wv-em__tile wv-em__tile--ground wv-em__tile--none${wears === 'none' ? ' is-on' : ''}`}
            onClick={(e) => { e.stopPropagation(); put('none'); }}
          >
            <span className="wv-em__none" aria-hidden="true">
              <Icon name="image-off" size={20} strokeWidth={1.8} />
              <i>Plain canvas</i>
            </span>
          </button>
          {own.map((g) => (
            <button
              key={g.key}
              type="button"
              role="radio"
              aria-checked={wears === g.key}
              title={g.isDefault ? `${g.title || 'Background'} · your Brand Kit default` : (g.title || 'Background')}
              className={`wv-em__tile wv-em__tile--ground${wears === g.key ? ' is-on' : ''}`}
              onClick={(e) => { e.stopPropagation(); put(g.key); }}
            >
              <img src={g.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
        <Rows
          onClose={onClose}
          rows={[
            ...(wears ? [{ id: 'bgoriginal', icon: 'undo', label: 'Original background', hint: 'The ground this carousel was made on', fn: () => put('') , into: many }] : []),
            { id: 'r-bg', rule: true },
            { id: 'groundup', icon: 'upload', label: 'Upload a background', hint: 'Saved to your Brand Kit and put on this slide', fn: () => groundFile.current?.click(), into: true },
          ]}
        />
        <span className="wv-em__pad" aria-hidden="true" />
      </>
    );
  }
  if (level === 'background-reach') {
    const put = (every) => { acts.onGround?.(bgPick === false ? '' : bgPick, every); setBgPick(false); };
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Apply the background', 'background'),
          ...reach(put, { one: 'The others keep theirs', all: 'The whole carousel stands on it' }),
        ]}
      />
    );
  }

  /* ── Logo ───────────────────────────────────────────────────────────── */
  if (level === 'logo') {
    const hasLogo = (acts.logos || []).length > 0;
    const hidden = acts.logoMark === 'off';
    return (
      <>
        <FilePick inputRef={logoFile} onFile={(f) => { acts.onUploadLogo?.(f); onClose(); }} />
        <Rows
          onClose={onClose}
          rows={[
            ...backRow('Logo'),
            ...(hasLogo && hidden ? [{
              id: 'logoon', icon: 'sparkle', label: 'Put it on this slide', hint: 'Your mark, in the post’s own corner', fn: () => acts.onLogo?.(''),
            }] : []),
            ...(hasLogo && !hidden ? [{
              id: 'logoswapkit', icon: 'swatch', label: 'Replace logo', hint: `${acts.logos.length} in your Brand Kit`, fn: () => setLevel('logopick'), into: true, chevron: true,
            }] : []),
            ...(!hasLogo ? [{
              id: 'logoup', icon: 'upload', label: 'Upload your logo', hint: 'Saved to your Brand Kit and put on this slide', dead: acts.uploading, fn: () => logoFile.current?.click(), into: true,
            }] : [{
              id: 'logoswap', icon: 'upload', label: 'Upload a different logo', hint: 'Saved to your Brand Kit and put on this slide', dead: acts.uploading, fn: () => logoFile.current?.click(), into: true,
            }]),
            ...(hasLogo && !hidden ? [
              { id: 'r-logooff', rule: true },
              { id: 'logooff', icon: 'x', label: 'Take it off this slide', hint: 'The others keep theirs', fn: () => acts.onLogo?.('off') },
            ] : []),
          ]}
        />
      </>
    );
  }
  if (level === 'logopick') {
    const wears = acts.logoMark || '';
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Replace logo', 'logo')} />
        <div className="wv-em__grid" role="radiogroup" aria-label="Your marks">
          {(acts.logos || []).map((l) => (
            <button
              key={l.slot}
              type="button"
              role="radio"
              aria-checked={wears === l.slot}
              title={l.name}
              className={`wv-em__tile wv-em__tile--logo${l.inverted ? ' is-dark' : ''}${wears === l.slot ? ' is-on' : ''}`}
              onClick={(e) => { e.stopPropagation(); acts.onLogo?.(l.slot); onClose(); }}
            >
              <img src={l.url} alt="" />
            </button>
          ))}
        </div>
        <Rows
          onClose={onClose}
          rows={[
            { id: 'r-logoauto', rule: true },
            { id: 'logoauto', icon: 'sparkle', label: 'Let Bauhly choose', hint: 'The cut and the ink that suit each slide', on: !wears, fn: () => acts.onLogo?.('') },
          ]}
        />
      </>
    );
  }

  /* ── Copy settings to ───────────────────────────────────────────────── */
  if (level === 'text') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Copy settings to'),
          { id: 'solo', icon: 'brief', label: 'This slide only', hint: 'The others keep their own', on: !acts.sameAll, fn: () => acts.onSameAll?.(false) },
          { id: 'all', icon: 'copy', label: 'All slides', hint: 'Take these settings to every slide', on: !!acts.sameAll, fn: () => acts.onSameAll?.(true) },
        ]}
      />
    );
  }

  /* ── Slide ──────────────────────────────────────────────────────────── */
  if (level === 'slide') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Slide'),
          { id: 'before', icon: 'arrow-left', label: 'Add before', hint: 'A new slide before this one', fn: acts.onAddBefore },
          { id: 'after', icon: 'arrow-right', label: 'Add after', hint: 'A new slide after this one', fn: acts.onAddAfter },
        ]}
      />
    );
  }

  /* ── Remove all edits ───────────────────────────────────────────────── */
  if (level === 'reset') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Remove all edits'),
          { id: 'one', icon: 'brief', label: 'This slide only', hint: 'The others keep theirs', dead: !acts.canResetSlide, fn: () => acts.onReset?.(false) },
          { id: 'every', icon: 'copy', label: 'All slides', hint: many ? `All ${n} go back` : 'Nothing else to put back', dead: !many, fn: () => acts.onReset?.(true) },
        ]}
      />
    );
  }

  /* ── The root ───────────────────────────────────────────────────────── */
  return (
    <Rows
      onClose={onClose}
      rows={[
        { id: 'layouts', icon: 'blocks', label: 'Layouts', hint: 'How this slide is arranged', dead: acts.busy, fn: () => acts.onLayouts?.(), stay: true, chevron: true },
        { id: 'themes', icon: 'droplet', label: 'Themes', hint: 'The direction it wears', fn: () => setLevel('theme'), into: true, chevron: true },
        { id: 'colours', icon: 'swatch', label: 'Colours', hint: 'The set it is drawn in', fn: () => setLevel('colour'), into: true, chevron: true },
        { id: 'r-dress', rule: true },
        { id: 'image', icon: 'image-plus', label: 'Image', hint: 'A photograph on this slide', fn: () => setLevel('image'), into: true, chevron: true },
        { id: 'background', icon: 'image', label: 'Background', hint: 'The ground behind it', fn: () => setLevel('background'), into: true, chevron: true },
        { id: 'logo', icon: 'pin', label: 'Logo', hint: 'Your mark on this slide', fn: () => setLevel('logo'), into: true, chevron: true },
        { id: 'r-on', rule: true },
        ...(many ? [{ id: 'text', icon: 'sliders', label: 'Copy settings to', fn: () => setLevel('text'), into: true }] : []),
        { id: 'slide', icon: 'plus', label: 'Slide', fn: () => setLevel('slide'), into: true },
        ...(acts.onVideoCover ? [{ id: 'cover', icon: 'play', label: acts.coverBusy ? 'Creating cover…' : 'Video cover', hint: 'An animated hook for the first slide', dead: acts.coverBusy, fn: acts.onVideoCover }] : []),
        ...(acts.canReset ? [{ id: 'resetedits', icon: 'undo', label: 'Remove all edits', fn: () => setLevel('reset'), into: true, chevron: true }] : []),
        ...(many ? [
          { id: 'r2', rule: true },
          { id: 'removeslide', icon: 'trash', label: 'Remove slide', hint: 'Takes this frame out of the carousel', fn: acts.onRemoveSlide, bad: true },
        ] : []),
      ]}
    />
  );
}
