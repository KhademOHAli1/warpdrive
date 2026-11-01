# Project-local authority: Settings decision

1 November 2026, Europe/Berlin. **Accept the project-local owner/member model and action table below for test-first implementation.** This resolves the local administrator, edit/coordinate, lifecycle, selected-owner and creator-membership questions. It does not accept a schema, migration, shared fence API, runtime writer or enabled module.

Reviewed Agency checkpoint: `6091c2234e974758b3f440060526f330f3b67c4d`, clean at inspection. Primary proposal: `docs/agency-projects/project-core-delta.md`, SHA-256 `de7945a1e55910bfca165c59b12da9cee732642081d9fbce7aeb7e601d2d1d36`. Companion context: `project-policy-v1.md`, `project-core-schema-decision-annex.md`, the nonexecutable schema notation and current pure lifecycle source. Reviewed files matched the checkpoint. No schema/type/SQL/database/native acceptance is supplied by this decision.

## Existing-project access, including native administrators

An existing project requires **current ownership or an explicit persisted read-member row**, including for an active native administrator. This is a separate project-local gate. Keep the shared native administrator semantics of global `can(actor, "project.create")` and canonical CRM visibility unchanged. Do not put a project-local administrator bypass into `can()`, reuse the global create grant for existing-project access, or cast a new project action into the shared action union.

Every operation also requires applicable module admission, current native internal-staff authentication/active status, canonical parent availability and CRM visibility, and the adopted Privacy restrictions. Mutations retain the required native freshness/CSRF boundary. Local ownership, membership and grants supply none of those other predicates. Check availability before visibility, including deal/pipeline archive and deleted/missing parents; native administrator visibility does not make unavailable parents usable.

Ownership derives local read, project-edit and assignment-coordinate eligibility without a member row. A non-owner member has read, plus independently persisted `projectEdit` and `assignmentCoordinate` booleans. False is the default for each boolean. No member row means no member grant, even if a client or stale projection supplies a true boolean. A set named Admin, team management, an assignment/contact selection, workflow permission or `project.create` alone grants no private-project access.

| Actor's current local relation | Read project/history | Project edit and start/hold/resume/complete | Assignment-coordinate eligibility | Cancel/archive/restore/reopen | Manage members/grants or transfer owner |
| --- | --- | --- | --- | --- | --- |
| Current owner | Yes | Yes | Yes | Yes | Yes |
| Read member, both flags false | Yes | No | No | No | No |
| Member, edit true only | Yes | Yes | No | No | No |
| Member, coordinate true only | Yes | No | Yes | No | No |
| Member, both flags true | Yes | Yes | Yes | No | No |
| Neither owner nor member, including native admin | No | No | No | No | No |

“Yes” is local eligibility, still constrained by current state and all common gates. A native administrator who is a member receives that row's grants, not owner powers. Revoking the global create flag does not itself remove an existing local ownership/member grant. Assignment coordination is only the local eligibility input to separately admitted assignment commands; it does not approve their command/version policy, Calendar bridge, external authentication, communications, finance or effects.

## Exact action and state rules

- **Create:** use the accepted global `project.create` check and high-risk grantor contract. The initial project is `planned`, revision zero, with `archivedFrom: null`; clients cannot select another initial lifecycle. Creation has its own history action, not a fabricated previous project state.
- **Edit title/permitted canonical CRM links:** current owner or explicit edit member, only while planned, active or on-hold. Completed, canceled and archived content requires the appropriate owner-led reopen/restore path first. Relinking checks old and new scopes and the accepted relationship-consistency rule; it cannot broaden access through a discarded/missing parent. New links must also remain available/visible to the current eligible owner. This decision grants no arbitrary relationship-edit API.
- **Start, hold, resume, complete:** current owner or explicit edit member, using the exact existing policy-v1 graph. Coordinate-only membership does not qualify.
- **Cancel, archive, restore, reopen:** current owner only, using the exact existing graph. Restore returns to the retained `archivedFrom`; restoring a completed/canceled project leaves it terminal. Reopen is a separate completed/canceled-to-planned decision. There is no archived-to-planned shortcut.
- **Member/grant maintenance and owner transfer:** current owner only. These access-maintenance commands may operate in every lifecycle state, including completed/canceled/archived, after all common gates pass. This is an explicit exception to archived business-content read-only behavior: it permits securing/maintaining access without reopening production work. It does not edit archived title/links, progress assignments, activate templates or dispatch effects.

