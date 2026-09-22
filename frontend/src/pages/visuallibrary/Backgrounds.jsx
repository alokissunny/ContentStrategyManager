/*
 * Backgrounds — the studio's own background assets, ported from bauhly-v3's
 * Backgrounds (see [[bauhly-v3-design-source]]) and wired to the live backend:
 * bytes go to S3 and the list persists per Instagram handle (api/visualBrand).
 *
 * Only pictures — a flat colour ground comes from a theme set, never here.
 * Empty, the header's "Add background" is the only way in (no dropzone body,
 * matching the reference). Pressing a tile opens it full size with Download and
 * Remove; the heavy crop/adjust editor from the reference (Projects' PhotoEditor)
 * is out of scope here.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../brand/Icon.jsx';
import { listBackgrounds, uploadBackground, setDefaultBackground, deleteBackground } from '../../api/visualBrand.js';
import { DEFAULT_BACKGROUNDS } from './brandkitDefaults.js';
import { SectionCard, DefaultChip, TileMenu } from './brandkitBits.jsx';

/* the shipped defaults, with the persisted choice (libraryEdits.background)
   marked default — so a chosen default survives leaving and returning to the
   page instead of snapping back to off-white */
function defaultsWith(saved) {
  const key = saved?.key;
  const url = saved?.url;
  const match = (key || url) && DEFAULT_BACKGROUNDS.find((b) => (key && b.key === key) || (url && b.url === url));
  return match ? DEFAULT_BACKGROUNDS.map((b) => ({ ...b, isDefault: b === match })) : DEFAULT_BACKGROUNDS;
}

export default function Backgrounds({ onNote, onDefaultChange, savedBackground }) {
  // capture the persisted choice once, so the initial default is the studio's
  const savedRef = useRef(savedBackground);
  // shipped starter tiles until the account saves its own (then those take over)
  const [items, setItems] = useState(() => defaultsWith(savedRef.current));
  const [ready, setReady] = useState(false);
  const [viewing, setViewing] = useState(null); // key
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const addRef = useRef(null);
  const replaceKey = useRef(null);

  useEffect(() => {
    let alive = true;
    listBackgrounds()
      .then((list) => { if (alive && list.length) setItems(list); })
      .catch(() => {})
      // only report the default UP once we know the real state — otherwise the
      // mount's shipped default would overwrite the persisted choice
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  /* tell the page which background is the default, so the Live preview and every
     layout can paint it (BrandKit → libraryEdits.background → paintOf) */
  const chosen = items.find((b) => b.isDefault) || null;
  const chosenSig = chosen ? `${chosen.key}|${chosen.url}` : '';
  useEffect(() => {
    if (!ready) return;
    onDefaultChange?.(chosen ? { key: chosen.key, url: chosen.url } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenSig, ready]);

  const add = async (file, oldKey = null) => {
    if (!file || !file.type?.startsWith('image/')) return;
    // uploading the studio's own always replaces the shipped defaults
    const base = itemsRef.current.some((b) => b.shipped) ? [] : itemsRef.current;
    const localUrl = URL.createObjectURL(file);
    const tmp = { key: `tmp-${Date.now()}`, url: localUrl, title: file.name, isDefault: false, uploading: true };
    setItems([...(oldKey ? base.filter((b) => b.key !== oldKey) : base), tmp]);
    try {
      const saved = await uploadBackground(file);
      setItems((saved || []).map((b) => (b.title === file.name ? { ...b, url: localUrl } : b)));
      if (oldKey && !String(oldKey).startsWith('default-')) deleteBackground(oldKey).catch(() => {});
    } catch (e) {
      setItems(itemsRef.current.filter((b) => b.key !== tmp.key));
      onNote?.('Bauhly could not save that background. Try again.');
    }
  };

  const remove = async (key) => {
    const gone = itemsRef.current.find((b) => b.key === key);
    setItems(itemsRef.current.filter((b) => b.key !== key));
    setViewing((v) => (v === key ? null : v));
    if (gone && !gone.shipped) { try { await deleteBackground(key); } catch (e) { /* keep local removal */ } }
  };
  const makeDefault = async (key) => {
    setItems(itemsRef.current.map((b) => ({ ...b, isDefault: b.key === key })));
    const target = itemsRef.current.find((b) => b.key === key);
    if (target && !target.shipped) { try { const list = await setDefaultBackground(key); setItems(list); } catch (e) { /* keep optimistic */ } }
  };
  const download = (b) => {
    const el = document.createElement('a');
    el.href = b.url; el.download = `bauhly-background.jpg`; el.target = '_blank';
    document.body.appendChild(el); el.click(); el.remove();
  };

  const viewed = viewing ? items.find((b) => b.key === viewing) : null;
  useEffect(() => { if (viewing && !viewed) setViewing(null); }, [viewing, viewed]);

  const empty = items.length === 0;

  return (
    <SectionCard
      title="Backgrounds"
      lead="Add backgrounds to use across your content."
      className="bk-card--backgrounds"
      action={(
        <button type="button" className="btn btn--tertiary btn--sm" onClick={() => addRef.current?.click()}>
          <Icon name="plus" size={15} strokeWidth={2.5} />
          Add background
        </button>
      )}
    >
      <input ref={addRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; add(f); }} />
      <input
        ref={replaceKey}
        type="file"
        accept="image/*"
        hidden
        data-key=""
        onChange={(e) => { const f = e.target.files?.[0]; const k = e.target.dataset.key; e.target.value = ''; if (f) add(f, k || null); }}
      />
      {empty ? null : (
        <ul className="bk-tiles bk-tiles--wide">
          {items.map((b) => (
            <li key={b.key} className="bk-tile">
              <span className="bk-tile__art">
                <button type="button" className="bk-tile__open" onClick={() => setViewing(b.key)} aria-label="Open background full size">
                  <img src={b.url} alt="" className="bk-asset" draggable="false" />
                </button>
                <TileMenu
                  label="More for background"
                  items={[
                    { id: 'default', label: 'Set as default', icon: 'check', disabled: b.isDefault },
                    { id: 'replace', label: 'Replace', icon: 'refresh' },
                    { id: 'remove', label: 'Remove', icon: 'trash', danger: true },
                  ]}
                  onPick={(id) => {
                    if (id === 'default') makeDefault(b.key);
                    if (id === 'replace') { replaceKey.current.dataset.key = b.key; replaceKey.current.click(); }
                    if (id === 'remove') remove(b.key);
                  }}
                />
                {b.isDefault && <span className="bk-tile__chip"><DefaultChip /></span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {viewed && createPortal(
        <div className="ls-view" role="dialog" aria-modal="true" aria-label="Background">
          <button className="ls-view__scrim" aria-label="Close" onClick={() => setViewing(null)} />
          <img className="ls-view__img" src={viewed.url} alt="" />
          <div className="ls-view__bar">
            <span className="ls-view__name">Background{viewed.isDefault && <em>Default</em>}</span>
            <span className="ls-view__acts">
              <button className="btn btn--quiet btn--sm ls-view__btn" onClick={() => download(viewed)}>
                <Icon name="share" size={15} strokeWidth={2} />
                Download
              </button>
              <button className="btn btn--quiet btn--sm ls-view__btn ls-view__del" onClick={() => remove(viewed.key)}>
                <Icon name="trash" size={15} strokeWidth={2} />
                Remove
              </button>
            </span>
          </div>
          <button className="ls-view__x" aria-label="Close" onClick={() => setViewing(null)}>
            <Icon name="x" size={18} strokeWidth={2.5} />
          </button>
        </div>,
        document.body,
      )}
    </SectionCard>
  );
}
