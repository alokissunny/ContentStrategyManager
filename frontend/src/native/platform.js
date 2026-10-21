// True in the Capacitor app bundle (`vite build --mode mobile`). Build-time
// constant, so web builds drop native-only branches. No Capacitor import here —
// web pages can use it without pulling the native runtime.
export const IS_NATIVE = import.meta.env.VITE_NATIVE === '1';
