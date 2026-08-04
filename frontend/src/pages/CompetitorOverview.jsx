import React, { useEffect, useState } from 'react';
import { getCompetitorOverview } from '../api/competitors';
import {
  LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL_TEXT,
  LS_SOFT, LS_SOFT_BORDER, LS_HOVER, LS_FONT, LS_DISPLAY, LSC,
} from '../theme';

const BUSINESS_LABELS = {
  'interior-designer': 'Interior Designer',
  'bauhly-competitor': 'Bauhly Competitor',
  other: 'Other',
};
const PILLAR_LABELS = { discovery: 'Discovery', credibility: 'Credibility', trust: 'Trust' };
const PILLAR_TINT = {
  discovery: { bg: '#EEF2FF', fg: '#3538CD' },
  credibility: { bg: '#FEF7E7', fg: '#B54708' },
  trust: { bg: '#ECFDF3', fg: '#067647' },
};
const UP = '#067647';
const DOWN = '#B42318';

const businessLabel = (v) => BUSINESS_LABELS[v] || v || '—';
const pillarLabel = (v) => PILLAR_LABELS[v] || (v ? v[0].toUpperCase() + v.slice(1) : '—');
const cap = (v) => (v ? v[0].toUpperCase() + v.slice(1) : '—');

function num(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US');
}
function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Math.round(Number(n) * 10) / 10}%`;
}

/* Frequency trend for pattern / format / day rows — state-driven, never
 * phrased as performance (matches the back office TrendCell). */
function StateTrend({ state, changePp }) {
  if (state === 'inconclusive' || changePp == null) {
    return <span style={{ color: LS_MUTED }}>Inconclusive</span>;
  }
  const tone = state === 'increasing' ? 'up' : state === 'decreasing' ? 'down' : 'flat';
  const color = tone === 'up' ? UP : tone === 'down' ? DOWN : LS_MUTED;
  const arrow = tone === 'up' ? '↑' : tone === 'down' ? '↓' : '→';
  return (
    <span style={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {arrow} {changePp > 0 ? '+' : ''}{changePp}pp
    </span>
  );
}

/* Signed change with arrow, for topics. */
function Delta({ value }) {
  if (value == null) return <span style={{ color: LS_MUTED }}>—</span>;
  const color = value > 0 ? UP : value < 0 ? DOWN : LS_MUTED;
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  return (
    <span style={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {value > 0 ? '+' : ''}{value}pp {arrow}
    </span>
  );
}

function PillarBadge({ pillar, title }) {
  if (!pillar) return null;
  const tint = PILLAR_TINT[pillar] || { bg: LS_HOVER, fg: LS_T2 };
  return (
    <span title={title} style={{
      fontFamily: LS_FONT, fontSize: 11.5, fontWeight: 600, color: tint.fg, background: tint.bg,
      borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
    }}>
      {pillarLabel(pillar)}
    </span>
  );
}

function Chip({ children }) {
  return (
    <span style={{
      fontFamily: LS_FONT, fontSize: 12, fontWeight: 600, color: LS_SIGNAL_TEXT, background: LS_SOFT,
      border: `1px solid ${LS_SOFT_BORDER}`, borderRadius: 999, padding: '4px 11px',
    }}>
      {children}
    </span>
  );
}

function KpiCard({ label, value, detail }) {
  return (
    <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 14, padding: 18, flex: 1, minWidth: 190 }}>
      <div style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_T2 }}>{label}</div>
      <div style={{ fontFamily: LS_DISPLAY, fontSize: 32, fontWeight: 700, color: LS_INK, margin: '6px 0 2px' }}>{value}</div>
      <div style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED }}>{detail}</div>
    </div>
  );
}

function Panel({ title, subtitle, right, children, style }) {
  return (
    <section style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 14, padding: 20, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontFamily: LS_DISPLAY, fontSize: 18, fontWeight: 700, color: LS_INK, margin: 0 }}>{title}</h2>
          {subtitle && <p style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_MUTED, margin: '4px 0 0', maxWidth: 640 }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const thStyle = {
  fontFamily: LS_FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase',
  color: LS_MUTED, textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${LS_BORDER}`, whiteSpace: 'nowrap',
};
const tdStyle = {
  fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, padding: '11px 12px', borderBottom: `1px solid ${LS_BORDER}`, verticalAlign: 'top',
};

