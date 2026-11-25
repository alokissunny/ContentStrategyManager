/*
 * "What should Bauhly make from this? Pick one." — the format panel at
 * the end of Capture, ported from bauhly-v3 `checkin/FormatPicker.jsx`
 * (editor/selbar-ai-button, decisions 1153–1181).
 *
 * One row per format: the round box on the left ticks it, the rest of the
 * header opens its settings (one row open at a time; ticking opens the row it
 * ticks). It owns only which row is open — every choice goes out through
 * `onChange` and comes back as `make` (lib/formats.js).
 *
 *   Carousel     › How should the slides be laid out? (layout rail)
 *   Reel         › Your material · voiceover · graphics with motion · music
 *                  (only drawn when the capture holds a clip or ≥ 2 photos)
 *   Static post  › Which images should Bauhly use? (one photo, or none = Bauhly decides)
 *   Story        › what happens with a Story (2–4 vertical frames, own agents)
 */
import React, { useState } from 'react';
import Icon from '../brand/Icon';
import { previewUrl } from '../api/media';
import { MAKE, MAKE_IDS, LAYOUTS, canMake, withFormat, fmtClock } from '../lib/formats';
import './formatPicker.css';

function Thumb({ a }) {
  const src = previewUrl(a);
  if (src) return <img src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;
  // a fresh clip has no analysed still yet: the clip's own first frame
  if (a.video && a.url) return <video src={a.url} muted playsInline preload="metadata" />;
  return null;
}

/* the layout wire: hatched = picture, plain = the slide's ground */
function LayoutArt({ id }) {
  if (id === 'auto') {
    return (
      <span className="fmt-lay__art fmt-lay__art--mix" aria-hidden="true">
        <i className="is-bleed" /><i className="is-band" /><i className="is-panel" /><i className="is-editorial" />
      </span>
    );
  }
  return <span className={`fmt-lay__art is-${id}`} aria-hidden="true"><i /></span>;
}

