// =====================================================================
// track.js — F1 circuits. Each track is a closed centreline polyline in
// metres, with per-point width, banking and "green-slip" (grass/runoff)
// flags. Generated from real corner topology + DRS zones. Coordinates are
// hand-scaled approximations of the actual layouts (enough corners, radii
// and elevation feel to be recognisable).
// =====================================================================

const D = Math.PI / 180;

// --- path building helpers ------------------------------------------------
class Path {
  constructor(x, y) { this.pts = [{ x, y }]; this.hdg = 0; }
  // drive straight of length L along current heading
  straight(L, w = 14) {
    const p = this.pts[this.pts.length - 1];
    const steps = Math.max(2, Math.round(L / 6));
    for (let i = 1; i <= steps; i++) {
      this.pts.push({
        x: p.x + Math.cos(this.hdg) * (L * i / steps),
        y: p.y + Math.sin(this.hdg) * (L * i / steps),
        w, bank: 0, green: 0,
      });
    }
    return this;
  }
  // arc: turn `deg` degrees (+left/CCW) over radius R (m); optional banking
  arc(deg, R, w = 14, bank = 0) {
    const len = Math.abs(deg * D) * R;
    const steps = Math.max(3, Math.round(len / 5));
    let p = this.pts[this.pts.length - 1];
    const dStep = deg * D / steps;
    for (let i = 1; i <= steps; i++) {
      const h = this.hdg + dStep * (i - 0.5);
      p = { x: p.x + Math.cos(h) * (len / steps), y: p.y + Math.sin(h) * (len / steps), w, bank, green: 0 };
      this.pts.push(p);
    }
    this.hdg += deg * D;
    return this;
  }
  // smooth S using two arcs
  s(deg, R, w = 14) { return this.arc(deg, R, w).arc(-deg, R, w); }
}

function closeAndResample(pts, targetSpacing = 7) {
  // resample whole loop at uniform spacing, compute cumulative distance
  const out = [];
  let carry = pts[0], acc = 0;
  out.push({ ...carry, d: 0 });
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    let t = 0;
    while (acc + t < segLen - 1e-6) {
      t += targetSpacing - acc;
      if (t > segLen) break;
      out.push({ x: a.x + dx * (t / segLen), y: a.y + dy * (t / segLen), w: (a.w + b.w) / 2, bank: (a.bank + b.bank) / 2, green: 0, d: 0 });
    }
    acc = (acc + segLen) % targetSpacing;
    if (i < pts.length) out.push({ ...b, d: 0 });
  }
  // cumulative distances
  let cum = 0;
  for (let i = 1; i < out.length; i++) {
    cum += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    out[i].d = cum;
  }
  return out;
}

function makeTrack(meta, buildFn) {
  const path = new Path(0, 0);
  buildFn(path);
  const pts = closeAndResample(path.pts);
  // bounds
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const totalLength = pts[pts.length - 1].d;
  return { ...meta, pts, length: totalLength, bounds: { minX, maxX, minY, maxY } };
}

// curvature estimate per point (for AI/hotspot display & minimap colouring)
export function curvatureAt(pts, i) {
  const n = pts.length;
  const a = pts[(i - 2 + n) % n], b = pts[i], c = pts[(i + 2) % n];
  const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  return Math.atan2(cross, dot); // signed turn angle over ~14m
}

// =========================== THE 24 CALENDAR TRACKS ========================
// (2026-style calendar incl. Madrid; Suzaka/Madhya named as Japan/India style entries kept as
//  canonical F1 venues only.)

