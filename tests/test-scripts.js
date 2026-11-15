// Tests de los scripts que generan los datos (scripts/procesar-*.js).
// Ejecutar con: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { parsearPrecio, procesarCargadores } = require('../scripts/procesar-cargadores.js');
const { procesarEstaciones, MIN_ESTACIONES } = require('../scripts/procesar-estaciones.js');

let fallos = 0;
function check(cond, msg) {
    console.log(`${cond ? 'PASA' : 'FALLA'}: ${msg}`);
    if (!cond) fallos++;
}

// --- Precio de los cargadores (texto libre de OpenChargeMap) ---
console.log('Precio de los cargadores\n');

const casosPrecio = [
    ['0,39€/kWh', 0.39],
    ['0,50€/kWh DC - 0,35kWh AC', 0.5],
    ['0.45 €/kWh', 0.45],
    ['free', 0],
    ['Free', 0],
    ['Gratis', 0],
    ['free ', 0],
    ['Gratis/Free', 0],
    ['free of charge ', 0],
    // Lo gratuito es el aparcamiento, o depende de condiciones: precio desconocido
    ["app Waylet(Repsol). 90' free parking, then at 0,07€/min", null],
    ['Free for clients', null],
    ['Free with MELIB card', null],
    ["First 40' free parking ", null],
    ['free charging + parking fee', null],
    // Un precio por kWh manda aunque el texto mencione algo gratis
    ['parking fee + 0,20€/kWh (0,01€/min parked without charging) First hour free', 0.2],
    // Valores absurdos y textos sin precio
    ['25,00€/kWh', null],
    ['0,07€/min', null],
    ['', null],
    [null, null]
];
for (const [texto, esperado] of casosPrecio) {
    const obtenido = parsearPrecio(texto);
    check(obtenido === esperado, `${JSON.stringify(texto)} → ${esperado} (obtenido ${obtenido})`);
}

// --- Cargadores: filtros ---
console.log('\nFiltros de cargadores\n');

const punto = (id, lat, lon, kw, extra = {}) => ({
    ID: id, StatusTypeID: 50, UsageCost: '0,40€/kWh',
    AddressInfo: { Title: `Punto ${id}`, AddressLine1: 'Calle', Town: 'Ciudad', Latitude: lat, Longitude: lon },
    Connections: [{ PowerKW: kw, CurrentTypeID: 30, StatusTypeID: 50, Quantity: 2 }],
    ...extra
});
const cargadores = procesarCargadores([
    punto(1, 40.4, -3.7, 150),
    punto(2, 0, 0, 50),                              // coordenadas fuera de España
    punto(3, 41.4, 2.1, 0),                          // sin potencia conocida
    punto(4, 37.4, -6.0, 22, { StatusTypeID: 100 })  // fuera de servicio
], { Operators: [] });
check(cargadores.length === 1 && cargadores[0].id === 'ocm-1', 'solo queda el cargador operativo, con potencia y en España');
check(cargadores[0].kw === 150 && cargadores[0].dc === true && cargadores[0].precio === 0.4, 'potencia, tipo de corriente y precio correctos');

// --- Estaciones: conversión y filtros ---
console.log('\nEstaciones del Ministerio\n');

const estacion = (id, lat, lon, precio) => ({
    'IDEESS': String(id), 'Rótulo': `EESS ${id}`, 'Dirección': 'CALLE 1', 'Localidad': 'PUEBLO',
    'Latitud': lat, 'Longitud (WGS84)': lon, 'Tipo Venta': 'P', 'Horario': 'L-D: 24H',
    'Precio Gasoleo A': precio, 'Precio Gasolina 95 E5': ''
});
const estaciones = procesarEstaciones({ ListaEESSPrecio: [
    estacion(1, '40,416775', '-3,703790', '1,459'),
    estacion(2, '0,000000', '0,000000', '1,500'),   // coordenadas 0,0
    estacion(3, '', '', '1,500'),                   // sin coordenadas
    estacion(4, '28,100000', '-15,400000', '0,000') // Canarias, precio 0 = sin dato
] });
check(estaciones.length === 2, `se descartan las estaciones sin coordenadas válidas (quedan ${estaciones.length})`);
check(estaciones[0].lat === 40.416775 && estaciones[0].lon === -3.70379, 'las coordenadas con coma decimal se convierten a número');
check(estaciones[0].prices.GA === 1.459 && !('G95E5' in estaciones[0].prices), 'los precios vacíos no se guardan');
check(!('GA' in estaciones[1].prices), 'un precio 0 se trata como "sin dato"');

// --- Protección contra respuestas incompletas ---
console.log('\nProtección contra respuestas incompletas\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ruta-ahorro-'));
const rawPath = path.join(tmp, 'raw.json');
const outPath = path.join(tmp, 'estaciones.json');
const previo = JSON.stringify({ fecha: '01/01/2026 08:00:00', estaciones: [{ id: 'previa' }] });
fs.writeFileSync(outPath, previo);
fs.writeFileSync(rawPath, JSON.stringify({ Fecha: '02/01/2026 08:00:00', ListaEESSPrecio: [estacion(1, '40,4', '-3,7', '1,459')] }));

const script = path.join(__dirname, '..', 'scripts', 'procesar-estaciones.js');
const run = spawnSync(process.execPath, [script, rawPath, outPath], { encoding: 'utf8' });
check(run.status === 1, `con menos de ${MIN_ESTACIONES} estaciones el script termina con error (código ${run.status})`);
check(fs.readFileSync(outPath, 'utf8') === previo, 'y el fichero publicado anterior no se toca');
fs.rmSync(tmp, { recursive: true, force: true });

console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASAN' : `\n${fallos} PRUEBAS FALLAN`);
process.exit(fallos === 0 ? 0 : 1);
