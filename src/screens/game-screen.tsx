import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Group, vec } from '@shopify/react-native-skia';

import { Board } from '../game/board';
import { fallLabel, formatTime } from '../game/format';
import type { GhostPath } from '../game/ghost';
import {
  GHOST_SAMPLE_MS,
  RECORDING_CAP,
  ghostPositionAt,
  loadGhost,
} from '../game/ghost';
import {
  hapticFall,
  hapticGoal,
  hapticTap,
  hapticWallHit,
} from '../game/haptics';
import {
  INTERIOR_COLS,
  INTERIOR_ROWS,
  LEVELS,
  parseLevel,
  playArea,
} from '../game/levels';
import { Ghost, Marble } from '../game/marble';
import type { Vec } from '../game/physics';
import { distanceTo, stepMarble } from '../game/physics';
import type { Totals } from '../game/progress';
import { RunClock } from '../game/run-clock';
import type { Settings } from '../game/settings';
import { FULL_TILT_FOR } from '../game/settings';
import { playCue } from '../game/sound';
import { MAX_STARS, starString, starsFor } from '../game/stars';
import { alpha, colors, FRAME } from '../game/theme';
import { useTilt } from '../game/use-tilt';

const PAD = FRAME + 16;
const SCREEN_MARGIN = 16;
const CHROME = 300; // vertical space reserved for the HUD and footer
const SUBSTEPS = 4;
/** A wall knock changing the velocity by this many cells per second is felt. Softer contact is just rolling. */
const WALL_HIT_FELT = 4;
const MAX_BOARD_TILT = 0.11; // radians of 3D lean at full tilt
const DEATH_PAUSE = 480;
const COUNTDOWN_STEP = 650;

// Extrusion for the countdown numerals, matching the board's own.
const COUNT_REST = 7;
const COUNT_LIFT = 12;

type Phase = 'ready' | 'countdown' | 'playing' | 'dead' | 'paused' | 'won';

// Mirrors `phase` on the UI thread so the physics loop can gate itself.
const STATUS = { idle: 0, playing: 1, dead: 2, won: 3 } as const;

type GameScreenProps = {
  levelIndex: number;
  settings: Settings;
  bestMs: number | null;
  fewestFalls: number | null;
  /** Totals across every level, shown once the last one is cleared. */
  summary: Totals;
  onExit: () => void;
  onComplete: (
    levelId: string,
    ms: number,
    falls: number,
    stars: number,
    ghost: GhostPath,
  ) => void;
  onAdvance: () => void;
};

/**
 * Owns its own interval so the ticking clock re-renders one Text node instead
 * of the whole screen - which would otherwise reconcile the entire Skia tree
 * eleven times a second while you are playing. Stopped, it holds the clock's
 * frozen reading rather than dropping back to zero.
 */
const LiveTimer = memo(
  ({ clock, running }: { clock: RunClock; running: boolean }) => {
    const [ms, setMs] = useState(() => clock.elapsed());

    useEffect(() => {
      setMs(clock.elapsed());
      if (!running) {
        return;
      }
      const id = setInterval(() => setMs(clock.elapsed()), 90);
      return () => clearInterval(id);
    }, [clock, running]);

    return <Text style={styles.timer}>{formatTime(ms)}</Text>;
  },
);
LiveTimer.displayName = 'LiveTimer';

/**
 * The numeral as an extruded block: a recessed copy sitting on the "floor"
 * with a lit face floating above it, sliding as the device leans. Two Text
 * layers rather than Skia text, so it needs no font to be loaded.
 */
const CountdownNumeral = ({
  value,
  tilt,
}: {
  value: string;
  tilt: { value: Vec };
}) => {
  const face = useAnimatedStyle(() => ({
    transform: [
      { translateX: -tilt.value.x * COUNT_LIFT },
      { translateY: -COUNT_REST - tilt.value.y * COUNT_LIFT },
    ],
  }));

  return (
    <View style={styles.countBox}>
      <Text style={[styles.count, styles.countFootprint]}>{value}</Text>
      <Animated.Text style={[styles.count, styles.countFace, face]}>
        {value}
      </Animated.Text>
    </View>
  );
};

