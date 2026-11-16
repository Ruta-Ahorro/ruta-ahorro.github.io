// Convierte el volcado crudo de OpenChargeMap (compact=true) al formato
// interno de la app y lo escribe en data/cargadores.json.
//
// Uso: node scripts/procesar-cargadores.js <ocm_raw.json> <ocm_referencedata.json> <salida.json>
//
// Lo ejecuta el workflow de GitHub Actions (actualizar-datos.yml) y también
// sirve para regenerar los datos en local.
const fs = require('fs');
const path = require('path');
const { parsearCoste, estimarPrecios } = require('./precios-cargadores');

// Con menos cargadores que esto, la respuesta de OpenChargeMap está
// incompleta: mejor fallar (y conservar los datos anteriores) que publicarla.
const MIN_CARGADORES = 5000;

// Estados que consideramos utilizables: desconocido, operativo o parcialmente operativo
const ESTADOS_OK = new Set([0, 50, 75]);

// Caja que contiene la península, Baleares, Canarias, Ceuta y Melilla
const enEspana = (lat, lon) =>
    Number.isFinite(lat) && Number.isFinite(lon) && lat > 27 && lat < 44.5 && lon > -19 && lon < 5;

// --- Tipo de acceso (UsageTypeID de OpenChargeMap) ---
// 2 "Private - Restricted Access" y 3 "Privately Owned - Notice Required": no
// los puede usar un conductor cualquiera, así que se descartan.
const USO_PRIVADO = new Set([2, 3]);
// 6 "Private - For Staff, Visitors or Customers" (hoteles, concesionarios,
// supermercados): se conservan marcados con `cli` y la app solo los ofrece si
// el usuario lo pide.
const USO_SOLO_CLIENTES = new Set([6]);
// El resto (público, con app o tarjeta, pago en el sitio, sin clasificar) se queda.

// Devuelve una función UsageTypeID -> 'privado' | 'clientes' | 'publico'. Mira
// también el título del tipo en los datos de referencia, por si OpenChargeMap
// añade tipos nuevos.
function clasificadorAcceso(ref) {
    const titulos = new Map(((ref && ref.UsageTypes) || []).map(u => [u.ID, String(u.Title || '').toLowerCase()]));
    return (usageTypeId) => {
        const titulo = titulos.get(usageTypeId) || '';
        if (USO_SOLO_CLIENTES.has(usageTypeId) || /staff|visitors|customers/.test(titulo)) return 'clientes';
        if (USO_PRIVADO.has(usageTypeId) || /^private/.test(titulo)) return 'privado';
        return 'publico';
    };
}

// --- Provincia (código INE "01".."52") ---
// En España las dos primeras cifras del código postal son el código INE de la
// provincia. Si el punto no trae un código postal válido, se toma la provincia
// de la gasolinera más cercana (a menos de 25 km), que acierta salvo justo en
// los límites entre provincias.
function provinciaPorCodigoPostal(cp) {
    const m = String(cp || '').match(/(?:^|\D)(\d{5})(?:\D|$)/);
    if (!m) return null;
    const n = Number(m[1].slice(0, 2));
    return n >= 1 && n <= 52 ? m[1].slice(0, 2) : null;
}