function LayoutStrip({ layout, onPick }) {
  const current = layout || 'auto';
  return (
    <div className="fmt-block">
      <p className="fmt-name">How should the slides be laid out?</p>
      <div className="fmt-strip" role="radiogroup" aria-label="Carousel layout">
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={current === l.id}
            className={`fmt-lay ${current === l.id ? 'is-on' : ''}`.trim()}
            onClick={() => onPick(l.id)}
          >
            <LayoutArt id={l.id === 'full-bleed' ? 'bleed' : l.id === 'split-bands' ? 'band' : l.id === 'floating-panel' ? 'panel' : l.id} />
            <span className="fmt-lay__name">{l.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PickStrip({ assets, images, onChange }) {
  const pick = (images?.ids || [])[0] || null;
  const take = (key) => onChange({ pick: pick === key ? 'auto' : 'own', ids: pick === key ? [] : [key] });
  const pics = assets.filter((a) => !a.video);
  return (
    <div className="fmt-block">
      <p className="fmt-name">Which images should Bauhly use?</p>
      {pics.length > 0 && <p className="fmt-line">Choose your preferred image or leave it unselected to let Bauhly decide.</p>}
      {!pics.length ? (
        <p className="fmt-none">No images available</p>
      ) : (
        <div className="fmt-strip">
          {pics.map((a, i) => (
            <button
              key={a.key}
              type="button"
              className={`fmt-tile fmt-tile--press ${pick === a.key ? 'is-on' : ''}`.trim()}
              aria-pressed={pick === a.key}
              aria-label={pick === a.key ? `Use photo ${i + 1} — press again to let Bauhly choose` : `Use photo ${i + 1}`}
              onClick={() => take(a.key)}
            >
              <span className="fmt-shot">
                <Thumb a={a} />
                <span className="fmt-box" aria-hidden="true">{pick === a.key && <Icon name="check" size={11} strokeWidth={2.75} />}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Opt({ on, onPick, children }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`fmt-opt ${on ? 'is-on' : ''}`.trim()} onClick={onPick}>
      <span className="fmt-dot" aria-hidden="true"><i /></span>
      <span>{children}</span>
    </button>
  );
}

// `voice={false}`: no voiceover question (a landing visitor has no account yet to record the script into)
export default function FormatPicker({ assets = [], make, onChange, onContinue, onExit = null, busy = false, done = false, heading = true, voice = true }) {
  // every row arrives closed (the mock's first frame); ticking or the chevron opens one
  const [open, setOpen] = useState(null);
  const on = (id) => (make.formats || []).includes(id);
  // one format at a time: choosing a row replaces the choice and opens its settings
  const tick = (id) => {
    if (!on(id)) onChange(withFormat(make, id));
    setOpen(id);
  };
  const fold = (id) => setOpen((had) => (had === id ? null : id));
  const reel = (patch) => onChange({ ...make, reel: { ...make.reel, ...patch } });

  const settings = (id) => {
    if (id === 'carousel') return <LayoutStrip layout={make.layout} onPick={(layout) => onChange({ ...make, layout })} />;
    if (id === 'static') return <PickStrip assets={assets} images={make.images} onChange={(images) => onChange({ ...make, images })} />;
    if (id === 'story') {
      return (
        <div className="fmt-block">
          <p className="fmt-name">What happens with a Story?</p>
          <p className="fmt-line">Bauhly plans a short vertical Story from this capture — 2 to 4 frames, with a poll or question where it fits — and adds it to your plan beside any post.</p>
        </div>
      );
    }
    return (
      <>
        {assets.length > 0 && (
          <div className="fmt-block">
            <p className="fmt-name">Your material</p>
            <div className="fmt-strip">
              {assets.map((a) => (
                <span key={a.key} className="fmt-tile">
                  <span className="fmt-shot">
                    <Thumb a={a} />
                    {a.video && <span className="fmt-play" aria-hidden="true"><Icon name="play" size={13} /></span>}
                    {a.video && a.seconds > 0 && <span className="fmt-dur">{fmtClock(a.seconds)}</span>}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
        {voice && <div className="fmt-block">
          <p className="fmt-name">Should it include a voiceover?</p>
          <div className="fmt-opts" role="radiogroup" aria-label="Voiceover">
            <Opt on={make.reel?.say === 'in'} onPick={() => reel({ say: 'in' })}>Include voiceover</Opt>
            <Opt on={make.reel?.say !== 'in'} onPick={() => reel({ say: 'out' })}>No voiceover</Opt>
          </div>
        </div>}
        <div className="fmt-block">
          <p className="fmt-name">Should it include graphics with motion?</p>
          <div className="fmt-opts" role="radiogroup" aria-label="Graphics with motion">
            <Opt on={make.reel?.graphics !== 'out'} onPick={() => reel({ graphics: 'in' })}>Include graphics</Opt>
            <Opt on={make.reel?.graphics === 'out'} onPick={() => reel({ graphics: 'out' })}>No graphics</Opt>
          </div>
        </div>
        <div className="fmt-block">
          <p className="fmt-name">What about music?</p>
          <div className="fmt-opts" role="radiogroup" aria-label="Music">
            <Opt on={make.reel?.music !== 'none'} onPick={() => reel({ music: 'auto' })}>Let Bauhly decide</Opt>
            <Opt on={make.reel?.music === 'none'} onPick={() => reel({ music: 'none' })}>No music</Opt>
          </div>
        </div>
      </>
    );
  };

  // only what this capture can be made into — a format already ticked is always drawn
  const rows = MAKE_IDS.filter((id) => canMake(id, assets) || on(id));
  const picked = (make.formats || []).length;

  return (
    <div className="fmt">
      {heading && <p className="ck-body fmt-q">What should Bauhly make from this? Pick one.</p>}
      <div className="fmt-list" role="radiogroup" aria-label="Format">
        {rows.map((id) => {
          const f = MAKE[id];
          const lit = on(id);
          const shown = open === id;
          return (
            <div key={id} className={`fmt-row ${lit ? 'is-on' : ''} ${shown ? 'is-open' : ''}`.replace(/\s+/g, ' ').trim()}>
              <div className="fmt-head">
                <button
                  type="button"
                  role="radio"
                  aria-checked={lit}
                  aria-label={`Make a ${f.name}`}
                  className="fmt-hit"
                  onClick={() => tick(id)}
                  disabled={done}
                />
                <button
                  type="button"
                  className="fmt-pick"
                  aria-expanded={shown}
                  aria-label={`${shown ? 'Hide' : 'Show'} ${f.name} settings`}
                  onClick={() => fold(id)}
                  disabled={done}
                >
                  <span className="fmt-tick" aria-hidden="true"><Icon name="check" size={12} strokeWidth={2.75} /></span>
                  <span className="fmt-text">
                    <span className="fmt-title">
                      <Icon name={f.icon} size={16} strokeWidth={1.9} />
                      <b>{f.name}</b>
                      {f.reach && <span className="fmt-badge">High reach</span>}
                    </span>
                    <span className="fmt-say">{f.say}</span>
                  </span>
                  <span className="fmt-more" aria-hidden="true"><Icon name="chevron-down" size={15} strokeWidth={2.2} /></span>
                </button>
              </div>
              {shown && <div className="fmt-set"><fieldset className="fmt-fs" disabled={done || undefined}>{settings(id)}</fieldset></div>}
            </div>
          );
        })}
      </div>
      <div className="fmt-acts">
        <button type="button" className="btn btn--primary btn--sm fmt-btn" onClick={onContinue} disabled={busy || done || !picked}>
          {done ? 'Started' : 'Continue'}
        </button>
        {onExit && !done && (
          <button type="button" className="btn btn--sm fmt-btn fmt-btn--quiet" onClick={onExit}>Save and close</button>
        )}
      </div>
    </div>
  );
}
