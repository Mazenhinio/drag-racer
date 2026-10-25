// =====================================================================
// car.js — 4-wheel F1 vehicle model (Pacajka tyres, load transfer,
// lock-up / ABS / TC / rain aquaplaning).
// Convention: world x=east y=north, psi = heading rad CCW(+).
// Body frame: u forward, v rightward, r yaw rate (CW positive so that
// steer-right => +r; psi integrates as psi -= r*dt).
// Inputs: throttle/brake [0..1], steer [-1..1] (+right).
// env: { mu, water, abs, tcTarget, hydroRisk, windLat }
// =====================================================================

import { fitPacajkaParams, mfLong, mfLat, combinedSlip } from './tire.js';

const G = 9.81;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const CAR_SPEC = {
  mass: 1050, Iz: 1450, hcg: 0.30,
  lf: 1.60, lr: 1.40, tf: 1.25, tr: 1.20,
  wheelR: 0.36, Iw: 1.6,
  CdA: 1.15,             // drag N per (m/s)^2
  cl: 2.0,               // downforce N per (m/s)^2
  rollRes: 150,
  drivePowerBase: 15000, // low-speed drive force ceiling (N): grip-limited launch
  brakeForceMax: 26000,  // N total brake force capacity (mu-independent ceiling)
  brakeFrontBias: 0.60,
  alphaPeak: 5.5 * DEG, kappaPeak: 0.12,
};

export class Car {
  constructor(spec = CAR_SPEC) {
    this.s = spec;
    this.x = 0; this.y = 0; this.psi = 0;
    this.u = 0; this.v = 0; this.r = 0;
    this.w = [0, 0, 0, 0];
    this.locked = [false, false, false, false];
    this.slipK = [0, 0, 0, 0]; this.slipA = [0, 0, 0, 0];
    this.Fn = [1, 1, 1, 1];
    this.tcCut = 0; this.absPulse = 0;
    this.overtorque = 0; this.lockEnergy = 0; this.drifting = 0;
    this.hp = 0; this.gForce = { x: 0, y: 0 };
    this.drsActive = false; this.drsRequested = false;
    this.params = fitPacajkaParams(1.0); this._tp = 1.0;
    this.du = 0; this.dv = 0;
    this.xe = [0, 0, 0, 0];   // tyre longitudinal elastic deflection m
  }

  setFriction(mu) {
    if (Math.abs(mu - this._tp) > 1e-4) {
      this._tp = mu;
      this.params = fitPacajkaParams(clamp(mu, 0.1, 1.4));
    }
  }

  speedKmh() { return Math.hypot(this.u, this.v) * 3.6; }

