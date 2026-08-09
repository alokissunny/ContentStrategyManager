/* App palette — retargeted to the Bauhly design system (Interior Designers
   edition). These constants feed the inline-styled app pages/components;
   changing them here reskins the whole authenticated app at once. The
   marketing landing keeps its own scoped tokens under `.bauhly-landing`. */
export const LS_BG = '#FFFFFF';       // white — the app canvas (warm paper stays on marketing)
export const LS_SURFACE = '#FFFFFF';  // clean surface
export const LS_BORDER = '#E9E9EE';
export const LS_INK = '#16161A';      // charcoal spine
export const LS_T2 = '#585864';       // ink-600
export const LS_MUTED = '#9B9BA6';    // ink-400
export const LS_SIGNAL = '#FF5227';   // Brute Orange — the Bauhly signal (signal-500)
export const LS_SIGNAL_TEXT = '#A8330F'; // signal-800 — AA-safe accent-as-text on a tint (selected nav)
export const LS_SOFT = '#FFF1EC';     // signal-50
export const LS_SOFT_BORDER = '#FFDDD2'; // signal-100
// Acid lime — the selected-nav ground (matches bauhly-v3 `.sb__link.is-active`:
// --experiment-500 fill, --experiment-ink as the word/icon). Contrast comes
// from the dark ink on it, never white.
export const LS_NAV_ACTIVE = '#D2E823';      // experiment-500
export const LS_NAV_ACTIVE_TEXT = '#3A4204'; // experiment-ink
export const LS_INK_MENU = '#26262C'; // ink-800 — resting nav label
export const LS_HOVER = '#EFEFF2';     // ink-100 — nav hover ground
export const LS_FONT = "'Inter', system-ui, -apple-system, sans-serif";
export const LS_DISPLAY = "'Cabinet Grotesk', 'Bricolage Grotesque', 'Inter', ui-sans-serif, system-ui, sans-serif";

export const LSC = { maxWidth: 1200, margin: '0 auto', padding: '0 48px' };
