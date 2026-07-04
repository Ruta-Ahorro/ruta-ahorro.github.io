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

// Llamadas a Nominatim: fetch directo (soporta CORS) con proxy como respaldo.
// No se envían cabeceras como User-Agent o Referer: son cabeceras prohibidas
// que el navegador ignora y solo provocan preflights CORS innecesarios.
async function fetchNominatim(url, options = {}) {
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Accept': 'application/json',
                ...options.headers
            }
        });
        if (response.ok) {
            return response;
        }
        throw new Error(`Nominatim respondió con estado ${response.status}`);
    } catch (error) {
        console.warn('Fetch directo a Nominatim falló, usando proxy CORS:', error);
        const proxiedUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
        return await fetch(proxiedUrl, { headers: { 'Accept': 'application/json' } });
    }
}
let map;
let routeLayer;
let stationMarkers = L.layerGroup();
let allGasStations = [];
let currentRouteData = null; // Para almacenar datos de la ruta actual
let currentRouteStations = []; // Para almacenar gasolineras de la ruta actual
let manualSearchBtn; // Declarar como variable global
let autoSearchPending = false; // Ruta compartida por URL pendiente de buscar

// Campos del API del Ministerio → claves cortas internas de precios
const API_PRICE_FIELDS = {
    GA: 'Precio Gasoleo A',
    G95E5: 'Precio Gasolina 95 E5',
    G98E5: 'Precio Gasolina 98 E5',
    GP: 'Precio Gasoleo Premium',
    GB: 'Precio Gasoleo B',
    GLP: 'Precio Gases licuados del petróleo',
    GNC: 'Precio Gas Natural Comprimido',
    GNL: 'Precio Gas Natural Licuado'
};

// --- Persistencia de configuración del usuario ---
const SETTINGS_KEY = 'rutaAhorroSettings';
const SETTING_IDS = ['fuel-type', 'tank-capacity', 'consumption', 'current-fuel', 'final-fuel', 'search-radius', 'include-restricted'];

function saveSettings() {
    const settings = {};
    for (const id of SETTING_IDS) {
        const el = document.getElementById(id);
        settings[id] = el.type === 'checkbox' ? el.checked : el.value;
    }
    const algo = document.querySelector('input[name="algorithm"]:checked');
    if (algo) settings.algorithm = algo.value;
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* almacenamiento no disponible: ignorar */ }
}

function loadSettings() {
    let settings = null;
    try {
        settings = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    } catch (e) { /* JSON corrupto: ignorar */ }
    if (!settings) return;

    for (const id of SETTING_IDS) {
        if (!(id in settings)) continue;
        const el = document.getElementById(id);
        if (el.type === 'checkbox') {
            el.checked = !!settings[id];
        } else {
            el.value = settings[id];
            // Si el valor guardado ya no existe (p. ej. opciones renombradas),
            // volver a la primera opción en vez de dejar el select vacío.
            if (el.tagName === 'SELECT' && el.value !== String(settings[id])) {
                el.selectedIndex = 0;
            }
        }
    }
    if (settings.algorithm) {
        const radio = document.querySelector(`input[name="algorithm"][value="${settings.algorithm}"]`);
        if (radio) radio.checked = true;
    }
    // Sincronizar las etiquetas de los sliders con los valores restaurados
    currentFuelLabel.textContent = `${currentFuelSlider.value}%`;
    finalFuelLabel.textContent = `${finalFuelSlider.value}%`;
    searchRadiusLabel.textContent = searchRadiusSlider.value;
}

