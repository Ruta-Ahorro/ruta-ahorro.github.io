// Web Worker con los dos algoritmos de optimización de paradas.
// La geometría (qué estaciones están en la ruta y en qué kilómetro) vive en
// route-stations.js, compartido con app.js.
importScripts('route-stations.js');

// --- Ajustes anti "muchas paradas con repostajes ridículos" ---
// Sin estas restricciones, el óptimo matemático puede ser parar en cada
// gasolinera ligeramente más barata y echar cantidades mínimas (p. ej. 0,5 L),
// algo correcto sobre el papel pero absurdo en la práctica.
const STOP_PENALTY_EUR = 0.50;  // coste "virtual" de cada parada (tiempo, desvío)
const MIN_REFUEL_LITERS = 5;    // repostaje mínimo planificable en paradas intermedias

// --- Reserva de seguridad ---
// El plan nunca cuenta con este porcentaje del depósito/batería: sin él, el
// óptimo matemático llega a cada gasolinera con el depósito exactamente a
// cero, y cualquier atasco o desvío deja al conductor tirado.
const RESERVE_PERCENT = 5;

const EPS = 1e-6;

// Traduce los parámetros del usuario al combustible "utilizable" (por encima
// de la reserva). Los algoritmos trabajan solo con estas cantidades; los
// litros a repostar que devuelven son los reales.
//  - capacity: lo que queda utilizable tras llenar hasta el máximo permitido
//    (maxFillPercent, p. ej. 80 % en eléctricos).
//  - initial / desired: nivel de salida y nivel deseado en destino.
function buildTankModel(params, opts) {
    const { tankCapacity, currentFuelPercent, finalFuelPercent = 0, maxFillPercent = 100 } = params;
    const reservePercent = opts.reservePercent ?? RESERVE_PERCENT;
    const reserve = tankCapacity * reservePercent / 100;
    const fillLevel = tankCapacity * Math.min(100, Math.max(1, maxFillPercent)) / 100;
    return {
        capacity: Math.max(0, fillLevel - reserve),
        initial: Math.max(0, tankCapacity * currentFuelPercent / 100 - reserve),
        desired: Math.max(0, tankCapacity * finalFuelPercent / 100 - reserve)
    };
}

function priceStats(stationsOnRoute, fuelType) {
    const prices = stationsOnRoute.map(s => s.prices[fuelType]);
    return {
        maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
        avgPrice: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
    };
}

function buildResult(plannedStops, avgPrice, maxPrice) {
    const totalRefuelAmount = plannedStops.reduce((total, stop) => total + stop.refuelAmount, 0);
    return {
        stops: plannedStops,
        // El coste que se muestra es solo el del combustible: la penalización
        // por parada es interna, solo influye en la decisión.
        optimalCost: plannedStops.reduce((total, stop) => total + stop.refuelCost, 0),
        avgPriceCost: totalRefuelAmount * avgPrice,
        maxPriceCost: totalRefuelAmount * maxPrice
    };
}

// Busca en una lista ascendente de niveles el que coincide con g (± EPS).
function findState(levels, g) {
    let lo = 0, hi = levels.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const diff = levels[mid] - g;
        if (Math.abs(diff) < EPS) return mid;
        if (diff < 0) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
}

