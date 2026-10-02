import { randomBytes } from 'node:crypto';
import { loadConfig, type Config } from '../../src/config.js';
import { TEST_ISSUER } from './auth.js';

export const MASTER_KEY = randomBytes(32);
export const GATEWAY_SECRET = randomBytes(32);

export function testEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    EVE_MCP_PUBLIC_ORIGIN: 'https://mcp.test.example',
    EVE_GAME_ORIGIN: 'https://game.test.example',
    EVE_ENGINE_URL: 'http://127.0.0.1:9',
    SUPABASE_URL: 'https://test-project.supabase.co',
    SUPABASE_ISSUER: TEST_ISSUER,
    EVE_FRAMES_DIR: '/nonexistent-frames-dir',
    EVE_MCP_MASTER_KEYS: `1:${MASTER_KEY.toString('base64')}`,
    EVE_GATEWAY_SECRET: GATEWAY_SECRET.toString('base64'),
    ...overrides,
  };
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig(testEnv(overrides));
}