function DataTable({ columns, rows, empty, minWidth = 560 }) {
  if (!rows || rows.length === 0) {
    return <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_MUTED, margin: 0 }}>{empty}</p>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth }}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ ...thStyle, textAlign: c.align || 'left' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => <td key={c.key} style={{ ...tdStyle, textAlign: c.align || 'left' }}>{c.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Four supporting-evidence tiles under an expanded row. */
function EvidenceTiles({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 12 }}>
      {items.map((it, i) => (
        <div key={i} style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 10, padding: '10px 12px', background: LS_SURFACE }}>
          <div style={{ fontFamily: LS_DISPLAY, fontSize: 16, fontWeight: 700, color: it.tone === 'up' ? UP : it.tone === 'down' ? DOWN : LS_INK }}>{it.num}</div>
          <div style={{ fontFamily: LS_FONT, fontSize: 11.5, color: LS_MUTED, marginTop: 2 }}>{it.lbl}</div>
        </div>
      ))}
    </div>
  );
}

function Examples({ examples, title = 'Post examples' }) {
  if (!examples || examples.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontFamily: LS_FONT, fontSize: 12, fontWeight: 700, color: LS_T2, textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {examples.slice(0, 3).map((ex, i) => (
          <figure key={i} style={{ margin: 0, border: `1px solid ${LS_BORDER}`, borderRadius: 10, padding: '10px 12px', background: LS_SURFACE }}>
            <blockquote style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_T2, margin: 0, lineHeight: 1.5 }}>{ex.caption}</blockquote>
            <figcaption style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_MUTED, marginTop: 6 }}>— {ex.competitor}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function Chevron({ open }) {
  return <span style={{ display: 'inline-block', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none', color: LS_MUTED, fontSize: 12 }}>▶</span>;
}

const detailBlockTitle = { fontFamily: LS_FONT, fontSize: 12, fontWeight: 700, color: LS_T2, textTransform: 'uppercase', letterSpacing: '0.02em', margin: '0 0 4px' };
const detailBlockText = { fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, margin: 0, lineHeight: 1.5 };

/* ── Caption Pattern Analysis ─────────────────────────────────────────────── */

function PatternRow({ pattern, open, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={tdStyle}>
          <div style={{ fontWeight: 600, color: LS_INK }}>{pattern.name}</div>
          {pattern.summary && <div style={{ fontSize: 12.5, color: LS_MUTED, marginTop: 2 }}>{pattern.summary}</div>}
        </td>
        <td style={tdStyle}><PillarBadge pillar={pattern.pillar} title={pattern.pillarReason} /></td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>{num(pattern.competitors)}</td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>{num(pattern.captions)}</td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>{pct(pattern.sharePct)}</td>
        <td style={{ ...tdStyle, textAlign: 'right' }}><StateTrend state={pattern.trend?.state} changePp={pattern.trend?.changePp} /></td>
        <td style={{ ...tdStyle, textAlign: 'right', width: 28 }}><Chevron open={open} /></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ ...tdStyle, background: LS_HOVER }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
              <div>
                <p style={detailBlockTitle}>What we detected</p>
                <p style={detailBlockText}>{pattern.whatWeDetected || '—'}</p>
                <p style={{ ...detailBlockTitle, marginTop: 12 }}>Why it matters</p>
                <p style={detailBlockText}>{pattern.whyItMatters || '—'}</p>
              </div>
              <div>
                <p style={detailBlockTitle}>Typical structure</p>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {(pattern.structure || []).map((s, i) => (
                    <li key={i} style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_T2, marginBottom: 6, lineHeight: 1.45 }}>
                      <strong style={{ color: LS_INK }}>{s.step}</strong>{s.detail ? ` — ${s.detail}` : ''}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p style={detailBlockTitle}>Representative example</p>
                {pattern.example ? (
                  <figure style={{ margin: 0, border: `1px solid ${LS_BORDER}`, borderRadius: 10, padding: '10px 12px', background: LS_SURFACE }}>
                    <blockquote style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_T2, margin: 0, lineHeight: 1.5 }}>{pattern.example.caption}</blockquote>
                    <figcaption style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_MUTED, marginTop: 6 }}>— {pattern.example.competitor}</figcaption>
                  </figure>
                ) : (
                  <p style={{ ...detailBlockText, color: LS_MUTED }}>No representative caption available yet.</p>
                )}
              </div>
            </div>
            <EvidenceTiles items={[
              { num: num(pattern.competitors), lbl: 'competitors' },
              { num: num(pattern.captions), lbl: 'matching captions' },
              { num: pct(pattern.sharePct), lbl: 'of analyzed captions' },
              { num: pattern.trend?.state === 'inconclusive' || pattern.trend?.changePp == null ? 'Inconclusive' : `${pattern.trend.changePp > 0 ? '+' : ''}${pattern.trend.changePp}pp`, lbl: 'trend (30 days)', tone: pattern.trend?.state === 'increasing' ? 'up' : pattern.trend?.state === 'decreasing' ? 'down' : undefined },
            ]} />
          </td>
        </tr>
      )}
    </>
  );
}

