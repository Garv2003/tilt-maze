/**
 * Wall-clock run timer that can be paused. Time spent backgrounded or on the
 * pause sheet must not count against a best time, so a bare `startedAt` is
 * not enough.
 */
export class RunClock {
  private banked = 0;
  private resumedAt: number | null = null;

  get running() {
    return this.resumedAt !== null;
  }

  start() {
    this.banked = 0;
    this.resumedAt = Date.now();
  }

  pause() {
    if (this.resumedAt !== null) {
      this.banked += Date.now() - this.resumedAt;
      this.resumedAt = null;
    }
  }

  resume() {
    if (this.resumedAt === null) {
      this.resumedAt = Date.now();
    }
  }

  reset() {
    this.banked = 0;
    this.resumedAt = null;
  }

  elapsed() {
    return (
      this.banked + (this.resumedAt === null ? 0 : Date.now() - this.resumedAt)
    );
  }
}
