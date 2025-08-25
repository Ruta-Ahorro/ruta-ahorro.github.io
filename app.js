// --- PWA Setup: Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('ServiceWorker registration successful.', reg))
            .catch(err => console.log('ServiceWorker registration failed: ', err));
    });
}

// --- DOM Elements ---
const spinnerOverlay = document.getElementById('spinner-overlay');
const form = document.getElementById('route-form');
const searchButton = document.getElementById('search-button');
const originInput = document.getElementById('origin');
const destinationInput = document.getElementById('destination');
const currentFuelSlider = document.getElementById('current-fuel');
const currentFuelLabel = document.getElementById('current-fuel-label');
const finalFuelLabel = document.getElementById('final-fuel-label');
const finalFuelSlider = document.getElementById('final-fuel');
const resultsContainer = document.getElementById('results-container');
const resultsDiv = document.getElementById('results');
const messageContainer = document.getElementById('message-container');
const messageContent = document.getElementById('message-content');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const searchRadiusSlider = document.getElementById('search-radius');
const searchRadiusLabel = document.getElementById('search-radius-label');
const locateBtn = document.getElementById('locate-btn');
const originSuggestions = document.getElementById('origin-suggestions');
const destinationSuggestions = document.getElementById('destination-suggestions');
//const summaryContainer = document.getElementById('summary-container');
//const summaryContent = document.getElementById('summary-content');
const newRouteBtn = document.getElementById('new-route-btn');
// Mover manualSearchBtn dentro de DOMContentLoaded

// --- App State ---
// --- Spinner Control ---
function showSpinner() {
    spinnerOverlay.classList.remove('d-none');
}

function hideSpinner() {
    spinnerOverlay.classList.add('d-none');
}

// Detectar si es dispositivo móvil
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform));
}

// Función específica para Nominatim que funciona mejor con llamadas directas en móviles
async function fetchNominatim(url, options = {}) {
    const isMobile = isMobileDevice();
    console.log(`FetchNominatim called - Mobile: ${isMobile}, URL: ${url}`);
    
    if (isMobile) {
        // En móviles, usar llamada directa (la que funciona mejor)
        try {
            console.log('Using direct fetch for Nominatim on mobile');
            const response = await fetch(url, {
                ...options,
                mode: 'cors',
                credentials: 'omit',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Mobile; rv:100.0) Gecko/100.0 Firefox/100.0',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Referer': '',
                    ...options.headers
                }
            });
            
            if (response.ok) {
                console.log('Direct Nominatim fetch successful on mobile');
                return response;
            }
            throw new Error(`Direct fetch failed with status: ${response.status}`);
        } catch (error) {
            console.warn('Direct Nominatim fetch failed on mobile, trying proxies:', error);
            // Si falla, usar safeFetch como fallback
            return await safeFetch(url, options);
        }
    } else {
        // En escritorio, usar safeFetch normal
        return await safeFetch(url, options);
    }
}

