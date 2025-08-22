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
let map;
let routeLayer;
let stationMarkers = L.layerGroup();
let allGasStations = [];
let lightTileLayer, darkTileLayer, activeTileLayer;

// --- Spinner Control ---
function showSpinner() {
    spinnerOverlay.classList.remove('d-none');
}

function hideSpinner() {
    spinnerOverlay.classList.add('d-none');
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeMap();
    fetchGasStations();
    
    // Event Listeners (guardados por existencia)
    if (currentFuelSlider && currentFuelLabel) currentFuelSlider.addEventListener('input', e => { currentFuelLabel.textContent = `${e.target.value}%`; });
    if (finalFuelSlider && finalFuelLabel) finalFuelSlider.addEventListener('input', e => { finalFuelLabel.textContent = `${e.target.value}%`; });
    if (form) form.addEventListener('submit', handleFormSubmit);
    if (settingsBtn && settingsPanel) settingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('d-none'));
    if (searchRadiusSlider && searchRadiusLabel) searchRadiusSlider.addEventListener('input', e => { searchRadiusLabel.textContent = e.target.value; });
    if (locateBtn) locateBtn.addEventListener('click', handleLocateMe);
    if (originInput && originSuggestions) setupAutocomplete(originInput, originSuggestions);
    if (destinationInput && destinationSuggestions) setupAutocomplete(destinationInput, destinationSuggestions);

    // Global click listener to hide suggestions
    document.addEventListener('click', (e) => {
        if (!originInput.contains(e.target) && !originSuggestions.contains(e.target)) {
            originSuggestions.classList.add('d-none');
        }
        if (!destinationInput.contains(e.target) && !destinationSuggestions.contains(e.target)) {
            destinationSuggestions.classList.add('d-none');
        }
    });

    if (newRouteBtn) newRouteBtn.addEventListener('click', resetUI);

    // --- Dark mode setup ---
    const darkToggle = document.getElementById('darkmode-toggle');
    function setDarkMode(enabled) {
        console.log('setDarkMode called, enabled=', enabled);
        document.body.classList.toggle('dark-mode', enabled);
        localStorage.setItem('darkMode', enabled ? '1' : '0');
        updateDarkIcon(enabled);
        switchMapTiles(enabled);
        // Update meta theme-color for mobile
        try {
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', enabled ? '#111' : '#4138c2');
        } catch (e) {}
        // Refresh dynamic inline styles applied by JS
        refreshDynamicStyles(enabled);
    }
    function getSystemDark() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    function applyInitialDarkMode() {
        const saved = localStorage.getItem('darkMode');
        if (saved === null) setDarkMode(getSystemDark());
        else setDarkMode(saved === '1');
    }
    function updateDarkIcon(enabled) {
        if (!darkToggle) return;
        darkToggle.innerHTML = enabled ? '<i class="bi bi-sun-fill"></i>' : '<i class="bi bi-moon-stars-fill"></i>';
    }
    // Limpia o aplica estilos inline añadidos por JS en componentes dinámicos
    function refreshDynamicStyles(enabled) {
        try {
            // Alerts añadidos en results
            document.querySelectorAll('#results .alert').forEach(el => {
                if (enabled) {
                    el.style.backgroundColor = '#274c41';
                    el.style.color = '#e6ffe6';
                } else {
                    el.style.backgroundColor = '';
                    el.style.color = '';
                }
            });
            // Metadatos de cada tarjeta (small)
            document.querySelectorAll('#results small').forEach(el => {
                if (el.dataset && el.dataset.preserveColor) return;
                if (enabled) el.style.color = '#cfcfcf'; else el.style.color = '';
            });
            // Summary content
            const summary = document.getElementById('summary-content');
            if (summary) {
                if (enabled) summary.style.backgroundColor = '#202426'; else summary.style.backgroundColor = '';
            }
        } catch (e) {
            console.warn('refreshDynamicStyles error', e);
        }
    }
    applyInitialDarkMode();
    try {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq && mq.addEventListener) {
            mq.addEventListener('change', e => {
                if (localStorage.getItem('darkMode') === null) setDarkMode(e.matches);
            });
        }
    } catch (e) {
        // ignore
    }
    if (darkToggle) {
        darkToggle.addEventListener('click', () => setDarkMode(!document.body.classList.contains('dark-mode')));
    }
});

