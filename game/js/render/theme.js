// =====================================================================
// theme.js — per-track low-poly palettes. street/night flags drive the
// scenery generator in lowpoly.js.
// =====================================================================

const C = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

const base = {
  asphalt: C(0x3b3f45), ground: C(0x6fae5c), kerbA: C(0xe03a3a), kerbB: C(0xf2f2f2),
  barrier: [C(0xd9d9de), C(0x1c4f9c), C(0xc0392b), C(0xf2b134)],
  stand: 0x8a94a6, tree: 0x3e7d3a, sky: 0x8ec9ff, night: false, street: false,
};

export const THEMES = {
  bahrain:    { ...base, ground: C(0xb99a63), tree: 0x8a7a4a, sky: 0x9fc4e8 },
  jeddah:     { ...base, street: true, night: true, sky: 0x141a2e, sky_building: 0x2a3350, wall: [C(0x2f3a5c), C(0x38466e)], asphalt: C(0x2e3138) },
  melbourne:  { ...base, ground: C(0x7db35e) },
  suzuka:     { ...base, ground: C(0x6da86a) },
  imola:      { ...base, ground: C(0x79a85f), tree: 0x466b3a },
  miami:      { ...base, street: true, sky: 0x7fd0ff, wall: [C(0x9aa7b5), C(0xb8c4cf)], sky_building: 0xa7b6c4, ground: C(0x86b7a0) },
  monaco:     { ...base, street: true, sky: 0x8fd2ff, wall: [C(0xcfd6dd), C(0xe3e8ee)], sky_building: 0xdfe6ee, ground: C(0x7fb069) },
  barcelona:  { ...base, ground: C(0xa8a06a), tree: 0x5d7a3f },
  montreal:   { ...base, ground: C(0x63a05a) },
  spielberg:  { ...base, ground: C(0x74b05a), tree: 0x2f6d33 },
  silverstone:{ ...base, ground: C(0x77b26b), sky: 0xa8cfe0 },
  spa:        { ...base, ground: C(0x5f9a55), tree: 0x38662f },
  hungaring:  { ...base, ground: C(0x7fae63) },
  zandvoort:  { ...base, ground: C(0xc9b98a), tree: 0x557b3f },
  monza:      { ...base, ground: C(0x6f9f58), tree: 0x2e5d2a },
  baku:       { ...base, street: true, night: true, sky: 0x1a2138, wall: [C(0x39456b), C(0x4a5a85)], sky_building: 0x33405f, ground: C(0x8a7f66) },
  singapore:  { ...base, street: true, night: true, sky: 0x101826, wall: [C(0x2c3e50), C(0x3d566e)], sky_building: 0x24384a, ground: C(0x4f7a52) },
  cota:       { ...base, ground: C(0x9fae5e) },
  mexico:     { ...base, ground: C(0xa89a6a), sky: 0x9fd0f0 },
  interlagos: { ...base, ground: C(0x66a85e) },
  lasvegas:   { ...base, street: true, night: true, sky: 0x0e1230, wall: [C(0x3a2f6b), C(0x5b3a7a), C(0x2f4b7c)], sky_building: 0x2b2450, ground: C(0x7a6a52) },
  qatar:      { ...base, ground: C(0xc2a878), sky: 0xb9d6ee },
  abudhabi:   { ...base, street: false, night: true, sky: 0x1d2440, ground: C(0xa08a5e), tree: 0x6a7a3a },
  shanghai:   { ...base, ground: C(0x76ac62) },
  madrid:     { ...base, street: true, sky: 0x9ccdf2, wall: [C(0xd8cdbb), C(0xc9bda6)], sky_building: 0xcabfa8, ground: C(0x9fae6e) },
};

export function themeFor(trackId) {
  return THEMES[trackId] || base;
}
