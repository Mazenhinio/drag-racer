// =====================================================================
// hud.js — telemetry overlay: speed/gear, warning lights (ABS / TC /
// LOCK-UP / SLIDE / AQUA), lap timer + minimap with car dot.
// =====================================================================

const GEAR_RATIOS = [0, 31, 52, 74, 96, 118, 141, 163, 187, 213, 240]; // km/h band per gear

export class HUD {
  constructor(root) {
    root.innerHTML = `
      <div class="hud-top">
        <div id="lapTimes"><span id="curLap">--:--.---</span><span id="lastLap"></span></div>
        <div id="weatherChip">Dry</div>
      </div>
      <canvas id="minimap" width="150" height="150"></canvas>
      <button id="drsBtn">DRS</button>
      <div class="hud-bottom">
        <div id="lights">
          <div class="light" data-k="abs">ABS</div>
          <div class="light" data-k="tc">TC</div>
          <div class="light danger" data-k="lock">LOCK</div>
          <div class="light warn" data-k="slide">SLIDE</div>
          <div class="light aqua" data-k="aqua">AQUA</div>
          <div class="light drs" data-k="drs">DRS</div>
        </div>
        <div id="speedo">
          <div id="gear">N</div>
          <div id="kmh">0</div>
          <div id="gforce"><i></i></div>
        </div>
      </div>`;
    this.curLap = root.querySelector('#curLap');
    this.lastLap = root.querySelector('#lastLap');
    this.weather = root.querySelector('#weatherChip');
    this.gearEl = root.querySelector('#gear');
    this.kmhEl = root.querySelector('#kmh');
    this.gf = root.querySelector('#gforce i');
    this.lights = {};
    root.querySelectorAll('.light').forEach(l => this.lights[l.dataset.k] = l);
    this.drsBtn = root.querySelector('#drsBtn');
    this.drsBtn.style.display = 'none';
    this._drsDown = false;
    const press = (e) => { e.preventDefault(); this._drsDown = true; };
    const release = () => { this._drsDown = false; };
    this.drsBtn.addEventListener('pointerdown', press);
    this.drsBtn.addEventListener('pointerup', release);
    this.drsBtn.addEventListener('pointercancel', release);
    this.drsBtn.addEventListener('pointerleave', release);
    this.mapCanvas = root.querySelector('#minimap');
    this.mctx = this.mapCanvas.getContext('2d');
  }

  setTrack(track) {
    this.track = track;
    const b = track.bounds;
    const pad = 12;
    const sc = Math.min((150 - pad * 2) / (b.maxX - b.minX), (150 - pad * 2) / (b.maxY - b.minY));
    this.mproj = (x, y) => [pad + (x - b.minX) * sc, 150 - pad - (y - b.minY) * sc];
    this.mctx.clearRect(0, 0, 150, 150);
    this.mctx.strokeStyle = 'rgba(255,255,255,.85)';
    this.mctx.lineWidth = 2.5;
    this.mctx.beginPath();
    track.pts.forEach((p, i) => {
      const [mx, my] = this.mproj(p.x, p.y);
      i ? this.mctx.lineTo(mx, my) : this.mctx.moveTo(mx, my);
    });
    this.mctx.closePath();
    this.mctx.stroke();
    // start line marker
    const [sx, sy] = this.mproj(track.pts[0].x, track.pts[0].y);
    this.mctx.fillStyle = '#ffd60a';
    this.mctx.fillRect(sx - 3, sy - 3, 6, 6);
  }

  fmt(t) {
    if (t == null) return '--:--.---';
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  }

  update(car, env, lapInfo) {
    const kmh = Math.round(car.speedKmh());
    this.kmhEl.textContent = kmh;
    let g = 0;
    for (let i = GEAR_RATIOS.length - 1; i >= 1; i--) if (kmh >= GEAR_RATIOS[i]) { g = i; break; }
    this.gearEl.textContent = car.u < 0.5 && kmh < 2 ? 'N' : String(g);
    // g-force dot
    const gx = Math.max(-5, Math.min(5, car.gForce.y * 9));
    const gy = Math.max(-5, Math.min(5, -car.gForce.x * 9));
    this.gf.style.transform = `translate(${50 + gx * 9}%, ${50 + gy * 9}%)`;

    const on = (k, v) => this.lights[k].classList.toggle('on', !!v);
    on('abs', car.absPulse > 0.3);
    on('tc', car.tcCut > 0.05);
    on('lock', car.lockEnergy > 0.25);
    on('slide', car.drifting > 0.45);
    on('aqua', car.hp > 0.25);
    on('drs', car.drsActive);

    // DRS button: visible only inside an activation zone
    if (this.envState) {
      this.drsBtn.style.display = this.envState.inDrs ? 'block' : 'none';
      car.drsRequested = this.envState.inDrs && this._drsDown;
      this.drsBtn.classList.toggle('armed', car.drsActive);
    }

    this.curLap.textContent = this.fmt(lapInfo.current);
    this.lastLap.textContent = lapInfo.last ? 'LAST ' + this.fmt(lapInfo.last) : '';
    if (lapInfo.best != null) this.lastLap.textContent += ' · BEST ' + this.fmt(lapInfo.best);
    this.weather.textContent = `${env.tyre.label} · ${env.isRaining() ? 'Rain' : 'Dry'} · water ${(env.water * 100) | 0}%`;

    // live car dot on minimap
    if (this.track) {
      this.setTrack_lightOverlay(car);
    }
  }

  setTrack_lightOverlay(car) {
    // redraw dot only: keep cached base image
    if (!this._base) {
      this._base = document.createElement('canvas');
      this._base.width = 150; this._base.height = 150;
      this._base.getContext('2d').drawImage(this.mapCanvas, 0, 0);
    }
    const c = this.mctx;
    c.clearRect(0, 0, 150, 150);
    c.drawImage(this._base, 0, 0);
    const [mx, my] = this.mproj(car.x, car.y);
    c.fillStyle = '#ff3b30';
    c.beginPath(); c.arc(mx, my, 4, 0, 6.29); c.fill();
  }

  resetMinimapCache() { this._base = null; }
}
