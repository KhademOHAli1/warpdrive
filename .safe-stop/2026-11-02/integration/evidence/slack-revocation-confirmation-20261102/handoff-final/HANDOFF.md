# Slack revocation confirmation: final private handoff

The bounded disconnect fix has actual passing unit and real-PostgreSQL evidence. All six
persisted-outcome cases passed on the frozen four-path candidate. It is ready for Main's
current-source qualification and integration; it is not yet adopted or published by Main.

## Source and behavior

Apply only the four paths in CANDIDATE.json from source-handoff/repo/, using the exact
source-handoff/increment.patch (SHA256 b3ed5a65d43bf9737307f16b2d6c9ceb6c49e87357f6a33375e80b4417f13e7b). They are Slack's
revocation parser, its seven-case unit test, its six-case integration test and one existing
manual Slack digest in registryIdsSales1.ts. Supporting service/schema/crypto/config files
are pinned runtime inputs, not changes. No DDL, permission, API signature, public error ID,
read classification, OAuth exchange or credential-format change is included.

The parser accepts explicit ok:true/revoked:true and existing explicit unusable-current-token
conditions token_revoked, token_expired or account_inactive. Ambiguous invalid_auth,
revoked:false and absent confirmation retain the existing request failure. The unchanged
service can therefore retain encrypted retry material and local blocking until accepted
confirmation, then clear credentials and record the disconnected transition. Token
revocation does not establish app uninstall or revocation of every token/upstream grant.

The original source-only apply check passed against exact a7 packet preimages. A later
read-only check of current canonical Main df26904d3daebecf3428d6fec303be098aa9d3ab fetched exactly the two modified
published blobs: Slack4eaa and Sales1b587 still match those preimages byte for byte. See
CURRENT-MAIN-PREIMAGES.json and current-main-preimages/. No current-head apply, whole-main
scan, new-path absence check, compiler or adoption is claimed. Main must reconcile at landing,
preserving newer registry metadata and applying only the reviewed digest hunk.

## Actual checks

- Seven-case unit baseline: 3 intended RED and 4 passing controls on Slack4eaa. Failures are
  preserved; no native baseline result on the former parser is claimed.
- Affected unit selection on Slack2fe: 46 PASS (new7, existing4, read23, cancellation12).
  Source/unit Biome2, registry30/Biome1 and final native-definition Biome1 passed at their
  recorded cuts. Exact receipts, independent reviews and source bytes remain self-contained
  under source-handoff/. Its historical notes still say native6 UNEXECUTED; those labels
  describe that older packet and are superseded only by the actual receipts here.
- Native job SLACK-REVOCATION6-GREEN-20261102-1: one literal file/all6/no filter/one fork,
  6 PASS, exit0, no setup or collection failure. Actual command3.294215s; command through
  terminal cleanup14.070198s; whole invocation14.323396s. No rerun occurred during packaging.
- Three ambiguous acknowledgements retain exact encrypted bytes/account/settings/scopes,
  pending status, zero disconnected events and blocked ordinary token access. Explicit
  revoked:true and token_revoked clear only after acceptance and record one attributed
  transition. Manual ambiguous-to-confirmed retry preserves bytes first and completes one
  transition without another exchange. The fixture uses real disposable PG, actual stored
  administrator/OAuth service state and a total controlled fetch, with no live provider.
- Terminal receipts show zero owned processes/new containers, three foreign containers
  retained with unchanged state, unchanged network/volume sets, all11 pins unchanged and
  no forced removal. The immediate snapshot is preserved separately; terminal cleanup is
  authoritative. Bun1.4.4/hash, nested no-env controls and dotenv absences are recorded.

Observed pressure was normal1, available memory50 to51percent. result.json reports a
sampled host-group maximum352720KiB; the two retained observation rows peak at260368KiB.
The accumulator samples every0.2s and retained rows every2s, so its intermediate maximum
cannot be reconstructed from those coarse rows. No continuous or Docker-inclusive
aggregate peak is claimed. native-green/ACTUAL6-REVIEW.md preserves the independent
functional/log/source review and these interpretation limits.

The copied unmodified CLI/private-inventory receipts with2350source files belong to their
recorded historical source cut. They do not describe current global/private/Main inventory.
The fetcher alias was not discovered by the literal-fetch heuristic, and empty missing
lists did not automatically approve the manual digest. Main regenerates current inventory
from actual adopted source and retains the explicit reviewed binding.

## Remaining integration and scope

Main owns current-source reconciliation, configured typegen/fullTSC, typed lint, reviewed
privacy metadata/regressions, regenerated canonical inventory/report, exact adopted-source
CI and canonical attribution/publication. The ready source patch requires no repeat of
unchanged private native6 merely because a separate static step remains.

Future operation47 and reauthorization2 definitions are excluded from the source delta,
all six runtime cases and this handoff. In-flight/concurrent reconnect-revocation races,
durable worker retries, browser/native-auth and real-provider behavior are separate scope;
token_expired/account_inactive are unit-covered, not additional native cases. These limits
add no gate to this bounded confirmation fix and establish no full CONN014/017/018,
installed/provider/browser/release/deployment or446-task completion. Main remains sole
publisher. RESTART-AND-DATA-IMPACT.md provides the next steps and restore limits.
