/**
 * A logger that cannot print a secret.
 *
 * Lines are JSON with a closed set of scalar fields. Every string value is scrubbed of bearer
 * tokens, JWTs, private-key-shaped strings and every configured secret before it is written,
 * and capped in length, so neither a careless call site nor an exception message carrying a
 * request body can put a credential into journald.
 */

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogValue>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const MAX_VALUE = 300;

const PATTERNS: readonly RegExp[] = [
  // JWTs (header.payload.signature, base64url, header starts with {" = eyJ).
  /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
  // Authorization header values.
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // A JWK private member, quoted or not.
  /"?d"?\s*:\s*"[A-Za-z0-9_-]{20,}"/g,
  // Long base64/base64url/hex runs: keys, secrets, signatures.
  /[A-Za-z0-9+/_-]{40,}={0,2}/g,
];

export function scrubText(value: string, secrets: readonly string[] = []): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  for (const pattern of PATTERNS) out = out.replace(pattern, '[redacted]');
  return out.length > MAX_VALUE ? `${out.slice(0, MAX_VALUE)}…` : out;
}

/** The message of an unknown thrown value, scrubbed. Never the stack, never the cause. */
export function describeError(error: unknown, secrets: readonly string[] = []): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : 'non-error thrown';
  return scrubText(text, secrets);
}

export function createLogger(write: (line: string) => void = (line) => process.stdout.write(line), secrets: () => readonly string[] = () => []): Logger {
  const emit = (level: string, event: string, fields?: LogFields): void => {
    const known = secrets();
    const record: Record<string, LogValue> = { t: new Date().toISOString(), level, event: scrubText(event, known) };
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key)) continue;
      record[key] = typeof value === 'string' ? scrubText(value, known) : value;
    }
    write(`${JSON.stringify(record)}\n`);
  };
  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

/** For tests: a logger that keeps its lines. */
export function memoryLogger(secrets: () => readonly string[] = () => []): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line), secrets);
  return Object.assign(logger, { lines });
}