export const GameScreen = ({
  levelIndex,
  settings,
  bestMs,
  fewestFalls,
  summary,
  onExit,
  onComplete,
  onAdvance,
}: GameScreenProps) => {
  useKeepAwake();
  const reduceMotion = useReducedMotion();

  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { tilt, gesture, calibrate, hasSensor } = useTilt({
    fullTilt: FULL_TILT_FOR[settings.sensitivity],
    invertX: settings.invertX,
    invertY: settings.invertY,
    useSensor: settings.useSensor,
  });

  const cell = useMemo(
    () =>
      Math.max(
        16,
        Math.floor(
          Math.min(
            (width - SCREEN_MARGIN * 2 - PAD * 2) / INTERIOR_COLS,
            (height - CHROME) / INTERIOR_ROWS,
          ),
        ),
      ),
    [width, height],
  );

  const [phase, setPhase] = useState<Phase>('ready');
  const [falls, setFalls] = useState(0);
  const [finalMs, setFinalMs] = useState(0);
  const [finalStars, setFinalStars] = useState(0);
  const [count, setCount] = useState(3);
  const [clock] = useState(() => new RunClock());

  // Read by callbacks that fire outside React (AppState, the back button).
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // A resume counts down like a start, but continues the run instead of
  // beginning a fresh one.
  const countdownMode = useRef<'start' | 'resume'>('start');
  // Paused mid-fall: the marble still has to go back to the start.
  const respawnPending = useRef(false);

  const level = useMemo(
    () => parseLevel(LEVELS[levelIndex], cell),
    [levelIndex, cell],
  );

  const area = playArea(level);
  const radius = cell * 0.33;
  const canvasWidth = area.width + PAD * 2;
  const canvasHeight = area.height + PAD * 2;

  // Scalars rather than {x, y} objects: an object-valued shared value is frozen
  // and serialised on every assignment, which is the expensive part at 60fps.
  const posX = useSharedValue(level.start.x);
  const posY = useSharedValue(level.start.y);
  const velX = useSharedValue(0);
  const velY = useSharedValue(0);
  const scale = useSharedValue(1);
  const smoothTilt = useSharedValue<Vec>({ x: 0, y: 0 });
  const status = useSharedValue<number>(STATUS.idle);

  // Ghost replay. `runMs` is run time as the UI thread sees it: it advances
  // while playing or falling and freezes on pause, like the clock.
  const runMs = useSharedValue(0);
  const recording = useSharedValue<GhostPath>([]);
  const ghostPath = useSharedValue<GhostPath | null>(null);
  // Run time of the last wall-hit buzz, so grinding along a wall does not buzz every frame.
  const lastHit = useSharedValue(-1000);
  const ghostX = useSharedValue(level.start.x);
  const ghostY = useSharedValue(level.start.y);
  const [hasGhost, setHasGhost] = useState(false);

  useEffect(() => {
    let alive = true;
    ghostPath.value = null;
    setHasGhost(false);
    loadGhost(level.id).then(path => {
      if (alive && path) {
        ghostPath.value = path;
        setHasGhost(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [level.id, ghostPath]);

  const config = useMemo(
    () => ({
      radius,
      accel: cell * 26,
      damping: 1.7,
      restitution: 0.32,
      maxSpeed: cell * 22,
    }),
    [cell, radius],
  );

  const startRef = useRef(level.start);
  startRef.current = level.start;

  const placeMarble = useCallback(() => {
    posX.value = startRef.current.x;
    posY.value = startRef.current.y;
    velX.value = 0;
    velY.value = 0;
    scale.value = 1;
  }, [posX, posY, velX, velY, scale]);

  useEffect(() => {
    placeMarble();
    setPhase('ready');
    setFalls(0);
    clock.reset();
    respawnPending.current = false;
    runMs.value = 0;
    recording.value = [];
    status.value = STATUS.idle;
  }, [levelIndex, placeMarble, status, clock, runMs, recording]);

  // A rotation or resize changes the cell size under a live game, so carry the
  // marble across in board-relative terms instead of resetting it.
  const previousCell = useRef(cell);
  useEffect(() => {
    if (previousCell.current === cell) {
      return;
    }
    const ratio = cell / previousCell.current;
    previousCell.current = cell;
    posX.value *= ratio;
    posY.value *= ratio;
    velX.value *= ratio;
    velY.value *= ratio;
  }, [cell, posX, posY, velX, velY]);

  const respawnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(respawnTimer.current), []);

  const handleFall = useCallback(() => {
    hapticFall();
    playCue('fall');
    setFalls(f => f + 1);
    setPhase('dead');
    scale.value = withTiming(0, { duration: 260 });

    respawnTimer.current = setTimeout(() => {
      placeMarble();
      setPhase('playing');
      status.value = STATUS.playing;
    }, DEATH_PAUSE);
  }, [placeMarble, scale, status]);

  const handleWin = useCallback(
    (ghost: GhostPath) => {
      hapticGoal();
      playCue('win');
      clock.pause();
      const runTime = clock.elapsed();
      const stars = starsFor(runTime, falls, LEVELS[levelIndex].par);
      setFinalMs(runTime);
      setFinalStars(stars);
      setPhase('won');
      onComplete(level.id, runTime, falls, stars, ghost);
    },
    [clock, level.id, levelIndex, falls, onComplete],
  );

  useFrameCallback(frame => {
    const dt = Math.min(frame.timeSincePreviousFrame ?? 16, 33) / 1000;

    // Low-pass the input every frame, even while paused, so the board keeps
    // leaning with the device and never snaps when play resumes.
    const target = tilt.value;
    const smoothing = Math.min(1, dt * 12);
    smoothTilt.value = {
      x: smoothTilt.value.x + (target.x - smoothTilt.value.x) * smoothing,
      y: smoothTilt.value.y + (target.y - smoothTilt.value.y) * smoothing,
    };

    const running =
      status.value === STATUS.playing || status.value === STATUS.dead;

    if (running) {
      // Real frame time, not the capped physics dt, so the ghost keeps pace
      // with the wall clock the result is timed on.
      runMs.value += frame.timeSincePreviousFrame ?? 16;

      // One sample per GHOST_SAMPLE_MS of run time, so index * interval is
      // always the timestamp. A long stall repeats the last position.
      const due = Math.floor(runMs.value / GHOST_SAMPLE_MS) + 1;
      const recorded = recording.value.length;
      if (recorded < due * 2 && recorded < RECORDING_CAP) {
        const x = posX.value / cell;
        const y = posY.value / cell;
        recording.modify(samples => {
          'worklet';
          while (samples.length < due * 2 && samples.length < RECORDING_CAP) {
            samples.push(x, y);
          }
          return samples;
        });
      }
    }

    const path = ghostPath.value;
    if (path !== null) {
      const at = ghostPositionAt(path, runMs.value);
      ghostX.value = at.x * cell;
      ghostY.value = at.y * cell;
    }

    if (status.value !== STATUS.playing) {
      return;
    }

    const p = { x: posX.value, y: posY.value };
    const v = { x: velX.value, y: velY.value };
    const h = dt / SUBSTEPS;

    let impact = 0;
    for (let i = 0; i < SUBSTEPS; i++) {
      const hit = stepMarble(
        p,
        v,
        level.walls,
        smoothTilt.value.x,
        smoothTilt.value.y,
        h,
        config,
      );
      if (hit > impact) {
        impact = hit;
      }
    }
    // Only a real knock is felt: rolling along a wall changes velocity too little to count.
    if (impact > cell * WALL_HIT_FELT && runMs.value - lastHit.value > 160) {
      lastHit.value = runMs.value;
      runOnJS(hapticWallHit)();
    }

    posX.value = p.x;
    posY.value = p.y;
    velX.value = v.x;
    velY.value = v.y;

    for (let i = 0; i < level.holes.length; i++) {
      const hole = level.holes[i];
      if (distanceTo(p, hole.x, hole.y) < hole.r * 0.9) {
        status.value = STATUS.dead;
        runOnJS(handleFall)();
        return;
      }
    }

    if (distanceTo(p, level.goal.x, level.goal.y) < level.goal.r * 0.8) {
      status.value = STATUS.won;
      // End the ghost exactly on the goal.
      const samples = recording.value.slice();
      samples.push(p.x / cell, p.y / cell);
      runOnJS(handleWin)(samples);
    }
  });

  // Reduce Motion keeps the extrusion parallax (it is how depth reads) but
  // drops the whole-board lean.
  const boardTilt = reduceMotion ? 0 : MAX_BOARD_TILT;
  const boardTransform = useDerivedValue(() => [
    { perspective: 900 },
    { rotateY: -smoothTilt.value.x * boardTilt },
    { rotateX: smoothTilt.value.y * boardTilt },
  ]);

  const beginCountdown = useCallback(() => {
    hapticTap();
    placeMarble();
    countdownMode.current = 'start';
    setCount(3);
    setPhase('countdown');
  }, [placeMarble]);

  const pause = useCallback(() => {
    const { current } = phaseRef;
    if (current === 'countdown') {
      // Nothing is running yet; step back to where the countdown began.
      setPhase(countdownMode.current === 'resume' ? 'paused' : 'ready');
      return;
    }
    if (current !== 'playing' && current !== 'dead') {
      return;
    }
    status.value = STATUS.idle;
    clock.pause();
    if (current === 'dead') {
      clearTimeout(respawnTimer.current);
      respawnPending.current = true;
    }
    setPhase('paused');
  }, [clock, status]);

  const resume = useCallback(() => {
    hapticTap();
    if (respawnPending.current) {
      respawnPending.current = false;
      placeMarble();
    }
    // Carrying speed through a pause would launch the marble on "GO".
    velX.value = 0;
    velY.value = 0;
    countdownMode.current = 'resume';
    setCount(3);
    setPhase('countdown');
  }, [placeMarble, velX, velY]);

  const restart = useCallback(() => {
    respawnPending.current = false;
    clock.reset();
    // Rewind the ghost to the start line for the countdown.
    runMs.value = 0;
    setFalls(0);
    beginCountdown();
  }, [beginCountdown, clock, runMs]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        pause();
      }
    });
    return () => subscription.remove();
  }, [pause]);

  // Registered after the app-level handler, so Android asks this one first.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        const { current } = phaseRef;
        if (
          current === 'playing' ||
          current === 'dead' ||
          current === 'countdown'
        ) {
          pause();
        } else {
          onExit();
        }
        return true;
      },
    );
    return () => subscription.remove();
  }, [pause, onExit]);

  useEffect(() => {
    if (phase !== 'countdown') {
      return;
    }
    if (count === 0) {
      // Calibrate at the end of the countdown: whatever angle you have settled
      // into by now is the one that should count as level.
      calibrate();
      if (countdownMode.current === 'resume') {
        clock.resume();
      } else {
        clock.start();
        runMs.value = 0;
        recording.value = [];
      }
      setPhase('playing');
      status.value = STATUS.playing;
      return;
    }
    playCue('tap');
    const id = setTimeout(() => setCount(c => c - 1), COUNTDOWN_STEP);
    return () => clearTimeout(id);
  }, [phase, count, calibrate, status, clock, runMs, recording]);

  const isLast = levelIndex === LEVELS.length - 1;
  const { par } = LEVELS[levelIndex];
  const showSummary = isLast && summary.cleared === LEVELS.length;
  const beatBest = phase === 'won' && bestMs !== null && finalMs <= bestMs;

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.root}>
        <View style={[styles.hud, { paddingTop: insets.top + 18 }]}>
          <View style={styles.hudRow}>
            <Pressable
              onPress={onExit}
              hitSlop={16}
              accessibilityRole="button"
              accessibilityLabel="Back to levels">
              <Text style={styles.back}>‹ LEVELS</Text>
            </Pressable>
            <Text style={styles.label}>{fallLabel(falls).toUpperCase()}</Text>
          </View>

          <View style={styles.hudRow}>
            <Text style={styles.levelName}>{level.name}</Text>
            {phase === 'playing' ||
            phase === 'dead' ||
            phase === 'paused' ||
            (phase === 'countdown' && countdownMode.current === 'resume') ? (
              // Through a resume countdown the clock is frozen, not reset: keep showing where the run stands.
              <LiveTimer
                clock={clock}
                running={phase === 'playing' || phase === 'dead'}
              />
            ) : (
              <Text style={styles.timer}>
                {formatTime(phase === 'won' ? finalMs : 0)}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.boardArea}>
          <Canvas style={{ width: canvasWidth, height: canvasHeight }}>
            <Group
              origin={vec(canvasWidth / 2, canvasHeight / 2)}
              transform={boardTransform}>
              {/* Centre the play area, not the wider collision grid. */}
              <Group
                transform={[
                  { translateX: PAD - area.x },
                  { translateY: PAD - area.y },
                ]}>
                <Board level={level} tilt={smoothTilt} />
                {settings.ghost && hasGhost ? (
                  <Ghost posX={ghostX} posY={ghostY} radius={radius} />
                ) : null}
                <Marble
                  posX={posX}
                  posY={posY}
                  scale={scale}
                  tilt={smoothTilt}
                  radius={radius}
                  cell={cell}
                />
              </Group>
            </Group>
          </Canvas>

          {phase === 'countdown' ? (
            <View style={styles.countOverlay} pointerEvents="none">
              <CountdownNumeral
                value={count === 0 ? 'GO' : String(count)}
                tilt={smoothTilt}
              />
              <Text style={styles.countHint}>HOLD IT STEADY</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 22 }]}>
          <Text style={styles.hint}>
            {hasSensor ? 'TILT TO ROLL' : 'DRAG ANYWHERE TO ROLL'}
          </Text>
          {phase === 'playing' ? (
            <View style={styles.controls}>
              <Pressable
                onPress={pause}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel="Pause">
                <Text style={styles.recalibrate}>PAUSE</Text>
              </Pressable>
              {hasSensor ? (
                <Pressable
                  onPress={calibrate}
                  hitSlop={14}
                  accessibilityRole="button"
                  accessibilityLabel="Recalibrate"
                  accessibilityHint="Treats the current angle as level">
                  <Text style={styles.recalibrate}>RECALIBRATE</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Sheets sit over a partly visible board, so the maze stays readable
            behind them instead of being hidden by a full blackout. */}
        {phase === 'ready' ? (
          <View style={styles.scrim}>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 26 }]}>
              <Text style={styles.sheetEyebrow}>
                LEVEL {levelIndex + 1} OF {LEVELS.length}
              </Text>
              <Text style={styles.sheetTitle}>{level.name}</Text>
              <Text style={styles.sheetBody}>
                Reach the ring. Avoid the pits. Par is {par}s: beat it without
                falling for {MAX_STARS} stars.
                {bestMs !== null ? `  Best ${formatTime(bestMs)}` : ''}
                {fewestFalls !== null
                  ? `, fewest ${fallLabel(fewestFalls)}`
                  : ''}
                {bestMs !== null ? '.' : ''}
              </Text>

              <Pressable
                style={({ pressed }) => [
                  styles.primary,
                  pressed && styles.pressed,
                ]}
                onPress={beginCountdown}
                accessibilityRole="button">
                <Text style={styles.primaryLabel}>START</Text>
              </Pressable>
              <Pressable
                onPress={onExit}
                hitSlop={12}
                style={styles.tertiary}
                accessibilityRole="button">
                <Text style={styles.tertiaryLabel}>BACK TO LEVELS</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {phase === 'paused' ? (
          <View style={styles.scrim}>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 26 }]}>
              <Text style={styles.sheetEyebrow}>PAUSED</Text>
              <Text style={styles.sheetTitle}>{level.name}</Text>
              <Text style={styles.sheetBody}>
                {fallLabel(falls)} so far. The clock is stopped.
              </Text>

              <Pressable
                style={({ pressed }) => [
                  styles.primary,
                  pressed && styles.pressed,
                ]}
                onPress={resume}
                accessibilityRole="button">
                <Text style={styles.primaryLabel}>RESUME</Text>
              </Pressable>
              <Pressable
                onPress={restart}
                hitSlop={12}
                style={styles.tertiary}
                accessibilityRole="button">
                <Text style={styles.tertiaryLabel}>RESTART</Text>
              </Pressable>
              <Pressable
                onPress={onExit}
                hitSlop={12}
                style={styles.tertiary}
                accessibilityRole="button">
                <Text style={styles.tertiaryLabel}>BACK TO LEVELS</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {phase === 'won' ? (
          <View style={styles.scrim}>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 26 }]}>
              <Text style={styles.sheetEyebrow}>
                {beatBest ? 'NEW BEST' : 'CLEARED'}
              </Text>
              <Text
                style={styles.stars}
                accessibilityLabel={`${finalStars} of ${MAX_STARS} stars`}>
                {starString(finalStars)}
              </Text>
              <Text style={styles.sheetTime}>{formatTime(finalMs)}</Text>
              <Text style={styles.sheetBody}>
                {fallLabel(falls)}
                {`  ·  par ${par}s`}
                {bestMs !== null && !beatBest
                  ? `  ·  best ${formatTime(bestMs)}`
                  : ''}
              </Text>

              {showSummary ? (
                <View style={styles.summary}>
                  <Text style={styles.sheetEyebrow}>
                    ALL {LEVELS.length} CLEARED
                  </Text>
                  <Text style={styles.sheetBody}>
                    {`Best times add up to ${formatTime(summary.bestMs)}.  `}
                    {`${summary.stars} of ${LEVELS.length * MAX_STARS} stars, `}
                    {`${fallLabel(summary.falls)} at your cleanest.`}
                  </Text>
                </View>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.primary,
                  pressed && styles.pressed,
                ]}
                onPress={isLast ? onExit : onAdvance}
                accessibilityRole="button">
                <Text style={styles.primaryLabel}>
                  {isLast ? 'BACK TO LEVELS' : 'NEXT LEVEL'}
                </Text>
              </Pressable>
              {isLast ? null : (
                <Pressable
                  onPress={onExit}
                  hitSlop={12}
                  style={styles.tertiary}
                  accessibilityRole="button">
                  <Text style={styles.tertiaryLabel}>BACK TO LEVELS</Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
  },

  hud: {
    paddingHorizontal: 28,
    gap: 16,
  },
  hudRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  back: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.4,
  },
  label: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 10,
    letterSpacing: 2.6,
    fontWeight: '700',
  },
  levelName: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '300',
    letterSpacing: 0.3,
  },
  timer: {
    color: colors.white,
    fontSize: 26,
    fontWeight: '200',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },

  boardArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  countOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    fontSize: 96,
    fontWeight: '100',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  countFootprint: {
    color: colors.white,
    opacity: alpha.hairline,
  },
  countFace: {
    position: 'absolute',
    color: colors.white,
  },
  countHint: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.6,
    marginTop: 18,
  },

  footer: {
    alignItems: 'center',
    gap: 14,
  },
  controls: {
    flexDirection: 'row',
    gap: 32,
  },
  hint: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 10,
    letterSpacing: 2.4,
    fontWeight: '700',
  },
  recalibrate: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 10,
    letterSpacing: 2.4,
    fontWeight: '700',
  },

  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: colors.black,
    borderTopWidth: 1,
    borderTopColor: colors.white,
    paddingHorizontal: 28,
    paddingTop: 26,
    gap: 12,
  },
  sheetEyebrow: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 3,
  },
  sheetTitle: {
    color: colors.white,
    fontSize: 32,
    fontWeight: '200',
    letterSpacing: 0.4,
  },
  stars: {
    color: colors.white,
    fontSize: 22,
    letterSpacing: 6,
  },
  summary: {
    marginTop: 6,
    paddingTop: 14,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.white,
  },
  sheetTime: {
    color: colors.white,
    fontSize: 46,
    fontWeight: '100',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  sheetBody: {
    color: colors.white,
    opacity: alpha.dim,
    fontSize: 13,
    lineHeight: 19,
  },
  primary: {
    marginTop: 14,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  pressed: {
    opacity: 0.7,
  },
  primaryLabel: {
    color: colors.black,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.4,
  },
  tertiary: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  tertiaryLabel: {
    color: colors.white,
    opacity: alpha.faint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.2,
  },
});
