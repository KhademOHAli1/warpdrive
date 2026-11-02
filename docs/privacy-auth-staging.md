# Authentication staging qualification

DPL-29 preparation tooling. Source tests and loopback TLS observations do not establish installed acceptance. The installation operator must supply the staging facts and actual evidence. This tooling does not send mail, change credentials, register a passkey, deploy code or accept an installation.

## Prepare without network access

Use the package-pinned Bun from the repository root:

```sh
export PATH="$PWD/.runtime/bin:$PATH"
bun scripts/privacy-staging-auth.ts
```

The default command was exercised on 31 October 2026. It returns a versioned JSON report with `status: OPEN`, `accepted: false`, the canonical command, preparation time, required EN/FA/DE locales, nine missing inputs and twelve open gates. Exit code zero means a report was generated successfully. It is not acceptance or permission to publish/deploy.

`--input "/path/to/protected/staging-run.json"` loads at most 64 KiB from a regular JSON file. Keep it outside the checkout. The file contains nonsecret reference UUIDs and installation metadata, never credentials, recovery links, session cookies, recipient addresses or identity documents. Unknown fields, malformed URLs, user-info/query/fragment-bearing targets and invalid revision formats are rejected with a stable code; contents and filenames are not echoed in errors.

The operator input register is:

| Input                          | Required fact or protected record                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin`                       | Exact HTTPS staging origin, with no path, user-info, query or fragment. Installed mode requires a domain; loopback/reserved test names are synthetic. |
| `revision`                     | Exact 40-character lowercase Git commit deployed to that origin. This is an expectation until matched to deployment evidence.                         |
| `operatorRef`                  | Existing designated operator identity reference. The harness does not create or infer that identity.                                                  |
| `secretStoreSetupRef`          | Reviewed record of where required auth/SMTP credentials are provisioned and how the runtime receives them. No secret values.                          |
| `recipientSetRef`              | Protected register of designated disposable test mailboxes and their owners. No address list in the report.                                           |
| `externalMailAuthorizationRef` | Specific authorization for the staged reset/notice test messages, recipients, revision and test window. The harness never sends them.                 |
| `physicalDeviceSetRef`         | Designated physical passkey devices, browsers/platforms and authorized test account references. A virtual authenticator cannot replace these.         |
| `testAccountSetRef`            | Disposable staged test accounts and the permitted recovery/MFA scenarios.                                                                             |
| `deploymentEvidenceRef`        | Integrity-checked deployment manifest or equivalent operator evidence tying the actual origin to the expected revision and runtime configuration.     |

Each `*Ref` is an opaque UUID identifying a protected operator record, not the record's contents. Unknown facts remain null. Supplying a reference is a declaration, not proof that its underlying action happened.

## Optional anonymous HTTPS observation

The explicit probe mode makes at most three anonymous `GET /login` requests, one per locale, using the application's locale cookie. It never follows redirects or sends an authentication credential. It checks the normal certificate chain/hostname verification, HTTP status/content type, and the HTML language/direction. It records a SHA-256 of the bounded public response, rather than retaining HTML, cookie values or bearer links.

Probe execution requires both `--probe` and a configuration containing the actual operator-authorized target/revision plus a matching, unexpired `probeAuthorization`. Authorization is rechecked before each request:

```json
{
  "version": 1,
  "environment": "installed",
  "origin": null,
  "revision": null,
  "probeAuthorization": null,
  "evidence": []
}
```

Replace null target values only after the actual staging input is supplied. `probeAuthorization` has `{ id, origin, revision, expiresAt }`, with a protected authorization-reference UUID, the same origin/revision and an ISO instant. Then run:

```sh
bun scripts/privacy-staging-auth.ts --input "/path/to/protected/staging-run.json" --probe
```

The CLI uses the runtime's certificate trust. The internal probe API can receive a private CA certificate as an additional trust root; certificate and hostname checks stay enabled. There is no insecure TLS option. Responses are capped at 512 KiB each with a five-second wall-clock deadline per request, and the complete command has a 30-second AbortSignal. Trickle traffic cannot extend the deadline. Completion, failure and cancellation release the timer and requests. A redirect, invalid certificate, unexpected locale or oversized response produces an explicit failure with completed observations only.

Probe results always retain `accepted: false` and `revisionVerified: false`. A TLS/login observation cannot prove the deployed source revision, secure authenticated session cookies, SMTP settings, actual delivery or physical passkey behavior. Synthetic mode is explicitly labeled `synthetic`. The ordinary probe does not create an authenticated session, so an absent session cookie is not counted as a successful cookie check.

## Real evidence still required

The preparation report tracks these gates separately:

| Gate                       | Required staged exercise                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployment_revision`      | Reconcile actual deployment/configuration and expected revision before applying other receipts to the candidate.                                     |
| `https_origin`             | Authorized observation of the actual domain and trusted TLS, including EN/FA/DE login direction.                                                     |
| `session_cookies`          | Authenticate disposable accounts and inspect Secure/HttpOnly/SameSite/path policy without retaining cookie values.                                   |
| `smtp_tls`                 | Exercise the actual configured SMTP TLS/certificate/hostname behavior, including failure handling. Loopback plaintext SMTP evidence is insufficient. |
| `external_reset_delivery`  | Specifically authorized reset delivery to designated external test mailboxes; protect links and minimize captured content.                           |
| `external_notice_delivery` | Specifically authorized notice delivery and receipt at designated test mailboxes, scoped to current implemented notice behavior.                     |
| `physical_passkey`         | Register/use the designated physical devices against the actual origin. Record physical versus virtual provenance explicitly.                        |
| `fallback_recovery`        | Exercise permitted fallback while retaining MFA/passkeys and revoking old access as designed.                                                        |
| `localized_recovery`       | Complete the actual EN/FA/DE recovery journeys, including Farsi RTL and selected display preferences.                                                |
| `origin_csrf`              | Exercise cross-origin/cross-site rejection against disposable staged accounts under the actual proxy/origin configuration.                           |
| `expiry_replay`            | Confirm expired/replayed recovery proofs deny and prior access remains revoked on the staged revision.                                               |
| `provider_boundary`        | Reconcile the configured external provider tenants/capabilities and any reviewed disabled-provider exclusion.                                        |