// Función para hacer fetch con estrategia específica para móviles
async function safeFetch(url, options = {}) {
    const isMobile = isMobileDevice();
    console.log(`SafeFetch called - Mobile: ${isMobile}, URL: ${url}`);
    
    // Para APIs del gobierno español, siempre usar corsproxy.io primero (funciona mejor)
    const isSpanishGovAPI = url.includes('minetur.gob.es') || url.includes('sedeaplicaciones');
    
    if (isSpanishGovAPI) {
        console.log('Detected Spanish government API, using corsproxy.io directly');
        try {
            const proxiedUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxiedUrl, {
                ...options,
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                    ...options.headers
                }
            });
            
            if (response.ok) {
                console.log('Spanish gov API fetch successful with corsproxy.io');
                return response;
            }
        } catch (error) {
            console.warn('Corsproxy.io failed for Spanish gov API:', error);
        }
    }
    
    if (isMobile) {
        // En móviles, PRIORIZAR la llamada directa que funciona mejor para Nominatim
        try {
            console.log('Trying direct mobile fetch first (works best for Nominatim)');
            const response = await fetch(url, {
                ...options,
                mode: 'cors',
                credentials: 'omit',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Mobile; rv:100.0) Gecko/100.0 Firefox/100.0',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    ...options.headers
                }
            });
            
            if (response.ok) {
                console.log('Direct mobile fetch successful');
                return response;
            }
        } catch (error) {
            console.warn('Direct mobile fetch failed:', error);
        }
        
        // Fallback a proxies solo si la llamada directa falla
        const mobileProxies = [
            'https://corsproxy.io/?url=',
            'https://api.allorigins.win/get?url='
        ];
        
        for (const proxy of mobileProxies) {
            try {
                console.log(`Trying mobile proxy fallback: ${proxy}`);
                let fetchUrl, response;
                
                if (proxy.includes('allorigins')) {
                    fetchUrl = proxy + encodeURIComponent(url);
                    response = await fetch(fetchUrl, {
                        ...options,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Mobile; rv:100.0) Gecko/100.0 Firefox/100.0',
                            ...options.headers
                        }
                    });
                    if (response.ok) {
                        const data = await response.json();
                        console.log(`Mobile proxy ${proxy} success`);
                        return {
                            ok: true,
                            json: async () => JSON.parse(data.contents)
                        };
                    }
                } else {
                    // corsproxy.io
                    fetchUrl = proxy + encodeURIComponent(url);
                    response = await fetch(fetchUrl, {
                        ...options,
                        mode: 'cors',
                        credentials: 'omit',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Mobile; rv:100.0) Gecko/100.0 Firefox/100.0',
                            'Accept': 'application/json, text/plain, */*',
                            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                            ...options.headers
                        }
                    });
                    if (response.ok) {
                        console.log(`Mobile proxy ${proxy} success`);
                        return response;
                    }
                }
            } catch (error) {
                console.warn(`Mobile proxy ${proxy} failed:`, error);
                continue;
            }
        }
        
        console.error('All mobile strategies failed');
        throw new Error('Mobile fetch failed: All strategies exhausted');
        
    } else {
        // En escritorio, usar corsproxy.io primero para todas las APIs
        const proxies = [
            'https://corsproxy.io/?url=',
            'https://api.allorigins.win/get?url='
        ];
        
        for (const proxy of proxies) {
            try {
                let fetchUrl, response;
                
                if (proxy.includes('allorigins')) {
                    fetchUrl = proxy + encodeURIComponent(url);
                    response = await fetch(fetchUrl, options);
                    if (response.ok) {
                        const data = await response.json();
                        return {
                            ok: true,
                            json: async () => JSON.parse(data.contents)
                        };
                    }
                } else {
                    // corsproxy.io
                    fetchUrl = proxy + encodeURIComponent(url);
                    response = await fetch(fetchUrl, options);
                    if (response.ok) {
                        return response;
                    }
                }
            } catch (error) {
                console.warn(`Proxy ${proxy} failed:`, error);
                continue;
            }
        }
        
        // Fallback directo para escritorio
        return await fetch(url, options);
    }
}
let map;
let routeLayer;
let stationMarkers = L.layerGroup();
let allGasStations = [];
let currentRouteData = null; // Para almacenar datos de la ruta actual
let currentRouteStations = []; // Para almacenar gasolineras de la ruta actual
let manualSearchBtn; // Declarar como variable global

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Log información del dispositivo para debugging
    console.log('Device info:', {
        userAgent: navigator.userAgent,
        isMobile: isMobileDevice(),
        screen: { width: screen.width, height: screen.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        touchPoints: navigator.maxTouchPoints,
        platform: navigator.platform
    });
    
    manualSearchBtn = document.getElementById('manual-search-button');
    
    // Deshabilitar inmediatamente hasta que se carguen las gasolineras
    if (manualSearchBtn) {
        manualSearchBtn.disabled = true;
        manualSearchBtn.classList.add('disabled');
        console.log('Botón manual deshabilitado inicialmente');
    }
    
    initializeMap();
    fetchGasStations();
    
    // Event Listeners
    currentFuelSlider.addEventListener('input', e => { currentFuelLabel.textContent = `${e.target.value}%`; });
    finalFuelSlider.addEventListener('input', e => { finalFuelLabel.textContent = `${e.target.value}%`; });
    form.addEventListener('submit', handleFormSubmit);
    settingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('d-none'));
    searchRadiusSlider.addEventListener('input', e => { searchRadiusLabel.textContent = e.target.value; });
    locateBtn.addEventListener('click', handleLocateMe);
    setupAutocomplete(originInput, originSuggestions);
    setupAutocomplete(destinationInput, destinationSuggestions);

    // Global click listener to hide suggestions
    document.addEventListener('click', (e) => {
        if (!originInput.contains(e.target) && !originSuggestions.contains(e.target)) {
            originSuggestions.classList.add('d-none');
        }
        if (!destinationInput.contains(e.target) && !destinationSuggestions.contains(e.target)) {
            destinationSuggestions.classList.add('d-none');
        }
    });

    newRouteBtn.addEventListener('click', resetUI);
    
    // Event listener para búsqueda manual desde la pantalla principal
    if (manualSearchBtn) {
        console.log('Botón manual encontrado, añadiendo event listener');
        
        manualSearchBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            console.log('Click detectado en botón manual');
            
            // Verificar si el botón está deshabilitado
            if (manualSearchBtn.disabled || manualSearchBtn.classList.contains('disabled')) {
                console.log('Botón está deshabilitado, ignorando click');
                return;
            }
            
            console.log('Ejecutando handleManualSearch');
            handleManualSearch();
        });
    } else {
        console.error('No se encontró el botón manual-search-button');
    }
});

function resetUI() {
    // Hide summary and results
    //summaryContainer.classList.add('d-none');
    resultsContainer.classList.add('d-none');
    resultsDiv.innerHTML = '';

    // Show form and default message
    form.classList.remove('d-none');
    showMessage('info', 'Introduce una ruta para comenzar.');
    
    // Clear map
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
    stationMarkers.clearLayers();
}

