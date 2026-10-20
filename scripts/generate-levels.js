/**
 * Generates levels 17-100 into src/game/levels.json, keeping the 16 hand-made
 * levels untouched. Deterministic (fixed seed), so re-running gives the same file.
 *
 * Every candidate must pass the same checks as shipped levels: a pit-free route
 * to the goal, no stranded pits, and the physics autopilot reaching the goal
 * without falling or overlapping a wall. Par is the autopilot's time with slack.
 *
 *   node scripts/generate-levels.js
 */
const fs = require('fs');
const path = require('path');

const { loadModules, solve } = require('./autopilot');

const file = path.join(__dirname, '..', 'src', 'game', 'levels.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const { cols: COLS, rows: ROWS } = data;
const HAND_MADE = 16;
const TOTAL = 100;
const SEED = 20261020;

const mulberry32 = seed => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const blank = () =>
  Array.from({ length: ROWS }, (_row, y) =>
    Array.from({ length: COLS }, (_col, x) =>
      x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? '#' : '.',
    ),
  );

const inside = (x, y) => x > 0 && y > 0 && x < COLS - 1 && y < ROWS - 1;

/** Distances from a cell across everything that is not a wall (pits count as floor here). */
const distances = (g, from, avoidPits) => {
  const dist = new Map([[from.y * COLS + from.x, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const k = ny * COLS + nx;
      if (!inside(nx, ny) || dist.has(k)) {
        continue;
      }
      const ch = g[ny][nx];
      if (ch === '#' || (avoidPits && ch === 'O')) {
        continue;
      }
      dist.set(k, dist.get(c.y * COLS + c.x) + 1);
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
};

const openCells = g => {
  const cells = [];
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) {
      if (g[y][x] === '.') {
        cells.push({ x, y });
      }
    }
  }
  return cells;
};

/** Start near one end, goal at the far end of the floor plan. */
const placeEnds = (g, rng) => {
  const cells = openCells(g);
  if (cells.length < 8) {
    return null;
  }
  const top = cells.filter(c => c.y <= 3);
  const start = (top.length ? top : cells)[
    Math.floor(rng() * (top.length || cells.length))
  ];
  const dist = distances(g, start, false);
  let best = null;
  for (const c of cells) {
    const d = dist.get(c.y * COLS + c.x);
    if (d === undefined || (c.x === start.x && c.y === start.y)) {
      continue;
    }
    if (!best || d > best.d || (d === best.d && rng() < 0.5)) {
      best = { c, d };
    }
  }
  if (!best) {
    return null;
  }
  g[start.y][start.x] = 'S';
  g[best.c.y][best.c.x] = 'G';
  return { start, goal: best.c, length: best.d };
};

/** Drops pits on random floor cells, keeping a pit-free route to the goal and no stranded pits. */
const addPits = (g, rng, count, start, goal) => {
  const cells = openCells(g).filter(
    c => Math.abs(c.x - start.x) + Math.abs(c.y - start.y) > 2,
  );
  for (
    let tries = 0, placed = 0;
    placed < count && tries < count * 25;
    tries++
  ) {
    const c = cells[Math.floor(rng() * cells.length)];
    if (!c || g[c.y][c.x] !== '.') {
      continue;
    }
    // Keep pits from sitting side by side: it makes a wall of them, not a hazard.
    if (NEIGHBOURS.some(([dx, dy]) => g[c.y + dy]?.[c.x + dx] === 'O')) {
      continue;
    }
    g[c.y][c.x] = 'O';
    if (distances(g, start, true).has(goal.y * COLS + goal.x)) {
      placed++;
    } else {
      g[c.y][c.x] = '.';
    }
  }
};

// ---- layout styles ---------------------------------------------------------

const rooms = (rng, d) => {
  const g = blank();
  const sizes = [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
    [3, 1],
    [1, 3],
  ];
  const blocks = 4 + Math.round(d * 8);
  for (let i = 0; i < blocks; i++) {
    const [w, h] = sizes[Math.floor(rng() * sizes.length)];
    const x = 1 + Math.floor(rng() * (COLS - 2 - w + 1));
    const y = 2 + Math.floor(rng() * (ROWS - 4 - h + 1));
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (inside(x + dx, y + dy)) {
          g[y + dy][x + dx] = '#';
        }
      }
    }
  }
  return { g, pits: 1 + Math.round(d * 7) };
};

