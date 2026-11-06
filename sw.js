/* ===========================================================================
   로얄패밀리 골프동호회 · 서비스 워커 (sw.js)
   - 문서(index.html): 네트워크 우선 → 실패하면 캐시(완전 오프라인 실행)
   - 같은 오리진 정적 자산: 캐시 우선
   - 외부 CDN(폰트 등): 캐시 먼저 보여주고 뒤에서 갱신(stale-while-revalidate)
   - VERSION 을 바꾸면 이전 캐시는 자동 삭제됩니다. (배포 시 VERSION 갱신 권장)
   =========================================================================== */
const VERSION = 'royal-v9-2026-11-06';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(
      CORE.map((u) => cache.add(new Request(u, { cache: 'reload' })))
    );
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('royal-') && k !== VERSION).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* --- 1) 같은 오리진 --- */
  if (url.origin === location.origin) {
    const isDoc = req.mode === 'navigate' ||
      (req.headers.get('accept') || '').includes('text/html');

    if (isDoc) {
      event.respondWith((async () => {
        try {
          const net = await fetch(req, { cache: 'no-store' });
          const cache = await caches.open(VERSION);
          cache.put('./index.html', net.clone());
          return net;
        } catch (e) {
          const hit = (await caches.match('./index.html')) || (await caches.match('./'));
          return hit || new Response(
            '<!doctype html><meta charset="utf-8"><title>오프라인</title>' +
            '<p style="font:16px/1.6 sans-serif;padding:24px">오프라인 상태입니다. 한 번 이상 앱을 열어 두면 이 화면이 정상 동작합니다.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })());
      return;
    }

    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const net = await fetch(req);
        if (net && net.status === 200 && net.type === 'basic') {
          const cache = await caches.open(VERSION);
          cache.put(req, net.clone());
        }
        return net;
      } catch (e) {
        return hit || Response.error();
      }
    })());
    return;
  }

  /* --- 2) 외부 CDN --- */
  event.respondWith((async () => {
    const hit = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && (res.status === 200 || res.type === 'opaque')) {
        caches.open(VERSION).then((c) => c.put(req, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return hit || (await network) || Response.error();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
