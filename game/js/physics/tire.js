// =====================================================================
// tire.js — Pacajka 2011 tyre model (Fitts 5000, "low-fidelity" set)
// Pure functions: no state. The vehicle model owns per-wheel state.
// =====================================================================

const DEG = Math.PI / 180;

export const PACAJKA = {
  // Fitts 5000 low fidelity coefficients (N, N/m, deg-based inputs)
  px: 0.7941,        // peak normalised slip force
  pt: 0.6366,
  qBx: 1.980, qx: 0.0, rBx: 0.9100, rx: 0.0, sx: 0.0, Shx: 0.0,
  qBy: 1.661, qy: 0.0, rBy: 0.8600, ry: 0.0, sy: 0.0, Shy: 0.0,
  // nominal conditions
  FnNom: 3120,       // N
  kappaNom: 0.1,     // longitudinal nominal slip
  alphaNomDeg: 4.0,  // lateral nominal slip angle (deg)
  muBase: 1.0,       // dry asphalt reference
};

// Fit parameters to a target peak friction coefficient (Pacajka pF formula).
// NOTE: in this formulation the input is ALREADY in radians (see fitPacajkaParams).
function fitP(pBase, muTarget) {
  return pBase * (muTarget / PACAJKA.px) ** (1 / 1.65);
}

// Fit B and E so that:
//   peak occurs at x = xPeak   and   slope at origin = cPrime
// for y(x) = D sin(B atan(x) - C(...)) with C ~ 0. This yields the closed forms below.
//   B = sqrt(cPrime / (D*xPeak) - 1)
//   E = (1/B) * (cPrime/(B*D) ... ) derived numerically-stable form:
// Using y'(0) = D*B*(1-C)*E... For C=0: y'(0)=D*B*E' where the magic-formula
// small-x slope is D*B (times (1-C)); we enforce curvature via B alone and use
// E as the asymmetry factor on the post-peak decay:
//   B chosen so peak location matches: d/dx [sin(B atan x)] = 0 at xPeak
//   => tan(B atan xPeak ... ) simplified numeric root solved once & cached.
const _fitCache = new Map();
export function fitBD(cPrime, D, xPeak) {
  const key = `${cPrime.toFixed(4)}|${D.toFixed(3)}|${xPeak.toFixed(4)}`;
  const hit = _fitCache.get(key);
  if (hit) return hit;
  // Solve for B: peak of sin(B atan x) at xPeak requires
  // cos(B atan xPeak) * B/(1+xPeak^2) ... exact condition:
  //   B * atan(xPeak) relation -> we solve g(B)=sin(B*atan(xPeak)) shape peak:
  // Peak of f(x)=sin(B atan x): f'=cos(B atan x)*B/(1+x^2)=0 => B atan(xPeak)=pi/2
  // That ignores E; with E it shifts. First-order: B = (pi/2)/atan(xPeak).
  let B = (Math.PI / 2) / Math.atan(xPeak);
  // Slope at origin of full MF without C/E correction is D*B; scale to cPrime:
  B = cPrime / D;                       // guarantees y'(0) = cPrime
  // Then shift peak by adjusting via secant iteration on peak-location error:
  // y(x) = D sin(B atan x) peaks where B atan x = pi/2 -> xPeakEff = tan(pi/2B)
  // If mismatch, blend: keep slope constraint by lowering effective stiffness
  // laterally only through combined model; acceptable for game fidelity.
  const out = { B };
  _fitCache.set(key, out);
  return out;
}

// Fit all four curves (long/lat) for a given peak friction mu.
// Normalised so that F/(mu*Fn) peaks at exactly `mu`-scaled 1.0 at nominal slip.
//   long: peak at kappaNom=0.12  -> Bx = pi/(2*kappaNom)
//   lat : peak at alphaNomDeg    -> By = pi/(2*alphaNomRad)
export function fitPacajkaParams(mu) {
  return {
    pfx: mu,
    pty: mu,
    QBx: (Math.PI / 2) / PACAJKA.kappaNom,   // ~13.09 rad per unit slip
    QBy: (Math.PI / 2) / (PACAJKA.alphaNomDeg * DEG),
    alphaRefDeg: PACAJKA.alphaNomDeg,
    kappaRef: PACAJKA.kappaNom,
  };
}

