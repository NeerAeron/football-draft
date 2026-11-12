// Node-side twin of app/services/catalog.js for tests, tools and scripts: read
// app/data/catalog.v3.json, decode it, reconcile config-dependent values and add indexes.
// Every call returns a fresh catalog, so callers may mutate it.
import { readFileSync } from 'node:fs';
import { decodeCatalog, indexCatalog } from '../../app/core/players/catalog-codec.js';
import { reconcileCatalog } from '../../app/core/players/catalog-derived.js';
import { decodeLegends } from '../../app/core/players/legends-codec.js';
import { attachLegends } from '../../app/core/players/legends.js';
import { decodeEras } from '../../app/core/players/eras-codec.js';
import { attachEras } from '../../app/core/players/eras.js';
import { PATHS } from './paths.mjs';

let text = null;
export function readCatalogFile(path = PATHS.catalog) {
  if (path !== PATHS.catalog) return JSON.parse(readFileSync(path, 'utf8'));
  text ??= readFileSync(path, 'utf8');
  return JSON.parse(text);
}
export function loadRuntimeCatalog(path = PATHS.catalog) {
  return indexCatalog(reconcileCatalog(decodeCatalog(readCatalogFile(path))));
}
let legendsText = null;
/** The decoded legends file (app/data/legends.v1.json): { legends, primes, … }. */
export function readLegends() {
  legendsText ??= readFileSync(PATHS.legends, 'utf8');
  return decodeLegends(JSON.parse(legendsText));
}
/**
 * The catalog with Legends and Prime versions attached (`catalog.legends`), as the game has it
 * once a draft starts (services/legends.js).
 */
export function loadLegendCatalog() {
  return attachLegends(loadRuntimeCatalog(), readLegends());
}
let erasText = null;
/** The decoded era file (app/data/eras.v1.json): { cards, pools, … }. */
export function readEras() {
  erasText ??= readFileSync(PATHS.eras, 'utf8');
  return decodeEras(JSON.parse(erasText));
}
/**
 * The catalog with the era pools attached (`catalog.eras`), as the game has it once a World Cup
 * draft or run opens (services/eras.js).
 */
export function loadEraCatalog() {
  return attachEras(loadRuntimeCatalog(), readEras());
}