async function handleManualSearch() {
    console.log('handleManualSearch llamado');
    const originText = originInput.value.trim();
    const destinationText = destinationInput.value.trim();
    
    console.log('Origen:', originText, 'Destino:', destinationText);
    
    if (!originText || !destinationText) {
        console.log('Campos vacíos detectados');
        showMessage('error', 'Por favor, introduce tanto el origen como el destino antes de buscar paradas manuales.');
        return;
    }
    
    showSpinner();
    
    try {
        // Geocodificar direcciones
        let originCoords, destCoords;
        try {
            [originCoords, destCoords] = await Promise.all([geocodeAddress(originText), geocodeAddress(destinationText)]);
        } catch (e) {
            throw new Error("Error de conexión con el servicio de mapas (Nominatim) al buscar direcciones.");
        }
        
        if (!originCoords || !destCoords) {
            throw new Error("No se pudieron geolocalizar las direcciones. Intenta ser más específico o revisa tu conexión.");
        }

        // Obtener ruta
        let routeData;
        try {
            routeData = await getRoute(originCoords, destCoords);
        } catch (e) {
            throw new Error("Error al calcular la ruta. Verifica tu conexión a internet.");
        }
        
        if (!routeData) {
            throw new Error("No se pudo calcular la ruta entre los puntos especificados.");
        }

        // Crear geometría de la ruta
        const routeLine = turf.lineString(routeData.geometry.coordinates);
        var miEstilo = {
            "color": "#4138c2",
            "weight": 2,
            "opacity": 0.8
        };
        
        // Limpiar mapa anterior y mostrar nueva ruta
        if (routeLayer) {
            map.removeLayer(routeLayer);
        }
        routeLayer = L.geoJSON(routeLine, { style: miEstilo }).addTo(map);
        map.invalidateSize();
        map.fitBounds(routeLayer.getBounds().pad(0.1));
        
        const routeDistance = turf.length(routeLine, { units: 'kilometers' });

        // Preparar parámetros para la búsqueda manual
        const params = {
            fuelType: document.getElementById('fuel-type').value,
            tankCapacity: parseFloat(document.getElementById('tank-capacity').value),
            currentFuelPercent: parseFloat(document.getElementById('current-fuel').value),
            finalFuelPercent: parseFloat(document.getElementById('final-fuel').value),
            consumption: parseFloat(document.getElementById('consumption').value) || 6.5,
            searchRadius: parseFloat(document.getElementById('search-radius').value),
            includeRestricted: document.getElementById('include-restricted').checked
        };

        // Almacenar datos para ruta manual
        currentRouteData = {
            routeLine: routeLine,
            routeDistance: routeDistance,
            origin: originText,
            destination: destinationText,
            params: params
        };

        hideSpinner();
        
        // Calcular estaciones más baratas directamente aquí
        console.log('Calculando estaciones más baratas...');
        const cheapestStations = getCheapestStationsOnRoute(
            routeLine, 
            params, 
            allGasStations, 
            originText, 
            destinationText
        );

        console.log('Estaciones encontradas:', cheapestStations.length);

        if (cheapestStations.length === 0) {
            showMessage('error', 'No se encontraron gasolineras baratas en la ruta. Intenta aumentar la distancia de búsqueda en la configuración.');
            return;
        }
        
        // Mostrar opciones de ruta manual directamente con las estaciones calculadas
        showManualRouteOptions(originText, destinationText, cheapestStations);
        
    } catch (error) {
        hideSpinner();
        console.error("Manual search error:", error);
        showMessage('error', error.message);
    }
}

// --- Autocomplete ---
let debounceTimer;
function setupAutocomplete(inputEl, suggestionsEl) {
    inputEl.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = inputEl.value;

        if (query.length < 3) {
            suggestionsEl.innerHTML = '';
            suggestionsEl.classList.add('d-none');
            return;
        }

        debounceTimer = setTimeout(() => {
            fetchSuggestions(query, suggestionsEl, inputEl);
        }, 300);
    });
}

async function fetchSuggestions(query, suggestionsEl, inputEl) {
    try {
        const apiUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=es&limit=5`;
        
        const response = await fetchNominatim(apiUrl);
        if (!response.ok) {
            suggestionsEl.classList.add('d-none');
            return;
        }

        const suggestions = await response.json();

        suggestionsEl.innerHTML = '';
        if (suggestions.length === 0) {
            suggestionsEl.classList.add('d-none');
            return;
        }

        suggestions.forEach(place => {
            const suggestionItem = document.createElement('a');
            suggestionItem.href = "#";
            suggestionItem.className = 'list-group-item list-group-item-action';
            suggestionItem.textContent = place.display_name;
            suggestionItem.addEventListener('click', (e) => {
                e.preventDefault();
                inputEl.value = place.display_name;
                suggestionsEl.innerHTML = '';
                suggestionsEl.classList.add('d-none');
            });
            suggestionsEl.appendChild(suggestionItem);
        });

        suggestionsEl.classList.remove('d-none');
    } catch (error) {
        console.error("Autocomplete fetch error:", error);
        suggestionsEl.innerHTML = '';
        suggestionsEl.classList.add('d-none');
    }
}

function handleLocateMe() {
    if (!navigator.geolocation) {
        alert('La geolocalización no está soportada en tu navegador.');
        return;
    }

    const originalBtnContent = locateBtn.innerHTML;
    locateBtn.disabled = true;
    locateBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>`;

    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        originInput.value = 'Buscando dirección...';
        
        const apiUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
        
        try {
            const response = await fetchNominatim(apiUrl);
            if (response.ok) {
                const data = await response.json();
                if (data && data.display_name) {
                    originInput.value = data.display_name;
                } else {
                    originInput.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
                }
            } else {
                originInput.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
                alert('No se pudo encontrar la dirección. Se usarán las coordenadas.');
            }
        } catch (err) {
            console.error('Reverse geocoding error:', err);
            originInput.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            alert('No se pudo encontrar la dirección. Se usarán las coordenadas.');
        } finally {
            locateBtn.disabled = false;
            locateBtn.innerHTML = originalBtnContent;
        }
    }, (error) => {
        let message;
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = "Has denegado el permiso para la geolocalización.";
                break;
            case error.POSITION_UNAVAILABLE:
                message = "La información de ubicación no está disponible.";
                break;
            case error.TIMEOUT:
                message = "La solicitud para obtener la ubicación ha caducado.";
                break;
            default:
                message = "Ha ocurrido un error desconocido al obtener la ubicación.";
                break;
        }
        alert(message);
        locateBtn.disabled = false;
        locateBtn.innerHTML = originalBtnContent;
    });
}

