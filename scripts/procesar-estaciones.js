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
