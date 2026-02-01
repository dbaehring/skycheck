/**
 * SkyCheck Service Worker
 * PWA-Support mit Cache-First-Strategie für statische Assets
 */

const CACHE_NAME = 'skycheck-v3';
const STATIC_CACHE_NAME = 'skycheck-static-v3';
const API_CACHE_NAME = 'skycheck-api-v3';

// Statische Assets die gecacht werden sollen
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/styles.css',
    './js/main.js',
    './js/config.js',
    './js/state.js',
    './js/map.js',
    './js/weather.js',
    './js/favorites.js',
    './js/ui.js',
    './js/utils.js',
    './img/logo.svg',
    './manifest.json'
];

// Externe Ressourcen (CDN) - Cache mit Netzwerk-Fallback
const EXTERNAL_ASSETS = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// API-Patterns die gecacht werden können (mit kurzer TTL)
const API_PATTERNS = [
    'api.open-meteo.com'
];

/**
 * Install-Event: Statische Assets cachen
 */
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker...');

    event.waitUntil(
        caches.open(STATIC_CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                // Externe Assets separat cachen (Fehler ignorieren)
                return caches.open(STATIC_CACHE_NAME).then((cache) => {
                    return Promise.allSettled(
                        EXTERNAL_ASSETS.map(url => cache.add(url).catch(() => {
                            console.log('[SW] Could not cache external:', url);
                        }))
                    );
                });
            })
            .then(() => self.skipWaiting())
    );
});

/**
 * Activate-Event: Alte Caches aufräumen
 */
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');

    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => {
                            // Lösche alte Cache-Versionen
                            return name.startsWith('skycheck-') &&
                                   name !== STATIC_CACHE_NAME &&
                                   name !== API_CACHE_NAME;
                        })
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

/**
 * Fetch-Event: Requests abfangen und cachen
 */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API-Requests: Network-First mit Cache-Fallback
    if (API_PATTERNS.some(pattern => url.hostname.includes(pattern))) {
        event.respondWith(networkFirstWithCache(event.request, API_CACHE_NAME));
        return;
    }

    // Karten-Tiles: Cache-First mit Network-Fallback
    if (url.hostname.includes('tile.opentopomap.org') ||
        url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(cacheFirstWithNetwork(event.request, STATIC_CACHE_NAME));
        return;
    }

    // Statische Assets: Cache-First
    if (event.request.method === 'GET') {
        event.respondWith(cacheFirstWithNetwork(event.request, STATIC_CACHE_NAME));
    }
});

/**
 * Cache-First Strategie: Erst Cache, dann Netzwerk
 */
async function cacheFirstWithNetwork(request, cacheName) {
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
        // Im Hintergrund aktualisieren (Stale-While-Revalidate)
        fetchAndCache(request, cacheName);
        return cachedResponse;
    }

    return fetchAndCache(request, cacheName);
}

/**
 * Network-First Strategie: Erst Netzwerk, dann Cache
 */
async function networkFirstWithCache(request, cacheName) {
    try {
        const response = await fetch(request);

        // Erfolgreiche Antwort cachen
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        // Bei Netzwerkfehler: Cache-Fallback
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log('[SW] Serving from cache (offline):', request.url);
            return cachedResponse;
        }

        // Offline-Fehler
        throw error;
    }
}

/**
 * Fetch und Cache
 */
async function fetchAndCache(request, cacheName) {
    try {
        const response = await fetch(request);

        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        console.log('[SW] Fetch failed:', request.url);
        throw error;
    }
}

/**
 * Message-Handler für manuelle Cache-Aktionen
 */
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }

    if (event.data === 'clearCache') {
        caches.keys().then((names) => {
            names.forEach((name) => {
                if (name.startsWith('skycheck-')) {
                    caches.delete(name);
                }
            });
        });
    }
});
