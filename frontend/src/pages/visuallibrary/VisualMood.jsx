/*
 * Visual Mood — named sets of up to four reference pictures, ported from
 * bauhly-v3's VisualMood (see [[bauhly-v3-design-source]]) and wired to the live
 * backend: the set list persists per Instagram handle via `saveMoodSets`, and
 * each role image lives in S3. Replaces the old flat mood-image grid.
 *
 *   0 sets   the section introduces the feature — title, lead, Add mood style.
 *   1+ sets  a row per set: its four thumbnails, name, the Default mark, its
 *            line and a ⋯ (Edit · Set as default · Delete).
 */

import { useEffect, useRef, useState } from 'react';
import Icon from '../../brand/Icon.jsx';
import { listMoodSets, saveMoodSets } from '../../api/visualBrand.js';
import { DEFAULT_MOODS } from './brandkitDefaults.js';
import { SectionCard, DefaultChip, Pager, TileMenu, usePager } from './brandkitBits.jsx';
import MoodModal, { MOOD_ROLES, emptyMood } from './MoodModal.jsx';

const PAGE = 3;
const LEAD = 'Add image sets that reflect the look and feel you want Bauhly to create. They help Bauhly understand your visual style and are never copied directly into your content.';

/* strip the presigned url before persisting — the server re-signs by key */
const forSave = (sets) => sets.map((m) => ({
  id: m.id,
  name: m.name,
  note: m.note,
  isDefault: !!m.isDefault,
  refs: Object.fromEntries(MOOD_ROLES.map((r) => [r.id, m.refs?.[r.id] ? { key: m.refs[r.id].key, title: m.refs[r.id].title || '' } : null])),
}));

export default function VisualMood({ onNote }) {
  // shipped starter sets until the account saves its own (then those take over)
  const [sets, setSets] = useState(DEFAULT_MOODS);
  const [modal, setModal] = useState(null); // { mood, isNew }
  const setsRef = useRef(sets);
  useEffect(() => { setsRef.current = sets; }, [sets]);

  useEffect(() => {
    let alive = true;
    listMoodSets().then((list) => { if (alive && list.length) setSets(list); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /* one write: compute the next list, persist it, keep the server's echo (fresh
     urls). `next` carries local object-urls for anything just uploaded, which
     the optimistic render uses until the server's presigned urls come back. */
  const persist = async (next) => {
    setSets(next);
    try {
      const saved = await saveMoodSets(forSave(next));
      // keep local object-urls where the server hasn't got a fresh url yet
      setSets(saved.map((m) => {
        const local = next.find((x) => x.id === m.id);
        const refs = {};
        MOOD_ROLES.forEach((r) => {
          const s = m.refs?.[r.id];
          const l = local?.refs?.[r.id];
          refs[r.id] = s ? { ...s, url: s.url || l?.url || null } : null;
        });
        return { ...m, refs };
      }));
    } catch (e) {
      onNote?.('Could not save your mood set. Try again.');
      setSets(setsRef.current);
    }
  };

  const shippedMode = () => setsRef.current.some((m) => m.shipped);

  /* the modal always produces a real (S3-backed) set, so adding or editing
     operates on the real subset — the shipped defaults step aside the moment
     the studio makes one of its own */
  const commit = (mood) => {
    const real = setsRef.current.filter((m) => !m.shipped);
    const exists = real.some((m) => m.id === mood.id);
    const next = exists ? real.map((m) => (m.id === mood.id ? { ...m, ...mood } : m)) : [...real, mood];
    if (!next.some((m) => m.isDefault) && next[0]) next[0].isDefault = true;
    return persist(next);
  };
  const setDefault = (id) => {
    const next = setsRef.current.map((m) => ({ ...m, isDefault: m.id === id }));
    setSets(next);
    if (!shippedMode()) persist(next); // defaults reorder locally only
  };
  const remove = (id) => {
    const gone = setsRef.current.find((m) => m.id === id);
    const next = setsRef.current.filter((m) => m.id !== id);
    if (!next.some((m) => m.isDefault) && next[0]) next[0].isDefault = true;
    setSets(next);
    if (gone && !gone.shipped) persist(next); // removing a default is local only
  };

  const empty = sets.length === 0;
  const ordered = [...sets].sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : 0));
  const { page, pages, setPage, slice } = usePager(ordered.length, PAGE);

  return (
    <SectionCard
      title="Visual Mood"
      lead={LEAD}
      className="bk-card--moods"
      action={(
        <button type="button" className="btn btn--tertiary btn--sm" onClick={() => setModal({ mood: emptyMood(), isNew: true })}>
          <Icon name="plus" size={15} strokeWidth={2.5} />
          {empty ? 'Add mood style' : 'Add mood set'}
        </button>
      )}
    >
      {!empty && (
        <ul className="bk-moods">
          {slice(ordered).map((m) => (
            <li key={m.id} className="bk-mood">
              <button
                type="button"
                className="bk-mood__row"
                onClick={() => { if (!m.shipped) setModal({ mood: m, isNew: false }); }}
                aria-label={m.shipped ? m.name : `Edit ${m.name || 'mood'}`}
              >
                <span className="bk-mood__thumbs" aria-hidden="true">
                  {MOOD_ROLES.map((r) => (
                    <span key={r.id} className="bk-mood__thumb">
                      {m.refs?.[r.id]?.url ? <img src={m.refs[r.id].url} alt="" className="bk-asset" /> : <span className="bk-mood__thumb-blank" />}
                    </span>
                  ))}
                </span>
                <span className="bk-mood__text">
                  <b>{m.name || 'Untitled mood'}{m.isDefault && <DefaultChip />}</b>
                  <span>{m.note || 'Visual references for this mood direction.'}</span>
                </span>
              </button>
              <TileMenu
                label={`More for ${m.name || 'mood'}`}
                className="bk-more--row"
                items={[
                  // a shipped default can't be edited in place (its pictures are
                  // not the studio's uploads) — Add mood set makes an editable one
                  ...(m.shipped ? [] : [{ id: 'edit', label: 'Edit', icon: 'edit' }]),
                  { id: 'default', label: 'Set as default', icon: 'check', disabled: m.isDefault },
                  { id: 'delete', label: 'Delete', icon: 'trash', danger: true },
                ]}
                onPick={(id) => {
                  if (id === 'edit') setModal({ mood: m, isNew: false });
                  if (id === 'default') setDefault(m.id);
                  if (id === 'delete') remove(m.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} pages={pages} onPage={setPage} label="Visual moods" />
      {modal && (
        <MoodModal
          mood={modal.mood}
          isNew={modal.isNew}
          onNote={onNote}
          onCommit={commit}
          onClose={() => setModal(null)}
        />
      )}
    </SectionCard>
  );
}