// --- Rutas compartibles: ?origen=...&destino=... ---
function updateShareUrl(origin, destination) {
    const params = new URLSearchParams({ origen: origin, destino: destination });
    history.replaceState(null, '', `${location.pathname}?${params}`);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Verificación de permisos deshabilitada temporalmente - causaba problemas en Android
    // checkInitialGeolocationPermissions();

    // Mostrar botón de permisos en Android automáticamente
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isMobile = isMobileDevice();
    if (isAndroid && isMobile) {
        const permissionHelper = document.getElementById('permission-helper');
        if (permissionHelper) {
            permissionHelper.classList.remove('d-none');
        }
    }

    manualSearchBtn = document.getElementById('manual-search-button');

    // Deshabilitar inmediatamente hasta que se carguen las gasolineras
    if (manualSearchBtn) {
        manualSearchBtn.disabled = true;
        manualSearchBtn.classList.add('disabled');
    }

    // Restaurar la configuración guardada y guardarla en cada cambio
    loadSettings();
    form.addEventListener('change', saveSettings);
    settingsPanel.addEventListener('change', saveSettings);

    // Ruta compartida por URL: rellenar y buscar cuando carguen los datos
    const urlParams = new URLSearchParams(location.search);
    const sharedOrigin = urlParams.get('origen');
    const sharedDestination = urlParams.get('destino');
    if (sharedOrigin && sharedDestination) {
        originInput.value = sharedOrigin;
        destinationInput.value = sharedDestination;
        autoSearchPending = true;
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
    
    // Event listener para el botón de solicitar permisos
    const requestPermissionBtn = document.getElementById('request-permission-btn');
    if (requestPermissionBtn) {
        requestPermissionBtn.addEventListener('click', async () => {
            console.log('Solicitando permisos explícitamente...');
            requestPermissionBtn.disabled = true;
            requestPermissionBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Solicitando...';
            
            try {
                const hasPermission = await forceLocationPermissionRequest();
                if (hasPermission) {
                    alert('✅ Permisos concedidos. Ahora puedes usar el botón de ubicación.');
                    document.getElementById('permission-helper').classList.add('d-none');
                } else {
                    alert('❌ Permisos denegados. Ve a configuración del navegador para activarlos manualmente.');
                }
            } catch (error) {
                console.error('Error al solicitar permisos:', error);
                alert('Error al solicitar permisos. Intenta desde configuración del navegador.');
            } finally {
                requestPermissionBtn.disabled = false;
                requestPermissionBtn.innerHTML = '<i class="bi bi-shield-check"></i> Solicitar permisos de ubicación';
            }
        });
    }
    
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
        manualSearchBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            // Verificar si el botón está deshabilitado
            if (manualSearchBtn.disabled || manualSearchBtn.classList.contains('disabled')) {
                return;
            }

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
    const originText = originInput.value.trim();
    const destinationText = destinationInput.value.trim();

    if (!originText || !destinationText) {
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

        // URL compartible con la ruta calculada
        updateShareUrl(originText, destinationText);

        hideSpinner();

        // Calcular estaciones más baratas directamente aquí
        const cheapestStations = getCheapestStationsOnRoute(
            routeLine,
            params,
            allGasStations,
            originText,
            destinationText
        );

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
function setupAutocomplete(inputEl, suggestionsEl) {
    let debounceTimer; // temporizador propio de cada campo

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

    // Navegación con teclado: flechas para moverse, Enter para elegir, Escape para cerrar
    inputEl.addEventListener('keydown', (e) => {
        if (suggestionsEl.classList.contains('d-none')) return;
        const items = [...suggestionsEl.querySelectorAll('.list-group-item')];
        if (items.length === 0) return;

        const activeIndex = items.findIndex(item => item.classList.contains('active'));

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = e.key === 'ArrowDown'
                ? (activeIndex + 1) % items.length
                : (activeIndex - 1 + items.length) % items.length;
            items.forEach(item => item.classList.remove('active'));
            items[next].classList.add('active');
            items[next].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault(); // no enviar el formulario al elegir sugerencia
            items[activeIndex].click();
        } else if (e.key === 'Escape') {
            suggestionsEl.classList.add('d-none');
        }
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

    // Opciones para FORZAR la petición de permisos en Android
    const options = {
        enableHighAccuracy: true, // Esto fuerza la petición de permisos
        timeout: 20000, // Más tiempo para que el usuario pueda responder
        maximumAge: 0 // NUNCA usar cache - siempre pedir nueva ubicación
    };

    console.log('Solicitando ubicación con opciones:', options);

    navigator.geolocation.getCurrentPosition(async (position) => {
        console.log('Ubicación obtenida:', position.coords);
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
                console.log('No se pudo encontrar la dirección. Se usarán las coordenadas.');
            }
        } catch (err) {
            console.error('Reverse geocoding error:', err);
            originInput.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            console.log('No se pudo encontrar la dirección. Se usarán las coordenadas.');
        } finally {
            locateBtn.disabled = false;
            locateBtn.innerHTML = originalBtnContent;
        }
    }, (error) => {
        console.error('Error de geolocalización:', error);
        let message;
        
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = "⚠️ Permisos denegados.\n\nPara activar:\n• Toca el 🔒 en la barra de direcciones\n• Selecciona 'Permitir' para Ubicación\n• O ve a Configuración > Sitios web > Permisos";
                break;
            case error.POSITION_UNAVAILABLE:
                message = "📍 GPS no disponible.\n\n• Activa la ubicación en tu dispositivo\n• Sal al exterior para mejor señal";
                break;
            case error.TIMEOUT:
                message = "⏱️ Tiempo agotado.\n\n• Verifica que el GPS esté activo\n• Intenta de nuevo en unos segundos";
                break;
            default:
                message = "❌ Error de ubicación.\n\nVerifica los permisos de ubicación.";
                break;
        }
        
        alert(message);
        locateBtn.disabled = false;
        locateBtn.innerHTML = originalBtnContent;
    }, options);
}

// Función para verificar permisos de geolocalización
async function checkGeolocationPermission() {
    if (!navigator.permissions) {
        // Si no hay API de permisos, asumir que está disponible
        return true;
    }
    
    try {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        console.log('Estado de permisos de geolocalización:', permission.state);
        return permission.state === 'granted' || permission.state === 'prompt';
    } catch (error) {
        console.warn('No se pudo verificar permisos de geolocalización:', error);
        // Si hay error verificando permisos, intentar de todas formas
        return true;
    }
}

// Función para forzar la petición de permisos en Android
function forceLocationPermissionRequest() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocalización no soportada'));
            return;
        }

        // Configuración específica para FORZAR la petición de permisos
        const options = {
            enableHighAccuracy: true, // Esto dispara la petición de permisos
            timeout: 1000, // Muy corto para fallar rápido si no hay permisos
            maximumAge: 0 // Nunca usar cache
        };

        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('Permisos concedidos, ubicación obtenida');
                resolve(true);
            },
            (error) => {
                if (error.code === error.PERMISSION_DENIED) {
                    console.log('Permisos denegados por el usuario');
                    resolve(false);
                } else {
                    console.log('Error temporal, permisos probablemente disponibles');
                    resolve(true);
                }
            },
            options
        );
    });
}

