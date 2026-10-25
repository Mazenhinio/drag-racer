// =====================================================================
// lowpoly.js — flat-shaded low-poly Three.js world builder & renderer.
// Everything is deliberately faceted: shared vertices are un-welded via
// toNonIndexed() + computeVertexNormals() so each triangle gets a flat
// normal (classic low-poly look). No textures, no shadows — vertex
// colours only, which keeps it fast on mobile.
// =====================================================================

import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// deterministic PRNG so terrain/scenery is stable between frames
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function flat(geo) { const g = geo.toNonIndexed(); g.computeVertexNormals(); return g; }

function colorize(g, fn) { // fn(x,y,z, iTri) -> [r,g,b]
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), (i / 3) | 0);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const MAT_VERT = (opts = {}) => new THREE.MeshBasicMaterial({
  vertexColors: true, flatShading: true, ...opts,
});

// ---------------------------------------------------------------------
export class WorldBuilder {
  constructor(scene, track, theme) {
    this.scene = scene;
    this.track = track;
    this.theme = theme;          // palette {ground, groundHi, kerbA, kerbB, wall, tree...}
    this.rand = mulberry32(hashStr(track.id));
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  build() {
    this.buildTerrain();
    this.buildTrackRibbon();
    this.buildKerbs();
    this.buildStartLine();
    if (this.theme.street) this.buildCityWalls(); else this.buildBarriers();
    this.buildScenery();
    this.buildSky();
    return this.group;
  }

  // ---- faceted ground plane with elevation noise, lowered under track --
  buildTerrain() {
    const b = this.track.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 2.6 + 800;
    const seg = 64;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const half = size / 2;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    // move plane centre onto track centre
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) + cx);
      pos.setZ(i, pos.getZ(i) + cz);
    }
    // gentle rolling hills, flattened near the circuit
    const pts = this.track.pts;
    const stepI = 6;
    const hill = (x, z) => {
      const nx = x * 0.0016 + hashStr(this.track.id) % 7;
      const nz = z * 0.0016;
      return (Math.sin(nx * 1.7) * Math.cos(nz * 1.3) + Math.sin(nx * 3.1 + nz * 2.3) * 0.5) * 14;
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // distance to nearest centreline point (coarse grid search)
      let dmin = 1e9;
      for (let k = 0; k < pts.length; k += stepI) {
        const dx = pts[k].x - x, dy = pts[k].y - z;
        const d2 = dx * dx + dy * dy;
        if (d2 < dmin) dmin = d2;
      }
      const dist = Math.sqrt(dmin);
      const roadEdge = (pts[0].w || 14) / 2 + 14;
      const fade = clamp((dist - roadEdge) / 90, 0, 1);
      pos.setY(i, hill(x, z) * fade - (1 - fade) * 1.2);
    }
    const fg = flat(geo);
    colorize(fg, (x, y, z, tri) => {
      const base = this.theme.ground;
      const j = ((tri * 2654435761) >>> 0 % 97) / 97; // per-facet tint
      const shade = 0.82 + 0.3 * ((y + 20) / 40) + j * 0.06;
      return [base[0] * shade, base[1] * shade, base[2] * shade];
    });
    this.group.add(new THREE.Mesh(fg, MAT_VERT()));
  }

  // ---- asphalt ribbon (indexed quads -> flat tris with vertex colour) ---
  buildTrackRibbon() {
    const pts = this.track.pts, n = pts.length;
    const verts = [], cols = [];
    const asphalt = this.theme.asphalt;
    for (let i = 0; i <= n; i++) {
      const a = pts[i % n], bPrev = pts[(i - 1 + n) % n], bNext = pts[(i + 1) % n];
      let tx = bNext.x - bPrev.x, ty = bNext.y - bPrev.y;
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx; // left normal
      const hw = (a.w || 14) / 2;
      verts.push([a.x - nx * hw, 0.02, -(a.y - ny * hw)]);
      verts.push([a.x + nx * hw, 0.02, -(a.y + ny * hw)]);
      // subtle patchy tint along lap
      const t = 0.92 + 0.12 * Math.abs(Math.sin(i * 0.37));
      cols.push([asphalt[0] * t, asphalt[1] * t, asphalt[2] * t]);
      cols.push([asphalt[0] * t, asphalt[1] * t, asphalt[2] * t]);
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 3, k, k + 3, k + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts.flat(), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols.flat(), 3));
    g.setIndex(idx);
    g.computeVertexNormals(); // indexed quads: still flat per-tri thanks to Basic+flatShading? -> un-index for guaranteed facets
    const gf = g.toNonIndexed(); gf.computeVertexNormals();
    // copy colours (toNonIndexed preserves attribute order per-vertex)
    this.group.add(new THREE.Mesh(gf, MAT_VERT()));

    // white edge lines
    const lineV = [], lineC = [];
    const wcol = [0.92, 0.92, 0.9];
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i <= n; i++) {
        const a = pts[i % n], bp = pts[(i - 1 + n) % n], bn = pts[(i + 1) % n];
        let tx = bn.x - bp.x, ty = bn.y - bp.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const nx = -ty, ny = tx;
        const hw = (a.w || 14) / 2;
        const off = side * (hw - 0.5), inn = side * (hw - 1.1);
        lineV.push([a.x - nx * inn, 0.05, -(a.y - ny * inn)]);
        lineV.push([a.x - nx * off, 0.05, -(a.y - ny * off)]);
        lineC.push(wcol, wcol);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lineV.flat(), 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lineC.flat(), 3));
    const li = [];
    for (let pass = 0; pass < 2; pass++) {
      const base = pass * (n + 1) * 2;
      for (let i = 0; i < n; i++) { const k = base + i * 2; li.push(k, k + 1, k + 3, k, k + 3, k + 2); }
    }
    lg.setIndex(li);
    this.group.add(new THREE.Mesh(lg.toNonIndexed(), MAT_VERT({ transparent: true, opacity: 0.9 })));
    lg.toNonIndexed().computeVertexNormals();
  }

  // ---- red/white kerbs on high-curvature corners ------------------------
  buildKerbs() {
    const pts = this.track.pts, n = pts.length;
    const kerbA = this.theme.kerbA, kerbB = this.theme.kerbB;
    const V = [], C = [];
    let tri = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], bp = pts[(i - 2 + n) % n], bn = pts[(i + 2) % n];
      let tx = bn.x - bp.x, ty = bn.y - bp.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      // signed curvature
      const cross = tx * (bn.y - a.y) - ty * (bn.x - a.x);
      const curv = Math.atan2(cross, tl);
      if (Math.abs(curv) < 0.045) continue;
      const inside = curv > 0 ? 1 : -1; // turn direction sign
      const hw = (a.w || 14) / 2;
      const off = inside * (hw + 0.15), inn = inside * (hw - 1.4);
      const kk = [[a.x - nx * inn, 0.06, -(a.y - ny * inn)], [a.x - nx * off, 0.14, -(a.y - ny * off)]];
      const next = pts[(i + 1) % n];
      const k2 = [[next.x - nx * inn, 0.06, -(next.y - ny * inn)], [next.x - nx * off, 0.14, -(next.y - ny * off)]];
      V.push(kk[0], kk[1], k2[1], kk[0], k2[1], k2[0]);
      const col = (tri++ % 2 === 0) ? kerbA : kerbB;
      for (let q = 0; q < 6; q++) C.push(col);
    }
    if (!V.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(V.flat(), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C.flat(), 3));
    g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, MAT_VERT()));
  }

  buildStartLine() {
    const p = this.track.pts[0];
    const g = new THREE.BoxGeometry(p.w || 14, 0.06, 2.2);
    const m = new THREE.Mesh(flat(g), new THREE.MeshBasicMaterial({ color: 0xf4f4f4, flatShading: true }));
    // orient perpendicular to heading at index 0
    const q = this.track.pts[1];
    m.position.set(p.x, 0.05, -p.y);
    m.rotation.y = -Math.atan2(q.y - p.y, q.x - p.x);
    this.group.add(m);
  }

  // ---- barriers: alternating sponsor-coloured low blocks ---------------
  buildBarriers() {
    const pts = this.track.pts, n = pts.length;
    const cols = this.theme.barrier;
    const V = [], C = [];
    let tri = 0;
    for (let i = 0; i < n; i += 3) {
      const a = pts[i], bn = pts[(i + 3) % n], bp = pts[(i - 3 + n) % n];
      let tx = bn.x - bp.x, ty = bn.y - bp.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      const hw = (a.w || 14) / 2 + 4.5;
      for (const side of [-1, 1]) {
        const px = a.x + nx * hw * side, pz = -(a.y + ny * hw * side);
        const qx = bn.x + nx * hw * side, qz = -(bn.y + ny * hw * side);
        const col = cols[(tri >> 1) % cols.length];
        const y = 1.1;
        // two triangles for inward face + top strip
        V.push([px, 0, pz], [qx, 0, qz], [qx, y, qz], [px, 0, pz], [qx, y, qz], [px, y, pz]);
        for (let q2 = 0; q2 < 6; q2++) C.push(col);
        tri += 2;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(V.flat(), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C.flat(), 3));
    g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, MAT_VERT({ side: THREE.DoubleSide })));
  }

  buildCityWalls() {
    const pts = this.track.pts, n = pts.length;
    const V = [], C = [];
    let tri = 0;
    const pal = this.theme.wall;
    for (let i = 0; i < n; i += 4) {
      const a = pts[i], bn = pts[(i + 4) % n], bp = pts[(i - 4 + n) % n];
      let tx = bn.x - bp.x, ty = bn.y - bp.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      const hw = (a.w || 14) / 2 + 3;
      for (const side of [-1, 1]) {
        const hgt = 2.4 + (pal[(tri) % pal.length][3] || 0) * 2;
        const col = pal[tri % pal.length];
        const px = a.x + nx * hw * side, pz = -(a.y + ny * hw * side);
        const qx = bn.x + nx * hw * side, qz = -(bn.y + ny * hw * side);
        V.push([px, 0, pz], [qx, 0, qz], [qx, hgt, qz], [px, 0, pz], [qx, hgt, qz], [px, hgt, pz]);
        for (let q2 = 0; q2 < 6; q2++) C.push([col[0], col[1], col[2]]);
        tri++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(V.flat(), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C.flat(), 3));
    g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, MAT_VERT({ side: THREE.DoubleSide })));
  }

  // ---- grandstands, trees, floodlights, skyline boxes ------------------
  buildScenery() {
    const rand = this.rand;
    const pts = this.track.pts, n = pts.length;
    const addAt = (mesh, x, z, ry) => { mesh.position.set(x, mesh.userData.gy || 0, z); mesh.rotation.y = ry; this.group.add(mesh); };

    // grandstands at a few spots
    const standGeo = flat(new THREE.BoxGeometry(60, 12, 22));
    const standMat = new THREE.MeshBasicMaterial({ color: this.theme.stand, flatShading: true });
    for (let k = 0; k < 5; k++) {
      const i = Math.floor(rand() * n);
      const a = pts[i], bn = pts[(i + 4) % n], bp = pts[(i - 4 + n) % n];
      let tx = bn.x - bp.x, ty = bn.y - bp.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const hw = (a.w || 14) / 2 + 26;
      const side = rand() > 0.5 ? 1 : -1;
      const m = new THREE.Mesh(standGeo, standMat);
      m.userData.gy = 6;
      addAt(m, a.x - ty * hw * side, -(a.y + tx * hw * side), Math.atan2(ty, tx));
    }

    // low-poly trees (cone + trunk merged into one faceted mesh)
    if (!this.theme.street) {
      const canopy = flat(new THREE.ConeGeometry(3.2, 7, 5));
      canopy.translate(0, 6.2, 0);
      const trunk = flat(new THREE.CylinderGeometry(0.5, 0.7, 3.5, 4));
      trunk.translate(0, 1.7, 0);
      const canopyMat = new THREE.MeshBasicMaterial({ color: this.theme.tree, flatShading: true });
      const trunkMat = new THREE.MeshBasicMaterial({ color: 0x6b4a2f, flatShading: true });
      const count = 120;
      const canopyMesh = new THREE.InstancedMesh(canopy, canopyMat, count);
      const trunkMesh = new THREE.InstancedMesh(trunk, trunkMat, count);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
        let placed = 0;
      for (let t = 0; t < count * 3 && placed < count; t++) {
        const i = Math.floor(rand() * n);
        const a = pts[i];
        const ang = rand() * Math.PI * 2;
        const dist = (a.w || 14) / 2 + 18 + rand() * 120;
        const x = a.x + Math.cos(ang) * dist, z = -(a.y + Math.sin(ang) * dist);
        // keep out of other track corridor roughly
        pv.set(x, 0, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
        const s = 0.7 + rand() * 0.8; sc.set(s, s, s);
        mtx.compose(pv, q, sc); canopyMesh.setMatrixAt(placed, mtx);
        mtx.identity(); canopyMesh.setColorAt && null;
        pv.y = 0; mtx.compose(pv, q, sc); trunkMesh.setMatrixAt(placed, mtx);
        placed++;
      }
      canopyMesh.count = placed; trunkMesh.count = placed;
      this.group.add(canopyMesh, trunkMesh);
    } else {
      // street circuits: skyline blocks around the walls
      const box = flat(new THREE.BoxGeometry(1, 1, 1));
      const mat = new THREE.MeshBasicMaterial({ color: this.theme.sky_building, flatShading: true });
      const count = 90;
      const inst = new THREE.InstancedMesh(box, mat, count);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
      for (let t = 0; t < count; t++) {
        const i = Math.floor(rand() * n);
        const a = pts[i];
        const side = rand() > 0.5 ? 1 : -1;
        const dist = (a.w || 14) / 2 + 20 + rand() * 90;
        const h = 15 + rand() * 60;
        pv.set(a.x + (rand() - 0.5) * 20, h / 2, -(a.y + side * dist));
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 0.6);
        sc.set(14 + rand() * 26, h, 14 + rand() * 26);
        mtx.compose(pv, q, sc); inst.setMatrixAt(t, mtx);
      }
      this.group.add(inst);
    }

    // floodlights for night races
    if (this.theme.night) {
      const pole = flat(new THREE.BoxGeometry(0.6, 24, 0.6));
      const head = flat(new THREE.BoxGeometry(6, 1.6, 1.6));
      head.translate(0, 24, 0);
      const pm = new THREE.MeshBasicMaterial({ color: 0x555c66, flatShading: true });
      const hm = new THREE.MeshBasicMaterial({ color: 0xfff2c0, flatShading: true });
      for (let t = 0; t < 14; t++) {
        const i = Math.floor(rand() * n);
        const a = pts[i];
        const side = rand() > 0.5 ? 1 : -1;
        const hw = (a.w || 14) / 2 + 10;
        const g1 = new THREE.Mesh(pole, pm), g2 = new THREE.Mesh(head, hm);
        const x = a.x + side * hw * 0.4, z = -(a.y + side * hw);
        g1.position.set(x, 12, z); g2.position.set(x, 0, z);
        this.group.add(g1, g2);
      }
    }
  }

  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(2600, 12, 8),
      new THREE.MeshBasicMaterial({ color: this.theme.sky, side: THREE.BackSide, fog: false })
    );
    this.scene.add(sky);
    this.skyMesh = sky;
    // sun/moon billboard-ish low poly disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(this.theme.night ? 40 : 70, 8),
      new THREE.MeshBasicMaterial({ color: this.theme.night ? 0xdfe8ff : 0xffdf9e, fog: false })
    );
    disc.position.set(1400, 900, -1200);
    disc.lookAt(0, 0, 0);
    this.scene.add(disc);
    this.sunMesh = disc;
  }

  setWeatherTint(rainAmount) {
    // darken/desaturate sky with rain
    if (!this.skyMesh) return;
    const base = new THREE.Color(this.theme.sky);
    const grey = new THREE.Color(0x6a7280);
    this.skyMesh.material.color.copy(base).lerp(grey, clamp(rainAmount, 0, 1) * 0.85);
  }
}

