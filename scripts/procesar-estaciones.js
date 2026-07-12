// Convierte el volcado crudo del API del Ministerio al formato interno de la
// app y lo escribe en data/estaciones.json.
//
// Uso: node scripts/procesar-estaciones.js <estaciones_raw.json> <salida.json>
const fs = require('fs');
const path = require('path');

const [rawPath, outPath] = process.argv.slice(2);
if (!rawPath || !outPath) {
    console.error('Uso: node procesar-estaciones.js <estaciones_raw.json> <salida.json>');
    process.exit(1);
}

let text = fs.readFileSync(rawPath, 'utf8');
if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // quitar BOM si existe
const raw = JSON.parse(text);

// "dd/mm/aaaa hh:mm:ss" → Date
function parseFecha(f) {
    const m = String(f || '').match(/(\d{2})\/(\d{2})\/(\d{4})[ T](\d{1,2}):(\d{2}):?(\d{2})?/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}

// Protección contra respuestas obsoletas: el API del Ministerio a veces sirve
// versiones cacheadas antiguas (llegó a devolver datos sin "Precio Adblue"
// horas después de haberlo incluido). No sobrescribir con datos más viejos.
if (fs.existsSync(outPath)) {
    try {
        const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        const prevDate = parseFecha(prev.fecha);
        const newDate = parseFecha(raw.Fecha);
        if (prevDate && newDate && newDate <= prevDate) {
            console.log(`El API devolvió datos de ${raw.Fecha}, no más recientes que los existentes (${prev.fecha}); se conservan los actuales.`);
            process.exit(0);
        }
    } catch (e) { /* fichero previo ilegible: continuar y sobrescribir */ }
}

const PRICE_FIELDS = {
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

const num = (v) => {
    const n = parseFloat(String(v || '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

const estaciones = raw.ListaEESSPrecio.map(s => {
    const prices = {};
    for (const [key, field] of Object.entries(PRICE_FIELDS)) {
        const p = num(s[field]);
        if (p !== null) prices[key] = p;
    }
    return {
        id: s['IDEESS'],
        name: s['Rótulo'],
        address: `${s['Dirección']}, ${s['Localidad']}`,
        lat: num(s['Latitud']),
        lon: num(s['Longitud (WGS84)']),
        tipoVenta: s['Tipo Venta'],
        horario: s['Horario'],
        prices
    };
}).filter(s => s.lat !== null && s.lon !== null);

const out = { fecha: raw.Fecha, estaciones };

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`OK: ${estaciones.length} estaciones, fecha ${out.fecha}`);
