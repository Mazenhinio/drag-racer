// =====================================================================
// sliders.js — touch control layout:
//   LEFT  side of screen : horizontal STEERING slider (thumb follows
//          finger x-position anywhere in the left zone; visible track
//          at bottom-left)
//   RIGHT side of screen : two vertical sliders stacked side by side —
//          BRAKE (inner) and THROTTLE (outer). Drag up = more.
// Implemented with Pointer Events so it also works with a mouse on
// desktop. Multi-touch safe: each finger tracked by pointerId, so you
// can steer + brake + accelerate simultaneously.
// Outputs: { steer:[-1..1], throttle:[0..1], brake:[0..1] }
// =====================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class VerticalSlider {
  constructor(root, { label, color, side }) {
    this.el = document.createElement('div');
    this.el.className = 'vslider';
    this.el.style.setProperty('--c', color);
    this.el.innerHTML = `
      <div class="vs-track">
        <div class="vs-fill"></div>
        <div class="vs-thumb"></div>
      </div>
      <div class="vs-label">${label}</div>`;
    root.appendChild(this.el);
    this.fill = this.el.querySelector('.vs-fill');
    this.thumb = this.el.querySelector('.vs-thumb');
    this.value = 0;
    this.pointerId = null;
    this.side = side;

    const setFromEvent = (e) => {
      const r = this.el.querySelector('.vs-track').getBoundingClientRect();
      const t = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      this.value = t;
      this.render();
    };
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pointerId = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      setFromEvent(e);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      setFromEvent(e);
    });
    const release = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.value = 0; // springs back to zero when lifted
      this.render();
    };
    this.el.addEventListener('pointerup', release);
    this.el.addEventListener('pointercancel', release);
  }
  render() {
    const pct = (this.value * 100).toFixed(1) + '%';
    this.fill.style.height = pct;
    this.thumb.style.bottom = `calc(${pct} - 14px)`;
    this.el.classList.toggle('active', this.pointerId !== null);
  }
}

class HorizontalSteer {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'hsteer';
    this.el.innerHTML = `
      <div class="hs-track">
        <div class="hs-center"></div>
        <div class="hs-thumb"></div>
      </div>
      <div class="hs-label">STEER</div>`;
    root.appendChild(this.el);
    this.thumb = this.el.querySelector('.hs-thumb');
    this.trackEl = this.el.querySelector('.hs-track');
    this.value = 0;
    this.pointerId = null;
    this.deadzone = 0.06;

    const set = (clientX) => {
      const r = this.trackEl.getBoundingClientRect();
      let v = ((clientX - r.left) / r.width) * 2 - 1; // -1..1
      v = clamp(v, -1, 1);
      if (Math.abs(v) < this.deadzone) v = 0;
      this.value = v;
      this.render();
    };
    // "relative" mode: pressing anywhere in left half grabs the wheel —
    // first touch recentres, then drag steers. Prevents jumps.
    this.grabX = 0; this.grabV = 0;
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pointerId = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      this.grabX = e.clientX; this.grabV = this.value;
      this._rel = true;
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const r = this.trackEl.getBoundingClientRect();
      if (this._rel) {
        const dv = ((e.clientX - this.grabX) / (r.width / 2)) ;
        this.value = clamp(this.grabV + dv, -1, 1);
        if (Math.abs(this.value) < this.deadzone) this.value = 0;
        this.render();
      }
    });
    const release = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      // steering holds position (like real steering wheel) — no spring back
    };
    this.el.addEventListener('pointerup', release);
    this.el.addEventListener('pointercancel', release);
  }
  render() {
    const pct = (this.value * 50 + 50).toFixed(1) + '%';
    this.thumb.style.left = `calc(${pct} - 22px)`;
    this.el.classList.toggle('active', this.pointerId !== null);
  }
}

export class ControlRig {
  constructor(container) {
    container.innerHTML = '';
    this.left = document.createElement('div');
    this.left.className = 'zone zone-left';
    this.right = document.createElement('div');
    this.right.className = 'zone zone-right';
    container.appendChild(this.left);
    container.appendChild(this.right);

    this.steer = new HorizontalSteer(this.left);
    this.brake = new VerticalSlider(this.right, { label: 'BRAKE', color: '#ff3b30', side: 'inner' });
    this.throttle = new VerticalSlider(this.right, { label: 'GAS', color: '#30d158', side: 'outer' });
    // order matters visually: brake inner (closer to screen centre), gas outer
    this.right.insertBefore(this.brake.el, this.throttle.el);

    // keyboard fallback for desktop testing
    this.keys = {};
    window.addEventListener('keydown', (e) => { this.keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
  }

  read(dt) {
    let steer = this.steer.value;
    let thr = this.throttle.value;
    let brk = this.brake.value;
    // keyboard overlay
    if (this.keys['a'] || this.keys['arrowleft']) steer = clamp(steer - dt * 3, -1, 1);
    if (this.keys['d'] || this.keys['arrowright']) steer = clamp(steer + dt * 3, -1, 1);
    if (this.keys['w'] || this.keys['arrowup']) thr = Math.max(thr, clamp((this._kt ||= 0) + dt * 2, 0, 1));
    if (this.keys['s'] || this.keys['arrowdown']) brk = Math.max(brk, clamp((this._kb ||= 0) + dt * 2.5, 0, 1));
    if (!this.keys['w'] && !this.keys['arrowup']) this._kt = 0;
    if (!this.keys['s'] && !this.keys['arrowdown']) this._kb = 0;
    return { steer, throttle: thr, brake: brk };
  }
}
