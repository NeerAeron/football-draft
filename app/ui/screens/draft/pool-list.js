// Pool list: sort/filter chips, search and the spin's players as PlayerRows with their fit.
// Long pools (a whole league: 500+ players) render in pages of 30 rows; more pages load as
// the end of the list nears (IntersectionObserver) or with "Show more".
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { ChipGroup, PlayerRow, Icon, Button, EmptyState } from '../../components/index.js';
import { poolFilters, filterPool, poolCounts, rowFit } from './draft-model.js';

const PAGE = 30;

export function PoolPanel({
  pool,
  spinId,
  toView,
  hideRatings,
  selectedId,
  onSelect,
  onDraft,
  heading = 'Pick a player',
}) {
  const [filter, setFilter] = useState('best');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef(null);
  const list = useMemo(
    () => filterPool(pool, { filter, query, hideRatings }),
    [pool, filter, query, hideRatings],
  );
  const counts = useMemo(() => poolCounts(pool), [pool]);
  const shown = list.slice(0, limit);

  useEffect(() => {
    setLimit(PAGE);
  }, [spinId, filter, query]);
  useEffect(() => {
    setFilter('best');
    setQuery('');
  }, [spinId]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !globalThis.IntersectionObserver) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) setLimit(n => n + PAGE);
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length < list.length, spinId]);

  return html`<section class="pool" aria-labelledby="pool-title" data-testid="pool">
    <header class="pool__head">
      <h2 class="pool__title" id="pool-title">${heading}</h2>
      <span class="pool__count">
        <b class="num">${counts.available}</b>
        ${` can play${counts.blocked ? ` · ${counts.blocked} without a slot` : ''}`}
      </span>
    </header>
    <div class="pool__tools">
      <${ChipGroup}
        label="Sort and filter the pool"
        options=${poolFilters(hideRatings)}
        value=${filter}
        onChange=${v => setFilter(v || 'best')}
        size="sm"
        scroll
        class="pool__chips"
      />
      <label class="pool__search">
        <${Icon} name="search" size=${16} />
        <span class="visually-hidden">Search players</span>
        <input
          type="search"
          placeholder="Search name, club…"
          value=${query}
          onInput=${e => setQuery(e.currentTarget.value)}
          enterkeyhint="search"
          autocomplete="off"
        />
      </label>
    </div>
    ${
      list.length === 0
        ? html`<${EmptyState}
            icon="search"
            size="sm"
            title="No players match"
            message=${query ? `Nobody called “${query}” here.` : 'Try another filter.'}
          />`
        : html`<ul class="player-list pool__list" role="list">
            ${shown.map(
              (e, i) =>
                html`<li key=${e.profileId}>
                  <${PlayerRow}
                    player=${toView(e)}
                    fit=${rowFit(e)}
                    hideRatings=${hideRatings}
                    selected=${selectedId === e.profileId}
                    disabled=${!e.available}
                    onClick=${e.available ? () => onSelect(e.profileId) : undefined}
                    onDblClick=${e.available && onDraft ? () => onDraft(e.profileId) : undefined}
                    class=${cx('pool__row', i === 0 && filter === 'best' && !query && 'is-top')}
                    data-profile=${e.profileId}
                  />
                </li>`,
            )}
          </ul>`
    }
    ${
      shown.length < list.length &&
      html`<div class="pool__more" ref=${sentinel}>
        <${Button} variant="ghost" size="sm" onClick=${() => setLimit(n => n + PAGE * 2)}>
          Show more (${list.length - shown.length} left)
        <//>
      </div>`
    }
  </section>`;
}
