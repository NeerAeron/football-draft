// The one assignment solver (app/core/util/assignment.js) behind best XIs, club line-ups,
// random XIs and the Daily's perfect XI: optimal, deterministic on ties, safe to reuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRows, costMatrix } from '../app/core/util/assignment.js';
import { lcg } from '../app/core/util/rng.js';

// Lowest total of any assignment of n rows to different columns (brute force).
function bruteForce(cost, n, m) {
  let best = Infinity;
  const walk = (row, used, total) => {
    // (No pruning: costs can be negative.)
    if (row === n) return void (best = Math.min(best, total));
    for (let c = 0; c < m; c++)
      if (!(used & (1 << c))) walk(row + 1, used | (1 << c), total + cost[row * m + c]);
  };
  walk(0, 0, 0);
  return best;
}
const solve = (values, n, m) => {
  const cost = costMatrix(n * m);
  for (let i = 0; i < n * m; i++) cost[i] = values[i];
  const owner = assignRows(cost, n, m),
    columns = Array(n).fill(-1);
  let total = 0;
  for (let c = 1; c <= m; c++)
    if (owner[c]) {
      columns[owner[c] - 1] = c - 1;
      total += values[(owner[c] - 1) * m + c - 1];
    }
  return { columns, total };
};

test('every row gets its own column at the lowest total cost', () => {
  const random = lcg(2026);
  let solved = 0;
  for (let k = 0; k < 400; k++) {
    const n = 1 + Math.floor(random() * 6),
      m = n + Math.floor(random() * 4),
      // Integers (many ties), fractions, and forbidden pairs far above the rest.
      values = Array.from({ length: n * m }, () =>
        random() < 0.15 ? 1e6 : k % 2 ? Math.floor(random() * 6) : random() * 10 - 5,
      );
    const { columns, total } = solve(values, n, m);
    assert.equal(new Set(columns).size, n, 'different columns');
    assert.ok(columns.every(c => c >= 0 && c < m));
    assert.ok(Math.abs(total - bruteForce(values, n, m)) < 1e-9, `${n}×${m}: ${total}`);
    solved++;
  }
  assert.equal(solved, 400);
});

test('ties resolve by the order of the columns, the same way every time', () => {
  // All costs equal: row r takes column r.
  assert.deepEqual(solve(Array(3 * 5).fill(1), 3, 5).columns, [0, 1, 2]);
  // Two equally good columns for one row: the first.
  assert.deepEqual(solve([4, 2, 2, 9], 1, 4).columns, [1]);
  const random = lcg(7),
    values = Array.from({ length: 11 * 30 }, () => Math.floor(random() * 4));
  const first = solve(values, 11, 30);
  // A larger problem in between grows the work arrays; the answer does not move.
  solve(
    Array.from({ length: 22 * 400 }, () => random()),
    22,
    400,
  );
  assert.deepEqual(solve(values, 11, 30), first);
  assert.deepEqual(solve(values, 11, 30), first);
});

test('the scratch arrays are reused, never shared between results that are still read', () => {
  const a = costMatrix(12),
    b = costMatrix(8);
  assert.equal(a, b, 'one cost scratch for a smaller or equal problem');
  assert.ok(costMatrix(100000).length >= 100000);
  const owner = assignRows([1, 2, 3, 4], 2, 2);
  assert.deepEqual([owner[1], owner[2]], [1, 2]);
  // The next call writes the same array: read a result before solving again.
  const again = assignRows([5, 1, 1, 5], 2, 2);
  assert.equal(again, owner);
  assert.deepEqual([again[1], again[2]], [2, 1]);
  // No rows: nothing assigned.
  const none = assignRows([], 0, 3);
  assert.deepEqual([none[1], none[2], none[3]], [0, 0, 0]);
});
