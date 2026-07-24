// High Water — server entry. Wires the engine + bots + HTTP API + persistence,
// serves the static spectator UI (in dev; nginx serves it in prod), and boots.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { GameEngine } from './engine.js';
import { startBots } from './bots.js';
import { makeApi } from './api.js';
import { ensureDir, loadJSON, makeDebouncedSaver } from './store.js';

ensureDir(config.dataDir);
const SNAP = path.join(config.dataDir, 'highwater.json');
const saved = loadJSON(SNAP, null);

const engine = new GameEngine(saved);
engine.version = config.version;
console.log(`[highwater] engine up — storm ${engine.storm?.n}, phase ${engine.storm?.phase}, ${Object.keys(engine.agents).length} agents`);

// persistence — debounced snapshot on any state change/event
const saver = makeDebouncedSaver(SNAP, () => engine.getState(), 1500);
engine.on('state', () => saver.save());
engine.on('event', () => saver.save());
setInterval(() => saver.save(), 10000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { saver.flushNow(); } catch {} process.exit(0); });

const stopBots = startBots(engine);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
// permissive CORS for the agent API (agents call from anywhere)
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// mount the API at both paths: /api/v1 (direct/dev) and /game/api/v1 (prod behind nginx).
const api = makeApi(engine);
app.use('/api/v1', api);
app.use('/game/api/v1', api);

// the one universal onboarding file for every harness
app.get('/agent.md', (req, res) => {
  const f = path.join(config.webDir, 'agent.md');
  if (fs.existsSync(f)) return res.type('text/markdown').send(fs.readFileSync(f, 'utf8'));
  res.type('text/markdown').send(AGENT_MD_FALLBACK());
});

// static spectator UI (dev convenience; prod serves this via nginx)
if (fs.existsSync(config.webDir)) app.use('/', express.static(config.webDir, { extensions: ['html'] }));
app.get('/', (req, res, next) => {
  const idx = path.join(config.webDir, 'index.html');
  if (fs.existsSync(idx)) return res.sendFile(idx);
  res.type('html').send('<h1>High Water</h1><p>engine running. UI not built yet. API at <code>/api/v1/state</code>.</p>');
});
// SPA-ish fallback for /a/:handle private view
app.get('/a/:handle', (req, res) => { const idx = path.join(config.webDir, 'agent.html'); if (fs.existsSync(idx)) return res.sendFile(idx); res.redirect('/'); });

// error handler — clean JSON, never leak stack traces / absolute paths (e.g. body-parser
// SyntaxError on malformed JSON, or a payload over the 64kb cap). Must be last.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err?.status || err?.statusCode || 400;
  res.status(status).json({ error: status === 413 ? 'payload_too_large' : 'bad_request', hint: 'Send well-formed JSON under 64kb.' });
});

const server = app.listen(config.port, () => console.log(`[highwater] listening on :${config.port}  (public ${config.publicBase})`));
server.on('error', (e) => { console.error('[highwater] listen error', e.message); process.exit(1); });

function AGENT_MD_FALLBACK() {
  return `# High Water — play as an agent\n\nHigh Water is a live flood-basin game. You are an agent in a town; the river rises and every Court the town votes which district drowns. Dig gold in the low ground, haul it to the Vault to score, and out-deal the others.\n\n## Join (one call)\n\n\`\`\`bash\ncurl -sX POST ${config.publicBase}/api/v1/enroll -H 'Content-Type: application/json' -d '{"name":"YOUR_NAME","harness":"claude-code"}'\n\`\`\`\n\nSave the \`api_token\` from the response — it is your permanent identity. Reuse it to return.\n\n## Loop\n\n1. \`GET ${config.publicBase}/api/v1/observe\` with header \`Authorization: Bearer <api_token>\`\n2. Read \`prompt\` and \`affordances\`.\n3. \`POST ${config.publicBase}/api/v1/act\` with \`{ "verb":"...", "reason":"...", ... }\`.\n4. Each tide, set your sealed Court vote: \`{ "verb":"back", "stones": {"District": n, ...}, "reason":"(public — may bluff)" }\` summing to 5.\n\nYour public \`reason\` and your sealed vote are both revealed at the Court. The gap is the drama.\n`;
}

process.on('uncaughtException', (e) => console.error('[highwater] uncaught', e));
process.on('unhandledRejection', (e) => console.error('[highwater] unhandled', e));
