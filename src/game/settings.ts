import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'tilt-maze/settings/v1';

export type Sensitivity = 'gentle' | 'normal' | 'sharp';

export type Settings = {
  sound: boolean;
  haptics: boolean;
  /** Off falls back to dragging, which also makes the game playable one-handed. */
  useSensor: boolean;
  sensitivity: Sensitivity;
  invertX: boolean;
  invertY: boolean;
  /** Replay your best run as a ghost to race against. */
  ghost: boolean;
};

export const defaultSettings: Settings = {
  sound: true,
  haptics: true,
  useSensor: true,
  sensitivity: 'normal',
  invertX: false,
  invertY: false,
  ghost: true,
};

/** Radians away from the calibrated pose that count as full deflection. */
export const FULL_TILT_FOR: Record<Sensitivity, number> = {
  gentle: 0.55,
  normal: 0.4,
  sharp: 0.28,
};

export const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  gentle: 'GENTLE',
  normal: 'NORMAL',
  sharp: 'SHARP',
};

/**
 * A module-level mirror of the live settings. Sound and haptics fire from deep
 * inside callbacks and worklet bridges where threading a hook through would be
 * noise; they read this instead. The provider keeps it in step.
 */
let current: Settings = defaultSettings;

export const currentSettings = () => current;
export const setCurrentSettings = (next: Settings) => {
  current = next;
};

const isSensitivity = (value: unknown): value is Sensitivity =>
  value === 'gentle' || value === 'normal' || value === 'sharp';

/** Never throws: bad or missing storage falls back to defaults. */
export const loadSettings = async (): Promise<Settings> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultSettings;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return defaultSettings;
    }

    const stored = parsed as Partial<Settings>;
    const bool = (value: unknown, fallback: boolean) =>
      typeof value === 'boolean' ? value : fallback;

    return {
      sound: bool(stored.sound, defaultSettings.sound),
      haptics: bool(stored.haptics, defaultSettings.haptics),
      useSensor: bool(stored.useSensor, defaultSettings.useSensor),
      sensitivity: isSensitivity(stored.sensitivity)
        ? stored.sensitivity
        : defaultSettings.sensitivity,
      invertX: bool(stored.invertX, defaultSettings.invertX),
      invertY: bool(stored.invertY, defaultSettings.invertY),
      ghost: bool(stored.ghost, defaultSettings.ghost),
    };
  } catch {
    return defaultSettings;
  }
};

/** Fire-and-forget: a failed write costs a preference, not a run. */
export const saveSettings = (settings: Settings) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {
    // Preferences are a convenience; losing one write is not worth surfacing.
  });
};
