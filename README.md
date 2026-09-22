# Tilt Maze

A gravity-driven marble game for Android and iOS. Lean the device and the
marble rolls; reach the ring without dropping into a pit. Sixteen levels, a
progression map, and everything stored on the device.

Built with Expo, React Native Skia for rendering, and Reanimated worklets for
physics that run on the UI thread rather than the JS thread.

```
┌─────────────────────────────┐        ┌─────────────────────────────┐
│ TILT MAZE        SETTINGS   │        │ ‹ LEVELS          2 FALLS   │
│ 7 OF 16 CLEARED             │        │ Spiral              0:12.4  │
│ ████████░░░░░░░░            │        │                             │
│                             │        │   ╔═════════════════════╗   │
│  ┌────┐   NEXT UP           │        │   ║ ▄▄▄▄▄▄▄▄     ▄▄▄▄   ║   │
│  │▒▒▒▒│   Spiral            │        │   ║           ●         ║   │
│  └────┘   LEVEL 8 OF 16     │        │   ║  ○     ▄▄▄▄▄▄▄   ○  ║   │
│   ▲ leans   [ PLAY ]        │        │   ║ ▄▄▄▄▄            ▄▄ ║   │
│   with the device           │        │   ║              ◎      ║   │
└─────────────────────────────┘        │   ╚═════════════════════╝   │
                                       │          TILT TO ROLL       │
                                       └─────────────────────────────┘
```

## Running it

```bash
yarn install
yarn android      # or: yarn ios
```

Runs in Expo Go — no development build needed. Every native module used
(Skia, Reanimated, gesture-handler, haptics, audio, async-storage,
safe-area-context, keep-awake) ships inside Expo Go for SDK 57.

On web (`yarn web`) the motion sensors return nothing, so input falls back to
dragging or the arrow keys.

## How it is put together

```
src/
  game/
    levels.json      16 levels as ASCII grids
    levels.ts        loads + validates the JSON, merges walls into rects
    physics.ts       circle-vs-AABB collision, substepped integrator (worklets)
    use-tilt.ts      gravity sensor -> pan gesture -> arrow keys, + calibration
    board.tsx        extruded walls, pits, goal, frame  (Skia)
    marble.tsx       the marble                          (Skia)
    progress.ts      completed levels and best times     (AsyncStorage)
    settings.ts      sound, haptics, sensitivity, invert (AsyncStorage)
    sound.ts         three generated cues
    haptics.ts       impact feedback, honouring settings
    theme.ts         the entire palette: black and white
  screens/
    map-screen.tsx       progression map with a tilt-reactive level preview
    game-screen.tsx      play, countdown, result sheets
    settings-screen.tsx  toggles, sensitivity, reset progress
scripts/
  verify-levels.js     solvability and shape checks
  simulate-physics.js  headless autopilot over every level
  make-icons.js        regenerates the app icons from code
```

### Input

Tilt is normalised to a `-1..1` vector, and everything downstream — physics
acceleration, the board's 3D lean, the extrusion parallax — derives from that
one value. This is why the drag and keyboard fallbacks work with no extra code.

Two details matter more than they look:

**Angles, not gravity components.** `g.y / 9.81` is the *sine* of the tilt,
which saturates near vertical: held at a normal reading angle the phone is
already at ~0.87 of full scale, leaving almost no travel in one direction.
Using `atan2` gives a linear response that feels the same at any holding angle.

**`atan2(-y, -z)`, not `atan2(-y, hypot(x, z))`.** The second form is bounded
to ±90° and folds back on itself, so tilting past upright reads 95° as 85° —
the marble slows and reverses exactly when you lean harder for more speed.

**Calibration.** The countdown ends by storing your current pose as level, so
the game plays identically whether the phone is flat on a table or held at a
reading angle. There is a `RECALIBRATE` control during play, and Settings has
invert toggles for either axis.

One platform note: Reanimated negates `TYPE_GRAVITY` on Android, so flat
face-up arrives as `(0, 0, -9.81)` rather than Android's native `+9.81`.

### Physics

Runs entirely in a Reanimated worklet on the UI thread, so it keeps its frame
rate while JavaScript is busy. Four substeps per frame plus a speed cap stop
the marble tunnelling through a wall on a dropped frame. Wall cells are merged
into as few rectangles as possible — 7 to 19 instead of ~80 — which both cuts
collision checks and removes the internal seams a marble would otherwise snag
on.

Shared values are scalars (`posX`, `posY`, `velX`, `velY`) rather than
`{x, y}` objects: an object-valued shared value is frozen and serialised on
every assignment, which is the real cost at 60fps. The clock is likewise
isolated in its own component, so the ticking timer re-renders one text node
instead of reconciling the whole Skia tree eleven times a second.

### Rendering

Strictly two colours. Depth comes from parallax rather than shading: every
wall draws a footprint outline on the floor and a filled top face offset above
it, with all the top faces sharing a single animated transform. Pits offset the
other way, so holes sink while walls rise. The map and the countdown numerals
use the same trick, so every screen reads as one object.

## Levels

A level is 11×14 characters:

```
#  wall        .  floor
S  start       G  goal        O  pit
```

The outer ring is collision-only — the drawn frame *is* that wall, so the
boundary you see and the boundary you hit are the same thing.

To add one, append it to `src/game/levels.json` and run `yarn verify`.

## Verifying changes

```bash
yarn verify          # types, lint, level checks, physics simulation
yarn icons           # regenerate the app icons after changing the mark
```

Two checks are specific to this game, and level edits must pass both.

**`yarn verify:levels`** walks every level with BFS from start to goal across
cells that are neither wall nor pit, and checks for exactly one start and goal,
a solid border, correct dimensions, and no unreachable pits. A pit that seals a
one-cell corridor makes a level impossible, and that is easy to do by accident.

**`yarn verify:physics`** compiles the real `physics.ts` and drives every level
to its goal along that route, asserting zero wall penetration — no tunnelling
and no sticking. It also catches levels that are solvable on paper but demand
more precision than the difficulty curve should, because the autopilot clips a
pit while turning.

Both print one line per level, and a level that fails names the cell it failed
at:

```
ok    Warm Up       8 rects    3.4s  overlap 0.000  peak 222px/s
FAIL  Detour       15 rects    5.0s  overlap 0.000  <- clipped pit at col 3 row 5
```

## Known limits

- The sensor path is Android-verified. iOS uses the same Reanimated API, but
  the gravity sign convention differs by platform; if iOS rolls the wrong way,
  the invert toggles in Settings cover it without a rebuild.
- Portrait only. The tilt maths reduces to pitch and roll from a single
  gravity vector, which has no unique solution once the device is on its side.
- Progress and settings live only on this device. There is no account, no
  network call, and nothing leaves the phone.
