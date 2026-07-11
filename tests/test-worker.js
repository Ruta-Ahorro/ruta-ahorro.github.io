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
const detourParams = { ...params, currentFuelPercent: 10, finalFuelPercent: 0, searchRadius: 10 };

const dpDetour = calculateOptimalStops(routeLine, routeDistance, detourParams, detourStations, {});
const greedyDetour = calculateOptimalStops2(routeLine, routeDistance, detourParams, detourStations, {});
check(dpDetour.stops.length === 1 && dpDetour.stops[0].id === 'A',
    `DP elige la gasolinera cercana pese a ser algo más cara (eligió ${dpDetour.stops[0]?.id})`);
check(greedyDetour.stops.length >= 1 && greedyDetour.stops[0].id === 'A',
    `Greedy elige la gasolinera cercana pese a ser algo más cara (eligió ${greedyDetour.stops[0]?.id})`);

console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASAN' : `\n${fallos} PRUEBAS FALLAN`);
process.exit(fallos === 0 ? 0 : 1);