  step(dt, input, env) {
    const s = this.s;
    this.setFriction(env.mu);
    const thr = clamp(input.throttle, 0, 1);
    const brk = clamp(input.brake, 0, 1);
    const steer = clamp(input.steer, -1, 1);

    const u = this.u, v = this.v, r = this.r;
    const V = Math.max(Math.hypot(u, v), 0.3);

    const down = s.cl * V * V;
    // DRS legality gate: main.js sets car.drsRequested from the in-zone tap
    // button. Real F1 rules: the flap may only be opened on a legal straight,
    // which is a LOW-G corner-free section — approximated here by requiring
    // near-zero lateral acceleration (car not cornering/braking hard).
    const lowLat = Math.abs(this.dv) < 2.0;              // ~<0.2 g lateral
    this.drsActive = this.drsRequested && brk < 0.05 && lowLat && V > 12;
    const drag = (this.drsActive ? 0.82 : 1) * s.CdA * V * V + s.rollRes;

    // steering (speed sensitive). World convention: psi & r are CCW(+).
    // steer>0 = turn right = clockwise = negative wheel angle in CCW frame.
    const maxSteer = 14 * DEG / (1 + V * V * 0.00035);
    const df = -steer * maxSteer;

    // ---- loads ----
    const ax = this.du || 0, ay = this.dv || 0;
    const W = s.mass * G;
    const statF = W * s.lr / (s.lf + s.lr) / 2;   // per front wheel
    const statR = W * s.lf / (s.lf + s.lr) / 2;
    const dFlongAxle = -(s.mass * ax * s.hcg) / (s.lf + s.lr);
    const dFlatPerWheel = (s.mass * ay * s.hcg) / s.tf;
    const aeroShareF = down * 0.48, aeroShareR = down * 0.52;
    const zetaF = clamp((statF + dFlongAxle / 2 + aeroShareF / 2) / statF, 0.05, 2.6);
    const zetaR = clamp((statR - dFlongAxle / 2 + aeroShareR / 2) / statR, 0.05, 2.6);
    this.Fn[0] = clamp(zetaF - dFlatPerWheel / statF * 0.5, 0.03, 2.6);
    this.Fn[1] = clamp(zetaF + dFlatPerWheel / statF * 0.5, 0.03, 2.6);
    this.Fn[2] = clamp(zetaR - dFlatPerWheel / statR * 0.45, 0.03, 2.6);
    this.Fn[3] = clamp(zetaR + dFlatPerWheel / statR * 0.45, 0.03, 2.6);

    // ---- slip angles ----
    const wf = [u - r * s.tf / 2, u + r * s.tf / 2, u - r * s.tr / 2, u + r * s.tr / 2];
    const wv = [v + r * s.lf, v + r * s.lf, v - r * s.lr, v - r * s.lr];
    const alphas = [0, 0, 0, 0];
    const armY = [s.lf, s.lf, -s.lr, -s.lr];
    for (let i = 0; i < 4; i++) {
      const fwd = Math.max(wf[i], 0.5);
      // true tyre slip angle: velocity at contact minus the rigid-body yaw term r*y
      const vTyre = wv[i] - r * armY[i];
      let a = Math.atan2(vTyre, fwd);
      if (i < 2) a -= df;   // wheel plane rotated by df (CCW+)
      alphas[i] = a;
    }

    // ---- longitudinal slips ----
    const WR = s.wheelR;
    const kappas = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const ws = this.w[i] * WR;
      const denom = Math.max(Math.abs(ws), wf[i], 2.0); // m/s floor -> stable at standstill
      kappas[i] = clamp((ws - wf[i]) / denom, -1.6, 5);
    }
    this.slipK = kappas.slice(); this.slipA = alphas.slice();

    // ---- traction control: rear slip ratio beyond threshold cuts power ----
    // Use the *steady-state* kinematic slip kappa (computed from the current
    // wheel-speed ODE state before relaxation). The dynamic slip-velocity
    // ratio spikes transiently every step and would keep TC permanently on.
    const rearK = Math.max(kappas[2], kappas[3]);   // signed: positive = overspin
    // TC target is a band around the driveCap equilibrium slip (~0.18): with
    // grip available, full throttle sits there without cutting; wheelspin
    // (kappa -> 0.4+) or low-grip surfaces push above the band and cut power.
    const tcThr = env.tcSlipRatio || 0.26;
    if (rearK > tcThr && thr > 0.02) {
      this.tcCut = clamp(this.tcCut + (rearK - tcThr) * 8 * dt, 0, 0.97);
    } else if (rearK < tcThr - 0.05) {
      this.tcCut = Math.max(0, this.tcCut - dt * 3.5);
    }
    // Off-track / heavily sliding: TC authority relaxes so the driver can
    // still modulate a slide instead of being stuck at zero power.
    const offTrack = !!env.offTrack;
    const thrEff = thr * (offTrack ? 1 : (1 - this.tcCut));

    // Yaw damping ceiling: a real F1 has significant directional stability.
    // Without it, a low-speed spin can self-excite into diverging yaw
    // oscillation. The damping itself is applied in the body update below.
    const RMAX = 2.0;                                  // rad/s physical ceiling
    this.r = clamp(this.r, -RMAX, RMAX);

    // Engine model: near-constant-power curve with a *steady-state elastic
    // slip ceiling*: the drive torque per wheel is capped so that the tyre's
    // equilibrium tread deflection stays at/below peak kappa (~0.12). Above
    // it, the relaxation ODE overshoots the MF peak and the wheels spin out
    // (which is exactly what TC then catches — see launch trace).
    // The cap scales with mu and rear load (incl. aero downforce), so wet
    // launches are traction-limited but still progress.
    // tqScale encodes the power envelope (F = P/v): ~76 kW at the patch plus a
    // flat 15 kN low-speed ceiling -> grip-limited launch, drag-limited ~275
    // km/h top speed on dry tarmac.
    const tqScale = 1 / (1 + V * 0.034);
    const driveF = thrEff * s.drivePowerBase * tqScale;   // demand N at rear patch
    // Longitudinal tyre stiffness: force per metre of contact-patch deflection.
    // Calibrated so ~0.04 m deflection reaches peak friction (~mu*Fn). This is
    // a property of the tyre carcass, not of the Pacejka fit parameters.
    const CxStiff = 120000;                                // N/m per unit load ratio
    const FnRearAvg = Math.max(400, statR * (this.Fn[2] + this.Fn[3]) / 2);
    const kappaCeil = 0.12;                                // MF peak slip ratio
    const gripCap = Math.max(2500, 2 * CxStiff * env.mu * FnRearAvg * s.wheelR * kappaCeil / (statR));
    const driveFcapped = Math.min(driveF, gripCap);

