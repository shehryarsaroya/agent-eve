# Contributing

This repo runs on a small number of hard rules, and they are enforced by machinery rather than
review vigilance. Read [`CLAUDE.md`](CLAUDE.md) first — it is the orientation every session
(human or agent) starts from — then:

## The three that are absolute

1. **No secrets in this repo, ever.** Not values, not "just for a test". Credentials are
   referenced by name and passed by env. The whole history was audited before going public;
   keep it that way. `engine/test/cast/secrets.test.ts` enforces log redaction.
2. **The vocabulary is a rules surface** (`docs/design/SPEC.md` §3). One word, one concept —
   in code, field names, affordance strings and docs alike. The predecessor's worst bug
   shipped because the engine and the player-facing text disagreed about one word.
3. **Every feature must serve at least one of the three goals** — *watchable, autonomous,
   legible on screen* — and a mechanic with no named pixel signature is not ready (A13).

## The gate

```bash
cd engine && npm run gate0
```

Typecheck, lint, the DET-8 scale audit (no wall-clock time in game logic), the PROP-O3 budget
audit (the vocabulary ceilings), then the full suite (~3,900 tests; the long tail is real
simulation and takes a while). Nothing merges red. If an audit blocks you, read the reason it
prints — every entry in its whitelist carries an argument, and yours will need one too.

## Two habits that save whole sessions

- **`agent.md` is part of the rules, not documentation of them.** If you change behaviour an
  agent can see, change the served rulebook in the same commit — and expect
  `test/cast/prompt.test.ts` to demand a re-measurement of the contract excerpts (the pinned
  figures are readings, not guesses; the test's own comments show how past deltas were
  verified to the character).
- **Play it.** The highest-yield instrument this project has is a blind probe playing from
  the public surface (`engine/scripts/probe.ts`, identities kept outside the repo). The
  play-test logs in `docs/design/` are the worked examples, and several of the engine's best
  bug reports came from them.
