/*
 * What happens when a layout reference arrives.
 *
 * The brief: Bauhly reads the picture, works out which kind of slide it is an
 * example of, files it there, and pulls out the design characteristics so that
 * category can build its own visual language. The studio only sorts anything
 * by hand when Bauhly is unsure.
 *
 * SO THE PANEL HAS TWO FACES, and which one you get is decided by what Bauhly
 * can actually stand behind (see `analyseReference` in lib/visualbrand.js):
 *
 *   FILED    · it worked the category out. The category is shown, already
 *              chosen, with the reason under it and one press to change it.
 *   ASKING   · it could not tell. Five chips, one press, done — the least
 *              filing a person can be asked to do.
 *
 * ON NOT BLUFFING. There is no vision model in this build. What runs here is
 * real work on the real file — the palette is sampled from the pixels, the
 * shape from the natural dimensions, the ground from the luminance — and the
 * category comes from the studio's own file name when it says so. The panel
 * names its source ("Read from the file name") rather than implying it looked
 * at the composition, and the six characteristics it cannot read yet are
 * listed as what the analysis pass will add rather than filled with a guess.
 * A demo that says "detected: Hooks, 94% confident" over an image nothing
 * looked at is the one thing this product does not do.
 */

import { useRef, useState } from 'react';
import Icon from '../../brand/Icon.jsx';
import { useBodyScrollLock } from './useBodyScrollLock.js';
import { LAYOUT_GROUPS, TRAITS, analyseReference } from '../../lib/visualbrand.js';

export default function ReferenceIntake({ file, onSave, onClose }) {
  useBodyScrollLock();
  const [url] = useState(() => URL.createObjectURL(file));
  const [read, setRead] = useState(null);
  const [group, setGroup] = useState(null);
  /* open on the picker whenever the studio wants to overrule the filing */
  const [picking, setPicking] = useState(false);
  const imgRef = useRef(null);

  /* the read happens once the pixels are there — a palette sampled off an
     unloaded image is a palette of nothing */
  const onLoad = () => {
    const r = analyseReference(file.name, imgRef.current);
    setRead(r);
    setGroup(r.group);
    setPicking(!r.group);
  };
  /* NOT REVOKED HERE (Leon, Aug 4). It was, on unmount — and under StrictMode
     the mount/unmount/mount cycle revoked the URL before the picture had
     loaded, so the read ran against a broken image and every palette came back
     empty (measured: naturalWidth 0). It is also the URL the saved reference
     keeps, so revoking it on close would blank the card that was just made.
     Object URLs live as long as the document, which is exactly as long as an
     added reference lives in this build — see the note under the library. */

  const traits = read?.traits || {};
  const known = TRAITS.filter((t) => t.reads);
  const pending = TRAITS.filter((t) => !t.reads);
  const chosen = LAYOUT_GROUPS.find((g) => g.id === group);

  return (
    <div className="fmodal" role="dialog" aria-modal="true" aria-label="New layout reference">
      <div className="fmodal__card ri">
        <div className="ri__bar">
          <span className="np__title">
            <Icon name="image" size={15} strokeWidth={2} />
            New layout reference
          </span>
          <button className="icobtn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="ri__body">
          <span className="ri__shot">
            <img ref={imgRef} src={url} alt="" onLoad={onLoad} />
          </span>

          <div className="ri__side">
            {!read ? (
              <p className="ri__reading">
                <Icon name="sparkle" size={14} strokeWidth={2} />
                Reading this reference…
              </p>
            ) : (
              <>
                {/* ── where it goes ── */}
                {chosen && !picking ? (
                  <div className="ri__block">
                    <span className="yw-sec__label">Filed under</span>
                    <div className="ri__filed">
                      <b>{chosen.label}</b>
                      <button className="ri__change" onClick={() => setPicking(true)}>Change</button>
                    </div>
                    {read.basis && <span className="ri__basis">{read.basis}</span>}
                  </div>
                ) : (
                  <div className="ri__block">
                    <span className="yw-sec__label">Which kind of slide is this?</span>
                    {/* SAID PLAINLY (the product's rule about thin data). Bauhly
                        did not work it out, so it asks rather than guessing and
                        letting the studio discover the guess later. */}
                    <span className="ri__basis">
                      Bauhly could not tell from the file. One press and it never asks again.
                    </span>
                    <div className="ri__chips">
                      {LAYOUT_GROUPS.map((g) => (
                        <button
                          key={g.id}
                          className={`vb-filter ${group === g.id ? 'is-on' : ''}`}
                          onClick={() => { setGroup(g.id); setPicking(false); }}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── what it teaches that category ── */}
                <div className="ri__block">
                  <span className="yw-sec__label">What Bauhly took from it</span>
                  {traits.palette?.length > 0 && (
                    <div className="ri__trait">
                      <span className="ri__traitlabel">Colour palette</span>
                      <span className="ri__pal">
                        {traits.palette.map((c) => (
                          <i key={c} style={{ background: c }} title={c} />
                        ))}
                      </span>
                    </div>
                  )}
                  {known.filter((t) => t.id !== 'palette' && traits[t.id]).map((t) => (
                    <div className="ri__trait" key={t.id}>
                      <span className="ri__traitlabel">{t.label}</span>
                      <span className="ri__traitval">{traits[t.id]}</span>
                    </div>
                  ))}
                  {/* NAMED, NOT IMPLIED. The six it cannot read are listed so the
                      contract is visible — and so nobody reads the three above
                      as "the analysis is done". */}
                  <p className="ri__pending">
                    <Icon name="info" size={13} strokeWidth={2} />
                    {pending.map((t) => t.label).join(' · ')} are read when the
                    analysis pass runs. This build measures the picture itself, not
                    the design on it.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="ri__acts">
          <span className="ri__scope">
            {chosen
              ? `Used for ${chosen.label.toLowerCase()} layouts only — every category keeps its own look.`
              : 'Pick a category and this is used for those layouts only.'}
          </span>
          <button
            className="btn btn--primary"
            disabled={!group}
            onClick={() => onSave({ group, traits, url })}
          >
            Save reference
          </button>
        </div>
      </div>
    </div>
  );
}
