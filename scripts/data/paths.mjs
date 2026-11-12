// Locations and the pinned source of the data pipeline (npm run data:fetch / data:build).
import { fileURLToPath } from 'node:url';

const at = path => fileURLToPath(new URL(`../../${path}`, import.meta.url));

// Current players: EA SPORTS FC 27, EA's own ratings feed (ea.com ratings pages) as snapshotted
// on 12 September 2026 — 19,789 rows × 60 columns, men and women. Published as "EA SPORTS FC 27
// Player Ratings" (mikedpad, Kaggle); pinned here to a public copy at a fixed commit. The feed
// names clubs and leagues without ids: data/source-map.json ties them to the reference.
export const SOURCE = {
  file: 'FC27_20260912.csv',
  url: 'https://raw.githubusercontent.com/LakshmiKanth11/EA_FC_ANALYSIS/c0b2542d9fcae72d2c538a472a30ee57c4e7c75e/EA_FC_PLAYERS_DATASET_AND_%20DASHBOARD/data/players.csv',
  page: 'https://github.com/LakshmiKanth11/EA_FC_ANALYSIS',
  author: 'Lakshmi Kanth (EA_FC_ANALYSIS)',
  upstream: 'EA SPORTS FC 27 ratings feed (ea.com)',
  license: 'No licence stated (public repository; player data © Electronic Arts)',
  licenseUrl: 'https://github.com/LakshmiKanth11/EA_FC_ANALYSIS#source--legal',
  sha256: '18ed434e5bb90f9afa72363d14438005c785eb4b8872a64c89c75bb38e14e911',
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
  sourceMap: at('data/source-map.json'), // source club/league/nation names → the reference
  reconcileReport: at('data/build/reconcile-report.json'), // gitignored, for review
  nationCodes: at('data/nation-codes.json'),
  provenance: at('data/build/players.json'), // gitignored full catalog with provenance
  catalog: at('app/data/catalog.v3.json'), // the only catalog file the browser fetches
  flags: at('app/assets/flags'),
  flagSource: at('node_modules/flag-icons'),
};
