/** Fixed-duration steps with a bounded work budget. No wall-clock catch-up after a hidden tab. */
export class FixedClock {
  constructor(dt, maxSteps) {
    this.dt = dt;
    this.maxSteps = maxSteps;
    this.remainder = 0;
    this.limited = false;
  }

  advance(seconds, step) {
    this.remainder += Math.max(0, seconds);
    const due = Math.floor((this.remainder + 1e-12) / this.dt);
    const count = Math.min(due, this.maxSteps);
    this.limited = due > count;
    this.remainder = Math.max(0, this.remainder - count * this.dt);
    for (let i = 0; i < count; i++) {
      if (step(this.dt) === false) {
        this.remainder = 0;
        return i + 1;
      }
    }
    return count;
  }
}