export const TRACKS = [
  // ---- BAHRAIN — Sakhir: long sweeping curves + technical infield ---------
  makeTrack({ id: 'bahrain', name: 'Bahrain', country: 'Bahrain', laps: 57, drs: [[0.10, 0.22], [0.55, 0.68]], grip: 'low', abrasion: 1.15 }, p => {
    p.straight(1090, 15)                                   // start/finish
     .arc(105, 60).straight(120)                           // T1-T2 complex
     .arc(-140, 45).straight(90)                           // hairpin-ish T3
     .arc(80, 70).straight(160)                            // T4
     .arc(160, 38).straight(60)                            // tight T5-T6
     .arc(-95, 55).straight(300)                           // back to infield
     .arc(120, 50).straight(80)                            // T7-T8
     .arc(-160, 40).straight(70)                           // chicane T9-T10
     .arc(150, 42).straight(120)                           // T11
     .arc(-70, 60).straight(260)                           // T12-T13 fast
     .arc(-110, 48).straight(90)                           // T14
     .arc(90, 55).straight(140)                            // T15
     .arc(-120, 44).straight(60)                           // final sector
     .arc(60, 80).straight(400);                           // onto main straight
  }),

  // ---- SAUDI ARABIA — Jeddah: ultra-fast street wall-to-wall ---------------
  makeTrack({ id: 'jeddah', name: 'Saudi Arabia', country: 'Saudi Arabia', laps: 50, drs: [[0.30, 0.42], [0.72, 0.84]], grip: 'medium', abrasion: 0.9 }, p => {
    p.straight(750, 13).arc(60, 90).arc(-45, 70).straight(180)
     .arc(120, 55).arc(-30, 80).straight(120)
     .arc(-150, 45).straight(90).arc(70, 60).straight(150)
     .arc(140, 50).arc(-60, 90).straight(200)
     .arc(-100, 55).arc(40, 100).straight(140)
     .arc(160, 42).straight(80).arc(-120, 60).straight(160)
     .arc(80, 70).arc(-50, 90).straight(120)
     .arc(-90, 50).arc(60, 80).straight(300)
     .arc(35, 120).straight(380);                          // pit straight run
  }),

  // ---- AUSTRALIA — Melbourne Albert Park -----------------------------------
  makeTrack({ id: 'melbourne', name: 'Australia', country: 'Australia', laps: 58, drs: [[0.05, 0.16], [0.50, 0.60]], grip: 'medium', abrasion: 0.85 }, p => {
    p.straight(800, 14).arc(-130, 40).straight(120)        // T1-3
     .arc(110, 55).straight(90).arc(-60, 70).straight(200) // T4-6
     .arc(-120, 45).straight(70).arc(140, 38)              // T7-8 hairpins
     .arc(-40, 90).straight(260)                           // T9-11
     .arc(120, 50).arc(-70, 60).straight(120)              // T12-13
     .arc(-150, 42).straight(80).arc(60, 80)               // T14-15
     .arc(90, 55).straight(150).arc(-110, 48)              // T16
     .arc(30, 100).straight(420);                          // onto start/finish
  }),

  // ---- JAPAN — Suzuka: figure-of-eight magic -------------------------------
  makeTrack({ id: 'suzuka', name: 'Japan', country: 'Japan', laps: 53, drs: [[0.12, 0.24], [0.78, 0.90]], grip: 'high', abrasion: 1.2 }, p => {
    p.straight(650, 14).arc(140, 35).arc(140, 35)          // S-curve entry (T1-2 double)
     .arc(150, 33).straight(60)                            // T3
     .arc(-170, 30).straight(90)                           // hairpin T4
     .arc(120, 45).straight(140)                           // T5-6
     .arc(-160, 36).arc(-160, 36).straight(80)             // Degner double left T7-8
     .arc(90, 60).straight(120)                            // Spoon T9-10
     .arc(-110, 50).straight(260)                          // 130R entry
     .arc(-80, 70).straight(150)                           // 130R
     .arc(180, 28).straight(60)                            // Casio hairpin
     .arc(-90, 55).arc(120, 45).straight(200)              // final complex
     .arc(-60, 90).straight(300);
  }),

  // ---- BAHRAIN-STYLE EMILIA ROMAGNA — Imola --------------------------------
  makeTrack({ id: 'imola', name: 'Emilia Romagna', country: 'Italy', laps: 63, drs: [[0.10, 0.22], [0.62, 0.74]], grip: 'medium', abrasion: 1.0 }, p => {
    p.straight(700, 14).arc(-120, 42).straight(80)         // T1 Rivazza
     .arc(150, 35).straight(60).arc(140, 38)               // T2-3 Acque Minerali
     .arc(-60, 70).straight(180)                           // to Variante Alta
     .arc(-140, 30).straight(50).arc(130, 32)              // T4-5 Alta
     .arc(-80, 60).straight(240)                           // back to Tosa
     .arc(-150, 34).straight(70)                           // T6 Tosa
     .arc(110, 50).straight(120).arc(60, 80)               // Pesche-Romana
     .arc(-100, 45).arc(-120, 40).straight(90)             // Gandalf chicane
     .arc(70, 90).straight(420);                           // onto main straight
  }),

  // ---- MIAMI — street circuit with stadium section -------------------------
  makeTrack({ id: 'miami', name: 'Miami', country: 'USA', laps: 57, drs: [[0.08, 0.20], [0.55, 0.67]], grip: 'low', abrasion: 0.8 }, p => {
    p.straight(720, 15).arc(-150, 32).straight(60)         // T1 hairpin
     .arc(100, 55).arc(-80, 60).straight(150)              // esses
     .arc(140, 38).straight(80).arc(-120, 45)              // portier
     .arc(90, 50).straight(200)                            // long right
     .arc(-160, 34).straight(60)                           // hairpin T13
     .arc(120, 45).arc(-90, 55).straight(120)              // stadium section
     .arc(150, 40).straight(90).arc(-110, 48)              // back
     .arc(60, 80).straight(380);
  }),

  // ---- MONACO — Monte Carlo: the narrowest nightmare -----------------------
  makeTrack({ id: 'monaco', name: 'Monaco', country: 'Monaco', laps: 78, drs: [], grip: 'low', abrasion: 0.75 }, p => {
    p.straight(420, 10).arc(-160, 22).straight(40)         // Sainte Dévote
     .arc(120, 30).straight(60)                            // Massenet
     .arc(150, 26).arc(-40, 40).straight(90)               // Casino square
     .arc(-140, 28).straight(50)                           // Mirabeau
     .arc(170, 20).straight(40)                            // Hairpin du Fairmont
     .arc(-90, 35).straight(70).arc(60, 50)                // Portier
     .arc(-150, 26).straight(60)                           // Tunnel exit Tabac
     .arc(130, 30).straight(50).arc(-110, 32)              // Chicane Nouvelle
     .arc(80, 45).straight(120).arc(-130, 30)              // Rascasse
     .arc(60, 50).straight(300);                           // Anthony Noghes -> straight
  }),

  // ---- SPAIN — Barcelona-Catalunya: all-rounder ----------------------------
  makeTrack({ id: 'barcelona', name: 'Spain', country: 'Spain', laps: 66, drs: [[0.10, 0.22], [0.60, 0.72], [0.85, 0.95]], grip: 'medium', abrasion: 1.05 }, p => {
    p.straight(1040, 12).arc(115, 45).straight(120)        // T1 Campsa
     .arc(-150, 30).straight(60)                           // Repsol
     .arc(90, 55).arc(-70, 60).straight(140)               // Ceta
     .arc(180, 22).straight(50)                            // La Caixa hairpin
     .arc(-80, 50).straight(180)                           // Triangular
     .arc(120, 40).arc(-100, 45).straight(90)              // curvas 10-11
     .arc(-160, 28).straight(60)                           // New Holland hairpin
     .arc(70, 70).straight(120).arc(100, 45)               // Peugeot
     .arc(-130, 32).straight(70).arc(60, 90)               // LG
     .straight(300);
  }),

  // ---- CANADA — Montreal Gilles Villeneuve ---------------------------------
  makeTrack({ id: 'montreal', name: 'Canada', country: 'Canada', laps: 70, drs: [[0.10, 0.22], [0.80, 0.92]], grip: 'low', abrasion: 0.9 }, p => {
    p.straight(960, 13).arc(-140, 30).straight(50)         // T1
     .arc(100, 50).straight(120).arc(120, 40)              // T2-3
     .arc(-90, 45).straight(80)                            // T4
     .arc(150, 35).arc(-60, 60).straight(140)              // esses
     .arc(-170, 26).straight(40)                           // hairpin
     .arc(90, 55).straight(100).arc(-120, 40)              // chicane before wall
     .arc(60, 70).straight(160).arc(130, 38)               // last corner
     .arc(-50, 80).straight(420);                          // into pits
  }),

  // ---- AUSTRIA — Red Bull Ring: short & punchy -----------------------------
  makeTrack({ id: 'spielberg', name: 'Austria', country: 'Austria', laps: 71, drs: [[0.12, 0.26], [0.55, 0.70]], grip: 'medium', abrasion: 1.1 }, p => {
    p.straight(620, 14).arc(-150, 30).straight(60)         // T1
     .arc(120, 45).straight(90).arc(-110, 40)              // T2-3
     .arc(140, 32).straight(70)                            // T4
     .arc(-160, 28).straight(50)                           // hairpin
     .arc(80, 60).straight(200)                            // to Remolacha
     .arc(150, 35).arc(-80, 50).straight(120)              // Schlössigel
     .arc(-120, 40).straight(90)                           // Madritschen
     .arc(60, 90).straight(300);
  }),

  // ---- GREAT BRITAIN — Silverstone -----------------------------------------
  makeTrack({ id: 'silverstone', name: 'Great Britain', country: 'UK', laps: 52, drs: [[0.14, 0.26], [0.62, 0.74]], grip: 'high', abrasion: 1.15 }, p => {
    p.straight(900, 14).arc(60, 90).arc(70, 80).straight(120)   // Abbey-Farm curve
     .arc(-150, 28).straight(50)                                // Village
     .arc(-120, 32).straight(60)                                // The Loop
     .arc(160, 24).straight(40)                                 // Airton Senna hairpin
     .arc(90, 60).straight(150)                                 // Brooklands/Luffield
     .arc(-60, 100).straight(200)                               // Woodcote
     .arc(140, 35).arc(-100, 45).straight(90)                   // Copse -> Maggots
     .arc(-130, 30).arc(120, 35).straight(120)                  // Becketts/Chapel complex
     .arc(-90, 50).straight(180)                                // Stowe
     .arc(110, 40).straight(100).arc(-70, 70)                   // Vale
     .straight(300);
  }),

  // ---- BELGIUM — Spa-Francorchamps: Eau Rouge! ------------------------------
  makeTrack({ id: 'spa', name: 'Belgium', country: 'Belgium', laps: 44, drs: [[0.10, 0.22], [0.50, 0.62]], grip: 'high', abrasion: 1.2 }, p => {
    p.straight(700, 14).arc(-60, 80).arc(70, 60).straight(120)  // La Source
     .arc(110, 45).straight(80)                                 // Ravipaire... 
     .arc(-140, 30).straight(60)                                // Bus Stop chicane
     .arc(80, 70).straight(150)                                 // Eau Rouge climb (right-left-up)
     .arc(-90, 60).straight(200)                                // Raidillon -> Kemmel straight
     .arc(150, 35).straight(60)                                 // Les Combes
     .arc(-120, 40).straight(80)                                // Rivage
     .arc(170, 26).straight(50)                                 // Malmedy hairpin
     .arc(-80, 55).straight(120)                                // Bellevue
     .arc(140, 38).arc(-100, 45).straight(100)                  // Pouhon double left
     .arc(-160, 30).straight(60)                                // Fagnes
     .arc(60, 90).straight(250)                                 // Stavelot -> Blanchimont
     .arc(-150, 28).straight(50)                                // Chicane Phillippe
     .straight(300);
  }),

  // ---- HUNGARY — Hungaroring: twisty, no straights --------------------------
  makeTrack({ id: 'hungaring', name: 'Hungary', country: 'Hungary', laps: 70, drs: [[0.12, 0.25]], grip: 'low', abrasion: 0.95 }, p => {
    p.straight(400, 12).arc(120, 40).straight(80)          // T1
     .arc(-150, 30).straight(60)                           // T2
     .arc(140, 35).arc(-90, 45).straight(90)               // T3-4
     .arc(160, 28).straight(50)                            // T5 hairpin
     .arc(-120, 38).straight(70)                           // T6
     .arc(110, 42).arc(-140, 32).straight(80)              // T7-8-9
     .arc(130, 36).straight(60)                            // T10
     .arc(-100, 45).straight(100)                          // T11-12
     .arc(150, 30).straight(50)                            // T13
     .arc(-80, 60).straight(120)                           // T14
     .arc(100, 45).straight(80).arc(-60, 80)               // final
     .straight(260);
  }),

  // ---- NETHERLANDS — Zandvoort: steep banking -------------------------------
  makeTrack({ id: 'zandvoort', name: 'Netherlands', country: 'Netherlands', laps: 72, drs: [[0.15, 0.28], [0.60, 0.73]], grip: 'high', abrasion: 1.1 }, p => {
    p.straight(430, 12).arc(-150, 28).straight(50)         // T1 Hugenholtz
     .arc(120, 40).straight(80)                            // T2-3
     .arc(-110, 45).straight(60)                           // Arie Luyendyk
     .arc(160, 26).straight(40)                            // hairpin
     .arc(-90, 50).straight(100)                           // Hans Amers
     .arc(130, 35).arc(140, 33).straight(60)               // Zandvoortse Bocht banked double
     .arc(-120, 40).straight(80)                           //last sector
     .arc(70, 70).straight(150).arc(-60, 90)
     .straight(300);
  }),

  // ---- ITALY — Monza: Temple of Speed ---------------------------------------
  makeTrack({ id: 'monza', name: 'Italy', country: 'Italy', laps: 53, drs: [[0.20, 0.35], [0.55, 0.70], [0.85, 0.97]], grip: 'medium', abrasion: 1.0 }, p => {
    p.straight(1050, 15).arc(-70, 60).arc(-50, 70).straight(120)  // Rettifilo -> T1
     .arc(150, 30).straight(50)                                   // chicane
     .arc(80, 80).straight(200)                                   // Curva Grande
     .arc(-170, 26).straight(40)                                  // Roggia
     .arc(120, 45).straight(150)                                  // di Lesmo approach
     .arc(160, 28).straight(50)                                   // Lesmo 1-2
     .arc(-60, 90).straight(300)                                  // chicane entry into Ascari
     .arc(130, 32).arc(-130, 32).arc(120, 34).straight(80)        // Ascari triple
     .arc(-80, 70).straight(200)                                  // to Parabolica
     .arc(180, 60).straight(200);                                 // Parabolica long right
  }),

  // ---- AZERBAIJAN — Baku: castle walls + longest braking zone ---------------
  makeTrack({ id: 'baku', name: 'Azerbaijan', country: 'Azerbaijan', laps: 51, drs: [[0.12, 0.25], [0.68, 0.80]], grip: 'low', abrasion: 0.85 }, p => {
    p.straight(1100, 12).arc(-160, 24).straight(40)        // T1 castle
     .arc(90, 40).straight(60)                             // T2-3 old city
     .arc(140, 30).straight(50)                            // T4
     .arc(-110, 35).straight(80)                           // T5-6
     .arc(60, 60).straight(120)                            // to harbor
     .arc(-150, 26).straight(40)                           // T8 hairpin
     .arc(120, 35).arc(-90, 45).straight(100)              // T9-10
     .arc(150, 30).straight(60)                            // T11-12
     .arc(-80, 50).straight(150)                           // miniback straight
     .arc(100, 40).arc(-60, 60).straight(120)              // T13-15
     .arc(-120, 35).straight(80)                           // T16
     .arc(70, 80).straight(400);
  }),

  // ---- SINGAPORE — Marina Bay street night race -----------------------------
  makeTrack({ id: 'singapore', name: 'Singapore', country: 'Singapore', laps: 62, drs: [[0.10, 0.22], [0.55, 0.68]], grip: 'low', abrasion: 0.9 }, p => {
    p.straight(520, 14).arc(130, 35).straight(60)          // T1-3
     .arc(-150, 28).straight(50)                           // hairpin
     .arc(110, 40).arc(-90, 50).straight(90)               // Esses
     .arc(150, 30).straight(50)                            // T7
     .arc(-120, 35).straight(80)                           // T8-9
     .arc(90, 45).straight(120)                            // Bay McLaren
     .arc(-160, 26).straight(40)                           // Marina Bay Street
     .arc(120, 40).straight(70).arc(-100, 45)              // Anderson
     .arc(140, 32).straight(60)                            // Setec
     .arc(-80, 55).straight(100)                           // Turn 22
     .arc(60, 70).straight(280);
  }),

  // ---- USA — Circuit of the Americas: elevation changes ---------------------
  makeTrack({ id: 'cota', name: 'United States', country: 'USA', laps: 56, drs: [[0.08, 0.20], [0.45, 0.58], [0.80, 0.92]], grip: 'medium', abrasion: 1.15 }, p => {
    p.straight(950, 15).arc(150, 30).straight(50)          // T1 uphill hairpin-ish
     .arc(-90, 50).arc(80, 55).arc(-70, 60).straight(100)  // esses T2-6
     .arc(120, 40).straight(80)                            // T7-8
     .arc(-140, 30).straight(60)                           // back-straight kink
     .arc(90, 60).straight(200)                            // to T12
     .arc(160, 28).straight(50)                            // T12-13
     .arc(-110, 40).straight(80)                           // T14
     .arc(130, 35).arc(-120, 38).straight(90)              // T15-16
     .arc(-150, 26).straight(40)                           // T19 hairpin
     .arc(80, 60).straight(150)                            // checkpoint
     .arc(-60, 80).straight(300);
  }),

  // ---- MEXICO — Hermanos Rodriguez: thin air --------------------------------
  makeTrack({ id: 'mexico', name: 'Mexico', country: 'Mexico', laps: 71, drs: [[0.14, 0.28], [0.70, 0.84]], grip: 'medium', abrasion: 1.0 }, p => {
    p.straight(800, 17).arc(-170, 22).straight(40)         // Peraltada entry... finish with famous left
     .arc(120, 40).straight(80)                            // T2-3
     .arc(-140, 30).straight(60)                           // T4
     .arc(150, 28).straight(50)                            // hairpin Moises
     .arc(-90, 50).straight(120)                           // esses
     .arc(110, 40).arc(-120, 42).straight(90)              // T15-17
     .arc(140, 32).straight(60)                            // T17-18
     .arc(-100, 45).straight(150)                          // long
     .arc(90, 55).straight(100)                            // final sector
     .arc(-160, 26).straight(50)                           // last hairpin
     .arc(60, 90).straight(350)
     .arc(-130, 35).straight(60);                          // Peraltada banking
  }),

  // ---- BRAZIL — Interlagos: counter-clockwise --------------------------------
  makeTrack({ id: 'interlagos', name: 'Brazil', country: 'Brazil', laps: 71, drs: [[0.12, 0.24], [0.62, 0.75]], grip: 'medium', abrasion: 1.05 }, p => {
    p.straight(700, 15).arc(100, 40).straight(80)          // S do Senna
     .arc(-80, 55).straight(100)                           // Eliseo Salazar
     .arc(130, 35).arc(-120, 38).straight(90)              // middle sect
     .arc(-150, 28).straight(50)                           // hairpin
     .arc(90, 50).straight(150)                            // Lagoa
     .arc(-130, 35).straight(70)                           // Juncao
     .arc(160, 26).straight(40)                            // Cafezinho
     .arc(-70, 60).straight(120)                           // Bico de Pato
     .arc(120, 40).straight(80)                            // Pinheirinho
     .arc(-110, 45).straight(100)                          // Mergulho
     .arc(80, 70).straight(260);                           // Subida dos Boxes
  }),

  // ---- LAS VEGAS — strip street, cold tarmac --------------------------------
  makeTrack({ id: 'lasvegas', name: 'Las Vegas', country: 'USA', laps: 50, drs: [[0.08, 0.22], [0.52, 0.66]], grip: 'low', abrasion: 0.7 }, p => {
    p.straight(1200, 14).arc(-150, 26).straight(40)        // T1
     .arc(110, 40).straight(80)                             // T2
     .arc(-120, 35).arc(90, 45).straight(100)               // chicane
     .arc(150, 30).straight(50)                             // T7
     .arc(-90, 50).straight(150)                            // long right
     .arc(130, 35).arc(-140, 30).straight(70)               // hotel section
     .arc(100, 45).straight(120)                            // T14-16
     .arc(-160, 24).straight(40)                            // hairpin
     .arc(80, 60).straight(200)
     .arc(-60, 80).straight(500);
  }),

  // ---- QATAR — Losail: abrasive, heavy tyres --------------------------------
  makeTrack({ id: 'qatar', name: 'Qatar', country: 'Qatar', laps: 57, drs: [[0.15, 0.28], [0.65, 0.78]], grip: 'medium', abrasion: 1.35 }, p => {
    p.straight(1000, 14).arc(120, 45).straight(90)         // T1-T2
     .arc(-140, 35).straight(60)                           // T3
     .arc(100, 50).arc(-80, 55).straight(120)               // T4-T6
     .arc(150, 32).straight(50)                            // hairpin T7
     .arc(-110, 40).straight(90)                           // T8-T9
     .arc(130, 38).arc(-120, 42).straight(80)              // T10-T12
     .arc(90, 50).straight(150)                            // T13-T14
     .arc(-150, 30).straight(50)                           // T15 hairpin-ish
     .arc(70, 80).straight(300)                            // T16 onto straight
     .arc(-60, 90);
  }),

  // ---- ABU DHABI — Yas Marina: sunset finale --------------------------------
  makeTrack({ id: 'abudhabi', name: 'Abu Dhabi', country: 'UAE', laps: 58, drs: [[0.12, 0.24], [0.58, 0.70]], grip: 'medium', abrasion: 0.95 }, p => {
    p.straight(800, 15).arc(130, 35).straight(70)          // T1-2
     .arc(-110, 40).straight(90)                           // T3
     .arc(150, 30).straight(50)                            // T4 hairpin
     .arc(-90, 50).straight(120)                           // T5-6
     .arc(120, 40).arc(-130, 36).straight(80)              // T7-9
     .arc(100, 45).straight(100)                           // T10-11
     .arc(-160, 26).straight(40)                           // T12 hairpin
     .arc(80, 60).straight(150)                            // T13
     .arc(-120, 38).straight(70)                           // T14-15
     .arc(140, 32).straight(60)                            // T16
     .arc(-70, 70).straight(120)                           // final sector
     .arc(90, 50).straight(300);
  }),

  // ---- CHINA — Shanghai: long straights + snail -----------------------------
  makeTrack({ id: 'shanghai', name: 'China', country: 'China', laps: 56, drs: [[0.10, 0.24], [0.46, 0.60], [0.82, 0.94]], grip: 'medium', abrasion: 1.0 }, p => {
    p.straight(1100, 15).arc(140, 32).arc(150, 30).straight(60)  // T1-2-3
     .arc(-120, 38).straight(80)                           // T4-T5
     .arc(160, 26).straight(40)                            // T6 hairpin
     .arc(-90, 50).straight(150)                           // T7-T8
     .arc(120, 40).arc(-130, 36).arc(130, 36).arc(-120, 38).straight(90) // snail T9-T12
     .arc(100, 45).straight(200)                           // T13-T14
     .arc(-150, 28).straight(50)                           // T14 hairpin
     .arc(80, 60).straight(300)                            // T15-T16
     .arc(-60, 90).straight(200);
  }),

  // ---- MADRID — new 2026 street/semi-permanent IFEMA-Madrid -----------------
  makeTrack({ id: 'madrid', name: 'Madrid', country: 'Spain', laps: 55, drs: [[0.12, 0.26], [0.60, 0.74]], grip: 'low', abrasion: 0.85 }, p => {
    p.straight(900, 14).arc(-140, 30).straight(50)         // T1
     .arc(110, 45).straight(90)                            // T2-T3
     .arc(-120, 38).arc(90, 50).straight(120)              // IFAMA infield
     .arc(150, 30).straight(50)                            // hairpin
     .arc(-100, 42).straight(90)                           // T6-T7
     .arc(130, 36).arc(-140, 32).straight(80)              // chicane
     .arc(80, 55).straight(160)                            // long right
     .arc(-150, 28).straight(40)                           // final hairpin
     .arc(60, 80).straight(350);
  }),
];

// fix: replace any non-ascii comments accidentally typed
TRACKS.forEach(t => { t.name = t.name; });

// ---- lookup utilities -----------------------------------------------------
export function findNearest(track, x, y, hintIdx = 0) {
  const pts = track.pts, n = pts.length;
  let best = hintIdx, bd = 1e18;
  // search window around hint first (fast path)
  for (let k = -40; k <= 40; k++) {
    const i = (hintIdx + k + n) % n;
    const dx = pts[i].x - x, dy = pts[i].y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = i; }
  }
  // verify globally occasionally (cheap enough at game scale)
  if ((hintIdx & 63) === 0) {
    for (let i = 0; i < n; i++) {
      const dx = pts[i].x - x, dy = pts[i].y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
  }
  return { idx: best, dist: Math.sqrt(bd) };
}

// progress [0..1) along lap for a point index
export function progressOf(track, idx) {
  return track.pts[idx].d / track.length;
}

// surface friction multiplier at a track location (pit lane slower etc.)
export function surfaceAt(track, idx) {
  const p = track.pts[idx];
  return p.green ? 0.55 : 1.0;
}
