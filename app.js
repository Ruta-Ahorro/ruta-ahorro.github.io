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

// --- App State ---
// --- Spinner Control ---
function showSpinner() {
    spinnerOverlay.classList.remove('d-none');
}

function hideSpinner() {
    spinnerOverlay.classList.add('d-none');
}
let map;
let routeLayer;
let stationMarkers = L.layerGroup();
let allGasStations = [];
let currentRouteData = null; // Para almacenar datos de la ruta actual
let currentRouteStations = []; // Para almacenar gasolineras de la ruta actual

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
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
        const response = await fetch(`https://corsproxy.io/?url=https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=es&limit=5`);
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
        try {
            const response = await fetch(`https://corsproxy.io/?url=https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
            const data = await response.json();
            if (data && data.display_name) {
                originInput.value = data.display_name;
            } else {
                originInput.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            }
        } catch (err) {
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
        content = `<div class="loader mx-auto"></div><p class="mt-4 text-muted">${text}</p>`;
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
    // The old message is redundant now
    // showMessage('loading', 'Cargando datos de gasolineras...');
    searchButton.disabled = true;
    searchButton.classList.add('disabled');

    const apiUrl = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
    
    // List of proxies to try in order.
    const proxies = [
       // { url: 'https://api.allorigins.win/get?url=', type: 'allorigins' },
        { url: 'https://corsproxy.io/?url=', type: 'direct' }
    ];

    let jsonData = null;

    for (const proxy of proxies) {
        try {
            console.log(`Intentando con el proxy: ${proxy.url}`);
            // Construct the full URL based on the proxy type
            const fetchUrl = proxy.type === 'direct' 
                ? proxy.url + apiUrl 
                : proxy.url + encodeURIComponent(apiUrl);
            
            const response = await fetch(fetchUrl);

            if (!response.ok) {
                throw new Error(`La petición al proxy falló con estado ${response.status}`);
            }
            
            // Handle different proxy response formats
            if (proxy.type === 'allorigins') {
                const data = await response.json();
                jsonData = JSON.parse(data.contents);
            } else {
                jsonData = await response.json();
                console.log(jsonData)
            }

            // Check if the actual API data is valid by looking for the gas station list
            if (jsonData && jsonData.ListaEESSPrecio && Array.isArray(jsonData.ListaEESSPrecio)) {
                console.log(`Datos obtenidos correctamente con el proxy: ${proxy.url}`);
                break; // Success, exit the loop
            } else {
                jsonData = null; // Reset to null to allow the next proxy to be tried
                throw new Error('El proxy funcionó, pero la API devolvió un error o datos no válidos.');
            }

        } catch (error) {
            console.warn(`El proxy ${proxy.url} falló. Probando el siguiente. Error:`, error);
        }
    }

    hideSpinner();

    if (!jsonData) {
        console.error("Todos los proxies fallaron.");
        showMessage('error', 'Error de conexión: No se pudieron cargar los datos de las gasolineras del gobierno. El servicio puede estar temporalmente caído. Por favor, inténtalo de nuevo más tarde.');
        return; // Stop execution if data loading fails
    }

    // Process the successfully fetched data
    try {
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

    } catch (error) {
        console.error("Error procesando los datos de las gasolineras:", error);
        showMessage('error', 'Se recibió una respuesta inesperada del servicio de gasolineras.');
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
    const response = await fetch(`https://corsproxy.io/?url=https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&countrycodes=es&limit=1`);
    const data = await response.json();
    return data.length > 0 ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
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
        })
        .sort((a, b) => a.prices[fuelType] - b.prices[fuelType]) // Ordenar por precio
        .slice(0, 15) // Tomar las 15 más baratas
        .sort((a, b) => a.distanceFromStart - b.distanceFromStart); // Ordenar por distancia desde origen

    return stationsOnRoute;
}

