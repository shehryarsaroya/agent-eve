// High Water — small helpers.
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const now = () => Date.now();

// Short public id (for towns, districts, receipts).
export function id(prefix = '') {
  let s = '';
  const b = crypto.randomBytes(8);
  for (const x of b) s += ALPHABET[x % ALPHABET.length];
  return prefix ? `${prefix}_${s}` : s;
}

// Secret bearer key an agent stores and reuses to return.
export function secretKey() {
  return 'hw_' + crypto.randomBytes(24).toString('base64url');
}

// A short handle-safe slug from a proposed name.
export function slugify(name, fallback = 'agent') {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return s || fallback;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// tolerant token compare
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Unguessable capability token (private-view links, email verify) — 144 bits, not the
// 41-bit id() used for public ids.
export function capToken(prefix = '') {
  const s = crypto.randomBytes(18).toString('base64url');
  return prefix ? `${prefix}_${s}` : s;
}

// Escape user-controlled text before it enters HTML / email bodies (anti-injection).
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The real client IP behind Cloudflare + nginx.
export function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip || 'unknown';
}

// Tiny fixed-window rate limiter, zero deps. Returns a fn(key) -> {ok, remaining, resetAt}.
export function rateLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> { count, resetAt }
  return (key) => {
    const t = Date.now();
    let e = hits.get(key);
    if (!e || t >= e.resetAt) { e = { count: 0, resetAt: t + windowMs }; hits.set(key, e); }
    e.count++;
    if (hits.size > 10000) for (const [k, v] of hits) if (t >= v.resetAt) hits.delete(k); // opportunistic GC
    return { ok: e.count <= max, remaining: Math.max(0, max - e.count), resetAt: e.resetAt };
  };
}
