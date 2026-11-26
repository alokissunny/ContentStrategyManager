/*
 * Brand Kit › Voice profiles — the studio's cloned voices (ElevenLabs), which
 * Capture › Reel › voiceover can read the script in. A person may keep several
 * (their own, a partner's, a calmer and a livelier take…); one is the default.
 * Rows follow the Visual Mood list (bk-mood): name + Default + description,
 * Play (a short line in that voice), ⋯ Edit / Re-record / Set as default / Delete.
 * Self-contained: its own backend calls (api/voiceClone), not the autosave draft.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../brand/Icon.jsx';
import VoiceCloneSetup from '../../components/VoiceCloneSetup.jsx';
import {
  getVoiceClone, createVoiceClone, recloneVoiceProfile, updateVoiceProfile, deleteVoiceProfile, previewVoiceProfile,
} from '../../api/voiceClone.js';
import { SectionCard, DefaultChip, TileMenu, TextField } from './brandkitBits.jsx';

const LEAD = 'Clone your voice once and Bauhly can read your Reel voiceovers in it. Keep several — yours, a partner’s — and pick one per Reel.';
const dateOf = (d) => {
  try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
};

export default function VoiceProfiles({ onNote }) {
  const [state, setState] = useState(null); // { configured, profiles, max }
  const [modal, setModal] = useState(null); // { mode: 'new' | 'edit' | 'reclone', profile }
  const [playing, setPlaying] = useState(''); // profile id being fetched / played
  const audio = useRef(null);
  const previews = useRef({}); // id → url (a preview costs a reading; replay the same one)
  const head = useRef(null);

  useEffect(() => {
    let alive = true;
    getVoiceClone()
      .then((s) => { if (alive) setState(s); })
      .catch(() => { if (alive) setState({ configured: false, profiles: [], max: 0 }); });
    return () => { alive = false; audio.current?.pause(); };
  }, []);
  // Capture's "Manage voices" link lands here
  useEffect(() => {
    if (state && window.location.hash === '#voice-profiles') head.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [state]);

  if (!state) return null;
  const profiles = [...(state.profiles || [])].sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : 0));
  const full = profiles.length >= (state.max || 5);
  const setProfiles = (list) => setState((s) => ({ ...s, profiles: list || [], cloned: Boolean(list?.length) }));

  const play = async (p) => {
    audio.current?.pause();
    if (playing === p.id) { setPlaying(''); return; }
    setPlaying(p.id);
    try {
      if (!previews.current[p.id]) previews.current[p.id] = (await previewVoiceProfile(p.id)).url;
      const a = new Audio(previews.current[p.id]);
      audio.current = a;
      a.onended = () => setPlaying('');
      await a.play();
    } catch (e) {
      setPlaying('');
      onNote?.(e?.response?.data?.message || 'Bauhly could not play that voice just now.');
    }
  };
  const makeDefault = async (id) => {
    try { setProfiles((await updateVoiceProfile(id, { isDefault: true })).profiles); } catch { onNote?.('Could not change the default voice. Try again.'); }
  };
  const remove = async (p) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete the voice profile “${p.name}”? The cloned voice is removed from ElevenLabs and can’t be brought back.`)) return;
    try {
      setProfiles((await deleteVoiceProfile(p.id)).profiles);
      delete previews.current[p.id];
      onNote?.(`Deleted ${p.name}.`);
    } catch { onNote?.('Could not delete that voice. Try again.'); }
  };

  return (
    <div id="voice-profiles" ref={head} className="bk-voices-anchor">
      <SectionCard
        title="Voice profiles"
        lead={LEAD}
        className="bk-card--voices"
        action={state.configured ? (
          <button type="button" className="btn btn--tertiary btn--sm" onClick={() => setModal({ mode: 'new' })} disabled={full} title={full ? `Up to ${state.max} voice profiles` : undefined}>
            <Icon name="plus" size={15} strokeWidth={2.5} />
            {profiles.length ? 'Add voice profile' : 'Clone my voice'}
          </button>
        ) : null}
      >
        {!state.configured && <p className="bk-voices__note">Voice cloning isn&rsquo;t switched on for this account yet.</p>}
        {state.configured && profiles.length > 0 && (
          <ul className="bk-moods bk-voices">
            {profiles.map((p) => (
              <li key={p.id} className="bk-mood bk-voice">
                <button
                  type="button"
                  className={`bk-voice__play${playing === p.id ? ' is-on' : ''}`}
                  onClick={() => play(p)}
                  aria-label={playing === p.id ? `Stop ${p.name}` : `Play ${p.name}`}
                >
                  <Icon name={playing === p.id ? 'square' : 'play'} size={16} strokeWidth={2.25} />
                </button>
                <button type="button" className="bk-mood__row" onClick={() => setModal({ mode: 'edit', profile: p })} aria-label={`Edit ${p.name}`}>
                  <span className="bk-mood__text">
                    <b>{p.name}{p.isDefault && <DefaultChip />}</b>
                    <span>{p.note || (p.createdAt ? `Cloned ${dateOf(p.createdAt)}` : 'Cloned voice')}</span>
                  </span>
                </button>
                <TileMenu
                  label={`More for ${p.name}`}
                  className="bk-more--row"
                  items={[
                    { id: 'edit', label: 'Rename', icon: 'edit' },
                    { id: 'reclone', label: 'Re-record', icon: 'mic' },
                    { id: 'default', label: 'Set as default', icon: 'check', disabled: p.isDefault },
                    { id: 'delete', label: 'Delete', icon: 'trash', danger: true },
                  ]}
                  onPick={(id) => {
                    if (id === 'edit') setModal({ mode: 'edit', profile: p });
                    if (id === 'reclone') setModal({ mode: 'reclone', profile: p });
                    if (id === 'default') makeDefault(p.id);
                    if (id === 'delete') remove(p);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {modal && (
          <VoiceModal
            mode={modal.mode}
            profile={modal.profile}
            onClose={() => setModal(null)}
            onSaved={(list, msg) => {
              setProfiles(list);
              if (modal.profile) delete previews.current[modal.profile.id];
              setModal(null);
              if (msg) onNote?.(msg);
            }}
          />
        )}
      </SectionCard>
    </div>
  );
}

function VoiceModal({ mode, profile, onClose, onSaved }) {
  const [name, setName] = useState(profile?.name || '');
  const [note, setNote] = useState(profile?.note || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const title = mode === 'new' ? 'New voice profile' : mode === 'reclone' ? `Re-record ${profile?.name}` : 'Edit voice profile';
  const saveText = async () => {
    setSaving(true);
    setErr('');
    try {
      const out = await updateVoiceProfile(profile.id, { name: name.trim(), note: note.trim() });
      onSaved(out.profiles);
    } catch (e) {
      setErr(e?.response?.data?.message || 'Could not save. Try again.');
      setSaving(false);
    }
  };
  const submit = async ({ keys, consent }) => {
    if (mode === 'reclone') {
      const out = await recloneVoiceProfile(profile.id, { keys, consent });
      onSaved(out.profiles, `${profile.name} re-recorded.`);
    } else {
      const out = await createVoiceClone({ keys, consent, name: name.trim(), note: note.trim() });
      onSaved(out.profiles, `${out.profile?.name || 'Your voice'} is ready.`);
    }
  };

  return createPortal(
    <div className="fmodal bk-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bk-modal__scrim" onClick={onClose} />
      <div className="bk-modal__card bk-voice-modal">
        <button type="button" className="bk-modal__x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} strokeWidth={2.25} />
        </button>
        <h2 className="fmodal__title bk-modal__title">{title}</h2>
        <p className="bk-modal__lead">
          {mode === 'edit'
            ? 'The name you pick it by in Capture, and a note on when to use it.'
            : mode === 'reclone'
              ? 'A fresh sample replaces this voice everywhere it is used. Talk naturally — the clone copies how you sound here.'
              : 'Record one to two minutes of natural talking. Bauhly clones it with ElevenLabs.'}
        </p>
        {mode !== 'reclone' && (
          <div className="bk-modal__fields">
            <TextField label="Name" value={name} max={40} placeholder="My voice" autoFocus onChange={setName} />
            <TextField label="Description" value={note} max={120} optional placeholder="e.g. Calm, for project walkthroughs" onChange={setNote} />
          </div>
        )}
        {mode === 'edit' ? (
          <>
            {err && <p className="bk-voices__note bk-voices__err">{err}</p>}
            <div className="bk-modal__acts">
              <button type="button" className="btn btn--tertiary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn--primary" disabled={saving || !name.trim() || (name.trim() === profile.name && note.trim() === (profile.note || ''))} onClick={saveText}>Save</button>
            </div>
          </>
        ) : (
          <div className="bk-voice-modal__setup">
            <VoiceCloneSetup
              submit={submit}
              submitLabel={mode === 'reclone' ? 'Re-record voice' : 'Create voice'}
              onCancel={onClose}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
