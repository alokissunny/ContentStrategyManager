import React, { useEffect, useState } from 'react';
import Glyph from '../components/Glyph';
import { getBrandDna, updateBrandDna } from '../api/brandDna';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_FONT, LS_DISPLAY, LSC } from '../theme';

function InferredBadge() {
  return (
    <span style={{
      fontFamily: LS_FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: LS_MUTED, background: '#EFEFF2', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
    }}>
      Inferred from your page
    </span>
  );
}

function BrandDnaField({ label, description, inferred, value, onChange }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 14, padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: LS_FONT, fontSize: 16, fontWeight: 700, color: LS_INK }}>{label}</span>
          {inferred && <InferredBadge />}
        </span>
        <span style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_MUTED, textAlign: 'right' }}>{description}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <textarea
          value={value}
          rows={2}
          placeholder="Not set yet — add a sentence or two."
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%', resize: 'vertical', fontFamily: LS_FONT, fontSize: 16, lineHeight: 1.55, color: LS_INK,
            background: focused ? LS_SURFACE : 'transparent', border: `1px solid ${focused ? LS_SIGNAL : 'transparent'}`,
            borderRadius: 9, padding: '7px 34px 7px 9px', margin: '0 -9px', outline: 'none',
            boxShadow: focused ? `0 0 0 3px ${LS_SOFT}` : 'none',
          }}
        />
        {!focused && <Glyph name="pencil" size={14} color={LS_MUTED} style={{ position: 'absolute', right: 2, top: 10, pointerEvents: 'none' }} />}
      </div>
    </div>
  );
}

export default function BrandDna() {
  const [reportId, setReportId] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getBrandDna()
      .then((data) => {
        setReportId(data.reportId);
        setSections(data.sections);
      })
      .catch((err) => {
        if (err.response?.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const setValue = (key, value) => {
    setSaved(false);
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
  };

  async function handleSave() {
    setSaving(true);
    try {
      const sectionsMap = Object.fromEntries(sections.map((s) => [s.key, s.value]));
      const data = await updateBrandDna(reportId, sectionsMap);
      setSections(data.sections);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const completedCount = sections.filter((s) => s.value.trim().length > 0).length;

  return (
    <div style={{ ...LSC, padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 48px)', maxWidth: 760 }}>
        <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 30, color: LS_INK, margin: '0 0 8px' }}>Brand profile</h1>
        <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: '0 0 8px' }}>
          What Bauhly inferred about your business from your Instagram. Edit anything that’s off — the sharper this is, the better your weekly route.
        </p>

        {loading ? (
          <p style={{ fontFamily: LS_FONT, color: LS_T2, marginTop: 24 }}>Loading your brand profile…</p>
        ) : notFound ? (
          <div style={{ border: `1px dashed ${LS_BORDER}`, borderRadius: 12, padding: '40px 24px', textAlign: 'center', marginTop: 24 }}>
            <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: 0 }}>
              No brand profile yet. Connect your Instagram from onboarding to generate one from your page.
            </p>
          </div>
        ) : (
          <>
            <p style={{ fontFamily: LS_FONT, fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em', color: LS_SIGNAL, margin: '0 0 24px' }}>
              {completedCount} of {sections.length} fields filled
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {sections.map((s) => (
                <BrandDnaField
                  key={s.key}
                  label={s.label}
                  description={s.description}
                  inferred={s.inferred}
                  value={s.value}
                  onChange={(v) => setValue(s.key, v)}
                />
              ))}
            </div>
            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  height: 44, padding: '0 24px', borderRadius: 9, border: 'none', cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.6 : 1, fontFamily: LS_FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em',
                  textTransform: 'uppercase', background: LS_SIGNAL, color: '#fff',
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && !saving && (
                <span style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_T2 }}>Saved to your brand profile.</span>
              )}
            </div>
          </>
        )}
      </div>
  );
}
