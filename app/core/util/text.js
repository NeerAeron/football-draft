// Text helpers for catalog strings (player/club names contain accents and quotes).

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for insertion with innerHTML (element content or quoted attributes). */
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);

/** Strip diacritics ("Mbappé" -> "Mbappe") without changing case. */
export const foldDiacritics = text =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Accent- and case-insensitive search key. */
export const searchKey = text => foldDiacritics(text).toLowerCase();
