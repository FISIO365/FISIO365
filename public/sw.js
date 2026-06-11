self.addEventListener('push', function(event) {
  let title = ' ';
  let body = '¡Recuerda hacer tus ejercicios de hoy! Tu recuperación depende de la constancia.';
  
  if (event.data) {
    try {
      const data = event.data.json();
      if (data.title) title = data.title;
      if (data.body) body = data.body;
    } catch(e) {
      body = event.data.text() || body;
    }
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: body,
        icon: '/icono.png',
        badge: '/icono.png',
        vibrate: [200, 100, 200],
        data: { url: '/' }
      }),
      // Badge en el icono de la app
      navigator.setAppBadge ? navigator.setAppBadge(1) : Promise.resolve()
    ])
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  // Quitar badge al abrir la app
  if (navigator.clearAppBadge) navigator.clearAppBadge();
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'));
});

// Quitar badge cuando el paciente abre la app
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'CLEAR_BADGE') {
    if (navigator.clearAppBadge) navigator.clearAppBadge();
  }
});
