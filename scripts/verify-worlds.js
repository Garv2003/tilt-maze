/**
 * Checks the world grouping in src/game/worlds.ts against the real level list.
 *
 *   node scripts/verify-worlds.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tilt-maze-worlds-'));

execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    'src/game/worlds.ts',
    '--ignoreConfig',
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--target',
    'es2020',
    '--skipLibCheck',
    '--resolveJsonModule',
  ],
  { cwd: root, stdio: 'inherit' },
);
fs.copyFileSync(
  path.join(root, 'src', 'game', 'levels.json'),
  path.join(outDir, 'levels.json'),
);

const { LEVELS } = require(path.join(outDir, 'levels.js'));
const worlds = require(path.join(outDir, 'worlds.js'));

const failures = [];
const expect = (ok, message) => {
  if (!ok) {
    failures.push(message);
  }
};

expect(
  LEVELS.length % worlds.WORLD_SIZE === 0,
  `${LEVELS.length} levels do not fill whole worlds of ${worlds.WORLD_SIZE}`,
);
expect(
  worlds.worldOf(0) === 0 && worlds.worldOf(9) === 0,
  'levels 1-10 are world 1',
);
expect(worlds.worldOf(10) === 1, 'level 11 starts world 2');
expect(
  worlds.isWorldStart(0) && worlds.isWorldStart(10),
  'world starts are 0, 10, ...',
);
expect(!worlds.isWorldStart(5), 'level 6 does not start a world');
expect(
  worlds.worldCount(LEVELS.length) === Math.ceil(LEVELS.length / 10),
  'world count',
);

for (let w = 0; w < worlds.worldCount(LEVELS.length); w++) {
  expect(worlds.worldName(w).length > 0, `world ${w + 1} has no name`);
}

// Clearing two levels with 3 and 2 stars is reflected in their world only.
const progress = {
  records: {
    [LEVELS[0].id]: {
      completed: true,
      bestMs: 1,
      fewestFalls: 0,
      bestStars: 3,
    },
    [LEVELS[1].id]: {
      completed: true,
      bestMs: 1,
      fewestFalls: 0,
      bestStars: 2,
    },
    [LEVELS[12].id]: {
      completed: true,
      bestMs: 1,
      fewestFalls: 0,
      bestStars: 1,
    },
    // Saves from before star ratings have no stars; they still count as cleared.
    [LEVELS[2].id]: {
      completed: true,
      bestMs: 1,
      fewestFalls: 0,
      bestStars: null,
    },
  },
};
const first = worlds.worldStats(LEVELS, progress.records, 0);
const second = worlds.worldStats(LEVELS, progress.records, 1);
expect(
  first.cleared === 3 && first.stars === 5,
  `world 1: ${JSON.stringify(first)}`,
);
expect(first.total === 10 && first.maxStars === 30, 'world 1 totals');
expect(
  second.cleared === 1 && second.stars === 1,
  `world 2: ${JSON.stringify(second)}`,
);

fs.rmSync(outDir, { recursive: true, force: true });

if (failures.length) {
  console.log(failures.map(f => `FAIL  ${f}`).join('\n'));
  process.exit(1);
}
console.log(
  `Worlds valid: ${worlds.worldCount(LEVELS.length)} worlds of ${worlds.WORLD_SIZE}`,
);
