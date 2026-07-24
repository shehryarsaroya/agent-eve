// High Water — configuration. All timings env-overridable so the test cadence
// can run far faster than production (prod tide ~12min; test ~25s).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.HW_PORT, 8787),
  dataDir: process.env.HW_DATA_DIR || path.join(__dirname, '..', '..', 'data'),
  webDir: process.env.HW_WEB_DIR || path.join(__dirname, '..', '..', '..', 'site', 'game'),
  publicBase: process.env.HW_PUBLIC_BASE || 'https://agentinsurance.io/game',

  // ── cadence ──────────────────────────────────────────────────────────────
  tideMs: num(process.env.HW_TIDE_MS, 25000),        // length of a tide's DIG window (prod: 720000)
  tidesPerStorm: num(process.env.HW_TIDES, 6),        // tides before the Crest
  intermissionMs: num(process.env.HW_INTERMISSION_MS, 18000), // between storms
  courtRevealMs: num(process.env.HW_COURT_MS, 6000),  // dramatic pause while the Court resolves
  botStepMs: num(process.env.HW_BOT_STEP_MS, 4000),   // how often bots take an action during DIG

  // ── town shape ───────────────────────────────────────────────────────────
  seats: num(process.env.HW_SEATS, 8),                // contestant seats (= districts)
  stewards: num(process.env.HW_STEWARDS, 2),          // civic NPC agents (Surveyor, Relief Mutual)

  // ── economy ──────────────────────────────────────────────────────────────
  startGold: 0,
  workBase: 10,        // base gold per WORK; multiplied by the district yield (low ground pays more)
  carryCap: 100,       // gold you can haul per MOVE (≥ one rich on-ballot dig, so banking is a real choice not a forced dribble)
  actionsPerTide: 4,   // engine-owned budget of MATERIAL actions (work/move/give) per agent per tide, so wealth
                       // is decided by strategy — not by who polls the API fastest. say/pact/back are free.
  drownLossPct: 0.6,   // fraction of a drowned district's unbanked gold destroyed (rest = salvage)

  // ── water / levee ────────────────────────────────────────────────────────
  waterStart: 1.0,
  waterRisePerTide: 2.4,   // ft the crest climbs each tide
  waterNoise: 1.2,         // +/- forecast noise (the fog on the water)

  // ── auth / misc ──────────────────────────────────────────────────────────
  emailDomain: process.env.HW_EMAIL_DOMAIN || 'agenttransfer.dev',
  emailFromName: 'High Water',
  version: '0.1.0',
};

// The eight verbs (language-native, no combat math).
export const VERBS = ['move', 'claim', 'work', 'say', 'pact', 'give', 'back', 'take'];

// v0.1 minimal set actually wired end-to-end (rest are accepted + logged, wired as we go).
export const V01_VERBS = ['work', 'say', 'pact', 'give', 'back', 'move'];
