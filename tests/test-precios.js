// Tests del intérprete de precios de cargadores (scripts/precios-cargadores.js).
// Ejecutar con: npm test
//
// Los textos son casos reales del campo UsageCost de OpenChargeMap.
const { parsearCoste, estimarPrecios } = require('../scripts/precios-cargadores');

let fallos = 0;
function check(cond, msg) {
    console.log(`${cond ? 'PASA' : 'FALLA'}: ${msg}`);
    if (!cond) fallos++;
}

const AC22 = { dc: false, kw: 22 };
const AC43 = { dc: false, kw: 43 };
const DC50 = { dc: true, kw: 50 };
const DC120 = { dc: true, kw: 120 };
const DC300 = { dc: true, kw: 300 };

// [texto, conexión, precio esperado, recargos esperados]
const casos = [
    // Formato simple y erratas de unidad
    ['0,39€/kWh', AC22, 0.39, []],
    ['0.47€/kWh ', DC50, 0.47, []],
    ["0'20€/kWh", AC22, 0.20, []],
    ['0,35€/Wh', AC22, 0.35, []],
    ['0,40€/kEh + parking fee', AC22, 0.40, ['parking']],
    ['0.30€ kW/h', DC50, 0.30, []],
    ['0,25€/kW', DC50, 0.25, []],
    ['0.39€+ parking fee', AC22, 0.39, ['parking']],
    ['0,39', AC22, 0.39, []],
    ['0.45€', DC50, 0.45, []],

    // Precio distinto para AC y DC: el del conector del cargador
    ['0,50€/kWh DC - 0,45€/kWh AC', DC50, 0.50, []],
    ['0,50€/kWh DC - 0,45€/kWh AC', AC22, 0.45, []],
    ['0,50€/kWh DC - 0,35kWh AC', AC22, 0.35, []],
    ['0,49€/kWhDC - 0,39€/kWh AC', DC50, 0.49, []],
    ['DC: 0,54€/kWh - AC: 0,39€/kWh', DC120, 0.54, []],
    ['DC: 0,54€/kWh - AC: 0,39€/kWh', AC22, 0.39, []],
    ['0,45€/kWh DC50kW/AC43kW - 0,39€/kWh 22kW AC', AC22, 0.39, []],
    ['0,45€/kWh DC50kW/AC43kW - 0,39€/kWh 22kW AC', AC43, 0.45, []],

    // Tramos de potencia
    ['0.50€/kWh >60kW - 0,39€/kWh DC - 0,32€/kWh AC', DC50, 0.39, []],
    ['0.50€/kWh >60kW - 0,39€/kWh DC - 0,32€/kWh AC', DC120, 0.50, []],
    ['0.50€/kWh >60kW - 0,39€/kWh DC - 0,32€/kWh AC', AC22, 0.32, []],
    ['0,65€/kWh >150kW - 0,55€/kWh >60kW - 0,45€/kWh DC - 0,39€/kWh AC', DC300, 0.65, []],
    ['0,65€/kWh >150kW - 0,55€/kWh >60kW - 0,45€/kWh DC - 0,39€/kWh AC', DC120, 0.55, []],
    ['0,54€/kWh 80-200kW - 0,45€/kWh DC50kW/AC43kW - 0,39€/kWh 22kW AC', DC120, 0.54, []],
    ['0,54€/kWh 80-200kW - 0,45€/kWh DC50kW/AC43kW - 0,39€/kWh 22kW AC', DC50, 0.45, []],
    ['Hasta 22kW: 0.32€. 30kW: 0.37€. 60kW: 0.40€. 120kW: 0.43€', DC120, 0.43, []],

    // Gratis de verdad
    ['free', AC22, 0, []],
    ['Gratis', DC50, 0, []],
    ['€0/kWh', AC22, 0, []],
    ['0', AC22, 0, []],
    ['free ', AC22, 0, []],
    ['Gratis/Free', AC22, 0, []],
    ['free of charge ', AC22, 0, []],

    // "Gratis" con condiciones o referido al parking: no es gratis
    ["app Waylet(Repsol). 90' free parking, then at 0,07€/min", AC22, null, ['min']],
    ['Free for clients', AC22, null, []],
    ['Free with MELIB card', AC22, null, []],
    ['free charging + parking fee', AC22, null, ['parking']],
    ['Recarga gratuita + parking pago', AC22, null, ['parking']],
    // Un precio por kWh manda aunque el texto mencione algo gratis
    ['parking fee + 0,20€/kWh (0,01€/min parked without charging) First hour free', AC22, 0.20, ['parking', 'min']],
    ['Free for 30 mins for LIDL clients', AC22, null, []],
    ["First 40' free parking", DC300, null, []],
    ['0,33€/kWh DC - 0,25€/kWh AC (AC chargers free with Costco Membership)', DC120, 0.33, []],

    // Recargos y cobros que no son por kWh
    ['0,42€/kWh (0,05€/min parked without charging)', AC22, 0.42, ['min']],
    ['0,48€/kWh DC/AC43kW - 0,38€/kWh AC - (0,14€/min DC / 0,03€/min AC parked without', AC22, 0.38, ['min']],
    ['parking fee', AC22, null, ['parking']],
    ['2€/hora', AC22, null, ['hora']],
    ['20€/charge', DC50, null, ['sesion']],
    ['10€', AC22, null, ['sesion']],

    // Valores absurdos y textos sin precio
    ['25,00€/kWh', AC22, null, []],
    ['0,07€/min', AC22, null, ['min']],
    ['', AC22, null, []],
    ['16 V4 Superchargers 250kW (CCS). Max total power of the station 1,5MW', DC300, null, []],
    [null, DC50, null, []]
];

