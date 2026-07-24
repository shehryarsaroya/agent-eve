// High Water — outbound email via Resend, sending as <handle>@agenttransfer.dev
// (DKIM for agenttransfer.dev is configured; we deliberately use that domain to
// protect the agentinsurance.io sending reputation). Owner updates only for v0.1.
import { escapeHtml } from './util.js';
const RESEND = process.env.RESEND_API_KEY;

export function emailEnabled() { return !!RESEND; }

export async function sendEmail({ from, to, subject, text, html, replyTo }) {
  if (!RESEND) return { ok: false, error: 'email_disabled' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000); // don't hang a request on a slow provider
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: String(subject || '').replace(/[\r\n]+/g, ' ').slice(0, 200), text, html, reply_to: replyTo }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, id: d.id } : { ok: false, error: d.message || `http_${r.status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

const wrap = (title, body) => `<!doctype html><html><body style="margin:0;background:#faf7ef;font-family:Georgia,serif;color:#141413">
<div style="max-width:560px;margin:0 auto;padding:32px 28px">
<div style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#6f6b60">High Water</div>
<h1 style="font-size:22px;font-weight:500;margin:6px 0 16px">${title}</h1>
<div style="font-size:15px;line-height:1.6;color:#3d3d3a">${body}</div>
<hr style="border:none;border-top:1px solid #e3ddcc;margin:24px 0">
<div style="font-size:12px;color:#6f6b60">A town of agents. A rising river. One vote a night. · <a href="https://agentinsurance.io/game" style="color:#b8933b">watch live</a></div>
</div></body></html>`;

export async function sendVerify(agent, base) {
  const link = `${base}/api/v1/owner/verify?a=${encodeURIComponent(agent.handle)}&t=${agent.verifyToken}`;
  return sendEmail({
    from: `${agent.handle}@agenttransfer.dev`,
    to: agent.ownerEmail,
    subject: `${agent.name} wants to send you word from High Water`,
    text: `I'm ${agent.name}, your agent in High Water. Confirm this address and I'll write to you when the water rises: ${link}`,
    html: wrap(`${escapeHtml(agent.name)} wants to write to you`, `I'm <b>${escapeHtml(agent.name)}</b>, your agent playing <b>High Water</b>. Confirm this address and I'll send you word when the river rises and the Court votes.<div style="margin:22px 0"><a href="${link}" style="background:#141413;color:#faf7ef;text-decoration:none;padding:12px 22px;border-radius:999px;font-family:system-ui,sans-serif;font-size:14px">Confirm &amp; connect</a></div>`),
    replyTo: agent.ownerEmail,
  });
}

export async function sendLetter(agent, subject, body) {
  const html = wrap(escapeHtml(subject), escapeHtml(String(body)).replace(/\n/g, '<br>') + `<div style="margin-top:18px"><a href="https://agentinsurance.io/game/a/${encodeURIComponent(agent.handle)}" style="color:#b8933b">your private view of ${escapeHtml(agent.name)}</a></div>`);
  return sendEmail({ from: `${agent.handle}@agenttransfer.dev`, to: agent.ownerEmail, subject, text: String(body), html });
}
