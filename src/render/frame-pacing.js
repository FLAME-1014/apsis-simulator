const counts = 300;

export class FramePacing {
  constructor(onResize) {
    this.resize = onResize;
    this.frames = new Float64Array(counts);
    this.cpu = new Float64Array(counts);
    this.quality = 'auto';
    this.factor = 1;
    this.sinceChange = 0;
    this.clear();
  }

  clear() {
    this.count = 0;
    this.index = 0;
    this.sinceChange = 0;
  }

  get ratio() {
    return Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.5) * this.factor;
  }

  setQuality(value) {
    this.quality = value;
    this.factor = value === 'low' ? 0.7 : 1;
    this.clear();
    this.resize();
  }

  sample(frameMs, cpuMs) {
    if (!(frameMs > 0 && frameMs < 500)) return;
    this.frames[this.index] = frameMs;
    this.cpu[this.index] = cpuMs;
    this.index = (this.index + 1) % counts;
    this.count = Math.min(counts, this.count + 1);
    this.sinceChange++;
    if (this.quality !== 'auto' || this.sinceChange < 150 || this.sinceChange % 90 !== 60) return;
    const details = this.stats();
    if (details.meanMs > 19.35 && this.factor > 0.58) {
      this.factor = Math.max(0.58, this.factor * 0.83);
      this.clear();
      this.resize();
    }
  }

  stats() {
    const times = this.frames.slice(0, this.count).sort();
    const cpus = this.cpu.slice(0, this.count).sort();
    const ms = times.reduce((sum, value) => sum + value, 0) / (times.length || 1);
    const percentile = (data, fraction) => data[Math.max(0, Math.ceil(data.length * fraction) - 1)] ?? 0;
    return {
      samples: this.count, meanMs: ms, fps: ms ? 1000 / ms : 0,
      p95Ms: percentile(times, 0.95), medianMs: percentile(times, 0.5), cpuP95Ms: percentile(cpus, 0.95), ratio: this.ratio,
    };
  }
}
