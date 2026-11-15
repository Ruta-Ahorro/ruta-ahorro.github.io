// Tests de los algoritmos de optimización de paradas (worker.js).
// Ejecutar con: npm test
//
// Escenario principal: reproduce el bug histórico de "muchas paradas con poca
// gasolina" (gasolineras cada ~10 km con precios ligeramente descendentes) y
// comprueba que las restricciones actuales lo evitan.
const fs = require('fs');
const path = require('path');

// Stubs del entorno de Web Worker
global.importScripts = () => {};
global.self = {};
global.turf = require('@turf/turf');
global.postMessage = () => {};
// worker.js carga la geometría con importScripts('route-stations.js')
Object.assign(global, require('../route-stations.js'));

const workerCode = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
eval(workerCode);

let fallos = 0;
function check(cond, msg) {
    console.log(`${cond ? 'PASA' : 'FALLA'}: ${msg}`);
    if (!cond) fallos++;
}

// --- Escenario 1: precios descendentes a lo largo de la ruta ---
// Ruta recta de sur a norte por el meridiano 0: de lat 38 a lat 42 (~445 km).
const coords = [];
for (let lat = 38; lat <= 42.0001; lat += 0.05) coords.push([0, lat]);
const routeLine = turf.lineString(coords);
const routeDistance = turf.length(routeLine, { units: 'kilometers' });

// Gasolineras cada ~10 km pegadas a la ruta, cada una 0,002 €/L más barata.
const allGasStations = [];
let n = 0;
for (let lat = 38.05; lat < 42; lat += 0.09) {
    allGasStations.push({
        id: `S${n}`, name: `Estación ${n}`, address: `Km ${Math.round((lat - 38) * 111)}`,
        lat: lat, lon: 0.001,
        tipoVenta: 'P', horario: 'L-D: 24H',
        prices: { GA: 1.60 - n * 0.002 }
    });
    n++;
}

const params = {
    fuelType: 'GA',
    tankCapacity: 55,
    currentFuelPercent: 25,
    finalFuelPercent: 25,
    consumption: 6.5,
    searchRadius: 2,
    includeRestricted: false,
    algorithm: 'dynamic'
};

function resumen(nombre, res) {
    const amounts = res.stops.map(s => s.refuelAmount.toFixed(1));
    console.log(`\n${nombre}`);
    console.log(`  Paradas: ${res.stops.length}  |  Litros por parada: [${amounts.join(', ')}]`);
    console.log(`  Coste combustible: ${res.optimalCost.toFixed(2)} €`);
    const intermedias = res.stops.slice(0, -1);
    const pequenas = intermedias.filter(s => s.refuelAmount < 5 - 0.01).length;
    return { stops: res.stops.length, pequenas, coste: res.optimalCost };
}

console.log(`Escenario 1: ruta de ${routeDistance.toFixed(0)} km, ${allGasStations.length} gasolineras, precios descendentes\n`);

const viejo = resumen('DP sin restricciones (comportamiento antiguo)',
    calculateOptimalStops(routeLine, routeDistance, params, allGasStations, { stopPenalty: 0, minRefuelLiters: 0 }));
const nuevo = resumen('DP con restricciones',
    calculateOptimalStops(routeLine, routeDistance, params, allGasStations, {}));
const greedy = resumen('Greedy con restricciones',
    calculateOptimalStops2(routeLine, routeDistance, params, allGasStations, {}));

console.log('');
check(viejo.stops > 5 || viejo.pequenas > 0, 'el modo sin restricciones reproduce el problema histórico');
check(nuevo.stops <= 4, `DP hace pocas paradas (${nuevo.stops})`);
check(nuevo.pequenas === 0, 'DP: ninguna parada intermedia con menos de 5 L');
check(nuevo.coste <= viejo.coste * 1.10, `el coste del DP sigue siendo razonable (${nuevo.coste.toFixed(2)} € vs ${viejo.coste.toFixed(2)} €)`);
check(greedy.stops <= 4, `Greedy hace pocas paradas (${greedy.stops})`);

