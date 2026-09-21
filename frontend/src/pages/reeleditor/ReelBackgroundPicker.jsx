import React from 'react';
import { getReelBackground, REEL_BACKGROUNDS } from './reelBackgrounds';

export default function ReelBackgroundPicker({ value, onChange, disabled = false }) {
  const selected = getReelBackground(value);
  return (
    <fieldset className="reel-backgrounds" disabled={disabled}>
      <legend className="reel-field__label">Video background</legend>
      <p className="reel-field__hint">Replace the background behind you. Works best with one person in good lighting.</p>
      <div className="reel-backgrounds__grid">
        {REEL_BACKGROUNDS.map((template) => (
          <label key={template.id} className="reel-backgrounds__option">
            <input type="radio" name="reel-background" value={template.id}
              checked={selected.id === template.id} onChange={() => onChange(template.id)} />
            <span className="reel-backgrounds__swatch" style={{ background: template.background }} aria-hidden="true">
              <span className={template.id === 'original' ? 'is-original' : ''} />
            </span>
            <span>{template.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