function initializeMap() {
    map = L.map('map').setView([40.416775, -3.703790], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    stationMarkers.addTo(map);

    // This is a common fix for maps in dynamically sized containers.
    // It tells Leaflet to re-check the map's size after a short delay,
    // ensuring the layout has been computed by the browser.
    setTimeout(() => {
        map.invalidateSize();
    }, 100);
}

function showMessage(type, text) {
    resultsContainer.classList.add('d-none');
    messageContainer.classList.remove('d-none');
    let content = '';
    if (type === 'loading') {
        content = `<div class="loader mx-auto"></div><p class="mt-2 text-muted">${text}</p>`;
    } else if (type === 'error') {
        content = `<p class="text-danger fw-semibold">${text}</p>`;
    } else {
        content = `<p class="text-muted">${text}</p>`;
    }
    messageContent.innerHTML = content;
}

/**
 * Fetches gas station data using a fallback list of CORS proxies for reliability.
 */
async function fetchGasStations() {
    showSpinner();
    searchButton.disabled = true;
    searchButton.classList.add('disabled');
    
    // Deshabilitar botón de búsqueda manual también
    if (manualSearchBtn) {
        console.log('Deshabilitando botón manual durante carga');
        manualSearchBtn.disabled = true;
        manualSearchBtn.classList.add('disabled');
    } else {
        console.error('No se pudo deshabilitar el botón manual');
    }

    const apiUrl = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
    
    try {
        console.log('Cargando gasolineras usando corsproxy.io (el que funciona mejor)...');
        
        // Usar directamente corsproxy.io que es el que funciona para gasolineras
        const proxiedUrl = `https://corsproxy.io/?url=${encodeURIComponent(apiUrl)}`;
        const response = await fetch(proxiedUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
            }
        });
        
        if (!response.ok) {
            throw new Error(`La petición falló con estado ${response.status}`);
        }
        
        const jsonData = await response.json();
        
        if (!jsonData || !jsonData.ListaEESSPrecio || !Array.isArray(jsonData.ListaEESSPrecio)) {
            throw new Error('Datos de gasolineras no válidos recibidos');
        }
        
        console.log('Datos de gasolineras cargados correctamente con corsproxy.io');
        
        // Process the successfully fetched data
        allGasStations = jsonData.ListaEESSPrecio
            .map(s => ({
                id: s['IDEESS'], name: s['Rótulo'], address: `${s['Dirección']}, ${s['Localidad']}`,
                lat: parseFloat(s['Latitud'].replace(',', '.')), lon: parseFloat(s['Longitud (WGS84)'].replace(',', '.')),
                tipoVenta: s['Tipo Venta'],
                horario: s['Horario'],

                prices: {
                    'Precio Gasoleo A': parseFloat(s['Precio Gasoleo A'].replace(',', '.')) || null,
                    'Precio Gasolina 95 E5': parseFloat(s['Precio Gasolina 95 E5'].replace(',', '.')) || null,
                    'Precio Gasolina 98 E5': parseFloat(s['Precio Gasolina 98 E5'].replace(',', '.')) || null,
                    'Precio Gasoleo Premium': parseFloat(s['Precio Gasoleo Premium'].replace(',', '.')) || null,
                    'Precio Gasoleo B': parseFloat(s['Precio Gasoleo B'].replace(',', '.')) || null,
                    'Precio Gases licuados del petróleo': parseFloat(s['Precio Gases licuados del petróleo'].replace(',', '.')) || null,
                    'Precio Gas Natural Comprimido': parseFloat(s['Precio Gas Natural Comprimido'].replace(',', '.')) || null,
                    'Precio Gas Natural Licuado': parseFloat(s['Precio Gas Natural Licuado'].replace(',', '.')) || null,
                }
            })).filter(s => s.lat && s.lon);
        
        console.log(`Cargadas ${allGasStations.length} gasolineras.`);
        showMessage('info', 'Datos cargados. ¡Listo para buscar tu ruta!');
        searchButton.disabled = false;
        searchButton.classList.remove('disabled');
        
        // Habilitar botón de búsqueda manual también
        if (manualSearchBtn) {
            console.log('Habilitando botón manual después de cargar gasolineras');
            manualSearchBtn.disabled = false;
            manualSearchBtn.classList.remove('disabled');
        }
        
    } catch (error) {
        console.error("Error cargando gasolineras:", error);
        showMessage('error', 'Error de conexión: No se pudieron cargar los datos de las gasolineras del gobierno. El servicio puede estar temporalmente caído. Por favor, inténtalo de nuevo más tarde.');
    } finally {
        hideSpinner();
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();
    showSpinner();
    //showMessage('loading', 'Calculando la mejor ruta y paradas...');
    if (routeLayer) map.removeLayer(routeLayer);
    stationMarkers.clearLayers();
    resultsDiv.innerHTML = '';

    try {
        const originText = originInput.value;
        const destinationText = destinationInput.value;

        let originCoords, destCoords;
        try {
            [originCoords, destCoords] = await Promise.all([geocodeAddress(originText), geocodeAddress(destinationText)]);
        } catch (e) {
            throw new Error("Error de conexión con el servicio de mapas (Nominatim) al buscar direcciones.");
        }
        
        if (!originCoords || !destCoords) throw new Error("No se pudieron geolocalizar las direcciones. Intenta ser más específico o revisa tu conexión.");

        let routeData;
        try {
            routeData = await getRoute(originCoords, destCoords);
        } catch (e) {
            throw new Error("Error de conexión con el servicio de rutas (OSRM). No se pudo calcular la ruta.");
        }
        
        if (!routeData) throw new Error("No se pudo encontrar una ruta válida entre el origen y el destino.");

        const routeLine = turf.lineString(routeData.geometry.coordinates);
        var miEstilo = {
    "color": "#4138c2", // El color de la línea, en este caso azul oscuro. 🔵
    "weight": 2,        // El grosor de la línea en píxeles.
    "opacity": 0.8      // La transparencia de la línea.
};
        routeLayer = L.geoJSON(routeLine, { style: miEstilo }).addTo(map);
                // Force the map to re-evaluate its size before fitting the bounds
                map.invalidateSize();
        map.fitBounds(routeLayer.getBounds().pad(0.1));
        const routeDistance = turf.length(routeLine, { units: 'kilometers' });

        // --- Web Worker Implementation ---
        const worker = new Worker('worker.js');

        worker.onmessage = function(e) {
            hideSpinner();
            const { success, results, error, origin, destination } = e.data;
            if (success) {
                console.log('Main: Results received from worker.');
                
                // Almacenar datos para ruta manual
                currentRouteData = {
                    routeLine: routeLine,
                    routeDistance: routeDistance,
                    origin: origin,
                    destination: destination,
                    params: params,
                    lastResults: results
                };
                
                displayResults(results, origin, destination);
                
                // Hide form and show summary
                form.classList.add('d-none');
                const formData = new FormData(form);
                const fuelTypeEl = form.elements['fuel-type'];
               // summaryContent.innerHTML = `
              //      <p><strong>Origen:</strong> ${formData.get('origin')}</p>
              //      <p><strong>Destino:</strong> ${formData.get('destination')}</p>
              //      <p><strong>Combustible:</strong> ${fuelTypeEl.options[fuelTypeEl.selectedIndex].text}</p>
              //      <p><strong>Consumo:</strong> ${formData.get('consumption')} L/100km</p>
              //  `;
              //  summaryContainer.classList.remove('d-none');
            } else {
                console.error('Main: Error message received from worker.', error);
                // Custom, more user-friendly error messages
                let userMessage = error;
                if (error.includes("No hay gasolineras alcanzables") || error.includes("No hay gasolineras adecuadas")) {
                    userMessage = "No se encontraron gasolineras adecuadas para completar la ruta con la configuración actual. Prueba a aumentar la distancia de búsqueda en la configuración.";
                }
                showMessage('error', userMessage);
            }
            // Terminate worker after use
            worker.terminate();
        };

        worker.onerror = function(e) {
            hideSpinner();
            console.error('Main: An error occurred in the worker.', e);
            showMessage('error', `Error en el worker: ${e.message}`);
            worker.terminate();
        };

        // Collect parameters to send to the worker
        const params = {
            fuelType: document.getElementById('fuel-type').value,
            tankCapacity: parseFloat(document.getElementById('tank-capacity').value),
            currentFuelPercent: parseFloat(document.getElementById('current-fuel').value),
            finalFuelPercent: parseFloat(document.getElementById('final-fuel').value),
            consumption: parseFloat(document.getElementById('consumption').value) || 6.5,
            searchRadius: parseFloat(document.getElementById('search-radius').value),
            includeRestricted: document.getElementById('include-restricted').checked,
            algorithm: document.querySelector('input[name="algorithm"]:checked').value
        };

        console.log('Main: Posting message to worker.');
        // Post data to the worker to start calculation.
        worker.postMessage({
            routeLine,
            routeDistance,
            params,
            allGasStations,
            origin: originText,
            destination: destinationText
        });
        // --- End of Web Worker Implementation ---

    } catch (error) {
        hideSpinner();
        console.error("Route calculation error:", error);
        showMessage('error', error.message);
    }
}

