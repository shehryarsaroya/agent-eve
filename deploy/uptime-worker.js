// Agent Eve uptime monitor — a Cloudflare Worker on a cron trigger (deploy/deploy-uptime-worker.py).
//
// Why a Worker: GitHub's scheduler ran the old every-10-minutes workflow twice in about seven
// hours, which is no alarm at all. A Cron Trigger fires on time and is independent of both servers.
//
// Every 5 minutes: probe /health (one quick retry). A single failed run is not an alert: a deploy's
// restart takes ~25 s and could land on a probe. DOWN is mailed after TWO consecutive failed runs
// (a 5–10 minute outage), and RECOVERED once on the first healthy run after that. State lives in
// the KV namespace bound as STATE. Secrets are Worker bindings, never in this file:
// RESEND_API_KEY (the agenteve-alerts key: sending only, agenteve.io only) and ALERT_TO;
// TEST_ALERT=1 is set for a single run at deploy time to prove the mail path.

const HEALTH = 'https://agenteve.io/health';
const FAILURES_BEFORE_ALERT = 2;

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(check(env));
  },
  async fetch() {
    return new Response('agenteve uptime monitor\n', { headers: { 'content-type': 'text/plain' } });
  },
};

async function probeOnce() {
  try {
    const response = await fetch(HEALTH, {
      headers: { 'user-agent': 'agenteve-uptime-worker/1' },
      signal: AbortSignal.timeout(10_000),
    });
    let report = null;
    try {
      report = (await response.json()).report;
    } catch {
      // A non-JSON body (an error page) is a failure with its status as the reason.
    }
    if (response.ok && report && report.world === 'RUNNING' && report.status === 'healthy') {
      return { up: true, detail: `tick ${report.tick}, healthy` };
    }
    const failures = report && Array.isArray(report.failures) ? `, failures ${JSON.stringify(report.failures).slice(0, 400)}` : '';
    return { up: false, detail: `HTTP ${response.status}${report ? `, world ${report.world}, status ${report.status}` : ''}${failures}` };
  } catch (error) {
    return { up: false, detail: String(error).slice(0, 300) };
  }
}

async function probe() {
  const first = await probeOnce();
  if (first.up) return first;
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  return probeOnce();
}

async function check(env) {
  const now = new Date().toISOString();
  const { up, detail } = await probe();
  // One write a run (288 a day, inside KV's free tier) so anyone can see the monitor is alive.
  await env.STATE.put('last_run', JSON.stringify({ at: now, up, detail }));
  // Set only for one run at deploy time, so the mail path is proven before an outage needs it.
  if (env.TEST_ALERT === '1') {
    await mail(env, 'Agent Eve uptime monitor is live (test)', `This is a test from the new uptime monitor. agenteve.io is currently ${up ? 'UP' : 'DOWN'} (${detail}). From now on you get one email when it has been failing for two checks in a row, and one when it recovers. Checks run every 5 minutes.`);
  }
  const state = (await env.STATE.get('state', 'json')) ?? { alerted: false, failures: 0, since: now };
  if (up) {
    if (state.alerted) {
      await mail(env, 'Agent Eve recovered', `agenteve.io is answering healthy again (${detail}).\nIt was first seen failing at ${state.since}.`);
    }
    if (state.alerted || state.failures > 0) await env.STATE.put('state', JSON.stringify({ alerted: false, failures: 0, since: now }));
    return;
  }
  const failures = state.failures + 1;
  const since = state.failures === 0 ? now : state.since;
  let alerted = state.alerted;
  if (!alerted && failures >= FAILURES_BEFORE_ALERT) {
    await mail(env, 'Agent Eve is DOWN', `agenteve.io has failed its health check ${failures} runs in a row (every 5 minutes), first at ${since}.\n\n${detail}`);
    alerted = true;
  }
  await env.STATE.put('state', JSON.stringify({ alerted, failures, since, detail }));
}

async function mail(env, subject, text) {
  if (!env.RESEND_API_KEY || !env.ALERT_TO) return;
  const footer = `\n\nChecked ${new Date().toISOString()} by the agenteve-uptime Worker.\nHealth: ${HEALTH}\nRunbook: docs/background/INFRA.md in the agent-eve repository`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'Agent Eve alerts <alerts@agenteve.io>', to: [env.ALERT_TO], subject, text: text + footer }),
  });
}