function PatternsTable({ patterns, limit }) {
  const [openId, setOpenId] = useState(null);
  const shown = limit != null ? patterns.slice(0, limit) : patterns;
  if (!patterns || patterns.length === 0) return <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_MUTED, margin: 0 }}>No caption patterns detected for this cohort yet.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
        <thead>
          <tr>
            {['Pattern', 'Authority Pillar', 'Competitors', 'Captions', 'Share of captions', 'Trend (30 days)', ''].map((h, i) => (
              <th key={i} style={{ ...thStyle, textAlign: i >= 2 && i <= 5 ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <PatternRow key={p.id || p.name} pattern={p} open={openId === (p.id || p.name)} onToggle={() => setOpenId((c) => (c === (p.id || p.name) ? null : (p.id || p.name)))} />
          ))}
        </tbody>
      </table>
      {patterns.length > shown.length && (
        <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, margin: '10px 0 0' }}>Showing the top {shown.length} of {patterns.length} patterns.</p>
      )}
    </div>
  );
}

function CaptionPatternAnalysis({ caption }) {
  const [tab, setTab] = useState('patterns');
  const windows = caption.windows || {};
  const tabs = [
    { id: 'patterns', label: 'Patterns Ranking' },
    { id: 'formats', label: 'Formats Ranking' },
    { id: 'days-times', label: 'Days & Times' },
  ];
  return (
    <Panel
      title="Caption Pattern Analysis"
      subtitle="We grouped similar public captions into recurring communication patterns and ranked them by how frequently they appear across the analyzed competitors."
      right={<span style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED }}>Based on {num(caption.kpis?.competitors)} competitors · {num(caption.kpis?.captions)} public captions</span>}
      style={{ marginTop: 20 }}
    >
      <div style={{ display: 'inline-flex', gap: 4, background: LS_HOVER, borderRadius: 10, padding: 4, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} style={{
            fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 7, padding: '7px 14px',
            background: tab === t.id ? LS_SURFACE : 'transparent', color: tab === t.id ? LS_INK : LS_T2,
            boxShadow: tab === t.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'patterns' && <PatternsTable patterns={caption.patterns || []} limit={5} />}
      {tab === 'formats' && (
        <DataTable
          empty="No format data for this cohort yet."
          columns={[
            { key: 'label', label: 'Format', render: (r) => <span style={{ fontWeight: 600, color: LS_INK }}>{r.label}</span> },
            { key: 'competitors', label: 'Competitors', align: 'right', render: (r) => num(r.competitors) },
            { key: 'posts', label: 'Posts', align: 'right', render: (r) => num(r.posts) },
            { key: 'share', label: 'Share of posts', align: 'right', render: (r) => pct(r.sharePct) },
            { key: 'prev', label: 'Previous', align: 'right', render: (r) => (r.previousPct != null ? pct(r.previousPct) : '—') },
            { key: 'curr', label: 'Current', align: 'right', render: (r) => (r.currentPct != null ? pct(r.currentPct) : '—') },
            { key: 'change', label: 'Change', align: 'right', render: (r) => <StateTrend state={r.state} changePp={r.changePp} /> },
          ]}
          rows={caption.formats || []}
        />
      )}
      {tab === 'days-times' && (
        <DataTable
          empty="No publishing-time data for this cohort yet."
          columns={[
            { key: 'label', label: 'Day', render: (r) => <span style={{ fontWeight: 600, color: LS_INK }}>{r.label}</span> },
            { key: 'peak', label: 'Best time to post', render: (r) => r.peakTime || '—' },
            { key: 'competitors', label: 'Competitors', align: 'right', render: (r) => num(r.competitors) },
            { key: 'posts', label: 'Posts', align: 'right', render: (r) => num(r.posts) },
            { key: 'share', label: 'Share of posts', align: 'right', render: (r) => pct(r.sharePct) },
            { key: 'change', label: 'Change', align: 'right', render: (r) => <StateTrend state={r.state} changePp={r.changePp} /> },
          ]}
          rows={caption.days || []}
        />
      )}

      <p style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_MUTED, margin: '14px 0 0', lineHeight: 1.5 }}>
        {tab === 'patterns'
          ? 'Ranked by how frequently each pattern appears across analyzed competitors — not by performance. pp = percentage points.'
          : tab === 'days-times'
            ? 'The busiest publishing days, and the time range each day peaks — observed competitor behaviour, not proven best times to post.'
            : 'Ranked by share of analyzed posts — a frequency ranking, not a performance ranking.'}
        {windows.previous && windows.current ? ` Previous: ${windows.previous} · Current: ${windows.current}.` : ''}
      </p>
    </Panel>
  );
}