// --- Programación dinámica: minimiza el coste total del viaje ---
function calculateOptimalStops(routeLine, routeDistance, params, allGasStations, opts = {}) {
    const stopPenalty = opts.stopPenalty ?? STOP_PENALTY_EUR;
    const minRefuelLiters = opts.minRefuelLiters ?? MIN_REFUEL_LITERS;
    const { fuelType, consumption } = params;
    const model = buildTankModel(params, opts);

    const stationsOnRoute = findStationsOnRoute(routeLine, routeDistance, params, allGasStations);
    const { avgPrice, maxPrice } = priceStats(stationsOnRoute, fuelType);

    // Todo en km de autonomía
    const U = model.capacity / consumption * 100;            // autonomía tras llenar
    const initial_range = model.initial / consumption * 100;
    const desired_range = model.desired / consumption * 100;
    const minAmountKm = minRefuelLiters / consumption * 100; // repostaje mínimo

    const n = stationsOnRoute.length;
    if (n === 0) {
        if (routeDistance + desired_range <= initial_range + EPS) {
            return buildResult([], 0, 0);
        }
        throw new Error("No se puede completar la ruta. No hay gasolineras y el combustible inicial es insuficiente.");
    }

    stationsOnRoute.forEach(s => {
        s.c = s.prices[fuelType] * (consumption / 100); // coste por km
        // Coste del desvío: ida y vuelta desde la ruta hasta la gasolinera,
        // valorado al precio por km de esa misma gasolinera.
        s.detourCost = 2 * s.distanceToRoute * s.c;
    });

    // Estados por estación: levels[i] = niveles de llegada posibles (ascendente),
    // states[i][j] = mejor decisión llegando con levels[i][j].
    const levels = Array.from({ length: n }, () => []);
    const states = Array.from({ length: n }, () => []);

    for (let i = n - 1; i >= 0; i--) {
        // Niveles con los que se puede llegar a la estación i
        const gvSet = new Set([0]);
        for (let k = 0; k < i; k++) {
            const dist_k_i = stationsOnRoute[i].distanceFromStart - stationsOnRoute[k].distanceFromStart;
            if (dist_k_i <= U + EPS && stationsOnRoute[k].c < stationsOnRoute[i].c) {
                gvSet.add(U - dist_k_i);
            }
        }
        const dist_start_i = stationsOnRoute[i].distanceFromStart;
        if (dist_start_i <= initial_range + EPS) {
            gvSet.add(initial_range - dist_start_i);
        }

        const sorted = Array.from(gvSet).sort((a, b) => a - b);
        const uniqueGv = [];
        for (const val of sorted) {
            if (uniqueGv.length === 0 || Math.abs(val - uniqueGv[uniqueGv.length - 1]) > EPS) {
                uniqueGv.push(val);
            }
        }

        const price_i = stationsOnRoute[i].c;
        const dist_i_end = routeDistance - stationsOnRoute[i].distanceFromStart;

        for (const g of uniqueGv) {
            if (g < 0) continue;

            let minCost = Infinity;
            let bestNext = -1;
            let bestAmount = 0;
            let bestArrivalG = 0;

            // Directo al destino
            const l = dist_i_end + desired_range;
            if (l <= U + EPS) {
                const amount = Math.max(0, l - g);
                minCost = amount * price_i;
                bestNext = -1;
                bestAmount = amount;
                bestArrivalG = desired_range;
            }

            // A otra estación v > i
            for (let v = i + 1; v < n; v++) {
                const dist_i_v = stationsOnRoute[v].distanceFromStart - stationsOnRoute[i].distanceFromStart;
                if (dist_i_v > U + EPS) break;

                let amount, arrival_g_v;
                if (stationsOnRoute[v].c <= price_i) {
                    // La siguiente es igual o más barata: echar lo justo para llegar
                    if (g > dist_i_v + EPS) continue;
                    amount = dist_i_v - g;
                    arrival_g_v = 0;
                } else {
                    // La siguiente es más cara: llenar aquí
                    amount = U - g;
                    arrival_g_v = U - dist_i_v;
                }
                if (amount < minAmountKm - EPS) continue; // repostaje mínimo

                const j = findState(levels[v], arrival_g_v);
                if (j === -1) continue;
                const cost = amount * price_i + states[v][j].cost;
                if (cost < minCost) {
                    minCost = cost;
                    bestNext = v;
                    bestAmount = amount;
                    bestArrivalG = arrival_g_v;
                }
            }

            if (minCost < Infinity) {
                // La penalización por parada y el coste del desvío encarecen cada
                // stop: así el óptimo deja de incluir paradas que solo ahorran
                // unos céntimos o que exigen desviarse mucho de la ruta.
                levels[i].push(g);
                states[i].push({
                    cost: minCost + stopPenalty + stationsOnRoute[i].detourCost,
                    nextV: bestNext,
                    amount: bestAmount,
                    arrivalGNext: bestArrivalG
                });
            }
        }
    }

    // Mejor primera parada (o ninguna)
    let optimalCost = Infinity;
    let bestFirst = -1;
    let bestG = 0;
    if (routeDistance + desired_range <= initial_range + EPS) {
        optimalCost = 0; // se llega sin parar
    }
    for (let v = 0; v < n; v++) {
        const dist_start_v = stationsOnRoute[v].distanceFromStart;
        if (dist_start_v > initial_range + EPS) continue;
        const g = initial_range - dist_start_v;
        const j = findState(levels[v], g);
        if (j !== -1 && states[v][j].cost < optimalCost) {
            optimalCost = states[v][j].cost;
            bestFirst = v;
            bestG = g;
        }
    }

    if (optimalCost === Infinity) {
        throw new Error("No se puede completar la ruta. No hay gasolineras alcanzables para completar el viaje con los requisitos.");
    }

    // Reconstruir el plan
    const plannedStops = [];
    let currentI = bestFirst;
    let currentG = bestG;
    while (currentI !== -1) {
        const j = findState(levels[currentI], currentG);
        if (j === -1) {
            throw new Error("Error interno al reconstruir el plan de paradas. Inténtalo con otra configuración.");
        }
        const { nextV, amount, arrivalGNext } = states[currentI][j];
        const stop = { ...stationsOnRoute[currentI] };
        stop.refuelAmount = amount * (consumption / 100); // de km a litros/kWh
        stop.refuelCost = stop.refuelAmount * stop.prices[fuelType];
        plannedStops.push(stop);
        currentI = nextV;
        currentG = arrivalGNext;
    }

    return buildResult(plannedStops, avgPrice, maxPrice);
}

