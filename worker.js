// Import the Turf.js library, which is essential for our calculations.
importScripts('https://unpkg.com/@turf/turf@6/turf.min.js');

// The main function for calculating optimal stops. This is moved from the main script.
function calculateOptimalStops(routeLine, routeDistance, params, allGasStations) {
    // 1. Get params (passed from the main thread)
    const { fuelType, tankCapacity, currentFuelPercent, consumption, searchRadius, includeRestricted, finalFuelPercent = 0, } = params;

    // 2. Pre-filter stations for massive performance improvement
    
    // Step 2.1: Filter by type ('P' for Public) and for valid price.
    let candidateStations = allGasStations.filter(station => {
        if (!station.prices[fuelType]) {
            return false;
        }
        let saleTypeFilter = station.tipoVenta === 'P';
        if (includeRestricted) {
            saleTypeFilter = station.tipoVenta === 'P' || station.tipoVenta === 'R';
        }
        return saleTypeFilter;
    });

    // Step 2.2: Create a buffered bounding box
    const routeBbox = turf.bbox(routeLine);
    const bufferedBboxPolygon = turf.buffer(turf.bboxPolygon(routeBbox), searchRadius, { units: 'kilometers' });

    // Step 2.3: Filter stations within the bounding box
    candidateStations = candidateStations.filter(station => {
        const point = turf.point([station.lon, station.lat]);
        return turf.booleanPointInPolygon(point, bufferedBboxPolygon);
    });

    // 3. Detailed filtering (narrow-phase)
    const originPoint = turf.point(routeLine.geometry.coordinates[0]);
    const endPoint = turf.point(routeLine.geometry.coordinates[routeLine.geometry.coordinates.length - 1]);

    const stationsOnRoute = candidateStations
        .filter(station => {
            const point = turf.point([station.lon, station.lat]);
            const distanceToRoute = turf.pointToLineDistance(point, routeLine, { units: 'kilometers' });
            return distanceToRoute <= searchRadius;
        })
        .map(station => {
            const stationPoint = turf.point([station.lon, station.lat]);
            const nearestPointOnRoute = turf.nearestPointOnLine(routeLine, stationPoint);
            const distanceFromStart = turf.distance(originPoint, nearestPointOnRoute, { units: 'kilometers' });
            const distanceFromEnd = turf.distance(endPoint, nearestPointOnRoute, { units: 'kilometers' });

            return { ...station, distanceFromStart, distanceFromEnd };
        })
        .sort((a, b) => a.distanceFromStart - b.distanceFromStart);
    
    const prices = stationsOnRoute.map(s => s.prices[fuelType]);
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    
    // Dynamic Programming setup
    const n = stationsOnRoute.length;
    if (n === 0) {
        // Check if we can reach end without stops
        if (routeDistance <= (tankCapacity * (currentFuelPercent / 100) / consumption * 100) &&
            (tankCapacity * (currentFuelPercent / 100) / consumption * 100 - routeDistance) >= (tankCapacity * (finalFuelPercent / 100) / consumption * 100)) {
            return {
                stops: [],
                optimalCost: 0,
                avgPriceCost: 0,
                maxPriceCost: 0
            };
        } else {
            throw new Error("No se puede completar la ruta. No hay gasolineras y el combustible inicial es insuficiente.");
        }
    }

    const U = tankCapacity / consumption * 100; // max range km
    const initial_range = tankCapacity * (currentFuelPercent / 100) / consumption * 100;
    const desired_range = tankCapacity * (finalFuelPercent / 100) / consumption * 100;

    // Add effective cost per km
    stationsOnRoute.forEach(s => {
        s.c = s.prices[fuelType] * (consumption / 100);
    });

    // DP: C[i] is Map of g => {cost, nextV, isFull, amount, arrivalGNext}
    const C = Array.from({length: n}, () => new Map());

    const EPS = 1e-6;

    for (let i = n - 1; i >= 0; i--) {
        // Build GV set
        let gvSet = new Set([0]);
        for (let k = 0; k < i; k++) {
            let dist_k_i = stationsOnRoute[i].distanceFromStart - stationsOnRoute[k].distanceFromStart;
            if (dist_k_i <= U + EPS && stationsOnRoute[k].c < stationsOnRoute[i].c) {
                gvSet.add(U - dist_k_i);
            }
        }
        // Add from start
        let dist_start_i = stationsOnRoute[i].distanceFromStart;
        if (dist_start_i <= initial_range + EPS) {
            gvSet.add(initial_range - dist_start_i);
        }

        // Convert to array and sort to remove near duplicates if needed
        let gv = Array.from(gvSet).sort((a, b) => a - b);
        // Remove duplicates within EPS
        let uniqueGv = [];
        for (let val of gv) {
            if (uniqueGv.length === 0 || Math.abs(val - uniqueGv[uniqueGv.length - 1]) > EPS) {
                uniqueGv.push(val);
            }
        }

        for (let gg = 0; gg < uniqueGv.length; gg++) {
            let g = uniqueGv[gg];
            if (g < 0) continue; // invalid

            let minCost = Infinity;
            let bestNext = -1;
            let bestIsFull = false;
            let bestAmount = 0;
            let bestArrivalG = 0;

            // Direct to end
            let dist_i_end = routeDistance - stationsOnRoute[i].distanceFromStart;
            let l = dist_i_end + desired_range;
            if (l <= U + EPS) {
                let amount = Math.max(0, l - g);
                let cost_direct = amount * stationsOnRoute[i].c;
                if (cost_direct < minCost) {
                    minCost = cost_direct;
                    bestNext = -1; // end
                    bestIsFull = false;
                    bestAmount = amount;
                    bestArrivalG = desired_range;
                }
            }

            // To other stations v > i
            for (let v = i + 1; v < n; v++) {
                let dist_i_v = stationsOnRoute[v].distanceFromStart - stationsOnRoute[i].distanceFromStart;
                if (dist_i_v > U + EPS) break;

                let price_i = stationsOnRoute[i].c;
                let price_v = stationsOnRoute[v].c;

                if (price_v <= price_i) {
                    if (g <= dist_i_v + EPS) {
                        let amount = dist_i_v - g;
                        if (amount > EPS) { // positive refuel
                            let arrival_g_v = 0;
                            let subCost = Infinity;
                            for (let [key, value] of C[v]) {
                                if (Math.abs(key - arrival_g_v) < EPS) {
                                    subCost = value.cost;
                                    break;
                                }
                            }
                            if (subCost < Infinity) {
                                let cost = amount * price_i + subCost;
                                if (cost < minCost) {
                                    minCost = cost;
                                    bestNext = v;
                                    bestIsFull = false;
                                    bestAmount = amount;
                                    bestArrivalG = arrival_g_v;
                                }
                            }
                        }
                    }
                } else {
                    let amount = U - g;
                    if (amount > EPS) {
                        let arrival_g_v = U - dist_i_v;
                        let subCost = Infinity;
                        for (let [key, value] of C[v]) {
                            if (Math.abs(key - arrival_g_v) < EPS) {
                                subCost = value.cost;
                                break;
                            }
                        }
                        if (subCost < Infinity) {
                            let cost = amount * price_i + subCost;
                            if (cost < minCost) {
                                minCost = cost;
                                bestNext = v;
                                bestIsFull = true;
                                bestAmount = amount;
                                bestArrivalG = arrival_g_v;
                            }
                        }
                    }
                }
            }

            if (minCost < Infinity) {
                C[i].set(g, {cost: minCost, nextV: bestNext, isFull: bestIsFull, amount: bestAmount, arrivalGNext: bestArrivalG});
            }
        }
    }

    // Now find the min cost from start
    let optimalCost = Infinity;
    let bestFirst = -1;
    let bestG = 0;
    // Direct from start to end
    let l_start = routeDistance + desired_range;
    if (l_start <= initial_range + EPS) {
        optimalCost = 0;
        bestFirst = -1; // no stops
    }
    // Through stops
    for (let v = 0; v < n; v++) {
        let dist_start_v = stationsOnRoute[v].distanceFromStart;
        if (dist_start_v > initial_range + EPS) continue;
        let g = initial_range - dist_start_v;
        let subCost = Infinity;
        for (let [key, value] of C[v]) {
            if (Math.abs(key - g) < EPS) {
                subCost = value.cost;
                break;
            }
        }
        if (subCost < Infinity && subCost < optimalCost) {
            optimalCost = subCost;
            bestFirst = v;
            bestG = g;
        }
    }

    if (optimalCost === Infinity) {
        throw new Error("No se puede completar la ruta. No hay gasolineras alcanzables para completar el viaje con los requisitos.");
    }

    // Reconstruct the stops
    const plannedStops = [];
    if (bestFirst === -1) {
        // no stops
    } else {
        let currentI = bestFirst;
        let currentG = bestG;
        while (currentI !== -1) {
            const state = C[currentI].get(currentG); // but since floating, find the key
            let actualKey = Array.from(C[currentI].keys()).find(k => Math.abs(k - currentG) < EPS);
            const {nextV, amount, arrivalGNext} = C[currentI].get(actualKey);
            let stop = {...stationsOnRoute[currentI]};
            stop.refuelAmount = amount * (consumption / 100); // back to liters
            stop.refuelCost = stop.refuelAmount * stop.prices[fuelType];
            plannedStops.push(stop);

            if (nextV === -1) break;
            currentI = nextV;
            currentG = arrivalGNext;
        }
    }

    // Calculate total refuel amount for comparisons
    const totalRefuelAmount = plannedStops.reduce((total, stop) => total + stop.refuelAmount, 0);
    const avgPriceCost = totalRefuelAmount * avgPrice;
    const maxPriceCost = totalRefuelAmount * maxPrice;

    return {
        stops: plannedStops,
        optimalCost: optimalCost,
        avgPriceCost: avgPriceCost,
        maxPriceCost: maxPriceCost
    };
}
function calculateOptimalStops2(routeLine, routeDistance, params, allGasStations) {
    // 1. Get params (passed from the main thread)
    const { fuelType, tankCapacity, currentFuelPercent, consumption, searchRadius, includeRestricted, finalFuelPercent = 0 } = params;

    // 2. Pre-filter stations for massive performance improvement
    
    // Step 2.1: Filter by type ('P' for Public) and for valid price.
    let candidateStations = allGasStations.filter(station => {
        if (!station.prices[fuelType]) {
            return false;
        }
        let saleTypeFilter = station.tipoVenta === 'P';
        if (includeRestricted) {
            saleTypeFilter = station.tipoVenta === 'P' || station.tipoVenta === 'R';
        }
        return saleTypeFilter;
    });

    // Step 2.2: Create a buffered bounding box
    const routeBbox = turf.bbox(routeLine);
    const bufferedBboxPolygon = turf.buffer(turf.bboxPolygon(routeBbox), searchRadius, { units: 'kilometers' });

    // Step 2.3: Filter stations within the bounding box
    candidateStations = candidateStations.filter(station => {
        const point = turf.point([station.lon, station.lat]);
        return turf.booleanPointInPolygon(point, bufferedBboxPolygon);
    });

    // 3. Detailed filtering (narrow-phase)
    const originPoint = turf.point(routeLine.geometry.coordinates[0]);
    const endPoint = turf.point(routeLine.geometry.coordinates[routeLine.geometry.coordinates.length - 1]);

    const stationsOnRoute = candidateStations
        .filter(station => {
            const point = turf.point([station.lon, station.lat]);
            const distanceToRoute = turf.pointToLineDistance(point, routeLine, { units: 'kilometers' });
            return distanceToRoute <= searchRadius;
        })
        .map(station => {
            const stationPoint = turf.point([station.lon, station.lat]);
            const nearestPointOnRoute = turf.nearestPointOnLine(routeLine, stationPoint);
            const distanceFromStart = turf.distance(originPoint, nearestPointOnRoute, { units: 'kilometers' });
            const distanceFromEnd = turf.distance(endPoint, nearestPointOnRoute, { units: 'kilometers' });

            return { ...station, distanceFromStart, distanceFromEnd };
        })
        .sort((a, b) => a.distanceFromStart - b.distanceFromStart);
    
    const prices = stationsOnRoute.map(s => s.prices[fuelType]);
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    
    // 4. Greedy algorithm to find stops
    const plannedStops = [];
    let currentDist = 0;
    let currentFuel = tankCapacity * (currentFuelPercent / 100);
    const desiredFuel = tankCapacity * (finalFuelPercent / 100);

    while (currentDist < routeDistance) {
        const range = (currentFuel / consumption) * 100;
        if (currentDist + range >= routeDistance) break;

        const reachableStations = stationsOnRoute.filter(s => s.distanceFromStart > currentDist && s.distanceFromStart <= currentDist + range);
        if (reachableStations.length === 0) {
            throw new Error("No se puede completar la ruta. No hay gasolineras alcanzables en el siguiente tramo.");
        }

        // MODIFICACIÓN: En lugar de picking el más barato (y earliest en ties), preferir el farthest en ties para saltar clusters.
        const nextStop = reachableStations.reduce((best, s) => {
            const priceS = s.prices[fuelType];
            const priceBest = best.prices[fuelType];
            if (priceS < priceBest) {
                return s;
            } else if (priceS === priceBest && s.distanceFromStart > best.distanceFromStart) {
                return s;
            }
            return best;
        }, reachableStations[0]);
        
        const distToNextStop = nextStop.distanceFromStart - currentDist;
        const fuelNeeded = (distToNextStop / 100) * consumption;

        currentFuel -= fuelNeeded;
        currentDist = nextStop.distanceFromStart;

        const fuelToRefill = tankCapacity - currentFuel;
        nextStop.refuelAmount = fuelToRefill;
        nextStop.refuelCost = fuelToRefill * nextStop.prices[fuelType];
        
        plannedStops.push(nextStop);
        currentFuel = tankCapacity;
    }

    // 5. Check if we arrive with desired fuel; if not, add an extra stop near the end
    const remainingDist = routeDistance - currentDist;
    const fuelUsedToDest = (remainingDist / 100) * consumption;
    let projectedFuelAtDest = currentFuel - fuelUsedToDest;

    if (projectedFuelAtDest < desiredFuel) {
        // Máxima distancia desde el destino a la que podemos parar para repostar
        const maxLastLegDist = ((tankCapacity - desiredFuel) / consumption) * 100;
        
        // MODIFICACIÓN: Corregir el filtro a <= (era >=, lo cual es un bug; debe ser paradas cercanas al final).
        const feasibleLastStops = stationsOnRoute.filter(s => 
            s.distanceFromStart > currentDist &&
            s.distanceFromEnd <= maxLastLegDist
        );
        
        if (feasibleLastStops.length === 0) {
            throw new Error("No se puede completar la ruta con el nivel de combustible deseado en destino. No hay gasolineras adecuadas cerca del final.");
        }

        // MODIFICACIÓN: Aplicar el mismo tie-breaker (farthest en ties, i.e., closest to end).
        const extraStop = feasibleLastStops.reduce((best, s) => {
            const priceS = s.prices[fuelType];
            const priceBest = best.prices[fuelType];
            if (priceS < priceBest) {
                return s;
            } else if (priceS === priceBest && s.distanceFromStart > best.distanceFromStart) {
                return s;
            }
            return best;
        }, feasibleLastStops[0]);

        const distToExtra = extraStop.distanceFromStart - currentDist;
        const fuelNeededToExtra = (distToExtra / 100) * consumption;

        if (fuelNeededToExtra > currentFuel) {
            throw new Error("No se puede alcanzar la gasolinera adicional necesaria.");
        }

        // <-- CORRECCIÓN 2: Lógica de repostaje optimizada
        const fuelAtExtraStop = currentFuel - fuelNeededToExtra;
        const fuelForFinalLeg = (extraStop.distanceFromEnd / 100) * consumption;
        const totalFuelNeeded = desiredFuel + fuelForFinalLeg;
        let fuelToRefill = totalFuelNeeded - fuelAtExtraStop;

        fuelToRefill = Math.max(0, fuelToRefill);
        if (fuelAtExtraStop + fuelToRefill > tankCapacity) {
            fuelToRefill = tankCapacity - fuelAtExtraStop;
        }

        extraStop.refuelAmount = fuelToRefill;
        extraStop.refuelCost = fuelToRefill * extraStop.prices[fuelType];
        
        plannedStops.push(extraStop);
        currentFuel = fuelAtExtraStop + fuelToRefill;
        currentDist = extraStop.distanceFromStart; // Actualizamos la distancia actual

        // Verify the new projection (optional but good practice)
        const newRemainingDist = routeDistance - currentDist;
        const newFuelUsedToDest = (newRemainingDist / 100) * consumption;
        projectedFuelAtDest = currentFuel - newFuelUsedToDest;
        if (projectedFuelAtDest < desiredFuel - 0.01) { // small tolerance for float errors
            console.warn("La parada adicional podría no satisfacer el combustible deseado exactamente por errores de redondeo.");
        }
    }

    // 6. Calculate final costs and return results
    const optimalCost = plannedStops.reduce((total, stop) => total + stop.refuelCost, 0);
    const totalRefuelAmount = plannedStops.reduce((total, stop) => total + stop.refuelAmount, 0);
    const avgPriceCost = totalRefuelAmount * avgPrice;
    const maxPriceCost = totalRefuelAmount * maxPrice;

    return {
        stops: plannedStops,
        optimalCost: optimalCost,
        avgPriceCost: avgPriceCost,
        maxPriceCost: maxPriceCost
    };
}
// Set up the event listener for messages from the main thread.
// Set up the event listener for messages from the main thread.
self.onmessage = function(e) {
    console.log('Worker: Message received from main script');
    const { routeLine, routeDistance, params, allGasStations, origin, destination } = e.data;
    
    // Obtener el algoritmo seleccionado de los parámetros
    const { algorithm } = params;

    try {
        let results;
        // Usar una declaración if/else o switch para elegir la función
        if (algorithm === 'dynamic') {
            console.log('Worker: Usando el algoritmo de Programación Dinámica.');
            results = calculateOptimalStops(routeLine, routeDistance, params, allGasStations);
        } else {
            console.log('Worker: Usando el algoritmo Codicioso.');
            // Aquí se llamaría a la función que tiene la lógica del algoritmo codicioso
            results = calculateOptimalStops2(routeLine, routeDistance, params, allGasStations);
        }

        console.log('Worker: Calculation complete, posting results back to main script');
        // Post the results back to the main thread, including the original origin/destination text.
        postMessage({ success: true, results, origin, destination });
    } catch (error) {
        console.error('Worker: Error during calculation', error);
        // If an error occurs, post an error message back.
        postMessage({ success: false, error: error.message });
    }
};