for (const [texto, conexion, precio, extra] of casos) {
    const r = parsearCoste(texto, conexion);
    const tipo = `${conexion.dc ? 'DC' : 'AC'} ${conexion.kw} kW`;
    check(r.precio === precio && r.extra.join() === extra.join(),
        `"${texto}" [${tipo}] → ${precio} [${extra}] (obtenido ${r.precio} [${r.extra}])`);
}

// --- Estimación de los que no publican precio ---
const cargador = (op, kw, dc, precio) => ({ op, kw, dc, precio });
const red = [
    ...Array.from({ length: 6 }, () => cargador('Iberdrola', 50, true, 0.45)),
    ...Array.from({ length: 6 }, () => cargador('Iberdrola', 300, true, 0.69)),
    ...Array.from({ length: 12 }, () => cargador('Endesa', 22, false, 0.39)),
    ...Array.from({ length: 6 }, () => cargador('(Business Owner at Location)', 22, false, 0.10)),
    cargador('Mercadona', 22, false, 0), // los gratuitos no cuentan
    cargador('Iberdrola', 50, true, null),
    cargador('Iberdrola', 350, true, null),
    cargador('Iberdrola', 120, true, null),
    cargador('Tesla (including non-tesla)', 250, true, null),
    cargador('(Unknown Operator)', 60, true, null),
    cargador('Endesa', 7.4, false, null)
];
estimarPrecios(red);
const sinPrecio = red.filter(c => c.precio === null);

check(sinPrecio[0].est === 0.45, `Mismo operador y tramo: 50 kW de Iberdrola → 0,45 (obtenido ${sinPrecio[0].est})`);
check(sinPrecio[1].est === 0.69, `Mismo operador y tramo: 350 kW de Iberdrola → 0,69 (obtenido ${sinPrecio[1].est})`);
check(sinPrecio[2].est === 0.57, `Sin datos del tramo, mediana DC del operador → 0,57 (obtenido ${sinPrecio[2].est})`);
check(sinPrecio[3].est === 0.50, `Tesla sin datos → precio de referencia 0,50 (obtenido ${sinPrecio[3].est})`);
check(sinPrecio[4].est === 0.45, `Operador genérico → mediana del tramo DC 50-99 kW (obtenido ${sinPrecio[4].est})`);
check(sinPrecio[5].est === 0.39, `AC de Endesa → 0,39 (obtenido ${sinPrecio[5].est})`);
check(red.filter(c => c.precio !== null).every(c => c.est === undefined), 'No se estima donde hay precio publicado');

console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASAN' : `\n${fallos} PRUEBAS FALLAN`);
process.exit(fallos === 0 ? 0 : 1);
