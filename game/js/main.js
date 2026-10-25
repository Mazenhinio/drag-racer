// =====================================================================
// main.js — game bootstrap: menu (track/weather/tyre pickers), fixed
// timestep physics loop, render wiring, lap timing, off-track handling.
// =====================================================================

import * as THREE from 'three';
import { TRACKS, findNearest, progressOf } from './tracks/track.js';
import { Car } from './physics/car.js';
import { Environment } from './physics/env.js';
import { WorldBuilder, buildCarMesh, ParticleFX, RainFX, ChaseCamera, makeRenderer } from './render/lowpoly.js';
import { themeFor } from './render/theme.js';
import { ControlRig } from './ui/sliders.js';
import { HUD } from './ui/hud.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.renderer = makeRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3500);
    this.chase = new ChaseCamera(this.camera);
    this.rig = new ControlRig(document.getElementById('controls'));
    this.hud = new HUD(document.getElementById('hud'));

    this.acc = 0; this.lastT = performance.now();
    this.running = false;
    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  start(trackId, weatherKey, tyreKey) {
    // ---- dispose previous world if any ----
    if (this.worldGroup) { this.scene.remove(this.worldGroup); this.disposeGroup(this.worldGroup); }
    if (this.carMesh) this.scene.remove(this.carMesh);
    if (this.fx) this.scene.remove(this.fx.points);
    if (this.rain) this.scene.remove(this.rain.lines);
    if (this.skyMeshes) for (const m of this.skyMeshes) this.scene.remove(m);

    const track = TRACKS.find(t => t.id === trackId) || TRACKS[0];
    this.track = track;
    this.env = new Environment(weatherKey, tyreKey);
    this.absEnabled = true;
    this.car = new Car();

    // place car on start line
    const p0 = track.pts[0], p1 = track.pts[4];
    this.car.x = p0.x; this.car.y = p0.y;
    this.car.psi = Math.atan2(p1.y - p0.y, p1.x - p0.x);

    const theme = themeFor(track.id);
    const wb = new WorldBuilder(this.scene, track, theme);
    this.worldGroup = wb.build();
    this.world = wb;
    this.skyMeshes = [wb.skyMesh, wb.sunMesh].filter(Boolean);

    this.carMesh = buildCarMesh(0xe10600);
    this.scene.add(this.carMesh);
    this.fx = new ParticleFX(this.scene, 700);
    this.rain = new RainFX(this.scene, 900);

    this.hud.setTrack(track);
    this.hud.resetMinimapCache();
    // per-track best lap persistence
    try {
      const stored = parseFloat(localStorage.getItem('bestLap_' + track.id));
      this.lapInfo.best = isFinite(stored) && stored > 5 ? stored : null;
    } catch (e) { this.lapInfo.best = null; }

    this.lapInfo.current = 0; this.lapInfo.last = null; this.lapInfo.laps = 0;
    this._hintIdx = 0; this._prevProg = 0; this._lapT = 0;
    this._offTrack = 0;

    document.getElementById('menu').style.display = 'none';
    document.getElementById('pauseBtn').style.display = 'block';
    this.running = true;
    this.lastT = performance.now();
  }

  disposeGroup(g) {
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }

  envForCar() {
    const near = findNearest(this.track, this.car.x, this.car.y, this._hintIdx);
    this._hintIdx = near.idx;
    const s = progressOf(this.track, near.idx);
    const hw = (this.track.pts[near.idx].w || 14) / 2;
    const latOff = near.dist > hw ? (near.dist - hw) * ((s * 7) % 2 < 1 ? 1 : -1) : 0;
    const gripMul = this.track.grip === 'high' ? 1.05 : this.track.grip === 'low' ? 0.93 : 1.0;
    const mu = clamp(this.env.mu(this.car.speedKmh(), s, latOff) * gripMul * (near.dist > hw + 1 ? 0.55 : 1), 0.12, 1.35);
    const hydro = this.env.hydroplaneRisk(this.car.speedKmh(), s, latOff);
    // DRS: is the car inside one of the circuit's activation zones?
    let inDrs = false;
    for (const [a, b] of (this.track.drs || [])) if (s >= a && s <= b) { inDrs = true; break; }
    if (!inDrs) this.car.drsRequested = false;   // flap auto-closes at zone end
    return { mu, abs: this.absEnabled, tcSlipRatio: 0.26, hydroRisk: hydro, windLat: this.env.windLat, water: this.env.water, s, latOff, offTrack: near.dist > hw + 1, inDrs };
  }

  step(dt) {
    const input = this.input;
    this.car.step(dt, input, this.envState);
    this.env.step(dt, this.car.speedKmh());
    this._lapT += dt;

    // lap detection via wrap-around of progress
    const near = findNearest(this.track, this.car.x, this.car.y, this._hintIdx);
    const prog = progressOf(this.track, near.idx);
    if (this._prevProg > 0.85 && prog < 0.15 && this.car.speedKmh() > 30) {
      let isBest = false;
      if (this.lapInfo.last == null || this._lapT < this.lapInfo.last) {
        this.lapInfo.best = this.lapInfo.best == null ? this._lapT : Math.min(this.lapInfo.best, this._lapT);
        isBest = true;
      }
      this.lapInfo.last = this._lapT;
      this.lapInfo.laps++;
      this._lapT = 0;
      // persist best lap per track
      try {
        const prev = parseFloat(localStorage.getItem('bestLap_' + this.track.id));
        if (!isFinite(prev) || this.lapInfo.best < prev) localStorage.setItem('bestLap_' + this.track.id, String(this.lapInfo.best));
      } catch (e) { /* private mode */ }
      if (isBest && 'vibrate' in navigator) try { navigator.vibrate(60); } catch (e) {}
    } else if (this._prevProg < 0.15 && prog > 0.85) {
      this._lapT = 0; // went backwards over the line
    }
    this._prevProg = prog;

    // off-track: grass drag slows you and kicks up dust
    if (this.envState.offTrack) {
      this._offTrack = Math.min(1, this._offTrack + dt * 4);
      const k = Math.pow(0.35, dt);
      this.car.u *= k; this.car.v *= k;
      if (Math.random() < dt * 30 && this.car.speedKmh() > 20) {
        this.fx.spawn(this.car.x, 0.4, -this.car.y, (Math.random() - .5) * 3, 2, (Math.random() - .5) * 3, 0.62, 0.52, 0.35, 0.9, 1.2);
      }
    } else this._offTrack = Math.max(0, this._offTrack - dt * 3);

    // lock-up smoke & wet spray from rear wheels
    const wr = 0.36;
    for (let i = 2; i < 4; i++) {
      const slipMag = Math.abs(this.car.slipK[i]);
      const locked = this.car.locked[i];
      if ((locked || slipMag > 0.5) && this.car.speedKmh() > 25 && this.env.water < 0.25 && Math.random() < dt * 40) {
        this.fx.spawn(this.car.x, 0.3, -this.car.y, (Math.random() - .5) * 2, 1.2, (Math.random() - .5) * 2, 0.85, 0.85, 0.85, 1.1, 1.6);
      }
      if (this.env.water > 0.12 && this.car.speedKmh() > 60 && Math.random() < dt * (20 + this.env.water * 60)) {
        // water rooster-tail spray
        this.fx.spawn(this.car.x, 0.4, -this.car.y, (Math.random() - .5) * 4, 3 + Math.random() * 3, (Math.random() - .5) * 4, 0.75, 0.85, 0.95, 0.5, 0.9);
      }
    }
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!this.running) { this.renderer.render(this.scene, this.camera); return; }
    dt = Math.min(dt, 0.1);

    this.input = this.rig.read(dt);
    this.envState = this.envForCar();
    this.hud.envState = this.envState;   // HUD reads inDrs for the DRS button

    // fixed-step physics at 120 Hz for stable tyre relaxation
    const H = 1 / 120;
    this.acc += dt;
    let guard = 0;
    while (this.acc >= H && guard++ < 12) { this.step(H); this.acc -= H; }

    // sync visuals
    const c = this.car;
    this.carMesh.position.set(c.x, 0, -c.y);
    this.carMesh.rotation.y = Math.PI / 2 - c.psi;
    const steerVis = clamp(this.input.steer, -1, 1) * 0.35;
    if (this.carMesh.userData.steer) for (const p of this.carMesh.userData.steer) p.rotation.y = steerVis;
    const wspin = c.w.map(w => w * 0.36);
    this.carMesh.userData.wheels.forEach((w, i) => { w.rotation.x = -wspin[i] * 1; });
    this.fx.update(dt);
    this.rain.update(dt, this.camera.position, clamp(this.env.rainRate, 0, 1));
    this.world.setWeatherTint(clamp(this.env.water, 0, 1));
    this.chase.follow(c.x, c.y, c.psi, c.speedKmh(), dt, c.lockEnergy * 0.6 + this._offTrack * 0.3);
    this.hud.update(c, this.env, { current: this._lapT, last: this.lapInfo.last });
    this.renderer.render(this.scene, this.camera);
  }

  begin() { requestAnimationFrame((t) => this.frame(t)); }
}

