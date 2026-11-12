// Locations and the pinned source of the data pipeline (npm run data:fetch / data:build).
import { fileURLToPath } from 'node:url';

const at = path => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export const SOURCE = {
  file: 'FC26_20250921.csv',
  // rovnez, "FC 26 (FIFA 26) player data" (Kaggle, CC BY 4.0); byte-identical public copy:
  url: 'https://raw.githubusercontent.com/Din1225/Data-Mining-Hw1/2276bf1434028fbd55a564d450d3971e75b425c5/data/FC26_20250921.csv',
  sha256: '4399cb2bcc2a14a2872e76a118f8f4bf64d7954503949c75751a14f33863e3b2',
};
// Past editions (FIFA 15–23, career mode; sofifa.com scrape with the same 110 columns): the
// source of the Legends and the Prime versions. jsulz/FIFA23 on Hugging Face (MIT), pinned to
// a dataset revision.
export const LEGACY_SOURCE = {
  file: 'FIFA15-23_male_players_legacy.csv',
  url: 'https://huggingface.co/datasets/jsulz/FIFA23/resolve/0b74dbfc434808cf5573f0f11f4c977185bd0e0c/male_players%20(legacy).csv',
  page: 'https://huggingface.co/datasets/jsulz/FIFA23',
  revision: '0b74dbfc434808cf5573f0f11f4c977185bd0e0c',
  bytes: 90933390,
  sha256: '13389f463935d257e92811eebbd50405df1a982aa45233a63d1ce075daca133e',
};
export const PATHS = {
  csv: at(`data/raw/${SOURCE.file}`), // gitignored download
  legacyCsv: at(`data/raw/${LEGACY_SOURCE.file}`), // gitignored download (91 MB)
  captains: at('data/captains.json'), // reviewed Captain list (compiler input)
  legends: at('app/data/legends.v1.json'), // Legends + Prime versions, fetched when a draft starts
  legendsProvenance: at('data/build/legends.json'), // gitignored, with provenance
  reference: at('data/catalog-reference.json'),
  nationCodes: at('data/nation-codes.json'),
  provenance: at('data/build/players-fc26.json'), // gitignored full catalog with provenance
  catalog: at('app/data/catalog.v3.json'), // the only catalog file the browser fetches
  flags: at('app/assets/flags'),
  flagSource: at('node_modules/flag-icons'),
};
