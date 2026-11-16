// Ranking de precios: marcas (u operadores) y estaciones más baratas por zona.
//
// Código compartido por app.js (<script>) y los tests (require). Son funciones
// puras: reciben listas de puntos ya filtradas por combustible y devuelven el
// ranking; la app se encarga de los datos, el ámbito y la presentación.
//
// Cómo se compara: una media simple por marca favorece a las que tienen más
// estaciones en zonas baratas (o en Canarias, Ceuta y Melilla, con otros
// impuestos). Por eso cada precio se compara con la mediana de su provincia y
// lo que se promedia por marca es esa diferencia relativa.

// Provincias por código INE
const PROVINCIAS = {
    '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila',
    '06': 'Badajoz', '07': 'Illes Balears', '08': 'Barcelona', '09': 'Burgos', '10': 'Cáceres',
    '11': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba', '15': 'A Coruña',
    '16': 'Cuenca', '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa',
    '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León', '25': 'Lleida',
    '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '29': 'Málaga', '30': 'Murcia',
    '31': 'Navarra', '32': 'Ourense', '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas',
    '36': 'Pontevedra', '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '39': 'Cantabria', '40': 'Segovia',
    '41': 'Sevilla', '42': 'Soria', '43': 'Tarragona', '44': 'Teruel', '45': 'Toledo',
    '46': 'Valencia', '47': 'Valladolid', '48': 'Bizkaia', '49': 'Zamora', '50': 'Zaragoza',
    '51': 'Ceuta', '52': 'Melilla'
};

// Territorios con impuestos propios (IGIC en Canarias, IPSI en Ceuta y
// Melilla): sus precios no son comparables en euros con los del resto.
const FISCALIDAD_PROPIA = new Set(['35', '38', '51', '52']);

const INDEPENDIENTES = 'Independientes';

// Con menos estaciones que esto en el país, un rótulo no se considera marca
const MIN_ESTACIONES_MARCA = 8;

// Con menos puntos que esto en una provincia, su mediana no es fiable y se
// compara con la nacional
const MIN_PUNTOS_ZONA = 3;

// Mismo rótulo escrito de varias formas, o marcas que son la misma empresa
const REGLAS_MARCA = [
    ['MOEVE (CEPSA)', /\b(MOEVE|CEPSA)\b/],
    ['CAMPSA', /\bCAMPSA\b/],
    ['PETRONOR', /\bPETRONOR\b/],
    ['REPSOL', /\bREPSOL\b/],
    ['GALP', /\bGALP\b/],
    ['SHELL', /\bSHELL\b/],
    ['BP', /^BP\b/],
    ['BALLENOIL', /\bBALLENOIL\b/],
    ['PLENERGY', /\bPLENERGY\b/],
    ['PETROPRIX', /\bPETROPRIX\b/],
    ['CARREFOUR', /\bCARREFOUR\b/],
    ['ALCAMPO', /\bALCAMPO\b/],
    ['EROSKI', /\bEROSKI\b/],
    ['E.LECLERC', /\bE ?LECLERC\b/],
    ['BONAREA', /\bBON ?AREA\b/],
    ['PETROCAT', /\bPETROCAT\b/],
    ['GM OIL', /\bGM ?OIL\b/],
    ['AUTONET OIL', /\bAUTONET ?OIL\b/],
    ['AVIA', /\bAVIA\b/],
    ['Q8', /\bQ8\b/]
];

// Rótulos que no identifican a ninguna marca
const ROTULO_GENERICO = /^(SIN ROTULO|SIN MARCA|SIN NOMBRE|LIBRE|BLANCA|BLANCO|NINGUNO|NO|NO TIENE|INDEPENDIENTE|GASOLINERA|ESTACION DE SERVICIO|E S|ES|N|N \d.*|\d.*)$/;

