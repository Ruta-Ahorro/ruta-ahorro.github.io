// Geometría de estaciones sobre la ruta.
//
// Código compartido por app.js (<script>), worker.js (importScripts) y los
// tests (require). Usa aritmética plana en vez de Turf: para cada estación hay
// que recorrer todos los segmentos de la ruta (más de 10.000 en un viaje
// largo), y hacerlo con objetos GeoJSON tardaba decenas de segundos.

const EARTH_RADIUS_KM = 6371.0088; // el mismo radio medio que usa Turf
const DEG_TO_RAD = Math.PI / 180;

// ¿La estación vende ese combustible? En eléctricos un precio 0 es válido
// (cargador gratuito); en carburantes, 0 significa "sin dato".
function hasPrice(station, fuelType) {
    const price = station.prices ? station.prices[fuelType] : null;
    if (typeof price !== 'number' || !Number.isFinite(price)) return false;
    return fuelType === 'EV' ? price >= 0 : price > 0;
}

// Tipo de venta admitido: 'P' (público) y, si se pide, 'R' (restringido).
function saleTypeAllowed(station, includeRestricted) {
    return station.tipoVenta === 'P' || (includeRestricted && station.tipoVenta === 'R');
}

function haversineKm(lon1, lat1, lon2, lat2) {
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Prepara la ruta (un LineString GeoJSON) para consultas rápidas: coordenadas
// en radianes, kilómetro acumulado de cada vértice y caja envolvente.
function buildRouteIndex(routeLine) {
    const coords = routeLine.geometry.coordinates;
    const n = coords.length;
    const lon = new Float64Array(n);
    const lat = new Float64Array(n);
    const cum = new Float64Array(n);
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (let i = 0; i < n; i++) {
        lon[i] = coords[i][0] * DEG_TO_RAD;
        lat[i] = coords[i][1] * DEG_TO_RAD;
        if (i > 0) cum[i] = cum[i - 1] + haversineKm(lon[i - 1], lat[i - 1], lon[i], lat[i]);
        if (lon[i] < minLon) minLon = lon[i];
        if (lon[i] > maxLon) maxLon = lon[i];
        if (lat[i] < minLat) minLat = lat[i];
        if (lat[i] > maxLat) maxLat = lat[i];
    }
    return { n, lon, lat, cum, minLon, maxLon, minLat, maxLat, length: n > 0 ? cum[n - 1] : 0 };
}

// Punto de la ruta más cercano a (lonDeg, latDeg).
// Devuelve la distancia a la ruta y el kilómetro A LO LARGO de la ruta (no en
// línea recta desde el origen) en el que cae ese punto.
function locateOnRoute(index, lonDeg, latDeg) {
    const { n, lon, lat, cum } = index;
    const pLon = lonDeg * DEG_TO_RAD;
    const pLat = latDeg * DEG_TO_RAD;
    const cosLat = Math.cos(pLat);

    if (n === 1) {
        return { distanceToRoute: haversineKm(pLon, pLat, lon[0], lat[0]), distanceFromStart: 0 };
    }

    // Proyección local plana centrada en el punto: suficiente precisión para
    // las distancias que importan (unos pocos km alrededor de la ruta).
    let bestD2 = Infinity, bestSeg = 0, bestT = 0;
    let ax = (lon[0] - pLon) * cosLat;
    let ay = lat[0] - pLat;
    for (let i = 0; i < n - 1; i++) {
        const bx = (lon[i + 1] - pLon) * cosLat;
        const by = lat[i + 1] - pLat;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const cx = ax + t * dx;
        const cy = ay + t * dy;
        const d2 = cx * cx + cy * cy;
        if (d2 < bestD2) { bestD2 = d2; bestSeg = i; bestT = t; }
        ax = bx;
        ay = by;
    }

    return {
        distanceToRoute: Math.sqrt(bestD2) * EARTH_RADIUS_KM,
        distanceFromStart: cum[bestSeg] + bestT * (cum[bestSeg + 1] - cum[bestSeg])
    };
}

// Estaciones a menos de params.searchRadius km de la ruta que venden el
// combustible pedido, con su kilómetro en la ruta, la distancia que queda
// hasta el destino y el desvío. Ordenadas por kilómetro.
function findStationsOnRoute(routeLine, routeDistance, params, stations, index) {
    const { fuelType, searchRadius, includeRestricted } = params;
    const idx = index || buildRouteIndex(routeLine);
    if (idx.n === 0) return [];

    // Margen de la caja envolvente, en radianes
    const marginLat = searchRadius / EARTH_RADIUS_KM;
    const maxAbsLat = Math.min(Math.max(Math.abs(idx.minLat), Math.abs(idx.maxLat)) + marginLat, 89 * DEG_TO_RAD);
    const marginLon = marginLat / Math.cos(maxAbsLat);
    const minLon = idx.minLon - marginLon, maxLon = idx.maxLon + marginLon;
    const minLat = idx.minLat - marginLat, maxLat = idx.maxLat + marginLat;

    const result = [];
    for (const station of stations) {
        if (!hasPrice(station, fuelType) || !saleTypeAllowed(station, includeRestricted)) continue;
        const sLon = station.lon * DEG_TO_RAD;
        const sLat = station.lat * DEG_TO_RAD;
        if (sLon < minLon || sLon > maxLon || sLat < minLat || sLat > maxLat) continue;

        const { distanceToRoute, distanceFromStart } = locateOnRoute(idx, station.lon, station.lat);
        if (distanceToRoute > searchRadius) continue;

        const km = Math.min(distanceFromStart, routeDistance);
        result.push({ ...station, distanceFromStart: km, distanceFromEnd: routeDistance - km, distanceToRoute });
    }
    return result.sort((a, b) => a.distanceFromStart - b.distanceFromStart);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { hasPrice, saleTypeAllowed, buildRouteIndex, locateOnRoute, findStationsOnRoute };
}
