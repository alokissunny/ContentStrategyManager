/*
 * The Editor's ⋯ — ported from bauhly-v3 `src/pages/app/editor/PostMenu.jsx`
 * (`EditorMore`, Sep 28 layout). The root is five categories — Layout · Theme ·
 * Content (Image · Logo) · Style (Colours · Background) · Slide (Add · Copy
 * settings to · Video cover · Remove slide) — and Reset edits under a rule.
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
  // a reference photo picked from the device, shown on the card before it is
  // applied: { file, url (object URL), name }
  const [thmRef, setThmRef] = useState(null);
  // a new colour set, started from the set this slide wears (or the kit's)
  const [newHex, setNewHex] = useState(() => ({ ...DEFAULT_PALETTE, ...(acts.setHexes || {}) }));
  const refFile = useRef(null);
  const imgFile = useRef(null);
  const groundFile = useRef(null);
  const logoFile = useRef(null);

  // Layout: the arrangement marked on the grid, and a composition picture read
  // for one ({ url (object URL), name, id, layName, description })
  const [layPick, setLayPick] = useState(null);
  const [layShot, setLayShot] = useState(null);
  const [layBusy, setLayBusy] = useState(false);
  const [laySaid, setLaySaid] = useState('');
  const layFile = useRef(null);

  const backRow = (label, to = null) => [
    { id: 'back', icon: 'chevron-left', label, fn: () => setLevel(to), into: true, back: true },
  ];
  // the reach pair every "how far" level ends on
  const reach = (put, { one, all }) => [
    { id: 'one', icon: 'brief', label: 'This slide', hint: one, fn: () => put(false) },
    { id: 'all', icon: 'copy', label: 'All slides', hint: all, fn: () => put(true) },
  ];

  /* ── Layout (bauhly-v3 PostMenu `layout`) ────────────────────────────
   * Six arrangements as wireframes, and Upload a composition under them: a
   * picture laid out the way the studio wants, read by AI for its arrangement
   * (it then stands where the grid stood, with what it was read as and an ×).
   * A press MARKS; the act is the pair at the foot — Apply layout to this slide
   * / all slides — and applying is an AI edit of the slide's html. */
  if (level === 'layout') {
    const lays = acts.layouts || {};
    const list = lays.list || [];
    const dropShot = () => {
      if (layShot?.url) { try { URL.revokeObjectURL(layShot.url); } catch { /* already gone */ } }
      setLayShot(null);
    };
    const go = (every) => {
      const id = layPick;
      const comp = layShot ? { description: layShot.description } : null;
      dropShot();
      setLayPick(null);
      setLaySaid('');
      lays.onApply?.(id, every, comp);
      onClose();
    };
    const applyRows = !layPick ? [] : (many ? [
      { id: 'one', icon: 'brief', label: 'Apply layout to this slide', hint: 'The others keep theirs', dead: acts.busy, fn: () => go(false) },
      { id: 'all', icon: 'copy', label: 'Apply layout to all slides', hint: 'The whole carousel takes it', dead: acts.busy, fn: () => go(true) },
    ] : [
      { id: 'go', icon: 'sparkle', label: 'Apply layout to this post', hint: 'Fits this post to that arrangement', dead: acts.busy, fn: () => go(false) },
    ]);
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Layouts')} />
        <FilePick
          inputRef={layFile}
          onFile={async (f) => {
            setLaySaid('');
            setLayBusy(true);
            const url = URL.createObjectURL(f);
            let got = null;
            try { got = await lays.onRead?.(f); } catch { got = null; }
            setLayBusy(false);
            if (!got?.id) {
              URL.revokeObjectURL(url);
              setLaySaid('That picture could not be read');
              return;
            }
            dropShot();
            setLayPick(got.id);
            setLayShot({ url, name: f.name || 'your picture', id: got.id, layName: got.name, description: got.description });
          }}
        />
        {layShot ? (
          <div className="wv-em__thm">
            <span className="wv-em__thmart"><img src={layShot.url} alt="" /></span>
            <span className="wv-em__thmsay">
              <span className="wv-em__thmname">{layShot.layName}</span>
              <span className="wv-em__thmnote" title={layShot.name}>{`Read from ${layShot.name}`}</span>
            </span>
            <button
              type="button"
              className="wv-em__thmx"
              aria-label="Take this picture off"
              onClick={(e) => { e.stopPropagation(); dropShot(); setLayPick(null); }}
            >
              <Icon name="x" size={15} strokeWidth={2.2} />
            </button>
          </div>
        ) : (
          <>
            <div className="wv-em__lays" role="group" aria-label="Layouts">
              {list.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  title={l.name}
                  aria-label={l.name}
                  aria-pressed={layPick === l.id}
                  className={`wv-em__lay wv-em__lay--${l.id}${layPick === l.id ? ' is-pick' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setLayPick(l.id); }}
                >
                  <i aria-hidden="true" />
                </button>
              ))}
            </div>
            <Rows
              onClose={onClose}
              rows={[{
                id: 'layref',
                icon: 'image-plus',
                label: layBusy ? 'Reading your picture…' : 'Upload a composition',
                hint: laySaid || 'A picture laid out the way you want',
                dead: layBusy,
                fn: () => layFile.current?.click(),
                into: true,
                chevron: true,
              }]}
            />
          </>
        )}
        {applyRows.length > 0 && <Rows onClose={onClose} rows={[{ id: 'r-lay', rule: true }, ...applyRows]} />}
      </>
    );
  }

  /* ── Themes ─────────────────────────────────────────────────────────── */
  // A direction is chosen two ways — from the library, or read off a photo the
  // studio uploads — and either way it is shown on a card first, then applied to
  // This slide / All slides (bauhly-v3 `pe-thm` + reach).
  if (level === 'theme') {
    const list = acts.themes || [];
    const chosen = thmRef
      ? { name: 'Your reference', thumb: thmRef.url, note: `Read from ${thmRef.name}` }
      : (thmPick ? list.find((t) => t.id === thmPick) : null);
    const clear = () => {
      if (thmRef?.url) { try { URL.revokeObjectURL(thmRef.url); } catch { /* already gone */ } }
      setThmRef(null);
      setThmPick(null);
    };
    const go = (every) => {
      if (thmRef) {
        const file = thmRef.file;
        setThmRef(null);
        acts.onReference?.(file, every);
        return;
      }
      const t = chosen;
      setThmPick(null);
      acts.onTheme?.(t, every);
    };
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Themes')} />
        <FilePick
          inputRef={refFile}
          onFile={(f) => {
            if (thmRef?.url) { try { URL.revokeObjectURL(thmRef.url); } catch { /* already gone */ } }
            setThmPick(null);
            setThmRef({ file: f, url: URL.createObjectURL(f), name: f.name || 'your photo' });
          }}
        />
        {!chosen ? (
          <Rows
            onClose={onClose}
            rows={[
              { id: 'ref', icon: 'image-plus', label: 'Upload a reference', hint: 'A photograph you like the look of', dead: acts.busy, fn: () => refFile.current?.click(), into: true },
              { id: 'lib', icon: 'droplet', label: 'Choose from library', hint: `${list.length} directions`, dead: acts.busy, fn: () => setLevel('themelib'), into: true, chevron: true },
              ...(acts.themed ? [
                { id: 'r-untheme', rule: true },
                {
                  id: 'untheme',
                  icon: 'undo',
                  label: 'Remove theme',
                  hint: 'Back to the carousel agent’s design',
                  dead: acts.busy,
                  // a carousel asks how far; a single slide just goes back
                  fn: () => (many ? setLevel('theme-remove') : acts.onRemoveTheme?.(true)),
                  into: many,
                  chevron: many,
                },
              ] : []),
            ]}
          />
        ) : (
          <>
            <div className="wv-em__thm">
              <span className="wv-em__thmart"><img src={chosen.thumb} alt="" /></span>
              <span className="wv-em__thmsay">
                <span className="wv-em__thmname">{chosen.name}</span>
                <span className="wv-em__thmnote" title={chosen.note || ''}>{chosen.note || 'From your library'}</span>
              </span>
              <button
                type="button"
                className="wv-em__thmx"
                aria-label="Choose a different direction"
                onClick={(e) => { e.stopPropagation(); clear(); }}
              >
                <Icon name="x" size={15} strokeWidth={2.2} />
              </button>
            </div>
            <Rows
              onClose={onClose}
              // both a reference photo and a library theme go through the Theme
              // Apply agent: the slide is repainted as a finished image
              rows={many ? reach(go, {
                one: 'Repainted in this look — the others keep theirs',
                all: 'Every slide repainted in this look',
              }).map((r) => ({ ...r, dead: acts.busy })) : [
                {
                  id: 'go',
                  icon: 'sparkle',
                  label: 'Generate theme',
                  hint: 'Repaints this post in the look above',
                  dead: acts.busy,
                  fn: () => go(true),
                },
              ]}
            />
          </>
        )}
      </>
    );
  }
  if (level === 'theme-remove') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Remove theme', 'theme'),
          {
            id: 'one',
            icon: 'brief',
            label: 'This slide',
            hint: acts.slideThemed ? 'Only this slide goes back' : 'This slide has no theme',
            dead: acts.busy || !acts.slideThemed,
            fn: () => acts.onRemoveTheme?.(false),
          },
          { id: 'all', icon: 'copy', label: 'All slides', hint: 'The whole carousel as the carousel agent made it', dead: acts.busy, fn: () => acts.onRemoveTheme?.(true) },
        ]}
      />
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
              onClick={(e) => { e.stopPropagation(); setThmRef(null); setThmPick(t.id); setLevel('theme'); }}
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
    /* bauhly-v3 PostMenu `colour` (Sep 28): a press MARKS a set (the tick
       starts on the one the slide wears), and `Generate colours` applies it —
       asking This slide / All slides on a carousel. On a Theme Apply picture
       the set is redrawn by the image model, so it is held in the chat's
       changes and sent from there (see `onColour` in WeekView). */
    const now = acts.setId || '';
    const marked = typeof setPick === 'string' ? setPick : now;
    const goSet = () => {
      if (typeof setPick !== 'string' || setPick === now) return;
      if (!many) { acts.onColour?.(setPick, false); setSetPick(null); onClose(); return; }
      setLevel('colour-reach');
    };
    return (
      <>
        <Rows
          onClose={onClose}
          rows={[
            ...backRow('Theme colour', 'style'),
            ...sets.map((one) => ({
              id: `set-${one.id}`,
              swatches: one.swatches,
              label: one.name,
              hint: acts.defaultSetId === one.id ? 'Your Brand Kit default' : undefined,
              badge: now === one.id ? 'Current' : null,
              on: marked === one.id,
              fn: () => setSetPick(setPick === one.id ? null : one.id),
              into: true,
            })),
            ...(now && !acts.slideThemed ? [{
              id: 'original',
              icon: 'undo',
              label: 'Original colours',
              hint: 'The colours this carousel was made in',
              on: setPick === '',
              fn: () => setSetPick(setPick === '' ? null : ''),
              into: true,
            }] : []),
            { id: 'r-more', rule: true },
            {
              id: 'colournew',
              icon: 'plus',
              label: 'Create a colour set',
              hint: acts.canNewSet ? 'Three of your own' : 'Your Brand Kit is full',
              dead: !acts.canNewSet,
              fn: () => setLevel('colour-new'),
              into: true,
              chevron: true,
            },
            ...(many && sets.length > 1 ? [{
              id: 'colourstory',
              icon: 'sparkle',
              label: 'Let the story decide',
              hint: 'One set per beat',
              fn: () => { setSetPick({ story: sets.map((x) => x.id) }); setLevel('colour-reach'); },
              into: true,
              chevron: true,
            }] : []),
          ]}
        />
        <div className="wv-em__go">
          <button
            type="button"
            className="wv-em__gobtn"
            disabled={typeof setPick !== 'string' || setPick === now}
            onClick={(e) => { e.stopPropagation(); goSet(); }}
          >
            <Icon name="sparkle" size={16} strokeWidth={2.2} />
            Generate colours
          </button>
        </div>
      </>
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
            ...backRow('Image', 'content'),
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
        <Rows onClose={onClose} rows={backRow('Background', 'style')} />
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
            ...backRow('Logo', 'content'),
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
          ...backRow('Copy settings to', 'slide'),
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
          ...(many ? [
            { id: 'r-slide', rule: true },
            { id: 'text', icon: 'sliders', label: 'Copy settings to', fn: () => setLevel('text'), into: true, chevron: true },
          ] : []),
          ...(acts.onVideoCover ? [
            { id: 'r-cover', rule: true },
            { id: 'cover', icon: 'play', label: acts.coverBusy ? 'Creating cover…' : 'Video cover', hint: 'An animated hook for the first slide', dead: acts.coverBusy, fn: acts.onVideoCover },
          ] : []),
          ...(many ? [
            { id: 'r-slidebad', rule: true },
            { id: 'removeslide', icon: 'trash', label: 'Remove slide', hint: 'Takes this frame out of the carousel', fn: acts.onRemoveSlide, bad: true },
          ] : []),
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
          ...backRow('Reset edits'),
          { id: 'one', icon: 'brief', label: 'This slide only', hint: 'The others keep theirs', dead: !acts.canResetSlide, fn: () => acts.onReset?.(false) },
          { id: 'every', icon: 'copy', label: 'All slides', hint: many ? `All ${n} go back` : 'Nothing else to put back', dead: !many, fn: () => acts.onReset?.(true) },
        ]}
      />
    );
  }

  /* ── Content · Style ───────────────────────────────────────────────
     Landings, not copies: every level they open already existed (bauhly-v3
     PostMenu, Sep 28 "five categories"). Text and Graphic from the reference
     are not wired here yet, so Content holds what is. */
  if (level === 'content') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Content'),
          { id: 'image', icon: 'image-plus', label: 'Image', hint: 'A photograph on this slide', fn: () => setLevel('image'), into: true, chevron: true },
          { id: 'logo', icon: 'pin', label: 'Logo', hint: 'Your mark on this slide', fn: () => setLevel('logo'), into: true, chevron: true },
        ]}
      />
    );
  }
  if (level === 'style') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Style'),
          { id: 'colours', icon: 'swatch', label: 'Colours', hint: 'The set this slide is drawn in', fn: () => setLevel('colour'), into: true, chevron: true },
          { id: 'background', icon: 'image', label: 'Background', hint: 'The ground behind it', fn: () => setLevel('background'), into: true, chevron: true },
        ]}
      />
    );
  }

  /* ── The root ───────────────────────────────────────────────────────────
     bauhly-v3's five categories, in the order a studio meets a post, with
     Reset edits under a rule at the foot. */
  return (
    <Rows
      onClose={onClose}
      rows={[
        { id: 'layouts', icon: 'blocks', label: 'Layout', hint: 'How this slide is arranged', dead: acts.busy, fn: () => setLevel('layout'), into: true, chevron: true },
        { id: 'themes', icon: 'droplet', label: 'Theme', hint: 'The direction it wears', fn: () => setLevel('theme'), into: true, chevron: true },
        { id: 'content', icon: 'layers', label: 'Content', hint: 'Image and logo', fn: () => setLevel('content'), into: true, chevron: true },
        { id: 'style', icon: 'swatch', label: 'Style', hint: 'Colours and background', fn: () => setLevel('style'), into: true, chevron: true },
        { id: 'slide', icon: 'copy', label: 'Slide', hint: many ? 'This frame, and the ones around it' : 'Add another frame', fn: () => setLevel('slide'), into: true, chevron: true },
        ...(acts.canReset ? [
          { id: 'r-reset', rule: true },
          { id: 'resetedits', icon: 'undo', label: 'Reset edits', hint: 'Put back what Bauhly made', fn: () => setLevel('reset'), into: true, chevron: true },
        ] : []),
      ]}
    />
  );
}
