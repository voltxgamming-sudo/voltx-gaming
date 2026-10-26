// In-memory fixed-window limiter. Fine for a single process; use a shared store if you scale out.
export class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  hit(key, max, windowMs) {
    const t = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.reset <= t) {
      b = { count: 0, reset: t + windowMs };
      this.buckets.set(key, b);
    }
    b.count += 1;
    if (this.buckets.size > 10000) {
      for (const [k, v] of this.buckets) if (v.reset <= t) this.buckets.delete(k);
    }
    return b.count <= max;
  }
}
