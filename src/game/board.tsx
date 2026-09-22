import { Circle, Group, RoundedRect } from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { memo, useEffect } from 'react';

import type { ParsedLevel, Rect } from './levels';
import { playArea } from './levels';
import type { Vec } from './physics';
import { colors, FRAME } from './theme';

type BoardProps = {
  level: ParsedLevel;
  tilt: SharedValue<Vec>;
};

/**
 * Block height as a fraction of a cell. REST keeps everything standing up even
 * when the board is level; TILT is how far the top faces slide as you lean,
 * which is what actually reads as depth in a two-colour scene.
 */
const REST = 0.2;
const TILT = 0.28;

const HAIRLINE = 1.25;

/** Wall rects clipped to the play area; the frame draws the border ring. */
const visibleWalls = (level: ParsedLevel): Rect[] => {
  const area = playArea(level);

  return level.walls
    .map(wall => {
      const x = Math.max(wall.x, area.x);
      const y = Math.max(wall.y, area.y);
      return {
        x,
        y,
        w: Math.min(wall.x + wall.w, area.x + area.width) - x,
        h: Math.min(wall.y + wall.h, area.y + area.height) - y,
      };
    })
    .filter(wall => wall.w > 0.5 && wall.h > 0.5);
};

/** Where each block meets the floor: the base of the extrusion. */
const Footprints = memo(({ level }: { level: ParsedLevel }) => (
  <Group>
    {visibleWalls(level).map((wall, i) => (
      <RoundedRect
        key={i}
        x={wall.x}
        y={wall.y}
        width={wall.w}
        height={wall.h}
        r={level.cell * 0.12}
        color={colors.wall}
        style="stroke"
        strokeWidth={HAIRLINE}
      />
    ))}
  </Group>
));
Footprints.displayName = 'Footprints';

/** The lit top of each block, offset from its footprint by the lift. */
const TopFaces = memo(({ level }: { level: ParsedLevel }) => (
  <Group>
    {visibleWalls(level).map((wall, i) => (
      <RoundedRect
        key={i}
        x={wall.x}
        y={wall.y}
        width={wall.w}
        height={wall.h}
        r={level.cell * 0.12}
        color={colors.wall}
      />
    ))}
  </Group>
));
TopFaces.displayName = 'TopFaces';

const Holes = memo(({ level }: { level: ParsedLevel }) => (
  <Group>
    {level.holes.map((hole, i) => (
      <Group key={i}>
        <Circle cx={hole.x} cy={hole.y} r={hole.r} color={colors.hole} />
        <Circle
          cx={hole.x}
          cy={hole.y}
          r={hole.r}
          color={colors.holeRing}
          style="stroke"
          strokeWidth={Math.max(1.2, hole.r * 0.16)}
        />
      </Group>
    ))}
  </Group>
));
Holes.displayName = 'Holes';

const Goal = memo(({ level }: { level: ParsedLevel }) => {
  const { goal } = level;
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const coreRadius = useDerivedValue(() => goal.r * (0.3 + pulse.value * 0.22));

  return (
    <Group>
      <Circle
        cx={goal.x}
        cy={goal.y}
        r={goal.r}
        color={colors.goal}
        style="stroke"
        strokeWidth={Math.max(1.4, goal.r * 0.15)}
      />
      <Circle cx={goal.x} cy={goal.y} r={coreRadius} color={colors.goal} />
    </Group>
  );
});
Goal.displayName = 'Goal';

export const Board = memo(({ level, tilt }: BoardProps) => {
  const { cell } = level;
  const area = playArea(level);

  // One transform for every raised face, rather than one per wall.
  const lift = useDerivedValue(() => [
    { translateX: -tilt.value.x * cell * TILT },
    { translateY: -cell * REST - tilt.value.y * cell * TILT },
  ]);

  // Pits move the other way and less far: they are recessed, not raised.
  const sink = useDerivedValue(() => [
    { translateX: tilt.value.x * cell * TILT * 0.4 },
    { translateY: cell * REST * 0.4 + tilt.value.y * cell * TILT * 0.4 },
  ]);

  return (
    <Group>
      {/* Where the frame meets the floor. */}
      <RoundedRect
        x={area.x - FRAME}
        y={area.y - FRAME}
        width={area.width + FRAME * 2}
        height={area.height + FRAME * 2}
        r={cell * 0.55}
        color={colors.wall}
        style="stroke"
        strokeWidth={HAIRLINE}
      />

      {/* Black floor, so pits and the goal read against it. */}
      <RoundedRect
        x={area.x}
        y={area.y}
        width={area.width}
        height={area.height}
        r={cell * 0.3}
        color={colors.floor}
      />

      <Group transform={sink}>
        <Holes level={level} />
      </Group>

      <Goal level={level} />
      <Footprints level={level} />

      <Group transform={lift}>
        {/* Stroked, not filled, so the raised frame never covers the floor. */}
        <RoundedRect
          x={area.x - FRAME / 2}
          y={area.y - FRAME / 2}
          width={area.width + FRAME}
          height={area.height + FRAME}
          r={cell * 0.45}
          color={colors.wall}
          style="stroke"
          strokeWidth={FRAME}
        />
        <TopFaces level={level} />
      </Group>
    </Group>
  );
});
Board.displayName = 'Board';
