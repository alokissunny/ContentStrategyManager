// Capacitor app shell — loaded only in the mobile build (VITE_NATIVE=1), before
// the first render.
import { createIcons, icons } from 'lucide';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

export const isNativeApp = Capacitor.isNativePlatform();

// The web build gets window.lucide from the unpkg UMD script; the app bundles
// the same icons so Glyph works offline and never pulls `lucide@latest`.
window.lucide = {
  icons,
  createIcons: (options = {}) => createIcons({ icons, ...options }),
};

document.documentElement.classList.add('is-native', `is-${Capacitor.getPlatform()}`);

export function startNativeShell() {
  if (!isNativeApp) return;
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  // Hide the launch screen once React has painted the first frame.
  requestAnimationFrame(() => SplashScreen.hide().catch(() => {}));
}