// ---------------------------------------------------------------------
// Car visual: chunky low-poly F1 silhouette built from boxes/prisms.
// Wheels are separate meshes parented to steering/upright groups.
// ---------------------------------------------------------------------
export function buildCarMesh(bodyColor = 0xe10600) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshBasicMaterial({ color: bodyColor, flatShading: true });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x2a2d33, flatShading: true });
  const tyreMat = new THREE.MeshBasicMaterial({ color: 0x1c1c1e, flatShading: true });

  const mono = flat(new THREE.BoxGeometry(0.55, 0.45, 3.4));
  const mmesh = new THREE.Mesh(mono, bodyMat); mmesh.position.set(0, 0.55, 0.2); root.add(mmesh);

  const nose = flat(new THREE.BoxGeometry(0.35, 0.28, 1.4));
  const nm = new THREE.Mesh(nose, bodyMat); nm.position.set(0, 0.5, 2.3); root.add(nm);

  const sidepodL = flat(new THREE.BoxGeometry(0.75, 0.55, 1.9));
  for (const sgn of [-1, 1]) {
    const sp = new THREE.Mesh(sidepodL, bodyMat);
    sp.position.set(sgn * 0.78, 0.45, 0.1); root.add(sp);
  }

  const engineCover = flat(new THREE.ConeGeometry(0.5, 1.6, 4));
  engineCover.rotateX(-Math.PI / 2);
  const ec = new THREE.Mesh(engineCover, bodyMat); ec.position.set(0, 0.72, -0.9); root.add(ec);

  const halo = flat(new THREE.TorusGeometry(0.42, 0.05, 4, 8, Math.PI));
  const hm2 = new THREE.Mesh(halo, darkMat); hm2.rotation.x = Math.PI / 2; hm2.position.set(0, 1.0, 0.9); root.add(hm2);

  const floor = flat(new THREE.BoxGeometry(1.9, 0.1, 3.6));
  const fm = new THREE.Mesh(floor, darkMat); fm.position.set(0, 0.22, 0.1); root.add(fm);

  const wingF = flat(new THREE.BoxGeometry(1.7, 0.06, 0.4));
  const wf = new THREE.Mesh(wingF, bodyMat); wf.position.set(0, 0.9, 2.9); root.add(wf);
  const wingR = flat(new THREE.BoxGeometry(1.05, 0.5, 0.18));
  const wr = new THREE.Mesh(wingR, bodyMat); wr.position.set(0, 1.05, -1.7); root.add(wr);

  // wheels: [FL, FR, RL, RR]; front pivots in steer groups
  const wheelGeo = flat(new THREE.CylinderGeometry(0.36, 0.36, 0.38, 8));
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [], steerGroups = [];
  const offs = [[-0.92, 1.55], [0.92, 1.55], [-0.92, -1.4], [0.92, -1.4]];
  offs.forEach(([x, z], i) => {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.position.set(0, 0.36, 0);
    if (i < 2) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.36, z);
      pivot.add(w); w.position.set(0, 0, 0);
      root.add(pivot); steerGroups.push(pivot);
    } else {
      w.position.set(x, 0.36, z);
      root.add(w);
    }
    wheels.push(w);
  });
  root.userData.wheels = wheels;
  root.userData.steer = steerGroups;
  return root;
}

