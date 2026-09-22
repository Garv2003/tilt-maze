import * as Haptics from 'expo-haptics';

import { currentSettings } from './settings';

/**
 * Feel, not function. Every call is fire-and-forget and swallows its error:
 * plenty of devices have haptics disabled at the OS level, and none of that
 * should surface in the game.
 */
const fire = (run: () => Promise<void>) => {
  if (!currentSettings().haptics) {
    return;
  }
  run().catch(() => {
    // Haptics are optional everywhere they appear.
  });
};

export const hapticWallHit = () =>
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

export const hapticFall = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));

export const hapticGoal = () =>
  fire(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  );

export const hapticTap = () =>
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
