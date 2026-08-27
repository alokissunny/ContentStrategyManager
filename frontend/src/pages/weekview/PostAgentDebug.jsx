import React, { useState } from 'react';
import { useAiDebug } from '../../lib/aiDebug';

function pretty(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(t), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function lastMatching(entries, prefix) {
  const hits = (entries || []).filter((e) => String(e.source || '').startsWith(prefix));
  return hits[0] || null;
}

function briefFromStrategistLog(entries, date) {
  const entry = (entries || []).find((e) => /^Strategist/i.test(String(e.source || '')));
  const parsed = parseJson(entry?.output);
  if (!parsed) return null;
  const briefs = Array.isArray(parsed.briefs)
    ? parsed.briefs
    : (Array.isArray(parsed.plannedDays) ? parsed.plannedDays : []);
  if (!date) return briefs[0] || parsed;
  return briefs.find((b) => String(b?.date || '') === String(date)) || null;
}

function traceForDay(day, entries) {
  const stored = day?.agentTrace && typeof day.agentTrace === 'object' ? day.agentTrace : {};
  const date = String(day?.date || '').trim();
  const strategyBrief = stored.strategyBrief
    || briefFromStrategistLog(entries, date);
  const structure = stored.structure
    || parseJson(lastMatching(entries, date ? `Structure:${date}` : 'Structure:')?.output);
  const dayHit = lastMatching(entries, date ? `Day:${date}` : 'Day:');
  const dayWriter = stored.dayWriter
    || parseJson(dayHit?.output);
  const layout = stored.layout
    || parseJson(lastMatching(entries, date ? `Layout:${date}` : 'Layout:')?.output);
  return { strategyBrief, structure, dayWriter, layout };
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
      className={`wv-agentdbg__copy${copied ? ' is-copied' : ''}`}
      onClick={onCopy}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Block({ title, value, open = false }) {
  const body = pretty(value);
  if (!body) {
    return (
      <details className="wv-agentdbg__block">
        <summary className="wv-agentdbg__sum">{title}</summary>
        <p className="wv-agentdbg__empty">Not recorded for this post.</p>
      </details>
    );
  }
  return (
    <details className="wv-agentdbg__block" open={open}>
      <summary className="wv-agentdbg__sum">
        <span>{title}</span>
        <CopyButton text={body} />
      </summary>
      <pre className="wv-agentdbg__pre">{body}</pre>
    </details>
  );
}

export default function PostAgentDebug({ day, onRunLayout, layoutBusy = false, layoutErr = '' }) {
  const debug = useAiDebug();
  const trace = traceForDay(day, debug.entries);
  const empty = !trace.strategyBrief && !trace.structure && !trace.dayWriter && !trace.layout;

  return (
    <div className="wv-agentdbg">
      <p className="wv-agentdbg__lead">
        Agent outputs for this post. Strategy decides the brief; Structure locks the slide map; Day Writer writes the copy; Layout composes the slide.
      </p>
      {onRunLayout && (
        <div className="wv-agentdbg__run">
          <button
            type="button"
            className="btn btn--tertiary btn--sm"
            disabled={layoutBusy}
            onClick={onRunLayout}
          >
            {layoutBusy ? 'Laying out…' : 'Run layout agent'}
          </button>
          <span className="wv-agentdbg__runhint">This post only — does not regenerate the week.</span>
        </div>
      )}
      {layoutErr ? <p className="wv-agentdbg__empty">{layoutErr}</p> : null}
      {empty && (
        <p className="wv-agentdbg__empty">
          No agent trace on this post yet. Generate or replan a week with debug mode on. Posts created before this will only show a trace if this session still has the prompt log.
        </p>
      )}
      <Block title="Strategy brief" value={trace.strategyBrief} open />
      <Block title="Structure agent" value={trace.structure} />
      <Block title="Day Writer" value={trace.dayWriter} />
      <Block title="Layout agent" value={trace.layout} />
    </div>
  );
}
