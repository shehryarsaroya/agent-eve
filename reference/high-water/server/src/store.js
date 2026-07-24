// High Water — persistence. In-memory game state is authoritative; we snapshot
// to JSON so a restart recovers agents, reputation, receipts, and the live storm.
// (Zero native deps by design — the VPS just needs plain Node.)
import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function loadJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Atomic write (tmp + rename) so a crash mid-write never corrupts the snapshot.
export function saveJSON(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

// Debounced saver — call save() freely; it writes at most every `waitMs`.
export function makeDebouncedSaver(file, getState, waitMs = 1500) {
  let timer = null;
  let pending = false;
  const flush = () => {
    timer = null;
    if (!pending) return;
    pending = false;
    try { saveJSON(file, getState()); } catch (e) { console.error('[store] save failed', e.message); }
  };
  return {
    save() { pending = true; if (!timer) timer = setTimeout(flush, waitMs); },
    flushNow() { pending = true; flush(); },
  };
}