function resetUI() {
    // Hide summary and results
    
    resultsContainer.classList.add('d-none');
    summaryContainer.classList.add('d-none');
    messageContainer.classList.add('d-none');
    resultsDiv.innerHTML = '';

    // Show form
    form.classList.remove('d-none');
    
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
        console.log('autocomplete input:', inputEl.id, query);

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
        console.log('fetchSuggestions called for', inputEl.id, query);
        const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=es&limit=5`;
        let response = null;
        try {
            // Intentar directo primero
            response = await fetch(nomUrl);
            if (!response.ok) {
                console.warn('Direct nominatim response not ok', response.status);
                response = null;
            }
        } catch (err) {
            console.warn('Direct nominatim fetch failed:', err);
            response = null;
        }

        if (!response) {
            try {
                const proxyUrl = `https://corsproxy.io/?url=${nomUrl}`;
                response = await fetch(proxyUrl);
                if (!response.ok) {
                    console.warn('Proxy nominatim response not ok', response.status);
                    suggestionsEl.classList.add('d-none');
                    return;
                }
            } catch (err) {
                console.error('Both direct and proxy fetch failed:', err);
                suggestionsEl.classList.add('d-none');
                return;
            }
        }

        const suggestions = await response.json();

        suggestionsEl.innerHTML = '';
        console.log('suggestions count=', suggestions.length);
        if (suggestions.length === 0) {
            suggestionsEl.classList.add('d-none');
            return;
        }

        suggestions.forEach(place => {
            const suggestionItem = document.createElement('a');
            suggestionItem.className = 'list-group-item list-group-item-action';
            suggestionItem.href = '#';
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
    // Try to keep suggestions visible/focused
    try { suggestionsEl.scrollTop = 0; } catch (e) {}
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
    // Capas base
    lightTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    });
    // Dark tile (Carto Dark matter)
    darkTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; Carto'
    });
    // Elegir según modo
    const isDark = document.body.classList.contains('dark-mode') || (localStorage.getItem('darkMode') === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    activeTileLayer = isDark ? darkTileLayer.addTo(map) : lightTileLayer.addTo(map);
    stationMarkers.addTo(map);

    setTimeout(() => {
        map.invalidateSize();
    }, 100);
}

function switchMapTiles(toDark) {
    try {
        if (!map) return;
        if (toDark) {
            if (activeTileLayer) map.removeLayer(activeTileLayer);
            activeTileLayer = darkTileLayer.addTo(map);
        } else {
            if (activeTileLayer) map.removeLayer(activeTileLayer);
            activeTileLayer = lightTileLayer.addTo(map);
        }
    } catch (e) {
        console.warn('No se pudo cambiar capa de tiles:', e);
    }
}

function showMessage(type, text) {
    let alertClass = 'alert-info';
    if (type === 'error') alertClass = 'alert-danger';
    if (type === 'success') alertClass = 'alert-success';

    let content = `<div class="alert ${alertClass}" role="alert">${text}</div>`;
    
    if (type === 'loading') {
        content = `
            <div class="d-flex justify-content-center align-items-center">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="ms-3 mb-0">${text}</p>
            </div>`;
    }
    
    if (messageContent && messageContainer) {
        messageContent.innerHTML = content;
        messageContainer.classList.remove('d-none');
    } else {
        console.error("Could not find message containers in the DOM.");
    }
}

