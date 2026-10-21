/*
 * The phone's text editor in Editor mode (bauhly-v3 editor/TextSheet.jsx,
 * Oct 2026): one floating card at the foot of the screen with the words in a
 * soft field and a row of round controls under them.
 *
 * Two levels on the row (bauhly-v3 "two levels, to make room for Submit"):
 *   main  — × (close) · Bauhly's door (wand) · Aa (formatting) · ↑ (apply)
 *   marks — ← (back to main) · the caller's marks
 * The caption editor draws the same card without × and ↑ (`outOn`/`goOn`
 * false): the Editor's own header already carries both.
 */
import React from 'react';
import Icon from '../../brand/Icon';

export default function TextSheet({
  label = 'text',
  words = null,
  door = null,
  marks = null,
  marksOn = false,
  onMarksOn,
  below = null,
  note = null,
  onClose,
  onApply,
  canApply = false,
  outOn = true,
  goOn = true,
  className = '',
}) {
  return (
    <div className={`shotedit ${className}`.trim()} role="dialog" aria-label={`Edit ${label || 'text'}`}>
      <div className="shotedit__words">{words}</div>
      {below}
      {note && <span className="shotedit__note">{note}</span>}
      <div className="shotedit__bar" onMouseDown={(e) => { if (e.target.closest('button')) e.preventDefault(); }}>
        {marksOn ? (
          <div className="shotedit__lvl" key="marks">
            <button
              type="button"
              className="shotedit__ico shotedit__ico--out"
              aria-label="Back to the editor"
              title="Back"
              onClick={() => onMarksOn?.(false)}
            >
              <Icon name="arrow-left" size={18} strokeWidth={2} />
            </button>
            <div className="shotedit__marks">{marks}</div>
          </div>
        ) : (
          <div className="shotedit__lvl" key="main">
            {outOn ? (
              <button
                type="button"
                className="shotedit__ico shotedit__ico--out"
                aria-label="Close the editor"
                title="Close"
                onClick={onClose}
              >
                <Icon name="x" size={18} strokeWidth={2} />
              </button>
            ) : null}
            {door}
            {marks ? (
              <button
                type="button"
                className="shotedit__ico shotedit__ico--aa"
                aria-label="Formatting"
                title="Formatting"
                onClick={() => onMarksOn?.(true)}
              >
                <span className="shotedit__aa" aria-hidden="true">Aa</span>
              </button>
            ) : null}
            <span className="shotedit__gap" />
            {goOn ? (
              <button
                type="button"
                className="shotedit__ico shotedit__ico--go"
                aria-label="Apply changes"
                title="Apply changes"
                disabled={!canApply}
                onClick={onApply}
              >
                <Icon name="arrow-up" size={18} strokeWidth={2.1} />
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
