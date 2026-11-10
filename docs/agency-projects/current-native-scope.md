# Current native project increment

This adopts the existing local Agency create/read/start and list work into the current
application. The original twelve-package, ninety-six-task programme remains unchanged.
Supporting review-history, template-preview and pure policy components are retained; this
increment does not enable their future persistence or execution journeys.

The `/projects` page uses the ordinary authenticated application shell. The module defaults
to disabled and an accepted active administrator can enable it. Project creation is a
separate high-risk `project.create` grant, false by default for regular users. The first
creation screen selects a visible client organization and accepted active internal owner.
The service also validates explicit deal/person/organization anchors and their coherence.

Create, read, start and every list continuation recheck the current native session, accepted
active staff and persisted module gate inside the existing current-authority fence. Short
CRM relation locks cover older background writers before project/intent locks. Both creator
and selected owner must independently see every creation anchor. Current private project
ownership or explicit membership is required; native administrator status supplies no
project-membership bypass. Start uses the existing revision CAS and immutable history.
Session expiry is rechecked after the operation before committing. These paths do not touch
sessions to establish authority.

Server actions validate input and expected account, with CSRF checks before writes. Generic
denials or transport failures retain uncertain creation/start outcomes rather than asserting
noncommit. Actor-bound request identities serialize retries; changed payloads conflict.
An installation-key-derived, Agency-domain HMAC binds the complete receipt context and
semantic input without retaining plaintext command values. Cleared, disposed, malformed
or wrong-key payloads cannot become fresh writes. Keep the installation key with backups;
key rotation and automatic retention/disposal are separate work.

The native list applies membership and current visibility for every linked CRM record before
filters, ordering and limit. Continuations preserve PostgreSQL microseconds. Current Main
has no activated record-processing restriction adapter, so the applicable additional SQL
ceiling is explicitly empty. This provides no new privacy-case disclosure authority and
does not claim restriction, export, erasure, retention, backup or installed acceptance.
Future applicable restrictions must be applied at the same pre-limit boundary.

The original dirty workspaces and a private hash manifest were preserved. Historical
fixture overlays/configurations and a rejection-only authority prototype were not installed
as runtime code. Canonical migration `0112_agency_projects` follows the reconciled `0111`
lineage, registers all five models and retains manual title validation and immutable
history/receipt triggers. A fresh canonical PostgreSQL schema passes all77 Agency cases.
A populated `0111` upgrade preserves CRM, identity, sessions, preferences, private case and
automation rows, then exercises native create/start/replay and an idempotent migration rerun.
These are local PostgreSQL18.1 checks, with synthetic data. Combined-revision CI, browser
evidence and installation acceptance remain separate; the historical private SQL ordinal
is not a canonical migration allocation.
