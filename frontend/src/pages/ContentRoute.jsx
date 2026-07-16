import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Glyph from '../components/Glyph';
import { getCurrentRoute, generateRoute, markDayPublished } from '../api/routes';
import {
  LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT,
  LS_SOFT_BORDER, LS_FONT, LS_DISPLAY, LSC,
} from '../theme';

// Pillar accent colours pulled from the design-system tokens so the goal chips
// match the dashboard's Discovery / Credibility / Trust palette.
const PILLAR = {
  discovery: { soft: 'var(--discovery-100)', ink: 'var(--discovery-600)', label: 'Discovery' },
  credibility: { soft: 'var(--credibility-100)', ink: 'var(--credibility-600)', label: 'Credibility' },
  trust: { soft: 'var(--trust-100)', ink: 'var(--trust-600)', label: 'Trust' },
};
const FORMAT_ICON = { Reel: 'play', Carousel: 'copy', Post: 'image', Story: 'book-open' };
const TABS = ['Caption', 'Strategy', 'Prompts', 'Plan'];

const btnGhost = {
  display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 16px', borderRadius: 10,
  border: `1px solid ${LS_BORDER}`, background: LS_SURFACE, cursor: 'pointer', fontFamily: LS_FONT,
  fontSize: 13.5, fontWeight: 600, color: LS_INK,
};

