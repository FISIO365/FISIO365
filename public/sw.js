self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'FISIO365';
  const options = {
    body: data.body || '¡Recuerda hacer tus ejercicios de hoy! 💪',
    icon: '/icono.png',
    badge: '/icono.png',
    vibrate: [200, 100, 200],
    data: { url: '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'));
});