Keep the existing transition reasons: hold, cancel, archive, restore and reopen require a reason; start, resume and complete permit one. Preserve the existing reason boundary and policy receipt. New access-maintenance history facts/reasons need their own bounded adopted encoding; this decision supplies no raw JSON history or plaintext reason storage.

Every successful changing project edit, member/grant mutation or transfer participates in the project's expected-revision CAS, advances that revision once, and commits its minimal domain history and logical request receipt atomically. The same applies to lifecycle changes through the existing policy. A no-op does not invent a new revision/history event. Exact finite wire/storage operation names and non-lifecycle old/new fact shapes remain schema-contract work; the lifecycle-only history shape is not sufficient for access changes.

## Eligible owners/members and creation defaults

Selected owners and newly admitted members must be canonical internal `users` identities that are active and have completed invitation acceptance (`invitedAt` is null), with all applicable current CRM ceilings satisfied. A UUID, email match, external contact or active-but-invited row is insufficient. Use the real native loaders plus the explicit accepted-staff checks; `assertReferenceVisible()` alone does not currently cover invitation acceptance or deal-level archive.

At creation, validate the creator and selected owner's applicable parent scope inside the final admitted transaction. The selected owner need not hold `project.create`; ownership is the explicit result of this authorized new-project creation, not a grant to an existing project.

- Creator equals selected owner: ownership supplies local rights; a member row is not required.
- Creator differs from selected owner: atomically create one explicit creator member row with read, `projectEdit: true` and `assignmentCoordinate: false`. Do not accept a browser-selected coordination grant or copy the creator's workspace flags. No other implicit members are added.
- The creator default applies only to initial creation. It never reruns during owner transfer or receipt recovery.

Later staff deactivation denies that actor's current operations, including ownership powers, without erasing permitted historical recorder/former-owner provenance. Inactivity of the owner does not by itself erase other current members' independently admitted read/edit rights. New owner/member selection and authorized historical identity display are different decisions.

## Owner transfer and retained membership

Transfer is a separate current-owner command with a stable intent, expected project revision and atomic history. Recheck current actor/old project scope and the new owner's active/accepted status and new owner/parent eligibility. Do not infer a transfer from a membership edit.

On successful transfer, the new owner immediately derives owner rights; the former owner immediately loses rights derived from ownership. **Preserve existing explicit member rows/grants exactly unless a separately explicit authorized membership change alters them.** Do not automatically materialize the former owner's derived privileges, copy flags, create a new creator row or clear unrelated memberships. The former owner retains only any independently persisted member rights that survive current CRM/native/Privacy gates; without a row, they lose project access.

An owner-associated member row does not control current ownership. The UI must not present removal of that row as removing owner access; ownership changes require transfer. Before transfer, show the actor's actual retained member rights or loss of access so the consequence is reviewable. After an unknown transfer result, reconcile using current-authorized status/receipt rules. If the former owner no longer has access, show the common unavailable outcome; do not claim the transfer failed or invite a duplicate operation.

Owner-only transfer plus private native-admin access has a deliberate consequence: an inactive or CRM-ineligible owner cannot be silently replaced by an outsider administrator. There is **no implicit admin self-enrolment or recovery bypass in v1**. Exceptional owner recovery requires a separately reviewed, auditable native/Privacy contract. Do not implement it by adding an early administrator return to the local policy.

## Required evidence and boundaries

The implementation owner should first add meaningful policy tests for the full local relation/action matrix, repeating outsider/member/owner cases for native administrators; independent edit/coordinate grants; forged client grants; creation defaults; inactive/invited selected staff; unchanged global create behavior; and the exact lifecycle graph/reasons. Include completed/canceled/archived content denial with the narrowly permitted owner access-maintenance exception, and transfer with absent/read/edit/coordinate former-owner member rows.

Actual server/database qualification must then show current native and every parent/Privacy gate, selected-owner and old/new-link checks, revision conflict/intent replay, access lost after transfer/removal, minimal non-probing denial, and atomic history/member/project/receipt rollback. Authority changes, parent relinking and admission-changing lifecycle writes participate exclusively in the selected coarse-fence protocol; ordinary pure-content paths may use shared mode only under its exact write-set rule. Real revocation-through-commit races remain required.

No source, schema, migration allocation or runtime service was changed, and no tests/builds/database operations were run for this review. This accepts the local policy for test-first source work. Actual native/server admission, the shared fence and complete writer closure, Privacy reason/replay/disposition contracts, full operation/history encoding, deletion compatibility, migration lineage and runtime enablement remain independent gates. The completed Settings implementation remains unchanged at `ec9b3f8943e42736edc6713c099fd2ef14068d0a`.
