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
const summaryContainer = document.getElementById('summary-container');
const summaryContent = document.getElementById('summary-content');
const newRouteBtn = document.getElementById('new-route-btn');

// --- App State ---
// --- Spinner Control ---
function showSpinner() {
    spinnerOverlay.classList.remove('hidden');
}

function hideSpinner() {
    spinnerOverlay.classList.add('hidden');
}
let map;
let routeLayer;
let stationMarkers = L.layerGroup();
let allGasStations = [];

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeMap();
    fetchGasStations();
    
    // Event Listeners
    currentFuelSlider.addEventListener('input', e => { currentFuelLabel.textContent = `${e.target.value}%`; });
    finalFuelSlider.addEventListener('input', e => { finalFuelLabel.textContent = `${e.target.value}%`; });
    form.addEventListener('submit', handleFormSubmit);
    settingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));
    searchRadiusSlider.addEventListener('input', e => { searchRadiusLabel.textContent = e.target.value; });
    locateBtn.addEventListener('click', handleLocateMe);
    setupAutocomplete(originInput, originSuggestions);
    setupAutocomplete(destinationInput, destinationSuggestions);

    // Global click listener to hide suggestions
    document.addEventListener('click', (e) => {
        if (!originInput.contains(e.target) && !originSuggestions.contains(e.target)) {
            originSuggestions.classList.add('hidden');
        }
        if (!destinationInput.contains(e.target) && !destinationSuggestions.contains(e.target)) {
            destinationSuggestions.classList.add('hidden');
        }
    });

    newRouteBtn.addEventListener('click', resetUI);
});

function resetUI() {
    // Hide summary and results
    summaryContainer.classList.add('hidden');
    resultsContainer.classList.add('hidden');
    resultsDiv.innerHTML = '';

    // Show form and default message
    form.classList.remove('hidden');
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
            suggestionsEl.classList.add('hidden');
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
            suggestionsEl.classList.add('hidden');
            return;
        }

        const suggestions = await response.json();

        suggestionsEl.innerHTML = '';
        if (suggestions.length === 0) {
            suggestionsEl.classList.add('hidden');
            return;
        }

        suggestions.forEach(place => {
            const suggestionItem = document.createElement('div');
            suggestionItem.className = 'p-2 hover:bg-gray-100 cursor-pointer';
            suggestionItem.textContent = place.display_name;
            suggestionItem.addEventListener('click', () => {
                inputEl.value = place.display_name;
                suggestionsEl.innerHTML = '';
                suggestionsEl.classList.add('hidden');
            });
            suggestionsEl.appendChild(suggestionItem);
        });

        suggestionsEl.classList.remove('hidden');
    } catch (error) {
        console.error("Autocomplete fetch error:", error);
        suggestionsEl.innerHTML = '';
        suggestionsEl.classList.add('hidden');
    }
}

