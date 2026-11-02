# Pipeline lifecycle candidate

SP-02.1/.2/.5/.7/.8 and SP-15 foundation, 31 October 2026.
This increment implements archive and restore in the existing company-pipelines
settings surface. First-class owners, people/team roles, transfer, removal and
scope editing remain separate approved work. No schema migration is added.

## Authority and state

`SALES_PIPELINE_LIFECYCLE_ENABLED` defaults to false at the single environment
boundary. Both new server actions enforce it, after CSRF validation. The local
synthetic profile enables it for qualification only. Existing installations keep
the current entry surface until enablement is qualified.

The domain command uses the existing native Better Auth fresh-session resolver.
It never accepts an actor, role, group membership or allow flag from client input.
Inside the transaction it locks and rechecks current native session, account,
permission set and membership before evaluating the pipeline ceiling. Native
policy continues to decide MFA/freshness. No second session authority is created.

| Context                                          | Directory                               | Archive/restore                                                    |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------ |
| Missing, inactive, revoked or stale native proof | Existing request authentication applies | Deny with re-verification recovery                                 |
| Regular user without pipeline.manage             | Deny                                    | Deny                                                               |
| Manager, unrestricted pipeline                   | Scoped metadata and permitted counts    | Allow under current capability                                     |
| Manager, group-restricted pipeline, member       | Scoped metadata and permitted counts    | Allow                                                              |
| Manager, group-restricted pipeline, nonmember    | Omit names/IDs/counts                   | Same denial as missing pipeline                                    |
| Active native administrator                      | Existing administrator bypass           | Existing administrator bypass, native MFA/freshness still required |
| Archived pipeline                                | Manager directory only                  | Restore reopens existing read paths under current permissions      |

Directory counts apply the executing viewer's existing record predicate. They
never count a hidden colleague's private opportunity as visible. Pipeline scope
is explained separately from individual opportunity access. CRM customer
organizations and authentication workspaces retain distinct identities.

Archive changes only pipeline `isArchived` and its timestamp. Existing read and
mutation paths already hide archived pipelines and their linked opportunities;
the confirmation explicitly explains this. IDs, stages, opportunities, values,
audit history and record permissions are retained. Restore changes no record
visibility rule. No automation, sender or provider action runs from these commands.

## Concurrency and recovery

The request carries the source timestamp. A locked current row is compared at
JavaScript/PostgreSQL millisecond precision, and the new timestamp advances by
at least one millisecond. A stale edit conflicts. A retry already in the desired
state returns its current revision without another audit event. Audit insertion
and state change share one transaction; a real audit-insert failure rolls both
back. Independent archive commands serialize so at least one pipeline remains
active. The configured default pipeline must be reassigned before archiving.

Deal creation repeats active-pipeline/scope admission under a transaction-held
share lock. A real PostgreSQL race first reproduced the previous hidden insertion:
preflight passed, insert waited behind archive, then inserted after archive.
The new lock linearizes creation before archive, or rejects it after archive.
The shared creation command is used by its existing callers; no new creation
engine or historical effect admission is introduced.

The directory retains search/selection on error. Its source snapshot ID comes
from an authoritative server read. Conflicts require a refreshed revision;
unconfirmed outcomes require a refreshed snapshot, not a different client array
reference. Locally acknowledged revisions survive chained operations and delayed
older server props. Re-verification opens existing account security separately so
the working selection remains available.

## Acceptance still required

Native, database and component evidence belongs in the candidate verification
record. Local tests do not establish real provider, pilot or production operation.
Broader revocation/realtime/export/cache qualification, ownership transfer,
explicit scope editing, dependency previews for literal workflow references,
stage/configuration mutation races, default-setting races, interruption/restore,
large-directory pagination/performance and full accessible/native-language review
remain open. Do not infer zero workflow dependencies from the absence of a
normalized pipeline foreign key. Do not enable the feature broadly from this
partial increment alone.
