/**
 * Strict monochrome: pure black ground, pure white structure. No grey fills,
 * no gradient bevels - separation comes from shape and hairline outlines, so
 * nothing muddies on an OLED panel.
 */
export const colors = {
  black: '#000000',
  white: '#ffffff',

  floor: '#000000',
  wall: '#ffffff',

  hole: '#000000',
  holeRing: '#ffffff',

  marble: '#ffffff',
  marbleRing: '#000000',

  goal: '#ffffff',

  text: '#ffffff',
} as const;

/** White at reduced alpha - the only permitted shade, used purely for rank. */
export const alpha = {
  dim: 0.55,
  faint: 0.32,
  hairline: 0.16,
} as const;

export const FRAME = 10;
