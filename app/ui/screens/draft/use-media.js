// useMedia('(min-width: 960px)') — re-renders when the query flips. Shared by the setup,
// draft and pre-match screens (one primary CTA in the DOM per layout).
import { useEffect, useState } from 'preact/hooks';

export const WIDE = '(min-width: 960px)';

export function useMedia(query = WIDE) {
  const get = () => !!globalThis.matchMedia?.(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const list = globalThis.matchMedia?.(query);
    if (!list) return;
    const on = () => setMatches(list.matches);
    on();
    list.addEventListener('change', on);
    return () => list.removeEventListener('change', on);
  }, [query]);
  return matches;
}
