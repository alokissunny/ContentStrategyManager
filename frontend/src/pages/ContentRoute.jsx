import React from 'react';
import { LS_INK, LS_T2, LS_BORDER, LS_FONT, LS_DISPLAY, LSC } from '../theme';

export default function ContentRoute() {
  return (
    <div style={{ ...LSC, padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 48px)' }}>
      <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 30, color: LS_INK, margin: '0 0 8px' }}>Content Route</h1>
      <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: '0 0 36px' }}>Your day-by-day content plan will live here.</p>
      <div style={{ border: `1px dashed ${LS_BORDER}`, borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
        <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: 0 }}>Coming soon.</p>
      </div>
    </div>
  );
}
