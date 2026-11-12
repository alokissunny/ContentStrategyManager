/*
 * Generate reel › pick a style.
 *
 * First option is Bauhly's default reel (bold hook, karaoke captions,
 * voiceover). Below it, "Choose reel style": reference reels the team has
 * analysed (pacing, hook, on-screen type, captions, music) — the reel is cut
 * in that pattern from this capture's own photos and words, with an original
 * music bed. Any public reel can be added by pasting its link: it is
 * analysed in the background (~30 s) and becomes a style you can pick.
 * An optional note steers either one.
 */
import React, { useEffect, useState } from 'react';
import Icon from '../../brand/Icon';
import { useBodyScrollLock } from '../checkin/ui';
import { listReelStyles, addReelStyle, removeReelStyle } from '../../api/captureReels';
import './reelStudio.css';

export const DEFAULT_STYLE = '';

export default function ReelStyleModal({ count = 1, initialStyleId = DEFAULT_STYLE, onClose, onGenerate }) {
  useBodyScrollLock();
  const [styles, setStyles] = useState(null);
  const [pick, setPick] = useState(initialStyleId);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [link, setLink] = useState('');
  const [adding, setAdding] = useState(false);
  const [linkErr, setLinkErr] = useState('');
  const [waitFor, setWaitFor] = useState(''); // a pasted reel: picked once it is ready

  useEffect(() => {
    let alive = true;
    listReelStyles()
      .then((list) => { if (alive) setStyles(list); })
      .catch(() => { if (alive) { setStyles([]); setErr('Reel styles could not be loaded — the default is still available.'); } });
    return () => { alive = false; };
  }, []);

  // while a pasted reel is being analysed, re-read the list
  const analysing = (styles || []).some((s) => s.status === 'analyzing');
  useEffect(() => {
    if (!analysing) return undefined;
    const t = setInterval(() => {
      listReelStyles().then((list) => {
        setStyles(list);
        const done = list.find((x) => x.id === waitFor);
        if (done?.status === 'ready') { setPick(done.id); setWaitFor(''); }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [analysing, waitFor]);

  const addLink = async () => {
    const url = link.trim();
    setLinkErr('');
    if (!/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reels?|p|tv)\/[A-Za-z0-9_-]{5,}/i.test(url)) {
      setLinkErr('Paste a link to an Instagram reel, like instagram.com/reel/…');
      return;
    }
    setAdding(true);
    try {
      const st = await addReelStyle(url);
      setStyles((cur) => [...(cur || []).filter((x) => x.id !== st.id), st]);
      setLink('');
      if (st.status === 'ready') setPick(st.id); else setWaitFor(st.id);
    } catch (e) {
      setLinkErr(e?.response?.data?.message || 'That reel could not be added. Try again.');
    } finally {
      setAdding(false);
    }
  };

  const remove = async (st, e) => {
    e.stopPropagation();
    const ask = st.mine
      ? `Remove “${st.name}” from your reel styles?`
      : `Remove “${st.name}” from the reel styles for everyone?`;
    if (!window.confirm(ask)) return;
    try {
      await removeReelStyle(st.id);
      setStyles((cur) => (cur || []).filter((x) => x.id !== st.id));
      if (pick === st.id) setPick(DEFAULT_STYLE);
    } catch {
      setErr('That style could not be removed. Try again.');
    }
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chosen = (styles || []).find((s) => s.id === pick && s.status === 'ready') || null;

  return (
    <div className="rls" role="dialog" aria-modal="true" aria-label="Choose how the reel is made">
      <div className="rls__scrim" onClick={onClose} />
      <div className="rls__card rsm">
        <header className="rls__head">
          <span className="rls__title">
            <Icon name="film" size={18} />
            {count > 1 ? `Generate ${count} reels` : 'Generate reel'}
          </span>
          <button type="button" className="rls__x" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
        </header>

        <div className="rsm__opts" role="radiogroup" aria-label="Reel style">
          <button
            type="button"
            role="radio"
            aria-checked={pick === DEFAULT_STYLE}
            className={`rsm__default ${pick === DEFAULT_STYLE ? 'is-on' : ''}`}
            onClick={() => setPick(DEFAULT_STYLE)}
          >
            <span className="rsm__radio" aria-hidden="true">{pick === DEFAULT_STYLE && <Icon name="check" size={12} strokeWidth={3} />}</span>
            <span className="rsm__default__txt">
              <b>Default</b>
              <span>Bold hook in the first second, word-by-word captions, a voiceover in your voice and an end card.</span>
            </span>
          </button>

          <p className="rsm__lab">Choose reel style</p>
          {styles === null ? (
            <div className="rsm__loading"><span className="pj-spin" /></div>
          ) : (
            <div className="rsm__grid">
              {styles.map((s) => {
                const ready = s.status === 'ready';
                const on = ready && pick === s.id;
                return (
                  <div key={s.id} className={`rsm__cell ${on ? 'is-on' : ''} ${ready ? '' : 'is-wait'}`}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!ready}
                      className={`rsm__style ${on ? 'is-on' : ''}`}
                      onClick={() => setPick(s.id)}
                      title={s.summary || s.error}
                    >
                      <span className="rsm__thumb" style={s.thumbUrl ? { backgroundImage: `url(${s.thumbUrl})` } : undefined}>
                        {ready ? (
                          <span className="rsm__radio rsm__radio--on-thumb" aria-hidden="true">{on && <Icon name="check" size={12} strokeWidth={3} />}</span>
                        ) : s.status === 'analyzing' ? (
                          <span className="rsm__wait"><span className="pj-spin" />Analysing the reel…<em>about 30 seconds</em></span>
                        ) : (
                          <span className="rsm__wait rsm__wait--bad"><Icon name="info" size={16} />{s.error || 'This reel could not be analysed.'}</span>
                        )}
                      </span>
                      <span className="rsm__name">{ready ? s.name : (s.status === 'analyzing' ? 'New reel style' : 'Could not analyse')}</span>
                      <span className="rsm__tags">{ready ? s.tags.join(' · ') : s.sourceUrl.replace(/^https:\/\/www\./, '')}</span>
                    </button>
                    {s.canRemove && s.status !== 'analyzing' && (
                      <button type="button" className="rsm__x" onClick={(e) => remove(s, e)} aria-label={`Remove ${s.name}`} title="Remove this style">
                        <Icon name="x" size={13} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="rsm__add">
            <span className="rsm__add__lab">Copy the style of any reel</span>
            <div className="rsm__add__row">
              <input
                type="url"
                className="rsm__add__in"
                value={link}
                onChange={(e) => { setLink(e.target.value); setLinkErr(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') addLink(); }}
                placeholder="Paste an Instagram reel link — instagram.com/reel/…"
                aria-label="Instagram reel link"
                disabled={adding}
              />
              <button type="button" className="rls-btn" onClick={addLink} disabled={adding || !link.trim()}>
                {adding ? <span className="pj-spin" /> : <Icon name="plus" size={15} />}
                Add style
              </button>
            </div>
            {linkErr && <p className="rls__err" role="alert">{linkErr}</p>}
          </div>
          {chosen && (
            <div className="rsm__about">
              <p>{chosen.summary}</p>
              {chosen.sourceUrl && (
                <a href={chosen.sourceUrl} target="_blank" rel="noreferrer" className="rsm__ref">
                  See the reference reel <Icon name="arrow-right" size={13} />
                </a>
              )}
              <p className="rsm__fine">Your photos and words, cut in this pattern, with original music in its mood — nothing is copied from the reference.</p>
            </div>
          )}
        </div>

        <textarea
          className="rls-steer__in"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything to steer it? (optional) e.g. open on the finished kitchen"
          maxLength={600}
        />
        {err && <p className="rls__err" role="alert">{err}</p>}
        <div className="rsm__foot">
          <button type="button" className="rls-btn rls-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="rls-btn rls-btn--go" onClick={() => onGenerate({ styleId: pick, styleName: chosen?.name || '', direction: note.trim() })}>
            <Icon name="film" size={16} />
            {count > 1 ? `Generate ${count} reels` : 'Generate reel'}
          </button>
        </div>
      </div>
    </div>
  );
}
