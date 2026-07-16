import React, { useEffect, useState } from 'react';
import Glyph from '../components/Glyph';
import { fetchCompetitors, getCompetitors } from '../api/competitors';
import {
  LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT,
  LS_SOFT_BORDER, LS_FONT, LS_DISPLAY, LSC,
} from '../theme';

function formatFollowers(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function Chip({ children }) {
  return (
    <span style={{
      display: 'inline-block', fontFamily: LS_FONT, fontSize: 11, fontWeight: 600,
      color: LS_T2, background: LS_SOFT, border: `1px solid ${LS_SOFT_BORDER}`,
      borderRadius: 999, padding: '3px 9px', lineHeight: 1.4,
    }}>
      {children}
    </span>
  );
}

function Attr({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 6, fontFamily: LS_FONT, fontSize: 12.5, lineHeight: 1.5 }}>
      <span style={{ color: LS_MUTED, flexShrink: 0, minWidth: 74 }}>{label}</span>
      <span style={{ color: LS_T2 }}>{value}</span>
    </div>
  );
}

function CompetitorCard({ c }) {
  return (
    <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
          background: LS_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${LS_BORDER}`,
        }}>
          {c.profilePicUrl
            ? <img src={c.profilePicUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Glyph name="user" size={18} color={LS_MUTED} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{
              fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 15, color: LS_INK, letterSpacing: '-0.01em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
            }}>
              {c.name || `@${c.username}`}
            </span>
            {c.isVerified && <Glyph name="badge-check" size={14} color={LS_SIGNAL} style={{ flexShrink: 0 }} />}
          </div>
          <a
            href={`https://instagram.com/${c.username}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_T2, textDecoration: 'none' }}
          >
            @{c.username}
          </a>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 16, color: LS_INK }}>
            {formatFollowers(c.followersCount)}
          </div>
          <div style={{ fontFamily: LS_FONT, fontSize: 10.5, color: LS_MUTED, letterSpacing: '0.03em' }}>
            {c.followersVerified ? 'followers' : 'est. followers'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 12 }}>
        <Attr label="Region" value={c.region} />
        <Attr label="Design" value={c.designStyle} />
        <Attr label="Serves" value={c.targetClient} />
        <Attr label="Offers" value={c.serviceOffering} />
      </div>

      {c.matchReasons?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {c.matchReasons.map((r, i) => <Chip key={i}>{r}</Chip>)}
        </div>
      )}
    </div>
  );
}

function Cohort({ icon, title, subtitle, items }) {
  return (
    <div style={{ flex: 1, minWidth: 280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <Glyph name={icon} size={18} color={LS_SIGNAL} />
        <h2 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 17, color: LS_INK, margin: 0 }}>{title}</h2>
        <span style={{
          fontFamily: LS_FONT, fontSize: 11, fontWeight: 700, color: LS_SIGNAL,
          background: LS_SOFT, borderRadius: 999, padding: '1px 8px',
        }}>
          {items.length}
        </span>
      </div>
      <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, margin: '0 0 14px' }}>{subtitle}</p>
      {items.length === 0 ? (
        <div style={{ border: `1px dashed ${LS_BORDER}`, borderRadius: 12, padding: '28px 16px', textAlign: 'center' }}>
          <p style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_MUTED, margin: 0 }}>No accounts in this cohort yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((c) => <CompetitorCard key={c.username} c={c} />)}
        </div>
      )}
    </div>
  );
}

export default function Competitors() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getCompetitors()
      .then(setData)
      .catch((err) => {
        if (err.response?.status !== 404) setError(err.response?.data?.message || 'Could not load competitors.');
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleRun() {
    setRunning(true);
    setError('');
    try {
      const result = await fetchCompetitors();
      setData(result);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not find competitors. Make sure a handle is connected.');
    } finally {
      setRunning(false);
    }
  }

  const similar = data?.cohorts?.similar || [];
  const higher = data?.cohorts?.higher || [];
  const hasResults = similar.length > 0 || higher.length > 0;

  return (
    <div style={{ ...LSC, padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 48px)', maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 30, color: LS_INK, margin: '0 0 8px' }}>Competitors</h1>
          <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: 0, maxWidth: 620 }}>
            Accounts in your region with a similar design style, target client, and service offering —
            grouped by how their reach compares to yours.
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          style={{
            height: 44, padding: '0 22px', borderRadius: 9, border: 'none', cursor: running ? 'default' : 'pointer',
            opacity: running ? 0.6 : 1, fontFamily: LS_FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', background: LS_SIGNAL, color: '#fff', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <Glyph name="radar" size={16} color="#fff" />
          {running ? 'Scanning…' : hasResults ? 'Refresh' : 'Find competitors'}
        </button>
      </div>

      {data?.username && (
        <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, margin: '16px 0 0' }}>
          Based on <strong style={{ color: LS_T2 }}>@{data.username}</strong>
          {data.baseRegion ? ` · ${data.baseRegion}` : ''}
          {data.baseFollowers ? ` · ${formatFollowers(data.baseFollowers)} followers` : ''}
        </p>
      )}

      {error && (
        <div style={{ background: LS_SOFT, border: `1px solid ${LS_SOFT_BORDER}`, borderRadius: 12, padding: '14px 16px', marginTop: 20 }}>
          <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_INK, margin: 0 }}>{error}</p>
        </div>
      )}

      {loading ? (
        <p style={{ fontFamily: LS_FONT, color: LS_T2, marginTop: 28 }}>Loading competitors…</p>
      ) : !hasResults && !error ? (
        <div style={{ border: `1px dashed ${LS_BORDER}`, borderRadius: 16, padding: '48px 24px', textAlign: 'center', marginTop: 28 }}>
          <Glyph name="radar" size={30} color={LS_MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 17, color: LS_INK, margin: '0 0 6px' }}>
            No competitor scan yet
          </p>
          <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, margin: 0 }}>
            Run a scan to see peers with similar and higher reach.
          </p>
        </div>
      ) : hasResults ? (
        <div style={{ display: 'flex', gap: 24, marginTop: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Cohort
            icon="users"
            title="Similar reach"
            subtitle="Peers at roughly your follower count — your direct competitive set."
            items={similar}
          />
          <Cohort
            icon="trending-up"
            title="Higher reach"
            subtitle="Bigger accounts to study and aspire to."
            items={higher}
          />
        </div>
      ) : null}
    </div>
  );
}
