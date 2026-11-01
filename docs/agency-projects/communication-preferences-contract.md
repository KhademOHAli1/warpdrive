# Per-project communication preferences, proposed boundary

1 November 2026. Status: **test draft prepared, NOT RUN; production parser absent**. This is a small AP-03.1/T01/T05/T34 preparation, based on the immutable agency plan and PRD. No persistence, ownership, native workflow or release acceptance is claimed.

Root's current source-check batch freezes the existing tracked feature source. To preserve that candidate, the draft lives outside `src` at `/Users/ali/Documents/Codex/2026-10-31/warpdrive-agency-projects-implementation/work/communicationPreferences.test.ts.draft`. Its future destination is `src/features/agency-projects/communication/communicationPreferences.test.ts`; that source test has not been created. The relative `./communicationPreferences` import is deliberately unresolved preparation. Only this draft and contract are owned by this increment. Previous review source behavior is unchanged. Root subsequently formatted/split its suites and qualified all 32 feature files with 341 units and scoped static checks. A byte-identical recovery copy of this unexecuted draft is committed as `test-preparation/communicationPreferences.test.ts.txt`; its `.txt` suffix keeps it outside all test/type selections.

## Proposed feature-local request boundary

The proposed `parseCommunicationPreferenceRequest(unknown)` returns actual-style `Result<CommunicationPreferenceRequest, "invalid_communication_preference">`. This names a future pure ingress parser, not an HTTP route, database command, identity resolver or idempotency service.

One request declares one contextual preference:

```text
{
  mutationIntentId,
  preference: {
    projectId,
    personId,
    role,
    channel,
    cadence,
    conversationReference?
  }
}
```

Both envelope and nested variants are strict: unknown keys are rejected. The future browser envelope requires a stable mutation-intent UUID for one logical mutation. That intent is distinct from the canonical project/person identities and grants no authority. Parsing preserves its canonical value; replay-safe storage, idempotent service admission, entity identity, concurrency and actual transaction behavior remain later gates. This proposal does not select an upsert/replace/delete implementation or add a database store.

## Proposed bounded product fields

| Field | Intended data boundary |
| --- | --- |
| `mutationIntentId` | Required canonical UUID, using existing `canonicalUuidSchema`. |
| `projectId` | Required canonical project UUID, using the same actual schema. Syntax does not prove access or existence. |
| `personId` | Required canonical CRM person/contact UUID. No inferred authentication user, recipient or mailbox identity. |
| `role` | Required nonblank staff-authored plain text, at most 160 characters, single line. Preserve its Persian/German text, ZWNJ and permitted source whitespace. |
| `channel` | Required explicit tagged choice: `{kind: email}`, `{kind: phone}`, `{kind: whatsapp}`, `{kind: meeting}`, or `{kind: other, label}`. Other-channel label is nonblank single-line plain text, at most 80 characters. |
| `cadence` | Required explicit tagged state described below. No default from locale or channel. |
| `conversationReference` | Optional omitted-or-present reference using actual `referenceSchema`, at most 2,048 characters. Empty/null is invalid. Exact source text is preserved; it is never fetched. |

Role/channel labels reject controls and Unicode line/paragraph separators. Declared cadence text permits ordinary tab/CR/LF whitespace but rejects other C0/C1 controls and Unicode line/paragraph separators. Nonblankness is tested without rewriting source text. Literal angle-bracket or HTML-looking staff text remains plain text data; this parser does not interpret, sanitize into markup or render it. Future UI must use an appropriately escaped plain-text presentation and qualify its actual rendering separately.

The fields refer to a canonical person rather than duplicating their name, email or phone. The declaration cannot mutate global contact identity. Different canonical people remain distinct even when real CRM names/addresses happen to be shared. One person may have different per-project roles/channels, and different contacts may use the same role/channel. Independent request parsing must retain those contexts; it does not prove that a later database model safely stores their coexistence. A future uniqueness design must not collapse all preferences by person, role label, name or address alone.

## Cadence is declared context

| Cadence data | Meaning |
| --- | --- |
| `{kind: unspecified}` | No cadence has been declared; it remains unknown. |
| `{kind: none}` | Staff explicitly recorded no recurring update cadence for this context. This is not an opt-out/consent decision or a global communication prohibition. |
| `{kind: declared, text}` | Nonblank plain schedule description, at most 1,000 characters. Preserve the authored language/digits/ordinary whitespace. |

Declared text such as `هر سه‌شنبه، بعد از هماهنگی` or `Dienstags nach Rücksprache` is not parsed into dates, cron, weekdays, intervals or reminder jobs. Language, calendar, digits, country, timezone and workweek preferences neither fill nor change it. Unspecified is not silently converted to none or a weekly default. An actual next-update civil date/instant and canonical reminder intent belong to AP-03.2/Calendar integration and require their real owner contracts.

## Identity, access and effects remain separate

The strict body excludes raw name/address/phone mutations, recipients, native actor selection, authentication IDs, mailbox/connection selection, scheduling fields, access grants, sending and group-sync options. A WhatsApp or other-channel preference records a staff-declared preference only. A conversation reference provides no access grant, sync entitlement, complete conversation history or delivery fact. This preparation implements no provider, mailbox, external authentication, portal, remote fetching or communication effect.

Actual native server ownership/session/CSRF/current capability, project/person visibility and relationship checks remain unimplemented server gates. The selected person UUID is not evidence for those checks. Privacy subject relationships and every new preference/history/writer/cache/recipient boundary need explicit owner inventory/review before persistence. Raw CRM identity values stay in their existing authoritative records. The policy must not merge by name or address, infer a person from an author/email, create membership or expose mailbox data.

The PRD's last-recorded-update, manual communication provenance, sent/draft/provider certainty and reminder-completion distinctions remain separate work. This preference declaration does not mark any update sent or any commitment complete.

## Test-first and qualification status

The draft covers required UUID/intent fields, exact safe references, explicit channels, distinct cadence states, bounded preserved staff text, independent person/context declarations and rejection of authority/recipient/scheduler shortcuts. All cases are **NOT RUN**; neither missing-module red nor behavioral red has been observed. Parsing tests would still not prove database coexistence, native access, no duplicate writes, UI rendering, actual language review or integration behavior.

No runner, type/lint/build/install, database, browser, production module or commit was used for this preparation. Root first reviews the field proposal. The source-check batch has ended and its lane is released. A new selected unit lane is requested but not granted. Only after that fresh lane is granted may root place the draft at its future source location and allocate the necessary fresh guarded one-worker unit lane. The planned first red command then is:

```sh
PATH="$PWD/.runtime/bin:$PATH" bun run test:unit src/features/agency-projects/communication/communicationPreferences.test.ts --maxWorkers=1
```

This is a future reproduction instruction, not a currently allocated run. An observed missing-module failure must precede a minimal scaffold and actual behavioral assertion red before production behavior. The current AP-03.1 dependencies and owner/privacy/runtime gates remain open.
