// A name for our cache - INCREMENTAR VERSION PARA FORZAR ACTUALIZACIÓN
const CACHE_NAME = 'gas-ruta-cache-v2.4';

// The URLs we want to cache. These are the "app shell" files.
// Las versiones de los CDN deben coincidir con las de index.html.
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/dark-mode.js',
    '/worker.js',
    '/manifest.json',
    '/mapa-placeholder.png',
    '/logo192.png',
    '/logo512.png',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/@turf/turf@6/turf.min.js',
    'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap'
];

// Listen for the 'install' event.
// This is where we will cache our app shell files.
self.addEventListener('install', event => {
    console.log('Service Worker: Installing v2.3...');
    // Forzar la activación inmediata del nuevo service worker
    self.skipWaiting();
    
    // waitUntil() ensures that the service worker will not install until the code inside has successfully completed.
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Caching app shell v2.3');
                // Add all the specified URLs to the cache.
                return cache.addAll(urlsToCache);
            })
    );
});

// Listen for the 'fetch' event.
// This event fires every time the app requests a resource (e.g., a page, script, image).
self.addEventListener('fetch', event => {
    // Para archivos críticos (.html, .js), priorizar la red sobre el cache
    const isCriticalFile = event.request.url.includes('.html') || 
                          event.request.url.includes('.js') || 
                          event.request.url.includes('app.js') ||
                          event.request.url.includes('index.html');
    
    if (isCriticalFile) {
        // Network first para archivos críticos
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Si la red funciona, actualizar cache y devolver respuesta
                    if (response && response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseClone);
                            });
                    }
                    return response;
                })
                .catch(() => {
                    // Si la red falla, usar cache como fallback
                    return caches.match(event.request);
                })
        );
    } else {
        // Cache first para otros recursos (CSS, imágenes, etc.)
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    // If we have a cached response, return it.
                    if (response) {
                        return response;
                    }
                    // If the request is not in the cache, fetch it from the network.
                    return fetch(event.request);
                }
            )
        );
    }
});

// Listen for the 'activate' event.
// This is a good place to manage old caches.
self.addEventListener('activate', event => {
    console.log('Service Worker: Activating v2.3...');
    // Tomar control inmediatamente de todos los clientes
    clients.claim();
    
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                // Map over all the cache names
                cacheNames.map(cacheName => {
                    // If a cache is not in our whitelist, delete it.
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log('Service Worker: Deleting old cache', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
