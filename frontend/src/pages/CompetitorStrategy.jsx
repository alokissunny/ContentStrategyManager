import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Glyph from '../components/Glyph';
import { getCompetitorAnalysis } from '../api/competitors';
import {
  LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT,
  LS_SOFT_BORDER, LS_FONT, LS_DISPLAY, LSC,
} from '../theme';

// Map the analysis Markdown onto the app's type scale / colours.
const mdComponents = {
  h1: ({ children }) => <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 26, color: LS_INK, margin: '0 0 6px' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 20, color: LS_INK, margin: '30px 0 12px' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 16, color: LS_INK, margin: '20px 0 8px' }}>{children}</h3>,
  p: ({ children }) => <p style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.65, color: LS_T2, margin: '0 0 12px' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0 0 14px', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 14px', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</ol>,
  li: ({ children }) => <li style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.6, color: LS_T2 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ color: LS_INK, fontWeight: 700 }}>{children}</strong>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: LS_SIGNAL, textDecoration: 'none' }}>{children}</a>,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${LS_BORDER}`, margin: '20px 0' }} />,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '0 0 16px', border: `1px solid ${LS_BORDER}`, borderRadius: 10 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: LS_FONT, fontSize: 13 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th style={{ textAlign: 'left', padding: '9px 12px', background: LS_SOFT, color: LS_INK, fontWeight: 700, fontSize: 11.5, letterSpacing: '0.03em', textTransform: 'uppercase', borderBottom: `1px solid ${LS_BORDER}`, whiteSpace: 'nowrap' }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: '9px 12px', color: LS_T2, borderBottom: `1px solid ${LS_BORDER}`, verticalAlign: 'top' }}>{children}</td>,
  code: ({ children }) => <code style={{ fontFamily: 'monospace', fontSize: 13, background: LS_SOFT, borderRadius: 5, padding: '1px 5px', color: LS_INK }}>{children}</code>,
};

// The stored report also contains the raw competitor table and the full 30-day
// scrape dump. This page is for insights only — strip those sections (and the
// file's own title block, since the page has its own header) before rendering.
// The complete file stays available via the download link.
const HIDDEN_SECTIONS = [/^##\s*Competitors analysed/i, /^##\s*30-day activity dump/i];

function insightsOnly(markdown) {
  const out = [];
  let skipping = false;
  let started = false;
  for (const line of String(markdown || '').split('\n')) {
    if (/^##\s/.test(line)) {
      started = true;
      skipping = HIDDEN_SECTIONS.some((re) => re.test(line));
    }
    if (!started || skipping) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

export default function CompetitorStrategy() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getCompetitorAnalysis()
      .then(setData)
      .catch((err) => {
        if (err.response?.status === 404) setNotFound(true);
        else setError(err.response?.data?.message || 'Could not load your competitor strategy.');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ ...LSC, padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 48px)', maxWidth: 880 }}>
      <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 30, color: LS_INK, margin: '0 0 8px' }}>Competitor strategy</h1>
      <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: '0 0 8px', maxWidth: 640 }}>
        Your detailed competitor analysis — 30 days of their real activity, the insights it reveals, and what to do about it.
      </p>

      {data?.analyzedAt && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '0 0 8px' }}>
          <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, margin: 0 }}>
            Based on <strong style={{ color: LS_T2 }}>@{data.username}</strong> · generated {new Date(data.analyzedAt).toLocaleDateString()}
          </p>
          {data.downloadUrl && (
            <a
              href={data.downloadUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: LS_FONT, fontSize: 12.5, fontWeight: 700, color: LS_SIGNAL, textDecoration: 'none' }}
            >
              <Glyph name="download" size={14} color={LS_SIGNAL} />Full report with raw data (.md)
            </a>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ fontFamily: LS_FONT, color: LS_T2, marginTop: 24 }}>Loading your competitor strategy…</p>
      ) : notFound ? (
        <div style={{ border: `1px dashed ${LS_BORDER}`, borderRadius: 16, padding: '48px 24px', textAlign: 'center', marginTop: 24 }}>
          <Glyph name="swords" size={30} color={LS_MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 17, color: LS_INK, margin: '0 0 6px' }}>No competitor strategy yet</p>
          <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, margin: '0 0 18px' }}>
            Run competitor analysis to scrape your competitors and generate a detailed strategy.
          </p>
          <Link
            to="/dashboard/competitors"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 22px', borderRadius: 9,
              textDecoration: 'none', fontFamily: LS_FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em',
              textTransform: 'uppercase', background: LS_SIGNAL, color: '#fff',
            }}
          >
            <Glyph name="radar" size={16} color="#fff" />Go to Competitors
          </Link>
        </div>
      ) : error ? (
        <div style={{ background: LS_SOFT, border: `1px solid ${LS_SOFT_BORDER}`, borderRadius: 12, padding: '14px 16px', marginTop: 20 }}>
          <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_INK, margin: 0 }}>{error}</p>
        </div>
      ) : (
        <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, padding: 'clamp(18px, 4vw, 32px)', marginTop: 16 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{insightsOnly(data.markdown)}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