// ---------------------------------------------------------------------
// Particles: lock-up smoke (dry), water spray (wet), sparks-ish debris.
// Simple pooled Points system, no physics.
// ---------------------------------------------------------------------
export class ParticleFX {
  constructor(scene, max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.head = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const m = new THREE.PointsMaterial({ size: 1.4, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = g;
  }

  spawn(x, y, z, vx, vy, vz, r, gb, bb, lifeS = 1.2, size = 1.4) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = gb; this.col[i * 3 + 2] = bb;
    this.life[i] = lifeS; this.size[i] = size;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.life[i] -= dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] += 1.5 * dt; // smoke rises
      this.size[i] += dt * 1.8;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

// Rain: GPU-cheap instanced streaks recycled around the camera
export class RainFX {
  constructor(scene, count = 900) {
    this.count = count;
    const g = new THREE.BufferGeometry();
    this.arr = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) this.respawn(i, 0, 0, 0);
    g.setAttribute('position', new THREE.BufferAttribute(this.arr, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xaebfd6, transparent: true, opacity: 0.5 });
    this.lines = new THREE.LineSegments(g, m);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.active = 0;
    this.geo = g;
  }
  respawn(i, cx, cy, cz) {
    const k = i * 6;
    const x = cx + (Math.random() - 0.5) * 90;
    const z = cz + (Math.random() - 0.5) * 90;
    const y = cy + 20 + Math.random() * 40;
    this.arr[k] = x; this.arr[k + 1] = y; this.arr[k + 2] = z;
    this.arr[k + 3] = x + 0.4; this.arr[k + 4] = y - 1.6; this.arr[k + 5] = z;
  }
  update(dt, camPos, intensity) {
    this.lines.visible = intensity > 0.02;
    if (!this.lines.visible) return;
    const speed = 55 * dt;
    const n = Math.floor(this.count * intensity);
    for (let i = 0; i < this.count; i++) {
      const k = i * 6;
      if (i >= n) { this.arr[k + 1] = -9999; this.arr[k + 4] = -9999; continue; }
      this.arr[k + 1] -= speed; this.arr[k + 4] -= speed;
      if (this.arr[k + 1] < camPos.y - 6 || Math.abs(this.arr[k] - camPos.x) > 60 || Math.abs(this.arr[k + 2] - camPos.z) > 60) {
        this.respawn(i, camPos.x, camPos.y, camPos.z);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// Chase camera with speed-based FOV kick and shake on lock-ups
export class ChaseCamera {
  constructor(camera) {
    this.cam = camera;
    this.cx = 0; this.cy = 4; this.cz = 0;
    this.shake = 0;
    this.baseFov = 62;
  }
  follow(x, y, heading, speedKmh, dt, shakeAmt = 0) {
    // desired position behind car (heading CCW psi in x/y map -> z=-y)
    const back = 9.5 + speedKmh * 0.02;
    const up = 3.4 + speedKmh * 0.006;
    const tx = x - Math.cos(heading) * back;
    const tz = -y + Math.sin(heading) * back;
    const k = 1 - Math.exp(-dt * 5);
    this.cx += (tx - this.cx) * k;
    this.cz += (tz - this.cz) * k;
    this.cy += (up - this.cy) * k;
    this.shake = Math.max(this.shake * Math.exp(-dt * 4), shakeAmt);
    const sx = (Math.random() - 0.5) * this.shake * 0.5;
    const sy = (Math.random() - 0.5) * this.shake * 0.5;
    this.cam.position.set(this.cx + sx, this.cy + sy, this.cz);
    this.cam.lookAt(x, 1.2, -z);
    const fov = this.baseFov + clamp(speedKmh * 0.045, 0, 14);
    if (Math.abs(this.cam.fov - fov) > 0.1) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
  }
}

export function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.setSize(window.innerWidth, window.innerHeight, false);
  return r;
}