// Verificación física del plan del DP: nunca sin combustible ni sobrellenado
const resNuevo = calculateOptimalStops(routeLine, routeDistance, params, allGasStations, {});
let fuel = params.tankCapacity * params.currentFuelPercent / 100;
let pos = 0, fisicaOk = true;
for (const stop of resNuevo.stops) {
    fuel -= (stop.distanceFromStart - pos) / 100 * params.consumption;
    if (fuel < -0.01) fisicaOk = false;
    fuel += stop.refuelAmount;
    if (fuel > params.tankCapacity + 0.01) fisicaOk = false;
    pos = stop.distanceFromStart;
}
fuel -= (routeDistance - pos) / 100 * params.consumption;
check(fisicaOk, 'el plan nunca se queda sin combustible ni sobrellena el depósito');
check(fuel >= params.tankCapacity * params.finalFuelPercent / 100 - 0.1,
    `se llega con el combustible final deseado (${fuel.toFixed(1)} L)`);

// Caso límite: depósito minúsculo — el reintento relajado debe salvar la ruta
const paramsChico = { ...params, tankCapacity: 6, currentFuelPercent: 50, finalFuelPercent: 0 };
let strictFallo = false, relaxedOk = false;
try { calculateOptimalStops(routeLine, routeDistance, paramsChico, allGasStations, {}); } catch (e) { strictFallo = true; }
try {
    const r = calculateOptimalStops(routeLine, routeDistance, paramsChico, allGasStations, { stopPenalty: 0, minRefuelLiters: 0 });
    relaxedOk = r.stops.length > 0;
} catch (e) { /* también falla relajado */ }
check(!strictFallo || relaxedOk, 'caso límite depósito 6 L: alguna variante encuentra solución');

// --- Escenario 2: coste del desvío ---
// Dos gasolineras a la misma altura de la ruta (km ~60): A pegada a la ruta a
// 1,50 €/L y B un poco más barata (1,49 €/L) pero a ~7 km de desvío. El ahorro
// de B (~0,4 €) no compensa el combustible del desvío (~1,4 €): debe ganar A.
console.log('\nEscenario 2: gasolinera barata lejos de la ruta vs. algo más cara al pie de la ruta\n');

const detourStations = [
    { id: 'A', name: 'Cercana', address: '', lat: 38.54, lon: 0.001, tipoVenta: 'P', horario: 'L-D: 24H', prices: { GA: 1.50 } },
    { id: 'B', name: 'Lejana', address: '', lat: 38.55, lon: 0.08, tipoVenta: 'P', horario: 'L-D: 24H', prices: { GA: 1.49 } }
];
// 15 % de salida: suficiente para llegar al km 60 sin tocar la reserva del 5 %
const detourParams = { ...params, currentFuelPercent: 15, finalFuelPercent: 0, searchRadius: 10 };

const dpDetour = calculateOptimalStops(routeLine, routeDistance, detourParams, detourStations, {});
const greedyDetour = calculateOptimalStops2(routeLine, routeDistance, detourParams, detourStations, {});
check(dpDetour.stops.length === 1 && dpDetour.stops[0].id === 'A',
    `DP elige la gasolinera cercana pese a ser algo más cara (eligió ${dpDetour.stops[0]?.id})`);
check(greedyDetour.stops.length >= 1 && greedyDetour.stops[0].id === 'A',
    `Greedy elige la gasolinera cercana pese a ser algo más cara (eligió ${greedyDetour.stops[0]?.id})`);

// --- Escenario 3: ruta con curvas (en U) ---
// Sube 2º de latitud, cruza 0,3º de longitud y vuelve a bajar: ~470 km de
// recorrido, pero origen y destino quedan a ~26 km en línea recta. Reproduce
// el bug de medir el km de cada gasolinera en línea recta desde el origen: la
// gasolinera barata del final (km real ~458) parecía estar en el km ~28 y el
// plan mandaba ir directo a ella con 154 km de autonomía.
console.log('\nEscenario 3: ruta en U, los km se miden a lo largo de la ruta\n');

const uCoords = [];
for (let i = 0; i <= 100; i++) uCoords.push([0, +(40 + i * 0.02).toFixed(4)]);
for (let i = 1; i <= 15; i++) uCoords.push([+(i * 0.02).toFixed(4), 42]);
for (let i = 1; i <= 100; i++) uCoords.push([0.3, +(42 - i * 0.02).toFixed(4)]);
const uLine = turf.lineString(uCoords);
const uDistance = turf.length(uLine, { units: 'kilometers' });

