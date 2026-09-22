import type { Rect } from './levels';

export type Vec = { x: number; y: number };

export const clampValue = (value: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(Math.max(value, lo), hi);
};

/**
 * Resolves a circle against an axis-aligned rect: pushes the circle out along
 * the shortest exit and reflects the inbound velocity component.
 * Mutates `p` and `v`. Returns true when a hit was resolved.
 */
export const collideRect = (
  p: Vec,
  v: Vec,
  radius: number,
  rect: Rect,
  restitution: number,
) => {
  'worklet';
  const nearestX = clampValue(p.x, rect.x, rect.x + rect.w);
  const nearestY = clampValue(p.y, rect.y, rect.y + rect.h);

  const dx = p.x - nearestX;
  const dy = p.y - nearestY;
  const distSq = dx * dx + dy * dy;

  if (distSq >= radius * radius) {
    return false;
  }

  let nx: number;
  let ny: number;
  let penetration: number;

  if (distSq > 1e-9) {
    const dist = Math.sqrt(distSq);
    nx = dx / dist;
    ny = dy / dist;
    penetration = radius - dist;
  } else {
    // Centre is inside the rect (only reachable after a huge step) - eject
    // along whichever face is closest.
    const left = p.x - rect.x;
    const right = rect.x + rect.w - p.x;
    const top = p.y - rect.y;
    const bottom = rect.y + rect.h - p.y;
    const smallest = Math.min(left, right, top, bottom);

    if (smallest === left) {
      nx = -1;
      ny = 0;
      penetration = left + radius;
    } else if (smallest === right) {
      nx = 1;
      ny = 0;
      penetration = right + radius;
    } else if (smallest === top) {
      nx = 0;
      ny = -1;
      penetration = top + radius;
    } else {
      nx = 0;
      ny = 1;
      penetration = bottom + radius;
    }
  }

  p.x += nx * penetration;
  p.y += ny * penetration;

  const normalSpeed = v.x * nx + v.y * ny;
  if (normalSpeed < 0) {
    v.x -= (1 + restitution) * normalSpeed * nx;
    v.y -= (1 + restitution) * normalSpeed * ny;
  }

  return true;
};

export type StepConfig = {
  radius: number;
  accel: number;
  damping: number;
  restitution: number;
  maxSpeed: number;
};

/**
 * One physics substep: integrate, then resolve every wall. Substeps keep the
 * marble from tunnelling through a wall on a slow frame.
 */
export const stepMarble = (
  p: Vec,
  v: Vec,
  walls: Rect[],
  tiltX: number,
  tiltY: number,
  dt: number,
  config: StepConfig,
) => {
  'worklet';
  v.x += tiltX * config.accel * dt;
  v.y += tiltY * config.accel * dt;

  const damp = Math.max(0, 1 - config.damping * dt);
  v.x *= damp;
  v.y *= damp;

  const speed = Math.sqrt(v.x * v.x + v.y * v.y);
  if (speed > config.maxSpeed) {
    v.x = (v.x / speed) * config.maxSpeed;
    v.y = (v.y / speed) * config.maxSpeed;
  }

  p.x += v.x * dt;
  p.y += v.y * dt;

  for (let i = 0; i < walls.length; i++) {
    collideRect(p, v, config.radius, walls[i], config.restitution);
  }
};

export const distanceTo = (p: Vec, x: number, y: number) => {
  'worklet';
  const dx = p.x - x;
  const dy = p.y - y;
  return Math.sqrt(dx * dx + dy * dy);
};
