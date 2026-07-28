/**
 * THE BLIND PROBE HARNESS — play the live game from outside, as an agent does.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Blind probes are the highest-yield instrument this project has, by a wide margin. Three of them once
 * found five bugs that 26 invariants and 2,959 tests did not, and **every one was the engine being
 * internally consistent while the agent-facing surface lied** — a class invariants cannot reach by
 * construction, because an invariant checks the world against itself and a probe checks the world
 * against what it *told you*.
 *
 * The standing defect this catches has now appeared **eleven times**: a capability that exists, is
 * tested, reports as built, and is used by nothing. `grant` with no affordance. A territorial layer
 * nobody entered. A combat layer nobody flew. `deliver {payer}`, which solves a solvency crisis and had
 * never been called in any world this repo had run. `lockFillStake`, which quotes §7.3 above itself,
 * has its own passing unit test, and had no caller at all.
 *
 * None of those are visible from inside. All of them are obvious to something that tries to *play*.
 *
 * ── WHY IDENTITIES LIVE OUTSIDE THE REPO ────────────────────────────────────
 *
 * An Ed25519 private key is a secret, and HARD RULE 1 is absolute: no secrets in this repo, ever. A
 * probe key is not a toy — it controls a real principal on the live shard, with real holdings and a
 * permanent public record under A5 that can never be rewritten. So the store is
 * `~/.compact-probes/`, named here by location only, exactly as `INFRA.md` names credentials.
 *
 * Identities PERSIST on purpose. A probe that re-enrols every run is always a newcomer, and a newcomer
 * cannot see the failures that only exist in a mature world — which is the coverage gap that hid a dead
 * economy behind 3,248 passing tests for 4,000 ticks. A returning probe accumulates standing, holdings
 * and history, and is the only way to walk the late game at all.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/probe.ts new <name>          mint an identity (does not enrol)
 *   npx tsx scripts/probe.ts enroll <name>       enrol it on the live shard
 *   npx tsx scripts/probe.ts observe <name>      signed GET /observe, pretty-printed
 *   npx tsx scripts/probe.ts act <name> <verb> ['{"json":"params"}']
 *   npx tsx scripts/probe.ts raw <name> <METHOD> <path> ['<body>']
 *   npx tsx scripts/probe.ts list                every identity and its last-known handle
 *
 * `COMPACT_BASE` overrides the target (default: the live shard). Point it at a local server to probe a
 * branch before deploying it.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import {
  generateKeypair,
  keypairFromPrivateJwk,
  type AgentKeypair,
  type PrivateKeyJwk,
} from '../src/identity/keys.js';
import { signRequest } from '../src/identity/httpsig.js';
import type { WallSeconds } from '../src/identity/wallclock.js';

/** Outside the repo, by rule. Never move this under the working tree. */
const STORE = join(homedir(), '.compact-probes');
const BASE = process.env['COMPACT_BASE'] ?? 'https://agentinsurance.io/compact/api';

interface ProbeFile {
  readonly name: string;
  readonly jwk: PrivateKeyJwk;
  handle?: string;
  enrolledAt?: string;
  notes?: string[];
}

function pathFor(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) {
    throw new Error(`probe name must be kebab-case, 2-31 chars: got ${name}`);
  }
  return join(STORE, `${name}.json`);
}

function load(name: string): { file: ProbeFile; keypair: AgentKeypair } {
  const p = pathFor(name);
  if (!existsSync(p)) throw new Error(`no such probe: ${name}. Mint one with: probe.ts new ${name}`);
  const file = JSON.parse(readFileSync(p, 'utf8')) as ProbeFile;
  return { file, keypair: keypairFromPrivateJwk(file.jwk) };
}

function save(file: ProbeFile): void {
  mkdirSync(STORE, { recursive: true, mode: 0o700 });
  writeFileSync(pathFor(file.name), JSON.stringify(file, null, 2), { mode: 0o600 });
}

/**
 * A signed request against the live shard.
 *
 * Wall-clock is correct here and is NOT a DET-7 violation: this is a client, not the engine. The
 * signature's `created` is a real timestamp because the server checks it against a real skew window;
 * nothing in this file enters the world state or the hash.
 */
