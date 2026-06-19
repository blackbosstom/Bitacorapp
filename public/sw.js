/* ══════════════════════════════════════════════════════════════════
   SGCE — Service Worker v4
   - Red-primero para HTML (siempre intenta actualizar)
   - Caché-primero para assets estáticos
   - Caché-primero para los endpoints PWA (/pwa-manifest, /pwa-icon)
   - No intercepta Firebase / APIs externas
   ══════════════════════════════════════════════════════════════════ */

/* BUILD_ID lo reemplaza inject-env.js en cada despliegue (timestamp único),
   forzando un service worker nuevo → el navegador detecta la actualización.
   En local queda 'dev'. */
const BUILD_ID       = 'dev';
const CACHE_NAME     = 'sgce-shell-' + BUILD_ID;
const PWA_CACHE_NAME = 'sgce-pwa-'   + BUILD_ID;   /* caché separado para manifest e iconos */

const SHELL_URLS = ['/', '/index.html', '/login.html', '/icons/icon.svg'];

/* ── INSTALL: precachear app shell ─────────────────────────────── */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_URLS).catch(function (err) {
        console.warn('[SW] Pre-cache parcial:', err);
      });
    })
  );
  self.skipWaiting();
});

/* ── ACTIVATE: limpiar cachés anteriores ────────────────────────── */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE_NAME && k !== PWA_CACHE_NAME; })
          .map(function (k) {
            console.log('[SW] Eliminando caché antigua:', k);
            return caches.delete(k);
          })
      );
    })
  );
  self.clients.claim();
});

/* ── FETCH ──────────────────────────────────────────────────────── */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = req.url;

  /* Saltar todo lo externo o que no debe cachearse */
  var skipPatterns = [
    'firestore.googleapis.com',
    'firebase',
    'googleapis.com',
    'gstatic.com',
    'cloudflare.com',
    'formspree.io',
    'api.groq.com',
    'firebasestorage.googleapis.com',
    'chrome-extension://',
    '/.netlify/functions/groq',
    '/api/groq'
  ];
  if (skipPatterns.some(function (s) { return url.indexOf(s) !== -1; })) return;
  if (url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return;

  /* ── Manifest e iconos PWA: Caché-primero, red de fondo (stale-while-revalidate) ── */
  var isPwaAsset = url.indexOf('/pwa-manifest') !== -1 || url.indexOf('/pwa-icon') !== -1;
  if (isPwaAsset) {
    e.respondWith(
      caches.open(PWA_CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (cached) {
          /* Revalidar en segundo plano */
          var networkFetch = fetch(req).then(function (resp) {
            if (resp && resp.status === 200) cache.put(req, resp.clone());
            return resp;
          }).catch(function () { return null; });

          /* Devolver caché inmediatamente si existe, sino esperar red */
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  /* ── Documentos HTML: Red-primero con caché de respaldo ── */
  var acceptHeader = req.headers.get('accept') || '';
  if (acceptHeader.indexOf('text/html') !== -1) {
    e.respondWith(
      fetch(req)
        .then(function (resp) {
          if (resp && resp.status === 200) {
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function (c) { c.put(req, clone); });
          }
          return resp;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            return cached || caches.match('/');
          });
        })
    );
    return;
  }

  /* ── Assets estáticos: Caché-primero, red de respaldo ── */
  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, clone); });
        }
        return resp;
      }).catch(function () {
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

/* ── MENSAJES ───────────────────────────────────────────────────── */
self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
