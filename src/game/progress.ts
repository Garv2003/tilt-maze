import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LevelDef } from './levels';

const STORAGE_KEY = 'tilt-maze/progress/v1';

export type LevelRecord = {
  completed: boolean;
  bestMs: number | null;
  fewestFalls: number | null;
};

export type Progress = {
  /** Keyed by level id, never by index, so reordering levels cannot corrupt it. */
  records: Record<string, LevelRecord>;
  lastPlayed: string | null;
};

export const emptyProgress = (): Progress => ({
  records: {},
  lastPlayed: null,
});

export const recordFor = (progress: Progress, levelId: string): LevelRecord =>
  progress.records[levelId] ?? {
    completed: false,
    bestMs: null,
    fewestFalls: null,
  };

const isRecord = (value: unknown): value is LevelRecord => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const r = value as Partial<LevelRecord>;
  return (
    typeof r.completed === 'boolean' &&
    (r.bestMs === null || typeof r.bestMs === 'number') &&
    (r.fewestFalls === null || typeof r.fewestFalls === 'number')
  );
};

/**
 * Never throws and never rejects. Storage can be missing, truncated, or left
 * over from an older build, and none of those should stop the game launching -
 * the worst case is starting over, not a crash on a black screen.
 */
export const loadProgress = async (): Promise<Progress> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyProgress();
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return emptyProgress();
    }

    const { records, lastPlayed } = parsed as Partial<Progress>;
    const clean: Record<string, LevelRecord> = {};

    Object.entries(records ?? {}).forEach(([id, record]) => {
      if (isRecord(record)) {
        clean[id] = record;
      }
    });

    return {
      records: clean,
      lastPlayed: typeof lastPlayed === 'string' ? lastPlayed : null,
    };
  } catch {
    return emptyProgress();
  }
};

/** Fire-and-forget: a failed write must never block a level transition. */
export const saveProgress = (progress: Progress) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(progress)).catch(() => {
    // Storage is a convenience here; losing a write costs a best time, not a run.
  });
};

/** Keeps the better time and the lower fall count. */
export const withCompletion = (
  progress: Progress,
  levelId: string,
  ms: number,
  falls: number,
): Progress => {
  const previous = recordFor(progress, levelId);

  return {
    lastPlayed: levelId,
    records: {
      ...progress.records,
      [levelId]: {
        completed: true,
        bestMs: previous.bestMs === null ? ms : Math.min(previous.bestMs, ms),
        fewestFalls:
          previous.fewestFalls === null
            ? falls
            : Math.min(previous.fewestFalls, falls),
      },
    },
  };
};

export const clearProgress = async () => {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do; the caller resets in-memory state regardless.
  }
};

/** The first level is always open; every other one waits on the previous. */
export const isUnlocked = (
  index: number,
  levels: LevelDef[],
  progress: Progress,
): boolean =>
  index === 0 || recordFor(progress, levels[index - 1].id).completed;

export const completedCount = (levels: LevelDef[], progress: Progress) =>
  levels.filter(level => recordFor(progress, level.id).completed).length;

/** The level the map should point at: the first one not yet cleared. */
export const nextLevelIndex = (levels: LevelDef[], progress: Progress) => {
  const index = levels.findIndex(
    level => !recordFor(progress, level.id).completed,
  );
  return index === -1 ? levels.length - 1 : index;
};
