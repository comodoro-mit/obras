// Convierte el CSV exportado del sistema de obras públicas en un GeoJSON
// listo para el visor (public/data/obras.geojson).
//
// Uso:  node scripts/csv-a-geojson.mjs [ruta.csv] [salida.geojson]
//
// Sin dependencias: corre con Node 18+.
// Cuando el visor se conecte a la base de datos, esta misma lógica de
// limpieza puede vivir en el endpoint / exportador que genere el GeoJSON.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';

const entrada = resolve(process.argv[2] ?? 'sistema_proyectos_obras_publicas_test.csv');
const salida = resolve(process.argv[3] ?? 'public/data/obras.geojson');

// Recuadro aproximado del ejido de Comodoro Rivadavia: coordenadas fuera
// de este rango se consideran mal cargadas.
const BBOX = { latMin: -46.15, latMax: -45.6, lonMin: -67.95, lonMax: -67.3 };

// ---------- CSV ----------
function parsearCSV(texto, sep = ';') {
  texto = texto.replace(/^﻿/, '');
  const filas = [];
  let fila = [], campo = '', comillas = false, citado = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else comillas = false;
      } else campo += c;
    } else if (c === '"') { comillas = true; citado = true; }
    else if (c === sep) { fila.push(cerrar(campo, citado)); campo = ''; citado = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(cerrar(campo, citado)); campo = ''; citado = false;
      if (fila.some(v => v !== null && v !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(cerrar(campo, citado)); filas.push(fila); }
  return filas;
}
// \N sin comillas = NULL de MySQL
const cerrar = (v, citado) => (!citado && v.trim() === '\\N' ? null : v);

// ---------- Limpieza ----------
const limpio = v => {
  if (v == null) return null;
  const s = v.replace(/\s+/g, ' ').replace(/^"+|"+$/g, '').trim();
  return s === '' ? null : s;
};
const sinTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Coordenadas: decimal ("-45.82") o grados.minutos.segundos ("45.52.36").
// En Comodoro siempre son latitud y longitud negativas (sur / oeste).
function coordenada(v) {
  v = limpio(v);
  if (!v) return null;
  const partes = v.replace(',', '.').split('.');
  let n;
  if (partes.length === 3) {
    const [g, m, s] = partes.map(Number);
    n = Math.abs(g) + m / 60 + s / 3600;
  } else n = Math.abs(Number(v.replace(',', '.')));
  return Number.isFinite(n) ? -Number(n.toFixed(6)) : null;
}

function plazo(v) {
  v = limpio(v);
  if (!v) return { plazoDias: null, plazoTexto: null };
  const num = Number((v.match(/\d+/) || [])[0]);
  if (!num) return { plazoDias: null, plazoTexto: v };
  const meses = /MES/i.test(v);
  const corridos = /corrido/i.test(v);
  return {
    plazoDias: meses ? num * 30 : num,
    plazoTexto: meses ? `${num} ${num === 1 ? 'mes' : 'meses'}` : `${num} días${corridos ? ' corridos' : ''}`,
  };
}

function beneficiarios(v, nombre) {
  v = limpio(v);
  const nada = { beneficiarios: null, beneficiariosTexto: null };
  if (!v) return nada;
  if (/^\d+$/.test(v)) return Number(v) > 0 ? { beneficiarios: Number(v), beneficiariosTexto: null } : nada;
  // A veces se cargó el barrio en este campo: no es un dato de beneficiarios.
  if (/^B[°º]/i.test(v) || sinTildes(nombre.toUpperCase()).includes(sinTildes(v.toUpperCase()))) return nada;
  return { beneficiarios: null, beneficiariosTexto: titulo(v) };
}

// Categoría para el vecino, deducida del nombre de la obra.
// (En el futuro debería venir como campo propio desde la base de datos.)
const REGLAS = [
  ['cloacas', /CLOACA|EFLUENTE|SEPTIC|BOMBEO/],
  ['drenaje', /PLUVIAL|DRENAJE|CAUCE|CANAL|DESAGUE|ALCANTARILLA/],
  ['gas', /\bGAS\b/],
  ['agua', /\bAGUA\b/],
  ['muros', /MURO|CONTENCION/],
  ['vialidad', /SENALIZ|DEMARCACION|TERMOPLASTICA|SELLADO VIAL|TRAMA VIAL|INTERVENCION|PAVIMENT|BACHEO/],
  ['espacio-publico', /VEREDA|PLAZA|PASEO|BARANDA|PARQUE/],
  ['edificios', /NICHERA|ESTACIONAMIENTO|EDIFICIO|CERCO|CEMENTERIO|ESCUELA|CENTRO/],
];
function categoria(nombre) {
  const n = sinTildes(nombre.toUpperCase());
  return (REGLAS.find(([, re]) => re.test(n)) || ['otras'])[0];
}

// Barrio mencionado en el nombre: "B° LAPRIDA MZAS 88..." -> "Laprida"
function barrio(...textos) {
  for (const t of textos) {
    if (!t) continue;
    const m = t.match(/B[°º]\s*([^,;:()\-–]+?)(?=\s+(?:MZ[A-Z]*\.?|SEG[UÚ]N|PROY|ETAPA|PARCELA|Y\s+MZ[A-Z]*)\b|\s*[,;:()\-–]|\.?\s*$)/i);
    if (m) return titulo(m[1].replace(/\.$/, '').trim());
  }
  return null;
}

// MAYÚSCULAS -> Tipo Título legible, respetando siglas y abreviaturas.
const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'al', 'con', 'sobre', 'entre', 'por', 'para', 'desde', 'hasta', 'o']);
const SIGLAS = new Set(['SCPL', 'CPB', 'PA', 'R.P.', 'N°', 'Nº', 'KM9', 'II', 'III', 'IV', 'ARA']);
function titulo(s) {
  if (!s) return s;
  const palabras = s.split(' ');
  return palabras.map((p, i) => {
    if (SIGLAS.has(p.toUpperCase()) || /\d/.test(p)) return p.toUpperCase();
    const min = p.toLowerCase();
    if (i > 0 && MINUSCULAS.has(min) && !/^b[°º]$/i.test(palabras[i - 1])) return min;
    if (/^b[°º]$/i.test(p)) return 'B°';
    return min.replace(/(^|[\s(“"'\-\/.])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  }).join(' ');
}

const pareceBasura = nombre => nombre.split(' ').length < 2;

// ---------- Proceso ----------
const filas = parsearCSV(readFileSync(entrada, 'utf8'));
const cab = filas.shift().map(h => h.trim());
const idx = Object.fromEntries(cab.map((h, i) => [h, i]));
const avisos = [];
const features = [];

for (const f of filas) {
  const get = k => f[idx[k]] ?? null;
  const id = limpio(get('idProyecto'));
  const nombreOriginal = limpio(get('nombreDeLaObra'));
  if (!id || !nombreOriginal) { avisos.push(`fila sin id o nombre: ${f.join(' | ')}`); continue; }
  if (pareceBasura(nombreOriginal)) { avisos.push(`#${id} descartada (nombre de prueba: "${nombreOriginal}")`); continue; }

  let lat = coordenada(get('latitud'));
  let lon = coordenada(get('longitud'));
  if ((lat == null) !== (lon == null)) { lat = lon = null; }
  if (lat != null && (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax)) {
    avisos.push(`#${id} coordenadas fuera de Comodoro (${get('latitud')}, ${get('longitud')}): sin ubicación`);
    lat = lon = null;
  }
  if (lat == null) avisos.push(`#${id} sin ubicación`);

  const presupuesto = limpio(get('mesAnioPresupuesto'));
  const subSector = limpio(get('subSector'));
  const ben = beneficiarios(get('beneficiarios'), nombreOriginal);

  features.push({
    type: 'Feature',
    geometry: lat != null ? { type: 'Point', coordinates: [lon, lat] } : null,
    properties: {
      id: Number(id),
      nombre: titulo(nombreOriginal),
      nombreOriginal,
      categoria: categoria(nombreOriginal),
      subcategoria: titulo(limpio(get('subcategoria'))),
      subSector: titulo(subSector),
      barrio: barrio(nombreOriginal, subSector, limpio(get('beneficiarios'))),
      ...ben,
      ...plazo(get('plazoEjecucion')),
      presupuesto: presupuesto && /^\d{4}-\d{2}/.test(presupuesto) ? presupuesto.slice(0, 7) : null,
    },
  });
}

const geojson = {
  type: 'FeatureCollection',
  metadata: { generado: new Date().toISOString(), fuente: basename(entrada), total: features.length },
  features,
};
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, JSON.stringify(geojson, null, 1));

const conUbic = features.filter(x => x.geometry).length;
console.log(`✔ ${features.length} obras → ${salida}`);
console.log(`  ${conUbic} con ubicación, ${features.length - conUbic} sin ubicación`);
if (avisos.length) console.log('\nAvisos:\n  ' + avisos.join('\n  '));
