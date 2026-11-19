// The board's service worker. It exists so that a phone can receive Web Push; it caches nothing
// and never answers a fetch, so the board always loads from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A push carries JSON: { title, body, url, tag }. Anything else is shown as plain text.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Agent Board';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/logo.png',
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  };
  if (typeof data.tag === 'string' && data.tag) options.tag = data.tag;
  event.waitUntil(self.registration.showNotification(title, options));
});

// Open the board at the notification's address, or bring a window that is already open to it.
// An address on another origin is ignored.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target = new URL('/', self.location.origin);
  try {
    const url = new URL(event.notification.data?.url ?? '/', self.location.origin);
    if (url.origin === self.location.origin) target = url;
  } catch {
    // Keep the board's front page.
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        return open.navigate(target.href).then((w) => (w ?? open).focus());
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