const chambers = (rng, d) => {
  const g = blank();
  const wallsX = [5];
  const wallsY = [4, 8];
  for (const x of wallsX) {
    for (let y = 1; y < ROWS - 1; y++) {
      g[y][x] = '#';
    }
  }
  for (const y of wallsY) {
    for (let x = 1; x < COLS - 1; x++) {
      g[y][x] = '#';
    }
  }
  // Every wall segment gets at least one door, so the rooms always connect.
  const door = (x, y) => {
    g[y][x] = '.';
  };
  const segmentsY = [
    [1, 4],
    [6, 9],
  ];
  for (const y of wallsY) {
    for (const [a, b] of segmentsY) {
      door(a + Math.floor(rng() * (b - a + 1)), y);
    }
  }
  for (const [a, b] of [
    [1, 3],
    [5, 7],
    [9, 12],
  ]) {
    door(5, a + Math.floor(rng() * (Math.min(b, ROWS - 2) - a + 1)));
  }
  return { g, pits: 1 + Math.round(d * 6) };
};

const serpentine = (rng, d) => {
  const g = blank();
  const gap = d < 0.4 ? 2 : 1;
  let right = rng() < 0.5;
  for (const y of [3, 6, 9]) {
    for (let x = 1; x < COLS - 1; x++) {
      g[y][x] = '#';
    }
    const from = right ? COLS - 1 - gap : 1;
    for (let x = from; x < from + gap; x++) {
      g[y][x] = '.';
    }
    right = !right;
  }
  return { g, pits: 2 + Math.round(d * 6) };
};

const maze = (rng, d, index) => {
  const g = blank();
  const cw = ((COLS - 1) / 2) | 0; // maze cells across (5 for 11 columns)
  const ch = ((ROWS - 1) / 2) | 0; // and down (6 for 14 rows)
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) {
      g[y][x] = '#';
    }
  }
  const cellAt = (cx, cy) => ({ x: 1 + cx * 2, y: 1 + cy * 2 });
  const seen = new Set();
  const frontier = [[0, 0]];
  seen.add(0);
  const open = (cx, cy) => {
    const c = cellAt(cx, cy);
    g[c.y][c.x] = '.';
  };
  open(0, 0);
  const dfs = index % 2 === 0; // long winding corridors, or short branchy ones
  while (frontier.length) {
    const at = dfs ? frontier.length - 1 : Math.floor(rng() * frontier.length);
    const [cx, cy] = frontier[at];
    const options = NEIGHBOURS.map(([dx, dy]) => [cx + dx, cy + dy]).filter(
      ([nx, ny]) =>
        nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen.has(ny * cw + nx),
    );
    if (!options.length) {
      frontier.splice(at, 1);
      continue;
    }
    const [nx, ny] = options[Math.floor(rng() * options.length)];
    seen.add(ny * cw + nx);
    open(nx, ny);
    const a = cellAt(cx, cy);
    const b = cellAt(nx, ny);
    g[(a.y + b.y) / 2][(a.x + b.x) / 2] = '.';
    frontier.push([nx, ny]);
  }
  // Braiding knocks out some walls so there is more than one way through.
  const braid = 0.3 * (1 - d) + 0.02;
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        if (cx + dx < cw && cy + dy < ch && rng() < braid) {
          const a = cellAt(cx, cy);
          g[a.y + dy][a.x + dx] = '.';
        }
      }
    }
  }
  return { g, pits: Math.round(d * 9) };
};

