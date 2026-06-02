/* ============================================================
   Service Worker — مكتبة المشكاة v4
   ✅ Offline support    ✅ Cache strategy    ✅ Push notifications
   ============================================================ */

const CACHE_NAME    = 'mishkat-v4-3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&family=Tajawal:wght@300;400;500;700;900&display=swap',
  'https://cdn.tailwindcss.com',
];

// ── Install: تخزين الأصول الثابتة ───────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

// ── Activate: حذف الكاش القديم ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: استراتيجية Cache-First للأصول الثابتة ────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // لا تعترض طلبات Supabase API (تحتاج شبكة دائماً)
  if (url.hostname.includes('supabase.co')) return;

  // استراتيجية Network-First لملفات HTML
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(res => { caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone())); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-First لكل شيء آخر (CSS، JS، خطوط)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        return res;
      });
    }).catch(() => new Response('Offline', { status: 503 }))
  );
});

// ── Push Notifications ───────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'مكتبة المشكاة', body: 'لديك إشعار جديد 🔔', url: '/' };
  try { data = { ...data, ...event.data.json() }; } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    './icons/icon-192.png',
      badge:   './icons/icon-192.png',
      dir:     'rtl',
      lang:    'ar',
      tag:     'mishkat-notification',
      data:    { url: data.url },
      actions: [
        { action: 'open',    title: '🔍 عرض الطلب' },
        { action: 'dismiss', title: '✕ إغلاق'       },
      ],
    })
  );
});

// ── Notification Click ───────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
