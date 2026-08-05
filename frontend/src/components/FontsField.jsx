/*
 * FontsField — the one thing a studio hands over as a FILE.
 *
 * It lived in the Business Profile page (`BrandWords.jsx`) until that page was
 * replaced by Business Memory in Settings (Leon, Aug 4). Memory is prose about
 * the company; a typeface is a binary, and no amount of describing it in a
 * summary gets the name into an image prompt. So it moved here, to the one
 * place that uses it — Visual Style — and the page that held it is gone.
 */

import { useState } from 'react';
import Icon from '../brand/Icon.jsx';

/* ── the typefaces, as files ──────────────────────────────────────────────
 * The fact Bauhly needs is the NAME — it goes into every image prompt's type line —
 * but the thing a studio has is the file. So the file is what you hand over: the
 * name is read from it, and the font is loaded into the page so the specimen below
 * is set in the real thing rather than described.
 *
 * ON HONESTY. The file itself is not stored. This build has no backend, and a font
 * binary is not something to keep in localStorage — so the name persists and the
 * rendering lasts the session. The line under the field says exactly that, because a
 * specimen that quietly reverts to Inter tomorrow is worse than one that warned you.
 */
/* `compact` strips the label, the hint and the storage note — the Visual Style
   page frames the control itself and does not need it introduced three times
   (Leon, Aug 4). One implementation, because the FontFace loading below is the
   part worth not having twice. */
export function FontsField({ label, hint, value, onChange, compact = false }) {
  const [loaded, setLoaded] = useState([]);
  const names = value ? value.split(',').map((n) => n.trim()).filter(Boolean) : [];

  const add = async (files) => {
    const next = [...names];
    for (const file of [...files]) {
      /* the file's own name, minus the extension and the usual weight suffixes —
       * "BricolageGrotesque-Bold.otf" is a file, "Bricolage Grotesque Bold" is a
       * typeface, and the prompt wants the second one */
      const clean = file.name
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
      if (!next.includes(clean)) next.push(clean);
      try {
        const face = new FontFace(clean, await file.arrayBuffer());
        await face.load();
        document.fonts.add(face);
        setLoaded((l) => (l.includes(clean) ? l : [...l, clean]));
      } catch {
        /* an unreadable file still gives us its name, which is the part that
         * travels — the specimen simply stays in the page's own type */
      }
    }
    onChange(next.join(', '));
  };

  const remove = (name) => onChange(names.filter((n) => n !== name).join(', '));

  return (
    <div className={`bp-fonts ${compact ? 'is-compact' : 'card bp-field'}`}>
      {!compact && <span className="yw-sec__label">{label}</span>}
      {!compact && <span className="efield__hint">{hint}</span>}

      {names.length > 0 && (
        <ul className="bp-fonts__list">
          {names.map((n) => (
            <li key={n}>
              <span
                className="bp-fonts__specimen"
                style={loaded.includes(n) ? { fontFamily: `"${n}"` } : undefined}
              >
                {n}
              </span>
              <button className="icobtn" onClick={() => remove(n)} aria-label={`Remove ${n}`}>
                <Icon name="x" size={15} strokeWidth={2.25} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="btn btn--tertiary btn--sm bp-fonts__add">
        <Icon name="plus" size={14} strokeWidth={2.5} />
        {names.length ? 'Add another' : 'Upload a font file'}
        <input
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/*"
          multiple
          hidden
          onChange={(e) => { add(e.target.files); e.target.value = ''; }}
        />
      </label>

      {!compact && (
        <p className="bp-fonts__note">
          <Icon name="info" size={13} strokeWidth={2} />
          The name is what goes into your image prompts, and it is kept. The file itself
          isn't stored in this build — the preview above lasts until you reload.
        </p>
      )}
    </div>
  );
}
