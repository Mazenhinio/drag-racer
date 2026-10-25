// =====================================================================
// env.js — weather & track-surface simulation
//   dry / damp / light rain / heavy rain, evolving over a session,
//   puddles + aquaplaning risk, track "rubbering in" vs washing away.
// =====================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const WEATHER_PRESETS = {
  dry:    { label: 'Dry',         water: 0.00, rainRate: 0.0 },
  damp:   { label: 'Damp',        water: 0.18, rainRate: 0.05 },
  light:  { label: 'Light Rain',  water: 0.42, rainRate: 0.35 },
  heavy:  { label: 'Heavy Rain',  water: 0.80, rainRate: 0.9 },
  storm:  { label: 'Storm',       water: 1.00, rainRate: 1.4 },
};

// Type choice matters a lot in the wet (game abstraction of F1 tyre rules)
export const TYRES = {
  soft:   { label: 'C4 Soft',    dryMu: 1.06, wear: 1.35, warmup: 1.6, wetMax: 0.15 },
  medium: { label: 'C3 Medium',  dryMu: 1.00, wear: 1.00, warmup: 1.2, wetMax: 0.35 },
  hard:   { label: 'C2 Hard',    dryMu: 0.95, wear: 0.70, warmup: 0.9, wetMax: 0.55 },
  inter:  { label: 'Intermediate', dryMu: 0.72, wear: 1.1, warmup: 1.0, wetMax: 0.75 },
  wet:    { label: 'Full Wet',   dryMu: 0.55, wear: 1.2, warmup: 1.0, wetMax: 1.0 },
};

export class Environment {
  constructor(presetKey = 'dry', tyreKey = 'medium') {
    this.setWeather(presetKey);
    this.setTyre(tyreKey);
    this.trackRubber = 0.35;   // -1 (cold/dusty) .. +1 (fully rubbered-in)
    this.temp = 28;            // ambient °C affects tyre warmup
    this.windLat = 0;          // m/s crosswind (adds subtle lateral force)
    this.timeOfDay = 13;       // 0-24h; night races cooler
    this._rainTimer = 0;
    this._puddles = [];        // {s: lapProgress, r: radius m, depth}
    this.seedPuddles();
  }

  setWeather(k) {
    const w = WEATHER_PRESETS[k] || WEATHER_PRESETS.dry;
    this.weatherKey = k;
    this.baseWater = w.water;
    this.rainRate = w.rainRate;
    this.water = w.water;
  }

  setTyre(k) {
    this.tyreKey = k;
    this.tyre = TYRES[k];
  }

  seedPuddles() {
    this._puddles.length = 0;
    if (this.baseWater < 0.15) return;
    const n = Math.round(4 + this.baseWater * 10);
    for (let i = 0; i < n; i++) {
      this._puddles.push({
        s: Math.random(),                       // position along lap
        off: (Math.random() - 0.5) * 10,        // lateral offset from racing line
        r: 6 + Math.random() * 14,              // radius m
        depth: 0.4 + Math.random() * 0.6,
      });
    }
  }

  // local extra water at car position (lap progress s, lateral offset y)
  puddleAt(s, latOff) {
    let add = 0;
    for (const p of this._puddles) {
      let ds = Math.abs(s - p.s); if (ds > 0.5) ds = 1 - ds;
      const dy = Math.abs(latOff - p.off);
      if (ds < 0.01 && dy < p.r) {
        const f = (1 - ds / 0.01) * (1 - dy / p.r);
        add = Math.max(add, f * p.depth);
      }
    }
    return add;
  }

  step(dt, carSpeedKmh) {
    // dynamic water: rain adds, evaporation/draining removes
    this._rainTimer += dt;
    const target = this.baseWater;
    this.water = clamp(this.water + (target - this.water) * dt * 0.05, 0, 1.2);

    // track washing/rubbering: dry -> rubber builds with traffic; rain washes it
    if (this.water < 0.1) this.trackRubber = clamp(this.trackRubber + dt * 0.0006, -1, 1);
    else this.trackRubber = clamp(this.trackRubber - dt * this.water * 0.004, -1, 1);

    // wind wander
    this.windLat = clamp(this.windLat + (Math.random() - 0.5) * dt * 2, -6, 6);
  }

  // effective peak friction mu seen by tyres at location (s,latOff)
  mu(carSpeedKmh = 0, s = 0, latOff = 0) {
    const t = this.tyre;
    const wLocal = clamp(this.water + this.puddleAt(s, latOff), 0, 1.2);
    // dry performance degrades when wet; wet tyres lose perf on dry (overheat)
    const wetPenaltyOnDryTyre = clamp((wLocal - t.wetMax) / 0.4, 0, 1);
    const dryPenaltyOnWetTyre = clamp((0.12 - wLocal) / 0.12, 0, 1) * (t === TYRES.inter ? 0.5 : t === TYRES.wet ? 0.85 : 0);
    let mu = t.dryMu * (1 - 0.55 * wetPenaltyOnDryTyre) * (1 - 0.45 * dryPenaltyOnWetTyre);
    // water film shear strength: inter/wet tyres channel water away
    const waterLoss = wLocal * (t.wetMax >= 0.7 ? 0.12 : t.wetMax >= 0.35 ? 0.35 : 0.75);
    mu *= (1 - waterLoss);
    // track surface rubber
    mu *= 1 + 0.06 * this.trackRubber;
    // abrasion handled per-track externally via trackGrip multiplier
    // temperature effect: cold tyres less grip until warmed (warmup handled in Car? here simple)
    mu *= clamp(0.9 + (this.temp - 10) * 0.006, 0.85, 1.05);
    return clamp(mu, 0.15, 1.3);
  }

  hydroplaneRisk(carSpeedKmh, s = 0, latOff = 0) {
    const wLocal = clamp(this.water + this.puddleAt(s, latOff), 0, 1.2);
    if (wLocal < 0.1) return 0;
    // classic denial threshold ~ speed/sqrt(depth); game curve:
    const thr = 190 - 90 * wLocal * (this.tyre.wetMax >= 0.7 ? 1.4 : this.tyre.wetMax >= 0.35 ? 1.0 : 0.4);
    return clamp((carSpeedKmh - thr) / 60, 0, 1);
  }

  isRaining() { return this.rainRate > 0.15; }
}
