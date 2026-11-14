// Service worker: caché del "app shell" para que la PWA abra sin conexión.
// Incrementar CACHE_NAME al cambiar las listas de abajo.
const CACHE_NAME = 'gas-ruta-cache-v2.6';

// Ficheros propios. Si alguno falla, la instalación falla (y se reintenta).
const APP_SHELL = [
    '/',
    '/index.html',
    '/app.js',
    '/route-stations.js',
    '/worker.js',
    '/analytics.js',
    '/dark-mode.js',
    '/manifest.json',
    '/mapa-placeholder.png',
    '/logo192.png',
    '/logo512.png'
];

// Librerías de CDN. Llevan versión fija, así que su contenido no cambia
// nunca; las versiones deben coincidir con las de index.html.
const CDN_ASSETS = [
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/@turf/turf@6.5.0/turf.min.js',
    'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap'
];

// Hosts cuyo contenido se sirve primero desde la caché (versiones fijas y fuentes)
const CACHE_FIRST_HOSTS = new Set(['cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', event => {
    self.skipWaiting(); // activar la nueva versión cuanto antes
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_SHELL);
        // Un CDN caído no debe impedir instalar la app: lo que falte se
        // guardará la primera vez que se use.
        await Promise.allSettled(CDN_ASSETS.map(url => cache.add(url)));
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

// Ficheros propios (HTML, JS, datos de precios): la red primero para tener
// siempre la última versión; la caché solo si no hay conexión.
async function networkFirst(request, cacheKey) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(cacheKey, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        throw error;
    }
}

// Contenido que no cambia: la caché primero, y la red solo la primera vez.
async function cacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    if (url.origin === self.location.origin) {
        if (/\.(png|ico|svg)$/.test(url.pathname)) {
            event.respondWith(cacheFirst(request));
        } else {
            // Se guarda sin la query string: las rutas compartidas llevan origen
            // y destino en ella, y no deben multiplicar (ni quedar en) la caché.
            event.respondWith(networkFirst(request, url.origin + url.pathname));
        }
    } else if (CACHE_FIRST_HOSTS.has(url.hostname)) {
        event.respondWith(cacheFirst(request));
    }
    // El resto (teselas del mapa, geocodificación, rutas, analítica) va
    // directo a la red, sin pasar por el service worker.
});
