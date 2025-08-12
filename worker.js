// Import the Turf.js library, which is essential for our calculations.
importScripts('https://unpkg.com/@turf/turf@6/turf.min.js');

// The main function for calculating optimal stops. This is moved from the main script.
function calculateOptimalStops(routeLine, routeDistance, params, allGasStations) {
    // 1. Get params (passed from the main thread)
    const { fuelType, tankCapacity, currentFuelPercent, consumption, searchRadius, includeRestricted } = params;

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
            return { ...station, distanceFromStart };
        })
        .sort((a, b) => a.distanceFromStart - b.distanceFromStart);
    
    const prices = stationsOnRoute.map(s => s.prices[fuelType]);
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    
    // 4. Greedy algorithm to find stops
    const plannedStops = [];
    let currentDist = 0;
    let currentFuel = tankCapacity * (currentFuelPercent / 100);

    while (currentDist < routeDistance) {
        const range = (currentFuel / consumption) * 100;
        if (currentDist + range >= routeDistance) break;

        const reachableStations = stationsOnRoute.filter(s => s.distanceFromStart > currentDist && s.distanceFromStart <= currentDist + range);
        if (reachableStations.length === 0) {
             throw new Error("No se puede completar la ruta. No hay gasolineras alcanzables en el siguiente tramo.");
        }

        const nextStop = reachableStations.reduce((cheapest, s) => s.prices[fuelType] < cheapest.prices[fuelType] ? s : cheapest, reachableStations[0]);
        
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

    // 5. Calculate final costs and return results
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
self.onmessage = function(e) {
    console.log('Worker: Message received from main script');
    const { routeLine, routeDistance, params, allGasStations, origin, destination } = e.data;

    try {
        const results = calculateOptimalStops(routeLine, routeDistance, params, allGasStations);
        console.log('Worker: Calculation complete, posting results back to main script');
        // Post the results back to the main thread, including the original origin/destination text.
        postMessage({ success: true, results, origin, destination });
    } catch (error) {
        console.error('Worker: Error during calculation', error);
        // If an error occurs, post an error message back.
        postMessage({ success: false, error: error.message });
    }
};
