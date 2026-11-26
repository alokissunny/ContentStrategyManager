/*
 * Capture › Reel › Include voiceover › "Try it with your cloned voice".
 * Sits at the top of VoicePrep. No voice profile yet → clone one here
 * (VoiceCloneSetup; it becomes the default profile). Profiles exist → pick one
 * (when there are several; the Brand Kit default is preselected) and "Voice
 * every part" reads each script part in it; each reading lands as a take of its
 * part (VoicePrep onCloneAll). Profiles are managed in Brand Kit › Voice profiles.
 */
import React, { useState } from 'react';
import Icon from '../brand/Icon';
import VoiceCloneSetup from './VoiceCloneSetup';
import { createVoiceClone } from '../api/voiceClone';

export default function VoiceClone({ clone, onChange, profileId = '', onProfile, onCloneAll, cloning = false, disabled = false }) {
  const [setup, setSetup] = useState(false);

  if (!clone) return null; // still asking the server
  const profiles = clone.profiles || [];
  const current = profiles.find((p) => p.id === profileId) || profiles.find((p) => p.isDefault) || profiles[0] || null;

  const create = async ({ keys, consent }) => {
    const out = await createVoiceClone({ keys, consent });
    setSetup(false);
    onChange?.({ ...clone, cloned: true, profiles: out.profiles || [] });
    if (out.profile?.id) onProfile?.(out.profile.id);
  };

  return (
    <section className="ck-scard vclone">
      <div className="vclone__head">
        <span className="vclone__icon" aria-hidden="true"><Icon name="mic" size={15} strokeWidth={2} /></span>
        <div className="vclone__copy">
          <p className="ck-scard__q vclone__title">{current ? 'Read it in your cloned voice' : 'Try it with your cloned voice'}</p>
          <p className="vclone__sub">
            {current
              ? 'Bauhly reads each part in the voice you pick. Listen, keep it, or record your own take instead.'
              : 'No time to record? Clone your voice once — one to two minutes of talking — and Bauhly reads the script for you.'}
          </p>
        </div>
      </div>

      {!clone.configured && <p className="ck-stage__note">Voice cloning isn&rsquo;t switched on for this account yet.</p>}

      {clone.configured && current && !setup && (
        <>
          {/* the Brand Kit's voice profiles, always shown: pick the one this Reel is read in */}
          <div className="vclone__pick" role="radiogroup" aria-label="Voice profile from your Brand Kit">
            <p className="vclone__pick-label">Voice profile · from your Brand Kit</p>
            <div className="vclone__voices">
              {profiles.map((p) => {
                const on = p.id === current.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`vclone__voice${on ? ' is-on' : ''}`}
                    onClick={() => onProfile?.(p.id)}
                    disabled={cloning}
                    title={p.note || undefined}
                  >
                    <span className="vclone__voice-dot" aria-hidden="true">{on ? <Icon name="check" size={12} strokeWidth={3} /> : null}</span>
                    <span className="vclone__voice-name">{p.name}</span>
                    {p.isDefault && <span className="vclone__voice-tag">Default</span>}
                  </button>
                );
              })}
              <a className="vclone__voice vclone__voice--add" href="/dashboard/library-settings#voice-profiles" target="_blank" rel="noreferrer">
                <Icon name="plus" size={13} strokeWidth={2.5} /> Add or manage voices
              </a>
            </div>
            {current.note && <p className="vclone__voice-note">{current.note}</p>}
          </div>
          <div className="ck-gr__acts">
            <button type="button" className="btn btn--primary btn--sm ck-gr__act" onClick={onCloneAll} disabled={disabled || cloning}>
              {cloning ? `Reading in ${current.name}…` : `Voice every part with ${current.name}`}
            </button>
          </div>
        </>
      )}

      {clone.configured && !current && !setup && (
        <div className="ck-gr__acts">
          <button type="button" className="btn btn--sm ck-gr__act vprep__rec" onClick={() => setSetup(true)} disabled={disabled}>
            <Icon name="sparkle" size={14} strokeWidth={2} /> Clone my voice
          </button>
        </div>
      )}

      {clone.configured && setup && (
        <div className="vclone__setup">
          <VoiceCloneSetup submit={create} onCancel={() => setSetup(false)} disabled={disabled} />
        </div>
      )}
    </section>
  );
}
