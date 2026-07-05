import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { getBrandDna } from '../api/brandDna';
import DashboardLayout from '../components/DashboardLayout';
import Glyph from '../components/Glyph';
import StageFunnel from '../components/StageFunnel';
import WeeklyRoutePanel from '../components/WeeklyRoutePanel';
import FocusPanel from '../components/FocusPanel';
import { useIsMobile } from '../hooks/useMediaQuery';
import { LS_BORDER, LS_SURFACE, LS_INK, LS_T2, LS_MUTED, LS_FONT, LS_DISPLAY, LSC } from '../theme';

const RANGE_OPTIONS = ['Last 7 days', 'Last 14 days', 'Last 30 days'];

const STAGES = [
  {
    key: 'discovery',
    label: 'Discovery',
    icon: 'search',
    status: 'improving',
    detail: 'Your reach is climbing — new accounts are finding your content faster than last period.',
  },
  {
    key: 'credibility',
    label: 'Credibility',
    icon: 'shield-check',
    status: 'stable',
    detail: 'Your expertise signals are holding steady. Consistent post quality is doing its job.',
  },
  {
    key: 'trust',
    label: 'Trust',
    icon: 'handshake',
    status: 'attention',
    detail: 'Your audience engages with your content but sees little proof it works. Add outcomes and results this week.',
  },
];

const FOCUS_STAGE = STAGES.find((s) => s.status === 'attention') || STAGES[STAGES.length - 1];

const WEEK_PLAN = [
  {
    day: 'Monday',
    category: 'Educational Tips',
    action: 'Walk through one real result, start to finish.',
    why: 'Closes your Trust gap with proof.',
    tag: 'Build confidence',
  },
  {
    day: 'Tuesday',
    category: 'Educational Tips',
    action: 'Call out the one mistake your audience keeps making.',
    why: 'Tips travel; shares bring new reach.',
    tag: 'Get noticed',
  },
  {
    day: 'Wednesday',
    category: 'Personal Journey',
    action: 'Lay out your method as a simple framework.',
    why: 'Frameworks build credibility.',
    tag: 'Show expertise',
  },
  {
    day: 'Thursday',
    category: 'Educational Tips',
    action: 'Show what "good" looks like — not just the highlight reel.',
    why: "Early read — worth testing before the week wraps.",
    tag: 'Get noticed',
  },
  {
    day: 'Friday',
    category: 'Personal Journey',
    action: 'Share a behind-the-scenes look at how a result actually happened.',
    why: 'Process content builds trust faster than polish.',
    tag: 'Build confidence',
  },
  {
    day: 'Saturday',
    category: 'Community',
    action: 'Answer the question you get asked most in DMs.',
    why: 'Turns private doubt into public proof.',
    tag: 'Build confidence',
  },
  {
    day: 'Sunday',
    category: 'Educational Tips',
    action: "Recap the week's biggest lesson in one carousel.",
    why: 'Recaps are highly saved and shared.',
    tag: 'Get noticed',
  },
];

const REALITY_ITEMS = [
  { dot: '#FF5A36', title: 'WideSignals recommended', text: 'A focus on proof and clarity for your audience.' },
  { dot: '#2E7D32', title: 'What you posted', text: 'WideSignals is reading your recent posts to compare planned vs actual.' },
  { dot: '#111827', title: 'What happened', text: 'Based on the posts available, WideSignals will report which formats earned the most saves and comments.' },
  { dot: '#FF5A36', title: 'WideSignals learned', text: 'A learning loop starts as soon as you publish against this plan.' },
  { dot: '#9CA3AF', title: 'Next adjustment', text: 'WideSignals adjusts the plan as real numbers come in — never overreacting to one post.' },
];

function getWeekLabel(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [route, setRoute] = useState(null);
  const [brandDna, setBrandDna] = useState({ complete: 0, total: 9 });
  const [rangeIdx, setRangeIdx] = useState(1);
  const [rangeOpen, setRangeOpen] = useState(false);

  const weekLabel = useMemo(() => getWeekLabel(new Date()), []);

  useEffect(() => {
    client.get('/routes/current').then((res) => setRoute(res.data.route)).catch(() => setRoute(null));
    getBrandDna()
      .then((data) => {
        const total = data.sections.length;
        const complete = data.sections.filter((s) => s.value.trim().length > 0).length;
        setBrandDna({ complete, total });
      })
      .catch(() => {});
  }, []);

  return (
    <DashboardLayout>
      <div style={{ ...LSC, maxWidth: 1320, padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 48px) 64px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 32 }}>
          <div>
            <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 'clamp(24px, 5vw, 30px)', color: LS_INK, margin: '0 0 6px' }}>Dashboard</h1>
            <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: 0 }}>Here's your strategy for this week.</p>
          </div>

          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setRangeOpen((o) => !o)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 9, height: 40, padding: '0 16px', borderRadius: 10,
                border: `1px solid ${LS_BORDER}`, background: LS_SURFACE, cursor: 'pointer', fontFamily: LS_FONT,
                fontSize: 13.5, fontWeight: 600, color: LS_INK,
              }}
            >
              <Glyph name="calendar" size={15} color={LS_T2} />
              {RANGE_OPTIONS[rangeIdx]}
              <Glyph name="chevron-down" size={15} color={LS_T2} style={{ transform: rangeOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }} />
            </button>
            {rangeOpen && (
              <div
                style={{
                  position: 'absolute', top: 46, right: 0, background: LS_SURFACE, border: `1px solid ${LS_BORDER}`,
                  borderRadius: 10, boxShadow: '0 8px 24px rgba(17,24,39,0.1)', overflow: 'hidden', zIndex: 10, minWidth: 160,
                }}
              >
                {RANGE_OPTIONS.map((opt, i) => (
                  <button
                    key={opt}
                    onClick={() => { setRangeIdx(i); setRangeOpen(false); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none',
                      background: i === rangeIdx ? '#F3F4F6' : 'transparent', cursor: 'pointer', fontFamily: LS_FONT,
                      fontSize: 13.5, color: LS_INK,
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 340px', gap: 24, alignItems: 'flex-start' }}>
          <div>
            <StageFunnel stages={STAGES} focusKey={FOCUS_STAGE.key} />
            <WeeklyRoutePanel
              weekLabel={weekLabel}
              routeExists={!!route}
              days={WEEK_PLAN}
              onCreateRoute={() => navigate('/dashboard/content-route')}
            />
          </div>

          <FocusPanel
            focusLabel={FOCUS_STAGE.label}
            focusIcon={FOCUS_STAGE.icon}
            tagline="Make your proof impossible to miss"
            whyText="Based on the posts available, your audience engages with your content but sees little proof it works."
            realityItems={REALITY_ITEMS}
            brandDnaComplete={brandDna.complete}
            brandDnaTotal={brandDna.total}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
