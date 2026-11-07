// Use the catalog's football name, preserving mononyms and compound surnames.
export const commonName = p =>
  String(p.name || '')
    .replace(/^(?:\p{L}\.\s*)+/u, '')
    .trim();
