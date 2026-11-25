/* =====================================================================
   SI-JADIN — Service Worker (frontend statis)
   - Cangkang aplikasi (HTML, CSS, JS, ikon) di-cache → aplikasi terbuka instan,
     bahkan saat sinyal lemah (data terakhir tampil dari cache perangkat).
   - Permintaan ke API Google Apps Script & CDN TIDAK PERNAH di-cache di sini.
   - Naikkan VERSI setiap kali berkas frontend diubah agar perangkat memperbarui.
   ===================================================================== */
const VERSI = 'sijadin-v3.1.0';
const CANGKANG = [
  './', './index.html', './offline.html', './js/config.js', './manifest.json',
  './css/style.css', './js/dokumen.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSI).then(c => c.addAll(CANGKANG)));
});
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', ev => { if (ev.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // API GAS, font, CDN: langsung ke jaringan

  // js/config.js selalu coba jaringan dulu (agar perubahan GAS_URL cepat berlaku)
  if (url.pathname.endsWith('/js/config.js')) {
    ev.respondWith(fetch(req).then(res => { const s = res.clone(); caches.open(VERSI).then(c => c.put(req, s)); return res; }).catch(() => caches.match(req)));
    return;
  }
  // Navigasi: cangkang dari cache (instan), perbarui di latar; cadangan offline.html
  if (req.mode === 'navigate') {
    ev.respondWith(
      caches.match('./index.html').then(c => {
        const jar = fetch(req).then(res => { if (res.ok && /\/(index\.html)?$/.test(url.pathname)) { const s = res.clone(); caches.open(VERSI).then(k => k.put('./index.html', s)); } return res; });
        return c || jar.catch(() => caches.match('./offline.html'));
      })
    );
    return;
  }
  // Berkas statis: cache dulu, perbarui di latar (stale-while-revalidate)
  ev.respondWith(caches.match(req).then(c => {
    const jar = fetch(req).then(res => { if (res && res.ok) { const s = res.clone(); caches.open(VERSI).then(k => k.put(req, s)); } return res; }).catch(() => c);
    return c || jar;
  }));
});
