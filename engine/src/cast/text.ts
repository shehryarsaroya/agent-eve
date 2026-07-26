/**
 * Text hygiene for anything a language model produced.
 *
 * One function, and it exists because of a mistake made while writing this directory:
 * the obvious way to strip control bytes is a character class, and a character class
 * containing them **puts a literal NUL byte in the source file**. That file is then
 * binary to `grep`, invisible to half the tooling, and carries the exact byte the repo
 * bans everywhere else. Escaping the class is fragile too — the escape is easy
 * to lose in an edit, and the loss is silent.
 *
 * So: no regex. A code-point scan, plain ASCII source, and the same one function used by
 * `memory.ts` (which scrubs prose) and by `parse.ts` (which *refuses* a param string that
 * is not already clean, because a param goes into the hashed record and the difference
 * between "as sent" and "tidied up" is the difference between a faithful log and a
 * helpful one).
 */

/**
 * Replace every C0 control byte and DEL with a space.
 *
 * Leaves everything from U+0020 up alone, including the whole of Unicode above it: a
 * creed with a typographic apostrophe in it is fine, and a handle is `[a-z0-9-]` by the
 * time it reaches anything that matters.
 */
export function stripControlBytes(text: string): string {
  let out = '';
  let clean = true;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      out += ' ';
      clean = false;
    } else {
      out += ch;
    }
  }
  return clean ? text : out;
}

/** True when the string carries no control byte. The form `parse.ts` needs. */
export function hasControlBytes(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