// Km real de un vértice de la ruta, calculado sin pasar por el worker
const kmDeVertice = (idx) => turf.length(turf.lineString(uCoords.slice(0, idx + 1)), { units: 'kilometers' });
const IDX_INICIO = 10;   // tramo de subida, lat 40.2
const IDX_FINAL = 210;   // tramo de bajada, lat 40.1 (casi en el destino)
const uStations = [
    { id: 'INICIO', name: 'Inicio', address: '', lat: uCoords[IDX_INICIO][1], lon: uCoords[IDX_INICIO][0], tipoVenta: 'P', horario: 'L-D: 24H', prices: { GA: 1.70 } },
    { id: 'FINAL', name: 'Casi al final', address: '', lat: uCoords[IDX_FINAL][1], lon: uCoords[IDX_FINAL][0], tipoVenta: 'P', horario: 'L-D: 24H', prices: { GA: 1.40 } }
];
const kmReal = { INICIO: kmDeVertice(IDX_INICIO), FINAL: kmDeVertice(IDX_FINAL) };
const uParams = { ...params, tankCapacity: 50, currentFuelPercent: 20, finalFuelPercent: 0 };

console.log(`Ruta de ${uDistance.toFixed(0)} km; gasolineras en el km ${kmReal.INICIO.toFixed(0)} y ${kmReal.FINAL.toFixed(0)}; autonomía inicial ${(50 * 0.2 / 6.5 * 100).toFixed(0)} km\n`);

for (const [nombre, fn] of [['DP', calculateOptimalStops], ['Greedy', calculateOptimalStops2]]) {
    const res = fn(uLine, uDistance, uParams, uStations, {});
    const kmOk = res.stops.every(s => Math.abs(s.distanceFromStart - kmReal[s.id]) < 1);
    check(kmOk, `${nombre}: el km de cada parada es el del recorrido (${res.stops.map(s => `${s.id} km ${s.distanceFromStart.toFixed(0)}`).join(', ')})`);
    check(res.stops[0]?.id === 'INICIO', `${nombre}: reposta antes de quedarse sin autonomía (primera parada: ${res.stops[0]?.id})`);

    // Simulación física con los km reales del recorrido
    let f = uParams.tankCapacity * uParams.currentFuelPercent / 100, p = 0, ok = true;
    for (const stop of res.stops) {
        f -= (kmReal[stop.id] - p) / 100 * uParams.consumption;
        if (f < -0.01) ok = false;
        f += stop.refuelAmount;
        if (f > uParams.tankCapacity + 0.01) ok = false;
        p = kmReal[stop.id];
    }
    f -= (uDistance - p) / 100 * uParams.consumption;
    check(ok && f >= -0.01, `${nombre}: el plan nunca se queda sin combustible en la ruta en U (llega con ${f.toFixed(1)} L)`);
}

// --- Escenario 4: reserva de seguridad ---
// Con las restricciones normales el plan nunca debe bajar del 5 % del depósito.
console.log('\nEscenario 4: reserva de seguridad del 5 %\n');

function nivelMinimo(res, p, dist) {
    let f = p.tankCapacity * p.currentFuelPercent / 100, pos2 = 0, min = f, max = 0;
    for (const stop of res.stops) {
        f -= (stop.distanceFromStart - pos2) / 100 * p.consumption;
        min = Math.min(min, f);
        f += stop.refuelAmount;
        max = Math.max(max, f);
        pos2 = stop.distanceFromStart;
    }
    f -= (dist - pos2) / 100 * p.consumption;
    return { min: Math.min(min, f), maxTrasRepostar: max, llegada: f };
}

for (const [nombre, fn] of [['DP', calculateOptimalStops], ['Greedy', calculateOptimalStops2]]) {
    const p = { ...params, finalFuelPercent: 0 };
    const niveles = nivelMinimo(fn(routeLine, routeDistance, p, allGasStations, {}), p, routeDistance);
    const reserva = p.tankCapacity * 0.05;
    check(niveles.min >= reserva - 0.01, `${nombre}: el nivel mínimo (${niveles.min.toFixed(2)} L) no baja de la reserva (${reserva.toFixed(2)} L)`);
}

// Saliendo ya por debajo de la reserva, planRoute debe recurrir al modo
// relajado y avisar con `relaxed`.
const enReserva = planRoute(routeLine, routeDistance, { ...params, currentFuelPercent: 3, algorithm: 'dynamic' }, allGasStations);
check(enReserva.relaxed === true && enReserva.stops.length > 0, 'saliendo con un 3 % se encuentra plan y se marca como apurado (relaxed)');
const normal = planRoute(routeLine, routeDistance, { ...params, algorithm: 'dynamic' }, allGasStations);
check(!normal.relaxed, 'un plan normal no se marca como apurado');

// --- Escenario 5: eléctricos (cargadores gratuitos y carga máxima) ---
console.log('\nEscenario 5: cargador gratuito y carga máxima del 80 %\n');

