import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  SensorType,
  runOnJS,
  useAnimatedReaction,
  useAnimatedSensor,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { clampValue } from './physics';
import { FULL_TILT_FOR } from './settings';

// How far you drag (px) for a full tilt when there is no gyro.
const PAN_RANGE = 80;

/**
 * A live gravity sensor always reports a vector of magnitude ~9.81; the shared
 * value is exactly zero before the first sample and stays zero where there is
 * no sensor at all. We detect the sensor from its data rather than from
 * `useAnimatedSensor().isAvailable`, which is initialised to false and only
 * flipped by mutating a ref inside an effect - so it never re-renders and
 * reads false forever.
 */
const LIVE_THRESHOLD = 0.05;

export type Tilt = { x: number; y: number };
type Pose = { pitch: number; roll: number };

/**
 * Pitch and roll as angles, NOT as raw gravity components.
 *
 * `g.y / 9.81` is the sine of the tilt, which saturates near vertical: held at
 * a normal reading angle the phone already sits at ~0.87 of full scale, so
 * after calibration there is almost no travel left in that direction while the
 * other direction has plenty. Angles are linear, so the stick feels the same
 * however the device is held.
 *
 * Both use the out-of-screen axis as the reference rather than
 * `sqrt(x*x + z*z)`. That form is bounded to -90..90 and so folds back on
 * itself: tilt past upright and 95 degrees reads as 85, which reverses the
 * marble exactly when you are pushing hardest for more speed. Against -z the
 * angle runs monotonically through a full turn and never folds.
 */
const poseFrom = (x: number, y: number, z: number): Pose => {
  'worklet';
  return {
    pitch: Math.atan2(-y, -z),
    roll: Math.atan2(x, -z),
  };
};

/** Shortest signed distance between two angles, so a wrap never spikes. */
const angleDelta = (angle: number, from: number) => {
  'worklet';
  let delta = angle - from;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
};

export type TiltOptions = {
  /** Radians from the calibrated pose that count as full deflection. */
  fullTilt?: number;
  invertX?: boolean;
  invertY?: boolean;
  /** Off drops to drag input even on a device that has a gyroscope. */
  useSensor?: boolean;
};

export const useTilt = ({
  fullTilt = FULL_TILT_FOR.normal,
  invertX = false,
  invertY = false,
  useSensor = true,
}: TiltOptions = {}) => {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 16 });

  const manual = useSharedValue<Tilt>({ x: 0, y: 0 });
  const zero = useSharedValue<Pose>({ pitch: 0, roll: 0 });
  const [sensorLive, setSensorLive] = useState(false);

  const pose = useDerivedValue<Pose | null>(() => {
    if (!useSensor) {
      return null;
    }
    const { x, y, z } = gravity.sensor.value;
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) < LIVE_THRESHOLD) {
      return null;
    }
    return poseFrom(x, y, z);
  });

  useAnimatedReaction(
    () => pose.value !== null,
    (live, previous) => {
      if (live !== previous) {
        runOnJS(setSensorLive)(live);
      }
    },
  );

  const tilt = useDerivedValue<Tilt>(() => {
    const current = pose.value;
    if (current === null) {
      return manual.value;
    }
    const x = clampValue(
      angleDelta(current.roll, zero.value.roll) / fullTilt,
      -1,
      1,
    );
    const y = clampValue(
      angleDelta(current.pitch, zero.value.pitch) / fullTilt,
      -1,
      1,
    );

    return {
      x: invertX ? -x : x,
      y: invertY ? -y : y,
    };
  });

  /** Stores the current pose as level, so any holding angle plays the same. */
  const calibrate = useCallback(() => {
    zero.value = pose.value ?? { pitch: 0, roll: 0 };
  }, [pose, zero]);

  const gesture = Gesture.Pan()
    .enabled(!sensorLive)
    .onUpdate(event => {
      manual.value = {
        x: clampValue(event.translationX / PAN_RANGE, -1, 1),
        y: clampValue(event.translationY / PAN_RANGE, -1, 1),
      };
    })
    .onFinalize(() => {
      manual.value = withTiming({ x: 0, y: 0 }, { duration: 260 });
    });

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const keys: Record<string, Tilt> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const held = new Set<string>();

    const apply = () => {
      let x = 0;
      let y = 0;
      held.forEach(key => {
        x += keys[key].x;
        y += keys[key].y;
      });
      manual.value = { x: clampValue(x, -1, 1), y: clampValue(y, -1, 1) };
    };

    const onDown = (event: KeyboardEvent) => {
      if (!keys[event.key]) {
        return;
      }
      event.preventDefault();
      held.add(event.key);
      apply();
    };

    const onUp = (event: KeyboardEvent) => {
      if (!keys[event.key]) {
        return;
      }
      held.delete(event.key);
      apply();
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [manual]);

  return { tilt, gesture, calibrate, hasSensor: sensorLive };
};

/**
 * Low-passed tilt for anything that only needs to lean with the device.
 * The game screen smooths inside its own physics frame callback instead, so
 * it does not pay for two of them.
 */
export const useSmoothTilt = (tilt: { value: Tilt }) => {
  const smooth = useSharedValue<Tilt>({ x: 0, y: 0 });

  useFrameCallback(frame => {
    const dt = Math.min(frame.timeSincePreviousFrame ?? 16, 33) / 1000;
    const rate = Math.min(1, dt * 10);
    const target = tilt.value;
    smooth.value = {
      x: smooth.value.x + (target.x - smooth.value.x) * rate,
      y: smooth.value.y + (target.y - smooth.value.y) * rate,
    };
  });

  return smooth;
};
