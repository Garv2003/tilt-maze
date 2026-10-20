import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A recorded run: marble positions as a flat `[x0, y0, x1, y1, ...]` array in
 * cell units, one pair every GHOST_SAMPLE_MS of run time. Cell units rather
 * than pixels, so a ghost recorded on one screen size replays on any other.
 */
export type GhostPath = number[];

export const GHOST_SAMPLE_MS = 50;

/** Two minutes of samples. A longer run is not worth the storage. */
export const MAX_GHOST_VALUES = (120_000 / GHOST_SAMPLE_MS) * 2;

/**
 * Recording stops here, two values short of the cap, so the sample added on
 * the goal still fits. Otherwise a run near two minutes would be dropped whole.
 */
export const RECORDING_CAP = MAX_GHOST_VALUES - 2;

const keyFor = (levelId: string) => `tilt-maze/ghost/v1/${levelId}`;

const isPath = (value: unknown): value is GhostPath =>
  Array.isArray(value) &&
  value.length >= 2 &&
  value.length % 2 === 0 &&
  value.length <= MAX_GHOST_VALUES &&
  value.every(n => typeof n === 'number' && Number.isFinite(n));

/** Never throws: a missing or damaged ghost just means racing nobody. */
export const loadGhost = async (levelId: string): Promise<GhostPath | null> => {
  try {
    const raw = await AsyncStorage.getItem(keyFor(levelId));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isPath(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Fire-and-forget. Paths over the length cap are dropped, not truncated. */
export const saveGhost = (levelId: string, path: GhostPath) => {
  if (!isPath(path)) {
    return;
  }
  // Hundredths of a cell is well under a pixel, and halves the JSON.
  const rounded = path.map(n => Math.round(n * 100) / 100);
  AsyncStorage.setItem(keyFor(levelId), JSON.stringify(rounded)).catch(() => {
    // Losing a ghost costs a replay, never a run.
  });
};

export const clearGhosts = async (levelIds: string[]) => {
  try {
    await AsyncStorage.multiRemove(levelIds.map(keyFor));
  } catch {
    // Nothing useful to do; a stale ghost is harmless.
  }
};

/**
 * Where the ghost is `ms` into its run, in cell units, interpolating between
 * samples. Past the end it rests on the final sample - the goal.
 */
export const ghostPositionAt = (path: GhostPath, ms: number) => {
  'worklet';
  const count = path.length / 2;
  const f = Math.max(0, ms / GHOST_SAMPLE_MS);
  const i = Math.floor(f);
  if (i >= count - 1) {
    return { x: path[path.length - 2], y: path[path.length - 1] };
  }
  const k = f - i;
  return {
    x: path[i * 2] + (path[i * 2 + 2] - path[i * 2]) * k,
    y: path[i * 2 + 1] + (path[i * 2 + 3] - path[i * 2 + 1]) * k,
  };
};