/* ── Expandable list sections (Hooks / Topics / Hashtags) ─────────────────── */

function ListPanel({ title, subtitle, footNote, items, limit, keyOf, renderHead, renderDetail }) {
  const [openKey, setOpenKey] = useState(null);
  const shown = limit != null ? items.slice(0, limit) : items;
  return (
    <Panel title={title} subtitle={subtitle}>
      {items.length === 0 ? (
        <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_MUTED, margin: 0 }}>No data for this cohort yet.</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {shown.map((it) => {
            const k = keyOf(it);
            const open = openKey === k;
            return (
              <li key={k} style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                <button type="button" onClick={() => setOpenKey((c) => (c === k ? null : k))} style={{
                  width: '100%', textAlign: 'left', background: open ? LS_HOVER : LS_SURFACE, border: 'none', cursor: 'pointer', padding: '12px 14px',
                }}>
                  {renderHead(it, open)}
                </button>
                {open && <div style={{ padding: '0 14px 14px', background: LS_HOVER }}>{renderDetail(it)}</div>}
              </li>
            );
          })}
        </ol>
      )}
      {items.length > shown.length && (
        <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, margin: '10px 0 0' }}>Showing the top {shown.length} of {items.length}.</p>
      )}
      {footNote && <p style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_MUTED, margin: '12px 0 0', lineHeight: 1.5 }}>{footNote}</p>}
    </Panel>
  );
}

function trendWord(t) {
  return t === 'up' ? '↑ increasing' : t === 'down' ? '↓ decreasing' : '→ stable';
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CenterNote({ title, body }) {
  return (
    <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 14, padding: '40px 24px', textAlign: 'center', marginTop: 20 }}>
      <div style={{ fontFamily: LS_DISPLAY, fontSize: 18, fontWeight: 700, color: LS_INK }}>{title}</div>
      <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_MUTED, margin: '8px auto 0', maxWidth: 460 }}>{body}</p>
    </div>
  );
}

