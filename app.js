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

// --- Spinner Control ---
function showSpinner() {
    spinnerOverlay.classList.remove('d-none');
}

function hideSpinner() {
    spinnerOverlay.classList.add('d-none');
}

// Escapa texto que viene de fuera (rótulos y direcciones del Ministerio, datos
// de OpenChargeMap editables por cualquiera, mensajes de error) antes de
// insertarlo como HTML, para que nunca pueda interpretarse como marcado.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

// Detectar si es dispositivo móvil
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform));
}

// Llamadas a Nominatim: fetch directo (soporta CORS), sin proxies de terceros,
// porque estas peticiones llevan las direcciones que escribe el usuario y sus
// coordenadas GPS. Si Nominatim falla, quien llama muestra el error.
// No se envían cabeceras como User-Agent o Referer: son cabeceras prohibidas
// que el navegador ignora y solo provocan preflights CORS innecesarios.
function fetchNominatim(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: {
            'Accept': 'application/json',
            ...options.headers
        }
    });
}
let map;
let routeLayer;
let stationMarkers = L.layerGroup();
let allGasStations = [];
let allChargers = [];        // Puntos de carga eléctrica (se cargan al activar el modo EV)
let chargersLoading = null;  // Promise de carga en curso para no pedirlos dos veces
let currentRouteData = null; // Para almacenar datos de la ruta actual
let hasRestrictedStations = false; // ¿Los datos traen estaciones de venta restringida?
let manualSearchBtn; // Declarar como variable global
let autoSearchPending = false; // Ruta compartida por URL pendiente de buscar

