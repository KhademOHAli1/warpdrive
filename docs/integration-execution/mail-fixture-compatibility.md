# MAIL adoption: QA-002 fixture compatibility

Source-only review, 31 October 2026. Fixture baseline:
`67eb151f228d9a2866d51266420e9fb915a77739`, including the 12 QA-002 files committed
at `bc40519b4f8f7147f6232897c26450bb8c478816`. Comparison target: the uncommitted
merge of that baseline and `571ba2cfd71361dfa886395bd10adc3b90cb0b8d` in
`/tmp/warpdrive-integration-mail-adoption-20261031`. **F** references mean fixture
source in the main preview; **M** references mean the merged MAIL working tree.
All findings below are source evidence, not executed qualification.

No tests, PostgreSQL, DDL, installation, typecheck or build ran for this review.
No fixture, production, tracker or actor-freshness test was changed. This document
does not adopt or commit the merge.

QA-002 acceptance remains: "Include visible/hidden records, admin/member roles,
stale grants, multiple accounts and known calendar boundaries without real
customer data." Verification remains fixture validation
(`docs/integration-execution/tasks.csv:419`). The historical evidence in
`crm-fixtures-qualification.md` remains bounded to its recorded source/model;
changed MAIL sources require affected verification again.

## Compatibility findings

One test's uniqueness expectation and the fixture's declared one-mailbox limit
are obsolete. No new missing-required-field failure was identified in the current
account seed: every added non-null account column has a default. The seed still
creates two structurally valid synthetic Gmail rows on distinct owners, without
covering the new provider/default/multiple-mailbox distinctions.

| Area | Existing fixture evidence | Merged model and adaptation |
| --- | --- | --- |
| Owner uniqueness | **F** `src/test/integrationPlatformFixtures.integration.test.ts:165-170` expects a second distinct address for the same owner to reject `23505`, then asserts limit one. **F** `integrationPlatformFixturesSeed.ts:153` and `integrationPlatformFixturesModels.ts:78` declare that limit. | Obsolete: **M** `drizzle/0085_natural_deathstrike.sql:1` removes user uniqueness. `src/db/schema/email.ts:45-87` permits multiple accounts per owner. Replace the expectation and false numeric limit after observing the compatibility red. |
| Remaining uniqueness | No fixture distinction among address, identity key and default constraints. | **M** `email.ts:49` retains global case-insensitive address uniqueness, `:54` adds nullable unique identityKey, and `:86` allows at most one default per owner. These need separate cases; multiple null identity keys remain legal. |
| Account count | **F** `integrationPlatformFixtures.integration.test.ts:164` expects two rows. | Still correct for this exact seed, not a product cap. Change only when deliberately adding another fixture account. Preserve per-owner isolation. |
| Default selection | **F** `integrationPlatformFixturesSeed.ts:65-83` supplies no default flag. No existing assertion proves default policy. | **M** `email.ts:56` defaults fresh rows to false. `0085:12` backfills pre-existing rows only; fixture inserts follow migration, so both have no default. Real saves choose defaults explicitly (`mailConnectionCommit.ts:63-101`; `oauth.ts:185-206`). Schema default and service policy are distinct. |
| Provider/identity | **F** `Seed.ts:70-76` omits provider; **F** `Models.ts:48` returns only id/owner/address. | **M** `email.ts:50-54` makes both existing rows Gmail with null identity keys. Add an explicit same-owner IMAP/SMTP row and safe metadata projection to qualify the new fixture model. The schema's microsoft type alternative is not a working provider claim; public views expose Gmail/IMAP (`connections/types.ts:28-33`). |
| Gmail credentials | **F** `Seed.ts:73-74` supplies unusable synthetic encrypted refresh material and empty scopes. | Still structurally valid: **M** `email.ts:74-75` and `oauth.ts:198-206` retain the Gmail columns. Keep synthetic-only status explicit. Empty upstream scopes do not establish provider authorization or CRM grant capabilities. |
| Generic credentials/version | Existing seed omits generic credentials and versions. **F** `integrationPlatformFixtures.integration.test.ts:146-150` checks encrypted Slack connection bytes only. | **M** `email.ts:58-61` defaults generation/credentialVersion to one and generic bytes/settings to null. IMAP runtime decrypts JSON and validates CheckMailboxInput (`mailConnectionRuntime.ts:48-75`), not a Gmail refresh string. Add distinct assertions for the credential columns and public redaction. |
| Capabilities/settings | No explicit fixture assertions cover history, folders, pause or capability discovery. | **M** `email.ts:62-78` supplies defaults. Checks discover capabilities (`mailConnectionCheck.ts:65-88`); save writes folders/history/password-free settings (`mailConnectionCommit.ts:74-101`). A directly seeded connected row is not a completed connection check. |
| Preferences | **F** `Models.ts:4-18`, `Records.ts:150-159` and `integrationPlatformFixtures.integration.test.ts:173-202` assert independent language/calendar/digits/zone storage. | Remain valid. **M** `src/features/i18n/preferences.ts:13-35` adds optional iranianMoneyUnit (rial/toman), not a required field. Additional money-unit coverage is optional scope, not an existing seed/equality failure. If added, update exact expected objects while preserving the independent axes. |

