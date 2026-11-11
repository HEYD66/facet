"use strict";
// 节点检测的长期记录：每个节点（节点源 + 名称）的连通性 / 出口 IP 成功次数、总次数和最近结果。
// 取消的检测和「节点源已更新，请重新检测」不计入。写盘合并为一次，退出时立即写入。
const fs = require("node:fs"),
  path = require("node:path");
const KINDS = ["latency", "ip", "speed"],
  MAX_NODES = 20000,
  RECENT = 10;
function pick(r) {
  const base = { at: r.at, ok: !!r.ok };
  if (!r.ok) return { ...base, error: String(r.error || "").slice(0, 200) };
  if (r.kind === "latency")
    return { ...base, latencyMs: r.latencyMs, provider: r.provider || "", fallback: !!r.fallback };
  if (r.kind === "speed")
    return { ...base, mbps: r.mbps, bytes: r.bytes, elapsedMs: r.elapsedMs, provider: r.provider || "" };
  return {
    ...base,
    ip: r.ip,
    country: r.country || "",
    region: r.region || "",
    city: r.city || "",
    isp: r.isp || "",
    timezone: r.timezone || "",
    countryCode: r.countryCode || "",
    queriedAt: r.queriedAt || r.at,
    provider: r.provider || "",
  };
}
class DiagnosticHistory {
  constructor(dir) {
    this.file = dir ? path.join(dir, "diagnostic-history.json") : null;
    this.data = { version: 1, nodes: {} };
    this.timer = null;
    this.dirty = false;
    this.version = 1;
    try {
      if (this.file && fs.existsSync(this.file)) {
        const d = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (d && d.version === 1 && d.nodes && typeof d.nodes === "object" && !Array.isArray(d.nodes)) this.data = d;
      }
    } catch {}
  }
  key(sourceId, name) {
    return String(sourceId) + "\u0001" + String(name);
  }
  counts(result) {
    return KINDS.includes(result?.kind) && !result.cached && !(!result.ok && /已取消|重新检测/.test(String(result.error || "")));
  }
  record(result) {
    if (!this.counts(result)) return false;
    const k = this.key(result.sourceId, result.name);
    const row = (this.data.nodes[k] ||= { sourceId: result.sourceId, name: result.name });
    const s = (row[result.kind] ||= { ok: 0, total: 0 });
    s.total++;
    s.last = pick(result);
    // 最近 10 次（延迟趋势 / 出口 IP 变化）。
    const brief = { at: result.at, ok: !!result.ok };
    if (result.ok && result.kind === "latency") brief.ms = result.latencyMs;
    if (result.ok && result.kind === "ip") brief.ip = result.ip;
    if (result.ok && result.kind === "speed") brief.mbps = result.mbps;
    if (!result.ok) brief.error = String(result.error || "").slice(0, 80);
    s.recent = [...(Array.isArray(s.recent) ? s.recent : []), brief].slice(-RECENT);
    if (result.ok) {
      s.ok++;
      s.lastOk = s.last;
    }
    row.at = result.at;
    const keys = Object.keys(this.data.nodes);
    if (keys.length > MAX_NODES) {
      keys.sort((a, b) => String(this.data.nodes[a].at).localeCompare(String(this.data.nodes[b].at)));
      for (const old of keys.slice(0, keys.length - MAX_NODES)) delete this.data.nodes[old];
    }
    this.schedule();
    return true;
  }
  clear(sourceId) {
    let n = 0;
    for (const [k, row] of Object.entries(this.data.nodes))
      if (!sourceId || row.sourceId === sourceId) {
        delete this.data.nodes[k];
        n++;
      }
    if (n) this.schedule();
    return n;
  }
  // Drops the records of named nodes, for sources that reuse a name after the node behind it is gone.
  forget(sourceId, names) {
    let n = 0;
    for (const name of names) {
      const k = this.key(sourceId, name);
      if (this.data.nodes[k]) {
        delete this.data.nodes[k];
        n++;
      }
    }
    if (n) this.schedule();
    return n;
  }
  list() {
    return Object.values(this.data.nodes);
  }
  schedule() {
    this.version++;
    this.dirty = true;
    if (this.timer || !this.file) return;
    this.timer = setTimeout(() => this.flush(), 400);
    this.timer.unref?.();
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty || !this.file) return;
    this.dirty = false;
    try {
      require("./store.cjs").atomic(this.file, this.data);
    } catch {
      this.dirty = true;
    }
  }
}
module.exports = { DiagnosticHistory };
