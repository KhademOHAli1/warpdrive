# Privacy authorization foundation

Status: local source qualification in progress. This boundary does not establish installed acceptance, full case UI coverage, completed erasure or deployment policy approval.

## Authority model

Privacy authority is stored separately from CRM role and permission sets. An administrator has no implicit privacy grant. Record ownership, team management, shared email addresses and creation of a CRM record do not establish subject identity or case authority.

| Capability           | Allowed responsibility                            | Subject verification required                                                                  |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `case.intake`        | Receive an operator-assisted request              | No, intake itself reveals no matched subject data                                              |
| `case.review`        | Review an assigned request and minimized evidence | No, subject discovery/disclosure requires its own guard                                        |
| `case.disclose`      | Read approved subject information                 | Yes                                                                                            |
| `case.export`        | Generate or publish the approved export scope     | Yes                                                                                            |
| `case.restrict`      | Apply a reviewed restriction                      | Yes                                                                                            |
| `case.erase.approve` | Approve a specific erasure preview                | Yes                                                                                            |
| `case.erase.execute` | Execute a separately approved erasure operation   | Yes                                                                                            |
| `case.hold`          | Add or review a hold                              | No, it does not itself permit destruction                                                      |
| `policy.manage`      | Manage installation policy revisions              | No case needed for global policy work                                                          |
| `authority.manage`   | Delegate a current, bounded capability subset     | No case needed for workspace grants; case membership still required to delegate case authority |
| `audit.view`         | Read authorized minimal audit records             | Case membership required whenever a case is supplied                                           |

Every case operation requires both the current workspace capability and the same capability in the current case membership. `case.intake` may operate without a case to create one. Other `case.*` capabilities require a case identifier. Sensitive capabilities cannot disable subject verification through a caller option. Case verification, approved disclosure scope, policy eligibility and specific preview approval are separate requirements; possession of a capability does not substitute for those later workflow checks.

## Server contract

`withPrivacyAuthority(db, actor, request, signal, effect)` accepts a trusted internal actor containing `userId` and `sessionId`. Those identifiers are not credentials. HTTP handlers must first authenticate the bearer cookie with `resolveWorkflowSession` or the established context, validate input, and enforce the applicable origin/CSRF contract before calling this service. Never construct the actor from submitted user/session identifiers.

The service re-reads the active non-invited CRM user, verified matching authentication identity, live non-legacy session, current authentication policy, enrolled factors, fresh proof, explicit workspace capabilities, case and membership. It returns the same `forbidden` result for an absent or unrelated case, missing grant, stale proof, revoked session or substituted actor. No subject values or credentials enter its errors.

The callback runs in the same transaction as authorization. A returned operational failure rolls back callback writes and returns the original failure value. Abort and database exceptions roll back and propagate. Keep remote I/O outside this transaction: later workers need durable intent, leases and a newly authorized local effect boundary, implemented by the corresponding export/erasure tasks.

## Generation tickets and delegation

The callback receives a ticket bound to the actor, originating session, requested capability, case, workspace authority generation, membership generation and reviewed scope/policy/recipient/verification versions. It also records the current globally activated policy version and generation under the MCP lock. Missing configuration is explicit: active version `null`, generation `0`. Activating policy fences previously issued work without rewriting every case; a case retains its reviewed policy version until explicit re-review. Later work supplies that exact ticket through `request.expected`; any changed value or lost current permission denies the effect. Rechecking occurs at each invocation, so the ticket itself never grants access.

`replacePrivacyAuthority` requires current `authority.manage` and only delegates capabilities the manager currently possesses. `replacePrivacyCaseMember` also requires the manager's corresponding current case scope and the target's workspace capability intersection. Both replace operations increment generations, including removal by an empty capability array. They emit a minimized authentication security event with actor, target, action and capability count. Full protected privacy audit and access-review workflows remain DPL-26 work.

There are no default grants or implicit administrator bootstrap. The initial designated operator grant must be established through the specifically documented operator bootstrap path; the user-facing API cannot manufacture its own starting authority.

## Lock ordering

For one actor, acquire the authentication account advisory lock, then the MCP grant lock, then CRM user, authentication identity and session row locks, then workspace authority, case and membership locks. The MCP lock also serializes authentication policy updates. The session row lock covers direct single-session revocation, which does not take an account advisory lock.

Delegation acquires all involved account locks in sorted user-ID order before MCP and sorted user rows. It obtains workspace authority locks before case/member locks. Reentrant locks in the guard use the same transaction. Do not acquire a new account or MCP lock after a case lock, and do not hold database locks during provider/storage/mail I/O. Multi-subject erasure and writer ordering still require the DPL-14/18 lock-order review.

## Evidence and remaining integration

The co-located capability, permission, authority-management, generation-fence and atomicity tests use disposable migrated PostgreSQL through the repository harness. They include administrator denial, unrelated cases, missing/expired/revoked proofs, membership loss, changed generation versions, cancellation, callback rollback and a real competing-account-lock revocation test. The implementation register records exact commands and candidate revision.

Local development evidence on 31 October 2026, before the final versioned candidate:

| Test-first step                            | Observed result                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability boundary before implementation  | Missing `capabilities` module; then one unit test passed                                                                                      |
| Guard and delegation before implementation | Missing `permissions` and `authorityManagement` modules; then the real-PG behavior tests passed                                               |
| Operational callback failure regression    | Database persisted `unresolvedObligations=1` despite returned failure; fixed transaction rollback preserves `0` and the original error Result |
| Per-case delegation regression             | Manager lacking a case capability could delegate it from global authority; fixed capability intersection denies before any membership write   |
| Global policy-generation regression        | Ticket omitted active policy version/generation; fixed ticket explicitly carries configuration state and fences changed activation            |
| Final scoped development qualification     | Bun 1.4.4, Vitest 5.0.5, real PostgreSQL/migrations through 0084: 29 tests in five files passed; capability unit test passed                  |

The final scoped command used `PATH=/Users/ali/Developer/warpdrive/.runtime/bin:$PATH`, `DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, followed by `bun run test:integration src/features/privacy/authorityPolicy.integration.test.ts src/features/privacy/authorityManagement.integration.test.ts src/features/privacy/authorityFences.integration.test.ts src/features/privacy/authorityAtomicity.integration.test.ts src/features/privacy/permissions.integration.test.ts --maxWorkers=1`. This is synthetic local evidence, not exact-commit CI or staging acceptance.

This foundation has no new public route or UI. Endpoint origin/CSRF checks, publication/download rechecks, verified-recipient bindings, controller-policy eligibility, destructive preview approval and FA/DE/EN browser acceptance must be evidenced at their later task boundaries. A passing helper test does not qualify those unimplemented paths.