// Función para mostrar mensajes toast (si no existe)
function showToast(message, type = 'info') {
    // Si no hay sistema de toast, usar alert como fallback
    if (typeof bootstrap === 'undefined' || !bootstrap.Toast) {
        console.log(`${type.toUpperCase()}: ${message}`);
        return;
    }
    
    // Crear toast si bootstrap está disponible
    const toastContainer = document.getElementById('toast-container') || createToastContainer();
    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-bg-${type} border-0`;
    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    toastContainer.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
    
    // Limpiar después de mostrar
    toastEl.addEventListener('hidden.bs.toast', () => {
        toastEl.remove();
    });
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    container.style.zIndex = '1055';
    document.body.appendChild(container);
    return container;
}

// Función para verificar permisos al cargar la página
async function checkInitialGeolocationPermissions() {
    if (!navigator.geolocation) {
        return;
    }

    const isMobile = isMobileDevice();
    const isAndroid = /Android/i.test(navigator.userAgent);
    
    if (isMobile && isAndroid) {
        try {
            const permission = await navigator.permissions.query({ name: 'geolocation' });
            const hintElement = document.getElementById('location-permission-hint');
            
            if (permission.state === 'denied') {
                console.log('Permisos de geolocalización denegados');
                if (hintElement) {
                    hintElement.textContent = '⚠️ Permisos de ubicación denegados. Actívalos en configuración para usar tu ubicación.';
                    hintElement.classList.remove('d-none');
                    hintElement.classList.add('text-warning');
                }
            } else if (permission.state === 'prompt') {
                console.log('Permisos de geolocalización pendientes');
                if (hintElement) {
                    hintElement.textContent = '💡 Toca el botón de ubicación para permitir el acceso a tu posición.';
                    hintElement.classList.remove('d-none');
                    hintElement.classList.add('text-info');
                }
            } else if (permission.state === 'granted') {
                console.log('Permisos de geolocalización concedidos');
            }
            
            // Escuchar cambios en los permisos
            permission.onchange = () => {
                console.log('Cambio en permisos de geolocalización:', permission.state);
                if (permission.state === 'granted' && hintElement) {
                    hintElement.classList.add('d-none');
                }
            };
            
        } catch (error) {
            console.warn('No se pudo verificar permisos de geolocalización:', error);
        }
    }
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
 * Carga los datos de gasolineras.
 * 1º intenta el JSON estático del propio sitio (actualizado por GitHub Actions,
 *    sin CORS ni proxies de terceros).
 * 2º como respaldo, llama a la API del Ministerio a través de un proxy CORS.
 */
async function fetchGasStations() {
    showSpinner();
    searchButton.disabled = true;
    searchButton.classList.add('disabled');

    // Deshabilitar botón de búsqueda manual también
    if (manualSearchBtn) {
        manualSearchBtn.disabled = true;
        manualSearchBtn.classList.add('disabled');
    }

    const localDataUrl = '/data/estaciones.json';
    const apiUrl = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

    try {
        let jsonData = null;
        let dataDate = null;

        // 1. Datos estáticos del propio sitio (formato interno pre-procesado)
        try {
            const response = await fetch(localDataUrl);
            if (response.ok) {
                jsonData = await response.json();
            }
        } catch (error) {
            console.warn('No se pudieron cargar los datos estáticos locales:', error);
        }

        if (jsonData && Array.isArray(jsonData.estaciones)) {
            // Formato interno: ya viene con números y claves cortas
            allGasStations = jsonData.estaciones;
            dataDate = jsonData.fecha;
        } else {
            // 2. Respaldo: API del Ministerio (formato crudo) vía proxy CORS
            console.warn('Usando la API del Ministerio vía proxy CORS como respaldo...');
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

            jsonData = await response.json();

            if (!jsonData || !Array.isArray(jsonData.ListaEESSPrecio)) {
                throw new Error('Datos de gasolineras no válidos recibidos');
            }

            allGasStations = jsonData.ListaEESSPrecio
                .map(s => ({
                    id: s['IDEESS'], name: s['Rótulo'], address: `${s['Dirección']}, ${s['Localidad']}`,
                    lat: parseFloat(s['Latitud'].replace(',', '.')), lon: parseFloat(s['Longitud (WGS84)'].replace(',', '.')),
                    tipoVenta: s['Tipo Venta'],
                    horario: s['Horario'],
                    prices: Object.fromEntries(
                        Object.entries(API_PRICE_FIELDS).map(([key, field]) =>
                            [key, parseFloat((s[field] || '').replace(',', '.')) || null]
                        )
                    )
                })).filter(s => s.lat && s.lon);
            dataDate = jsonData.Fecha;
        }

        console.log(`Cargadas ${allGasStations.length} gasolineras.`);

        // Mostrar la fecha y hora de los precios en el pie del sidebar
        const dataDateEl = document.getElementById('data-date');
        if (dataDateEl && dataDate) {
            // El API devuelve "dd/mm/aaaa h:mm:ss"; mostrar sin segundos
            const [datePart, timePart] = String(dataDate).split(' ');
            const time = timePart ? ` · ${timePart.split(':').slice(0, 2).join(':')}h` : '';
            dataDateEl.textContent = `Precios actualizados: ${datePart}${time}`;
        }

        showMessage('info', 'Datos cargados. ¡Listo para buscar tu ruta!');
        searchButton.disabled = false;
        searchButton.classList.remove('disabled');

        // Habilitar botón de búsqueda manual también
        if (manualSearchBtn) {
            manualSearchBtn.disabled = false;
            manualSearchBtn.classList.remove('disabled');
        }

        // Si llegó una ruta compartida por URL, lanzarla ahora
        if (autoSearchPending) {
            autoSearchPending = false;
            form.requestSubmit(searchButton);
        }

    } catch (error) {
        console.error("Error cargando gasolineras:", error);
        showMessage('error', 'Error de conexión: No se pudieron cargar los datos de las gasolineras del gobierno. El servicio puede estar temporalmente caído.');
        // Botón para reintentar sin recargar la página
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'btn btn-outline-primary btn-sm mt-2';
        retryBtn.textContent = 'Reintentar';
        retryBtn.addEventListener('click', fetchGasStations);
        messageContent.appendChild(retryBtn);
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

                // URL compartible con la ruta calculada
                updateShareUrl(origin, destination);

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

    // Crear bounding box buffeado
    const routeBbox = turf.bbox(routeLine);
    const bufferedBboxPolygon = turf.buffer(turf.bboxPolygon(routeBbox), searchRadius, { units: 'kilometers' });

    // Filtrar estaciones dentro del bounding box
    candidateStations = candidateStations.filter(station => {
        const point = turf.point([station.lon, station.lat]);
        return turf.booleanPointInPolygon(point, bufferedBboxPolygon);
    });

    // Filtrado detallado (conservando la distancia a la ruta para mostrarla)
    const originPoint = turf.point(routeLine.geometry.coordinates[0]);

    const stationsOnRoute = candidateStations
        .map(station => {
            const point = turf.point([station.lon, station.lat]);
            const distanceToRoute = turf.pointToLineDistance(point, routeLine, { units: 'kilometers' });
            return { station, distanceToRoute };
        })
        .filter(({ distanceToRoute }) => distanceToRoute <= searchRadius)
        .map(({ station, distanceToRoute }) => {
            const stationPoint = turf.point([station.lon, station.lat]);
            const nearestPointOnRoute = turf.nearestPointOnLine(routeLine, stationPoint);
            const distanceFromStart = turf.distance(originPoint, nearestPointOnRoute, { units: 'kilometers' });

            return { ...station, distanceFromStart, distanceToRoute };
        });

    const finalStations = stationsOnRoute
        .sort((a, b) => a.prices[fuelType] - b.prices[fuelType]) // Ordenar por precio
        .slice(0, 15) // Tomar las 15 más baratas
        .sort((a, b) => a.distanceFromStart - b.distanceFromStart); // Ordenar por distancia desde origen

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
    } else {
        // Calcular estaciones (flujo original)
        cheapestStations = getCheapestStationsOnRoute(
            currentRouteData.routeLine,
            currentRouteData.params,
            allGasStations,
            origin,
            destination
        );
    }

    if (cheapestStations.length === 0) {
        alert('No se encontraron gasolineras baratas en la ruta. Intenta aumentar la distancia de búsqueda en la configuración.');
        return;
    }

    // Limpiar contenido anterior
    resultsDiv.innerHTML = '';

    // Mostrar contenedor de resultados y ocultar mensaje
    messageContainer.classList.add('d-none');
    resultsContainer.classList.remove('d-none');

    // Ocultar el formulario principal
    form.classList.add('d-none');

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

    // Lista de estaciones con checkboxes
    const stationsContainer = document.createElement('div');
    stationsContainer.id = 'manual-stations-container';

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
                    <label class="form-check-label fw-bold station-name" for="station-${index}">${station.name}</label>
                    <p class="small text-body-secondary fw-bold mb-1">${station.horario}
                    <span class="small text-muted">Km ${Math.round(station.distanceFromStart)}${station.distanceToRoute != null ? ` · a ${station.distanceToRoute.toFixed(1)} km de la ruta` : ''}</span></p>
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

    // Resumen del viaje
    const totalLiters = stops.reduce((total, stop) => total + stop.refuelAmount, 0);
    const summary = document.createElement('div');
    summary.className = 'p-2 bg-body-tertiary border rounded-3 mb-2 small';
    summary.innerHTML = `
        <div class="d-flex justify-content-between"><span>Distancia</span><span class="fw-bold">${Math.round(currentRouteData?.routeDistance || 0)} km</span></div>
        <div class="d-flex justify-content-between"><span>Paradas</span><span class="fw-bold">${stops.length}</span></div>
        <div class="d-flex justify-content-between"><span>Combustible a repostar</span><span class="fw-bold">${totalLiters.toFixed(1)} L</span></div>
        <div class="d-flex justify-content-between"><span>Coste total</span><span class="fw-bold">${results.optimalCost.toFixed(2)} €</span></div>
    `;
    resultsDiv.appendChild(summary);

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
                    <p class="fw-bold station-name">Parada ${index + 1}: ${station.name}</p>
                    <p class="fw-bold small text-body-secondary">${station.horario}</p>
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
