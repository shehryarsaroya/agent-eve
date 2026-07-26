Bottom line: reject §3’s “no new asset owner.” Keep “no new account kind.” Section 4’s no-ships direction is sound, but the current proposal defines depreciation, not meaningful loss.

Severity order:

1. Critical — the “syndicate treasury” is the founder’s personal property.
2. Critical — voting and office control are priced in identities, violating A15.
3. Critical — expiring bilateral grants cannot provide succession or institutional continuity.
4. Critical — the promised office-betrayal replay is not expressible end-to-end.
5. High — works lack enough scarcity, history, consequence, and attacker risk to carry conflict.

## 1. Charter plus grants is not an institution

It works as a founder’s household or patronage network. It does not work as the pooled syndicate SPEC §8 describes.

The draft calls the treasury “a holding’s STORES” ([draft §3](/Users/shehryarsaroya/Projects/thecompact/docs/design/expansion-2026-07-25/DRAFT-1-four-systems.md:139)), but HOLDING explicitly means the principal’s body, not its assets, and the ledger has exactly `stores:<principal>` ([accounts.ts](/Users/shehryarsaroya/Projects/thecompact/engine/src/ledger/accounts.ts:60)). Therefore the “treasury” belongs to one principal—the founder or custodian.

| Function | Expressible without a shared asset subject? |
|---|---|
| Payroll | Mechanically, yes: a delegate can pay from the founder’s account. Legally, it is founder payroll, with no syndicate obligation or continuity. |
| Joint ownership | No. Contributions become gifts to the founder or remain separately owned. There are no residual, withdrawal, or loss-allocation rights. |
| Succession | No. Electing a successor transfers no title and cannot make the successor the root grantor. |
| Dissolution | No. There is no atomic freeze, creditor waterfall, return of contributions, or residual distribution. The founder owns what remains. |
| Debt | No. `maxContingentLiability` is permission to incur loss, not a debt: it has no creditor, maturity, priority, or recourse. |
| Works and revenue | They must belong to some principal, so collective construction and collective loss remain narration. |

The implemented grant is much narrower than SPEC’s promised verbs, resource selectors, period limits, approvals, and delegation rules. It contains an opaque template label, two cumulative monetary limits, expiry, and revocation ([Grant type](/Users/shehryarsaroya/Projects/thecompact/engine/src/core/types.ts:164)). `liveGrantBetween()` selects solely by grantor, delegate, and direct headroom ([book.ts](/Users/shehryarsaroya/Projects/thecompact/engine/src/grant/book.ts:164)). It cannot bind an office, charter version, work, account subset, or approval policy.

Concrete fix:

- Make `SYNDICATE` a durable, non-agent asset subject with an ordinary `STORES` account. Do not invent a second account kind.
- Give it no hands, holding, starter stake, action budget, wake budget, or civic ballot.
- Store contribution/residual claims, liabilities, work titles, membership, charter version, office terms, and dissolution state.
- Formation atomically transfers contributed assets from principals into syndicate STORES.
- Grants remain authority—not title, membership, debt, or governance.

Also divide charter rules into:

- hard constitutional rules, which make an act invalid: quorum, ring-fences, required approvals;
- typed office covenants, which do not stop an authorized act but impose public breach and bond/surety consequences afterward.

That second category is essential to A6: an act must be executable through legitimate authority yet still objectively faithless.

## 2. Founder survival and three-Reckoning expiry

Three-Reckoning expiry is good for credentials and fatal for constitutions.

As written, when the founder goes dark:

1. Its identity and stores persist.
2. Nobody else can become their root grantor.
3. Existing grants expire within roughly three days.
4. The treasury becomes operationally inaccessible.
5. Charge, payroll, and defenses fail on schedule.

That is not succession. It is an immortal inaccessible estate. It also turns offline exposure into potential institutional liquidation.

Separate three clocks:

- Syndicate, charter, property, and debt persist until governed dissolution.
- An office term lasts a meaningful political interval.
- Bearer grant credentials may still expire every three Reckonings and be reissued while the office term remains valid.
- Extraordinary powers—selling a named work, exhausting the Charge reserve, creating major debt—require fresh affirmative ratification.
- A vacancy activates a caretaker envelope limited to upkeep, existing payroll, debt service, and receiving assets.
- The founder loses privileged root control when formation completes.

Renewal also needs atomic supersession. Currently overlapping grants are simultaneously live, and the book chooses whichever has most headroom. A delegate can exhaust one “renewal” and then consume the next, multiplying the displayed limit. Add `renewal_of` plus a shared authority-envelope budget, or make renewal atomically replace its predecessor.

The correct rule is: a constitution outlives its cabinet; a cabinet’s credentials do not.

## 3. A15 attacks

The current ballot machinery is already an exact A15 violation. It is one principal/one ballot, quorum is 50% of eligible identities, and two nominations can spare a principal ([ballot.ts](/Users/shehryarsaroya/Projects/thecompact/engine/src/levy/ballot.ts:41)). Fresh identities receive three hands, 250,000 currency, 50,000 rations, and pay a 500 newcomer Levy.

A fleet can therefore:

- enroll enough newcomers to control quorum;
- vote for its preferred allocation rule;
- have every puppet nominate the controller’s main principal for relief;
- pay the puppets’ nominal obligations from enrollment faucets;
- discard them before chronic penalties matter.

The “puppets can spare only one principal” defense fails because they all spare the same controller.

Other attacks:

- **Syndicate capture:** admit 51 puppets, elect the controller’s Quartermaster, amend the charter, block recall, approve disposal, then dissolve in its favor.
- **Quorum sabotage:** inflate membership immediately before a proposal so honest members cannot reach quorum.
- **Office laundering:** puppet sureties cross-vouch and recycle the same capital unless every surety bond is simultaneously and exclusively encumbered.
- **Standing farming:** implementation counts distinct `PrincipalId`s, not independently capitalized economic counterparties ([standing.ts](/Users/shehryarsaroya/Projects/thecompact/engine/src/reckoning/standing.ts:186)).
- **Role bypass:** “four principals required” means four puppets unless each role brings independently produced, slashable value.
- **Affiliate self-dealing:** the direct delegate cannot fill its own paid role, but unrelated puppet principals can fill every role in the victim-funded venture.
- **Permanent grant denial:** the global 4,096-row grant cap counts expired and revoked rows forever ([runtime.ts](/Users/shehryarsaroya/Projects/thecompact/engine/src/sim/runtime.ts:303)). At the designed 300-principal scale and four actions per tick, a fleet can fill it in roughly four ticks. The 16,384-row spend journal has the same global-poisoning shape.

Fixes:

- Keep casting a vote free, but make binding voting power costly.
- Use linear governance units backed by non-starter produced goods irreversibly contributed or capital exclusively locked through the vote and challenge period.
- Compute quorum from those snapshotted units, never member count.
- Do not cap weight per identity; splitting identities defeats any such cap.
- Starter/faucet assets must be non-transferable, non-bondable, and ineligible for governance.
- Sureties require simultaneously locked first-loss capital; flow concentration may withhold “independent” credit without accusing anyone.
- High-impact procurement should use public batch markets or symmetric counterparty bonds, making a puppet transfer economically costly.
- Archive expired grants out of live state, retain their ledger history, and charge authority-state rent or deposit per economic envelope—not per principal.

Free pseudonyms and one-agent-one-vote are incompatible. A15 has already chosen stake-backed governance; the design should admit that explicitly.

## 4. “Works, not ships”

Ships are unnecessary. A hand plus cargo plus a staged force package already functions as an abstract mobile hull.

But §4 currently specifies only “built, visible, destructible” ([draft §4](/Users/shehryarsaroya/Projects/thecompact/docs/design/expansion-2026-07-25/DRAFT-1-four-systems.md:177)). That makes a work a replacement-cost sink. Rational agents will price world raids as another upkeep bill.

What should actually be at risk:

- the goods and multi-Reckoning coordination invested in construction;
- a scarce berth or unique site;
- refinery, market, lane-protection, or claim capability;
- queued inputs, output, custody, and dependent contracts;
- the Charge and sovereignty consequences of losing that capability;
- a named object’s age, builders, defenses, scars, and public lineage;
- for attackers, a located assault cache that defenders can capture.

Concrete work rules:

- Named, berth-bound instances with provenance and permanent ruins.
- Multi-Reckoning commissioning and repair.
- Outcomes `LOOT`, `DISABLE`, `CAPTURE`, and `RUIN`, not one delete branch.
- Capture changes map control; rebuilding does not immediately restore the old position.
- Capability dependencies are typed and displayed: “loss closes this market and exposes this claim.”
- Failed attackers forfeit produced assault goods to defender salvage.
- Hands gate presence and roles; combat strength comes from losable produced goods or bonded capital, not free hand count.
- World raids create a defense-allocation dilemma among several threatened works rather than predictable universal depreciation.
- Publish exact resolution arithmetic before implementation; the current “committed force, terrain, and seeded roll” is not enough for A2 and blurs SPEC §9’s no-dice agent raids.

Hands surviving is a feature. The emotional stake should be dispossession, humiliation, institutional collapse, and revenge—not fake death. “Lantern fell and its market went dark” can matter more than destroying a generic hull.

## 5. The legendary betrayal test

As implemented today, no legendary syndicate betrayal is constructible.

The maximum executable betrayal is bounded procurement fraud:

1. Victim V gives Q a public `quartermaster`-labelled grant.
2. Q uses delegated `create(on_behalf_of=V)` to lock V’s escrow or create contingent liability.
3. Q’s puppet principals fill the paid roles; the direct self-dealing guard blocks Q, not affiliated identities.
4. V revokes, but revocation takes effect next tick and does not unwind the commitment.
5. The receipt names actor Q, represented principal V, and the grant.

That is a capped one-victim drain, not institutional treason.

The say-do machinery cannot complete the promised replay:

- seal roles can address only venture roles, not offices ([SealRoleRef](/Users/shehryarsaroya/Projects/thecompact/engine/src/seal/book.ts:88));
- `Deed` has one principal, while delegated acts need actor and represented subject ([deed.ts](/Users/shehryarsaroya/Projects/thecompact/engine/src/seal/deed.ts:28));
- runtime currently produces deeds only from `haul` deliveries ([runtime.ts](/Users/shehryarsaroya/Projects/thecompact/engine/src/sim/runtime.ts:3973));
- works and `PREDATE` are unbuilt;
- current standing has no typed office-covenant breach cause.

A traitor can also truthfully seal its malicious plan and receive `HONOURED`. That flag proves consistency, not virtue; it cannot be the surety-slashing predicate.

A proper acceptance-test betrayal would be:

1. A syndicate collectively owns the named anchor work Lantern and its Charge reserve.
2. Q earns Quartermaster through many public terms; respected principals post real surety.
3. Members repeatedly ratify a visibly widening authority envelope.
4. Before the season finale, Q publicly promises to reinforce Lantern but privately seals a decoy operation.
5. Using legitimate authority, Q commits the full permitted reserve to a knowingly losing decoy SIEGE. A real, independently capitalized rival is waiting.
6. Revocation posts immediately but takes effect too late to unwind the commitment.
7. The rival risks its own assault cache, captures Lantern, closes the market, and starts the claim lapse.
8. Q’s typed covenant—such as maintaining a minimum Charge reserve—is objectively breached; Q and its sureties slash.
9. Members lose actual residual claims, creditors enter a real waterfall, and the successor inherits a damaged but extant institution.
10. The replay shows charter version → election → renewal chain → accepted worst case → public lie → private seal → authorized deed → revocation → capture → surety cascade.

That is legendary because everyone knowingly renewed the authority that destroyed them. Under the draft, the same story is merely “the founder let a delegate spend the founder’s wallet.”