function normalizarRotulo(rotulo) {
    return String(rotulo || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const marcaPorRegla = (normalizado) => {
    const regla = REGLAS_MARCA.find(([, re]) => re.test(normalizado));
    return regla ? regla[0] : null;
};

/**
 * Prepara la asignación de marca a partir de todos los rótulos del país:
 * un rótulo que no encaja en ninguna regla es marca solo si lo usan al menos
 * MIN_ESTACIONES_MARCA estaciones; si no, cuenta como "Independientes".
 * @param {string[]} rotulos  rótulos de todas las estaciones
 * @returns {(rotulo: string) => string}
 */
function resolverMarcas(rotulos) {
    const cuentas = new Map();
    for (const rotulo of rotulos) {
        const n = normalizarRotulo(rotulo);
        if (!marcaPorRegla(n)) cuentas.set(n, (cuentas.get(n) || 0) + 1);
    }
    return (rotulo) => {
        const n = normalizarRotulo(rotulo);
        const regla = marcaPorRegla(n);
        if (regla) return regla;
        if (!n || ROTULO_GENERICO.test(n) || (cuentas.get(n) || 0) < MIN_ESTACIONES_MARCA) return INDEPENDIENTES;
        return n;
    };
}

// Operador de un punto de carga tal como se enseña en el ranking; null si
// OpenChargeMap no sabe quién es (no se puede atribuir a nadie).
function marcaOperador(op) {
    if (!op || /unknown operator|business owner/i.test(op)) return null;
    return op.replace(/\s*\((ES|Es|Spain)\)\s*$/, '').trim();
}

function mediana(valores) {
    if (valores.length === 0) return null;
    const v = [...valores].sort((a, b) => a - b);
    const mitad = v.length >> 1;
    return v.length % 2 ? v[mitad] : (v[mitad - 1] + v[mitad]) / 2;
}

/**
 * Precio de referencia de cada provincia: la mediana del precio público de
 * sus puntos, o la nacional si la provincia tiene pocos o no se conoce.
 * @param {{prov: string|null, ref: number|null}[]} puntos  todos los del país
 * @returns {(prov: string|null) => number|null}
 */
function referenciaPorZona(puntos) {
    const porProvincia = new Map();
    const todos = [];
    for (const p of puntos) {
        if (!(p.ref > 0)) continue;
        todos.push(p.ref);
        if (!p.prov) continue;
        if (!porProvincia.has(p.prov)) porProvincia.set(p.prov, []);
        porProvincia.get(p.prov).push(p.ref);
    }
    const nacional = mediana(todos);
    const medianas = new Map();
    for (const [prov, precios] of porProvincia) {
        if (precios.length >= MIN_PUNTOS_ZONA) medianas.set(prov, mediana(precios));
    }
    return (prov) => medianas.get(prov) ?? nacional;
}

/**
 * Marcas ordenadas de más barata a más cara respecto a lo normal en su zona.
 * @param {{marca: string|null, prov: string|null, precio: number}[]} puntos  los del ámbito
 * @param {(prov: string|null) => number|null} referencia  de referenciaPorZona()
 * @param {{minPuntos?: number}} opciones  puntos mínimos para que una marca entre
 * @returns {{marca: string, n: number, dif: number, precio: number}[]}
 *   dif: diferencia mediana con su zona (-0.05 = un 5 % más barata)
 *   precio: mediana del precio de la marca en el ámbito
 */
function rankingMarcas(puntos, referencia, { minPuntos = 5 } = {}) {
    const grupos = new Map();
    for (const p of puntos) {
        const ref = referencia(p.prov);
        if (!p.marca || !(p.precio > 0) || !(ref > 0)) continue;
        if (!grupos.has(p.marca)) grupos.set(p.marca, { difs: [], precios: [] });
        const g = grupos.get(p.marca);
        g.difs.push(p.precio / ref - 1);
        g.precios.push(p.precio);
    }
    return [...grupos]
        .filter(([, g]) => g.difs.length >= minPuntos)
        .map(([marca, g]) => ({ marca, n: g.difs.length, dif: mediana(g.difs), precio: mediana(g.precios) }))
        .sort((a, b) => a.dif - b.dif || b.n - a.n);
}

/**
 * Las estaciones más baratas del ámbito, de menor a mayor precio.
 * Excluye los gratuitos (precio 0), que van aparte.
 */
function rankingEstaciones(puntos, limite = 10) {
    return puntos
        .filter(p => p.precio > 0)
        .sort((a, b) => a.precio - b.precio || (a.distKm ?? 0) - (b.distKm ?? 0))
        .slice(0, limite);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PROVINCIAS, FISCALIDAD_PROPIA, INDEPENDIENTES,
        normalizarRotulo, resolverMarcas, marcaOperador,
        mediana, referenciaPorZona, rankingMarcas, rankingEstaciones
    };
}
