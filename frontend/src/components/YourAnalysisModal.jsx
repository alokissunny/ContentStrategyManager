/*
 * YourAnalysisModal — the authority funnel + Brand DNA from onboarding,
 * reopened from the week plan via "Your analysis".
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Glyph from './Glyph';
import { getAuthorityFunnel } from '../api/instagram';
import { getBrandDna } from '../api/brandDna';
import {
  LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT,
  LS_FONT, LS_DISPLAY,
} from '../theme';

const PILLARS = {
  discovery: { label: 'Discovery', icon: 'search', tint: '#E8EEFF', strong: '#3B6FE0' },
  credibility: { label: 'Credibility', icon: 'award', tint: '#FBEFD6', strong: '#C98A1B' },
  trust: { label: 'Trust', icon: 'shield-check', tint: '#DCF3E4', strong: '#2E9E5B' },
};

function verdictDot(verdict) {
  const v = (verdict || '').toLowerCase();
  if (v.includes('strong')) return '#2E9E5B';
  if (v.includes('moderate') || v.includes('early')) return '#E39A2B';
  return LS_MUTED;
}

function Label({ children }) {
  return (
    <span style={{
      display: 'block', fontFamily: LS_FONT, fontSize: 10.5, fontWeight: 700,
      letterSpacing: '0.1em', textTransform: 'uppercase', color: LS_MUTED, marginBottom: 6,
    }}>
      {children}
    </span>
  );
}

function Body({ children }) {
  return <p style={{ fontFamily: LS_FONT, fontSize: 14, lineHeight: 1.6, color: LS_T2, margin: 0 }}>{children}</p>;
}

function PillarCard({ row }) {
  const p = PILLARS[row.pillar] || PILLARS.discovery;
  return (
    <div style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          display: 'grid', placeItems: 'center', width: 30, height: 30, flexShrink: 0,
          borderRadius: '50%', background: p.tint,
        }}>
          <Glyph name={p.icon} size={16} color={p.strong} />
        </span>
        <b style={{ fontFamily: LS_FONT, fontSize: 16, color: LS_INK }}>{p.label}</b>
        <span style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7,
          fontFamily: LS_FONT, fontSize: 12.5, fontWeight: 600, color: LS_T2,
        }}>
          <i style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: verdictDot(row.verdict) }} />
          {row.verdict}
        </span>
      </div>

      {row.evidence?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Label>Evidence</Label>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {row.evidence.map((e) => (
              <li key={e} style={{
                position: 'relative', paddingLeft: 16, fontFamily: LS_FONT,
                fontSize: 14, lineHeight: 1.5, color: LS_T2,
              }}>
                <span style={{
                  position: 'absolute', left: 3, top: 8, width: 4, height: 4,
                  borderRadius: '50%', background: LS_MUTED,
                }} />
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.whyMatters && (
        <div style={{ marginTop: 16 }}>
          <Label>Why this matters</Label>
          <Body>{row.whyMatters}</Body>
        </div>
      )}

      {row.recommendation && (
        <div style={{ marginTop: 16 }}>
          <Label>Recommendation</Label>
          <Body>{row.recommendation}</Body>
        </div>
      )}
    </div>
  );
}

export default function YourAnalysisModal({ username, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [funnelData, setFunnelData] = useState(null);
  const [brandSections, setBrandSections] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      getAuthorityFunnel(username).catch(() => null),
      getBrandDna().catch((err) => (err.response?.status === 404 ? null : Promise.reject(err))),
    ])
      .then(([funnel, brand]) => {
        if (cancelled) return;
        if (!funnel?.funnel?.length && !brand?.sections?.length) {
          setError('No analysis yet. Connect Instagram from onboarding to generate one.');
        } else {
          setFunnelData(funnel);
          setBrandSections((brand?.sections || []).filter((s) => s.value?.trim()));
        }
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load your analysis just now.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const week = funnelData?.week;
  const funnel = funnelData?.funnel || [];
  const focus = PILLARS[week?.focus] || PILLARS.discovery;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your analysis"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center',
        padding: 'clamp(12px, 4vw, 40px)', background: 'rgba(16,18,23,0.64)', backdropFilter: 'blur(3px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', flexDirection: 'column', width: 'min(720px, 100%)', maxHeight: '90vh',
          background: LS_SURFACE, borderRadius: 20, boxShadow: '0 24px 60px rgba(16,18,23,0.28)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '18px clamp(20px, 5vw, 36px)', borderBottom: `1px solid ${LS_BORDER}`, flexShrink: 0,
        }}>
          <div>
            <span style={{
              fontFamily: LS_FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: LS_MUTED,
            }}>
              Your analysis
            </span>
            {username && (
              <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, margin: '4px 0 0' }}>
                @{username}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 36, height: 36, borderRadius: 10, border: `1px solid ${LS_BORDER}`,
              background: LS_SURFACE, cursor: 'pointer', display: 'grid', placeItems: 'center',
              color: LS_T2,
            }}
          >
            <Glyph name="x" size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 'clamp(20px, 4vw, 32px) clamp(20px, 5vw, 36px)' }}>
          {loading && (
            <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: 0 }}>Loading your analysis…</p>
          )}

          {!loading && error && (
            <div style={{
              border: `1px dashed ${LS_BORDER}`, borderRadius: 12, padding: '28px 20px', textAlign: 'center',
            }}>
              <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: 0 }}>{error}</p>
            </div>
          )}

          {!loading && !error && week && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
                <span style={{
                  display: 'grid', placeItems: 'center', width: 48, height: 48, flexShrink: 0,
                  borderRadius: '50%', background: focus.tint,
                }}>
                  <Glyph name={focus.icon} size={24} color={focus.strong} />
                </span>
                <h2 style={{
                  fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 'clamp(22px, 3.5vw, 30px)',
                  letterSpacing: '-0.02em', lineHeight: 1.15, color: LS_INK, margin: 0,
                }}>
                  {week.headline}
                </h2>
              </div>

              {week.observation && (
                <div style={{ marginTop: 22 }}>
                  <Label>{week.confidence === 'low' ? "Where you're starting" : 'Observation'}</Label>
                  <Body>{week.observation}</Body>
                </div>
              )}
              {week.hypothesis && (
                <div style={{ marginTop: 18 }}>
                  <Label>Hypothesis</Label>
                  <Body>{week.hypothesis}</Body>
                </div>
              )}
              {week.whyMatters && (
                <div style={{ marginTop: 18 }}>
                  <Label>Why this matters</Label>
                  <Body>{week.whyMatters}</Body>
                </div>
              )}
              {week.recommendation?.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <Label>Recommendation</Label>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {week.recommendation.map((r) => (
                      <li
                        key={typeof r === 'string' ? r : r.move}
                        style={{
                          position: 'relative', paddingLeft: 20, fontFamily: LS_FONT,
                          fontSize: 14, lineHeight: 1.5, color: LS_INK,
                        }}
                      >
                        <span style={{
                          position: 'absolute', left: 4, top: 7, width: 6, height: 6,
                          borderRadius: '50%', background: LS_SIGNAL,
                        }} />
                        {typeof r === 'string' ? r : r.move}
                      </li>
                    ))}
                  </ul>
                  {week.note && (
                    <p style={{
                      marginTop: 14, fontFamily: LS_FONT, fontSize: 14, fontStyle: 'italic',
                      color: LS_MUTED, lineHeight: 1.55,
                    }}>
                      {week.note}
                    </p>
                  )}
                </div>
              )}

              {funnel.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
                  <Label>Authority funnel</Label>
                  {funnel.map((row) => (
                    <PillarCard key={row.pillar} row={row} />
                  ))}
                </div>
              )}
            </>
          )}

          {!loading && !error && brandSections.length > 0 && (
            <div style={{ marginTop: week ? 32 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <Label>Brand profile</Label>
                <Link
                  to="/dashboard/brand-dna"
                  onClick={onClose}
                  style={{
                    fontFamily: LS_FONT, fontSize: 12.5, fontWeight: 700, color: LS_SIGNAL, textDecoration: 'none',
                  }}
                >
                  Edit profile →
                </Link>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {brandSections.map((s) => (
                  <div
                    key={s.key}
                    style={{
                      border: `1px solid ${LS_BORDER}`, borderRadius: 12, padding: '14px 16px',
                      background: LS_SOFT,
                    }}
                  >
                    <div style={{
                      fontFamily: LS_FONT, fontSize: 12, fontWeight: 700, color: LS_MUTED,
                      letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6,
                    }}>
                      {s.label}
                    </div>
                    <p style={{
                      fontFamily: LS_FONT, fontSize: 14.5, lineHeight: 1.55, color: LS_INK, margin: 0,
                      whiteSpace: 'pre-wrap',
                    }}>
                      {s.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{
          flexShrink: 0, padding: '14px clamp(20px, 5vw, 36px)', borderTop: `1px solid ${LS_BORDER}`,
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%',
              height: 48, borderRadius: 12, border: `1px solid ${LS_BORDER}`, cursor: 'pointer',
              fontFamily: LS_FONT, fontSize: 14.5, fontWeight: 700, background: LS_SURFACE, color: LS_INK,
            }}
          >
            Back to your plan
          </button>
        </div>
      </div>
    </div>
  );
}
