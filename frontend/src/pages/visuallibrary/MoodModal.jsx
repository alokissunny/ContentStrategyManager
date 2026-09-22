/*
 * Create / edit a Visual Mood set — the one dialog on the Brand Kit page.
 * Ported from bauhly-v3's MoodModal + MoodRole (see [[bauhly-v3-design-source]]),
 * adapted to the live backend: role images upload to S3 (api/visualBrand
 * `uploadMoodSetImage`) and the set is persisted by the parent through
 * `saveMoodSets`. The reference's "Choose from examples" gallery is dropped —
 * the shipped example photographs are not part of this app — so a role is
 * filled by uploading the studio's own picture.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../brand/Icon.jsx';
import { useBodyScrollLock } from '../visualbrand/useBodyScrollLock.js';
import { uploadMoodSetImage } from '../../api/visualBrand.js';
import { TextField } from './brandkitBits.jsx';
import { TileMenu } from './brandkitBits.jsx';

/* the four reference roles of a Mood Set, fixed to their order */
export const MOOD_ROLES = [
  { id: 'primary', title: 'Primary reference', lead: 'Your main visual direction', hint: 'The image that best represents your overall style.' },
  { id: 'materials', title: 'Materials & colours', lead: 'Surfaces, textures and palette', hint: 'Your materials, textures and palette.' },
  { id: 'light', title: 'Light & mood', lead: 'Lighting and overall atmosphere', hint: 'The light and atmosphere you work in.' },
  { id: 'style', title: 'Style & details', lead: 'Furniture, styling and character', hint: 'Your furniture, styling and details.' },
];
export const MOOD_ROLE_IDS = MOOD_ROLES.map((r) => r.id);

export const emptyMood = () => ({ id: `mood-${Date.now().toString(36)}`, name: '', note: '', refs: { primary: null, materials: null, light: null, style: null } });
export const isMoodComplete = (mood) => MOOD_ROLE_IDS.some((r) => !!mood.refs[r]);

const LEAD = 'Add visual references that define the look and feel of your brand. Bauhly uses them to guide the visual direction of your content.';

function MoodRoleColumn({ role, value, onSet, onClear }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    setBusy(true);
    try { await onSet(file); } finally { setBusy(false); }
  };
  const onDrop = (e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer?.files?.[0]); };
  return (
    <div className="bk-mrole">
      <span className="bk-mrole__title">{role.title}</span>
      <span className="bk-mrole__lead">{role.lead}</span>
      {value ? (
        <span className="bk-mrole__pic">
          <img src={value.url} alt={value.title || role.title} className="bk-asset" draggable="false" />
          <TileMenu
            label={`More for ${role.title}`}
            items={[{ id: 'replace', label: 'Replace', icon: 'refresh' }, { id: 'remove', label: 'Remove', icon: 'trash', danger: true }]}
            onPick={(id) => (id === 'replace' ? document.getElementById(`mrole-${role.id}`)?.click() : onClear())}
          />
          <input id={`mrole-${role.id}`} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} />
        </span>
      ) : (
        <label
          className={`bk-mrole__place ${over ? 'is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} />
          <span className="bk-mrole__say">{busy ? 'Uploading…' : role.hint}</span>
          <span className="bk-mrole__or">
            <Icon name="plus" size={13} strokeWidth={2.25} />
            Add reference
          </span>
        </label>
      )}
    </div>
  );
}

export default function MoodModal({ mood, isNew, onCommit, onClose, onNote }) {
  useBodyScrollLock();
  const [draft, setDraft] = useState(mood);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const setRef = async (roleId, file) => {
    try {
      const up = await uploadMoodSetImage(file);
      if (!up) return;
      setDraft((d) => ({ ...d, refs: { ...d.refs, [roleId]: { key: up.key, url: up.url, title: file.name || '' } } }));
    } catch (e) {
      onNote?.('That image could not be saved. Try again.');
    }
  };
  const clearRef = (roleId) => setDraft((d) => ({ ...d, refs: { ...d.refs, [roleId]: null } }));

  const complete = isMoodComplete(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(mood);
  const title = isNew ? 'Create a visual mood' : (mood.name || 'Visual mood');

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onCommit({ ...draft, name: draft.name.trim(), note: draft.note.trim() });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fmodal bk-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bk-modal__scrim" onClick={onClose} />
      <div className="bk-modal__card">
        <button type="button" className="bk-modal__x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} strokeWidth={2.25} />
        </button>
        <h2 className="fmodal__title bk-modal__title">{title}</h2>
        <p className="bk-modal__lead">{LEAD}</p>
        <div className="bk-modal__fields">
          <TextField label="Name" value={draft.name} max={40} optional placeholder="e.g. Warm Minimal, Raw & Textured, Bright & Airy" autoFocus={isNew} onChange={(v) => setDraft({ ...draft, name: v })} />
          <TextField label="Description" value={draft.note} max={120} optional placeholder="e.g. Clean, warm and timeless spaces with natural materials." onChange={(v) => setDraft({ ...draft, note: v })} />
        </div>
        <div className="bk-mroles">
          {MOOD_ROLES.map((r) => (
            <MoodRoleColumn
              key={r.id}
              role={r}
              value={draft.refs[r.id]}
              onSet={(file) => setRef(r.id, file)}
              onClear={() => clearRef(r.id)}
            />
          ))}
        </div>
        <div className="bk-modal__acts">
          <button type="button" className="btn btn--tertiary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={!complete || !changed || saving} onClick={save}>Save mood</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
