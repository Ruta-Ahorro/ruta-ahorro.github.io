# ⛽ Ruta Ahorro — Optimizador de Rutas de Gasolina

PWA que encuentra las gasolineras más baratas en tu ruta por España y planifica
las paradas de repostaje para ahorrar dinero en cada viaje.

**Web:** https://ruta-ahorro.github.io

## Cómo funciona

0. Eliges el tipo de vehículo: **⛽ combustión** o **⚡ eléctrico**.
1. Introduces origen y destino (con autocompletado y opción de usar tu ubicación),
   y si quieres, paradas intermedias para rutas largas. En móvil el botón de
   búsqueda principal se queda fijo al pie del panel.
2. Configuras tu vehículo: tipo de combustible, capacidad del depósito, consumo
   y nivel de combustible actual/deseado al llegar. La configuración se recuerda
   entre visitas.
3. La app calcula la ruta y te propone un plan de paradas, con dos algoritmos a elegir:
   - **Codicioso (greedy):** rápido, elige la gasolinera con mejor precio efectivo
     (incluyendo el coste del desvío) alcanzable en cada tramo.
   - **Programación dinámica:** minimiza el coste total del viaje, con penalización
     por parada y repostaje mínimo para evitar planes con muchas paradas pequeñas.
   Los dos reservan un 5 % del depósito o la batería como margen de seguridad:
   el plan nunca cuenta con él. Si la ruta solo se puede completar apurando esa
   reserva, se calcula igualmente y se avisa de que el plan va muy ajustado.
4. También puedes elegir tus paradas a mano entre las 15 gasolineras más baratas de la ruta.
5. El plan se abre directamente en Google Maps con todas las paradas como waypoints.
6. Las rutas son compartibles: la URL incluye `?origen=...&destino=...` (y `&paradas=`, `&modo=ev`,
   `&coords=` con las coordenadas de los puntos elegidos en el autocompletado).
7. "Buscar cerca de mi ubicación" lista lo más barato alrededor de tu posición, en ambos modos.

### Modo eléctrico

- Configuras batería (kWh) y consumo (kWh/100 km).
- Puedes filtrar los cargadores por potencia mínima (22/50/100/150 kW) y elegir
  hasta qué nivel cargar en ruta (por defecto, el 80 %).
- Se usa el precio publicado del cargador cuando existe; si no, tu tarifa por defecto
  (ahí puedes reflejar tu suscripción). Los cargadores gratuitos aparecen como "Gratis".
- Cada parada muestra el tiempo de carga estimado (a la potencia máxima del
  punto; el real depende del coche) y, al llegar, se sugieren cargadores lentos
  (≤ 22 kW) cerca del destino.
- En combustión, los descuentos por marca (Waylet, etc.) se configuran en cts/L
  y se aplican a la optimización; también hay filtro de estaciones con AdBlue.
  La opción de incluir estaciones de venta restringida solo aparece si los
  datos del Ministerio traen alguna.

## Datos y servicios

- **Precios de carburantes:** [API de Geoportal Gasolineras del Ministerio](https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/).
  Un workflow de GitHub Actions ([actualizar-datos.yml](.github/workflows/actualizar-datos.yml))
  descarga los datos dos veces al día, los convierte a un formato interno compacto
  (números y claves cortas, ~2,4 MB frente a los ~12 MB del API) y los publica en
  [`data/estaciones.json`](data/estaciones.json), de modo que la app los carga
  desde el propio sitio sin depender de proxies CORS. Si el API devuelve una
  respuesta incompleta (menos de 8.000 estaciones), el workflow falla y se
  conservan los datos anteriores; la app avisa si los precios tienen más de dos días.
- **Puntos de carga eléctrica:** [OpenChargeMap](https://openchargemap.org/). El mismo workflow
  los descarga (requiere el secret `OCM_API_KEY` en GitHub) y los procesa con
  [`scripts/procesar-cargadores.js`](scripts/procesar-cargadores.js) a
  [`data/cargadores.json`](data/cargadores.json). El fichero solo se reescribe
  si los cargadores han cambiado.
- **Autocompletado:** [Photon](https://photon.komoot.io/) (komoot, sobre datos de OpenStreetMap).
  La política de uso de Nominatim no permite usarlo para autocompletar.
- **Geocodificación:** [Nominatim](https://nominatim.org/) (OpenStreetMap), solo para los
  puntos escritos a mano y para convertir la ubicación GPS en una dirección.
- **Cálculo de rutas:** [OSRM](https://project-osrm.org/).
- **Mapa:** [Leaflet](https://leafletjs.com/) con teselas de OpenStreetMap.
- **Geometría:** [Turf.js](https://turfjs.org/) en la interfaz. Localizar las estaciones
  sobre la ruta se hace con código propio ([`route-stations.js`](route-stations.js)),
  mucho más rápido, y la optimización corre en un Web Worker.

## Estructura

| Fichero | Descripción |
|---|---|
| `index.html` | Interfaz principal (Bootstrap 5) |
| `app.js` | Lógica de la aplicación: formulario, mapa, carga de datos, resultados |
| `worker.js` | Web Worker con los dos algoritmos de optimización de paradas |
| `route-stations.js` | Geometría compartida por `app.js` y `worker.js`: estaciones cercanas a la ruta y su kilómetro |
| `sw.js` | Service worker (PWA, caché del app shell) |
| `dark-mode.js` | Conmutador de tema claro/oscuro |
| `analytics.js` | Aviso de consentimiento; Google Analytics solo se carga si se acepta y nunca recibe origen ni destino |
| `manifest.json` | Manifest de la PWA |
| `data/estaciones.json` | Precios de gasolineras (generado automáticamente, no editar a mano) |
| `data/cargadores.json` | Puntos de carga eléctrica (generado automáticamente, no editar a mano) |
| `scripts/` | Conversión de los datos del Ministerio y de OpenChargeMap al formato de la app |
| `privacidad.html` | Política de privacidad |
| `tests/test-worker.js` | Tests de los algoritmos de optimización y de la geometría |
| `tests/test-scripts.js` | Tests de los scripts que generan los datos |

## Desarrollo local

Es un sitio 100 % estático; basta con servir la carpeta:

```bash
npx serve .
# o
python -m http.server 8000
```

Nota: el service worker y la geolocalización requieren `localhost` o HTTPS.

## Tests

Los algoritmos del worker y los scripts de datos tienen tests que se ejecutan en CI en cada push
([tests.yml](.github/workflows/tests.yml)):

```bash
npm install
npm test
```