Fixture abbreviations Seed/Models/Records mean `src/test/integrationPlatformFixtures`
plus that suffix and `.ts`. Bare MAIL filenames mean `src/features/email/`, except
`email.ts`, which means `src/db/schema/email.ts`.

## Complete 12-file disposition

All names below start with `src/test/integrationPlatformFixtures`.

| File suffix | Disposition |
| --- | --- |
| `.ts` | Preserve Result/Zod, disposable database guard, one transaction, abort/commit certainty and cleanup (`:15-110`). No new harness. Requalify after seed changes. |
| `Io.ts` | No MAIL assumption. Preserve pre/post-await abort checks (`:1-6`). |
| `Client.ts` | No account assumption. Preserve owned Socket, safe pre-connect error observer, driver/close bounds and cleanup (`:6-46`). |
| `Models.ts` | Replace obsolete limit `:78`; extend safe mailbox projection `:48` and dataset `:73` deliberately. Exclude token/credential bytes. Preserve OAuth/native authority limits. |
| `Seed.ts` | Account inserts `:65-85` remain structurally valid but incomplete for new MAIL coverage. Explicit provider/default/version state and another account need test-first changes. Slack/CRM OAuth seeds `:36-64`, `:88-142` remain separate. |
| `Records.ts` | Roles, visibility, date-only/DST and preferences remain applicable (`:108-224`). Money-unit coverage is not a MAIL prerequisite. |
| `Native.ts` | Native identity/session rows remain applicable (`:19-72`). Keep fresh-member and MFA-pending-administrator distinctions. |
| `.integration.test.ts` | Obsolete account assertions `:165-170`; row count and Slack credential checks have the distinctions above. Preserve visibility, OAuth negative/positive controls, preferences and rollback checks. |
| `Auth.integration.test.ts` | No obsolete MAIL assertion identified. Preserve native policy and blocked-write rollback cases (`:20-56`, `:59-116`). |
| `Connection.integration.test.ts` | No account-limit assertion. Preserve private-client acquisition/startup bounds and promise draining (`:14-104`). |
| `Temporal.integration.test.ts` | Preserve canonical Nowruz/Tehran and Berlin fold/gap assertions (`:17-81`). No browser/provider localization claim. |
| `Client.test.ts` | Preserve safe error observer and native half-open teardown (`:5-68`). Framing stub is not SQL or MAIL provider qualification. |

The factory seeds no email threads/messages/attachments/drafts/locators/send
attempts. MAIL's remote-identity checks, account-bound foreign keys and draft
fields therefore introduce no required-field seed failure in these files
(**M** `email.ts:90-181`; `drizzle/0087_cooing_night_nurse.sql:35-62`;
`drizzle/0089_cool_stryfe.sql:1-5`). They need tests if added later.

The existing harness migrates the actual journal before cloning databases
(`vitest.globalSetup.ts:70-81`; `src/test/db.ts:44-80`). The merged journal ends
at 0090 (**M** `drizzle/meta/_journal.json:600-640`), rather than historical 0084.
Do not add fixture-local ALTER TABLE or renumber migrations. Clean-install and
upgrade evidence remain the migration owner's gate.

## Proposed test-first adaptation

1. Run the unchanged accounts case in the approved merged-source window. Predicted
   red: second distinct address inserts where the old assertion expects 23505.
   Record obsolete-test compatibility failure, not a new security regression.
