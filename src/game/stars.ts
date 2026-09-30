export const MAX_STARS = 3;

/**
 * Three stars is a clean run inside par; two is a run within half as long
 * again, falls allowed; one is simply finishing. Par comes from levels.json
 * and is checked against the physics autopilot so it is always reachable.
 */
export const starsFor = (ms: number, falls: number, parSeconds: number) => {
  const par = parSeconds * 1000;
  if (ms <= par && falls === 0) {
    return 3;
  }
  if (ms <= par * 1.5) {
    return 2;
  }
  return 1;
};

/** `★★☆` - text, not an icon, so it needs no asset and stays monochrome. */
export const starString = (stars: number) =>
  '★'.repeat(stars) + '☆'.repeat(MAX_STARS - stars);
