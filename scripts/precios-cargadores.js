// Interpretación del precio de los puntos de carga y estimación del que falta.
//
// OpenChargeMap publica el coste como texto libre (UsageCost), escrito a mano
// por la comunidad: "0,39€/kWh", "0,50€/kWh DC - 0,45€/kWh AC", "free",
// "parking fee", "2€/hora"… Este módulo lo convierte en un precio en €/kWh
// para el conector concreto del cargador y anota los recargos que no caben
// en ese número (parking, penalización por minuto, cobro por tiempo o sesión).

const PRECIO_MAX = 3; // €/kWh: por encima es texto mal formateado

// Un importe seguido de la unidad de energía. Tres formas, de más a menos fiable:
//   1. "0,39€/kWh", "0.30€ kW/h", "€0/kWh" y erratas habituales (kEh, lWh, Wh,
//      kWHh, o la etiqueta pegada: "kWhDC")
//   2. "0,25€/kW", "0,39/kW" (se olvidan la h)
//   3. "0.39€" a secas, sin unidad de tiempo detrás
const RE_PRECIO = new RegExp([
    String.raw`(\d+(?:\.\d+)?)\s*(?:€|eur(?:os?)?)?\s*\/?\s*(?:[kl]\s?[wel]\s?\/?\s?h+|wh)(?:(?![a-z])|(?=[da]c))`,
    String.raw`(\d+(?:\.\d+)?)\s*€\s*\/?\s*kw\b|(\d+\.\d+)\s*\/\s*kw\b`,
    String.raw`(\d+\.\d+)\s*€(?!\s*\/)`
].join('|'), 'g');

const RE_GRATIS = /\b(free|gratis|gratuit[oa]s?)\b/;
// "Gratis" con condiciones no es gratis para cualquiera: mejor estimar que
// mandar al optimizador a un cargador que luego cobra.
const RE_CONDICION = /\d|client|customer|guest|hu[eé]sped|member|soci[oa]|then|after|first|primer|luego|despu[eé]s|only|s[oó]lo/;
const RE_PARKING_GRATIS = /(free|gratis|gratuito) parking|parking (is )?(free|gratis|gratuito)|aparcamiento gratuito/;

