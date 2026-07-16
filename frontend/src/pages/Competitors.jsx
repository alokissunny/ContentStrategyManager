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

// A shimmering placeholder block used to build skeleton cards while a scan runs.
function Shimmer({ w, h, r = 6, style }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: `linear-gradient(90deg, ${LS_SOFT} 25%, ${LS_SOFT_BORDER} 50%, ${LS_SOFT} 75%)`,
      backgroundSize: '450px 100%', animation: 'lsShimmer 1.4s ease infinite',
      ...style,
    }} />
  );
}

// Skeleton mirroring CompetitorCard's layout so the loading state reads as
// "competitors are coming" rather than a blank spinner.
function SkeletonCard() {
  return (
    <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Shimmer w={40} h={40} r="50%" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Shimmer w="60%" h={13} style={{ marginBottom: 8 }} />
          <Shimmer w="38%" h={11} />
        </div>
        <Shimmer w={42} h={26} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        {['72%', '86%', '64%', '78%'].map((w, i) => <Shimmer key={i} w={w} h={9} />)}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
        {[70, 96, 60].map((w, i) => <Shimmer key={i} w={w} h={20} r={999} />)}
      </div>
    </div>
  );
}

function SkeletonCohort({ icon, title, subtitle, count }) {
  return (
    <div style={{ flex: 1, minWidth: 280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <Glyph name={icon} size={18} color={LS_MUTED} />
        <h2 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 17, color: LS_INK, margin: 0 }}>{title}</h2>
        <Glyph name="loader" size={14} color={LS_SIGNAL} style={{ animation: 'lsSpin 0.9s linear infinite' }} />
      </div>
      <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, margin: '0 0 14px' }}>{subtitle}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}

const SCAN_MESSAGES = [
  'Reading your brand & niche…',
  'Pinpointing your location…',
  'Finding accounts in your market…',
  'Matching design style & clients…',
  'Ranking your closest competitors…',
];

// Cycles through status lines while a scan is in flight (the scan takes ~20s).
function useCyclingMessage(active, messages, interval = 2600) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    setI(0);
    const iv = setInterval(() => setI((p) => (p + 1) % messages.length), interval);
    return () => clearInterval(iv);
  }, [active, messages, interval]);
  return messages[i];
}

function ScanningState({ active }) {
  const message = useCyclingMessage(active, SCAN_MESSAGES);
  return (
    <div style={{ marginTop: 24 }}>
      <p style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: LS_FONT, fontWeight: 700, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: LS_SIGNAL, margin: '0 0 4px' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: LS_SIGNAL, animation: 'lsSpark 1.2s ease-in-out infinite' }} />
        {active ? 'Scanning for competitors' : 'Loading competitors'}
      </p>
      <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: '0 0 20px', minHeight: 20 }}>
        {active ? message : 'One moment…'}
      </p>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <SkeletonCohort icon="users" title="Similar reach" subtitle="Peers at roughly your follower count." count={3} />
        <SkeletonCohort icon="trending-up" title="Higher reach" subtitle="Bigger accounts to study and aspire to." count={2} />
      </div>
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

      {running || (loading && !hasResults) ? (
        <ScanningState active={running} />
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
