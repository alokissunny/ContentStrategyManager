import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { getState } from '../lib/store';
import { identityOf } from '../lib/identity';
import { addAiDebugEntry } from '../lib/aiDebug';
const logCalls = data => (data?.debug?.agents || []).forEach(entry => addAiDebugEntry(entry));
import { useFeatureFlags } from '../lib/featureFlags';
import './Research.css';

export default function Research() {
  const { research } = useFeatureFlags();
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState('linkedin');
  const [theme, setTheme] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  async function generate(event) {
    event.preventDefault();
    if (busy || !topic.trim()) return;
    setBusy(true); setError(''); setCopied(false);
    try {
      const brandFonts = {};
      const identity = identityOf(getState());
      const selectedFonts = new Set(Object.values(identity.type).map(slot => slot?.face));
      for (const font of identity.fonts.filter(font => selectedFonts.has(font.id))) {
        if (!font.url?.startsWith('blob:') && !font.url?.startsWith('data:')) continue;
        const blob = await fetch(font.url).then(r => r.blob());
        if (blob.size > 1000000) throw new Error(`Brand font ${font.name} is too large for Research (maximum 1 MB).`);
        const typed = new Blob([blob], { type: blob.type?.startsWith('font/') ? blob.type : 'application/octet-stream' });
        brandFonts[font.id] = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(`Could not read brand font ${font.name}.`)); reader.readAsDataURL(typed); });
      }
      const { data } = await client.post('/research/carousel', { topic: topic.trim(), platform, theme, brandFonts }, { headers: { 'x-research-enabled': '1' }, timeout: 660000 });
      logCalls(data);
      setResult(data);
    } catch (err) { logCalls(err.response?.data); setError(err.response?.data?.message || err.message || 'Could not generate the carousel. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  if (!research) return <div className="research-page"><h1>Research</h1><p>Enable Research in <Link to="/dashboard/settings">Settings → Experimental features</Link> to create carousels from a topic.</p></div>;
  return <div className="research-page">
    <header><span className="research-badge">Experimental</span><h1>Research</h1><p>Start with a topic. Get a sourced carousel, ready to share.</p></header>
    <form className="card research-form" onSubmit={generate}>
      <label htmlFor="research-topic">What would you like to explore?</label>
      <textarea id="research-topic" value={topic} onChange={e => setTopic(e.target.value)} maxLength={500} required rows={3} placeholder="e.g. How small businesses can reduce food waste" disabled={busy} />
      <div className="research-options">
        <label>Platform<select value={platform} onChange={e => setPlatform(e.target.value)} disabled={busy}><option value="linkedin">LinkedIn</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="x">X</option></select></label>
        <label>Layout<select value={theme} onChange={e => setTheme(e.target.value)} disabled={busy}><option value="default">Clean</option><option value="bold">Bold</option><option value="technical">Technical</option></select></label>
        <button className="btn btn--primary" disabled={busy || !topic.trim()}>{busy ? 'Creating carousel…' : 'Generate carousel'}</button>
      </div>
      <p className="research-note">Uses the active account’s <Link to="/dashboard/library-settings">Brand Kit</Link> colors, fonts, logo and background. Without a connected account, the selected layout’s defaults apply.</p>
      <p className="research-note">Powered by <a href="https://github.com/roscodetech/claude-carousel" target="_blank" rel="noreferrer">claude-carousel</a>. Includes source references and checks for unsupported claims and layout problems.</p>
      {busy && <p role="status">Researching, writing, and checking your slides. This may take several minutes. Keep this page open.</p>}
      {error && <p role="alert" className="research-error">{error}</p>}
    </form>
    {!result && !busy && <div className="research-empty"><h2>Your next carousel starts here</h2><p>Choose a focused question, trend, or practical topic. We’ll build the story from hook to takeaway and include a Sources slide.</p></div>}
    {result && <section aria-label="Generated carousel" className="research-result">
      <div className="research-result-heading"><div><h2>{result.topic}</h2><p>{result.slides.length} slides · {result.platform} · Content and layout checks passed</p></div><a className="btn btn--primary" href={result.downloadUrl}>Download carousel ZIP</a></div>
      {result.brandKit && <p>Brand Kit: {result.brandKit.name} · @{result.brandKit.handle}</p>}
      {result.brandKit?.warnings?.map((warning, i) => <p key={i} role="status">{warning}</p>)}
      <div className="research-slides">{result.slides.map((slide, i) => <figure key={i}><img src={slide.url} alt={`Slide ${i + 1}: ${slide.title}`} loading="lazy" /><figcaption>{i + 1}. {slide.title}</figcaption></figure>)}</div>
      <div className="card research-copy"><h3>Caption</h3><p>{result.caption}</p><button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(result.caption); setCopied(true); } catch { setError('Clipboard unavailable. Select and copy the caption below.'); } }}>{copied ? 'Copied' : 'Copy caption'}</button><h3>Sources</h3><ol>{result.sources.map((source, i) => <li key={i}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ol><p className="research-note">The ZIP includes PNG slides, editable HTML, the caption, and source notes. Download it before leaving this page.</p></div>
    </section>}
  </div>;
}
