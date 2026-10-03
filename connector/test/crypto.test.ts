import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseMasterKeys } from '../src/config.js';
import { generateAgentKey, privateJwk, thumbprint } from '../src/crypto/keys.js';
import { agentKeyAad, KeyVault, VaultError } from '../src/crypto/vault.js';
import { thumbprint as engineThumbprint } from '../../engine/src/identity/keys.js';
import { testEnv } from './helpers/config.js';

describe('agent keys', () => {
  it('derive the same key id the engine computes (RFC 7638)', () => {
    const key = generateAgentKey();
    expect(key.keyid).toBe(thumbprint(key.publicKey));
    expect(key.keyid).toBe(engineThumbprint({ kty: 'OKP', crv: 'Ed25519', x: key.publicKey }));
    expect(Buffer.from(key.publicKey, 'base64url')).toHaveLength(32);
    expect(key.seed).toHaveLength(32);
    expect(privateJwk(key.publicKey, key.seed)).toEqual({ kty: 'OKP', crv: 'Ed25519', x: key.publicKey, d: key.seed.toString('base64url') });
  });
});

describe('the key vault', () => {
  const master = new Map([[1, randomBytes(32)]]);

  it('decrypts what it encrypted, for the same account and key id only', () => {
    const vault = new KeyVault(master);
    const seed = randomBytes(32);
    const encrypted = vault.encrypt(seed, agentKeyAad('a', 'k'));
    expect(encrypted.version).toBe(1);
    expect(encrypted.blob.includes(seed)).toBe(false);
    expect(vault.decrypt(encrypted, agentKeyAad('a', 'k')).equals(seed)).toBe(true);
    expect(() => vault.decrypt(encrypted, agentKeyAad('b', 'k'))).toThrow(VaultError);
    expect(() => vault.decrypt(encrypted, agentKeyAad('a', 'other'))).toThrow(VaultError);
  });

  it('detects tampering and refuses an unknown version', () => {
    const vault = new KeyVault(master);
    const encrypted = vault.encrypt(randomBytes(32), 'aad');
    const flipped = Buffer.from(encrypted.blob);
    flipped[20] = (flipped[20] ?? 0) ^ 1;
    expect(() => vault.decrypt({ version: 1, blob: flipped }, 'aad')).toThrow(/failed authentication/);
    expect(() => vault.decrypt({ version: 2, blob: encrypted.blob }, 'aad')).toThrow(/no master key for version 2/);
  });

  it('rotates: new keys encrypt under the highest version, old blobs still decrypt', () => {
    const old = new KeyVault(master);
    const encryptedOld = old.encrypt(Buffer.from('seed-one-seed-one-seed-one-seed1'), 'aad');
    const rotated = new KeyVault(new Map([...master, [2, randomBytes(32)]]));
    expect(rotated.currentVersion).toBe(2);
    expect(rotated.encrypt(Buffer.alloc(32, 1), 'aad').version).toBe(2);
    expect(rotated.decrypt(encryptedOld, 'aad').toString()).toBe('seed-one-seed-one-seed-one-seed1');
  });

  it('never serialises a master key', () => {
    const key = randomBytes(32);
    const vault = new KeyVault(new Map([[1, key]]));
    const text = JSON.stringify({ vault }) + String(vault) + JSON.stringify(Object.entries(vault));
    for (const encoding of ['base64', 'hex', 'base64url'] as const) expect(text).not.toContain(key.toString(encoding));
  });

  it('derives purpose-bound keys that differ by purpose', () => {
    const vault = new KeyVault(master);
    expect(vault.derive('a').equals(vault.derive('a'))).toBe(true);
    expect(vault.derive('a').equals(vault.derive('b'))).toBe(false);
  });
});

describe('configuration', () => {
  it('loads the documented defaults', () => {
    const config = loadConfig(testEnv());
    expect(config.resource).toBe('https://mcp.test.example/mcp');
    expect(config.tokenAudiences).toEqual(['https://mcp.test.example/mcp']);
    expect(config.port).toBe(8825);
    expect(config.engineAuthority).toBe('127.0.0.1:9');
    expect(config.jwksUrl).toBe('https://test-project.supabase.co/auth/v1/.well-known/jwks.json');
  });

  it('refuses bad secrets by NAME, never echoing the value', () => {
    const secret = 'not-a-valid-key-but-a-secret-looking-value';
    let message = '';
    try {
      parseMasterKeys(`1:${secret}`);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as Error).message;
    }
    expect(message).toMatch(/EVE_MCP_MASTER_KEYS/);
    expect(message).not.toContain(secret);
    expect(() => loadConfig(testEnv({ EVE_GATEWAY_SECRET: 'short' }))).toThrow(/EVE_GATEWAY_SECRET must decode to exactly 32 bytes/);
    expect(() => loadConfig({ ...testEnv(), EVE_MCP_MASTER_KEYS: '' })).toThrow(/EVE_MCP_MASTER_KEYS is required/);
    expect(() => loadConfig(testEnv({ EVE_MCP_LIMIT_ACT: 'fast' }))).toThrow(/<burst>\/<windowSeconds>/);
  });

  it('refuses to read the public frames through the engine, which does not serve live.json', () => {
    expect(() => loadConfig(testEnv({ EVE_FRAMES_DIR: '', EVE_FRAMES_URL: 'http://127.0.0.1:9/frames/' }))).toThrow(/must not point at the engine/);
    expect(loadConfig(testEnv({ EVE_FRAMES_DIR: '', EVE_FRAMES_URL: 'http://127.0.0.1:8826/frames/' })).framesUrl).toBe('http://127.0.0.1:8826/frames/');
    expect(loadConfig(testEnv({ EVE_FRAMES_DIR: '', EVE_FRAMES_URL: 'https://agenteve.io/frames/' })).framesUrl).toBe('https://agenteve.io/frames/');
  });
});
