import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import './linkedin.css';

export default function LinkedInPublisher({ initialText = '', expanded = false }) {
  const [open, setOpen] = useState(expanded);
  const [hasOpened, setHasOpened] = useState(expanded);
  return <details className="li-publisher" open={open} onToggle={(event) => { setOpen(event.currentTarget.open); if (event.currentTarget.open) setHasOpened(true); }}>
    <summary>Post to a LinkedIn company page <span className="li-badge">Experimental</span></summary>
    {hasOpened && <Composer initialText={initialText} />}
  </details>;
}

function Composer({ initialText }) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [pages, setPages] = useState([]);
  const [organization, setOrganization] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const request = useRef(null);
  const sending = useRef(false);

  async function refreshHistory() {
    try {
      const { data } = await client.get('/linkedin/publications');
      setHistory(data.publications || []);
      setHistoryError('');
    } catch { setHistoryError('Recent publishing activity could not be loaded.'); }
  }
  async function loadPages() {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/linkedin/pages');
      setPages(data.pages);
      setOrganization((current) => data.pages.some((page) => page.urn === current) ? current
        : data.pages.some((page) => page.urn === data.selectedOrganization) ? data.selectedOrganization : '');
    } catch (err) {
      setPages([]);
      setOrganization('');
      setError(err.response?.data?.message || 'Could not load company pages. Please try again.');
    } finally { setLoading(false); }
  }
  useEffect(() => { loadPages(); refreshHistory(); }, []);

  const selected = pages.find((page) => page.urn === organization);
  const locked = busy || Boolean(result);
  async function publish(event) {
    event.preventDefault();
    if (sending.current || !selected || !text.trim() || text.trim().length > 3000) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      if (!request.current) request.current = { organization, text: text.trim(), requestId: crypto.randomUUID() };
      const { data } = await client.post('/linkedin/publish', request.current);
      setResult(data.publication);
    } catch (err) {
      if (err.response?.data?.publication) setResult(err.response.data.publication);
      else if (!err.response || err.response.status >= 500) {
        setResult({ status: 'unknown', message: 'The result could not be confirmed. Check recent activity and your company page before starting another post.' });
      } else {
        setError(err.response?.data?.message || 'Could not publish. Please try again.');
        request.current = null;
      }
    } finally {
      sending.current = false;
      setBusy(false);
      refreshHistory();
    }
  }
  function startNew() {
    request.current = null;
    if (result?.status === 'published') setText('');
    setResult(null);
    setError('');
  }

  return <div className="li-composer">
    <p className="li-help">Publish a public text post now. Links can be included in the text. Images, videos and scheduling are not included.</p>
    {loading ? <p role="status">Loading company pages…</p> : <>
      <div className="li-toolbar">
        <button type="button" className="btn btn--ghost btn--sm" disabled={locked} onClick={loadPages}>Refresh pages</button>
        <Link to="/dashboard/settings">Connection settings</Link>
      </div>
      {!pages.length && !error && <p className="li-help">No eligible company pages found. Sign in with a LinkedIn account that is a Page super admin or content admin, then refresh.</p>}
      {pages.length > 0 && <form onSubmit={publish}>
        <label htmlFor={`${id}-page`}>Publish as</label>
        <select id={`${id}-page`} className="input" value={organization} disabled={locked} required
          onChange={(event) => { setOrganization(event.target.value); request.current = null; }}>
          <option value="">Choose a company page</option>
          {pages.map((page) => <option key={page.urn} value={page.urn}>{page.name} · {page.urn.split(':').pop()}</option>)}
        </select>
        <label htmlFor={`${id}-text`}>Post text</label>
        <textarea id={`${id}-text`} className="input" rows={7} value={text} disabled={locked}
          aria-describedby={`${id}-count`} placeholder="What would you like to share?" required
          onChange={(event) => { setText(event.target.value); request.current = null; }} />
        <p id={`${id}-count`} className={`li-help${text.trim().length > 3000 ? ' li-error' : ''}`}>{text.trim().length.toLocaleString()} / 3,000 characters</p>
        {selected && <p className="li-help">Public post on <a href={selected.url} target="_blank" rel="noreferrer">{selected.name}</a>. The text above will be published as written.</p>}
        {!result && <button type="submit" className="btn btn--primary" disabled={busy || !selected || !text.trim() || text.trim().length > 3000}>
          {busy ? 'Publishing…' : 'Publish to company page'}
        </button>}
      </form>}
    </>}
    {error && <p className="li-error" role="alert">{error}</p>}
    {result && <div className="li-result" role="status">
      <strong>{result.status === 'published' ? 'Published to LinkedIn' : result.status === 'failed' ? 'Post was not published' : 'Check your company page'}</strong>
      <p>{result.message || 'This request may still be processing. Check your company page before starting another post.'}</p>
      {result.permalink && <a href={result.permalink} target="_blank" rel="noreferrer">View published post</a>}
      <div className="li-toolbar">
        {request.current && ['pending', 'unknown'].includes(result.status) && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={publish}>Check request status</button>}
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={startNew}>
          {['pending', 'unknown'].includes(result.status) ? 'I checked the page · Start another post' : result.status === 'failed' ? 'Edit and retry' : 'Write another post'}
        </button>
      </div>
    </div>}
    <div className="li-history">
      <div className="li-toolbar"><strong>Recent publishing activity</strong><button type="button" className="btn btn--ghost btn--sm" onClick={refreshHistory}>Refresh activity</button></div>
      {historyError && <p className="li-error" role="alert">{historyError}</p>}
      {!history.length && !historyError && <p className="li-help">No company-page posts sent from Bauhly yet.</p>}
      <ul>{history.map((item) => <li key={item.id}>
        <strong>{item.status === 'published' ? 'Published' : item.status === 'failed' ? 'Not published' : 'Check page before retrying'}</strong>
        <span>Company page {item.organization.split(':').pop()} · {new Date(item.createdAt).toLocaleString()}</span>
        <p>{item.preview}</p>
        {item.message && item.status !== 'published' && <p>{item.message}</p>}
        {item.permalink && <a href={item.permalink} target="_blank" rel="noreferrer">View on LinkedIn</a>}
      </li>)}</ul>
    </div>
  </div>;
}
