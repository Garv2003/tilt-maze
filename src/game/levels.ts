import source from './levels.json';

export type LevelDef = {
  id: string;
  name: string;
  grid: string[];
};

type LevelSource = {
  schema: number;
  cols: number;
  rows: number;
  levels: LevelDef[];
};

const data = source as LevelSource;

export const SCHEMA = data.schema;
export const COLS = data.cols;
export const ROWS = data.rows;
export const INTERIOR_COLS = COLS - 2;
export const INTERIOR_ROWS = ROWS - 2;

/**
 * Shape check only, run once at import. A malformed grid should fail loudly
 * here rather than render a board with no goal on it. Solvability is a much
 * heavier property and is enforced before levels ship, by the build-time
 * validator that BFS-walks every level avoiding pits.
 */
const assertWellFormed = (level: LevelDef, index: number) => {
  const where = `level ${index} (${level.id ?? 'no id'})`;

  if (!level.id || !level.name) {
    throw new Error(`${where}: missing id or name`);
  }
  if (level.grid.length !== ROWS) {
    throw new Error(`${where}: ${level.grid.length} rows, expected ${ROWS}`);
  }

  let starts = 0;
  let goals = 0;

  level.grid.forEach((row, y) => {
    if (row.length !== COLS) {
      throw new Error(
        `${where}: row ${y} is ${row.length} wide, expected ${COLS}`,
      );
    }
    for (const char of row) {
      if (!'#.SOG'.includes(char)) {
        throw new Error(`${where}: row ${y} contains '${char}'`);
      }
      if (char === 'S') {
        starts++;
      }
      if (char === 'G') {
        goals++;
      }
    }
  });

  if (starts !== 1 || goals !== 1) {
    throw new Error(
      `${where}: ${starts} start(s) and ${goals} goal(s), expected 1 of each`,
    );
  }
};

data.levels.forEach(assertWellFormed);

export const LEVELS: LevelDef[] = data.levels;

export const levelIndexById = (id: string) =>
  LEVELS.findIndex(level => level.id === id);

export type Rect = { x: number; y: number; w: number; h: number };
export type Circle = { x: number; y: number; r: number };

export type ParsedLevel = {
  id: string;
  name: string;
  cell: number;
  width: number;
  height: number;
  walls: Rect[];
  holes: Circle[];
  goal: Circle;
  start: { x: number; y: number };
};

type Run = { row: number; x0: number; x1: number };

/**
 * Merges the wall cells into as few rectangles as possible. Fewer, larger
 * rects mean fewer internal seams for the marble to snag on, and fewer
 * collision checks per physics substep.
 */
const mergeWalls = (grid: string[], cell: number): Rect[] => {
  const runs: Run[] = [];

  grid.forEach((row, y) => {
    let x0 = -1;
    for (let x = 0; x <= COLS; x++) {
      const isWall = row[x] === '#';
      if (isWall && x0 === -1) {
        x0 = x;
      } else if (!isWall && x0 !== -1) {
        runs.push({ row: y, x0, x1: x - 1 });
        x0 = -1;
      }
    }
  });

  const used = runs.map(() => false);
  const rects: Rect[] = [];

  runs.forEach((run, i) => {
    if (used[i]) {
      return;
    }
    used[i] = true;

    // Grow downward while the run below covers exactly the same columns.
    let lastRow = run.row;
    for (let j = i + 1; j < runs.length; j++) {
      const next = runs[j];
      if (used[j] || next.x0 !== run.x0 || next.x1 !== run.x1) {
        continue;
      }
      if (next.row !== lastRow + 1) {
        continue;
      }
      used[j] = true;
      lastRow = next.row;
    }

    rects.push({
      x: run.x0 * cell,
      y: run.row * cell,
      w: (run.x1 - run.x0 + 1) * cell,
      h: (lastRow - run.row + 1) * cell,
    });
  });

  return rects;
};

export const parseLevel = (def: LevelDef, cell: number): ParsedLevel => {
  const center = (i: number) => i * cell + cell / 2;

  const holes: Circle[] = [];
  let goal: Circle = {
    x: center(COLS - 2),
    y: center(ROWS - 2),
    r: cell * 0.36,
  };
  let start = { x: center(1), y: center(1) };

  def.grid.forEach((row, y) => {
    for (let x = 0; x < COLS; x++) {
      const char = row[x];
      if (char === 'O') {
        holes.push({ x: center(x), y: center(y), r: cell * 0.34 });
      } else if (char === 'G') {
        goal = { x: center(x), y: center(y), r: cell * 0.36 };
      } else if (char === 'S') {
        start = { x: center(x), y: center(y) };
      }
    }
  });

  return {
    id: def.id,
    name: def.name,
    cell,
    width: COLS * cell,
    height: ROWS * cell,
    walls: mergeWalls(def.grid, cell),
    holes,
    goal,
    start,
  };
};

/**
 * The visible board: the level minus its collision-only border ring. The bezel
 * is drawn around this, so the frame and the wall the marble hits coincide.
 */
export const playArea = (level: ParsedLevel) => ({
  x: level.cell,
  y: level.cell,
  width: level.width - level.cell * 2,
  height: level.height - level.cell * 2,
});
