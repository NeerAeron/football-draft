// Rectangular assignment (the Hungarian method with potentials, O(rows² × columns)): every row
// gets a different column so that the summed cost is as small as possible. The one solver
// behind the best XI of a squad (draft/pools.js), club line-ups (players/club-lineups.js),
// seeded random XIs (players/lineups.js) and the Daily's perfect XI (competition/daily.js).
//
//   const cost = costMatrix(rows * columns);          // scratch, row-major: cost[r * columns + c]
//   … fill it …                                        // a forbidden pair: a cost far above the rest
//   const owner = assignRows(cost, rows, columns);    // rows <= columns
//   for (let c = 1; c <= columns; c++) if (owner[c]) use(owner[c] - 1, c - 1);
//
// `owner[c]` (1-based column) is the 1-based row assigned to it, 0 for a column left over.
// Deterministic, ties included: columns are scanned in order and only a strictly lower cost
// replaces a choice, so equal costs resolve by the order of the columns (callers order their
// players) — every caller relies on exactly that.
// No allocation per call: the work arrays and the cost scratch are module-level and grow to the
// largest problem seen. Both returned arrays are therefore only valid until the next call
// (read the result before solving again; never keep them).
let size = 0,
  u = new Float64Array(0),
  v = new Float64Array(0),
  best = new Float64Array(0),
  owner = new Int32Array(0),
  via = new Int32Array(0),
  used = new Uint8Array(0),
  scratch = new Float64Array(0);

/** A reusable Float64Array of at least `length` entries for a cost matrix (contents undefined). */
export function costMatrix(length) {
  if (scratch.length < length) scratch = new Float64Array(Math.max(length, scratch.length * 2));
  return scratch;
}

/**
 * Assign `rows` rows to `columns` columns (rows <= columns) at the lowest total cost.
 * @param cost row-major costs, `cost[r * columns + c]` (a Float64Array or any indexable)
 * @returns Int32Array `owner`: owner[c + 1] = row + 1 of column c, or 0 (valid until the next
 *   call).
 */
export function assignRows(cost, rows, columns) {
  const need = Math.max(rows, columns) + 1;
  if (size < need) {
    size = Math.max(need, size * 2);
    u = new Float64Array(size);
    v = new Float64Array(size);
    best = new Float64Array(size);
    owner = new Int32Array(size);
    via = new Int32Array(size);
    used = new Uint8Array(size);
  }
  const n = rows,
    m = columns;
  u.fill(0, 0, n + 1);
  v.fill(0, 0, m + 1);
  owner.fill(0, 0, m + 1);
  via.fill(0, 0, m + 1);
  for (let i = 1; i <= n; i++) {
    owner[0] = i;
    let column = 0;
    best.fill(Infinity, 0, m + 1);
    used.fill(0, 0, m + 1);
    do {
      used[column] = 1;
      const row = owner[column],
        base = (row - 1) * m - 1;
      let delta = Infinity,
        next = 0;
      for (let j = 1; j <= m; j++)
        if (!used[j]) {
          const reduced = cost[base + j] - u[row] - v[j];
          if (reduced < best[j]) {
            best[j] = reduced;
            via[j] = column;
          }
          if (best[j] < delta) {
            delta = best[j];
            next = j;
          }
        }
      for (let j = 0; j <= m; j++)
        if (used[j]) {
          u[owner[j]] += delta;
          v[j] -= delta;
        } else best[j] -= delta;
      column = next;
    } while (owner[column] !== 0);
    do {
      const previous = via[column];
      owner[column] = owner[previous];
      column = previous;
    } while (column !== 0);
  }
  return owner;
}