    // ---- steady-state magic-formula forces (from current slips) ----
    const p = this.params;
    const Fw = [0, 0, 0, 0], Fl = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const zeta = this.Fn[i];
      const FnN = (i < 2 ? statF : statR) * zeta;
      const Fxp = mfLong(kappas[i], zeta, p) * env.mu * FnN;
      const Fyp = mfLat(alphas[i] / DEG, zeta, p) * env.mu * FnN;
      const comb = combinedSlip(kappas[i], alphas[i], s.kappaPeak, s.alphaPeak, Fxp, Fyp);
      Fw[i] = comb.Fx; Fl[i] = comb.Fy;
    }

    // ---- wheel spin + tyre longitudinal elasticity (proper du/dt ODE) ----
    // x_e: contact-patch deflection (m); Fx = Cx * x_e, capped by MF steady value.
    //   dx_e/dt = uSlip - sigmaThrottle*|uSlip|*x_e/Lc   (relaxation length Lc~0.25m)
    //   Iw*dw/dt = Tdrive + Teng - Tbrake - Fx*R
    const brakeSplit = [s.brakeFrontBias / 2, s.brakeFrontBias / 2,
                        (1 - s.brakeFrontBias) / 2, (1 - s.brakeFrontBias) / 2];
    let anyLock = false;
    const Iw = s.Iw, Cx = 68000, Lc = 0.28;   // N/m, m
    const newK = [0, 0, 0, 0], newFx = [0, 0, 0, 0];
    // Steady-state rolling resistance as a wheel torque (N·m): free wheels
    // settle at a tiny positive deflection instead of hunting around the
    // zero-crossing of the relaxation ODE (which oscillated and pumped energy).
    const rollTq = isDriveWheel => s.rollRes * WR * (isDriveWheel && thr < 0.02 ? 0 : 1) / 4;
    for (let i = 0; i < 4; i++) {
      const isDrive = i >= 2;
      const road = wf[i];
      const FnCorner = (i < 2 ? statF : statR) * this.Fn[i];
      const fMax = Math.max(200, env.mu * FnCorner);        // friction ceiling N

      const uSlipNow = this.w[i] * WR - road;
      let bI = brakeSplit[i] * brk * s.brakeForceMax;
      if (env.abs && uSlipNow < -1.0) bI *= 0.10;            // ABS release (locking)

      const Td = isDrive ? (driveFcapped / 2) * WR : 0;
      const engT = isDrive && thr < 0.02 && brk < 0.02 ? -300 : 0;
      const rollT = rollTq(isDrive);
      const Tb = bI * WR * (this.w[i] > 0.05 ? 1 : (this.w[i] < -0.05 ? -1 : 0)) + rollT;

      // elastic deflection dynamics (semi-implicit): use current slip velocity
      const uSlip = uSlipNow;
      const xCapPrev = fMax / Cx;
      const nearSat = Math.min(1, Math.abs(this.xe[i]) / xCapPrev);
      const dxe = uSlip * (1 - 0.85 * nearSat);             // saturating build-up
      let xeNew = this.xe[i] + dxe * dt - this.xe[i] * dt * (0.6 + Math.abs(uSlip) / Lc * 0.5);
      // wheel ODE with force from current deflection
      const fxNow = clamp(Cx * this.xe[i], -fMax, fMax);
      const dw = (Td + engT - Tb - fxNow * WR) / Iw * dt;
      let wNew = this.w[i] + dw;
      if (wNew < 0) wNew = Math.max(wNew, -2);
      const maxSpin = road / WR + 120;   // rad/s: generous wheelspin allowance, bounds runaway spin only
      if (wNew > maxSpin) wNew = maxSpin;

      // cap deflection so |Fx| <= sliding ceiling and blend toward MF steady shape
      const xCap = fMax / Cx;
      if (xeNew > xCap) xeNew = xCap;
      if (xeNew < -xCap) xeNew = -xCap;
      // past peak slip, MF drops to ~0.82: emulate by shrinking cap
      const uNew = wNew * WR - road;
      const kAbs = Math.abs(uNew) / Math.max(Math.abs(wNew * WR), road, 2);
      if (kAbs > 0.2) {
        const droop = 0.82 + 0.18 * Math.exp(-(kAbs - 0.2) * 2.5);
        const capD = xCap * droop;
        if (xeNew > capD) xeNew += (capD - xeNew) * Math.min(1, dt * 12);
        if (xeNew < -capD) xeNew += (-capD - xeNew) * Math.min(1, dt * 12);
      }

      const fxNew = Cx * xeNew;
      newFx[i] = fxNew;
      this.xe[i] = xeNew;
      this.w[i] = wNew;

      const denom = Math.max(Math.abs(wNew * WR), road, 2);
      newK[i] = clamp(uNew / denom, -1.6, 5);
      this.locked[i] = newK[i] < -0.15 && brk > 0.05 && road > 3;
      if (this.locked[i]) anyLock = true;
    }
    this.slipK = newK;
    for (let i = 0; i < 4; i++) Fw[i] = newFx[i];   // dynamic forces drive the body

    // absPulse is only a HUD blink phase; in headless tests performance may be
    // absent, so fall back to a step counter.
    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : this._simT * 1000;
    this.absPulse = anyLock && env.abs ? 0.5 + 0.5 * Math.sin(nowMs * 0.05)
                                       : Math.max(0, this.absPulse - dt * 6);
    this.lockEnergy = anyLock ? Math.min(1, this.lockEnergy + dt * 2.5)
                              : Math.max(0, this.lockEnergy - dt * 1.2);
    this.overtorque = clamp(Math.max(kappas[2], kappas[3]) / 0.45, 0, 1);
    this.drifting = clamp(Math.max(Math.abs(alphas[2]), Math.abs(alphas[3])) / (14 * DEG), 0, 1);
    this.hp = env.hydroRisk || 0;

    // ---- body wrenches ----
    const cD = Math.cos(df), sD = Math.sin(df);
    const Fxt = (Fw[0] + Fw[1]) * cD - (Fl[0] + Fl[1]) * sD + Fw[2] + Fw[3];
    const Fyt = (Fw[0] + Fw[1]) * sD + (Fl[0] + Fl[1]) * cD + Fl[2] + Fl[3];
    const Mz = ((Fw[0] + Fw[1]) * sD + (Fl[0] + Fl[1]) * cD) * s.lf
             - (Fl[2] + Fl[3]) * s.lr
             + (Fw[1] - Fw[0]) * (s.tf / 2) * cD + (Fw[3] - Fw[2]) * (s.tr / 2);

    const hpLoss = 1 - 0.75 * this.hp;
    const dirU = u / V, dirV = v / V;
    // DRS: driver-activated flap drops ~18% of aero drag (only legal inside
    // the track's DRS zones — main.js clears the request outside them).
    const dragCoef = s.CdA;
    // Body-frame derivative: r is CW-positive in a CCW world frame, so the
    // Coriolis terms carry the opposite sign to the textbook CCW convention.
    const du = (Fxt * hpLoss) / s.mass - dragCoef * V * dirU / s.mass - v * r;
    const dv = (Fyt * hpLoss) / s.mass - dragCoef * V * dirV / s.mass + u * r + (env.windLat || 0) * 0.02;

    this.du = du; this.dv = dv;
    // Semi-implicit update: advance r with the new yaw moment, then apply the
    // Coriolis coupling using PRE-update velocities (explicit Euler on the
    // coupled pair conserves |V| to O(dt^2) — using post-update values here
    // injects energy and lets |v| blow up during spins).
    this.r = clamp(this.r + (Mz / s.Iz) * dt, -RMAX, RMAX) * Math.pow(0.55, dt);
    this.u += du * dt - v * this.r * dt;
    this.v += dv * dt + u * this.r * dt;
    this.psi -= this.r * dt;           // CW-positive r decreases CCW heading psi
    this.psi = ((this.psi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    const c = Math.cos(this.psi), sn = Math.sin(this.psi);
    this.x += (u * c + v * sn) * dt;
    this.y += (u * sn - v * c) * dt;

    if (V < 1.2 && brk < 0.02 && thr < 0.02) { this.u *= Math.pow(0.2, dt); this.v *= Math.pow(0.2, dt); }
    this.gForce.x = du / G; this.gForce.y = dv / G;
  }
}