// Campos del API del Ministerio → claves cortas internas de precios
const API_PRICE_FIELDS = {
    ADBLUE: 'Precio Adblue',
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
const SETTING_IDS = [
    'fuel-type', 'tank-capacity', 'consumption', 'current-fuel', 'final-fuel',
    'search-radius', 'include-restricted', 'adblue-filter',
    'ev-battery', 'ev-consumption', 'min-charge-power',
    'ev-tariff', 'ev-max-charge', 'slow-charge-dest'
];

function saveSettings() {
    const settings = {};
    for (const id of SETTING_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        settings[id] = el.type === 'checkbox' ? el.checked : el.value;
    }
    const algo = document.querySelector('input[name="algorithm"]:checked');
    if (algo) settings.algorithm = algo.value;
    const mode = document.querySelector('input[name="vehicle-mode"]:checked');
    if (mode) settings.vehicleMode = mode.value;
    settings.discounts = getDiscounts();
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
        if (!el) continue;
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
    if (Array.isArray(settings.discounts)) {
        settings.discounts.forEach(d => addDiscountRow(d.brand, d.cents));
    }
    if (settings.vehicleMode === 'ev') {
        const evRadio = document.getElementById('mode-ev');
        if (evRadio) evRadio.checked = true;
    }
    // Sincronizar las etiquetas de los sliders con los valores restaurados
    currentFuelLabel.textContent = `${currentFuelSlider.value}%`;
    finalFuelLabel.textContent = `${finalFuelSlider.value}%`;
    searchRadiusLabel.textContent = searchRadiusSlider.value;
}

// --- Modo de vehículo (combustión / eléctrico) ---
function getVehicleMode() {
    return document.querySelector('input[name="vehicle-mode"]:checked')?.value || 'gas';
}

function setVehicleMode(mode) {
    const isEV = mode === 'ev';
    document.getElementById('gas-fields').classList.toggle('d-none', isEV);
    document.getElementById('ev-fields').classList.toggle('d-none', !isEV);
    document.querySelectorAll('.gas-only').forEach(el => el.classList.toggle('d-none', isEV));
    document.querySelectorAll('.ev-only').forEach(el => el.classList.toggle('d-none', !isEV));
    document.getElementById('current-fuel-name').textContent = isEV ? 'Batería actual' : 'Combustible actual';
    document.getElementById('final-fuel-name').textContent = isEV ? 'Batería en destino' : 'Combustible final';
    updateRestrictedOption();
    if (isEV) fetchChargers(); // carga perezosa de los puntos de carga
}

// "Incluir gasolineras restringidas" solo tiene sentido si los datos cargados
// traen alguna estación de venta restringida (tipo R). Si no hay ninguna, la
// opción no haría nada y se oculta.
function updateRestrictedOption() {
    const option = document.getElementById('restricted-option');
    if (option) option.classList.toggle('d-none', getVehicleMode() === 'ev' || !hasRestrictedStations);
}

// --- Descuentos por marca (suscripciones / tarjetas) ---
function addDiscountRow(brand = '', cents = '') {
    const container = document.getElementById('discounts-container');
    const row = document.createElement('div');
    row.className = 'input-group input-group-sm mb-1 discount-row';
    row.innerHTML = `
        <input type="text" class="form-control discount-brand" placeholder="Marca (ej. REPSOL)" aria-label="Marca">
        <input type="number" class="form-control discount-cents" placeholder="cts/L" aria-label="Descuento en céntimos por litro" step="0.1" min="0" style="max-width: 6rem;">
        <button type="button" class="btn btn-outline-danger discount-remove" aria-label="Quitar descuento">&times;</button>
    `;
    row.querySelector('.discount-brand').value = brand;
    row.querySelector('.discount-cents').value = cents;
    row.querySelector('.discount-remove').addEventListener('click', () => {
        row.remove();
        saveSettings();
    });
    container.appendChild(row);
}

function getDiscounts() {
    return [...document.querySelectorAll('.discount-row')]
        .map(row => ({
            brand: row.querySelector('.discount-brand').value.trim(),
            cents: parseFloat(row.querySelector('.discount-cents').value) || 0
        }))
        .filter(d => d.brand && d.cents > 0);
}

// Devuelve una copia de las estaciones con los descuentos aplicados al
// combustible seleccionado (coincidencia por texto contenido en el rótulo).
function applyDiscounts(stations, fuelType) {
    const discounts = getDiscounts();
    if (discounts.length === 0) return stations;
    return stations.map(s => {
        const rule = discounts.find(d => (s.name || '').toUpperCase().includes(d.brand.toUpperCase()));
        if (!rule || !s.prices[fuelType]) return s;
        return {
            ...s,
            prices: { ...s.prices, [fuelType]: Math.max(0, s.prices[fuelType] - rule.cents / 100) }
        };
    });
}

// --- Rutas compartibles: ?origen=...&destino=...&paradas=a|b&modo=ev ---
// Referencia al replaceState original, capturada antes de que se cargue
// ningún script de terceros. La analítica (si se acepta) puede envolver
// history.replaceState para registrar cambios de URL; usando el original, el
// origen y el destino que se escriben en la URL nunca le llegan.
const nativeReplaceState = history.replaceState.bind(history);

function updateShareUrl(origin, destination) {
    const params = new URLSearchParams({ origen: origin, destino: destination });
    const waypoints = getWaypointValues();
    if (waypoints.length > 0) params.set('paradas', waypoints.join('|'));
    if (getVehicleMode() === 'ev') params.set('modo', 'ev');
    // Coordenadas de los puntos elegidos en el autocompletado, para que quien
    // abra el enlace obtenga exactamente los mismos lugares.
    const coords = getActiveRouteInputs().map(el => {
        const c = getInputCoords(el);
        return c ? `${c.lat.toFixed(5)},${c.lon.toFixed(5)}` : '';
    });
    if (coords.some(Boolean)) params.set('coords', coords.join(';'));
    nativeReplaceState(null, '', `${location.pathname}?${params}`);
}

// --- Puntos de la ruta (origen, paradas y destino, reordenables) ---

// Todos los puntos de la ruta en el orden visual actual (arrastrable):
// el primero actúa como origen y el último como destino.
function getOrderedRouteInputs() {
    return [...document.querySelectorAll('#route-points .route-input')];
}

// Puntos que cuentan para la ruta: origen, destino y las paradas con texto
function getActiveRouteInputs() {
    return getOrderedRouteInputs().filter((el, i, all) => i === 0 || i === all.length - 1 || el.value.trim());
}

// Coordenadas conocidas de un punto (elegido en el autocompletado, obtenido
// del GPS o recibido en un enlace compartido). Se guardan en el propio campo
// y solo valen mientras su texto no cambie.
function setInputCoords(input, lat, lon) {
    input.dataset.lat = lat;
    input.dataset.lon = lon;
    input.dataset.coordsFor = input.value.trim();
}

function getInputCoords(input) {
    const { lat, lon, coordsFor } = input.dataset;
    if (lat === undefined || lon === undefined || coordsFor !== input.value.trim()) return null;
    return { lat: parseFloat(lat), lon: parseFloat(lon) };
}

// Coordenadas de todos los puntos de la ruta, en orden. Los que ya las traen
// no se geocodifican; el resto se busca en Nominatim por su texto.
function geocodeRoutePoints() {
    return Promise.all(getActiveRouteInputs().map(el => getInputCoords(el) || geocodeAddress(el.value.trim())));
}

// Textos de la ruta según el orden visual actual
function getRouteTexts() {
    const values = getOrderedRouteInputs().map(el => el.value.trim());
    return {
        origin: values[0] || '',
        destination: values[values.length - 1] || '',
        waypoints: values.slice(1, -1).filter(Boolean)
    };
}

// Invierte la ruta completa: origen ⇄ destino y paradas en orden inverso
function invertRoute() {
    const inputs = getOrderedRouteInputs();
    const COORD_KEYS = ['lat', 'lon', 'coordsFor'];
    const snapshot = inputs.map(el => ({ value: el.value, data: COORD_KEYS.map(k => el.dataset[k]) })).reverse();
    inputs.forEach((el, i) => {
        el.value = snapshot[i].value;
        // Las coordenadas conocidas viajan con su texto
        COORD_KEYS.forEach((k, j) => {
            if (snapshot[i].data[j] === undefined) delete el.dataset[k];
            else el.dataset[k] = snapshot[i].data[j];
        });
    });
}

// El primer punto de la lista siempre se presenta como origen y el último
// como destino, independientemente de cómo se hayan arrastrado las filas.
function updateRoutePointLabels() {
    const rows = [...document.querySelectorAll('#route-points .route-point')];
    rows.forEach((row, i) => {
        const input = row.querySelector('.route-input');
        const label = i === 0 ? 'Origen' : (i === rows.length - 1 ? 'Destino' : 'Parada');
        input.placeholder = label;
        input.setAttribute('aria-label', label);
    });
}

function addWaypointInput(value = '') {
    const container = document.getElementById('route-points');
    const destinationPoint = document.getElementById('destination-point');
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-2 position-relative route-point waypoint-wrapper';
    wrapper.innerHTML = `
        <div class="input-group">
            <span class="input-group-text drag-handle" title="Arrastrar para reordenar"><i class="bi bi-grip-vertical" aria-hidden="true"></i></span>
            <input type="text" class="form-control route-input waypoint-input" placeholder="Parada" aria-label="Parada" autocomplete="off">
            <button type="button" class="btn btn-outline-danger waypoint-remove" aria-label="Quitar parada">&times;</button>
        </div>
        <div class="position-absolute z-3 w-100 bg-body border border-secondary-subtle rounded-bottom mt-1 d-none shadow-lg list-group waypoint-suggestions"></div>
    `;
    const input = wrapper.querySelector('.waypoint-input');
    input.value = value;
    wrapper.querySelector('.waypoint-remove').addEventListener('click', () => {
        wrapper.remove();
        updateRoutePointLabels();
    });
    // Insertar antes del destino (que ocupa la última posición por defecto)
    container.insertBefore(wrapper, destinationPoint);
    setupAutocomplete(input, wrapper.querySelector('.waypoint-suggestions'));
    updateRoutePointLabels();
    return input;
}

function getWaypointValues() {
    return getRouteTexts().waypoints;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
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
    setVehicleMode(getVehicleMode());
    form.addEventListener('change', saveSettings);
    settingsPanel.addEventListener('change', saveSettings);

    // Conmutador combustión / eléctrico
    document.querySelectorAll('input[name="vehicle-mode"]').forEach(radio => {
        radio.addEventListener('change', () => setVehicleMode(getVehicleMode()));
    });

    // Paradas intermedias y descuentos
    document.getElementById('add-waypoint-btn').addEventListener('click', () => addWaypointInput().focus());
    document.getElementById('invert-route-btn').addEventListener('click', invertRoute);
    document.getElementById('add-discount-btn').addEventListener('click', () => addDiscountRow());

    // Reordenar los puntos de la ruta arrastrando el asa (también en táctil).
    // Tras cada arrastre, el primer punto pasa a etiquetarse como origen y el
    // último como destino.
    if (window.Sortable) {
        new Sortable(document.getElementById('route-points'), {
            handle: '.drag-handle',
            animation: 150,
            onEnd: updateRoutePointLabels
        });
    }

    // Búsqueda alrededor de la ubicación actual
    document.getElementById('nearby-btn').addEventListener('click', handleNearbySearch);

    // Enlaces de navegación (Google Maps, Waze, Apple Maps, "cómo llegar").
    // Son botones con data-open-url en vez de <a href>: la analítica registra
    // automáticamente la URL de los enlaces salientes, y estas URL llevan el
    // origen, el destino y coordenadas.
    resultsDiv.addEventListener('click', (e) => {
        const el = e.target.closest('[data-open-url]');
        if (el) window.open(el.dataset.openUrl, '_blank', 'noopener,noreferrer');
    });

    // Ruta compartida por URL: rellenar y buscar cuando carguen los datos
    const urlParams = new URLSearchParams(location.search);
    const sharedOrigin = urlParams.get('origen');
    const sharedDestination = urlParams.get('destino');
    if (urlParams.get('modo') === 'ev') {
        document.getElementById('mode-ev').checked = true;
        setVehicleMode('ev');
    }
    if (urlParams.get('paradas')) {
        urlParams.get('paradas').split('|').filter(Boolean).forEach(p => addWaypointInput(p));
    }
    if (sharedOrigin && sharedDestination) {
        originInput.value = sharedOrigin;
        destinationInput.value = sharedDestination;
        autoSearchPending = true;

        // Coordenadas que acompañan al enlace (una por punto, en orden)
        const sharedCoords = (urlParams.get('coords') || '').split(';');
        getActiveRouteInputs().forEach((el, i) => {
            const [lat, lon] = (sharedCoords[i] || '').split(',').map(Number);
            if (sharedCoords[i] && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) setInputCoords(el, lat, lon);
        });
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
        // Sugerencias de las paradas intermedias
        document.querySelectorAll('.waypoint-wrapper').forEach(wrapper => {
            if (!wrapper.contains(e.target)) {
                wrapper.querySelector('.waypoint-suggestions').classList.add('d-none');
            }
        });
    });

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
    // El orden visual manda: primer punto = origen, último = destino
    const { origin: originText, destination: destinationText, waypoints: waypointTexts } = getRouteTexts();

    if (!originText || !destinationText) {
        showMessage('error', 'Por favor, introduce tanto el origen como el destino antes de buscar paradas manuales.');
        return;
    }

    showSpinner();

    try {
        const params = getEffectiveParams();
        validateParams(params);
        const stations = await getActiveStations(params);

        // Geocodificar origen, paradas intermedias y destino
        let points;
        try {
            points = await geocodeRoutePoints();
        } catch (e) {
            throw new Error("Error de conexión con el servicio de mapas (Nominatim) al buscar direcciones.");
        }

        if (points.some(p => !p)) {
            throw new Error("No se pudieron geolocalizar todas las direcciones. Intenta ser más específico o revisa tu conexión.");
        }
        const destCoords = points[points.length - 1];

        // Obtener ruta
        let routeData;
        try {
            routeData = await getRoute(points);
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

        // Posición de las paradas intermedias sobre la ruta
        const routeIndex = buildRouteIndex(routeLine);
        const waypointCoords = points.slice(1, -1).map(p => {
            // Posición a lo largo de la ruta, no en línea recta desde el origen
            const { distanceFromStart } = locateOnRoute(routeIndex, p.lon, p.lat);
            return { lat: p.lat, lon: p.lon, distanceFromStart };
        });

        // Almacenar datos para ruta manual
        currentRouteData = {
            routeLine: routeLine,
            routeDistance: routeDistance,
            origin: originText,
            destination: destinationText,
            destCoords: destCoords,
            waypoints: waypointCoords,
            params: params,
            stations: stations
        };

        // URL compartible con la ruta calculada
        updateShareUrl(originText, destinationText);

        hideSpinner();

        // Calcular estaciones más baratas directamente aquí
        const cheapestStations = getCheapestStationsOnRoute(
            routeLine,
            params,
            stations,
            originText,
            destinationText
        );

        if (cheapestStations.length === 0) {
            showMessage('error', params.mode === 'ev'
                ? 'No se encontraron puntos de carga en la ruta. Prueba a bajar la potencia mínima o aumentar la distancia de búsqueda.'
                : 'No se encontraron gasolineras baratas en la ruta. Intenta aumentar la distancia de búsqueda en la configuración.');
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

// Sugerencias de lugares mientras se escribe. Se usa Photon (komoot), un
// buscador sobre datos de OpenStreetMap pensado para autocompletado: la
// política de uso de Nominatim prohíbe usarlo para esto.
const PHOTON_URL = 'https://photon.komoot.io/api/';
const SPAIN_BBOX = '-18.5,27.4,4.6,43.9'; // península, Baleares y Canarias

function photonLabel(props) {
    const street = [props.street, props.housenumber].filter(Boolean).join(' ');
    const town = props.city || props.town || props.village || props.county;
    return [...new Set([props.name, street, town, props.state].filter(Boolean))].join(', ');
}

async function fetchSuggestions(query, suggestionsEl, inputEl) {
    try {
        const apiUrl = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=10&bbox=${SPAIN_BBOX}`;
        const response = await fetch(apiUrl);
        // Si mientras tanto el texto ha cambiado, esta respuesta ya no sirve
        if (!response.ok || inputEl.value !== query) {
            suggestionsEl.classList.add('d-none');
            return;
        }

        const data = await response.json();
        const seen = new Set();
        const suggestions = (data.features || [])
            .filter(f => f.properties && f.properties.countrycode === 'ES' && f.geometry && Array.isArray(f.geometry.coordinates))
            .map(f => ({ label: photonLabel(f.properties), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
            .filter(place => place.label && !seen.has(place.label) && seen.add(place.label))
            .slice(0, 5);

        suggestionsEl.innerHTML = '';
        if (suggestions.length === 0) {
            suggestionsEl.classList.add('d-none');
            return;
        }

        suggestions.forEach(place => {
            const suggestionItem = document.createElement('a');
            suggestionItem.href = "#";
            suggestionItem.className = 'list-group-item list-group-item-action';
            suggestionItem.textContent = place.label;
            suggestionItem.addEventListener('click', (e) => {
                e.preventDefault();
                inputEl.value = place.label;
                // La sugerencia ya trae coordenadas: no hará falta geocodificarla
                setInputCoords(inputEl, place.lat, place.lon);
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
            // La posición exacta del GPS acompaña al texto: no se vuelve a geocodificar
            setInputCoords(originInput, latitude, longitude);
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
    text = escapeHtml(text);
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
        hasRestrictedStations = allGasStations.some(s => s.tipoVenta === 'R');
        updateRestrictedOption();

        // Mostrar la fecha y hora de los precios en el pie del sidebar
        const dataDateEl = document.getElementById('data-date');
        if (dataDateEl && dataDate) {
            // El API devuelve "dd/mm/aaaa h:mm:ss"; mostrar sin segundos
            const [datePart, timePart] = String(dataDate).split(' ');
            const time = timePart ? ` · ${timePart.split(':').slice(0, 2).join(':')}h` : '';
            dataDateEl.textContent = `Precios actualizados: ${datePart}${time}`;

            // Avisar si los precios son viejos (la actualización automática ha fallado)
            const [day, month, year] = datePart.split('/').map(Number);
            const ageDays = Math.floor((Date.now() - new Date(year, month - 1, day).getTime()) / 86400000);
            const stale = ageDays >= 2;
            dataDateEl.classList.toggle('text-muted', !stale);
            dataDateEl.classList.toggle('text-danger', stale);
            dataDateEl.classList.toggle('fw-semibold', stale);
            if (stale) {
                dataDateEl.textContent = `⚠️ Precios de hace ${ageDays} días (${datePart}): pueden haber cambiado`;
            }
        }

        showMessage('info', 'Datos cargados. ¡Listo para buscar tu ruta!');
        searchButton.disabled = false;
        searchButton.classList.remove('disabled');

        // Habilitar botón de búsqueda manual también
        if (manualSearchBtn) {
            manualSearchBtn.disabled = false;
            manualSearchBtn.classList.remove('disabled');
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

    // Si llegó una ruta compartida por URL, lanzarla ahora. Va después de
    // ocultar el spinner de carga para que la búsqueda muestre el suyo.
    if (autoSearchPending && allGasStations.length > 0) {
        autoSearchPending = false;
        form.requestSubmit(searchButton);
    }
}

/**
 * Carga perezosa de los puntos de carga eléctrica (data/cargadores.json,
 * generado por GitHub Actions a partir de OpenChargeMap).
 */
async function fetchChargers() {
    if (allChargers.length > 0) return allChargers;
    if (chargersLoading) return chargersLoading;
    chargersLoading = (async () => {
        try {
            const response = await fetch('/data/cargadores.json');
            if (!response.ok) throw new Error(`La petición falló con estado ${response.status}`);
            const data = await response.json();
            allChargers = Array.isArray(data.cargadores) ? data.cargadores : [];
            console.log(`Cargados ${allChargers.length} puntos de carga.`);
            return allChargers;
        } catch (error) {
            console.error('Error cargando puntos de carga:', error);
            showMessage('error', 'No se pudieron cargar los puntos de carga eléctrica. Comprueba tu conexión e inténtalo de nuevo.');
            return [];
        } finally {
            chargersLoading = null;
        }
    })();
    return chargersLoading;
}

// Parámetros de búsqueda según el modo de vehículo. Para eléctricos se
// reutiliza el mismo modelo del worker: batería = depósito, kWh = litros.
function getEffectiveParams() {
    const mode = getVehicleMode();
    const base = {
        mode,
        currentFuelPercent: parseFloat(document.getElementById('current-fuel').value),
        finalFuelPercent: parseFloat(document.getElementById('final-fuel').value),
        searchRadius: parseFloat(document.getElementById('search-radius').value),
        includeRestricted: document.getElementById('include-restricted').checked,
        algorithm: document.querySelector('input[name="algorithm"]:checked').value
    };
    if (mode === 'ev') {
        return {
            ...base,
            fuelType: 'EV',
            tankCapacity: parseFloat(document.getElementById('ev-battery').value) || 60,
            consumption: parseFloat(document.getElementById('ev-consumption').value) || 16,
            minChargePower: parseFloat(document.getElementById('min-charge-power').value) || 0,
            tariff: parseFloat(document.getElementById('ev-tariff').value) || 0.45,
            // En ruta no se suele cargar al 100 %: el último tramo es muy lento
            maxFillPercent: parseFloat(document.getElementById('ev-max-charge').value) || 80
        };
    }
    return {
        ...base,
        fuelType: document.getElementById('fuel-type').value,
        tankCapacity: parseFloat(document.getElementById('tank-capacity').value),
        consumption: parseFloat(document.getElementById('consumption').value) || 6.5
    };
}

// Comprueba que los datos del vehículo permiten calcular un plan.
function validateParams(params) {
    const isEV = params.mode === 'ev';
    if (!(params.tankCapacity > 0)) {
        throw new Error(isEV ? 'Indica la capacidad de la batería en kWh.' : 'Indica la capacidad del depósito en litros.');
    }
    if (!(params.consumption > 0)) {
        throw new Error('Indica un consumo mayor que cero.');
    }
    if (isEV && params.finalFuelPercent > params.maxFillPercent) {
        throw new Error(`La batería en destino (${params.finalFuelPercent} %) no puede superar la carga máxima en ruta (${params.maxFillPercent} %). Cambia una de las dos.`);
    }
}

// Tiempo de carga estimado, en minutos, cargando a la potencia máxima del punto
function chargeMinutes(kwh, kw) {
    return kw > 0 ? Math.max(1, Math.round(kwh / kw * 60)) : null;
}

function formatMinutes(minutes) {
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

// Dataset activo según el modo, en la forma que espera el worker.
async function getActiveStations(params) {
    if (params.mode === 'ev') {
        const chargers = await fetchChargers();
        return chargers
            .filter(c => c.kw >= (params.minChargePower || 0))
            .map(c => ({
                id: c.id,
                name: c.name,
                address: c.address,
                lat: c.lat,
                lon: c.lon,
                tipoVenta: 'P',
                kw: c.kw,
                precioTexto: c.precioTexto,
                // El campo horario se muestra en las tarjetas: aquí va la info útil del cargador
                horario: `${c.kw} kW ${c.dc ? 'DC' : 'AC'}${c.puntos ? ` · ${c.puntos} ${c.puntos === 1 ? 'punto' : 'puntos'}` : ''}${c.op ? ` · ${c.op}` : ''}`,
                // Precio real publicado si existe; si no, la tarifa del usuario
                prices: { EV: c.precio ?? params.tariff }
            }));
    }
    let stations = allGasStations;
    if (document.getElementById('adblue-filter').checked) {
        stations = stations.filter(s => s.prices.ADBLUE != null);
        if (stations.length === 0) {
            // Los datos cargados no traen AdBlue (p. ej. respuesta antigua del API)
            throw new Error('Los datos de precios cargados no incluyen información de AdBlue. Desactiva el filtro AdBlue e inténtalo de nuevo, o recarga la página más tarde.');
        }
    }
    return applyDiscounts(stations, params.fuelType);
}

// Unidades de presentación según el modo
const priceUnit = (params) => params.fuelType === 'EV' ? '€/kWh' : '€/L';
const amountUnit = (params) => params.fuelType === 'EV' ? 'kWh' : 'L';
const formatPrice = (value, params) =>
    (value === 0 && params.fuelType === 'EV') ? 'Gratis' : `${value.toFixed(3)} ${priceUnit(params)}`;

async function handleFormSubmit(e) {
    e.preventDefault();
    showSpinner();
    if (routeLayer) map.removeLayer(routeLayer);
    stationMarkers.clearLayers();
    resultsDiv.innerHTML = '';

    try {
        // El orden visual manda: primer punto = origen, último = destino
        const { origin: originText, destination: destinationText, waypoints: waypointTexts } = getRouteTexts();
        if (!originText || !destinationText) {
            throw new Error('Por favor, rellena el origen (primer punto) y el destino (último punto).');
        }
        const params = getEffectiveParams();
        validateParams(params);
        const stations = await getActiveStations(params);

        if (stations.length === 0) {
            throw new Error(params.mode === 'ev'
                ? 'No hay puntos de carga disponibles con la potencia mínima seleccionada. Baja el filtro de potencia en la configuración.'
                : 'No hay estaciones disponibles con los filtros actuales.');
        }

        // Geocodificar origen, paradas intermedias y destino
        let points;
        try {
            points = await geocodeRoutePoints();
        } catch (e) {
            throw new Error("Error de conexión con el servicio de mapas (Nominatim) al buscar direcciones.");
        }

        if (points.some(p => !p)) throw new Error("No se pudieron geolocalizar todas las direcciones. Intenta ser más específico o revisa tu conexión.");

        const destCoords = points[points.length - 1];

        let routeData;
        try {
            routeData = await getRoute(points);
        } catch (e) {
            throw new Error("Error de conexión con el servicio de rutas (OSRM). No se pudo calcular la ruta.");
        }

        if (!routeData) throw new Error("No se pudo encontrar una ruta válida entre los puntos indicados.");

        const routeLine = turf.lineString(routeData.geometry.coordinates);
        const miEstilo = { color: "#4138c2", weight: 2, opacity: 0.8 };
        routeLayer = L.geoJSON(routeLine, { style: miEstilo }).addTo(map);
        // Force the map to re-evaluate its size before fitting the bounds
        map.invalidateSize();
        map.fitBounds(routeLayer.getBounds().pad(0.1));
        const routeDistance = turf.length(routeLine, { units: 'kilometers' });

        // Posición de las paradas intermedias a lo largo de la ruta (para
        // ordenarlas junto a los repostajes en el enlace de Google Maps)
        const routeIndex = buildRouteIndex(routeLine);
        const waypointCoords = points.slice(1, -1).map(p => {
            // Posición a lo largo de la ruta, no en línea recta desde el origen
            const { distanceFromStart } = locateOnRoute(routeIndex, p.lon, p.lat);
            return { lat: p.lat, lon: p.lon, distanceFromStart };
        });

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
                    destCoords: destCoords,
                    waypoints: waypointCoords,
                    params: params,
                    stations: stations,
                    lastResults: results
                };

                displayResults(results, origin, destination);

                // Sugerir carga lenta cerca del destino (solo eléctricos)
                if (params.mode === 'ev' && document.getElementById('slow-charge-dest').checked) {
                    appendDestinationChargers(destCoords);
                }

                form.classList.add('d-none');
            } else {
                console.error('Main: Error message received from worker.', error);
                // Custom, more user-friendly error messages
                let userMessage = error;
                if (error.includes("alcanzables") || error.includes("adecuadas")) {
                    userMessage = params.mode === 'ev'
                        ? "No se encontraron puntos de carga adecuados para completar la ruta. Prueba a bajar la potencia mínima o aumentar la distancia de búsqueda en la configuración."
                        : "No se encontraron gasolineras adecuadas para completar la ruta con la configuración actual. Prueba a aumentar la distancia de búsqueda en la configuración.";
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

        console.log('Main: Posting message to worker.');
        // Post data to the worker to start calculation.
        worker.postMessage({
            routeLine,
            routeDistance,
            params,
            allGasStations: stations,
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

// Calcula la ruta pasando por todos los puntos (origen, paradas intermedias, destino)
async function getRoute(points) {
    const coords = points.map(p => `${p.lon},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();
    return (data.code === 'Ok' && data.routes.length > 0) ? data.routes[0] : null;
}

// Las 15 estaciones más baratas de la ruta, ordenadas por kilómetro.
function getCheapestStationsOnRoute(routeLine, params, stations) {
    const routeDistance = turf.length(routeLine, { units: 'kilometers' });
    return findStationsOnRoute(routeLine, routeDistance, params, stations)
        .sort((a, b) => a.prices[params.fuelType] - b.prices[params.fuelType])
        .slice(0, 15)
        .sort((a, b) => a.distanceFromStart - b.distanceFromStart);
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
            .bindPopup(`<b>Parada ${stopIndex}: ${escapeHtml(station.name)}</b><br>${escapeHtml(station.address)}<br>Precio: ${station.prices[currentRouteData.params.fuelType].toFixed(3)} ${priceUnit(currentRouteData.params)}<br>Km ${Math.round(station.distanceFromStart)} desde origen`)
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

    const datasetForRoute = currentRouteData.stations || allGasStations;
    if (!datasetForRoute || datasetForRoute.length === 0) {
        alert('Los datos aún no están disponibles. Por favor, espera un momento e inténtalo de nuevo.');
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
            datasetForRoute,
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

    // Cabecera: título + botón de volver
    const title = document.createElement('h3');
    title.className = "h5 fw-bold text-body-emphasis";
    title.textContent = "Selecciona las paradas";

    const backToResultsBtn = document.createElement('button');
    backToResultsBtn.id = "back-to-results-btn";
    backToResultsBtn.className = "btn btn-danger d-flex align-items-center gap-2";
    backToResultsBtn.setAttribute('aria-label', 'Volver');
    backToResultsBtn.innerHTML = `<i class="bi bi-arrow-return-left" aria-hidden="true"></i>`;

    const headerContainer = document.createElement('div');
    headerContainer.className = "mb-3 d-flex justify-content-between align-items-center";
    headerContainer.appendChild(title);
    headerContainer.appendChild(backToResultsBtn);
    resultsDiv.appendChild(headerContainer);

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
                    <label class="form-check-label fw-bold station-name" for="station-${index}">${escapeHtml(station.name)}</label>
                    <p class="small text-body-secondary fw-bold mb-1">${escapeHtml(station.horario)}
                    <span class="small text-muted">Km ${Math.round(station.distanceFromStart)}${station.distanceToRoute != null ? ` · a ${station.distanceToRoute.toFixed(1)} km de la ruta` : ''}</span></p>
                </div>
                <div class="text-end ms-2">
                    <p class="h6 fw-bold text-body-emphasis mb-0">${station.prices[currentRouteData.params.fuelType].toFixed(3)} ${priceUnit(currentRouteData.params)}</p>
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

        // Ordenar estaciones y paradas intermedias por su posición en la ruta
        const allPoints = [
            ...selectedStations.map(s => ({ lat: s.lat, lon: s.lon, distanceFromStart: s.distanceFromStart })),
            ...(currentRouteData?.waypoints || [])
        ].sort((a, b) => a.distanceFromStart - b.distanceFromStart);

        // Generar URL de Google Maps
        const waypoints = allPoints.map(p => `${p.lat},${p.lon}`).join('|');
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}`;

        // Abrir en nueva pestaña
        window.open(googleMapsUrl, '_blank', 'noopener,noreferrer');
    });

    // Inicializar mapa sin marcadores (se añadirán cuando se seleccionen)
    stationMarkers.clearLayers();
    
    // Inicializar contador
    updateSelectionCounter(0);
}

// Botones de acción al pie de los resultados: paradas manuales + nueva ruta
function appendActionButtons(origin, destination) {
    const actions = document.createElement('div');
    actions.className = 'mt-2 d-flex gap-2';
    actions.innerHTML = `
        <button id="manual-route-btn" class="btn btn-info flex-fill fw-bold">
            <i class="bi bi-list-check me-2" aria-hidden="true"></i>Paradas Manuales
        </button>
        <button id="new-route-btn" class="btn btn-secondary flex-fill fw-bold">Nueva Ruta</button>
    `;
    resultsDiv.appendChild(actions);
    document.getElementById('new-route-btn').addEventListener('click', resetUI);
    document.getElementById('manual-route-btn').addEventListener('click', () => {
        showSpinner();
        // Usar setTimeout para permitir que el spinner se muestre antes de procesar
        setTimeout(() => {
            showManualRouteOptions(origin, destination);
            hideSpinner();
        }, 100);
    });
}

function displayResults(results, origin, destination) {
    const stops = results.stops;
    const params = currentRouteData?.params || getEffectiveParams();
    const isEV = params.fuelType === 'EV';

    if (stops.length === 0) {
        if (allGasStations.length === 0 && !isEV) {
             showMessage('error', 'Error crítico: No se pudieron cargar los datos de las gasolineras. Por favor, recarga la página.');
             return;
        }

        // No hace falta parar: mostrar el aviso, el coste estimado de lo que
        // ya llevas en el depósito/batería, y las acciones habituales.
        messageContainer.classList.add('d-none');
        resultsContainer.classList.remove('d-none');
        resultsDiv.innerHTML = '';

        if (results.relaxed) resultsDiv.appendChild(tightPlanWarning(isEV));

        const good = document.createElement('div');
        good.className = 'p-2 bg-success-subtle border border-success-subtle rounded-3 mb-2';
        good.innerHTML = `<p class="text-success-emphasis fw-semibold mb-0">¡Buenas noticias! Con tu nivel de ${isEV ? 'batería' : 'combustible'} actual puedes llegar a tu destino sin necesidad de ${isEV ? 'cargar' : 'repostar'}.</p>`;
        resultsDiv.appendChild(good);

        const dist = currentRouteData?.routeDistance || 0;
        const needed = dist / 100 * params.consumption;
        const dataset = currentRouteData?.stations || [];
        const priced = dataset.map(s => s.prices[params.fuelType]).filter(p => p > 0);
        const avgPrice = priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : 0;

        const summary = document.createElement('div');
        summary.className = 'p-2 bg-body-tertiary border rounded-3 mb-2 small';
        summary.innerHTML = `
            <div class="d-flex justify-content-between"><span>Distancia</span><span class="fw-bold">${Math.round(dist)} km</span></div>
            <div class="d-flex justify-content-between"><span>${isEV ? 'Energía necesaria' : 'Combustible necesario'}</span><span class="fw-bold">${needed.toFixed(1)} ${amountUnit(params)}</span></div>
            ${avgPrice > 0 ? `<div class="d-flex justify-content-between"><span>Coste estimado del viaje</span><span class="fw-bold">${(needed * avgPrice).toFixed(2)} €</span></div>
            <p class="form-text mt-1 mb-0">Se consume lo que ya llevabas, valorado a precio medio actual (${formatPrice(avgPrice, params)}).</p>` : ''}
        `;
        resultsDiv.appendChild(summary);

        appendActionButtons(origin, destination);
        form.classList.add('d-none');
        return;
    }

    messageContainer.classList.add('d-none');
    resultsContainer.classList.remove('d-none');
    resultsDiv.innerHTML = '';

    const title = document.createElement('h3');
    title.className = "h5 fw-bold text-body-emphasis mb-2";
    title.textContent = isEV ? "Plan de cargas sugeridas" : "Plan de paradas sugeridas";
    resultsDiv.appendChild(title);
    if (results.relaxed) resultsDiv.appendChild(tightPlanWarning(isEV));

    // Resumen del viaje.
    // "Coste de los repostajes" = lo que pagas en ruta (exacto).
    // "Coste estimado del viaje" = el combustible que consumes, valorado como
    // mezcla de lo comprado (a su precio real) y lo que ya llevabas en el
    // depósito (estimado a precio medio actual, porque no sabemos qué pagaste).
    const totalAmount = stops.reduce((total, stop) => total + stop.refuelAmount, 0);
    const dist = currentRouteData?.routeDistance || 0;
    const consumed = dist / 100 * params.consumption;
    const initialAmount = params.tankCapacity * params.currentFuelPercent / 100;
    const dataset = currentRouteData?.stations || [];
    const priced = dataset.map(s => s.prices[params.fuelType]).filter(p => p > 0);
    const avgPrice = priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : 0;
    const blendedPrice = (totalAmount + initialAmount) > 0 && avgPrice > 0
        ? (results.optimalCost + initialAmount * avgPrice) / (totalAmount + initialAmount)
        : 0;
    const tripCost = consumed * blendedPrice;
    // Tiempo total de carga (solo eléctricos, si se conoce la potencia de cada punto)
    const stopMinutes = stops.map(s => chargeMinutes(s.refuelAmount, s.kw));
    const totalMinutes = isEV && stopMinutes.every(m => m !== null) ? stopMinutes.reduce((a, b) => a + b, 0) : null;

    const summary = document.createElement('div');
    summary.className = 'p-2 bg-body-tertiary border rounded-3 mb-2 small';
    summary.innerHTML = `
        <div class="d-flex justify-content-between"><span>Distancia</span><span class="fw-bold">${Math.round(dist)} km</span></div>
        <div class="d-flex justify-content-between"><span>Paradas</span><span class="fw-bold">${stops.length}</span></div>
        <div class="d-flex justify-content-between"><span>${isEV ? 'Energía a cargar' : 'Combustible a repostar'}</span><span class="fw-bold">${totalAmount.toFixed(1)} ${amountUnit(params)}</span></div>
        <div class="d-flex justify-content-between"><span>Coste de ${isEV ? 'las cargas' : 'los repostajes'}</span><span class="fw-bold">${results.optimalCost.toFixed(2)} €</span></div>
        ${totalMinutes !== null ? `<div class="d-flex justify-content-between"><span>Tiempo de carga estimado</span><span class="fw-bold">≈ ${formatMinutes(totalMinutes)}</span></div>` : ''}
        ${blendedPrice > 0 ? `<div class="d-flex justify-content-between"><span>Coste estimado del viaje</span><span class="fw-bold">${tripCost.toFixed(2)} €</span></div>
        <p class="form-text mt-1 mb-0">Consumo del viaje (${consumed.toFixed(1)} ${amountUnit(params)}); lo que ya llevabas se valora a precio medio actual (${formatPrice(avgPrice, params)}).</p>` : ''}
    `;
    if (totalMinutes !== null) {
        const note = document.createElement('p');
        note.className = 'form-text mt-1 mb-0';
        note.textContent = 'Tiempos de carga calculados a la potencia máxima de cada punto; el real depende de tu coche y del nivel de batería.';
        summary.appendChild(note);
    }
    resultsDiv.appendChild(summary);

    if (stops.length > 0) {
        // Enlace de Google Maps: paradas de repostaje/carga + paradas
        // intermedias del usuario, ordenadas por su posición en la ruta
        const allPoints = [
            ...stops.map(s => ({ lat: s.lat, lon: s.lon, distanceFromStart: s.distanceFromStart })),
            ...(currentRouteData?.waypoints || [])
        ].sort((a, b) => a.distanceFromStart - b.distanceFromStart);
        const waypoints = allPoints.map(p => `${p.lat},${p.lon}`).join('|');
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}`;

        // Waze no soporta rutas con paradas por URL: navega a la primera parada
        const firstStop = allPoints[0];
        const wazeUrl = `https://waze.com/ul?ll=${firstStop.lat},${firstStop.lon}&navigate=yes`;

        // Apple Maps encadena destinos con "+to:"
        const appleChain = allPoints.map(p => `${p.lat},${p.lon}`).join('+to:');
        const appleMapsUrl = `https://maps.apple.com/?saddr=${encodeURIComponent(origin)}&daddr=${appleChain}+to:${encodeURIComponent(destination)}&dirflg=d`;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'mt-2 d-flex gap-2';
        buttonContainer.innerHTML = `
            <button type="button" data-open-url="${escapeHtml(googleMapsUrl)}" class="btn btn-primary flex-fill py-2" title="Abrir ruta en Google Maps" aria-label="Abrir ruta en Google Maps">
                <i class="bi bi-google" aria-hidden="true"></i>
            </button>
            <button type="button" data-open-url="${escapeHtml(wazeUrl)}" class="btn btn-primary flex-fill py-2" title="Navegar a la primera parada con Waze" aria-label="Navegar a la primera parada con Waze">
                <img src="https://cdn.simpleicons.org/waze/white" alt="Waze" width="18" height="18">
            </button>
            <button type="button" data-open-url="${escapeHtml(appleMapsUrl)}" class="btn btn-primary flex-fill py-2" title="Abrir ruta en Apple Maps" aria-label="Abrir ruta en Apple Maps">
                <i class="bi bi-apple" aria-hidden="true"></i>
            </button>
        `;
        resultsDiv.appendChild(buttonContainer);

        const savingsVsAvg = results.avgPriceCost - results.optimalCost;
        const savingsVsMax = results.maxPriceCost - results.optimalCost;

        if (savingsVsAvg > 0 || savingsVsMax > 0) {
            const savingsContainer = document.createElement('div');
            savingsContainer.className = 'mt-2 p-2 bg-success-subtle border border-success-subtle rounded-3 mb-1';
            // Solo se muestran las comparaciones en las que de verdad se ahorra
            savingsContainer.innerHTML = [
                savingsVsAvg > 0 ? `<p class="text-sm text-success-emphasis"><span class="fw-bold">Ahorro: ${savingsVsAvg.toFixed(2)}€</span> comparado con la media.</p>` : '',
                savingsVsMax > 0 ? `<p class="text-sm text-success-emphasis"><span class="fw-bold">Ahorro: ${savingsVsMax.toFixed(2)}€</span> comparado con el máximo.</p>` : ''
            ].join('');
            resultsDiv.appendChild(savingsContainer);
        }
    }
    stops.forEach((station, index) => {
        const card = document.createElement('div');
        card.className = 'card card-body mb-2 bg-body-tertiary';
        card.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
                <div class="flex-grow-1">
                    <p class="fw-bold station-name">Parada ${index + 1}: ${escapeHtml(station.name)}</p>
                    <p class="fw-bold small text-body-secondary">${escapeHtml(station.horario)}</p>
                    <p class="small text-muted">${escapeHtml(station.address)}</p>
                    <p class="small text-muted">Aprox. en el km ${Math.round(station.distanceFromStart)}</p>
                </div>
                <div class="text-end ms-2 flex-shrink-0">
                    <p class="h5 fw-bold text-body-emphasis">${formatPrice(station.prices[params.fuelType], params)}</p>
                    <p class="small text-muted">${isEV ? 'Cargar' : 'Repostar'}: ${station.refuelAmount.toFixed(1)} ${amountUnit(params)}</p>
                    ${isEV && stopMinutes[index] !== null ? `<p class="small text-muted">≈ ${formatMinutes(stopMinutes[index])}</p>` : ''}
                    <p class="small fw-semibold text-success">Coste: ${station.refuelCost.toFixed(2)}€</p>
                </div>
            </div>
        `;
        resultsDiv.appendChild(card);

        const markerColor = '#b549ff';
        const markerHtml = `<div style="background-color: ${markerColor}; color: white; border-radius: 50%; width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${index + 1}</div>`;
        const icon = L.divIcon({ html: markerHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });

        L.marker([station.lat, station.lon], { icon, stationId: station.id })
            .bindPopup(`<b>Parada ${index + 1}: ${escapeHtml(station.name)}</b><br>${escapeHtml(station.address)}<br>Precio: ${formatPrice(station.prices[params.fuelType], params)}`)
            .addTo(stationMarkers);
    });

    // Acciones: paradas manuales + nueva ruta
    appendActionButtons(origin, destination);
}

// Aviso de plan apurado: para completar la ruta no se ha podido respetar la
// reserva de seguridad (ni el repostaje mínimo por parada).
function tightPlanWarning(isEV) {
    const warning = document.createElement('div');
    warning.className = 'p-2 bg-warning-subtle border border-warning-subtle rounded-3 mb-2 small text-warning-emphasis';
    warning.textContent = `⚠️ Plan muy ajustado: para completar la ruta hay que apurar la reserva ${isEV ? 'de la batería' : 'del depósito'}. Si puedes, ${isEV ? 'carga' : 'reposta'} antes de salir.`;
    return warning;
}

// --- Carga lenta cerca del destino (solo eléctricos) ---
// Añade a los resultados una sección con cargadores lentos (≤ 22 kW) cercanos
// al destino: útiles para dejar el coche cargando al llegar.
async function appendDestinationChargers(destCoords) {
    const chargers = await fetchChargers();
    if (!chargers.length || !destCoords) return;

    const destPoint = turf.point([destCoords.lon, destCoords.lat]);
    const nearby = chargers
        .filter(c => c.kw > 0 && c.kw <= 22)
        .map(c => ({
            ...c,
            distKm: turf.distance(destPoint, turf.point([c.lon, c.lat]), { units: 'kilometers' })
        }))
        .filter(c => c.distKm <= 5)
        .sort((a, b) => a.distKm - b.distKm)
        .slice(0, 5);

    if (nearby.length === 0) return;

    const section = document.createElement('div');
    section.className = 'mt-3';
    section.innerHTML = `<h4 class="h6 fw-bold text-body-emphasis">🔌 Carga lenta cerca del destino</h4>
        <p class="form-text mt-0 mb-2">Para dejar el coche cargando al llegar.</p>`;

    nearby.forEach(c => {
        const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}`;
        const card = document.createElement('div');
        card.className = 'card card-body mb-2 bg-body-tertiary py-2';
        card.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="flex-grow-1">
                    <p class="fw-bold station-name mb-0">${escapeHtml(c.name)}</p>
                    <p class="small text-body-secondary mb-0">${escapeHtml(c.kw)} kW ${c.dc ? 'DC' : 'AC'}${c.op ? ` · ${escapeHtml(c.op)}` : ''} · a ${c.distKm.toFixed(1)} km del destino</p>
                    ${c.precioTexto ? `<p class="small text-muted mb-0">${escapeHtml(c.precioTexto)}</p>` : ''}
                </div>
                <button type="button" data-open-url="${escapeHtml(gmaps)}" class="btn btn-sm btn-outline-primary ms-2" title="Cómo llegar" aria-label="Cómo llegar"><i class="bi bi-geo-alt" aria-hidden="true"></i></button>
            </div>
        `;
        section.appendChild(card);
    });

    resultsDiv.appendChild(section);
}

// --- Búsqueda alrededor de la ubicación actual ---
function handleNearbySearch() {
    if (!navigator.geolocation) {
        alert('La geolocalización no está soportada en tu navegador.');
        return;
    }

    const nearbyBtn = document.getElementById('nearby-btn');
    const originalContent = nearbyBtn.innerHTML;
    nearbyBtn.disabled = true;
    nearbyBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Localizando...';

    navigator.geolocation.getCurrentPosition(async (position) => {
        try {
            showSpinner();
            const { latitude, longitude } = position.coords;
            const params = getEffectiveParams();
            const dataset = await getActiveStations(params);
            // Radio de búsqueda alrededor de la posición: el configurado, mínimo 5 km
            const radiusKm = Math.max(params.searchRadius, 5);
            const here = turf.point([longitude, latitude]);

            const nearby = dataset
                .filter(s => hasPrice(s, params.fuelType))
                .map(s => ({
                    ...s,
                    distKm: turf.distance(here, turf.point([s.lon, s.lat]), { units: 'kilometers' })
                }))
                .filter(s => s.distKm <= radiusKm)
                .sort((a, b) => a.prices[params.fuelType] - b.prices[params.fuelType] || a.distKm - b.distKm)
                .slice(0, 15);

            if (nearby.length === 0) {
                showMessage('error', `No se encontraron ${params.mode === 'ev' ? 'puntos de carga' : 'gasolineras'} en un radio de ${radiusKm} km. Prueba a aumentar la distancia de búsqueda o bajar los filtros.`);
                return;
            }

            // Pintar resultados
            form.classList.add('d-none');
            messageContainer.classList.add('d-none');
            resultsContainer.classList.remove('d-none');
            resultsDiv.innerHTML = '';

            const header = document.createElement('div');
            header.className = 'mb-3 d-flex justify-content-between align-items-center';
            header.innerHTML = `<h3 class="h5 fw-bold text-body-emphasis mb-0">${params.mode === 'ev' ? 'Cargadores' : 'Gasolineras'} cerca de ti</h3>
                <button id="nearby-back-btn" class="btn btn-danger d-flex align-items-center gap-2" aria-label="Volver"><i class="bi bi-arrow-return-left" aria-hidden="true"></i></button>`;
            resultsDiv.appendChild(header);
            document.getElementById('nearby-back-btn')?.addEventListener('click', resetUI);

            // Mapa: posición del usuario + resultados numerados
            stationMarkers.clearLayers();
            if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
            const hereIcon = L.divIcon({ html: '<div style="background:#0d6efd;border:3px solid white;border-radius:50%;width:1.2rem;height:1.2rem;box-shadow:0 2px 5px rgba(0,0,0,.4);"></div>', className: '', iconSize: [20, 20], iconAnchor: [10, 10] });
            L.marker([latitude, longitude], { icon: hereIcon }).bindPopup('Tu ubicación').addTo(stationMarkers);

            nearby.forEach((s, i) => {
                const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
                const card = document.createElement('div');
                card.className = 'card card-body mb-2 bg-body-tertiary py-2';
                card.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="flex-grow-1">
                            <p class="fw-bold station-name mb-0">${i + 1}. ${escapeHtml(s.name)}</p>
                            <p class="small text-body-secondary mb-0">${escapeHtml(s.horario)}</p>
                            <p class="small text-muted mb-0">${escapeHtml(s.address)} · a ${s.distKm.toFixed(1)} km</p>
                        </div>
                        <div class="text-end ms-2 flex-shrink-0">
                            <p class="h6 fw-bold text-body-emphasis mb-1">${formatPrice(s.prices[params.fuelType], params)}</p>
                            <button type="button" data-open-url="${escapeHtml(gmaps)}" class="btn btn-sm btn-outline-primary" title="Cómo llegar"><i class="bi bi-geo-alt" aria-hidden="true"></i> Ir</button>
                        </div>
                    </div>
                `;
                resultsDiv.appendChild(card);

                const markerHtml = `<div style="background-color: #4138c2; color: white; border-radius: 50%; width: 1.8rem; height: 1.8rem; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); font-size: 0.9rem;">${i + 1}</div>`;
                const icon = L.divIcon({ html: markerHtml, className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
                L.marker([s.lat, s.lon], { icon })
                    .bindPopup(`<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.address)}<br>${formatPrice(s.prices[params.fuelType], params)} · a ${s.distKm.toFixed(1)} km`)
                    .addTo(stationMarkers);
            });

            map.invalidateSize();
            map.setView([latitude, longitude], 12);
        } catch (error) {
            console.error('Nearby search error:', error);
            showMessage('error', error.message);
        } finally {
            hideSpinner();
            nearbyBtn.disabled = false;
            nearbyBtn.innerHTML = originalContent;
        }
    }, (error) => {
        console.error('Error de geolocalización:', error);
        alert('No se pudo obtener tu ubicación. Comprueba los permisos de ubicación del navegador.');
        nearbyBtn.disabled = false;
        nearbyBtn.innerHTML = originalContent;
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
}
