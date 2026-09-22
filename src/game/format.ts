/** `m:ss.t` - shared by the HUD, the results card and the level map. */
export const formatTime = (ms: number) => {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
};

export const fallLabel = (count: number) =>
  `${count} ${count === 1 ? 'fall' : 'falls'}`;
