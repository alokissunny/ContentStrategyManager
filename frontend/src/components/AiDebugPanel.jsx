import React, { useState } from 'react';
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

function formatBlock(text) {
  const raw = String(text || '');
  const t = raw.trim();
  if (!t) return '';
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try { return JSON.stringify(JSON.parse(fenced[1]), null, 2); } catch { /* fall through */ }
    }
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.stringify(JSON.parse(t.slice(start, end + 1)), null, 2); } catch { /* fall through */ }
    }
    return raw;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
}

function DebugBlock({ label, text, open = true, copyable = false }) {
  const body = formatBlock(text);
  const [copied, setCopied] = useState(false);
  if (!body) return null;

  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(body);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <details className="ai-debug__block" open={open}>
      <summary className="ai-debug__block-sum">
        <span>{label}</span>
        {copyable ? (
          <button
            type="button"
            className={`ai-debug__copy${copied ? ' is-copied' : ''}`}
            onClick={onCopy}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        ) : null}
      </summary>
      <pre className="ai-debug__pre">{body}</pre>
    </details>
  );
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
            <DebugBlock label="System" text={e.systemPrompt} open={false} />
            <DebugBlock label="Input" text={e.prompt} copyable />
            {e.output
              ? <DebugBlock label="Output" text={e.output} copyable />
              : <p className="ai-debug__missing">No output recorded for this call.</p>}
          </details>
        ))}
      </div>
    </aside>
  );
}
