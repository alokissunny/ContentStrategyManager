import React, { useState } from 'react';
import Glyph from './Glyph';
import {
  useAiDebug,
  setAiDebugPanelOpen,
  clearAiDebugEntries,
  updateAiDebugEntry,
} from '../lib/aiDebug';
import { rerunPrompt } from '../api/debug';

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
  // Only pretty-print when the whole block is JSON. Do not slice `{...}` out of
  // a markdown system prompt — that hides the real instructions.
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      /* fall through */
    }
  }
  return raw;
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

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button
      type="button"
      className={`ai-debug__copy${copied ? ' is-copied' : ''}`}
      onClick={onCopy}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function DebugBlock({ label, text, open = true, copyable = false }) {
  const body = formatBlock(text);
  if (!body) return null;

  return (
    <details className="ai-debug__block" open={open}>
      <summary className="ai-debug__block-sum">
        <span>{label}</span>
        {copyable ? <CopyButton text={body} /> : null}
      </summary>
      <pre className="ai-debug__pre">{body}</pre>
    </details>
  );
}

function InputBlock({ draft, onDraftChange, onRerun, busy, disabled }) {
  const onRerunClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy && !disabled) onRerun();
  };

  return (
    <details className="ai-debug__block" open>
      <summary className="ai-debug__block-sum">
        <span>Input</span>
        <span className="ai-debug__block-acts">
          <CopyButton text={draft} />
          <button
            type="button"
            className="ai-debug__copy"
            onClick={onRerunClick}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={busy || disabled}
          >
            {busy ? 'Rerunning…' : 'Rerun'}
          </button>
        </span>
      </summary>
      <textarea
        className="ai-debug__pre ai-debug__input"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        spellCheck={false}
        rows={24}
      />
    </details>
  );
}

function DebugEntry({ entry }) {
  const [draft, setDraft] = useState(entry.prompt || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onRerun = async () => {
    const prompt = String(draft || '').trim();
    if (!prompt) {
      setError('Input is empty.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await rerunPrompt({
        model: entry.model,
        // Input already contains the full assembled prompt (system + user).
        systemPrompt: '',
        prompt,
      });
      updateAiDebugEntry(entry.id, {
        prompt,
        output: data.output,
        model: data.model || entry.model,
      });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not rerun this prompt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="ai-debug__item" open>
      <summary className="ai-debug__sum">
        <span>{entry.source}</span>
        <span className="ai-debug__meta">
          {entry.model ? `${entry.model} · ` : ''}
          {fmtTime(entry.at)}
        </span>
      </summary>
      {entry.note ? <p className="ai-debug__note">{entry.note}</p> : null}
      <DebugBlock label="System" text={entry.systemPrompt} open copyable />
      <InputBlock
        draft={draft}
        onDraftChange={setDraft}
        onRerun={onRerun}
        busy={busy}
        disabled={!draft.trim()}
      />
      {error ? <p className="ai-debug__error">{error}</p> : null}
      {busy ? <p className="ai-debug__missing">Rerunning with modified input…</p> : null}
      {entry.output
        ? <DebugBlock label="Output" text={entry.output} copyable />
        : (!busy && <p className="ai-debug__missing">No output recorded for this call.</p>)}
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
          <DebugEntry key={e.id} entry={e} />
        ))}
      </div>
    </aside>
  );
}
