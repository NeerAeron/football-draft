// Node-side twin of app/services/catalog.js for tests, tools and scripts: read
// app/data/catalog.v3.json, decode it, reconcile config-dependent values and add indexes.
// Every call returns a fresh catalog, so callers may mutate it.
import { readFileSync } from 'node:fs';
import { decodeCatalog, indexCatalog } from '../../app/core/players/catalog-codec.js';
import { reconcileCatalog } from '../../app/core/players/catalog-derived.js';
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
