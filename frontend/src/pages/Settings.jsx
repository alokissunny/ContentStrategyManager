import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Glyph from '../components/Glyph';
import { useAuth } from '../context/AuthContext';
import { listInstagramProfiles } from '../api/instagram';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_FONT, LS_DISPLAY, LSC } from '../theme';

function formatCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n || 0}`;
}

function AccountRow({ profile }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 0', borderBottom: `1px solid ${LS_BORDER}` }}>
      <div style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, background: LS_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {profile.profilePicUrl ? (
          <img src={profile.profilePicUrl} alt={profile.username} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Glyph name="instagram" size={20} color={LS_SIGNAL} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: LS_FONT, fontSize: 15, fontWeight: 600, color: LS_INK }}>
          @{profile.username}
          {profile.isVerified && <Glyph name="badge-check" size={14} color={LS_SIGNAL} style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
        </div>
        <div style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, marginTop: 2 }}>
          {formatCount(profile.followersCount)} followers · {formatCount(profile.postsCount)} posts
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listInstagramProfiles()
      .then((data) => setProfiles(data.profiles || []))
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ ...LSC, padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 48px)', maxWidth: 760 }}>
      <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 30, color: LS_INK, margin: '0 0 8px' }}>Settings</h1>
      <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: '0 0 36px' }}>
        Manage your account and connected Instagram profiles.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 17, color: LS_INK, margin: 0 }}>
          Instagram accounts
        </h2>
        {isAdmin && (
          <span style={{ fontFamily: LS_FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: LS_SIGNAL, background: LS_SOFT, padding: '4px 10px', borderRadius: 999 }}>
            Admin
          </span>
        )}
      </div>
      <p style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_T2, margin: '0 0 18px' }}>
        {isAdmin
          ? 'As an admin you can connect more than one handle. Each one runs the onboarding analysis and gets its own Brand DNA.'
          : 'The Instagram handle connected to your account.'}
      </p>

      <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, padding: '4px clamp(16px, 4vw, 24px)' }}>
        {loading ? (
          <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, padding: '20px 0' }}>Loading…</p>
        ) : profiles.length === 0 ? (
          <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, padding: '20px 0' }}>
            No Instagram connected yet.{' '}
            <Link to="/onboarding" style={{ color: LS_SIGNAL, fontWeight: 600, textDecoration: 'none' }}>Connect one →</Link>
          </p>
        ) : (
          profiles.map((p) => <AccountRow key={p._id} profile={p} />)
        )}
      </div>

      {isAdmin && (
        <div style={{ marginTop: 22 }}>
          <Link
            to="/onboarding?add=1"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 9, height: 44, padding: '0 22px', borderRadius: 9,
              textDecoration: 'none', fontFamily: LS_FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em',
              textTransform: 'uppercase', background: LS_SIGNAL, color: '#fff',
            }}
          >
            <Glyph name="plus" size={16} color="#fff" /> Add Instagram account
          </Link>
        </div>
      )}
    </div>
  );
}