export default function CompetitorOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCompetitorOverview()
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const wrap = { ...LSC, padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 48px)', maxWidth: 1160 };
  const header = (right) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 30, color: LS_INK, margin: '0 0 6px' }}>Competitor overview</h1>
        <p style={{ fontFamily: LS_FONT, fontSize: 14.5, color: LS_MUTED, margin: 0 }}>
          What competitors in your cohort publish and how often — frequency, prevalence and change.
        </p>
      </div>
      {right}
    </div>
  );

  if (loading) return <div style={wrap}>{header(null)}<CenterNote title="Loading…" body="Fetching your competitor cohort analysis." /></div>;
  if (error) return <div style={wrap}>{header(null)}<CenterNote title="Couldn’t load the overview" body="Something went wrong loading your competitor analysis. Please try again shortly." /></div>;

  const cohort = data?.cohort;
  const scopeUsed = data?.scopeUsed;
  const dashboard = data?.dashboard;

  if (!cohort) {
    const handle = data?.username;
    const others = (data?.otherAssignedHandles || []).filter(Boolean);
    const body = others.length
      ? `No competitor cohort is assigned for ${handle ? `@${handle}` : 'this Instagram account'} yet. A cohort is already set for ${others.map((h) => `@${h}`).join(', ')} — switch to that account in the header to view it, or ask your operator to assign one for this account.`
      : `No competitor cohort is assigned for ${handle ? `@${handle}` : 'this Instagram account'} yet. Once an operator assigns one in the back office, this page will show the analysis for accounts like yours.`;
    return (
      <div style={wrap}>{header(null)}
        <CenterNote title="No competitor cohort assigned yet" body={body} />
      </div>
    );
  }

  const cohortChip = <Chip>{businessLabel(cohort.businessCategory)} · {cohort.location}</Chip>;
  if (!dashboard) {
    return (
      <div style={wrap}>{header(cohortChip)}
        <CenterNote title="Analysis is being prepared" body={`We don’t have a competitor analysis for ${businessLabel(cohort.businessCategory)} · ${cohort.location} yet. It’ll appear here as soon as it’s ready.`} />
      </div>
    );
  }

  const caption = dashboard.captionAnalysis || { kpis: {}, patterns: [], formats: [], days: [] };
  const summary = dashboard.summary || {};
  const kpis = caption.kpis || {};
  const kpiCompetitors = kpis.competitors ?? summary.accountsAnalyzed ?? data.accountsAnalyzed;
  const kpiCaptions = kpis.captions ?? summary.postsAnalyzed ?? data.postsAnalyzed;
  const kpiPatterns = kpis.patternsDetected ?? (caption.patterns ? caption.patterns.length : 0);
  const basis = dashboard.hashtagBasis || { highPerformers: 0, comparison: 0 };
  const generated = fmtDate(data.generatedAt);

  return (
    <div style={wrap}>
      {header(
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {cohortChip}
          {generated && <span style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_MUTED }}>Updated {generated}</span>}
        </div>,
      )}

      {scopeUsed && scopeUsed.location !== cohort.location && (
        <p style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_MUTED, marginTop: 12, background: LS_HOVER, borderRadius: 10, padding: '10px 14px' }}>
          No analysis for {cohort.location} yet — showing the closest available cohort: {businessLabel(scopeUsed.businessCategory)} · {scopeUsed.location}.
        </p>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 20 }}>
        <KpiCard label="Competitors Analyzed" value={num(kpiCompetitors)} detail="unique accounts" />
        <KpiCard label="Public Captions Analyzed" value={num(kpiCaptions)} detail="from the selected time period" />
        <KpiCard label="Caption Patterns Detected" value={num(kpiPatterns)} detail="recurring patterns identified" />
      </div>

      <CaptionPatternAnalysis caption={caption} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginTop: 20, alignItems: 'start' }}>
        <ListPanel
          title="Most Frequently Used Hooks"
          subtitle="How often each opener appears — not performance."
          footNote="Use rate is the share of analyzed captions opening with this hook. The pillar badge is where top performers lean on it hardest versus the comparison group."
          items={dashboard.hooks || []}
          limit={5}
          keyOf={(h) => h.hookType}
          renderHead={(h, open) => (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                <span style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 14, color: LS_INK }}>{h.hookType}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: LS_FONT, fontSize: 12.5, color: h.trend === 'up' ? UP : h.trend === 'down' ? DOWN : LS_MUTED, fontWeight: 600 }}>{trendWord(h.trend)}</span>
                  <span style={{ fontFamily: LS_DISPLAY, fontSize: 15, fontWeight: 700, color: LS_INK }}>{pct(h.useRate)}</span>
                  <Chevron open={open} />
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                {h.structure && <span style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED }}>{h.structure}</span>}
                <PillarBadge pillar={h.pillar} />
              </div>
            </>
          )}
          renderDetail={(h) => (
            <>
              <EvidenceTiles items={[
                { num: pct(h.useRate), lbl: 'of analyzed captions' },
                { num: pct(h.medianEngagement), lbl: 'median public ER' },
                { num: cap(h.trend === 'up' ? 'increasing' : h.trend === 'down' ? 'decreasing' : 'stable'), lbl: 'frequency trend', tone: h.trend === 'up' ? 'up' : h.trend === 'down' ? 'down' : undefined },
                { num: cap(h.pillar), lbl: 'authority pillar' },
              ]} />
              {h.structure && (<><p style={{ ...detailBlockTitle, marginTop: 12 }}>Typical opener</p><p style={detailBlockText}>{h.structure}</p></>)}
              <Examples examples={h.exampleCaptions} />
            </>
          )}
        />

        <ListPanel
          title="Topics"
          subtitle="What competitors post about — ranked by share of posts."
          footNote="Share of classified competitor posts mentioning the topic. The pillar badge is where top performers lean on it hardest versus the comparison group."
          items={dashboard.topics || []}
          limit={5}
          keyOf={(t) => t.topic}
          renderHead={(t, open) => {
            const max = (dashboard.topics && dashboard.topics[0] && dashboard.topics[0].sharePct) || 1;
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 14, color: LS_INK }}>{t.topic}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: LS_DISPLAY, fontSize: 15, fontWeight: 700, color: LS_INK }}>{pct(t.sharePct)}</span>
                    <Chevron open={open} />
                  </span>
                </div>
                <div style={{ height: 6, background: LS_BORDER, borderRadius: 999, margin: '8px 0', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((t.sharePct / max) * 100)}%`, background: PILLAR_TINT[t.pillar]?.fg || LS_SIGNAL_TEXT, borderRadius: 999 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED }}>{num(t.accounts)} accounts · {num(t.posts)} posts</span>
                  <PillarBadge pillar={t.pillar} />
                  <Delta value={t.changePp} />
                </div>
              </>
            );
          }}
          renderDetail={(t) => (
            <>
              <EvidenceTiles items={[
                { num: pct(t.sharePct), lbl: 'share of posts' },
                { num: num(t.posts), lbl: 'matching posts' },
                { num: t.changePp > 0 ? `+${t.changePp}pp` : `${t.changePp}pp`, lbl: 'vs prior window', tone: t.changePp > 0 ? 'up' : t.changePp < 0 ? 'down' : undefined },
                { num: cap(t.pillar), lbl: 'authority pillar' },
              ]} />
              <p style={{ ...detailBlockTitle, marginTop: 12 }}>Coverage</p>
              <p style={detailBlockText}>{num(t.accounts)} accounts · {num(t.posts)} posts in the analyzed set.</p>
              <Examples examples={t.exampleCaptions} />
            </>
          )}
        />

        <ListPanel
          title="Most Frequently Used Hashtags"
          subtitle="Ranked by how often competitors use them."
          footNote="Counted from the captions of collected posts. The pillar badge is where top performers lean on the tag hardest versus the comparison group."
          items={dashboard.hashtags || []}
          limit={5}
          keyOf={(h) => h.tag}
          renderHead={(h, open) => {
            const diff = (h.highPerformerAccounts || 0) - (h.comparisonAccounts || 0);
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 14, color: LS_INK }}>{h.tag}</span>
                    <span style={{ fontFamily: LS_FONT, fontSize: 11, color: LS_T2, background: LS_HOVER, borderRadius: 999, padding: '2px 8px' }}>{h.type}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: LS_DISPLAY, fontSize: 15, fontWeight: 700, color: diff > 0 ? UP : diff < 0 ? DOWN : LS_MUTED }}>{diff > 0 ? '+' : ''}{diff}</span>
                    <Chevron open={open} />
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED }}>
                    Used by <strong style={{ color: LS_T2 }}>{num(h.highPerformerAccounts)} of {num(basis.highPerformers)}</strong> more frequent posters · {num(h.comparisonAccounts)} of {num(basis.comparison)} others
                  </span>
                  <PillarBadge pillar={h.pillar} />
                </div>
              </>
            );
          }}
          renderDetail={(h) => {
            const diff = (h.highPerformerAccounts || 0) - (h.comparisonAccounts || 0);
            return (
              <>
                <EvidenceTiles items={[
                  { num: `${num(h.highPerformerAccounts)} / ${num(basis.highPerformers)}`, lbl: 'more frequent posters' },
                  { num: `${num(h.comparisonAccounts)} / ${num(basis.comparison)}`, lbl: 'other accounts' },
                  { num: `${diff > 0 ? '+' : ''}${diff}`, lbl: 'usage gap', tone: diff > 0 ? 'up' : diff < 0 ? 'down' : undefined },
                  { num: cap(h.pillar), lbl: 'authority pillar' },
                ]} />
                <p style={{ ...detailBlockTitle, marginTop: 12 }}>Tag type</p>
                <p style={detailBlockText}>{h.type} hashtag — counted from captions of collected posts, not reach.</p>
                <Examples examples={h.exampleCaptions} />
              </>
            );
          }}
        />
      </div>
    </div>
  );
}
