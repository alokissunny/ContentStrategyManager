import React, { useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { LS_BG, LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_SIGNAL, LS_MUTED, LS_FONT, LS_DISPLAY, LSC } from '../theme';

const CATEGORY_LABEL = { audience: 'Audience signal', market: 'Market signal', opportunity: 'Opportunity signal' };

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [signals, setSignals] = useState([]);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([client.get('/signals'), client.get('/routes/current')])
      .then(([signalsRes, routeRes]) => {
        setSignals(signalsRes.data.signals);
        setRoute(routeRes.data.route);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ background: LS_BG, minHeight: '100vh' }}>
      <div style={{ ...LSC, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 48px', borderBottom: `1px solid ${LS_BORDER}` }}>
        <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 20, letterSpacing: '-0.03em' }}>
          <span style={{ color: LS_INK }}>wide</span><span style={{ color: LS_SIGNAL }}>signals</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_T2 }}>{user?.name}</span>
          <button
            onClick={logout}
            style={{ border: `1px solid ${LS_BORDER}`, background: 'none', borderRadius: 7, height: 36, padding: '0 14px', cursor: 'pointer', fontFamily: LS_FONT, fontSize: 12, fontWeight: 600, color: LS_INK }}
          >
            Log out
          </button>
        </div>
      </div>

      <div style={{ ...LSC, padding: '48px 48px' }}>
        <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 30, color: LS_INK, margin: '0 0 8px' }}>Your weekly route</h1>
        <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: '0 0 36px' }}>
          {route ? `Week of ${new Date(route.weekOf).toLocaleDateString()}` : 'No route generated yet for this week.'}
        </p>

        {loading ? (
          <p style={{ fontFamily: LS_FONT, color: LS_T2 }}>Loading signals…</p>
        ) : signals.length === 0 ? (
          <div style={{ border: `1px dashed ${LS_BORDER}`, borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: 0 }}>
              No signals yet. Connect a data source or create one via the API to see it show up here.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {signals.map((s) => (
              <div key={s._id} style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 12, background: LS_SURFACE, padding: '18px 20px' }}>
                <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: LS_SIGNAL }}>
                  {CATEGORY_LABEL[s.category] || s.category}
                </span>
                <h3 style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 15, color: LS_INK, margin: '10px 0 6px' }}>{s.title}</h3>
                <p style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_T2, margin: 0 }}>{s.description}</p>
                <div style={{ marginTop: 14, fontFamily: LS_FONT, fontSize: 11, color: LS_MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.status}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
