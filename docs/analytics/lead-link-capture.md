# Private native lead link capture

This proposal extends the source evidence available to #639 and #635. The current-link report continues to use current CRM records and current permissions at both endpoints.

The disposable fixture installs the private SQL proposal as a privileged schema owner. Production admission, a reader and historical coverage are separate qualification steps.

## Evidence

`convertLead` inserts a deal and updates `leads.converted_deal_id` in one transaction. The source trigger observes distinct before and after pointers when both lead versions have a null soft-delete timestamp. The forward converter archives the lead in that update. A rollback removes both the link change and its observation. The fixture exercises the actual converter and verifies that older links and rows inserted with a pointer contribute no history.

Each private row contains its source activation, local ordinal, the two link endpoints where present, the lead UUID, a database observation clock, a top-level transaction ID and a native observation snapshot. The clock is the time of observation inside the source transaction. Native visibility determines inclusion at a later cut. Ordinals order observations within one lead's transaction and can have gaps. A same-transaction attach and reset yields two observations and leaves the original committed link unchanged. A future reader must fold writes per lead and transaction and validate its event corpus and access at an eligible cut. Row counts or apparent clock ordering cannot establish business attempts or acceptance.

`convertDealToLead` creates a different lead, archives the source deal and writes generic change-log records. It leaves the old forward pointer as it was and the new lead unlinked. That path therefore produces no forward-link observation. Forward conversion of that new lead produces a separate link observation. Legacy, soft-delete and restore, hard erasure, and unmatched source paths leave historical coverage unknown. The proposal holds no actor, owner, title, email, channel, reason or activity payload.

## Capture and privacy boundary

Installation briefly locks the source table against concurrent writers. A preactivation repeatable-read transaction that attempts a relevant source update must retry if it cannot see the activation row. Each admitted capture holds a shared row lock on the activation until the source transaction ends. Retained-source erasure waits for those writers, stops the activation and deletes the explicitly matched rows in the same read-committed transaction. A fresh delete snapshot includes writers admitted before the stop. Writers whose old transaction snapshots cannot lock the updated activation must retry. A stopped activation never restarts through its ordinary update path.

The ledger has source foreign keys with `ON DELETE CASCADE` on the lead and each deal endpoint. Hard deletion removes each matching private observation, including an earlier pointer to a destination no longer linked. Existing CRM references still govern when the source records can be removed. Soft deletion preserves evidence for the owning privacy workflow to resolve. Source UUIDs and transaction timing are linkable and inherit privacy and access controls.

For privacy cases retaining a source record, the bounded owner-only helper accepts up to 500 explicit lead and deal keys. It fences new observations by stopping the whole generation, including capture for unrelated future updates. An authorized privacy executor still has to resolve subject keys and lineage, enforce case scope and legal holds, set operational timeouts, coordinate backups and other replicas, and qualify any future reactivation or source recreation. The helper covers this ledger alone. After erasure, an empty ledger or incomplete event chain cannot establish a zero count or a complete history for the affected period.

The schema owner owns the tables, functions and trigger. Ordinary runtime roles need their existing source DML only. The disposable fixture uses a nonowning role to exercise the native trigger and show that direct ledger access, source trigger disablement and erasure execution are denied in that fixture. Production review needs the effective grants, membership, default privileges, owner separation, and erasure and DDL operation permissions of the installed roles.

## Evidence still needed

Repeated or returned handoff needs a stable handoff attempt identity and governed commands that attest initiation, acceptance, rejection or return, including the assigned owner at the event and an authorized structured reason where needed. First response needs a governed response taxonomy, a verified timestamp and deduplicated source identity joined to the eligible attempt. Generic lead/deal audits, edits, assignments, ordinary completed activities and carry-over activity rows lack that evidence. Historical analytics should continue to show those measures as unqualified until eligible coverage, erasure-aware admission and current authority can be established.

The disposable PostgreSQL fixture is prepared for hosted native validation. Heavy local validation remains queued.
