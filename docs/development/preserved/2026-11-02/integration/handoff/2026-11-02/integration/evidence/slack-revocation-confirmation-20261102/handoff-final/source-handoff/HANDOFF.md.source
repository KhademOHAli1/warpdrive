# Slack current-token revocation confirmation, source handoff

**Native6 is UNEXECUTED. Main configured qualification, current inventory and exact-source
CI/publication remain pending. This is a bounded truthful-confirmation fix, not completion
of CONN-014, CONN-017 or CONN-018. Main is the sole publisher.**

## Four-path source boundary

Base: exact public `a7df229f33e6e47216e4e2ba3b132d9ffcfa6846`. Its Delivery tracking repair
is separate from this change. Actual git blobs for Slack and Sales1 match the retained
baseline files; both new tests are absent at that base. The Slack preimage `4eaa` is also tied
to the actual unit-red receipt. The delta contains only Slack (`2fe`), the new seven-case
unit test (`491e`), six-case PG definition (`790c`) and the existing manual registry update.
See SOURCE-HASHES.md/CANDIDATE.json and base/ plus repo/ for exact bytes and complete hashes.

The Sales1 registry change is one hunk replacing only Slack's reviewed `4eaa` digest with `2fe`.
Its a7 preimage equals the retained registry baseline; that one replacement produces the
exact frozen/private postimage. Main must still preserve newer registry metadata and
reconcile this hunk, not overlay the complete reference file onto current Main. No new
registry ID, capability, lifecycle classification or schema is introduced.

## Behavior and actual evidence

The dedicated auth.revoke response schema requires ok:true with revoked:true, or the
existing explicit ok:false token_revoked/token_expired/account_inactive current-token
conditions. Ambiguous invalid_auth, revoked:false and a missing confirmation reject through
the existing Slack request error. Request target/options, public API/errors, read request
classification, OAuth exchange, service permissions and schema remain unchanged.

[Slack's official auth.revoke reference](https://docs.slack.dev/reference/methods/auth.revoke/)
supports the distinction between actual revoked confirmation, ambiguous authentication
denial and token revocation versus app uninstall. The copied SOURCE-REVIEW.md records the
independent protocol/source assessment and its exact limits. This increment does not prove
revocation of an app installation, all tokens or an upstream refresh grant. No live call
was made for this source packet or the copied unit checks.

- Actual unit baseline on exact a7/Slack `4eaa`: **3 intended RED / 4 controls PASS** across 7.
- Actual affected unit run on Slack `2fe`: **46 PASS** (7 new, 4 existing, 23 read-classification,
  12 cancellation cases); source/unit Biome2 passed. These are container-free controlled-fetch
  results, not real-PG persisted-outcome evidence.
- Explicit manual Privacy binding review, registry30, registry Biome1 and unmodified CLI
  after maintenance passed, missing/invalid empty on private source2350. No canonical
  inventory report was adopted. The CLI was already empty before the manual amendment: the
  literal-fetch heuristic does not discover this fetcher alias. Empty missing lists neither
  forced the digest change nor auto-accepted IDs. The existing digest changed because the
  exact source boundary was explicitly reviewed. The pre-maintenance diagnostic is retained.
- Source/protocol and six-case definition reviews passed within source-only limits. Final
  native-definition Biome1 passed for `790c`. A finite source-only apply check passed against
  packet-owned a7 preimages; it mutated no repository/index/worktree and is not Main admission.

Existing receipts/logs, reviews, diagnostic, observation and frozen input/command definitions
are copied unchanged under evidence/, with source paths/hashes in EVIDENCE-COPY-MAP.json.
All actual unit failures remain failures. No new test/compiler/DB ran while packaging.

## Frozen native selection and remaining work

NATIVE6-PINS.pre-run.json and evidence/NATIVE6-COMMAND.json define one literal integration
file/all6/no filters/one fork. It covers three ambiguous acknowledgements retaining exact
encrypted bytes and pending state, two confirmed/already-unusable responses clearing only
after acceptance, and a manual ambiguous-then-confirmed retry with one disconnected event.
All require unchanged account/scopes facts, blocked ordinary local use and no callback.
The fixture uses real PG/admin/OAuth service state and total controlled fetch, not DB mocks
or a live Slack account. Supporting service/schema/crypto/test-helper/config files are pinned
inputs only, not delta paths. These 6 remain **NOT EXECUTED**; expected 6 PASS on the fix and
former-source 4 RED / 2 PASS are expectations, not a claimed native baseline/result.

Main must allocate the fresh finite native6 job and retain actual source/outcome/cleanup
evidence, then reconcile current head and complete configured typegen/full TSC, typed lint,
current privacy inventory/report and exact-source CI before its bounded publication decision.
Full disconnect races, browser CSRF/freshness, provider/installed/release acceptance and
broader CONN closure remain unproved. RESTART-AND-DATA-IMPACT.md records restart/rollback
limits. Product/pins/CURRENT/peer work and all frozen MCP packets are preserved.
