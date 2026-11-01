// iOS push (APNs) for the Capacitor app — loaded only from lib/pushNotifications
// in the mobile build. The backend sends straight to APNs with the device token.
import { PushNotifications } from '@capacitor/push-notifications';

let onToken = null;
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  PushNotifications.addListener('registration', (t) => onToken?.(t.value));
  PushNotifications.addListener('registrationError', (e) => console.warn('[push] APNs registration failed:', e?.error));
}

function mapPermission(p) {
  if (p?.receive === 'granted') return 'granted';
  if (p?.receive === 'denied') return 'denied';
  return 'default';
}

export async function permission() {
  return mapPermission(await PushNotifications.checkPermissions());
}

export async function requestPermission() {
  return mapPermission(await PushNotifications.requestPermissions());
}

export function register(handleToken) {
  onToken = handleToken;
  listen();
  PushNotifications.register().catch((e) => console.warn('[push] register failed:', e?.message || e));
}

let tapsBound = false;
export function listenForTaps(open) {
  if (tapsBound) return;
  tapsBound = true;
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    open(action?.notification?.data?.url || '/dashboard');
  });
}