2. Before seed edits, add assertions for member Gmail, member secondary IMAP/SMTP
   and outsider Gmail, with explicit provider/default/version metadata. Preserve
   `mailboxes.member` and `mailboxes.outsider`; add `mailboxes.memberSecondary`.
   Observe missing-secondary/default assertions fail for the intended reason.
3. Seed the two Gmail accounts as their owners' defaults and the secondary as
   non-default. Use distinct synthetic addresses/identity keys. Replace the false
   numeric limit with factual multi-mailbox and synthetic-evidence metadata.
   Do not export credential bytes through the safe returned mailbox projection.
4. IMAP credentials must be encrypted structurally valid synthetic
   CheckMailboxInput, with reserved test endpoints, explicit settings/folders/
   capabilities/versions and password-free public settings. Seed no real secret;
   call no DNS, check, transport, sync, enqueue or send from the factory. An
   identity key here is synthetic data, not verified upstream identity.
5. Use existing `listActorMailboxes` for owner-only, provider/default and
   secret-free projections. Separately test same-owner second-account success,
   global case-insensitive duplicate-address denial and duplicate-default denial.
   Isolate expected unique violations from a success transaction. Reuse MAIL's
   `mailAccountsRepo.integration.test.ts:12-81` patterns for any selected default
   switch/foreign-owner control; do not duplicate its full lifecycle/send suite.
6. Retain untouched sibling-account assertions when testing a chosen mutation.
   Native mutations must use real established session authority, as fenced by
   `mailConnectionProofContext.ts:25-85` and `mailConnectionMutations.ts:94-120`.
   A cookie preimage, MCP JTI and internal native session ID are not interchangeable.
   Pending administrator MFA must not be treated as fresh privileged authority.
7. Rerun all five fixture test files and scoped checks after minimal adaptation.
   Preserve the valid CRM OAuth refresh/rotation/replay control beside negative
   grants, required signal/Result, one transaction, owned-client observer/close,
   commit-outcome distinctions and h.close cleanup. Record a new source manifest
   and exact results; do not carry historical test counts forward.

If selected separately, rial/toman round trips must preserve FA/DE/EN language,
Gregorian/Iranian calendar, Latin/Persian digits and Berlin/Tehran zones as
independent preferences. No existing preference rewrite is required for MAIL.

## Future red commands and qualification boundary

Do not execute during the current resource hold. From the adopted, frozen merged
checkout in a separately agreed finite window, run one worker without overlapping
install/type/build work. Initial predicted compatibility red:

```sh
PATH=/tmp/warpdrive-bun144/bin:$PATH \
DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock \
TESTCONTAINERS_RYUK_DISABLED=true \
/tmp/warpdrive-bun144/bin/bun run test:integration --maxWorkers=1 \
  src/test/integrationPlatformFixtures.integration.test.ts \
  -t 'multiple service workspaces and personal accounts' \
  > /tmp/warpdrive-integration-program-private/fixtures-mail-compatibility-red.log 2>&1
```

After authoring new assertions, rerun the focused command into a distinct
`fixtures-mail-model-red.log` before editing seed code. After the minimal fix:

```sh
PATH=/tmp/warpdrive-bun144/bin:$PATH \
DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock \
TESTCONTAINERS_RYUK_DISABLED=true \
/tmp/warpdrive-bun144/bin/bun run test:integration --maxWorkers=1 \
  src/test/integrationPlatformFixtures.integration.test.ts \
  src/test/integrationPlatformFixturesAuth.integration.test.ts \
  src/test/integrationPlatformFixturesConnection.integration.test.ts \
  src/test/integrationPlatformFixturesTemporal.integration.test.ts \
  > /tmp/warpdrive-integration-program-private/fixtures-mail-green.log 2>&1
```

Run the client unit file separately with pinned Bun and
`bun run test:unit src/test/integrationPlatformFixturesClient.test.ts`.
Never race away an unfinished write promise for a timeout assertion.

This review executes none of these commands and establishes no real provider
ownership, browser sign-in/MFA, sync, send acceptance, customer-data, deployment
or release evidence. The prepared
`src/features/deals/updateDeal.actorFreshness.integration.test.ts` remains
unexecuted and untouched; its authorization regression is a separate gate.
