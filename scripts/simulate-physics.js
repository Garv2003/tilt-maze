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
const { CELL, loadModules, solve } = require('./autopilot');

// Par must leave a human this much slack over the careful autopilot.
const PAR_SLACK = 1.2;

const mods = loadModules();
let failures = 0;

for (const def of mods.LEVELS) {
  const r = solve(mods, def);
  const parTooTight = r.won && def.par < r.seconds * PAR_SLACK;
  const ok = r.won && r.maxPenetration < 0.5 && !parTooTight;
  if (!ok) {
    failures++;
  }
  let why = '';
  if (!r.won) {
    why = r.fell
      ? `  <- clipped pit at col ${Math.floor(r.fell.x / CELL)} row ${Math.floor(r.fell.y / CELL)}`
      : '  <- never reached the goal';
  } else if (parTooTight) {
    why = `  <- par ${def.par}s is under ${PAR_SLACK}x the autopilot's ${r.seconds.toFixed(1)}s`;
  }

  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${def.name.padEnd(14)} ` +
      `${String(r.rects).padStart(2)} rects  ` +
      `${r.seconds.toFixed(1).padStart(5)}s  par ${String(def.par).padStart(2)}s  ` +
      `overlap ${r.maxPenetration.toFixed(3)}  peak ${r.maxSpeed.toFixed(0)}px/s${why}`,
  );
}

mods.cleanup();

console.log(
  failures
    ? `\n${failures} level(s) failed`
    : `\nPhysics stable on all ${mods.LEVELS.length} levels`,
);
process.exit(failures ? 1 : 0);
