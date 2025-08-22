// A name for our cache
const CACHE_NAME = 'gas-ruta-cache-v1';

// The URLs we want to cache. These are the "app shell" files.
const urlsToCache = [
    '/',
 '/index.html',
    '/app.js',
    '/worker.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/@turf/turf@6/turf.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap'
];

// Listen for the 'install' event.
// This is where we will cache our app shell files.
self.addEventListener('install', event => {
    console.log('Service Worker: Installing...');
    // waitUntil() ensures that the service worker will not install until the code inside has successfully completed.
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Caching app shell');
                // Add all the specified URLs to the cache.
                return cache.addAll(urlsToCache);
            })
    );
});

// Listen for the 'fetch' event.
// This event fires every time the app requests a resource (e.g., a page, script, image).
self.addEventListener('fetch', event => {
    // respondWith() hijacks the request and allows us to provide our own response.
    event.respondWith(
        // Check if the request is already in the cache.
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
});

// Listen for the 'activate' event.
// This is a good place to manage old caches.
self.addEventListener('activate', event => {
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
