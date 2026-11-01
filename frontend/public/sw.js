/*
 * Push service worker — shows "Your plan is ready" when a generation finishes
 * while the studio is away (tab hidden or closed). If a Bauhly window is
 * visible, the in-app toast already says it, so no banner is shown.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Bauhly', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const looking = windows.some((c) => c.visibilityState === 'visible' && c.focused);
    console.log('[sw] push received', data, looking ? '· a Bauhly tab is focused' : '');
    // `force` (the /api/push/test ping) always shows, so testing from the open tab works
    if (looking && !data.force) return;
    await self.registration.showNotification(data.title || 'Bauhly', {
      body: data.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: data.tag || 'bauhly',
      renotify: true,
      data: { url: data.url || '/dashboard' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      // let the SPA route there without a reload (see lib/pushNotifications)
      open.postMessage({ type: 'push-open', url: event.notification.data?.url || '/dashboard' });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