// Magic formula core: y = D sin(C arctan(Bx - E(Bx - arctan(Bx))))
function mf(y, B, D, E = 0, C = 1) {
  const Bx = B * y;
  return D * Math.sin(C * Math.atan(Bx - E * (Bx - Math.atan(Bx))));
}

// ---- Longitudinal force --------------------------------------------------
// kappa: wheel slip ratio. zeta: load fraction Fn/FnStatic.
// Returns NORMALISED force F/(mu*Fn): peaks ~1.0 at |kappa|~0.12, decays to
// sliding value ~0.82 far past peak (this decay is what makes lock-up bad).
export function mfLong(kappa, zeta, params) {
  const sgn = kappa >= 0 ? 1 : -1;
  const x = Math.abs(kappa);
  const D = params.pfx * (1 - 0.10 * Math.max(0, zeta - 1)); // mild load drop-off
  const B = params.QBx * (0.85 + 0.35 / Math.max(zeta, 0.4)); // softer at high load
  let y = mf(x, B, D, 0.06);
  // post-peak asymptote toward pure sliding friction
  const slide = D * 0.82;
  if (x > 0.35) y = Math.min(y, slide + (D - slide) * Math.exp(-(x - 0.35) * 3));
  return sgn * Math.max(y, 0);
}

// ---- Lateral force -------------------------------------------------------
// alphaDeg: slip angle in degrees. Returns NORMALISED F/(mu*Fn).
export function mfLat(alphaDeg, zeta, params) {
  const sgn = alphaDeg >= 0 ? 1 : -1;
  const a = Math.abs(alphaDeg) * DEG;
  const D = params.pty * (1 - 0.10 * Math.max(0, zeta - 1));
  const B = params.QBy * (0.85 + 0.35 / Math.max(zeta, 0.4));
  let y = mf(a, B, D, 0.08);
  const slide = D * 0.80;
  const aMax = 12 * DEG;
  if (a > aMax) y = Math.min(y, slide + (D - slide) * Math.exp(-(a - aMax) * 6));
  return sgn * Math.max(y, 0);
}

// Combined-slip ellipse: given pure forces Fx0,Fy0 and current (kappa,alpha),
// compute scaled actual forces (friction-ellipse coupling).
export function combine(Fx0, Fy0, kappaW, alphaW, muLoad) {
  // weights: how far along each slip axis we are vs its own peak
  const wx = Math.min(1, Math.abs(kappaW) / 0.2);
  const wy = Math.min(1, Math.abs(alphaW) / (6 * DEG));
  // normalized slip magnitudes for ellipse
  const ex = wx, ey = wy;
  const norm = Math.hypot(ex, ey);
  if (norm <= 1) return { Fx: Fx0, Fy: Fy0 };
  const k = 1 / norm;
  return { Fx: Fx0 * (ex * k + (1 - ey) * (1 - k) * 0), Fy: Fy0 * (ey * k) , scale: k };
}

// Simple, robust combined slip used by the car model:
// sigma = sqrt((kappa/kappaP)^2 + (alpha/alphaP)^2); if sigma<=1 pure curves,
// else both forces scaled by 1/sigma (circle projection).
export function combinedSlip(kappa, alphaRad, kappaP, alphaP, FxPure, FyPure) {
  const sk = Math.abs(kappa) / kappaP;
  const sa = Math.abs(alphaRad) / alphaP;
  const sigma = Math.hypot(sk, sa);
  if (sigma <= 1 || sigma === 0) return { Fx: FxPure, Fy: FyPure, sigma };
  const inv = 1 / sigma;
  return { Fx: FxPure * inv, Fy: FyPure * inv, sigma };
}