// Devuelve (lat, lon) -> provincia de la gasolinera más cercana, o null.
// Rejilla de 0,1° para no comparar cada cargador con todas las gasolineras.
function localizadorProvincias(estaciones) {
    const CELDA = 0.1;
    const MAX_KM = 25;
    const rejilla = new Map();
    const clave = (i, j) => `${i}|${j}`;
    for (const e of estaciones || []) {
        if (!e.prov || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
        const k = clave(Math.floor(e.lat / CELDA), Math.floor(e.lon / CELDA));
        if (!rejilla.has(k)) rejilla.set(k, []);
        rejilla.get(k).push(e);
    }
    if (rejilla.size === 0) return () => null;

    return (lat, lon) => {
        const ci = Math.floor(lat / CELDA);
        const cj = Math.floor(lon / CELDA);
        const kmLon = 111.32 * Math.cos(lat * Math.PI / 180);
        let mejor = null;
        let mejorKm = MAX_KM;
        // 3 celdas a cada lado cubren de sobra los 25 km
        for (let di = -3; di <= 3; di++) {
            for (let dj = -3; dj <= 3; dj++) {
                for (const e of rejilla.get(clave(ci + di, cj + dj)) || []) {
                    const km = Math.hypot((e.lat - lat) * 110.57, (e.lon - lon) * kmLon);
                    if (km < mejorKm) { mejorKm = km; mejor = e.prov; }
                }
            }
        }
        return mejor;
    };
}

function procesarCargadores(raw, ref, estaciones = []) {
    // OperatorID -> nombre del operador (relevante para suscripciones)
    const operadores = new Map(((ref && ref.Operators) || []).map(o => [o.ID, o.Title]));
    const acceso = clasificadorAcceso(ref);
    const provinciaCercana = localizadorProvincias(estaciones);

    // A los que no publican precio, estimarPrecios() les añade `est`
    return estimarPrecios(raw
        .filter(p =>
            p.AddressInfo &&
            enEspana(p.AddressInfo.Latitude, p.AddressInfo.Longitude) &&
            ESTADOS_OK.has(p.StatusTypeID ?? 0) &&
            acceso(p.UsageTypeID) !== 'privado'
        )
        .map(p => {
            const conexiones = (p.Connections || []).filter(c => ESTADOS_OK.has(c.StatusTypeID ?? 0));
            const maxKW = conexiones.reduce((max, c) => Math.max(max, c.PowerKW || 0), 0);
            // ¿La conexión más potente es de corriente continua? (CurrentTypeID 30 = DC)
            const mejorConexion = conexiones.find(c => (c.PowerKW || 0) === maxKW);
            const dc = mejorConexion ? mejorConexion.CurrentTypeID === 30 : false;
            const puntos = p.NumberOfPoints || conexiones.reduce((t, c) => t + (c.Quantity || 0), 0) || null;

            const dir = p.AddressInfo;
            const address = [dir.AddressLine1, dir.Town || dir.StateOrProvince].filter(Boolean).join(', ');

            // Precio del conector principal (AC o DC) y recargos que no caben en él
            const coste = parsearCoste(p.UsageCost, { dc, kw: maxKW });

            return {
                id: `ocm-${p.ID}`,
                name: dir.Title || 'Punto de carga',
                address: address || dir.Postcode || '',
                lat: dir.Latitude,
                lon: dir.Longitude,
                prov: provinciaPorCodigoPostal(dir.Postcode) || provinciaCercana(dir.Latitude, dir.Longitude),
                op: operadores.get(p.OperatorID) || null,
                kw: maxKW,
                dc,
                puntos,
                // Precio publicado en €/kWh (0 = gratis, null = no publicado)
                precio: coste.precio,
                precioTexto: p.UsageCost ? String(p.UsageCost).slice(0, 80) : null,
                // Recargos: 'parking', 'min', 'hora', 'sesion' (solo si los hay)
                ...(coste.extra.length > 0 && { extra: coste.extra }),
                // Solo para clientes o visitantes del sitio (solo si lo es)
                ...(acceso(p.UsageTypeID) === 'clientes' && { cli: true })
            };
        })
        .filter(c => c.kw > 0)); // sin potencia conocida no se puede planificar
}

function main() {
    const [rawPath, refPath, outPath, estacionesPath] = process.argv.slice(2);
    if (!rawPath || !refPath || !outPath) {
        console.error('Uso: node procesar-cargadores.js <ocm_raw.json> <ocm_referencedata.json> <salida.json> [estaciones.json]');
        process.exit(1);
    }

    const leerJson = (p) => {
        let t = fs.readFileSync(p, 'utf8');
        if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
        return JSON.parse(t);
    };

    const raw = leerJson(rawPath);
    const ref = leerJson(refPath);
    // Gasolineras ya procesadas: solo para situar en su provincia los
    // cargadores sin código postal. Sin ellas, esos cargadores quedan sin provincia.
    let estaciones = [];
    if (estacionesPath && fs.existsSync(estacionesPath)) {
        try {
            estaciones = leerJson(estacionesPath).estaciones || [];
        } catch (e) {
            console.warn(`No se pudo leer ${estacionesPath}: ${e.message}`);
        }
    }

    const cargadores = procesarCargadores(raw, ref, estaciones);
    if (cargadores.length < MIN_CARGADORES) {
        console.error(`ERROR: OpenChargeMap devolvió solo ${cargadores.length} cargadores válidos (mínimo esperado: ${MIN_CARGADORES}). No se actualiza ${outPath}.`);
        process.exit(1);
    }

    // Si los cargadores no han cambiado, no se toca el fichero: así no se
    // genera un commit de varios MB dos veces al día solo por la fecha.
    if (fs.existsSync(outPath)) {
        try {
            const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
            if (JSON.stringify(prev.cargadores) === JSON.stringify(cargadores)) {
                console.log(`Sin cambios en los ${cargadores.length} cargadores; se conserva el fichero del ${prev.fecha}.`);
                return;
            }
        } catch (e) { /* fichero previo ilegible: continuar y sobrescribir */ }
    }

    const out = {
        fecha: new Date().toISOString().slice(0, 16).replace('T', ' '),
        cargadores
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(out));

    const conPrecio = cargadores.filter(c => c.precio !== null).length;
    const estimados = cargadores.filter(c => c.est !== undefined).length;
    console.log(`OK: ${cargadores.length} cargadores (${conPrecio} con precio publicado, ${estimados} estimados), máx ${Math.max(...cargadores.map(c => c.kw))} kW`);

    const acceso = clasificadorAcceso(ref);
    const privados = raw.filter(p => acceso(p.UsageTypeID) === 'privado').length;
    const soloClientes = cargadores.filter(c => c.cli).length;
    console.log(`Acceso: ${privados} privados descartados, ${soloClientes} marcados como solo para clientes`);
    console.log(`Provincia: ${cargadores.filter(c => c.prov).length} de ${cargadores.length} cargadores situados`);
}

if (require.main === module) main();

module.exports = { procesarCargadores, provinciaPorCodigoPostal, localizadorProvincias, enEspana, MIN_CARGADORES };