const pillars = (rng, d) => {
  const g = blank();
  const density = 0.35 + 0.35 * d;
  for (let y = 2; y < ROWS - 2; y += 2) {
    for (let x = 2; x < COLS - 2; x += 2) {
      if (rng() < density) {
        g[y][x] = '#';
        // Longer pillars as it gets harder.
        if (rng() < d * 0.6) {
          g[y + (rng() < 0.5 ? 1 : 0)][x + (rng() < 0.5 ? 1 : 0)] = '#';
        }
      }
    }
  }
  return { g, pits: 1 + Math.round(d * 8) };
};

const STYLES = { rooms, chambers, serpentine, maze, pillars };
const early = ['rooms', 'chambers', 'serpentine', 'pillars', 'maze'];
const late = ['maze', 'pillars', 'maze', 'serpentine', 'chambers', 'rooms'];

const flip = (g, rng) => {
  let out = g.map(row => row.slice());
  if (rng() < 0.5) {
    out = out.map(row => row.reverse());
  }
  if (rng() < 0.3) {
    out = out.reverse();
  }
  return out;
};

// ---- names -----------------------------------------------------------------

const ADJ = [
  'Amber',
  'Hollow',
  'Quiet',
  'Bright',
  'Slate',
  'Ember',
  'Misty',
  'Narrow',
  'Silent',
  'Gilded',
  'Rusted',
  'Frosted',
  'Wandering',
  'Hidden',
];
const NOUN = [
  'Run',
  'Pass',
  'Loop',
  'Bend',
  'Gate',
  'Hall',
  'Path',
  'Drift',
  'Vale',
  'Court',
  'Rise',
  'Steps',
  'Yard',
  'Cut',
];

const names = rng => {
  const all = [];
  for (const a of ADJ) {
    for (const n of NOUN) {
      all.push(`${a} ${n}`);
    }
  }
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
};

// ---- main ------------------------------------------------------------------

const mods = loadModules();
const rng = mulberry32(SEED);
const kept = data.levels.slice(0, HAND_MADE);
const taken = new Set(kept.map(l => l.id));
const pool = names(mulberry32(SEED ^ 0x9e3779b9));
const used = new Set(kept.map(l => l.grid.join('')));
const generated = [];

for (let n = HAND_MADE; n < TOTAL; n++) {
  const d = (n - HAND_MADE) / (TOTAL - 1 - HAND_MADE);
  const order = d < 0.45 ? early : late;
  const style = order[(n - HAND_MADE) % order.length];
  const targetSeconds = 5 + 16 * d;
  let best = null;

  for (let attempt = 0; attempt < 140; attempt++) {
    const built = STYLES[style](rng, d, n);
    const ends = placeEnds(built.g, rng);
    if (!ends || ends.length < 8 + Math.round(d * 8)) {
      continue;
    }
    addPits(built.g, rng, built.pits, ends.start, ends.goal);
    const grid = flip(built.g, rng).map(row => row.join(''));
    const key = grid.join('');
    if (used.has(key)) {
      continue;
    }
    const result = solve(mods, { id: 'x', name: 'x', par: 99, grid });
    if (!result.won || result.maxPenetration >= 0.5) {
      continue;
    }
    const score = Math.abs(result.seconds - targetSeconds);
    if (!best || score < best.score) {
      best = { grid, key, seconds: result.seconds, score, style };
    }
  }

  if (!best) {
    throw new Error(`could not generate level ${n + 1} (${style})`);
  }
  used.add(best.key);
  let name = pool.shift();
  while (taken.has(name.toLowerCase().replace(/ /g, '-'))) {
    name = pool.shift();
  }
  const id = name.toLowerCase().replace(/ /g, '-');
  taken.add(id);
  generated.push({
    id,
    name,
    par: Math.max(5, Math.ceil(best.seconds * 1.5)),
    grid: best.grid,
  });
  process.stdout.write(
    `${String(n + 1).padStart(3)} ${best.style.padEnd(10)} ${name.padEnd(18)} ${best.seconds.toFixed(1)}s\n`,
  );
}

mods.cleanup();
data.levels = [...kept, ...generated];
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(
  `\nWrote ${data.levels.length} levels to ${path.relative(process.cwd(), file)}`,
);
