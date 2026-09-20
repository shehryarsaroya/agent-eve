import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export function signedHeaders(identity, method, url, body) {
  const components = ['@method', '@path', '@authority'];
  const values = [method, url.pathname, url.host];
  const headers = {};
  if (body !== undefined) {
    const digest = `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;
    components.push('content-digest');
    values.push(digest);
    headers['Content-Digest'] = digest;
    headers['Content-Type'] = 'application/json';
  }
  const params = `(${components.map(x => `"${x}"`).join(' ')});created=${Math.floor(Date.now() / 1000)};keyid="${identity.keyid}";nonce="${randomUUID()}";alg="ed25519"`;
  const base = components.map((x, i) => `"${x}": ${values[i]}`).concat(`"@signature-params": ${params}`).join('\n');
  const key = createPrivateKey({ key: identity.privateKey, format: 'jwk' });
  headers['Signature-Input'] = `sig1=${params}`;
  headers.Signature = `sig1=:${sign(null, Buffer.from(base), key).toString('base64')}:`;
  return headers;
}

export class EveClient {
  constructor(origin, identityFile) {
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('AGENTEVE_URL must be an origin without credentials or a path.');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or HTTP on loopback for local testing.');
    this.origin = url.origin;
    this.identityFile = identityFile;
  }

  identity(required = true) {
    let value;
    try { value = JSON.parse(readFileSync(this.identityFile, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT' && !required) return null;
      if (error.code === 'ENOENT') throw new Error('Enroll first with eve_enroll.');
      throw new Error('Cannot read the local identity file.');
    }
    if (value.origin !== this.origin) throw new Error('This identity belongs to another world URL. Use a separate identity file.');
    return value;
  }

  save(value, initial = false) {
    mkdirSync(dirname(this.identityFile), { recursive: true, mode: 0o700 });
    const data = JSON.stringify(value, null, 2) + '\n';
    if (initial) writeFileSync(this.identityFile, data, { flag: 'wx', mode: 0o600 });
    else {
      const tmp = `${this.identityFile}.${randomUUID()}.tmp`;
      writeFileSync(tmp, data, { flag: 'wx', mode: 0o600 });
      renameSync(tmp, this.identityFile);
    }
  }

  publicIdentity() {
    const identity = this.identity(false);
    if (!identity) return { enrolled: false };
    return { enrolled: identity.enrolled, handle: identity.handle, principalId: identity.principalId, keyid: identity.keyid, origin: identity.origin };
  }

  async request(method, path, payload, authenticated = false) {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) throw new Error('Cross-origin request refused.');
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    if (body !== undefined && Buffer.byteLength(body) > 65536) throw new Error('Request body is too large.');
    const headers = authenticated ? signedHeaders(this.identity(), method, url, body) : body === undefined ? {} : { 'Content-Type': 'application/json' };
    const response = await fetch(url, { method, body, headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { text }; }
    return { httpStatus: response.status, ...result };
  }

  async enroll(handle) {
    let identity = this.identity(false);
    if (identity && identity.handle !== handle) throw new Error('This identity file already belongs to another handle. Give each agent a separate AGENTEVE_IDENTITY_FILE.');
    if (identity?.enrolled) return { httpStatus: 200, ...this.publicIdentity(), resumed: true, note: 'Use eve_observe to resume. Your existing identity was preserved.' };
    if (!identity) {
      const { privateKey } = generateKeyPairSync('ed25519');
      const jwk = privateKey.export({ format: 'jwk' });
      const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
      identity = { origin: this.origin, handle, principalId: `p:${handle}`, keyid: createHash('sha256').update(canonical).digest('base64url'), privateKey: jwk, enrolled: false, nextSequence: 1 };
      // Save BEFORE the network request: a lost response must never lose the key.
      this.save(identity, true);
    }
    const result = await this.request('POST', '/api/enroll', { handle, publicKey: identity.privateKey.x });
    if (result.httpStatus === 201) {
      if (result.keyid !== identity.keyid) throw new Error('The server returned an unexpected key identity.');
      identity.enrolled = true;
      this.save(identity);
    } else if (result.httpStatus === 409 && result.reason === 'ALREADY_ENROLLED') {
      // Recover an enrollment whose response was lost, proving possession via a signature.
      const observation = await this.request('GET', '/api/observe', undefined, true);
      if (observation.httpStatus === 200) {
        identity.enrolled = true;
        this.save(identity);
        return { ...observation, ...this.publicIdentity(), resumed: true };
      }
    }
    return result;
  }

  async act({ actions, idempotencyKey = randomUUID(), expectedStateVersion }) {
    const identity = this.identity();
    const prepared = actions.map(action => {
      const clientSequence = action.clientSequence ?? identity.nextSequence++;
      identity.nextSequence = Math.max(identity.nextSequence, clientSequence + 1);
      const params = action.quote_id === undefined ? action.params : { ...action.params, quote_id: action.quote_id };
      return { verb: action.verb, params, clientSequence };
    });
    this.save(identity);
    const result = await this.request('POST', '/api/act', { actions: prepared, idempotencyKey, ...(expectedStateVersion === undefined ? {} : { expectedStateVersion }) }, true);
    return { ...result, idempotencyKey };
  }
}
