import React from 'react';
import Glyph from './Glyph';
import {
  useAiDebug,
  setAiDebugPanelOpen,
  clearAiDebugEntries,
} from '../lib/aiDebug';

function fmtTime(ms) {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export default function AiDebugPanel() {
  const debug = useAiDebug();
  if (!debug.enabled) return null;

  if (!debug.open) {
    return (
      <button
        type="button"
        className="ai-debug__peek"
        onClick={() => setAiDebugPanelOpen(true)}
        title="Open AI prompt debug"
      >
        <Glyph name="bug" size={14} strokeWidth={2} />
        Prompts
        {debug.entries.length ? <span className="ai-debug__count">{debug.entries.length}</span> : null}
      </button>
    );
  }

  return (
    <aside className="ai-debug" aria-label="AI prompt debug">
      <header className="ai-debug__head">
        <div className="ai-debug__title">
          <Glyph name="bug" size={14} strokeWidth={2} />
          AI Prompt Debug
        </div>
        <div className="ai-debug__acts">
          <button type="button" className="ai-debug__btn" onClick={clearAiDebugEntries}>Clear</button>
          <button type="button" className="ai-debug__btn" onClick={() => setAiDebugPanelOpen(false)}>Collapse</button>
        </div>
      </header>
      <div className="ai-debug__body">
        {!debug.entries.length && (
          <p className="ai-debug__empty">No AI prompts logged yet in this session.</p>
        )}
        {debug.entries.map((e) => (
          <details key={e.id} className="ai-debug__item" open>
            <summary className="ai-debug__sum">
              <span>{e.source}</span>
              <span className="ai-debug__meta">
                {e.model ? `${e.model} · ` : ''}
                {fmtTime(e.at)}
              </span>
            </summary>
            {e.note ? <p className="ai-debug__note">{e.note}</p> : null}
            <pre className="ai-debug__pre">{e.prompt}</pre>
          </details>
        ))}
      </div>
    </aside>
  );
}
