// Use the catalog's football name, preserving mononyms and compound surnames.
export const commonName = p =>
  String(p.name || '')
    .replace(/^(?:\p{L}\.\s*)+/u, '')
    .trim();
export function receiptLabel(p, now, duration = 1.25, hold = 0.5) {
  const age = now - (p.possessionAt ?? -Infinity);
  if (age < 0 || age >= duration) return null;
  const steady = Math.min(hold, duration * 0.95),
    fade = Math.max(0, (age - steady) / (duration - steady));
  return { text: commonName(p), opacity: 0.82 * (1 - fade * fade * (3 - 2 * fade)) };
}
