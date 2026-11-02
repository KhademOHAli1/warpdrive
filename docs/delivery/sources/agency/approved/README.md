# Warpdrive Agency Projects: implementation package

Prepared 31 October 2026, Europe/Berlin. Ali requested this plan, coordination with the active branches/chats, then a new chat and goal that begin implementation. Routine implementation within this scope is authorized; another blanket plan-approval question is unnecessary. This planning chat has not implemented or qualified the application features.

The package contains **12 work packages and 96 tasks**, covering an optional internal agency project module: client update commitments, freelancer coordination, reusable templates, feedback/revision records and quotation-dependent budgets. Every task has a concrete outcome, dependencies and expected passing tests. Tasks retain current UI, Farsi first, German second and English support.

| File | Purpose |
| --- | --- |
| [PRD](PRD-Warpdrive-Agency-Projects.md) | Customer problem, scope, value, measurable acceptance and release boundaries. |
| [Implementation work packages](PROJECTS.md) | Detailed tasks, outcomes, dependencies and required test families. |
| [CSV task register](TASKS.csv), [JSON task register](TASKS.json) | Same96 tasks in machine-readable form; initial status planned. |
| [Architecture](ARCHITECTURE.md) | Domain records, authority, activity/WF/mail/financial seams and design decisions. |
| [Coordination and conflict map](COORDINATION.md) | Inspected branches, actual owner replies, shared-file conflicts and adoption rules. |
| [Expected tests](TEST-MATRIX.md) | Explicit positive/negative/race/regional/recovery cases and exact-candidate gates. |
| [Decisions and evidence](DECISIONS.md) | User scope decisions, source evidence, assumptions and honest research limits. |
| [Implementation handoff](HANDOFF.md) | New-chat goal and concrete first execution sequence. |
| [Branch snapshot](BRANCH-SNAPSHOT.json) | Dated read-only inventory; heads and dirty paths may change. |
| [Manifest](MANIFEST.json) | Hashes, task/test counts and structural validation, not release certification. |

## Delivery order

1. **R0:** preserve sources, agree extension ownership, specify policy/data contracts, retain current-shell designs and start test-first pure domain increments.
2. **R1:** minimal project workspace and client update commitments, with required permissions, privacy and reliable internal reminders.
3. **R2:** internal freelancer assignment workflow and versioned project templates.
4. **R3:** feedback/revisions, version-specific recorded approvals and explicitly enabled, qualified shared automation.
5. **R4:** quotation-dependent budgets and bounded estimated/tracked project margin. Implement the consumer when the owning quotation/cost contract is real and reviewed. Do not build an invoice system to bypass this dependency.

Invoice preparation/issuance, financial posting, asset hosting/delivery, client/freelancer accounts and portals, arbitrary WhatsApp group synchronization and a new marketplace/plugin runtime are excluded. Existing engines/services remain canonical.

## Coordination outcome

Read-only inspection found real overlapping edits, not a conflict-free shared checkout. Sales, Privacy and Integration returned concrete handoffs; Calendar, Settings and MAIL were inspected and contacted, with any later replies recorded in COORDINATION.md. Dirty peers stay untouched. Integrated migration allocation is owned by the platform chat; MAIL currently reserves 85..93, and94 is unreserved rather than allocated. Recheck the live ledger before every schema change.

No real customer/freelancer outreach, provider connection, external message, paid service, financial action or production rollout is authorized merely by this implementation request. Controlled local tests and development are authorized. The new goal continues useful independent work while applicable external evidence is unavailable.

Regenerate task tables using `python3 build_plan.py`; validate package integrity using `python3 validate_plan.py`. Those commands validate this planning package, not application behavior.
