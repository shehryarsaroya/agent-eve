// DET-7 — the banned-construct lint. Fails the build, not a warning.
//
// Each rule below corresponds to a determinism killer named in SPEC §15.5.
// A single unseeded draw or clock read makes the world unreplayable, and replay
// is the only thing that makes a permanent public record trustworthy. These are
// errors rather than warnings because a warning in a codebase authored partly by
// AI agents is a warning nobody reads.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Files permitted to touch real time or unseeded randomness, with the reason. */
const CLOCK_ALLOWLIST = [
  // The single sanctioned reader of wall-clock time: the tick scheduler needs
  // to know when to run. Never used inside tick resolution.
  'src/core/time.ts',
  // The blind-probe harness is a CLIENT, not the engine. RFC 9421 signatures carry a real `created`
  // timestamp because the server checks it against a real skew window, and the nonce must be
  // unpredictable rather than seeded. Nothing in this file enters world state, the action log, or the
  // state hash — so DET-7's subject does not exist here. It is allowlisted rather than exempted by an
  // inline disable so the exception stays visible next to the two that came before it.
  'scripts/probe.ts',
];

const BANNED = [
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message:
      'Math.random is banned (DET-7). Use Rng from src/core/rng.ts — an unseeded draw makes the world unreplayable.',
  },
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message:
      'Date.now is banned (DET-7). Take a Clock via injection; see src/core/time.ts.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      'new Date() with no argument reads the system clock (DET-7). Take a Clock via injection.',
  },
  {
    selector: "MemberExpression[property.name='toLocaleString']",
    message:
      'toLocaleString is locale-dependent and therefore non-deterministic across hosts (DET-4).',
  },
  {
    selector: "CallExpression[callee.property.name='sort'][arguments.length=0]",
    message:
      'Bare .sort() on non-strings risks implementation-defined ordering. Pass an explicit comparator (DET-1).',
  },
  {
    selector: "MemberExpression[object.name='Intl']",
    message: 'Intl is locale-dependent (DET-4). Format on the client, not in the engine.',
  },
];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-restricted-syntax': ['error', ...BANNED],
      // Floats are banned from value paths by construction (src/core/units.ts),
      // but this catches the common accidental introduction.
      'no-loss-of-precision': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // An unused variable in an engine that must be exhaustive is usually a
      // half-finished branch, which is worse here than elsewhere.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: CLOCK_ALLOWLIST,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...BANNED.filter((b) => !b.selector.includes('Date')),
      ],
    },
  },
  {
    // Tests may construct fixed dates as data; they may still not draw randomness.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Audit scripts are plain ESM, deliberately outside the TS project so they
    // run with bare node in CI before any build step exists. The spread must
    // come before languageOptions or disableTypeChecked clobbers the globals.
    files: ['scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { projectService: false },
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
);
