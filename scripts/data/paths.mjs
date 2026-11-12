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
// Older titles (FIFA 98–14): data/legacy-titles.json, copied out of the owner's workbook
// "FIFA 98–14 lean workbook — 10,000 players maximum per title" (extracted from the games' own
// PC databases; soccergaming.com archive) by tools/research/legacy-titles.py: the squad
// players, per title and nationality the first 36 outfielders and 4 keepers. The file is in the
// repository, so a build needs neither the workbook nor Python; both hashes are pinned.
export const LEGACY_TITLES = {
  file: 'legacy-titles.json',
  workbook: 'ratings.xlsb',
  workbookSha256: '86f65a735c150a350fc60b7f6e1355f9a05b53ed9f53bb05149debcc7e796779',
  archive: 'https://soccergaming.com/forums/threads/fifa-dbs-since-fifa-98-download.6469756/',
  sha256: '2de7d32cbfadbefd22bce77e63144fb2ddc243aaf02940b740030aaf8ac090bb',
};
// Name parts (first name, surname, known-as name) of the top 1,000 players of FIFA 2003–14:
// what the first workbook ("FIFA 98–14 top 1,000", legends-98-14.xlsx) had and the wider one
// leaves out. Copied from that workbook's export; in the repository.
export const LEGACY_NAMES = {
  file: 'legacy-names.json',
  workbook: 'legends-98-14.xlsx',
  workbookSha256: 'b49592c70e29b71af9d68d6fc53a108ac054473a425dde1ccf1875d7f625de2a',
  sha256: '8b62da9d7a1d76cdbac3c44fd81507139072fa3f7c6054676ac87874dcff8c41',
};
export const PATHS = {
  csv: at(`data/raw/${SOURCE.file}`), // gitignored download
  legacyCsv: at(`data/raw/${LEGACY_SOURCE.file}`), // gitignored download (91 MB)
  legacyTitles: at(`data/${LEGACY_TITLES.file}`), // FIFA 98–14, in the repository
  legacyNames: at(`data/${LEGACY_NAMES.file}`), // their best known players' name parts
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
