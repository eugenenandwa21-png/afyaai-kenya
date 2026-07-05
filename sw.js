/* ============================================================
   AFYAAI KENYA — SERVICE WORKER
   Strategy: Cache-first for app shell, network-first for API.
   Version bump CACHE_VERSION to force cache refresh on deploy.
   ============================================================ */

const CACHE_VERSION = 'afyaai-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE   = `${CACHE_VERSION}-runtime`;

/* Files that make up the app shell — cached on install */
const APP_SHELL = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif&display=swap',
  'https://fonts.gstatic.com/s/instrumentsans/v1/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH.woff2',
];

/* Firebase SDK — cache these too so app loads offline */
const FIREBASE_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
];

/* Never cache these — always go to network */
const NEVER_CACHE = [
  'https://api.anthropic.com',
  'https://firestore.googleapis.com',
  'https://firebase.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
];

/* ── INSTALL ─────────────────────────────────────────────── */
self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => {
        /* Cache app shell — ignore failures for individual items */
        const shellPromises = APP_SHELL.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Shell cache miss:', url, err))
        );
        const firebasePromises = FIREBASE_URLS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Firebase cache miss:', url, err))
        );
        return Promise.all([...shellPromises, ...firebasePromises]);
      })
      .then(() => {
        console.log('[SW] App shell cached');
        /* Take control immediately — don't wait for page reload */
        return self.skipWaiting();
      })
  );
});

/* ── ACTIVATE ────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== APP_SHELL_CACHE && k !== RUNTIME_CACHE)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── FETCH ───────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Skip non-GET requests */
  if(request.method !== 'GET') return;

  /* Never cache — always network (APIs, Firebase) */
  if(NEVER_CACHE.some(u => request.url.startsWith(u))){
    event.respondWith(fetch(request));
    return;
  }

  /* App shell — cache first, fallback to network */
  if(url.origin === self.location.origin || request.url.includes('fonts')){
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Firebase SDKs — cache first */
  if(request.url.includes('gstatic.com/firebasejs')){
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Everything else — network first, fallback to cache */
  event.respondWith(networkFirst(request));
});

/* ── STRATEGIES ──────────────────────────────────────────── */

/* Cache-first: try cache, then network, cache the result */
async function cacheFirst(request){
  const cached = await caches.match(request);
  if(cached) return cached;
  try {
    const response = await fetch(request);
    if(response.ok){
      const cache = await caches.open(APP_SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch(err) {
    console.warn('[SW] Cache-first network fail:', request.url);
    return offlineFallback(request);
  }
}

/* Network-first: try network, fallback to cache */
async function networkFirst(request){
  try {
    const response = await fetch(request);
    if(response.ok){
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch(err) {
    const cached = await caches.match(request);
    if(cached) return cached;
    return offlineFallback(request);
  }
}

/* Offline fallback — serve the app shell for navigation requests */
async function offlineFallback(request){
  if(request.mode === 'navigate'){
    const cached = await caches.match('./index.html');
    if(cached) return cached;
  }
  return new Response('Offline — AfyaAI Kenya is not available right now.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}

/* ── BACKGROUND SYNC (future: queue Firestore writes offline) ── */
self.addEventListener('sync', event => {
  if(event.tag === 'sync-encounters'){
    console.log('[SW] Background sync: encounters');
    /* TODO: replay queued Firestore writes from IndexedDB */
  }
});

/* ── PUSH NOTIFICATIONS (future: medication reminders, alerts) ── */
self.addEventListener('push', event => {
  if(!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'AfyaAI Kenya', {
      body:  data.body  || '',
      icon:  data.icon  || './icon-192.png',
      badge: data.badge || './icon-72.png',
      tag:   data.tag   || 'afyaai',
      data:  data.url   || '/',
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || '/')
  );
});
