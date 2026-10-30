// FISIO365 · avisos (app del paciente y panel del fisio)
self.addEventListener('push', function (event) {
  let d = {};
  if (event.data) { try { d = event.data.json(); } catch (e) { d = { body: event.data.text() }; } }
  const title = d.title || 'FISIO365';
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: d.body || '',
      icon: '/icono.png',
      badge: '/icono.png',
      vibrate: [200, 100, 200],
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: d.url || '/' }
    }),
    // El puntito rojo del icono solo para mensajes del chat (lo que hay que contestar); el resto son avisos informativos
    (navigator.setAppBadge && /[?&]s=(msg|mensajes)\b/.test(d.url || '')) ? navigator.setAppBadge(1).catch(() => {}) : Promise.resolve()
  ]));
});

// Al tocar el aviso: abrir la app justo en lo que toca (chat, citas, ejercicios…)
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  const destino = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  const esPanel = destino.includes('/fisio');
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    for (const c of lista) {
      const enPanel = new URL(c.url).pathname.startsWith('/fisio');
      if (enPanel === esPanel && 'focus' in c) {
        c.postMessage({ type: 'ABRIR', url: destino });
        return c.focus();
      }
    }
    return clients.openWindow(destino);
  }));
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'CLEAR_BADGE' && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
});