function handleLocateMe() {
    if (!navigator.geolocation) {
        alert('La geolocalización no está soportada en tu navegador.');
        return;
    }

    const originalBtnContent = locateBtn.innerHTML;
    locateBtn.disabled = true;
    locateBtn.innerHTML = `<svg class="animate-spin h-5 w-5 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

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
    resultsContainer.classList.add('hidden');
    messageContainer.classList.remove('hidden');
    let content = '';
    if (type === 'loading') {
        content = `<div class="loader mx-auto"></div><p class="mt-4 text-gray-600">${text}</p>`;
    } else if (type === 'error') {
        content = `<p class="text-red-500 font-semibold">${text}</p>`;
    } else {
        content = `<p class="text-gray-500">${text}</p>`;
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
    searchButton.classList.add('opacity-50', 'cursor-not-allowed');

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
        searchButton.classList.remove('opacity-50', 'cursor-not-allowed');

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
        routeLayer = L.geoJSON(routeLine).addTo(map);
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
                displayResults(results, origin, destination);
                
                // Hide form and show summary
                form.classList.add('hidden');
                const formData = new FormData(form);
                const fuelTypeEl = form.elements['fuel-type'];
                summaryContent.innerHTML = `
                    <p><strong>Origen:</strong> ${formData.get('origin')}</p>
                    <p><strong>Destino:</strong> ${formData.get('destination')}</p>
                    <p><strong>Combustible:</strong> ${fuelTypeEl.options[fuelTypeEl.selectedIndex].text}</p>
                    <p><strong>Consumo:</strong> ${formData.get('consumption')} L/100km</p>
                `;
                summaryContainer.classList.remove('hidden');
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
            includeRestricted: document.getElementById('include-restricted').checked
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

    messageContainer.classList.add('hidden');
    resultsContainer.classList.remove('hidden');
    resultsDiv.innerHTML = '';
    
    const title = document.createElement('h3');
    title.className = "text-lg font-bold text-gray-900 mb-2";
    title.textContent = "Plan de paradas sugeridas";
    resultsDiv.appendChild(title);
                if (stops.length > 0) {
        const waypoints = stops.map(s => `${s.lat},${s.lon}`).join('|');
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}`;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'mt-4';
        buttonContainer.innerHTML = `
            <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700 transition duration-150 ease-in-out">
                <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path></svg>
                Abrir Ruta Completa en Google Maps
            </a>
        `;
        resultsDiv.appendChild(buttonContainer);

        const savingsVsAvg = results.avgPriceCost - results.optimalCost;
        const savingsVsMax = results.maxPriceCost - results.optimalCost;

        if (savingsVsAvg > 0 || savingsVsMax > 0) {
            const savingsContainer = document.createElement('div');
            savingsContainer.className = 'mt-4 p-3 bg-green-50 border border-green-200 rounded-lg';
            savingsContainer.innerHTML = `
                <h4 class="text-md font-bold text-green-800 mb-2">Resumen de Ahorro</h4>
                <p class="text-sm text-green-700">
                    Ahorras <span class="font-bold">${savingsVsAvg.toFixed(2)}€</span> en comparación con el precio medio de la ruta.
                </p>
                <p class="text-sm text-green-700 mt-1">
                    Ahorras <span class="font-bold">${savingsVsMax.toFixed(2)}€</span> en comparación con el más caro.
                </p>
            `;
            resultsDiv.appendChild(savingsContainer);
        }
    }
    stops.forEach((station, index) => {
        const card = document.createElement('div');
        card.className = 'p-3 rounded-lg border border-gray-200 mb-2';
        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex-grow">
                    <p class="font-bold text-indigo-700">Parada ${index + 1}: ${station.name}</p>
                    <p class="text-sm text-red-600">${station.horario}</p>
                    <p class="text-sm text-gray-600">${station.address}</p>
                    <p class="text-sm text-gray-500">Aprox. en el km ${Math.round(station.distanceFromStart)}</p>
                </div>
                <div class="text-right ml-2 flex-shrink-0">
                    <p class="text-lg font-bold text-gray-800">${station.prices[form.elements['fuel-type'].value].toFixed(3)} €/L</p>
                    <p class="text-sm text-gray-500">Repostar: ${station.refuelAmount.toFixed(1)} L</p>
                    <p class="text-sm font-semibold text-green-600">Coste: ${station.refuelCost.toFixed(2)}€</p>
                </div>
            </div>
        `;
        resultsDiv.appendChild(card);

        const markerColor = 'red';
        const markerHtml = `<div style="background-color: ${markerColor}; color: white; border-radius: 50%; width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${index + 1}</div>`;
        const icon = L.divIcon({ html: markerHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });

        L.marker([station.lat, station.lon], { icon, stationId: station.id })
            .bindPopup(`<b>Parada ${index + 1}: ${station.name}</b><br>${station.address}<br>Precio: ${station.prices[form.elements['fuel-type'].value].toFixed(3)} €/L`)
            .addTo(stationMarkers);
    });


}