const evLine = turf.lineString(coords.slice(0, 41)); // ~222 km
const evDistance = turf.length(evLine, { units: 'kilometers' });
const evStations = [
    { id: 'GRATIS', name: 'Gratis', address: '', lat: 38.5, lon: 0.001, tipoVenta: 'P', horario: '', kw: 50, prices: { EV: 0 } },
    { id: 'PAGO', name: 'De pago', address: '', lat: 38.52, lon: 0.001, tipoVenta: 'P', horario: '', kw: 50, prices: { EV: 0.55 } }
];
const evParams = { fuelType: 'EV', tankCapacity: 60, currentFuelPercent: 30, finalFuelPercent: 10, consumption: 16, searchRadius: 2, includeRestricted: false };

for (const [nombre, fn] of [['DP', calculateOptimalStops], ['Greedy', calculateOptimalStops2]]) {
    const res = fn(evLine, evDistance, evParams, evStations, {});
    check(res.stops.length === 1 && res.stops[0].id === 'GRATIS', `${nombre}: usa el cargador gratuito (eligió ${res.stops.map(s => s.id).join(', ')})`);
    check(res.optimalCost === 0, `${nombre}: la carga gratuita cuesta 0 €`);
}
check(!hasPrice({ prices: { GA: 0 } }, 'GA') && hasPrice({ prices: { EV: 0 } }, 'EV') && !hasPrice({ prices: {} }, 'EV'),
    'precio 0 es válido en eléctricos, pero "sin dato" en carburantes');

// Con carga máxima del 80 % ninguna carga deja la batería por encima de 48 kWh
const evLargo = { ...evParams, maxFillPercent: 80, currentFuelPercent: 50 };
const cargadores = [];
for (let lat = 38.1, k = 0; lat < 42; lat += 0.2, k++) {
    cargadores.push({ id: `C${k}`, name: `Cargador ${k}`, address: '', lat, lon: 0.001, tipoVenta: 'P', horario: '', kw: 150, prices: { EV: 0.45 + (k % 3) * 0.05 } });
}
for (const [nombre, fn] of [['DP', calculateOptimalStops], ['Greedy', calculateOptimalStops2]]) {
    const res = fn(routeLine, routeDistance, evLargo, cargadores, {});
    const niveles = nivelMinimo(res, evLargo, routeDistance);
    check(res.stops.length > 0 && niveles.maxTrasRepostar <= 48 + 0.01,
        `${nombre}: con carga máxima del 80 % nunca se pasa de 48 kWh (máximo ${niveles.maxTrasRepostar.toFixed(1)} kWh, ${res.stops.length} paradas)`);
    check(niveles.min >= 3 - 0.01 && niveles.llegada >= 6 - 0.01,
        `${nombre}: respeta la reserva y la batería en destino (mínimo ${niveles.min.toFixed(1)} kWh, llegada ${niveles.llegada.toFixed(1)} kWh)`);
}

// --- Escenario 6: la geometría propia coincide con Turf ---
console.log('\nEscenario 6: route-stations.js frente a Turf\n');

const indice = buildRouteIndex(uLine);
let maxErrKm = 0, maxErrDesvio = 0;
for (const [lon, lat] of [[0.004, 40.31], [-0.01, 41.2], [0.15, 42.012], [0.31, 41.07], [0.29, 40.02], [0.02, 40.0]]) {
    const propio = locateOnRoute(indice, lon, lat);
    const pt = turf.point([lon, lat]);
    const deTurf = turf.nearestPointOnLine(uLine, pt, { units: 'kilometers' });
    maxErrKm = Math.max(maxErrKm, Math.abs(propio.distanceFromStart - deTurf.properties.location));
    maxErrDesvio = Math.max(maxErrDesvio, Math.abs(propio.distanceToRoute - turf.pointToLineDistance(pt, uLine, { units: 'kilometers' })));
}
check(maxErrKm < 0.05, `el km en ruta difiere de Turf menos de 50 m (máx. ${(maxErrKm * 1000).toFixed(1)} m)`);
check(maxErrDesvio < 0.02, `la distancia a la ruta difiere de Turf menos de 20 m (máx. ${(maxErrDesvio * 1000).toFixed(1)} m)`);
check(Math.abs(indice.length - uDistance) < 0.01, 'la longitud de la ruta coincide con turf.length');

console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASAN' : `\n${fallos} PRUEBAS FALLAN`);
process.exit(fallos === 0 ? 0 : 1);
