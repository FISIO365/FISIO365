// Plan de batalla: sin caché propia, siempre lo último (sirve para poder instalarla en el móvil)
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
