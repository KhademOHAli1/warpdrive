# Activity command admission: actual seams and required repair

1 November 2026. This is a source review and proposed shared contract for the
next-action queue and SP-00.5/SP-03.4/SP-07.1. It is not an implemented admission
export, a new authentication system or completed mutation qualification.

## Current source evidence

Sales `27006e4` and committed Calendar
`2803183809c646a063f78fe954c110adbb2f453f` have byte-identical activity completion,
update, actor hydration and native session source. Browser actions authenticate
through `createContext`, then pass a captured actor into the repository. Completion
and update evaluate that actor inside their transactions without refreshing or
locking its authority. Their current target mutations also lack the proposed
calendar revision/row-lock repair.

Platform `423dd155ad5f9c3f5073e5d7b47acaa346df582f` includes deal-only commit
`643738bdba1e7aba8b414a98dc0b6cdc9c17a361`. It refreshes the actor inside the
deal transaction and uses that actor consistently for policy/audit/publication.
Its two cases remove permission before invoking the command. This does not prove
native sign-out or authority revocation after hydration while a write waits.
It exports no general session-aware activity admission helper.

Calendar's working guard, revisions and membership fencing were dirty at review,
depended on unfinished schema and still accepted the captured actor. They were
not imported. The existing Sales lifecycle helper validates fresh native proof
and locks several authority rows, but applies sensitive-operation freshness and
omits managed-team/global policy/passkey fencing. Routine task completion needs
its own reviewed use of the same native authority.

Relevant source:

- `src/features/activities/actions.ts`, `repo.ts`, `activityUpdate.ts`.
- `src/server/hydrateActor.ts`, `src/features/auth/session.ts` and
  `src/features/auth/better/sessionPolicy.ts`.
- `src/features/pipelines/pipelineLifecycleAccess.ts`.
- `src/features/mcp/auth.ts` and existing durable workflow execution services.
- Platform `src/features/deals/dealUpdate.ts` and
  `updateDeal.actorFreshness.integration.test.ts` at the named commit.

## Preserve actual principal types

| Transport            | Authoritative existing evidence                                                     | Required transaction admission                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser request      | Server-owned headers/native credential checked by existing Better Auth policy       | Revalidate current native session and actor after waiting, with authority/target fencing. Ordinary activity work keeps the existing assurance policy rather than inheriting pipeline-sensitive freshness. |
| MCP                  | Existing OAuth verification before actor capture                                    | Carry actual server-verified token/grant identity and recheck its current revocation/authority. Synthetic `mcp:userId` context strings are not native sessions.                                           |
| Durable workflow job | Persisted run/version/step and actor references; current engine admission/execution | Recheck run/cancellation/version and current actor authority using existing engine records, without fabricated browser credentials.                                                                       |

An internal native session ID can support a liveness lookup only after the
transport has authenticated it. A user ID or a caller-supplied actor/allow flag
cannot serve as request proof. Unknown principal types must fail admission.
Secret credentials stay server-side and outside audit, browser payloads and logs.

## Proposed transaction contract

The owner-reviewed boundary should validate the versioned command once, admit
its actual transport principal, fence current positive actor authority, load the
target and dominant parents, then invoke the existing domain command in the same
transaction. Server callbacks should use the admitted actor consistently for
visibility, capability, actor attribution and publication.

Authority fencing needs native user/account/session, permission-set, membership
and managed-team semantics. A newly read grant must not be accepted without the
same protection as the grants already locked. Policy/passkey/token revocation
needs an explicit owning protocol; a read-before-call test cannot establish it.
Keep parent archive/deletion checks and indistinguishable denial before any
administrator visibility bypass. Secondary contact links remain individually
redacted under the existing dominant-parent policy.

Preserve the current domain writer and effect services. State, audit and local
publication should retain their established transaction behavior; shared event
outbox and communication outcomes require their actual reviewed exports. No
second activity sender, queue or workflow engine follows from this proposal.

## Required real PostgreSQL evidence

1. Hold admission before its final check, commit native sign-out, deactivation,
   group removal or team-management loss, then release. No activity, participant,
   denormalized next-activity or publication change may escape.
2. Revoke `activity.edit_any` from a visible non-assignee editor. Retain the
   assignee positive control because the canonical policy grants that exception
   only after parent visibility.
3. Revoke authority after hydration but before the write. Establish actual
   serialization or denial instead of only refreshing before invocation.
4. Revoke an MCP grant/token while its command waits. Preserve its OAuth
   transport identity and deny the write.
5. Preserve authorized durable execution while denying current permission loss
   and cancellation, without manufacturing native sessions.
6. Preserve archived/deleted-parent denial, rollback, idempotent already-complete
   handling and explicit unknown-outcome recovery.

The queue read fixtures and injected UI callbacks do not establish these cases.
The queue remains opt-in and its full quick-action/security acceptance stays
open until this shared boundary is implemented and verified. Literal unassigned
work also needs an explicit ownership/visibility design because current owner
and assignee columns are non-null.
