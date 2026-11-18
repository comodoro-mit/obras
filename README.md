<p align="center">
  <img src="public/assets/marca/logotipo.png" alt="Dirección General de Modernización e Investigación Territorial" height="70">
</p>

<h2 align="center">Obras públicas</h2>

<p align="center">
  Visor web interactivo de obras públicas de la ciudad
</p>

## Qué hace

- Mapa con mapa base **Argenmap** (IGN, claro y oscuro) y **satelital** (Esri).
- Cada obra es un punto con color e ícono según el **tipo de obra** (cloacas, agua, gas, pluviales, calles, veredas y plazas, muros, edificios).
- Panel con **buscador** (por nombre, barrio, calle o N° de proyecto), filtros por **tipo** y **año** de presupuesto, y listado.
- **Ficha** de cada obra: plazo, fecha de presupuesto, beneficiarios, barrio, botones *Ver en el mapa*, *Cómo llegar* y *Compartir*.
- **Enlaces directos** a una obra: `…/#obra-191` (se pueden compartir; el botón "atrás" vuelve al listado).
- **Obras cerca de mí**: con la ubicación del navegador, ordena el listado por distancia.
- Las obras **sin coordenadas** aparecen en el listado (marcadas "sin ubicación") pero no en el mapa.
- Tema claro/oscuro, pantalla completa, diseño adaptado a celular (hoja inferior deslizable).

## Datos

El script `csv-a-geojson.mjs` toma el CSV exportado del sistema (separador `;`, UTF-8) y:

| Problema en el CSV | Qué hace |
|---|---|
| Coordenadas vacías | La obra queda sin geometría (sale en el listado, no en el mapa) |
| Coordenadas en grados.min.seg (`45.52.36`) | Las convierte a decimal negativo |
| Coordenadas fuera de Comodoro | Las descarta y avisa |
| `\N` (NULL de MySQL) | Lo trata como vacío |
| Plazo en formatos mezclados (`180`, `6 MESES`, `60 días corridos`) | Normaliza a días + texto legible |
| Barrio cargado en "beneficiarios" | Lo ignora como beneficiario |
| Beneficiarios `0` | Lo trata como "sin dato" |
| Filas de prueba (`SDFDSF…`) | Las descarta |
| Nombres en MAYÚSCULAS | Genera un nombre legible respetando siglas (`SCPL`, `N°`) |

Además **deduce el tipo de obra y el barrio a partir del nombre**. Es una solución provisoria:
lo ideal es que el sistema municipal tenga esos campos propios (tipo de obra, barrio, estado, monto, fechas de inicio/fin, fotos).

### Campos que sumarían mucho para el vecino

- **Estado** de la obra (en licitación / en ejecución / finalizada) y % de avance.
- Fecha de inicio y fin estimada.
- Monto / fuente de financiamiento, empresa contratista.
- Fotos.
- Geometría de línea/polígono para obras lineales (redes, calles).

### Conexión a la base de datos (próximo paso)

El visor sólo necesita una URL que devuelva el mismo GeoJSON. Opciones:

1. **Exportación programada**: una tarea en el servidor municipal genera `obras.geojson` (con la lógica del script) y lo sube/commitea → Cloudflare Pages republica solo.
2. **Endpoint en vivo**: un endpoint (PHP/Node/etc.) que consulta la base y devuelve GeoJSON. Se cambia `FUENTE_DATOS` en `public/js/visor.js` por esa URL (habilitar CORS si está en otro dominio).

En Cloudflare → *Workers & Pages* → *Create* → *Pages* → *Connect to Git*, elegir el repositorio y configurar:

| Opción | Valor |
|---|---|
| Framework preset | `None` |
| Build command | *(vacío)* — el CSV no se sube al repositorio: el GeoJSON se regenera localmente con `npm run datos` y se commitea |
| Build output directory | `public` |
| Root directory | `/` (o `obras` si el repo contiene la carpeta padre) |

El nombre del proyecto define la URL: `obraspublicas` → `https://obraspublicas.pages.dev`.

Para el servidor municipal alcanza con copiar el contenido de `public/` a cualquier servidor web.