function normalizar(texto) {
    return String(texto).toLowerCase()
        .replace(/(\d)[,'’](\d)/g, '$1.$2') // 0,39 · 0'20 → 0.39 · 0.20
        .replace(/\s+/g, ' ')
        .trim();
}

// Etiquetas de a qué conector aplica un importe, leídas del texto que lo rodea.
function etiquetar(trozo) {
    // Tramo de potencia: ">60kW" o "80-200kW"
    const potencia = trozo.match(/>\s*=?\s*(\d+)\s*kw|(\d+)\s*-\s*\d+\s*kw/);
    return {
        dc: /\bd\s?c(?![a-z])/.test(trozo),
        ac: /\bac(?![a-z])/.test(trozo),
        ac43: /\bac\s?43/.test(trozo),
        minKw: potencia ? Number(potencia[1] ?? potencia[2]) : null,
        kwEtiqueta: null
    };
}

function extraerImportes(t) {
    const hallados = [];
    for (const m of t.matchAll(RE_PRECIO)) {
        const sinUnidad = m[4] !== undefined;
        const valor = parseFloat(m[1] ?? m[2] ?? m[3] ?? m[4]);
        if (!(valor >= 0 && valor < PRECIO_MAX)) continue; // p. ej. "50kW/h"
        // Sin unidad solo nos fiamos de importes con pinta de €/kWh
        if (sinUnidad && !(valor >= 0.1 && valor < 1)) continue;
        hallados.push({ valor, ini: m.index, fin: m.index + m[0].length });
    }
    if (hallados.length === 0) return hallados;

    // Dos estilos: etiqueta delante ("DC: 0,54€/kWh - AC: 0,39€/kWh",
    // "60kW: 0.40€. 120kW: 0.43€") o detrás, el habitual
    // ("0,50€/kWh DC - 0,45€/kWh AC").
    const antesDe = (i) => t.slice(i === 0 ? 0 : hallados[i - 1].fin, hallados[i].ini);
    const tipoDelante = /\b(d\s?c|ac)\s*:?\s*\(?\s*$/;
    const potenciaDelante = /(\d+(?:\.\d+)?)\s*kw\s*:\s*$/;
    const estiloDelante = tipoDelante.test(antesDe(0)) || potenciaDelante.test(antesDe(0));

    return hallados.map((h, i) => {
        if (estiloDelante) {
            const tipo = antesDe(i).match(tipoDelante);
            const potencia = antesDe(i).match(potenciaDelante);
            const ac = !!tipo && tipo[1] === 'ac';
            return {
                valor: h.valor, dc: !!tipo && !ac, ac, ac43: false, minKw: null,
                kwEtiqueta: potencia ? Number(potencia[1]) : null
            };
        }
        const hasta = i + 1 < hallados.length ? hallados[i + 1].ini : t.length;
        // Lo que va entre paréntesis son recargos, no la etiqueta del importe
        const detras = t.slice(h.fin, hasta).split('(')[0];
        return { valor: h.valor, ...etiquetar(detras) };
    });
}

// De varios importes, el que corresponde a la conexión principal del cargador.
function elegirImporte(importes, { dc, kw }) {
    if (importes.length === 1) return importes[0];
    const porValor = [...importes].sort((a, b) => a.valor - b.valor);
    const deAc = importes.filter(i => i.ac);

    // "22kW: 0.32€. 60kW: 0.40€. 120kW: 0.43€": el escalón del cargador
    const escalera = importes.filter(i => i.kwEtiqueta !== null).sort((a, b) => a.kwEtiqueta - b.kwEtiqueta);
    if (escalera.length > 0 && (dc || deAc.length === 0)) {
        return escalera.filter(i => i.kwEtiqueta <= kw).pop() || escalera[0];
    }
    if (dc) {
        // "0,65€/kWh >150kW - 0,55€/kWh >60kW - 0,45€/kWh DC": el tramo más alto
        // que alcanza (en el límite, el caro: mejor pasarse que quedarse corto)
        const porPotencia = importes
            .filter(i => i.minKw !== null && kw >= i.minKw)
            .sort((a, b) => b.minKw - a.minKw)[0];
        return porPotencia
            || importes.find(i => i.dc && i.minKw === null)
            || importes.find(i => i.dc)
            || importes.find(i => !i.ac && i.minKw === null)
            || porValor[porValor.length - 1];
    }
    // Los AC de 43 kW suelen tarifarse como los DC ("DC50kW/AC43kW")
    return (kw >= 43 && deAc.find(i => i.ac43))
        || deAc.find(i => !i.dc)
        || deAc[0]
        || importes.find(i => !i.dc && i.minKw === null)
        || porValor[0];
}

function detectarExtras(t, hayPrecio) {
    const extra = [];
    if (/parking|aparcamiento|estacionamiento/.test(t) && !RE_PARKING_GRATIS.test(t)) extra.push('parking');
    if (/€\s*\/\s*min|per min|por min/.test(t)) extra.push('min');
    if (/€\s*\/\s*(h|hora|hour)s?\b/.test(t)) extra.push('hora');
    if (/€\s*\/\s*(charge|cahrge|carga|ses)/.test(t) || (!hayPrecio && /^\d+(?:\.\d+)?\s*€(?!\s*\/)/.test(t))) extra.push('sesion');
    return extra;
}

/**
 * Interpreta el texto de coste de un cargador.
 * @param {string|null} texto  UsageCost de OpenChargeMap
 * @param {{dc: boolean, kw: number}} conexion  conexión principal del cargador
 * @returns {{precio: number|null, extra: string[]}}  precio en €/kWh (0 = gratis,
 *   null = desconocido) y recargos: 'parking', 'min', 'hora', 'sesion'
 */
function parsearCoste(texto, conexion = { dc: false, kw: 0 }) {
    if (!texto) return { precio: null, extra: [] };
    const t = normalizar(texto);

    let precio = null;
    const importes = extraerImportes(t);
    if (importes.length > 0) {
        precio = elegirImporte(importes, conexion).valor;
    } else {
        // Solo un número: "0", "0,39", "0.45€"
        const suelto = t.match(/^(\d+(?:\.\d+)?)\s*€?$/);
        if (suelto) {
            const valor = parseFloat(suelto[1]);
            if (valor === 0 || (suelto[1].includes('.') && valor < 1)) precio = valor;
        } else if (RE_GRATIS.test(t) && !RE_CONDICION.test(t) && !RE_PARKING_GRATIS.test(t)) {
            precio = 0;
        }
    }
    return { precio, extra: detectarExtras(t, precio !== null) };
}

// --- Estimación del precio que falta ---

// Operadores sin dueño real en OpenChargeMap: su "mediana" no significa nada.
const OPERADOR_GENERICO = /unknown operator|business owner/i;

// Operadores que casi nunca traen precio en OpenChargeMap y que no lo publican
// en ninguna fuente abierta. Valores orientativos del precio público (sin
// suscripción); revisar de vez en cuando.
const PRECIOS_REFERENCIA = [
    // Tesla solo enseña el precio de cada Supercharger en su app y varía por
    // estación y franja horaria: 0,47–0,52 €/kWh para otras marcas (mar. 2026).
    { operador: /tesla/i, dc: 0.50, ac: null }
];

const tramoPotencia = (c) => c.dc
    ? (c.kw < 50 ? 'DC<50' : c.kw < 100 ? 'DC50-99' : c.kw < 150 ? 'DC100-149' : 'DC150+')
    : (c.kw <= 22 ? 'AC<=22' : 'AC>22');

function mediana(valores) {
    const v = [...valores].sort((a, b) => a - b);
    const mitad = v.length >> 1;
    return v.length % 2 ? v[mitad] : (v[mitad - 1] + v[mitad]) / 2;
}

/**
 * Añade `est` (€/kWh estimado) a los cargadores sin precio publicado, a partir
 * de la mediana de los que sí lo publican. De más a menos específico:
 * mismo operador y tramo de potencia → mismo operador y tipo (AC/DC) →
 * precio de referencia del operador → mismo tramo → mismo tipo.
 * Los gratuitos no cuentan para las medianas.
 */
function estimarPrecios(cargadores) {
    const grupos = new Map();
    const apuntar = (clave, precio) => {
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(precio);
    };
    const tipo = (c) => (c.dc ? 'DC' : 'AC');
    const conOperador = (c) => c.op && !OPERADOR_GENERICO.test(c.op);

    for (const c of cargadores) {
        if (!(c.precio > 0)) continue;
        apuntar(`tramo|${tramoPotencia(c)}`, c.precio);
        apuntar(`tipo|${tipo(c)}`, c.precio);
        if (conOperador(c)) {
            apuntar(`op|${c.op}|${tramoPotencia(c)}`, c.precio);
            apuntar(`op|${c.op}|${tipo(c)}`, c.precio);
        }
    }
    const medianaDe = (clave, minimo) => {
        const g = grupos.get(clave);
        return g && g.length >= minimo ? mediana(g) : null;
    };

    for (const c of cargadores) {
        if (c.precio !== null) continue;
        let est = null;
        if (conOperador(c)) {
            est = medianaDe(`op|${c.op}|${tramoPotencia(c)}`, 5) ?? medianaDe(`op|${c.op}|${tipo(c)}`, 10);
            if (est === null) {
                const ref = PRECIOS_REFERENCIA.find(r => r.operador.test(c.op));
                est = ref ? (c.dc ? ref.dc : ref.ac) : null;
            }
        }
        est ??= medianaDe(`tramo|${tramoPotencia(c)}`, 5) ?? medianaDe(`tipo|${tipo(c)}`, 1);
        if (est !== null) c.est = Math.round(est * 100) / 100;
    }
    return cargadores;
}

module.exports = { parsearCoste, estimarPrecios };
