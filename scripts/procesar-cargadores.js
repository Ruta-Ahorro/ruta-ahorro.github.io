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

function procesarCargadores(raw, ref) {
    // OperatorID -> nombre del operador (relevante para suscripciones)
    const operadores = new Map(((ref && ref.Operators) || []).map(o => [o.ID, o.Title]));

    // A los que no publican precio, estimarPrecios() les añade `est`
    return estimarPrecios(raw
        .filter(p =>
            p.AddressInfo &&
            enEspana(p.AddressInfo.Latitude, p.AddressInfo.Longitude) &&
            ESTADOS_OK.has(p.StatusTypeID ?? 0)
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
                op: operadores.get(p.OperatorID) || null,
                kw: maxKW,
                dc,
                puntos,
                // Precio publicado en €/kWh (0 = gratis, null = no publicado)
                precio: coste.precio,
                precioTexto: p.UsageCost ? String(p.UsageCost).slice(0, 80) : null,
                // Recargos: 'parking', 'min', 'hora', 'sesion' (solo si los hay)
                ...(coste.extra.length > 0 && { extra: coste.extra })
            };
        })
        .filter(c => c.kw > 0)); // sin potencia conocida no se puede planificar
}

function main() {
    const [rawPath, refPath, outPath] = process.argv.slice(2);
    if (!rawPath || !refPath || !outPath) {
        console.error('Uso: node procesar-cargadores.js <ocm_raw.json> <ocm_referencedata.json> <salida.json>');
        process.exit(1);
    }

    const leerJson = (p) => {
        let t = fs.readFileSync(p, 'utf8');
        if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
        return JSON.parse(t);
    };

    const cargadores = procesarCargadores(leerJson(rawPath), leerJson(refPath));
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
}

if (require.main === module) main();

module.exports = { procesarCargadores, enEspana, MIN_CARGADORES };
