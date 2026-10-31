# Mail and shared integration foundation reconciliation

Prepared 31 October 2026. Ali explicitly authorized inter-chat coordination. Named ownership and the integrated migration reservation below are agreed with the platform owner; exact API implementation mapping and final qualification remain under review. Neither goal was replaced.

## Current mail ownership

The active P0/P1 mail goal uses `/Users/ali/Developer/warpdrive-integrations`, branch `codex/local-integrations`, originally based on main `8539fe8`. Current mail changes are uncommitted. The latest main auth refinements were verified byte-identical and their committed history was fast-forwarded to a1a8f6da1ce366c35002900bf33508356dfbb995, preserving every mail/regional change.

Mail owns the email domain/schema, IMAP/SMTP transports, email connection proof/check/settings workflows, mailbox identity/defaults, provider-aware inbox/composer/attachments, native authority fences, regional data conventions and their tests. Preserve all current UI and unrelated peer work. Local endpoint policy is in `src/features/connections`; it is a security primitive, not a competing generic connection registry.

Current isolated mail migrations: 0083 mailbox model; 0084 encrypted check proofs; 0085 remote folders/locators/provider IDs; 0086 atomic payload preparation; 0087 complete draft/send intent; 0088 explicit remote-trash intent. Only disposable local databases have used this mail sequence. No customer installation or external-provider qualification is claimed. The source-fingerprint locator extension is reserved as integrated0091, without changing the local88 sequence.

## Confirmed parallel foundation

The active platform checkout `/tmp/warpdrive-integrations-preview-20261031` has committed integration connections 0083 and workflow 0084. Its provider contract checkpoint is `89adc8158f3e04c14e48ed6258e14abf3f179cc7`; the currently inspected committed head including later auth/workflow work is `b8b2708d4076551b803451ce10d4928a87ce35cd`. Registry/CONN/EVT work is active there. Existing task IDs and completion evidence must remain intact. The incoming coordination document is a planning handoff; it is not evidence that shared implementation is already available in this mail checkout.

## Agreed ownership and reserved handoff

1. Platform owns canonical CONN authority/lifecycle/binding, generic credential broker and EVT admission/effects; MAIL retains its domain, native checks/proofs, current credential owner/generation fences, attempts/repair, endpoint policy, UI and IG-06. The generic broker and EVT runtime are still design contracts; no fictitious exports or Bearer encoding of passwords/API keys are introduced.
2. Preserve committed platform0083 integration and0084 workflow. Integrated slots0085..0091 are exclusively reserved for MAIL: local0083..0088 map to0085..0090; the locator sourceFingerprint extension uses0091. No shared/SMS DDL below0092. Prepare a separate combined candidate with three-way structural metadata merge against actual common0082, preserving all independent/custom constraints and stopping on conflicting common keys. Platform owns final journal/snapshot acceptance and real-PostgreSQL upgrade review. The running disposable local88 preview is preserved; divergent installed histories need separate qualification.
3. Provide typed connection binding/projection hooks for the working mail lifecycle, retaining current UUIDs, native fresh-auth guards, generation fencing, settings UI and provider-specific state.
4. Keep the email send attempt/outbox and remote-mail identity responsibilities in MAIL; define how shared delivery intents reference domain attempts. No generic retry may bypass partial/unknown outcome holds or re-submit accepted SMTP data.
5. Map ongoing mail evidence into the canonical MAIL/CONN/UX/QA rows without claiming unfinished or live-provider tasks complete. Kavenegar research and proposed logical records are in `kavenegar-qualification.md`; actual SMS provider/domain source remains pending the shared runtime interfaces. A pure, independently tested text/segment estimator is implemented without provider IO or a second engine.
6. Keep local previews isolated: mail3106/WS3107, platform3160 and the existing main preview. No live messages, calls, financial writes or paid services are authorized by local implementation approval.

## Evidence available for review

The actual common0082 snapshot, journal0..82 and historical SQL are byte-identical in both checkouts. Snapshot SHA-256: `3b26d54e4602737812ca9af0637e812df9b5d7cf198f34e2c78cd28f979dd54a`. Combined entries85..91 require new strictly increasing `when` timestamps greater than platform84 (`1793452709228`): every old local mail timestamp precedes it, and Drizzle applies migrations by that timestamp. Preserve platform0..84 byte-for-byte and exercise an actual84-to-mail upgrade to detect silent skips.

The mail implementation record is `local-integrations-progress.md`. Scoped PostgreSQL/native-TLS and FA/DE/EN UI suites are passing; final consolidated source checks, local-server/browser qualification, migration/object/key restore and external-account gates are still in progress. These checkpoints are not production acceptance or a release commit.
