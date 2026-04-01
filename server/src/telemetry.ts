const WINDOW_SIZE = 20; // 1 second at 20Hz

export interface TelemetrySnapshot {
  tick: number;
  tickAvgUs: number;
  phases: { name: string; avgUs: number; pct: number }[];
  network: { type: string; recvBytes: number; sentBytes: number; conns: number }[];
  entityCount: number;
  playerCount: number;
  uptimeMs: number;
}

export class Telemetry {
  // --- Phase timing ---
  private phaseStart = 0;
  private currentPhases: Map<string, number> = new Map();
  private history: Map<string, number>[] = [];
  private historyIdx = 0;

  // --- Network bytes (cumulative since last reset) ---
  private sent: Map<string, number> = new Map();
  private recv: Map<string, number> = new Map();
  private conns: Map<string, number> = new Map();

  // --- Counters ---
  tick = 0;
  entityCount = 0;
  playerCount = 0;
  private startTime = performance.now();

  beginPhase(name: string): void {
    this.phaseStart = performance.now();
  }

  endPhase(name: string): void {
    const us = (performance.now() - this.phaseStart) * 1000;
    this.currentPhases.set(name, us);
  }

  endTick(): void {
    // Store current tick's phases into circular buffer
    if (this.history.length < WINDOW_SIZE) {
      this.history.push(new Map(this.currentPhases));
    } else {
      this.history[this.historyIdx] = new Map(this.currentPhases);
    }
    this.historyIdx = (this.historyIdx + 1) % WINDOW_SIZE;
    this.currentPhases.clear();
  }

  recordBytesSent(type: string, n: number): void {
    this.sent.set(type, (this.sent.get(type) ?? 0) + n);
  }

  recordBytesReceived(type: string, n: number): void {
    this.recv.set(type, (this.recv.get(type) ?? 0) + n);
  }

  setConnectionCount(type: string, n: number): void {
    this.conns.set(type, n);
  }

  snapshot(): TelemetrySnapshot {
    // Compute per-phase averages from history
    const count = this.history.length;
    const phaseTotals = new Map<string, number>();
    for (const entry of this.history) {
      for (const [name, us] of entry) {
        phaseTotals.set(name, (phaseTotals.get(name) ?? 0) + us);
      }
    }

    let tickTotalUs = 0;
    const phaseList: { name: string; avgUs: number; pct: number }[] = [];
    for (const [name, total] of phaseTotals) {
      const avg = count > 0 ? total / count : 0;
      tickTotalUs += avg;
      phaseList.push({ name, avgUs: avg, pct: 0 });
    }

    // Compute percentages
    for (const p of phaseList) {
      p.pct = tickTotalUs > 0 ? (p.avgUs / tickTotalUs) * 100 : 0;
    }

    // Network — collect all known types
    const netTypes = new Set([...this.sent.keys(), ...this.recv.keys(), ...this.conns.keys()]);
    const network: TelemetrySnapshot['network'] = [];
    for (const type of netTypes) {
      network.push({
        type,
        recvBytes: this.recv.get(type) ?? 0,
        sentBytes: this.sent.get(type) ?? 0,
        conns: this.conns.get(type) ?? 0,
      });
    }

    return {
      tick: this.tick,
      tickAvgUs: tickTotalUs,
      phases: phaseList,
      network,
      entityCount: this.entityCount,
      playerCount: this.playerCount,
      uptimeMs: performance.now() - this.startTime,
    };
  }

  resetNetworkCounters(): void {
    this.sent.clear();
    this.recv.clear();
  }
}
