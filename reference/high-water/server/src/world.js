// High Water — town / basin generation.
// A town is an amphitheater river-basin: 8 contestant districts fanning up the
// slope from the river, + the Crown (Vault, civic, never mined). Low ground is
// rich and drowns first; high ground is safe and poor. Positions are normalized
// [0..1] (x left→right, y top→bottom) for the contour-map renderer.
import { id } from './util.js';

// low → high. yield falls as elevation rises (value lives in the danger).
const DISTRICT_SPECS = [
  { name: 'Tideflats',   elev: 3.0,  yield: 3.0 },
  { name: 'Silt Bend',   elev: 4.5,  yield: 2.6 },
  { name: 'Low Wharf',   elev: 6.0,  yield: 2.2 },
  { name: "Miller's Row", elev: 7.5, yield: 1.8 },
  { name: 'Market Row',  elev: 9.0,  yield: 1.5 },
  { name: 'The Terrace', elev: 11.0, yield: 1.2 },
  { name: 'Highside',    elev: 13.5, yield: 1.0 },
  { name: 'The Bluff',   elev: 16.0, yield: 0.8 },
];

const TOWN_NAMES = ['Silver Creek', 'Cedar Gulch', 'Eureka Bend', 'Kettle Run', 'Drywater', 'Larkspur', 'Alder Bend', 'Coyote Wash'];

// Fan the districts across an arc. Low elevation sits low-and-central (near the
// river/water at the bottom); high elevation climbs to the wings/top. The Crown
// sits at top-center.
// Elevation drives vertical position (high = near the Vault at top; low = near
// the river at the bottom, drowns first). x fans symmetrically from the low
// center out to the high wings — a coherent amphitheater bowl. yFor MUST match
// the client's water mapping (app.js yForElev).
export const yForElev = (e) => 0.93 - (e / 22) * 0.86;
function layout(specs) {
  const n = specs.length;
  return specs.map((s, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const spread = (Math.ceil(i / 2) / Math.ceil(n / 2)) * 0.42;
    const x = 0.5 + side * spread;
    return { ...s, x: Math.max(0.08, Math.min(0.92, x)), y: yForElev(s.elev) };
  });
}

export function makeTown(name) {
  const specs = layout(DISTRICT_SPECS);
  const districts = specs.map((s) => ({
    id: id('d'),
    name: s.name,
    elev: s.elev,
    yieldMult: s.yield,
    x: s.x,
    y: s.y,
    status: 'dry',        // dry | sunken
    holder: null,         // agentId who holds/claimed it (their body)
    unbanked: 0,          // gold sitting in the district (at risk)
    leveed: false,        // protected this tide
    salvage: 0,           // gold divable after a drown
  }));
  return {
    id: id('town'),
    name: name || TOWN_NAMES[Math.floor(Math.random() * TOWN_NAMES.length)],
    createdAt: Date.now(),
    districts,
    vault: { x: 0.5, y: 0.08, elev: 22 },   // the Crown — banking = scoring, never drowns pre-Crest
    waterline: 1.0,
    storms: 0,
  };
}

export { DISTRICT_SPECS, TOWN_NAMES };
