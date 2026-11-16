// Tests del ranking de precios (ranking.js).
// Ejecutar con: npm test
const {
    FISCALIDAD_PROPIA, INDEPENDIENTES,
    normalizarRotulo, resolverMarcas, marcaOperador,
    mediana, referenciaPorZona, rankingMarcas, rankingEstaciones
} = require('../ranking.js');

let fallos = 0;
function check(cond, msg) {
    console.log(`${cond ? 'PASA' : 'FALLA'}: ${msg}`);
    if (!cond) fallos++;
}

// --- Marcas a partir del rótulo ---
console.log('Marcas\n');

check(normalizarRotulo('Nº 10.935') === 'N 10 935', 'normaliza signos y números');
check(normalizarRotulo('  Repsol  Butano ') === 'REPSOL BUTANO', 'normaliza mayúsculas y espacios');

const rotulos = [
    ...Array(10).fill('BALLENOIL'),
    ...Array(10).fill('NUEVA MARCA'),
    ...Array(3).fill('GASOLINERA PEPE'),
    'REPSOL', 'E.S. REPSOL', 'Repsol Butano', 'CEPSA', 'MOEVE', 'Campsa Express', 'GMOIL', 'GM OIL',
    'SIN ROTULO', 'Nº 7374', 'BP OIL', 'SBP'
];
const marca = resolverMarcas(rotulos);
check(['REPSOL', 'E.S. REPSOL', 'Repsol Butano'].every(r => marca(r) === 'REPSOL'), 'las variantes de REPSOL son la misma marca');
check(marca('CEPSA') === 'MOEVE (CEPSA)' && marca('MOEVE') === 'MOEVE (CEPSA)', 'CEPSA y MOEVE son la misma marca');
check(marca('Campsa Express') === 'CAMPSA', 'CAMPSA EXPRESS cuenta como CAMPSA');
check(marca('GMOIL') === 'GM OIL' && marca('GM OIL') === 'GM OIL', 'GMOIL y GM OIL son la misma marca');
check(marca('BP OIL') === 'BP' && marca('SBP') === INDEPENDIENTES, 'BP solo al principio del rótulo');
check(marca('NUEVA MARCA') === 'NUEVA MARCA', 'un rótulo con 8 estaciones o más es una marca');
check(marca('GASOLINERA PEPE') === INDEPENDIENTES, 'un rótulo con pocas estaciones va a Independientes');
check(marca('SIN ROTULO') === INDEPENDIENTES && marca('Nº 7374') === INDEPENDIENTES, 'los rótulos genéricos van a Independientes');

check(marcaOperador('Iberdrola | BP Pulse (ES)') === 'Iberdrola | BP Pulse', 'quita el sufijo de país del operador');
check(marcaOperador('(Business Owner at Location)') === null && marcaOperador('(Unknown Operator)') === null && marcaOperador(null) === null,
    'los operadores genéricos no se atribuyen a nadie');

// --- Comparación con lo normal en cada provincia ---
console.log('\nReferencia por provincia\n');

check(mediana([3, 1, 2]) === 2 && mediana([1, 2, 3, 4]) === 2.5 && mediana([]) === null, 'mediana');

// Provincia cara (A, 1,80) y provincia barata (B, 1,50).
// La marca BARATA_EN_A cobra 1,70 en la provincia cara: un 5,6 % menos de lo normal allí.
// La marca SOLO_EN_B cobra 1,50 en la provincia barata: lo normal allí.
// Con una media simple ganaría SOLO_EN_B (1,50 < 1,70), lo que sería injusto.
const punto = (marca, prov, precio) => ({ marca, prov, precio, ref: precio });
const puntos = [
    ...Array(10).fill(0).map(() => punto('NORMAL', 'A', 1.80)),
    ...Array(6).fill(0).map(() => punto('BARATA_EN_A', 'A', 1.70)),
    ...Array(6).fill(0).map(() => punto('NORMAL', 'B', 1.50)),
    ...Array(6).fill(0).map(() => punto('SOLO_EN_B', 'B', 1.50)),
    punto('POCAS', 'A', 1.00), punto('POCAS', 'A', 1.00)
];
const ref = referenciaPorZona(puntos);
check(ref('A') === 1.80 && ref('B') === 1.50, `cada provincia tiene su mediana (A ${ref('A')}, B ${ref('B')})`);

const ranking = rankingMarcas(puntos, ref, { minPuntos: 5 });
check(ranking[0].marca === 'BARATA_EN_A', `la más barata respecto a su zona va primera, no la de la zona barata (primera: ${ranking[0].marca})`);
check(Math.abs(ranking[0].dif - (1.70 / 1.80 - 1)) < 1e-9 && ranking[0].n === 6 && ranking[0].precio === 1.70, 'diferencia, número de puntos y mediana de precio');
check(!ranking.some(r => r.marca === 'POCAS'), 'una marca con menos puntos que el mínimo no entra');

// Provincia con un solo punto: se compara con la mediana nacional
const conProvinciaPequena = [...puntos, punto('UNICA', 'C', 1.20)];
const refC = referenciaPorZona(conProvinciaPequena);
check(refC('C') === refC(null) && refC(null) === mediana(conProvinciaPequena.map(p => p.ref)),
    'una provincia con menos de 3 puntos usa la mediana nacional');
check(referenciaPorZona([punto('X', null, 1.5), punto('X', null, 1.7)])(null) === 1.6, 'sin provincia en los datos, todo se compara con la mediana nacional');

// Precio con descuento: la referencia sigue siendo el precio público
const conDescuento = [
    ...Array(5).fill(0).map(() => ({ marca: 'REPSOL', prov: 'A', precio: 1.70, ref: 1.80 })),
    ...Array(5).fill(0).map(() => punto('OTRA', 'A', 1.80))
];
const rankingDescuento = rankingMarcas(conDescuento, referenciaPorZona(conDescuento), { minPuntos: 5 });
check(rankingDescuento[0].marca === 'REPSOL' && rankingDescuento[0].dif < 0, 'el descuento propio mejora la posición sin mover la referencia');

// --- Estaciones ---
console.log('\nEstaciones\n');

const estaciones = rankingEstaciones([
    { id: 1, precio: 1.6 }, { id: 2, precio: 1.5, distKm: 3 }, { id: 3, precio: 1.5, distKm: 1 },
    { id: 4, precio: 0 }, { id: 5, precio: 1.7 }
], 3);
check(estaciones.map(e => e.id).join() === '3,2,1', `ordenadas por precio y, a igual precio, por distancia (${estaciones.map(e => e.id)})`);
check(!estaciones.some(e => e.precio === 0), 'los gratuitos no entran en la lista');
check(['35', '38', '51', '52'].every(p => FISCALIDAD_PROPIA.has(p)) && !FISCALIDAD_PROPIA.has('28'), 'Canarias, Ceuta y Melilla tienen fiscalidad propia');

console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASAN' : `\n${fallos} PRUEBAS FALLAN`);
process.exit(fallos === 0 ? 0 : 1);
