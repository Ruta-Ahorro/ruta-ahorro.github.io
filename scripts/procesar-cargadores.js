// Convierte el volcado crudo de OpenChargeMap (compact=true) al formato
// interno de la app y lo escribe en data/cargadores.json.
//
// Uso: node scripts/procesar-cargadores.js <ocm_raw.json> <ocm_referencedata.json> <salida.json>
//
// Lo ejecuta el workflow de GitHub Actions (actualizar-datos.yml) y también
// sirve para regenerar los datos en local.
const fs = require('fs');

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

const raw = leerJson(rawPath);
const ref = leerJson(refPath);

// OperatorID -> nombre del operador (relevante para suscripciones)
const operadores = new Map((ref.Operators || []).map(o => [o.ID, o.Title]));

// Estados que consideramos utilizables: desconocido, operativo o parcialmente operativo
const ESTADOS_OK = new Set([0, 50, 75]);

// Intenta extraer un precio en €/kWh del texto libre de UsageCost.
// Ejemplos reales: "0,39€/kWh", "0,50€/kWh DC - 0,35kWh AC", "free", "gratis"
function parsearPrecio(texto) {
    if (!texto) return null;
    if (/gratis|free|gratuito/i.test(texto)) return 0;
    const m = texto.match(/(\d+[.,]\d+)\s*€?\s*\/?\s*kwh/i);
    if (!m) return null;
    const precio = parseFloat(m[1].replace(',', '.'));
    // Descartar valores absurdos (texto mal formateado)
    return precio > 0 && precio < 3 ? precio : null;
}

const cargadores = raw
    .filter(p =>
        p.AddressInfo &&
        Number.isFinite(p.AddressInfo.Latitude) &&
        Number.isFinite(p.AddressInfo.Longitude) &&
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
            precio: parsearPrecio(p.UsageCost),
            precioTexto: p.UsageCost ? String(p.UsageCost).slice(0, 80) : null
        };
    })
    .filter(c => c.kw > 0); // sin potencia conocida no se puede planificar

const out = {
    fecha: new Date().toISOString().slice(0, 16).replace('T', ' '),
    cargadores
};

fs.mkdirSync(require('path').dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));

const conPrecio = cargadores.filter(c => c.precio !== null).length;
console.log(`OK: ${cargadores.length} cargadores (${conPrecio} con precio), máx ${Math.max(...cargadores.map(c => c.kw))} kW`);