async function geocodeAddress(address) {
    const apiUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&countrycodes=es&limit=1`;
    
    try {
        const response = await fetchNominatim(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.length > 0 ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}

async function getRoute(origin, dest) {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();
    return (data.code === 'Ok' && data.routes.length > 0) ? data.routes[0] : null;
}

function getCheapestStationsOnRoute(routeLine, params, allGasStations, origin, destination) {
    console.log('getCheapestStationsOnRoute llamado con:', params.fuelType, 'Total gasolineras:', allGasStations.length);
    
    const { fuelType, searchRadius, includeRestricted } = params;
    
    // Filtrar estaciones como en el worker
    let candidateStations = allGasStations.filter(station => {
        if (!station.prices[fuelType]) {
            return false;
        }
        let saleTypeFilter = station.tipoVenta === 'P';
        if (includeRestricted) {
            saleTypeFilter = station.tipoVenta === 'P' || station.tipoVenta === 'R';
        }
        return saleTypeFilter;
    });

    console.log('Candidatas después de filtro tipo:', candidateStations.length);

    // Crear bounding box buffeado
    const routeBbox = turf.bbox(routeLine);
    const bufferedBboxPolygon = turf.buffer(turf.bboxPolygon(routeBbox), searchRadius, { units: 'kilometers' });

    // Filtrar estaciones dentro del bounding box
    candidateStations = candidateStations.filter(station => {
        const point = turf.point([station.lon, station.lat]);
        return turf.booleanPointInPolygon(point, bufferedBboxPolygon);
    });

    console.log('Candidatas después de filtro bbox:', candidateStations.length);

    // Filtrado detallado
    const originPoint = turf.point(routeLine.geometry.coordinates[0]);
    
    const stationsOnRoute = candidateStations
        .filter(station => {
            const point = turf.point([station.lon, station.lat]);
            const distanceToRoute = turf.pointToLineDistance(point, routeLine, { units: 'kilometers' });
            return distanceToRoute <= searchRadius;
        })
        .map(station => {
            const stationPoint = turf.point([station.lon, station.lat]);
            const nearestPointOnRoute = turf.nearestPointOnLine(routeLine, stationPoint);
            const distanceFromStart = turf.distance(originPoint, nearestPointOnRoute, { units: 'kilometers' });

            return { ...station, distanceFromStart };
        });
    
    console.log('Estaciones después de filtro de distancia a ruta:', stationsOnRoute.length);
    
    const finalStations = stationsOnRoute
        .sort((a, b) => a.prices[fuelType] - b.prices[fuelType]) // Ordenar por precio
        .slice(0, 15) // Tomar las 15 más baratas
        .sort((a, b) => a.distanceFromStart - b.distanceFromStart); // Ordenar por distancia desde origen

    console.log('Estaciones finales encontradas:', finalStations.length);
    return finalStations;
}

// Función para actualizar marcadores basado en selección
function updateMapMarkers(stations) {
    stationMarkers.clearLayers();
    
    const selectedCheckboxes = document.querySelectorAll('.station-checkbox:checked');
    
    // Crear array de estaciones seleccionadas con su orden de distancia
    const selectedStations = Array.from(selectedCheckboxes).map(checkbox => {
        const index = parseInt(checkbox.value);
        return {
            ...stations[index],
            originalIndex: index
        };
    });
    
    // Ordenar por distancia desde origen para establecer el orden de parada
    selectedStations.sort((a, b) => a.distanceFromStart - b.distanceFromStart);
    
    // Crear marcadores con números correlativos de parada
    selectedStations.forEach((station, stopNumber) => {
        const markerColor = '#4138c2'; // Color del tema de la app
        const stopIndex = stopNumber + 1; // Número de parada (1, 2, 3...)
        const markerHtml = `<div style="background-color: ${markerColor}; color: white; border-radius: 50%; width: 1.8rem; height: 1.8rem; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); font-size: 0.9rem;">${stopIndex}</div>`;
        const icon = L.divIcon({ html: markerHtml, className: '', iconSize: [28, 28], iconAnchor: [14, 14] });

        L.marker([station.lat, station.lon], { icon })
            .bindPopup(`<b>Parada ${stopIndex}: ${station.name}</b><br>${station.address}<br>Precio: ${station.prices[currentRouteData.params.fuelType].toFixed(3)} €/L<br>Km ${Math.round(station.distanceFromStart)} desde origen`)
            .addTo(stationMarkers);
    });
    
    // Actualizar contador
    updateSelectionCounter(selectedCheckboxes.length);
    updateSelectionCounter(selectedCheckboxes.length);
}

// Función para actualizar el contador de selecciones
function updateSelectionCounter(count) {
    const counter = document.getElementById('selection-counter');
    const routeBtn = document.getElementById('generate-manual-route-btn');
    
    if (counter) {
        counter.textContent = `${count} gasolinera${count !== 1 ? 's' : ''} seleccionada${count !== 1 ? 's' : ''}`;
    }
    
    if (routeBtn) {
        if (count === 0) {
            routeBtn.disabled = true;
            routeBtn.classList.add('disabled');
        } else {
            routeBtn.disabled = false;
            routeBtn.classList.remove('disabled');
        }
    }
}

// Función para actualizar apariencia de la tarjeta
function updateCardAppearance(card, isSelected, stations) {
    if (isSelected) {
        card.classList.add('selected');
        // Actualizar el orden de selección
        updateSelectionOrder(stations);
    } else {
        card.classList.remove('selected');
        // Actualizar el orden de selección
        updateSelectionOrder(stations);
    }
}

// Función para actualizar el orden de selección en los badges
function updateSelectionOrder(stations) {
    const selectedCheckboxes = document.querySelectorAll('.station-checkbox:checked');
    
    // Limpiar todos los badges
    document.querySelectorAll('.selection-badge').forEach(badge => {
        badge.textContent = '';
    });
    
    if (selectedCheckboxes.length === 0 || !stations) return;
    
    // Obtener estaciones seleccionadas con sus datos completos
    const selectedStationsData = Array.from(selectedCheckboxes).map(checkbox => {
        const stationIndex = parseInt(checkbox.value);
        return {
            stationIndex,
            station: stations[stationIndex]
        };
    });
    
    // Ordenar por distancia desde origen
    selectedStationsData.sort((a, b) => a.station.distanceFromStart - b.station.distanceFromStart);
    
    // Asignar números de parada ordenados por distancia
    selectedStationsData.forEach((stationData, orderIndex) => {
        const badge = document.getElementById(`badge-${stationData.stationIndex}`);
        if (badge) {
            badge.textContent = orderIndex + 1;
        }
    });
}

function showManualRouteOptions(origin, destination, preCalculatedStations = null) {
    console.log('showManualRouteOptions llamado con:', origin, destination, 'estaciones precalculadas:', preCalculatedStations ? preCalculatedStations.length : 'ninguna');
    
    if (!currentRouteData) {
        alert('No hay datos de ruta disponibles. Por favor, calcula una ruta primero.');
        return;
    }

    if (!allGasStations || allGasStations.length === 0) {
        alert('Los datos de gasolineras aún no están disponibles. Por favor, espera un momento e inténtalo de nuevo.');
        return;
    }

    let cheapestStations;
    
    if (preCalculatedStations) {
        // Usar estaciones pre-calculadas
        cheapestStations = preCalculatedStations;
        console.log('Usando estaciones precalculadas:', cheapestStations.length);
    } else {
        // Calcular estaciones (flujo original)
        console.log('Calculando estaciones en showManualRouteOptions...');
        cheapestStations = getCheapestStationsOnRoute(
            currentRouteData.routeLine, 
            currentRouteData.params, 
            allGasStations, 
            origin, 
            destination
        );
        console.log('Estaciones calculadas:', cheapestStations.length);
    }

    if (cheapestStations.length === 0) {
        alert('No se encontraron gasolineras baratas en la ruta. Intenta aumentar la distancia de búsqueda en la configuración.');
        return;
    }

    console.log('Iniciando generación de interfaz visual...');

    // Limpiar contenido anterior
    resultsDiv.innerHTML = '';
    
    console.log('Contenido anterior limpiado');

    // Mostrar contenedor de resultados y ocultar mensaje
    messageContainer.classList.add('d-none');
    resultsContainer.classList.remove('d-none');
    
    // Ocultar el formulario principal
    form.classList.add('d-none');
    
    console.log('Contenedor de resultados mostrado y formulario ocultado');

    // Título
    const title = document.createElement('h3');
title.className = "h5 fw-bold text-body-emphasis";
title.textContent = "Selecciona las paradas";

const backToResultsBtn = document.createElement('button');
backToResultsBtn.id = "back-to-results-btn";
backToResultsBtn.className = "btn btn-danger  d-flex align-items-center gap-2";
backToResultsBtn.innerHTML = `<i class="bi bi-arrow-return-left"></i>`;

// 1. Crea un nuevo contenedor para los dos elementos
const headerContainer = document.createElement('div');

// 2. Añade las clases de Bootstrap para convertirlo en un flexbox
headerContainer.className = "mb-3 d-flex justify-content-between align-items-center";

// 3. Añade el título y el botón al nuevo contenedor
headerContainer.appendChild(title);
headerContainer.appendChild(backToResultsBtn);

// 4. Añade el contenedor completo a tu resultsDiv
resultsDiv.appendChild(headerContainer);

console.log('Header container añadido');

    // Contenedor de botones de acción
    //const actionContainer = document.createElement('div');
    //actionContainer.className = 'mb-3 d-flex gap-2';
    //actionContainer.innerHTML = `
    //    <button id="select-all-btn" class="btn btn-sm btn-outline-primary">Seleccionar Todo</button>
    //    <button id="clear-all-btn" class="btn btn-sm btn-outline-secondary">Limpiar Todo</button>
    //    <button id="back-to-results-btn" class="btn btn-sm btn-outline-danger">Volver</button>
   // `;
    //resultsDiv.appendChild(actionContainer);
        const generateContainer = document.createElement('div');
    generateContainer.className = 'mt-2 d-grid';
    generateContainer.innerHTML = `
        <button id="generate-manual-route-btn" class="btn btn-primary">
            <i class="bi bi-google me-2"></i>
            <span id="route-btn-text">Abrir Ruta en Google Maps</span>
        </button>
        <small class="text-muted mt-2 text-center" id="selection-counter">0 gasolineras seleccionadas</small>
    `;
    resultsDiv.appendChild(generateContainer);
    
    console.log('Generate container añadido');
    
    // Lista de estaciones con checkboxes
    const stationsContainer = document.createElement('div');
    stationsContainer.id = 'manual-stations-container';
    
    console.log('Iniciando creación de', cheapestStations.length, 'tarjetas de estaciones');
    
    cheapestStations.forEach((station, index) => {
        const card = document.createElement('div');
        card.className = 'card card-body mb-2 bg-body-tertiary station-card';
        card.style.cursor = 'pointer';
        card.style.paddingTop = '2px';
        card.style.paddingBottom = '2px';
        card.setAttribute('data-station-index', index);
        card.innerHTML = `
            <div class="selection-badge" id="badge-${index}"></div>
            <div class="d-flex align-items-start">
                <div class="form-check me-3 mt-1">
                    <input class="form-check-input station-checkbox" type="checkbox" value="${index}" id="station-${index}">
                </div>
                <div class="flex-grow-1">
                    <label class="form-check-label fw-bold" for="station-${index}" style="color:#b549ff;">${station.name}</label>
                    <p class="small text-danger fw-bold mb-1">${station.horario}
                    <span class="small text-muted">Km ${Math.round(station.distanceFromStart)}</span></p>
                </div>
                <div class="text-end ms-2">
                    <p class="h6 fw-bold text-body-emphasis mb-0">${station.prices[currentRouteData.params.fuelType].toFixed(3)} €/L</p>
                </div>
            </div>
        `;
        stationsContainer.appendChild(card);

        // Añadir event listener para hacer clic en la tarjeta
        card.addEventListener('click', (e) => {
            // Evitar doble activación si se hace clic directamente en el checkbox
            if (e.target.type !== 'checkbox') {
                const checkbox = card.querySelector('.station-checkbox');
                checkbox.checked = !checkbox.checked;
                updateMapMarkers(cheapestStations);
                updateCardAppearance(card, checkbox.checked, cheapestStations);
            }
        });

        // Event listener para el checkbox
        const checkbox = card.querySelector('.station-checkbox');
        checkbox.addEventListener('change', () => {
            updateMapMarkers(cheapestStations);
            updateCardAppearance(card, checkbox.checked, cheapestStations);
        });
    });
    
    resultsDiv.appendChild(stationsContainer);
    
    console.log('Stations container añadido al DOM');

    // Botón para generar ruta


    // Event listeners
//    document.getElementById('select-all-btn').addEventListener('click', () => {
//        document.querySelectorAll('.station-checkbox').forEach(cb => {
//            cb.checked = true;
//            const card = cb.closest('.station-card');
//            updateCardAppearance(card, true, cheapestStations);
//        });
//        updateMapMarkers(cheapestStations);
//    });

//    document.getElementById('clear-all-btn').addEventListener('click', () => {
//        document.querySelectorAll('.station-checkbox').forEach(cb => {
//            cb.checked = false;
//            const card = cb.closest('.station-card');
//            updateCardAppearance(card, false, cheapestStations);
//        });
//        updateMapMarkers(cheapestStations);
//    });

    document.getElementById('back-to-results-btn').addEventListener('click', () => {
        // Volver a mostrar el formulario principal
        form.classList.remove('d-none');
        resultsContainer.classList.add('d-none');
        messageContainer.classList.remove('d-none');
        
        // Limpiar el mapa
        stationMarkers.clearLayers();
        if (routeLayer) {
            map.removeLayer(routeLayer);
            routeLayer = null;
        }
        
        // Mostrar mensaje por defecto
        showMessage('info', 'Introduce una ruta para comenzar.');
        
        console.log('Vuelta a la pantalla principal');
    });

    document.getElementById('generate-manual-route-btn').addEventListener('click', () => {
        const selectedCheckboxes = document.querySelectorAll('.station-checkbox:checked');
        
        if (selectedCheckboxes.length === 0) {
            alert('Por favor, selecciona al menos una gasolinera');
            return;
        }

        const selectedStations = Array.from(selectedCheckboxes).map(cb => {
            const index = parseInt(cb.value);
            return cheapestStations[index];
        });

        // Ordenar por distancia desde origen
        selectedStations.sort((a, b) => a.distanceFromStart - b.distanceFromStart);

        // Generar URL de Google Maps
        const waypoints = selectedStations.map(s => `${s.lat},${s.lon}`).join('|');
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}`;

        // Abrir en nueva pestaña
        window.open(googleMapsUrl, '_blank', 'noopener,noreferrer');
    });

    // Inicializar mapa sin marcadores (se añadirán cuando se seleccionen)
    stationMarkers.clearLayers();
    
    // Inicializar contador
    updateSelectionCounter(0);
    
    console.log('showManualRouteOptions completado exitosamente');
}

function displayResults(results, origin, destination) {
    const stops = results.stops;
    if (stops.length === 0) {
        if (allGasStations.length === 0) {
             showMessage('error', 'Error crítico: No se pudieron cargar los datos de las gasolineras. Por favor, recarga la página.');
        } else {
             showMessage('info', '¡Buenas noticias! Con tu nivel de combustible actual, puedes llegar a tu destino sin necesidad de repostar.');
        }
        return;
    }

    messageContainer.classList.add('d-none');
    resultsContainer.classList.remove('d-none');
    resultsDiv.innerHTML = '';
    
    const title = document.createElement('h3');
    title.className = "h5 fw-bold text-body-emphasis mb-2";
    title.textContent = "Plan de paradas sugeridas";
    resultsDiv.appendChild(title);
                if (stops.length > 0) {
        const waypoints = stops.map(s => `${s.lat},${s.lon}`).join('|');
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}`;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'mt-2 d-grid';
        buttonContainer.innerHTML = `
            <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary d-flex align-items-center justify-content-center">
                <i class="bi bi-google me-2"></i>
                Abrir Ruta en Google Maps
            </a>
        `;
        resultsDiv.appendChild(buttonContainer);

        const savingsVsAvg = results.avgPriceCost - results.optimalCost;
        const savingsVsMax = results.maxPriceCost - results.optimalCost;

        if (savingsVsAvg > 0 || savingsVsMax > 0) {
            const savingsContainer = document.createElement('div');
            savingsContainer.className = 'mt-2 p-2 bg-success-subtle border border-success-subtle rounded-3 mb-1';
            savingsContainer.innerHTML = `
                
                <p class="text-sm text-success-emphasis">
                    <span class="fw-bold">Ahorro: ${savingsVsAvg.toFixed(2)}€</span> comparado con la media.
                </p>
                <p class="text-sm text-success-emphasis mt-1">
                     <span class="fw-bold">Ahorro: ${savingsVsMax.toFixed(2)}€</span> comparado con el máximo.
                </p>
            `;
            resultsDiv.appendChild(savingsContainer);
        }
    }
    stops.forEach((station, index) => {
        const card = document.createElement('div');
        card.className = 'card card-body mb-2 bg-body-tertiary';
        card.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
                <div class="flex-grow-1">
                    <p class="fw-bold" style="color:#b549ff;" >Parada ${index + 1}: ${station.name}</p>
                    <p class=" fw-bold small text-danger">${station.horario}</p>
                    <p class="small text-muted">${station.address}</p>
                    <p class="small text-muted">Aprox. en el km ${Math.round(station.distanceFromStart)}</p>
                </div>
                <div class="text-end ms-2 flex-shrink-0">
                    <p class="h5 fw-bold text-body-emphasis">${station.prices[form.elements['fuel-type'].value].toFixed(3)} €/L</p>
                    <p class="small text-muted">Repostar: ${station.refuelAmount.toFixed(1)} L</p>
                    <p class="small fw-semibold text-success">Coste: ${station.refuelCost.toFixed(2)}€</p>
                </div>
            </div>
        `;
        resultsDiv.appendChild(card);

        const markerColor = '#b549ff';
        const markerHtml = `<div style="background-color: ${markerColor}; color: white; border-radius: 50%; width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${index + 1}</div>`;
        const icon = L.divIcon({ html: markerHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });

        L.marker([station.lat, station.lon], { icon, stationId: station.id })
            .bindPopup(`<b>Parada ${index + 1}: ${station.name}</b><br>${station.address}<br>Precio: ${station.prices[form.elements['fuel-type'].value].toFixed(3)} €/L`)
            .addTo(stationMarkers);
    });

    // Añadir botón para ruta manual
    const manualRouteContainer = document.createElement('div');
    manualRouteContainer.className = 'mt-2 d-grid';
    manualRouteContainer.innerHTML = `
        <button id="manual-route-btn" class="btn btn-info">
            <i class="bi bi-list-check me-2"></i>
            Buscar Paradas Manuales
        </button>
    `;
    resultsDiv.appendChild(manualRouteContainer);

    // Event listener para el botón de ruta manual
    document.getElementById('manual-route-btn').addEventListener('click', () => {
        showSpinner();
        // Usar setTimeout para permitir que el spinner se muestre antes de procesar
        setTimeout(() => {
            showManualRouteOptions(origin, destination);
            hideSpinner();
        }, 100);
    });


}
