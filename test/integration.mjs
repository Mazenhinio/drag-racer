// Headless integration test: runs the exact game-loop logic from main.js
// (envForCar + fixed-step car.step) with synthetic slider input on real
// tracks. Checks for NaN/blowups, off-track detection, TC/ABS/hydro output.
import { TRACKS, findNearest, progressOf } from '../game/js/tracks/track.js';
import { Car } from '../game/js/physics/car.js';
import { Environment } from '../game/js/physics/env.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let failures = 0;

for (const t of [TRACKS[0], TRACKS.find(x => x.id === 'monaco'), TRACKS.find(x => x.id === 'monza')]) {
  const wet = t.id === 'monza';
  const env = new Environment(wet ? 'heavy' : 'dry', wet ? 'inter' : 'medium');
  const car = new Car();
  const p0 = t.pts[0], p1 = t.pts[4];
  car.x = p0.x; car.y = p0.y;
  car.psi = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  let hint = 0, offCount = 0, maxKmh = 0, lockSeen = 0, tcSeen = 0, hydroSeen = 0;
  const H = 1 / 120;

  for (let i = 0; i < 120 * 30; i++) {
    // crude "player": steer toward lookahead point, full gas, hard brake last 5s
    const tgt = t.pts[(hint + 18) % t.pts.length];
    let err = Math.atan2(tgt.y - car.y, tgt.x - car.x) - car.psi;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    // look further ahead as speed rises so the bot doesn't brake-steer itself
    const far = t.pts[(hint + 18 + Math.round(car.speedKmh() * 0.35)) % t.pts.length];
    let errF = Math.atan2(far.y - car.y, far.x - car.x) - car.psi;
    while (errF > Math.PI) errF -= 2 * Math.PI;
    while (errF < -Math.PI) errF += 2 * Math.PI;
    const steer = clamp(errF * 1.6, -1, 1);

    const near = findNearest(t, car.x, car.y, hint); hint = near.idx;
    const s = progressOf(t, hint);
    const hw = (t.pts[hint].w || 14) / 2;
    const latOff = near.dist > hw ? (near.dist - hw) : 0;
    const gripMul = t.grip === 'high' ? 1.05 : t.grip === 'low' ? 0.93 : 1.0;
    const mu = clamp(env.mu(car.speedKmh(), s, latOff) * gripMul * (near.dist > hw + 1 ? 0.55 : 1), 0.12, 1.35);
    const hydro = env.hydroplaneRisk(car.speedKmh(), s, latOff);
    if (near.dist > hw + 1) offCount++;
    const eState = { mu, abs: true, tcSlipRatio: 0.26, hydroRisk: hydro, windLat: env.windLat, water: env.water, s, latOff, offTrack: near.dist > hw + 1 };

    const brk = i > 120 * 25 ? Math.min(1, (i - 120 * 25) / 60) : 0;
    car.step(H, { throttle: brk > 0.1 ? 0 : 1, brake: brk, steer }, eState);
    env.step(H, car.speedKmh());

    maxKmh = Math.max(maxKmh, car.speedKmh());
    if (car.locked.some(Boolean)) lockSeen++;
    if (car.tcCut > 0.05) tcSeen++;
    if (car.hp > 0.25) hydroSeen++;
  }

  const vals = [car.x, car.y, car.u, car.v, car.r, ...car.w, ...car.slipK, ...car.Fn];
  const bad = vals.some((v) => Number.isNaN(v) || !Number.isFinite(v));
  if (bad) failures++;
  console.log(
    `${t.id.padEnd(9)} NaN:${bad} | max ${maxKmh.toFixed(0)} km/h | final ${car.speedKmh().toFixed(1)} km/h` +
    ` | off-steps:${offCount} | lock:${lockSeen} tc:${tcSeen} hydro:${hydroSeen}`
  );
}

if (failures) { console.error('FAILURES:', failures); process.exit(1); }
console.log('integration OK');
