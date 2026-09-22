/**
 * Static checks on every level in src/game/levels.json.
 *
 * A pit that seals a one-cell corridor makes a level impossible, and that is
 * very easy to do by accident - this caught several during authoring.
 *
 *   node scripts/verify-levels.js
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'game', 'levels.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const { cols: COLS, rows: ROWS, levels } = data;

const key = (y, x) => y * COLS + x;
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Flood fill from the start, optionally treating pits as impassable. */
const reach = (grid, start, avoidPits) => {
  const seen = new Set([key(start.y, start.x)]);
  const queue = [start];

  while (queue.length) {
    const { y, x } = queue.shift();
    for (const [dy, dx] of NEIGHBOURS) {
      const ny = y + dy;
      const nx = x + dx;
      if (ny < 0 || nx < 0 || ny >= ROWS || nx >= COLS) {
        continue;
      }
      if (seen.has(key(ny, nx))) {
        continue;
      }
      const cell = grid[ny][nx];
      if (cell === '#' || (avoidPits && cell === 'O')) {
        continue;
      }
      seen.add(key(ny, nx));
      queue.push({ y: ny, x: nx });
    }
  }

  return seen;
};

const findChar = (grid, char) => {
  for (let y = 0; y < ROWS; y++) {
    const x = grid[y].indexOf(char);
    if (x >= 0) {
      return { y, x };
    }
  }
  return null;
};

const ids = new Set();
let failed = 0;

for (const level of levels) {
  const { grid } = level;
  const errors = [];
  const label = (level.name || level.id || '?').padEnd(12);

  if (ids.has(level.id)) {
    errors.push('duplicate id');
  }
  ids.add(level.id);
  if (!/^[a-z0-9-]+$/.test(level.id || '')) {
    errors.push('id is not kebab-case');
  }

  // Shape first: every later check assumes a well-formed grid.
  if (grid.length !== ROWS) {
    errors.push(`${grid.length} rows, expected ${ROWS}`);
  } else {
    grid.forEach((row, y) => {
      if (row.length !== COLS) {
        errors.push(`row ${y} is ${row.length} wide`);
      }
      const bad = [...row].find(c => !'#.SOG'.includes(c));
      if (bad) {
        errors.push(`row ${y} contains '${bad}'`);
      }
    });
  }

  if (errors.length) {
    failed++;
    console.log(`FAIL  ${label} ${errors.join('; ')}`);
    continue;
  }

  const all = grid.join('');
  const count = c => [...all].filter(x => x === c).length;
  if (count('S') !== 1) {
    errors.push(`${count('S')} starts`);
  }
  if (count('G') !== 1) {
    errors.push(`${count('G')} goals`);
  }

  // The border is the wall the marble hits; a gap would let it escape.
  const borderOpen =
    [...grid[0], ...grid[ROWS - 1]].some(c => c !== '#') ||
    grid.some(row => row[0] !== '#' || row[COLS - 1] !== '#');
  if (borderOpen) {
    errors.push('border is not solid');
  }

  const start = findChar(grid, 'S');
  const goal = findChar(grid, 'G');

  if (start && goal) {
    const safe = reach(grid, start, true);
    if (!safe.has(key(goal.y, goal.x))) {
      errors.push('NO SAFE ROUTE to the goal');
    }

    // A pit nothing can roll into is decoration, not a hazard.
    const anywhere = reach(grid, start, false);
    let stranded = 0;
    grid.forEach((row, y) => {
      [...row].forEach((c, x) => {
        if (c === 'O' && !anywhere.has(key(y, x))) {
          stranded++;
        }
      });
    });
    if (stranded) {
      errors.push(`${stranded} unreachable pit(s)`);
    }

    if (!errors.length) {
      console.log(
        `ok    ${label} ${String(safe.size).padStart(3)} safe cells, ${count('O')} pits`,
      );
    }
  }

  if (errors.length) {
    failed++;
    console.log(`FAIL  ${label} ${errors.join('; ')}`);
  }
}

console.log(
  failed
    ? `\n${failed} of ${levels.length} level(s) need fixing`
    : `\nAll ${levels.length} levels valid`,
);
process.exit(failed ? 1 : 0);
