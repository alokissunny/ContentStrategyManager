/*
 * Bauhly icon set — hand-drawn 24px line icons, 1.6px stroke.
 * Deliberately small: only icons the product actually uses.
 * Pillar icons (discovery/credibility/trust) share the beacon-arc language.
 * Weight + line personality match the landing's glyph set (src/pages/
 * marketing/bauhly/svg/glyphs.jsx) so app and marketing read as one system;
 * the crafted "editorial" glyphs (plan/brief/swatch/site) are ported from
 * there and redrawn to this 24px viewBox.
 */

const PATHS = {
  /* navigation & actions */
  'arrow-right': <path d="M5 12h14m-6-6 6 6-6 6" />,
  'arrow-left': <path d="M19 12H5m6-6-6 6 6 6" />,
  'arrow-up-right': <path d="M7 17 17 7M9 7h8v8" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </>
  ),
  /* app nav */
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="10" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="6" rx="2" />
      <rect x="13.5" y="12.5" width="7" height="8" rx="2" />
      <rect x="3.5" y="16.5" width="7" height="4" rx="2" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 2.75v3M12 18.25v3M2.75 12h3M18.25 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
    </>
  ),
  /* pillars — shared beacon language */
  discovery: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
      <circle cx="11" cy="11" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  credibility: (
    <>
      <circle cx="12" cy="9" r="5.5" />
      <path d="m8.8 13.5-1.3 7 4.5-2.6 4.5 2.6-1.3-7" />
    </>
  ),
  trust: (
    <>
      <path d="M12 3.5 19.5 6.5v5c0 4.5-3 8-7.5 9.5C7.5 19.5 4.5 16 4.5 11.5v-5Z" />
      <path d="m8.8 11.6 2.3 2.3 4.3-4.3" />
    </>
  ),
  /* signals & evidence */
  signal: (
    <>
      <circle cx="6" cy="18" r="2" fill="currentColor" stroke="none" />
      <path d="M6 12a6 6 0 0 1 6 6M6 6a12 12 0 0 1 12 12" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-7 5 14 2.5-7h4" />,
  evidence: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-8M21 20H3.5" />
      <circle cx="10" cy="4" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.4 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 2.75V6.5M16 2.75V6.5" />
    </>
  ),
  sparkle: (
    <path d="M12 3.5c.7 4.4 2.6 6.4 7 7-4.4.7-6.3 2.7-7 7-.7-4.3-2.6-6.3-7-7 4.4-.6 6.3-2.6 7-7Z" />
  ),
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="3.75" />
      <circle cx="17" cy="7" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14.5" rx="2.5" />
      <path d="m4 7 8 6.5L20 7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  bookmark: <path d="M6.5 3.5h11V21L12 17l-5.5 4V3.5Z" />,
  share: (
    <>
      <path d="m12 14.5 8.5-8.5M20.5 10V6h-4" />
      <path d="M19 13.5v5A2.5 2.5 0 0 1 16.5 21h-10A2.5 2.5 0 0 1 4 18.5v-10A2.5 2.5 0 0 1 6.5 6h5" />
    </>
  ),
  heart: (
    <path d="M12 20.2C7.2 16.4 3.7 13.2 3.7 9.6c0-2.7 2.1-4.8 4.7-4.8 1.4 0 2.7.6 3.6 1.7a4.75 4.75 0 0 1 3.6-1.7c2.6 0 4.7 2.1 4.7 4.8 0 3.6-3.5 6.8-8.3 10.6Z" />
  ),
  comment: (
    <path d="M21 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.1-5.3A8.5 8.5 0 1 1 21 11.5Z" />
  ),
  play: <path d="M8 5.5v13l11-6.5L8 5.5Z" />,
  trendUp: <path d="M3 17.5 9.5 11l4 4L21 6.5M21 12V6.5h-5.5" />,
  trendDown: <path d="M3 6.5 9.5 13l4-4L21 17.5M21 12v5.5h-5.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 3.5V8h-4.5" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
      <path d="m17 8 4 4-4 4M21 12H10" />
    </>
  ),
  edit: (
    <path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20ZM14.5 7 17 9.5" />
  ),
  attach: (
    <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 5 4.7l-8 8a1.8 1.8 0 0 1-2.6-2.5l7.3-7.3" />
  ),
  /* crafted glyphs ported from the landing (glyphs.jsx) — editorial line
   * language for the product's core concepts, redrawn to the 24px grid */
  plan: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 13h7.5M11 13V3.5M11 9h9.5M15 13v7.5" />
      <circle cx="7" cy="16.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  brief: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  swatch: (
    <>
      <rect x="3.5" y="5.5" width="10" height="10" rx="1.6" />
      <rect x="8.5" y="10.5" width="10" height="10" rx="1.6" />
      <path d="M13.5 5.5 20.5 12.5" />
    </>
  ),
  site: (
    <>
      <path d="M3.5 20.5h17M6 20.5V10l6-4.5 6 4.5v10.5" />
      <path d="M9.5 20.5v-5h5v5" />
    </>
  ),
};

export default function Icon({ name, size = 20, strokeWidth = 1.6, style, className }) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}
