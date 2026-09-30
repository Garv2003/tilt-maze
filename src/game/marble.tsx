import { Circle, DashPathEffect, Group } from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';
import { useDerivedValue } from 'react-native-reanimated';

import type { Vec } from './physics';
import { alpha, colors } from './theme';

type MarbleProps = {
  /** Scalars, not an object, so the physics loop allocates nothing per frame. */
  posX: SharedValue<number>;
  posY: SharedValue<number>;
  scale: SharedValue<number>;
  tilt: SharedValue<Vec>;
  radius: number;
  cell: number;
};

const REST = 0.12;
const TILT = 0.18;

/**
 * A footprint ring on the floor plus a disc raised above it, lifted the same
 * way the walls are so the marble sits in the same space as the blocks. The
 * lift is purely visual: collisions always use the true position.
 */
export const Marble = ({
  posX,
  posY,
  scale,
  tilt,
  radius,
  cell,
}: MarbleProps) => {
  const footprint = useDerivedValue(() => [
    { translateX: posX.value },
    { translateY: posY.value },
    { scale: scale.value },
  ]);

  const body = useDerivedValue(() => [
    { translateX: posX.value - tilt.value.x * cell * TILT },
    { translateY: posY.value - cell * REST - tilt.value.y * cell * TILT },
    { scale: scale.value },
  ]);

  return (
    <Group>
      <Group transform={footprint}>
        <Circle
          cx={0}
          cy={0}
          r={radius * 0.82}
          color={colors.marble}
          style="stroke"
          strokeWidth={1.25}
        />
      </Group>

      <Group transform={body}>
        {/* Black ring keeps the disc legible when it rests against a wall. */}
        <Circle cx={0} cy={0} r={radius} color={colors.marbleRing} />
        <Circle cx={0} cy={0} r={radius * 0.82} color={colors.marble} />
      </Group>
    </Group>
  );
};

type GhostProps = {
  posX: SharedValue<number>;
  posY: SharedValue<number>;
  radius: number;
};

/**
 * Your best run, replayed: a faint dashed ring on the floor. It never lifts
 * like the marble does, so the two cannot be mistaken for each other.
 */
export const Ghost = ({ posX, posY, radius }: GhostProps) => {
  const transform = useDerivedValue(() => [
    { translateX: posX.value },
    { translateY: posY.value },
  ]);

  return (
    <Group transform={transform} opacity={alpha.faint}>
      <Circle
        cx={0}
        cy={0}
        r={radius}
        color={colors.marble}
        style="stroke"
        strokeWidth={1.25}>
        <DashPathEffect intervals={[3, 3]} />
      </Circle>
    </Group>
  );
};
