/*
 * The instruction field under Edit text (bauhly-v3 PolishField, words subject).
 * `askFirst` holds Make-it chips back until there is something in the box —
 * this editor opens on purpose, so four chips under an empty field are four
 * things offered before anyone asked. The screenshot's resting state is the
 * field alone.
 */
import React, { useState } from 'react';
import Icon from '../../brand/Icon';
import polish, { POLISH_PLACEHOLDER_WORDS } from '../../lib/polish';

export default function WordsPolish({ caption, onCaption, fills = [] }) {
  const [ask, setAsk] = useState('');
  const [note, setNote] = useState('');

  const commit = () => {
    const instruction = ask.trim();
    if (!instruction) return;
    const result = polish(caption, instruction, fills);
    if (result.ok) {
      onCaption(result.caption);
      setAsk('');
      setNote(result.note || '');
    } else {
      setNote(result.message || '');
    }
  };

  return (
    <div className="wv-polish">
      {note ? <p className="wv-polish__note">{note}</p> : null}
      <div className="wv-polish__row">
        <input
          className="wv-polish__input"
          value={ask}
          placeholder={POLISH_PLACEHOLDER_WORDS}
          aria-label="What should change about these words?"
          onChange={(e) => { setAsk(e.target.value); setNote(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        />
        <button
          type="button"
          className="wv-polish__send"
          disabled={!ask.trim()}
          onClick={commit}
          aria-label="Apply this change"
          title="Apply this change"
        >
          <Icon name="arrow-up" size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
