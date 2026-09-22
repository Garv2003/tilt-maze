/**
 * Drives every level to its goal using the REAL physics module, and asserts
 * the marble never overlaps a wall.
 *
 * Solvable-on-paper is not the same as playable: this also catches levels that
 * demand more precision than the difficulty curve should, because the
 * autopilot clips a pit while turning.
 *
 *   node scripts/simulate-physics.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tilt-maze-sim-'));

// Compile the real modules rather than reimplementing them here, so this can
// never drift from what actually ships.
execFileSync(
  process.execPath,
  [
    // Resolve the compiler directly rather than going through npx, which needs
    // a shell on Windows and resolves differently across platforms.
    require.resolve('typescript/bin/tsc'),
    'src/game/physics.ts',
    'src/game/levels.ts',
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

const { stepMarble, distanceTo } = require(path.join(outDir, 'physics.js'));
const { LEVELS, COLS, ROWS, parseLevel } = require(
  path.join(outDir, 'levels.js'),
);

const CELL = 28;
const SUBSTEPS = 4;
const DT = 1 / 60;
const MAX_SECONDS = 120;

// Mirrors the values the game screen builds.
const config = {
  radius: CELL * 0.33,
  accel: CELL * 26,
  damping: 1.7,
  restitution: 0.32,
  maxSpeed: CELL * 22,
};

const findChar = (grid, char) => {
  for (let y = 0; y < ROWS; y++) {
    const x = grid[y].indexOf(char);
    if (x >= 0) {
      return { x, y };
    }
  }
  return null;
};

/** Cell-level BFS gives the autopilot a safe route to steer along. */
const routeFor = (grid, start, goal) => {
  const key = (x, y) => y * COLS + x;
  const previous = new Map();
  const queue = [start];
  const seen = new Set([key(start.x, start.y)]);

  while (queue.length) {
    const cell = queue.shift();
    if (cell.x === goal.x && cell.y === goal.y) {
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
        continue;
      }
      const ch = grid[ny][nx];
      if (ch === '#' || ch === 'O' || seen.has(key(nx, ny))) {
        continue;
      }
      seen.add(key(nx, ny));
      previous.set(key(nx, ny), cell);
      queue.push({ x: nx, y: ny });
    }
  }

  const waypoints = [];
  let cursor = goal;
  while (cursor && !(cursor.x === start.x && cursor.y === start.y)) {
    waypoints.unshift(cursor);
    cursor = previous.get(key(cursor.x, cursor.y));
  }
  return waypoints.map(c => ({
    x: c.x * CELL + CELL / 2,
    y: c.y * CELL + CELL / 2,
  }));
};

/** Resting against a wall means touching it; only real overlap is a bug. */
const worstPenetration = (p, walls, radius) => {
  let worst = 0;
  for (const w of walls) {
    const nx = Math.min(Math.max(p.x, w.x), w.x + w.w);
    const ny = Math.min(Math.max(p.y, w.y), w.y + w.h);
    worst = Math.max(worst, radius - Math.hypot(p.x - nx, p.y - ny));
  }
  return worst;
};

let failures = 0;

for (const def of LEVELS) {
  const level = parseLevel(def, CELL);
  const route = routeFor(
    def.grid,
    findChar(def.grid, 'S'),
    findChar(def.grid, 'G'),
  );

  const p = { ...level.start };
  const v = { x: 0, y: 0 };
  let waypoint = 0;
  let maxPenetration = 0;
  let maxSpeed = 0;
  let fell = null;
  let won = false;
  let frames = 0;

  for (; frames < MAX_SECONDS * 60 && !won && !fell; frames++) {
    const target = route[Math.min(waypoint, route.length - 1)];
    let tx = target.x - p.x;
    let ty = target.y - p.y;
    const length = Math.hypot(tx, ty) || 1;
    // Steer toward the waypoint, easing off so it does not oscillate.
    tx = (tx / length) * 0.55;
    ty = (ty / length) * 0.55;

    for (let i = 0; i < SUBSTEPS; i++) {
      stepMarble(p, v, level.walls, tx, ty, DT / SUBSTEPS, config);
    }

    maxPenetration = Math.max(
      maxPenetration,
      worstPenetration(p, level.walls, config.radius),
    );
    maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y));

    if (Math.hypot(target.x - p.x, target.y - p.y) < CELL * 0.45) {
      waypoint++;
    }
    for (const hole of level.holes) {
      if (distanceTo(p, hole.x, hole.y) < hole.r * 0.9) {
        fell = hole;
      }
    }
    if (distanceTo(p, level.goal.x, level.goal.y) < level.goal.r * 0.8) {
      won = true;
    }
  }

  const ok = won && maxPenetration < 0.5;
  if (!ok) {
    failures++;
  }
  let why = '';
  if (!won) {
    why = fell
      ? `  <- clipped pit at col ${Math.floor(fell.x / CELL)} row ${Math.floor(fell.y / CELL)}`
      : '  <- never reached the goal';
  }

  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${def.name.padEnd(12)} ` +
      `${String(level.walls.length).padStart(2)} rects  ` +
      `${(frames / 60).toFixed(1).padStart(5)}s  ` +
      `overlap ${maxPenetration.toFixed(3)}  peak ${maxSpeed.toFixed(0)}px/s${why}`,
  );
}

fs.rmSync(outDir, { recursive: true, force: true });

console.log(
  failures
    ? `\n${failures} level(s) failed`
    : `\nPhysics stable on all ${LEVELS.length} levels`,
);
process.exit(failures ? 1 : 0);
