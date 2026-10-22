'use strict';

// Windows helper: PID, private commit KiB, cumulative CPU seconds, creation ticks,
// and a system-wide monotonic timestamp. Creation ticks stay strings (64-bit).
function parseProcessSamples(text) {
  const samples = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?|-)\s+(\d+|-)\s+(\d+(?:\.\d+)?)$/);
    if (!m) continue;
    const pid = Number(m[1]), memoryKB = Number(m[2]), sampledAt = Number(m[5]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(memoryKB) || !Number.isFinite(sampledAt)) continue;
    samples.set(pid, {pid, memoryKB, cpuSeconds: m[3] === '-' ? NaN : Number(m[3]), creationTime: m[4], sampledAt});
  }
  return samples;
}

class CpuTracker {
  constructor() { this.previous = new Map(); }
  update(samples, logicalCores) {
    const next = new Map(), cpu = new Map(), ready = new Set();
    const cores = Math.max(1, Number(logicalCores) || 1);
    for (const sample of samples) {
      const {pid, cpuSeconds, sampledAt, creationTime} = sample;
      if (!Number.isFinite(cpuSeconds) || cpuSeconds < 0 || !Number.isFinite(sampledAt) || creationTime == null || creationTime === '-') continue;
      const previous = this.previous.get(pid), elapsed = previous ? sampledAt - previous.sampledAt : 0;
      let value = 0, complete = false, baseline = sample;
      if (previous && creationTime === previous.creationTime && cpuSeconds >= previous.cpuSeconds && elapsed >= 0) {
        if (elapsed >= .2) {
          value = Math.max(0, Math.min(100, (cpuSeconds - previous.cpuSeconds) / elapsed * 100 / cores));
          complete = true;
        } else {
          // A fast API call must not reset the baseline or erase the last rate.
          value = previous.value;
          complete = previous.complete;
          baseline = previous;
        }
      }
      next.set(pid, {...baseline, value, complete});
      cpu.set(pid, value);
      if (complete) ready.add(pid);
    }
    this.previous = next;
    return {cpu, ready};
  }
}

module.exports = {parseProcessSamples, CpuTracker};