function Field({ icon, label, children }) {
  return (
    <div style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Glyph name={icon} size={13} color={LS_MUTED} />
        <span style={{ fontFamily: LS_FONT, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: LS_MUTED }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function Para({ children }) {
  return <p style={{ fontFamily: LS_FONT, fontSize: 14.5, lineHeight: 1.6, color: LS_INK, margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>{children}</p>;
}

function buildMarkdown(route) {
  const lines = [`# Weekly route — ${route.weekLabel}`, `Focus: ${PILLAR[route.focus?.pillar]?.label || ''} — ${route.focus?.headline || ''}`, ''];
  (route.days || []).forEach((d) => {
    lines.push(`## ${d.day}${d.dateLabel ? ` (${d.dateLabel})` : ''} · ${d.format} · ${d.contentType}`);
    if (d.time) lines.push(`Time: ${d.time}`);
    if (d.title) lines.push(`Title: ${d.title}`);
    if (d.direction) lines.push(`Direction: ${d.direction}`);
    if (d.content?.onScreenText?.length) lines.push('', 'On-screen text:', ...d.content.onScreenText.map((t, i) => `  ${i + 1}. ${t}`));
    if (d.content?.caption) lines.push('', 'Caption:', d.content.caption);
    if (d.content?.cta) lines.push('', `CTA: ${d.content.cta}`);
    if (d.content?.hashtags?.length) lines.push('', `Hashtags: ${d.content.hashtags.map((h) => `#${h}`).join(' ')}`);
    if (d.content?.strategy) lines.push('', `Strategy: ${d.content.strategy}`);
    if (d.content?.prompts?.length) lines.push('', 'Prompts:', ...d.content.prompts.map((p) => `  - ${p}`));
    if (d.content?.plan) lines.push('', `Plan: ${d.content.plan}`);
    lines.push('', '---', '');
  });
  return lines.join('\n');
}

export default function ContentRoute() {
  const [searchParams] = useSearchParams();
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState(Number(searchParams.get('day')) || 0);
  const [tab, setTab] = useState('Caption');

  useEffect(() => {
    getCurrentRoute()
      .then(setRoute)
      .catch(() => setRoute(null))
      .finally(() => setLoading(false));
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    try { setRoute(await generateRoute()); } catch (err) { /* retry via button */ } finally { setGenerating(false); }
  }

  const days = route?.days || [];
  const day = days[selected] || days[0];

  async function togglePublished() {
    if (!route || !day) return;
    const updated = await markDayPublished(route._id, selected);
    setRoute(updated);
  }

  function handleExport() {
    if (!route) return;
    const blob = new Blob([buildMarkdown(route)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-route-${route.weekLabel.replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const focusPillar = route?.focus?.pillar;
  const c = PILLAR[day?.pillar] || PILLAR.trust;

  if (loading) {
    return <div style={{ ...LSC, padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 48px)' }}><p style={{ fontFamily: LS_FONT, color: LS_T2 }}>Loading your weekly route…</p></div>;
  }

  if (!route || days.length === 0) {
    return (
      <div style={{ ...LSC, padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 48px)', maxWidth: 760 }}>
        <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 30, color: LS_INK, margin: '0 0 8px' }}>Weekly route</h1>
        <div style={{ border: `1px dashed ${LS_BORDER}`, borderRadius: 16, padding: '48px 24px', textAlign: 'center', marginTop: 20 }}>
          <Glyph name="route" size={30} color={LS_MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 17, color: LS_INK, margin: '0 0 6px' }}>No plan for this week yet</p>
          <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, margin: '0 0 18px' }}>Generate a week of posts from your Instagram analysis.</p>
          <button onClick={handleGenerate} disabled={generating} style={{ height: 44, padding: '0 22px', borderRadius: 9, border: 'none', cursor: 'pointer', opacity: generating ? 0.6 : 1, fontFamily: LS_FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', background: LS_SIGNAL, color: '#fff' }}>
            {generating ? 'Planning…' : 'Generate this week’s plan'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...LSC, padding: 'clamp(20px, 5vw, 40px) clamp(16px, 5vw, 48px)', maxWidth: 1180 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 26, color: LS_INK, margin: 0 }}>{route.focus?.headline || 'Weekly route'}</h1>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: LS_FONT, fontSize: 12.5, color: LS_T2 }}>
            <Glyph name="calendar" size={14} color={LS_MUTED} />{route.weekLabel}
          </span>
          {focusPillar && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: LS_FONT, fontSize: 12.5, color: LS_T2 }}>
              <Glyph name="route" size={14} color={LS_MUTED} />Strengthening <strong style={{ color: PILLAR[focusPillar].ink }}>{PILLAR[focusPillar].label}</strong>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleExport} style={btnGhost}><Glyph name="download" size={15} color={LS_INK} />Export</button>
          <Link to="/dashboard" style={{ ...btnGhost, textDecoration: 'none' }}><Glyph name="refresh-cw" size={15} color={LS_INK} />Change this week’s focus</Link>
        </div>
      </div>

      {/* Day rail */}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6, marginBottom: 20 }}>
        {days.map((d, i) => {
          const active = i === selected;
          const pc = PILLAR[d.pillar] || PILLAR.trust;
          return (
            <button
              key={d.day}
              onClick={() => setSelected(i)}
              style={{
                flexShrink: 0, minWidth: 150, textAlign: 'left', cursor: 'pointer', borderRadius: 12,
                padding: '11px 14px', border: `1px solid ${active ? LS_SIGNAL : LS_BORDER}`,
                background: active ? LS_SIGNAL : LS_SURFACE, boxShadow: active ? `0 0 0 3px ${LS_SOFT}` : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 15, color: active ? '#fff' : LS_INK }}>{d.day}</span>
                <span style={{ fontFamily: LS_FONT, fontSize: 11, color: active ? 'rgba(255,255,255,0.85)' : LS_MUTED }}>{d.time}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '7px 0' }}>
                <Glyph name={FORMAT_ICON[d.format] || 'image'} size={13} color={active ? '#fff' : LS_T2} />
                <span style={{ fontFamily: LS_FONT, fontSize: 12, color: active ? '#fff' : LS_T2 }}>{d.format}</span>
                {d.published && <Glyph name="check-circle-2" size={13} color={active ? '#fff' : 'var(--trust-600)'} />}
              </div>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: LS_FONT, fontSize: 10.5, fontWeight: 700,
                color: active ? '#fff' : pc.ink, background: active ? 'rgba(255,255,255,0.18)' : pc.soft, borderRadius: 999, padding: '2px 8px',
              }}>
                {d.goalTag}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected day */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.9fr) 1.4fr', gap: 20, alignItems: 'start' }}>
        {/* Preview card */}
        <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${LS_BORDER}` }}>
            <span style={{ width: 30, height: 30, borderRadius: '50%', background: LS_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Glyph name="user" size={15} color={LS_SIGNAL} />
            </span>
            <span style={{ fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 600, color: LS_INK, flex: 1 }}>{route.instagramUsername ? `@${route.instagramUsername}` : 'Your account'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: LS_FONT, fontSize: 11.5, color: LS_T2 }}>
              <Glyph name={FORMAT_ICON[day.format] || 'image'} size={13} color={LS_T2} />{day.format}
            </span>
          </div>
          <div style={{ padding: '18px 16px', background: 'linear-gradient(180deg, var(--paper) 0%, #fff 100%)', minHeight: 220 }}>
            <span style={{ fontFamily: LS_FONT, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.ink }}>{day.contentType}</span>
            <h3 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 19, lineHeight: 1.25, color: LS_INK, margin: '8px 0 14px' }}>{day.title || day.direction}</h3>
            {day.content?.onScreenText?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {day.content.onScreenText.map((t, i) => (
                  <div key={i} style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, borderLeft: `2px solid ${LS_SOFT_BORDER}`, paddingLeft: 10 }}>
                    <span style={{ color: LS_MUTED, fontSize: 11 }}>Frame {i + 1}</span><br />{t}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ padding: '12px 14px', borderTop: `1px solid ${LS_BORDER}`, fontFamily: LS_FONT, fontSize: 12.5, color: LS_T2 }}>
            {(day.content?.caption || '').slice(0, 120)}{(day.content?.caption || '').length > 120 ? '…' : ''}
          </div>
        </div>

        {/* Detail: tabs */}
        <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, padding: 'clamp(16px, 3vw, 22px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Glyph name="user" size={17} color={LS_INK} />
              <span style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 16, color: LS_INK }}>{day.contentType}</span>
            </div>
            <button onClick={togglePublished} style={{ ...btnGhost, borderColor: day.published ? 'var(--trust-600)' : LS_BORDER, color: day.published ? 'var(--trust-600)' : LS_INK }}>
              <Glyph name={day.published ? 'check-circle-2' : 'check'} size={15} color={day.published ? 'var(--trust-600)' : LS_INK} />
              {day.published ? 'Published' : 'Mark as published'}
            </button>
          </div>
          <span style={{ fontFamily: LS_FONT, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.ink }}>{PILLAR[day.pillar]?.label} · {day.goalTag}</span>
          <h2 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 21, lineHeight: 1.25, color: LS_INK, margin: '6px 0 16px' }}>{day.title || day.direction}</h2>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${LS_BORDER}`, marginBottom: 18 }}>
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  border: 'none', background: 'none', cursor: 'pointer', padding: '0 0 10px', fontFamily: LS_FONT,
                  fontSize: 14, fontWeight: 600, color: tab === t ? LS_SIGNAL : LS_T2,
                  borderBottom: `2px solid ${tab === t ? LS_SIGNAL : 'transparent'}`, marginBottom: -1,
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'Caption' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {day.content?.onScreenText?.length > 0 && (
                <Field icon="type" label={`On-screen text · ${day.content.onScreenText.length} frame${day.content.onScreenText.length > 1 ? 's' : ''}`}>
                  {day.content.onScreenText.map((t, i) => <Para key={i}>{t}</Para>)}
                </Field>
              )}
              <Field icon="message-square" label="Caption"><Para>{day.content?.caption || '—'}</Para></Field>
              {day.content?.cta && <Field icon="arrow-up-right" label="Call to action"><Para>{day.content.cta}</Para></Field>}
              {day.content?.hashtags?.length > 0 && (
                <Field icon="hash" label="Suggested hashtags">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {day.content.hashtags.map((h) => (
                      <span key={h} style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_T2, background: LS_SOFT, border: `1px solid ${LS_SOFT_BORDER}`, borderRadius: 999, padding: '3px 10px' }}>#{h}</span>
                    ))}
                  </div>
                </Field>
              )}
            </div>
          )}

          {tab === 'Strategy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field icon="target" label="Why this post, this day"><Para>{day.content?.strategy || '—'}</Para></Field>
              <Field icon="route" label="Direction"><Para>{day.direction || '—'}</Para></Field>
            </div>
          )}

          {tab === 'Prompts' && (
            <Field icon="sparkles" label="Idea prompts">
              {day.content?.prompts?.length > 0
                ? day.content.prompts.map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <span style={{ color: LS_SIGNAL, fontFamily: LS_FONT, fontWeight: 700 }}>{i + 1}.</span>
                      <span style={{ fontFamily: LS_FONT, fontSize: 14.5, lineHeight: 1.55, color: LS_INK }}>{p}</span>
                    </div>
                  ))
                : <Para>—</Para>}
            </Field>
          )}

          {tab === 'Plan' && <Field icon="clipboard-list" label="Production plan"><Para>{day.content?.plan || '—'}</Para></Field>}
        </div>
      </div>
    </div>
  );
}
