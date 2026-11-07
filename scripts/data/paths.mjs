// Locations and the pinned source of the data pipeline (npm run data:fetch / data:build).
import { fileURLToPath } from 'node:url';

const at = path => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export const SOURCE = {
  file: 'FC26_20250921.csv',
  // rovnez, "FC 26 (FIFA 26) player data" (Kaggle, CC BY 4.0); byte-identical public copy:
  url: 'https://raw.githubusercontent.com/Din1225/Data-Mining-Hw1/2276bf1434028fbd55a564d450d3971e75b425c5/data/FC26_20250921.csv',
  sha256: '4399cb2bcc2a14a2872e76a118f8f4bf64d7954503949c75751a14f33863e3b2',
};
export const PATHS = {
  csv: at(`data/raw/${SOURCE.file}`), // gitignored download
  reference: at('data/catalog-reference.json'),
  nationCodes: at('data/nation-codes.json'),
  provenance: at('data/build/players-fc26.json'), // gitignored full catalog with provenance
  catalog: at('app/data/catalog.v3.json'), // the only catalog file the browser fetches
  flags: at('app/assets/flags'),
  flagSource: at('node_modules/flag-icons'),
};