// ---------------------------------------------------------------- menu --
function populateMenu(game) {
  const sel = document.getElementById('trackSel');
  const groups = {};
  TRACKS.forEach(t => { (groups[t.country] ||= []).push(t); });
  TRACKS.forEach(t => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = `${t.name} (${t.laps} laps)`;
    sel.appendChild(o);
  });
  sel.value = localStorage.getItem('lastTrack') || 'bahrain';

  const wp = document.getElementById('weatherSel');
  ['dry', 'damp', 'light', 'heavy', 'storm'].forEach(k => {
    const o = document.createElement('option'); o.value = k; o.textContent = k.toUpperCase(); wp.appendChild(o);
  });
  const ty = document.getElementById('tyreSel');
  [['soft', 'SOFT'], ['medium', 'MEDIUM'], ['hard', 'HARD'], ['inter', 'INTER'], ['wet', 'WET']].forEach(([k, l]) => {
    const o = document.createElement('option'); o.value = k; o.textContent = l; ty.appendChild(o);
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    localStorage.setItem('lastTrack', sel.value);
    game.start(sel.value, wp.value, ty.value);
  });

  document.getElementById('pauseBtn').addEventListener('click', () => {
    game.running = !game.running;
    document.getElementById('pauseBtn').textContent = game.running ? '❚❚' : '▶';
  });
}

const game = new Game();
populateMenu(game);
game.begin();

// expose for debugging in console
window.__game = game;
