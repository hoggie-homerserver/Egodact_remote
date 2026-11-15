'use strict';

/* Egodact Remote - offline shell cache */

const CACHE = 'egodact-remote-v1';
const SHELL = [
    './',
    'index.html',
    'styles.css',
    'app.js',
    'manifest.webmanifest',
    'icon.svg'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE).then(function (cache) {
            return cache.addAll(SHELL);
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.filter(function (key) {
                return key !== CACHE;
            }).map(function (key) {
                return caches.delete(key);
            }));
        }).then(function () {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function (event) {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET') return;
    if (url.pathname.indexOf('/api/') === 0) return;
    if (url.pathname === '/ws') return;
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then(function (cached) {
            if (cached) return cached;
            return fetch(event.request).then(function (response) {
                if (response && response.ok && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
                }
                return response;
            });
        }).catch(function () {
            return caches.match('index.html');
        })
    );
});
