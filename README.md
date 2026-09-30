# Tilt Maze

A gravity-driven marble game for Android and iOS. Lean the device and the
marble rolls; reach the ring without dropping into a pit. Sixteen levels with
star ratings, a ghost of your best run to race, a progression map, and
everything stored on the device.

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
    progress.ts      completed levels, best times, stars (AsyncStorage)
    settings.ts      sound, haptics, ghost, sensitivity  (AsyncStorage)
    ghost.ts         best-run paths and their playback   (AsyncStorage)
    stars.ts         par-based 1-3 star rating
    run-clock.ts     pausable run timer
    sound.ts         three generated cues
    haptics.ts       impact feedback, honouring settings
    theme.ts         the entire palette: black and white
  screens/
    map-screen.tsx       progression map with a tilt-reactive level preview
    game-screen.tsx      play, countdown, pause, result sheets
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

### Pausing

The run clock stops whenever play does: the PAUSE control, the app leaving the
foreground, or the Android back button mid-run. Resuming replays the countdown
and recalibrates, because the phone is rarely held the same way afterwards.
Elsewhere, back steps out to the map, and only on the map does it close the
app.

### Physics

Runs entirely in a Reanimated worklet on the UI thread, so it keeps its frame
rate while JavaScript is busy. Four substeps per frame plus a speed cap stop
the marble tunnelling through a wall on a dropped frame. Wall cells are merged
into as few rectangles as possible — 7 to 19 instead of ~80 — which both cuts
collision checks and removes the internal seams a marble would otherwise snag
on.

The same frame callback records the ghost: one position every 50 ms of run
time, in cell units so a ghost recorded on one screen replays on any other. A
run that beats the level's best time saves its path, one AsyncStorage key per
level so the progress record stays small, and the next attempt replays it as a
faint dashed ring.

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

Each level also has a `par` in seconds. A clean run inside par earns three
stars, anything within 1.5× par two, and finishing one. Par starts at about
1.8× the physics autopilot's time; tune it by playing.

The outer ring is collision-only — the drawn frame *is* that wall, so the
boundary you see and the boundary you hit are the same thing.

To add one, append it to `src/game/levels.json` and run `yarn verify`.

## Verifying changes

```bash
yarn verify          # types, lint, level checks, physics simulation
yarn icons           # regenerate the app icons after changing the mark
```

Two checks are specific to this game, and level edits must pass both.

CI runs `yarn verify` on every push and pull request to `main`
(`.github/workflows/verify.yml`).

**`yarn verify:levels`** walks every level with BFS from start to goal across
cells that are neither wall nor pit, and checks for exactly one start and goal,
a solid border, correct dimensions, and no unreachable pits. A pit that seals a
one-cell corridor makes a level impossible, and that is easy to do by accident.

**`yarn verify:physics`** compiles the real `physics.ts` and drives every level
to its goal along that route, asserting zero wall penetration — no tunnelling
and no sticking. It also catches levels that are solvable on paper but demand
more precision than the difficulty curve should, because the autopilot clips a
pit while turning. It also fails a `par` tighter than 1.2× the autopilot's
time, since par must stay reachable.

Both print one line per level, and a level that fails names the cell it failed
at:

```
ok    Warm Up       8 rects    3.4s  par  7s  overlap 0.000  peak 222px/s
FAIL  Detour       15 rects    5.0s  par 16s  overlap 0.000  <- clipped pit at col 3 row 5
```

## Known limits

- The sensor path is Android-verified. iOS uses the same Reanimated API, but
  the gravity sign convention differs by platform; if iOS rolls the wrong way,
  the invert toggles in Settings cover it without a rebuild.
- Portrait only. The tilt maths reduces to pitch and roll from a single
  gravity vector, which has no unique solution once the device is on its side.
- Progress, ghosts and settings live only on this device. There is no account, no
  network call, and nothing leaves the phone.
