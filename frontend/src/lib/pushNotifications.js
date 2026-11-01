/*
 * "Notify me when it's ready" — push notifications for finished plans, so the
 * studio can leave the loading screen (like ChatGPT). The backend sends the
 * push (services/pushNotify); this file only gets permission and registers the
 * device: a Web Push subscription in browsers (public/sw.js shows it), an APNs
 * token in the iOS app (native/push.js).
 *
 * status: 'checking' | 'unsupported' (no push here, or server not set up)
 *       | 'default' (not asked yet) | 'denied' | 'on' | 'working'
 */

import { useSyncExternalStore } from 'react';
import { getPushConfig, subscribePush } from '../api/push';
import { IS_NATIVE } from '../native/platform';

const listeners = new Set();
let status = 'checking';
let configPromise = null;

function set(next) {
  if (status === next) return;
  status = next;
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePushStatus() {
  return useSyncExternalStore(subscribe, () => status, () => status);
}

function config() {
  if (!configPromise) configPromise = getPushConfig().catch(() => ({}));
  return configPromise;
}

function webSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Route inside the SPA (react-router listens to popstate) — used when a
// notification is tapped while the app is already open.
export function openFromNotification(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/')) return;
  if (window.location.pathname + window.location.search === url) return;
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function webSubscription(vapidPublicKey) {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

/**
 * Called once the studio is signed in: works out the current status and, if
 * permission was already granted, re-registers this device quietly (tokens and
 * subscriptions can rotate). Never prompts.
 */
export async function initPushNotifications() {
  try {
    const cfg = await config();
    if (IS_NATIVE) {
      if (!cfg.apns) { set('unsupported'); return status; }
      const native = await import('../native/push.js');
      native.listenForTaps(openFromNotification);
      const perm = await native.permission();
      if (perm === 'granted') {
        set('on');
        native.register((token) => subscribePush({ kind: 'apns', token }).catch(() => {}));
      } else set(perm === 'denied' ? 'denied' : 'default');
      return status;
    }
    if (!webSupported() || !cfg.vapidPublicKey) { set('unsupported'); return status; }
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'push-open') openFromNotification(e.data.url);
    });
    const perm = Notification.permission;
    if (perm === 'granted') {
      const sub = await webSubscription(cfg.vapidPublicKey);
      await subscribePush({ kind: 'web', subscription: sub.toJSON() });
      set('on');
    } else set(perm === 'denied' ? 'denied' : 'default');
  } catch (err) {
    console.warn('[push] init failed:', err?.message || err);
    if (status === 'checking') set('unsupported');
  }
  return status;
}

/**
 * Ask for permission and register — call from a click (browsers only show
 * the permission prompt in response to one). Resolves with the new status.
 */
export async function enablePushNotifications() {
  const before = status;
  set('working');
  try {
    const cfg = await config();
    if (IS_NATIVE) {
      const native = await import('../native/push.js');
      const perm = await native.requestPermission();
      if (perm !== 'granted') {
        set(perm === 'denied' ? 'denied' : 'default');
        return status;
      }
      await new Promise((resolve) => {
        native.register((token) => subscribePush({ kind: 'apns', token }).catch(() => {}).finally(resolve));
        setTimeout(resolve, 8000);
      });
      set('on');
      return status;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      set(perm === 'denied' ? 'denied' : 'default');
      return status;
    }
    const sub = await webSubscription(cfg.vapidPublicKey);
    await subscribePush({ kind: 'web', subscription: sub.toJSON() });
    set('on');
  } catch (err) {
    console.warn('[push] enable failed:', err?.message || err);
    set(before === 'working' ? 'default' : before);
  }
  return status;
}