Optional `evidence` entries use `{ id, gate, origin, revision, level, outcome, artifactSha256, observedAt, locales, deviceKind }`. `level` is `synthetic` or `installed_claim`; `outcome` is `passed` or `failed`; device provenance is `physical`, `virtual` or `not_applicable`. Evidence references and hashes locate protected, redacted receipts. They do not validate the receipt's contents. Future, wrong-origin, stale-revision and incomplete-locale records stay open. A current recorded failure remains visible even when another input is missing.

Declared installed passes yield `REVIEW_REQUIRED`, never automatic acceptance. Synthetic or virtual-device receipts yield `SYNTHETIC_ONLY`. The harness has no accepted state; DPL-29/36 require review of real receipts and operator acceptance outside this metadata-only evaluator. Keep raw secrets, reset URLs, recovery codes, session values and unnecessary personal identifiers out of reports/screenshots and the repository.

## Source qualification evidence

Initial tests failed because `authStaging`, `authStagingProbe` and `authStagingCli` did not exist. Further regressions reproduced a malformed URL throwing through validation, a recorded failure being hidden by missing input, and an expired authorization allowing the next locale request. An actual loopback TLS trickle test then exceeded five seconds and reached the caller's eight-second abort instead of a `probe_timeout` result; a dedicated wall-clock deadline fixed it. Those were fixed after the observed failures. Canonical command/timestamp tests also failed before those fields were added.

```sh
bun run test:unit src/features/privacy/qualification --maxWorkers=2
bun --bun biome check src/features/privacy/qualification/authStaging*.ts scripts/privacy-staging-auth.ts docs/privacy-auth-staging.md
bun --bun eslint src/features/privacy/qualification/authStaging*.ts scripts/privacy-staging-auth.ts --no-warn-ignored
```

The TLS tests generate disposable keys/certificates with OpenSSL in a temporary directory, run real loopback HTTPS servers, validate a trusted chain and reject an untrusted chain, then remove the fixtures. No external domain, mailbox, provider or physical authenticator is exercised by these tests. Exact final command results/revision are consolidated in the project's implementation register; installed gates remain OPEN.

Local source qualification before the consolidated commit, 31 October 2026: pinned Bun 1.4.4 and Vitest 5.0.5 passed all 18 tests in three files at 16:50:53 Europe/Berlin (5.60 seconds). Focused TypeScript with the repository's options, scoped type-aware ESLint and the ten owned code/document Biome checks passed. The default CLI was also run directly and produced the open checklist without contacting a domain. Full repository CI and installed acceptance are separate pending gates.