// --- Codicioso: en cada tramo, la estación alcanzable con mejor precio efectivo ---
function calculateOptimalStops2(routeLine, routeDistance, params, allGasStations, opts = {}) {
    const minRefuelLiters = opts.minRefuelLiters ?? MIN_REFUEL_LITERS;
    const { fuelType, consumption } = params;
    const model = buildTankModel(params, opts);
    const capacity = model.capacity;
    const desiredFuel = model.desired;

    const stationsOnRoute = findStationsOnRoute(routeLine, routeDistance, params, allGasStations);
    const { avgPrice, maxPrice } = priceStats(stationsOnRoute, fuelType);

    const plannedStops = [];
    const used = new Set();
    let currentDist = 0;
    let currentFuel = model.initial;

    const addStop = (station, amount) => {
        used.add(station.id);
        if (amount <= 0.01) return; // llegamos con más de lo que cabe: no es una parada
        plannedStops.push({ ...station, refuelAmount: amount, refuelCost: amount * station.prices[fuelType] });
    };
    const fuelAtArrival = (s) => currentFuel - ((s.distanceFromStart - currentDist) / 100) * consumption;

    while (currentDist < routeDistance) {
        const range = (currentFuel / consumption) * 100;
        if (currentDist + range >= routeDistance) break;

        const reachableStations = stationsOnRoute.filter(s =>
            !used.has(s.id) && s.distanceFromStart >= currentDist && s.distanceFromStart <= currentDist + range);
        if (reachableStations.length === 0) {
            throw new Error("No se puede completar la ruta. No hay gasolineras alcanzables en el siguiente tramo.");
        }

        // Evitar paradas ridículas: descartar gasolineras donde llegaríamos casi
        // llenos (el llenado sería menor que el repostaje mínimo). Si el filtro
        // vacía la lista, usar todas para no declarar la ruta imposible.
        const usefulStations = reachableStations.filter(s => (capacity - fuelAtArrival(s)) >= minRefuelLiters);
        const candidates = usefulStations.length > 0 ? usefulStations : reachableStations;

        // Elegir por precio efectivo: al precio del surtidor se le suma el
        // combustible del desvío (ida y vuelta hasta la gasolinera) prorrateado
        // entre los litros que repostaríamos allí. En empates, la más lejana
        // para saltar clusters.
        const effectivePrice = (s) => {
            const refill = Math.max(capacity - fuelAtArrival(s), 0.1);
            const detourFuel = 2 * s.distanceToRoute * (consumption / 100);
            return s.prices[fuelType] * (refill + detourFuel) / refill;
        };
        const nextStop = candidates.reduce((best, s) => {
            const priceS = effectivePrice(s);
            const priceBest = effectivePrice(best);
            if (priceS < priceBest - 1e-9) return s;
            if (Math.abs(priceS - priceBest) <= 1e-9 && s.distanceFromStart > best.distanceFromStart) return s;
            return best;
        }, candidates[0]);

        currentFuel = fuelAtArrival(nextStop);
        currentDist = nextStop.distanceFromStart;

        const fuelToRefill = Math.max(0, capacity - currentFuel);
        addStop(nextStop, fuelToRefill);
        currentFuel += fuelToRefill;
    }

    // ¿Se llega con el nivel deseado? Si no, añadir una parada cerca del final.
    const projectedFuelAtDest = currentFuel - ((routeDistance - currentDist) / 100) * consumption;

    if (projectedFuelAtDest < desiredFuel - 0.01) {
        // Distancia máxima al destino desde la que, llenando, se llega con lo deseado
        const maxLastLegDist = ((capacity - desiredFuel) / consumption) * 100;
        const currentRange = (currentFuel / consumption) * 100;
        const feasibleLastStops = stationsOnRoute.filter(s =>
            !used.has(s.id) &&
            s.distanceFromStart >= currentDist &&
            s.distanceFromEnd <= maxLastLegDist &&
            (s.distanceFromStart - currentDist) <= currentRange
        );

        if (feasibleLastStops.length === 0) {
            throw new Error("No se puede completar la ruta con el nivel de combustible deseado en destino. No hay gasolineras adecuadas cerca del final.");
        }

        // Lo que hay que echar en una parada para llegar con el nivel deseado
        const refillAt = (s) => {
            const atStop = fuelAtArrival(s);
            const forFinalLeg = (s.distanceFromEnd / 100) * consumption;
            return Math.min(Math.max(0, desiredFuel + forFinalLeg - atStop), Math.max(0, capacity - atStop));
        };
        // Elegir por coste total real: litros necesarios allí más el
        // combustible del desvío, todo al precio de esa gasolinera.
        const lastStopCost = (s) => (refillAt(s) + 2 * s.distanceToRoute * (consumption / 100)) * s.prices[fuelType];
        const extraStop = feasibleLastStops.reduce((best, s) =>
            lastStopCost(s) < lastStopCost(best) ? s : best, feasibleLastStops[0]);

        const fuelToRefill = refillAt(extraStop);
        currentFuel = fuelAtArrival(extraStop) + fuelToRefill;
        currentDist = extraStop.distanceFromStart;
        addStop(extraStop, fuelToRefill);
    }

    return buildResult(plannedStops, avgPrice, maxPrice);
}

// Calcula el plan con el algoritmo pedido. Primero con todas las
// restricciones (reserva, repostaje mínimo, penalización por parada); si así
// no hay solución (casos límite: depósitos muy pequeños, pocas gasolineras,
// salir casi en reserva), reintenta sin ellas antes de rendirse y lo marca
// con `relaxed` para que la app avise de que el plan apura la reserva.
function planRoute(routeLine, routeDistance, params, allGasStations) {
    const run = (opts) => params.algorithm === 'dynamic'
        ? calculateOptimalStops(routeLine, routeDistance, params, allGasStations, opts)
        : calculateOptimalStops2(routeLine, routeDistance, params, allGasStations, opts);

    try {
        return run({});
    } catch (strictError) {
        const results = run({ stopPenalty: 0, minRefuelLiters: 0, reservePercent: 0 });
        results.relaxed = true;
        return results;
    }
}

self.onmessage = function(e) {
    const { routeLine, routeDistance, params, allGasStations, origin, destination } = e.data;
    try {
        const results = planRoute(routeLine, routeDistance, params, allGasStations);
        postMessage({ success: true, results, origin, destination });
    } catch (error) {
        console.error('Worker: Error during calculation', error);
        postMessage({ success: false, error: error.message });
    }
};
