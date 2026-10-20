import type { LevelDef } from './levels';
import { MAX_STARS } from './stars';

/** Levels are grouped ten to a world so a long list stays easy to scan. */
export const WORLD_SIZE = 10;

const WORLD_NAMES = [
  'First Steps',
  'Open Ground',
  'Narrow Ways',
  'Crossings',
  'Winding Paths',
  'Stepping Stones',
  'Tight Spots',
  'Long Roads',
  'Gauntlets',
  'Mastery',
];

export const worldCount = (levelCount: number) =>
  Math.ceil(levelCount / WORLD_SIZE);

export const worldOf = (levelIndex: number) =>
  Math.floor(levelIndex / WORLD_SIZE);

export const isWorldStart = (levelIndex: number) =>
  levelIndex % WORLD_SIZE === 0;

export const worldName = (world: number) =>
  WORLD_NAMES[world] ?? `World ${world + 1}`;

export type WorldStats = {
  cleared: number;
  total: number;
  stars: number;
  maxStars: number;
};

/** Just the part of a progress record the world totals need. */
type RecordLike = { completed: boolean; bestStars: number | null };

export const worldStats = (
  levels: LevelDef[],
  records: Record<string, RecordLike | undefined>,
  world: number,
): WorldStats => {
  const inWorld = levels.slice(world * WORLD_SIZE, (world + 1) * WORLD_SIZE);
  let cleared = 0;
  let stars = 0;
  for (const level of inWorld) {
    const record = records[level.id];
    if (record?.completed) {
      cleared++;
      stars += record.bestStars ?? 0;
    }
  }
  return {
    cleared,
    total: inWorld.length,
    stars,
    maxStars: inWorld.length * MAX_STARS,
  };
};