async function request(
  keypair: AgentKeypair,
  method: string,
  path: string,
  body: unknown = null,
): Promise<{ status: number; json: unknown; text: string }> {
  const url = new URL(BASE.endsWith('/') ? `${BASE}${path}` : `${BASE}/${path}`);
  const bodyText = body === null ? null : JSON.stringify(body);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (bodyText !== null) {
    headers['content-type'] = 'application/json';
    const digest = createHash('sha256').update(bodyText).digest('base64');
    headers['content-digest'] = `sha-256=:${digest}:`;
  }

  // Sign the CLIENT-VISIBLE target, which is what RFC 9421 §2.2.6 defines `@path` over — even though
  // nginx strips the mount prefix before the app sees it. Signing the app-internal spelling is the one
  // thing the RFC forbids, and `SignableRequest.alternateRequestTargets` exists on the server precisely
  // so the conformant client stays conformant. Gate 3 measured every conformant client failing here.
  const signed = signRequest({
    request: {
      method: method.toUpperCase(),
      scheme: url.protocol === 'http:' ? 'http' : 'https',
      authority: url.host,
      requestTarget: url.pathname + url.search,
      headers,
      body: bodyText === null ? null : Buffer.from(bodyText, 'utf8'),
    },
    keypair,
    created: Math.floor(Date.now() / 1000) as WallSeconds,
    nonce: randomBytes(16).toString('hex'),
  });

  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers: {
      ...headers,
      'signature-input': signed.signatureInput,
      signature: signed.signature,
    },
    ...(bodyText === null ? {} : { body: bodyText }),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* a non-JSON body is itself a finding worth seeing raw */
  }
  return { status: res.status, json, text };
}

function show(label: string, r: { status: number; json: unknown; text: string }): void {
  console.log(`\n── ${label} — HTTP ${String(r.status)} ──`);
  console.log(r.json === null ? r.text.slice(0, 4000) : JSON.stringify(r.json, null, 2).slice(0, 24000));
}

async function main(): Promise<void> {
  const [cmd, name, ...rest] = process.argv.slice(2);

  if (cmd === 'list') {
    mkdirSync(STORE, { recursive: true, mode: 0o700 });
    const files = readdirSync(STORE).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      console.log(`no probes yet in ${STORE}`);
      return;
    }
    for (const f of files) {
      const p = JSON.parse(readFileSync(join(STORE, f), 'utf8')) as ProbeFile;
      console.log(`${p.name.padEnd(24)} ${p.handle ?? '(not enrolled)'}  ${p.enrolledAt ?? ''}`);
    }
    return;
  }

  if (cmd === undefined || name === undefined) {
    console.log('usage: probe.ts <new|enroll|observe|act|raw|list> <name> [...]');
    process.exitCode = 2;
    return;
  }

  if (cmd === 'new') {
    if (existsSync(pathFor(name))) throw new Error(`${name} already exists — probes persist on purpose`);
    const keypair = generateKeypair();
    save({ name, jwk: keypair.exportPrivateKeyJwkDangerously(), notes: [] });
    console.log(`minted ${name}\n  keyid ${keypair.keyid}\n  stored in ${STORE} (outside the repo, by rule)`);
    return;
  }

  const { file, keypair } = load(name);

  switch (cmd) {
    case 'enroll': {
      // Enrolment is the ONE unsigned request, and necessarily so: it is where the key is first
      // presented, so there is nothing to verify it against yet. `publicKey` is the bare base64url
      // `x` coordinate — 43 characters — not a JWK object; the server's refusal says so exactly, which
      // is A2 working.
      const handle = rest[0] ?? name;
      const url = new URL(BASE.endsWith('/') ? `${BASE}enroll` : `${BASE}/enroll`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ handle, publicKey: keypair.record.publicKeyJwk.x }),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* raw body is the finding */
      }
      show('enroll', { status: res.status, json, text });
      if (res.status === 201 || res.status === 200) {
        const b = json as { principalId?: string; handle?: string } | null;
        file.handle = b?.principalId ?? b?.handle ?? handle;
        file.enrolledAt = new Date().toISOString();
        save(file);
      }
      break;
    }
    case 'observe':
      show('observe', await request(keypair, 'GET', 'observe'));
      break;
    case 'act': {
      const verb = rest[0];
      if (verb === undefined) throw new Error('act needs a verb');
      const params = rest[1] === undefined ? {} : (JSON.parse(rest[1]) as Record<string, unknown>);
      show(
        `act ${verb}`,
        await request(keypair, 'POST', 'act', {
          actions: [{ verb, params, clientSequence: Math.floor(Date.now() / 1000) }],
        }),
      );
      break;
    }
    case 'raw': {
      const method = rest[0] ?? 'GET';
      const path = rest[1] ?? 'observe';
      const body = rest[2] === undefined ? null : (JSON.parse(rest[2]) as unknown);
      show(`${method} ${path}`, await request(keypair, method, path, body));
      break;
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

main().catch((e: unknown) => {
  console.error(String(e));
  process.exitCode = 1;
});