// Función para actualizar marcadores basado en selección
function updateMapMarkers(stations) {
    stationMarkers.clearLayers();
    
    const selectedCheckboxes = document.querySelectorAll('.station-checkbox:checked');
    
    selectedCheckboxes.forEach(checkbox => {
        const index = parseInt(checkbox.value);
        const station = stations[index];
        
        const markerColor = '#4138c2'; // Color del tema de la app
        const markerHtml = `<div style="background-color: ${markerColor}; color: white; border-radius: 50%; width: 1.8rem; height: 1.8rem; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); font-size: 0.9rem;">${index + 1}</div>`;
        const icon = L.divIcon({ html: markerHtml, className: '', iconSize: [28, 28], iconAnchor: [14, 14] });

        L.marker([station.lat, station.lon], { icon })
            .bindPopup(`<b>${station.name}</b><br>${station.address}<br>Precio: ${station.prices[currentRouteData.params.fuelType].toFixed(3)} €/L<br>Km ${Math.round(station.distanceFromStart)} desde origen`)
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
function updateCardAppearance(card, isSelected) {
    if (isSelected) {
        card.classList.add('selected');
        // Actualizar el orden de selección
        updateSelectionOrder();
    } else {
        card.classList.remove('selected');
        // Actualizar el orden de selección
        updateSelectionOrder();
    }
}

// Función para actualizar el orden de selección en los badges
function updateSelectionOrder() {
    const selectedCheckboxes = document.querySelectorAll('.station-checkbox:checked');
    
    // Limpiar todos los badges
    document.querySelectorAll('.selection-badge').forEach(badge => {
        badge.textContent = '';
    });
    
    // Asignar números de orden
    selectedCheckboxes.forEach((checkbox, orderIndex) => {
        const stationIndex = parseInt(checkbox.value);
        const badge = document.getElementById(`badge-${stationIndex}`);
        if (badge) {
            badge.textContent = orderIndex + 1;
        }
    });
}

function showManualRouteOptions(origin, destination) {
    if (!currentRouteData) {
        alert('No hay datos de ruta disponibles');
        return;
    }

    const cheapestStations = getCheapestStationsOnRoute(
        currentRouteData.routeLine, 
        currentRouteData.params, 
        allGasStations, 
        origin, 
        destination
    );

    if (cheapestStations.length === 0) {
        alert('No se encontraron gasolineras baratas en la ruta');
        return;
    }

    // Limpiar contenido anterior
    resultsDiv.innerHTML = '';

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
    generateContainer.className = 'mt-3 d-grid';
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
                updateCardAppearance(card, checkbox.checked);
            }
        });

        // Event listener para el checkbox
        const checkbox = card.querySelector('.station-checkbox');
        checkbox.addEventListener('change', () => {
            updateMapMarkers(cheapestStations);
            updateCardAppearance(card, checkbox.checked);
        });
    });
    
    resultsDiv.appendChild(stationsContainer);

    // Botón para generar ruta


    // Event listeners
//    document.getElementById('select-all-btn').addEventListener('click', () => {
//        document.querySelectorAll('.station-checkbox').forEach(cb => {
//            cb.checked = true;
//            const card = cb.closest('.station-card');
//            updateCardAppearance(card, true);
//        });
//        updateMapMarkers(cheapestStations);
//    });

//    document.getElementById('clear-all-btn').addEventListener('click', () => {
//        document.querySelectorAll('.station-checkbox').forEach(cb => {
//            cb.checked = false;
//            const card = cb.closest('.station-card');
//            updateCardAppearance(card, false);
//        });
//        updateMapMarkers(cheapestStations);
//    });

    document.getElementById('back-to-results-btn').addEventListener('click', () => {
        // Volver a mostrar los resultados originales
        if (currentRouteData && currentRouteData.lastResults) {
            displayResults(currentRouteData.lastResults, origin, destination);
            
            // Restaurar form hidden y summary visible
           // form.classList.add('d-none');
           // summaryContainer.classList.remove('d-none');
        } else {
            // Fallback: recargar la página
            location.reload();
        }
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
                if (stops.length > 0) {
        const waypoints = stops.map(s => `${s.lat},${s.lon}`).join('|');
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}`;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'mt-3 d-grid';
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
            savingsContainer.className = 'mt-3 p-2 bg-success-subtle border border-success-subtle rounded-3 mb-1';
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
    manualRouteContainer.className = 'mt-3 d-grid';
    manualRouteContainer.innerHTML = `
        <button id="manual-route-btn" class="btn btn-secondary">
            <i class="bi bi-list-check me-2"></i>
            Crear Ruta Manual
        </button>
    `;
    resultsDiv.appendChild(manualRouteContainer);

    // Event listener para el botón de ruta manual
    document.getElementById('manual-route-btn').addEventListener('click', () => {
        showManualRouteOptions(origin, destination);
    });


}
