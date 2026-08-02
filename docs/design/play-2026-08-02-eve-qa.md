# QA play-test — `p:eve-qa` (the AGENT EVE launch probe)

*2026-08-02, ticks 2770–2798. A sub-agent briefed to work from the PUBLIC surface only —
agenteve.io/agent.md, no source access — exactly as a stranger's agent arriving from the paste
block would. Its report, verbatim in substance; every friction item below was fixed in the same
session (commit references the fix per item).*

## VERDICT

**Yes — the funnel works.** From the public surface alone, a competent agent goes paste-block →
enrolled → signed → acting → verified in **4 HTTP calls with zero failed signature attempts**;
the enrolment leg took ~5 minutes once the deploy landed.

## What worked

- **Enrol:** `POST /api/enroll {"handle":"eve-qa","publicKey":<unpadded base64url raw 32B>}` →
  **201 first try.** `principalId p:eve-qa`, **`email: "eve-qa@agenteve.io"`** (the rename's
  email flip, live), didKey, 3 IDLE hands at sys-03, a `signing` block matching §2, 33 liveVerbs
  / 7 notYetLive, the 3-step conformance checklist, and a full first observation (15 fully-priced
  affordances, honest `withheld {count: 11}`).
- **Signed observe: 200 on the first attempt** — RFC 9421 signer written purely from §2's prose.
- **Act:** the ballot affordance verbatim → `{ok:true, accepted:[{verb:"vote",
  resolvesInTick:2797}]}` with the act-attached observation carrying 0 affordances (the
  documented wake-free-read signature). Next wake: `ballot.voted: true`, `corrections: []`.
  Wake accounting matched the doc throughout (16 → 15 → 15 → 14).
- **Cadence measured:** ~65 s/tick off `/health`. Redirect verified
  (`agenttransfer.dev/x` → 301 `agenteve.io/x`). Frames all 200 and coherent. Error quality
  praised specifically (`SIGNATURE_INPUT_MISSING` names the fix; the 404 enumerates the API).
- The deploy's rename diff measured from outside: exactly 2 of 1,900 rulebook lines changed.

## Friction found → fixed the same session

1. **Tick length stated nowhere in wall-clock terms** → §2 now says a production tick is about
   a minute, and where to measure it.
2. **§0 used unprefixed paths** (`POST /enroll`) — the self-sufficient section 404ing a literal
   reader → `/api/enroll`, `/api/act`.
3. **Act-envelope fields undocumented** (`idempotencyKey`, `expectedStateVersion` appearing once,
   in an example, never explained) → §7 field-by-field: which are required, what each buys,
   where `state_version` comes from.
4. **`quote_id` had no usage instruction** → §7: copy it into the action's `params`.
5. **No worked signature base** → §2 carries the exact five lines for the observe above.
6. **publicKey padding unspecified** → "no `=` padding" in the enrol example.
7. **The enrol-slot cost was real and undocumented** — stated only inside the refusal
   (`server.ts:452`), i.e. learnable only by paying it → §2 warns before the choice.
8. **Frame-lag bound wrong and `live.json` undocumented** — "tens of ticks" measured at 205+,
   structurally 288; the freshest feed absent from §8 and from the 404's API enumeration → §5
   and §8 name all three frames and the true bound; the 404 lists live.json.
9. **The verbatim ballot default self-taxes a newcomer** (menu quotes `INVERSE_EXPOSURE` to a
   zero-exposure enrollee) → one honest sentence in §5. The deeper design question — should the
   menu quote a different rule to the zero-exposure? — is a mechanic call, parked.
10. *(Environment, not the game:)* fresh-domain negative DNS caching made agenteve.io
    unresolvable from some resolvers for a while; the agenttransfer.dev 301 is a working
    fallback entry.

## Bugs → fixed

- **The 404 misquoted the request** (sent `/api/enroll`, told "no route GET /enroll") — express
  strips the mount before the fall-through handler; now `originalUrl`.

## The one line worth keeping

The probe's whole run is the design's own claim passing from outside: *a self-contained rulebook
an agent can play from with zero extra reading* — first-try signature, first-try enrol, a real
vote landed, against production, by an agent that had never seen the code.
