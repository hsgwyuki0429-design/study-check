// オフラインでも起動できるよう、アプリシェルをキャッシュする。
// 学習データは IndexedDB にあるため、Service Worker はデータを扱わない。
const CACHE = 'study-check-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/api.js',
  './src/app.js',
  './src/auto-plan-runner.js',
  './src/auto-plan.js',
  './src/availability.js',
  './src/datetime.js',
  './src/day-detail.js',
  './src/day-model.js',
  './src/estimates.js',
  './src/goals.js',
  './src/hash.js',
  './src/home.js',
  './src/idb.js',
  './src/mastery.js',
  './src/plan-changes.js',
  './src/plan-items.js',
  './src/question-order.js',
  './src/record-actions.js',
  './src/records-model.js',
  './src/records.js',
  './src/review.js',
  './src/schedule.js',
  './src/seed.js',
  './src/settings-auto-plan.js',
  './src/settings-plan.js',
  './src/settings.js',
  './src/squares.js',
  './src/state.js',
  './src/study-timing.js',
  './src/tour-runner.js',
  './src/tour.js',
  './src/ui.js',
  './data/questions.json',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // 別のオリジンには、Service Worker は関与しない。
  if (url.origin !== self.location.origin) return;

  // 画面そのものの読み込みかどうか。オフラインのときに index.html を代わりに返せるのは、
  // これだけである。JS や JSON の代わりに HTML を返すと、
  // 「モジュールのはずが HTML だった」という分かりにくい失敗になるため、
  // 見つからなければ素直に失敗させる。
  const isNavigation = e.request.mode === 'navigate'
    || (e.request.destination === '' && (e.request.headers.get('accept') ?? '').includes('text/html'));

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(e.request);
        if (hit) return hit;
        if (isNavigation) {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('', { status: 504, statusText: 'offline' });
      })
  );
});
