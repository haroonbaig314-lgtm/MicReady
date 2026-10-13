/* Verba service worker: lets the site open offline and install as an app.
 *
 * Network first, cache as fallback, so visitors online always get the latest
 * version. Only this site's own files are cached; requests to other sites
 * (the beehiiv form, the Glide MVP) are never touched.
 */
var CACHE = 'verba-v1';
var CORE = [
    './', 'index.html', 'future.html', 'privacy.html', 'terms.html', 'refund.html', 'cookies.html', 'data-request.html',
    'home.js', 'features.js', 'features.css', 'site.js', 'site.css', 'hesitation.js',
    'fonts/fonts.css', 'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-ext-wght-normal.woff2',
    'favicon.svg', 'hero-bg.webp', 'icons/icon-192.png', 'manifest.webmanifest'
];

self.addEventListener('install', function (e) {
    e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf('verba-') === 0 && k !== CACHE; })
            .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;
    if (new URL(req.url).origin !== self.location.origin) return;
    e.respondWith(fetch(req).then(function (res) {
        if (res.ok && res.type === 'basic') {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
    }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
            if (hit) return hit;
            if (req.mode === 'navigate') return caches.match('index.html');
            return Response.error();
        });
    }));
});
