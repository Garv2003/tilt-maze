import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

import { currentSettings } from './settings';

/**
 * Three short cues, created lazily and reused. Everything here is
 * fire-and-forget: audio focus, codecs and device policy all fail in ways that
 * should never interrupt a run, so failures are swallowed.
 */
const sources = {
  tap: require('../../assets/sounds/tap.wav'),
  fall: require('../../assets/sounds/fall.wav'),
  win: require('../../assets/sounds/win.wav'),
} as const;

export type Cue = keyof typeof sources;

const players: Partial<Record<Cue, AudioPlayer>> = {};
let configured = false;

const configure = () => {
  if (configured) {
    return;
  }
  configured = true;
  // Mixes with other audio rather than stopping the music someone is playing.
  setAudioModeAsync({
    playsInSilentMode: false,
    shouldPlayInBackground: false,
    interruptionMode: 'mixWithOthers',
  }).catch(() => {
    // Falls back to whatever the platform default is.
  });
};

export const playCue = (cue: Cue) => {
  if (!currentSettings().sound) {
    return;
  }

  try {
    configure();
    let player = players[cue];
    if (!player) {
      player = createAudioPlayer(sources[cue]);
      players[cue] = player;
    }
    // Rewind so rapid repeats retrigger instead of being ignored. seekTo is
    // asynchronous, so play once it has finished, and swallow either failing.
    const ready = player;
    Promise.resolve(ready.seekTo(0))
      .catch(() => undefined)
      .then(() => ready.play())
      .catch(() => undefined);
  } catch {
    // No audio is an acceptable outcome; a crash is not.
  }
};