async function fetchGasStations() {
    showSpinner();
    searchButton.disabled = true;

    const apiUrl = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
    const proxies = [{ url: 'https://corsproxy.io/?url=', type: 'direct' }];
    let jsonData = null;

    for (const proxy of proxies) {
        try {
            const fetchUrl = proxy.url + apiUrl;
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error(`Proxy request failed with status ${response.status}`);
            jsonData = await response.json();
            if (jsonData && jsonData.ListaEESSPrecio) break;
            else jsonData = null;
        } catch (error) {
            console.warn(`Proxy ${proxy.url} failed.`, error);
        }
    }

    hideSpinner();

    if (!jsonData) {
        showMessage('error', 'No se pudieron cargar los datos de las gasolineras. Inténtalo de nuevo más tarde.');
        return;
    }

    try {
        allGasStations = jsonData.ListaEESSPrecio.map(s => ({
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
        
        searchButton.disabled = false;
    } catch (error) {
        console.error("Error processing gas station data:", error);
        showMessage('error', 'Se recibió una respuesta inesperada del servicio de gasolineras.');
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();
    showSpinner();
    form.classList.add('d-none');
    showMessage('loading', 'Calculando la mejor ruta y paradas...');
    
    if (routeLayer) map.removeLayer(routeLayer);
    stationMarkers.clearLayers();
    resultsDiv.innerHTML = '';

    try {
        const originText = originInput.value;
        const destinationText = destinationInput.value;

        const [originCoords, destCoords] = await Promise.all([geocodeAddress(originText), geocodeAddress(destinationText)]);
        if (!originCoords || !destCoords) throw new Error("No se pudieron geolocalizar las direcciones. Intenta ser más específico.");
        
        const routeData = await getRoute(originCoords, destCoords);
        if (!routeData) throw new Error("No se pudo calcular la ruta entre los puntos.");

        const routeLine = turf.lineString(routeData.geometry.coordinates);
        routeLayer = L.geoJSON(routeLine).addTo(map);
        map.fitBounds(routeLayer.getBounds().pad(0.1));
        const routeDistance = turf.length(routeLine, { units: 'kilometers' });

        const worker = new Worker('worker.js');

        worker.onmessage = function(e) {
            hideSpinner();
            messageContainer.classList.add('d-none'); // Hide loading message
            const { success, results, error, origin, destination } = e.data;
            if (success) {
                displayResults(results, origin, destination);
                resultsContainer.classList.remove('d-none');

                const formData = new FormData(form);
                const fuelTypeEl = form.elements['fuel-type'];
                summaryContent.innerHTML = `
                    <p class="mb-1"><strong>Origen:</strong> ${originText}</p>
                    <p class="mb-1"><strong>Destino:</strong> ${destinationText}</p>
                    <p class="mb-1"><strong>Combustible:</strong> ${fuelTypeEl.options[fuelTypeEl.selectedIndex].text}</p>
                    <p class="mb-0"><strong>Consumo:</strong> ${formData.get('consumption')} L/100km</p>
                `;
                summaryContainer.classList.remove('d-none');
            } else {
                showMessage('error', error);
                form.classList.remove('d-none');
            }
            worker.terminate();
        };

        worker.onerror = function(e) {
            hideSpinner();
            showMessage('error', `Error en el worker: ${e.message}`);
            form.classList.remove('d-none');
            worker.terminate();
        };

        const params = {
            fuelType: document.getElementById('fuel-type').value,
            tankCapacity: parseFloat(document.getElementById('tank-capacity').value),
            currentFuelPercent: parseFloat(document.getElementById('current-fuel').value),
            finalFuelPercent: parseFloat(document.getElementById('final-fuel').value),
            consumption: parseFloat(document.getElementById('consumption').value) || 6.5,
            searchRadius: parseFloat(document.getElementById('search-radius').value),
            includeRestricted: document.getElementById('include-restricted').checked
        };

        worker.postMessage({
            routeLine, routeDistance, params, allGasStations,
            origin: originText, destination: destinationText
        });

    } catch (error) {
        hideSpinner();
        showMessage('error', error.message);
        form.classList.remove('d-none');
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
        showMessage('success', '¡Buenas noticias! Con tu nivel de combustible actual, puedes llegar a tu destino sin necesidad de repostar.');
        return;
    }

    resultsDiv.innerHTML = '';
    
    if (stops.length > 0) {
        const waypoints = stops.map(s => `${s.lat},${s.lon}`).join('|');
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}`;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'd-grid gap-2 mb-3';
        buttonContainer.innerHTML = `
            <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
                <i class="bi bi-google"></i> Abrir Ruta en Google Maps
            </a>
        `;
        resultsDiv.appendChild(buttonContainer);

        const savingsVsAvg = results.avgPriceCost - results.optimalCost;
        const savingsVsMax = results.maxPriceCost - results.optimalCost;

        if (savingsVsAvg > 0 || savingsVsMax > 0) {
            const savingsContainer = document.createElement('div');
            savingsContainer.className = 'alert alert-success';
            if (document.body.classList.contains('dark-mode')) {
                savingsContainer.style.backgroundColor = '#274c41';
                savingsContainer.style.color = '#e6ffe6';
            }
            savingsContainer.innerHTML = `
                <h4 class="alert-heading h6">¡Ahorro estimado!</h4>
                <p class="mb-1">Ahorras <strong>${savingsVsAvg.toFixed(2)}€</strong> en comparación con el precio medio.</p>
                <hr>
                <p class="mb-0">Ahorras <strong>${savingsVsMax.toFixed(2)}€</strong> en comparación con la opción más cara.</p>
            `;
            resultsDiv.appendChild(savingsContainer);
        }
    }

    stops.forEach((station, index) => {
    const card = document.createElement('a');
    card.href = `https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lon}`;
    card.target = '_blank';
    card.className = 'list-group-item list-group-item-action';
    // Build inner content to allow styling tweaks
    const header = document.createElement('div');
    header.className = 'd-flex w-100 justify-content-between';
    const h5 = document.createElement('h5');
    h5.className = 'mb-1 fw-bold text-primary';
    h5.textContent = `Parada ${index + 1}: ${station.name}`;
    const priceSmall = document.createElement('small');
    priceSmall.className = 'text-success fw-bold';
    priceSmall.textContent = `${station.prices[form.elements['fuel-type'].value].toFixed(3)} €/L`;
    header.appendChild(h5);
    header.appendChild(priceSmall);

    const addr = document.createElement('p');
    addr.className = 'mb-1';
    addr.textContent = station.address;

    const meta = document.createElement('small');
    meta.style.display = 'block';
    meta.style.color = document.body.classList.contains('dark-mode') ? '#cfcfcf' : '';
    meta.textContent = `Aprox. en el km ${Math.round(station.distanceFromStart)} | Repostar: ${station.refuelAmount.toFixed(1)} L | Coste: ${station.refuelCost.toFixed(2)}€`;

    const horario = document.createElement('small');
    horario.className = 'd-block text-danger';
    horario.textContent = station.horario;

    card.appendChild(header);
    card.appendChild(addr);
    card.appendChild(meta);
    card.appendChild(horario);
    resultsDiv.appendChild(card);

        const markerColor = '#0d6efd'; // Bootstrap primary
        const markerHtml = `<div style="background-color: ${markerColor}; color: white; border-radius: 50%; width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${index + 1}</div>`;
        const icon = L.divIcon({ html: markerHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });

        L.marker([station.lat, station.lon], { icon, stationId: station.id })
            .bindPopup(`<b>Parada ${index + 1}: ${station.name}</b><br>${station.address}<br>Precio: ${station.prices[form.elements['fuel-type'].value].toFixed(3)} €/L`)
            .addTo(stationMarkers);
    });
}
