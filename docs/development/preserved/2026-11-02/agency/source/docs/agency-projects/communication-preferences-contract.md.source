# Per-project communication preferences, proposed boundary

1 November 2026. Status: **current integrated feature selection passes 367 tests in 14 files, with feature-local TypeScript, Biome and unchanged-rule type-aware ESLint**. This is bounded unit evidence for a small AP-03.1/T01/T05/T34 source increment, based on the immutable agency plan and PRD. No persistence, ownership, native workflow, full-application qualification or release acceptance is claimed.

During the earlier source-check freeze, the draft was kept outside `src` at `/Users/ali/Documents/Codex/2026-10-31/warpdrive-agency-projects-implementation/work/communicationPreferences.test.ts.draft`. A byte-identical recovery copy was committed as `test-preparation/communicationPreferences.test.ts.txt`, whose `.txt` suffix stays outside test/type selections. Root subsequently formatted/split the preceding feature suites and qualified their 32 files with 341 units and scoped static checks. That earlier result does not qualify this new communication increment. Root then copied the committed preparation to `src/features/agency-projects/communication/communicationPreferences.test.ts` after the batch closed and a new small-unit lane was granted. Ownership now covers only this new communication feature folder and this contract; preceding qualified source is untouched.

Root's first guarded selected run terminated with exit 1 on explicit `Cannot find module './communicationPreferences'`: session 93784/PID 10188, one failed suite and zero assertions, with a reported minimum 16,160,165,888 free bytes. Raw evidence is `work/communication-preferences-red-missing.log` in the implementation workspace. That import red preceded a minimal invalid-only collection scaffold; it did not establish behavioral coverage.

Root then observed behavioral assertion red on that scaffold: terminal PID 11094, exit 1, no stop reason, the selected one-worker file with exactly 25 cases, 11 failed and 14 passed. Failures were the positive context/identity/channel/cadence/reference preservation cases. Reported minimum free bytes were 15,875,805,184; raw evidence is `work/communication-preferences-red-behavior.log`. The minimum actual schema/parser was written only after those observed failures.

Root's first selected green then terminated normally: PID 12247, exit 0, no stop reason, exactly 25 of 25 cases passed, minimum free bytes 15,520,219,136. Root found all three owned run process groups empty. That result covered the initial cases only. Source review subsequently found that format-only text satisfied the initial nonblank check.

Root observed the distinct visible-text red before the fix: terminal PID 13808, exit 1, no stop reason, exactly 26 cases with 1 failed and 25 passed, minimum free bytes 15,138,484,224. Raw evidence is `work/communication-preferences-red-visible-text.log`. The minimum temporary-view fix was written after that failure.

Root's selected green after the fix terminated normally: PID 14542, exit 0, no stop reason, **26 of 26 passed**, reported Vitest duration **85 ms**, minimum free bytes 15,049,256,960. Raw evidence is `work/communication-preferences-green-refactor.log`. Root found all five owned run groups empty: 10188, 11094, 12247, 13808 and 14542. This agent ran no runner, static check, database or commit. The documentation was updated, then root requested removal of the obsolete phase-status comment from the test. Only that comment was removed; parser/schema and test semantics remain unchanged. Root subsequently ran a separately granted sequential source-check batch on the exact post-cleanup/formatted candidate: 367 of 367 tests in 14 files, feature-local TypeScript, Biome on 36 files and unchanged-rule type-aware ESLint on 33 TypeScript files passed. The integrated run includes these 26 cases. Seven batch groups were empty and the batch was released; minimum observed free bytes were 14,859,186,176. Earlier draft/scaffold/green-pending descriptions are historical. Read `qualification-feature-r1-20261101.json` for exact source hashes, terminal handles and logs.

## Proposed feature-local request boundary

`parseCommunicationPreferenceRequest(unknown)` returns actual `Result<CommunicationPreferenceRequest, "invalid_communication_preference">` through a strict Zod schema. The request type is inferred from that actual boundary, with the earlier manual scaffold type replaced by a type re-export. The schema reuses existing `canonicalUuidSchema` and `referenceSchema` and validates authored text without a transformation that would rewrite it. It is a pure ingress parser, not an HTTP route, database command, identity resolver or idempotency service. The expanded 26-case selection passed after the visible-text regression and minimum fix.

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

The nonblankness regression covers format-only `\u200c` and `\u2066\u2069` in role, other-channel label and declared cadence. Following its observed red, the minimum rule ignores Unicode `Cf` characters on a temporary check-only view before checking for remaining non-whitespace text. The actual accepted source strings remain unchanged, including embedded Persian ZWNJ and bidi-isolated visible text. Formatting characters are not categorically banned from real text. Existing length bounds still apply to the original string. These cases passed the final selected run; no native UI rendering is claimed.

The fields refer to a canonical person rather than duplicating their name, email or phone. The declaration cannot mutate global contact identity. Different canonical people remain distinct even when real CRM names/addresses happen to be shared. One person may have different per-project roles/channels, and different contacts may use the same role/channel. Independent request parsing must retain those contexts; it does not prove that a later database model safely stores their coexistence. A future uniqueness design must not collapse all preferences by person, role label, name or address alone.

## Cadence is declared context

| Cadence data | Meaning |
| --- | --- |
| `{kind: unspecified}` | No cadence has been declared; it remains unknown. |
| `{kind: none}` | Staff explicitly recorded no recurring update cadence for this context. This is not an opt-out/consent decision or a global communication prohibition. |
| `{kind: declared, text}` | Nonblank plain schedule description, at most 1,000 characters. Preserve the authored language/digits/ordinary whitespace. |

Declared text such as `هر سه‌شنبه، بعد از هماهنگی` or `Dienstags nach Rücksprache` is not parsed into dates, cron, weekdays, intervals or reminder jobs. Language, calendar, digits, country, timezone and workweek preferences neither fill nor change it. Unspecified is not silently converted to none or a weekly default. An actual next-update civil date/instant and canonical reminder intent belong to AP-03.2/Calendar integration and require their real owner contracts.

## Identity, access and effects remain separate

The strict body excludes raw name/address/phone mutations, recipients, native actor selection, authentication IDs, mailbox/connection selection, scheduling fields, access grants, sending and group-sync options. A WhatsApp or other-channel preference records a staff-declared preference only. Warpdrive does not create or accept an access grant through this parser. External conversation URLs may nevertheless contain bearer or invitation tokens that convey access outside Warpdrive. Parser acceptance proves neither harmlessness nor authority to disclose that reference. It also proves no sync entitlement, complete conversation history or delivery fact. This preparation implements no provider, mailbox, external authentication, portal, URI resolution, remote fetching or communication effect.

Treat conversation references as protected values. They must not enter routine logs/diagnostics or automatic outbound/public projections. Any future display, export or disclosure needs current record authority and the Privacy owner's reviewed field/recipient policy. This is a caller/storage/UI integration gate, not a new sender, resolver or an implemented disclosure service.

Actual native server ownership/session/CSRF/current capability, project/person visibility and relationship checks remain unimplemented server gates. The selected person UUID is not evidence for those checks. Privacy subject relationships and every new preference/history/writer/cache/recipient boundary need explicit owner inventory/review before persistence. Raw CRM identity values stay in their existing authoritative records. The policy must not merge by name or address, infer a person from an author/email, create membership or expose mailbox data.

The PRD's last-recorded-update, manual communication provenance, sent/draft/provider certainty and reminder-completion distinctions remain separate work. This preference declaration does not mark any update sent or any commitment complete.

## Test-first and qualification status

The tests cover required UUID/intent fields, exact safe references, explicit channels, distinct cadence states, bounded preserved staff text, independent person/context declarations, visible nonblankness and rejection of authority/recipient/scheduler shortcuts. Root observed both initial red stages, the initial 25-case green, the distinct visible-text red and the final 26-case green. Parsing tests still do not prove database coexistence, native access, no duplicate writes, UI rendering, actual language review or integration behavior.

The preceding 341-unit/static and selected 26-case results retain their original scopes. The later actual 367-case run and static checks qualify the current 36-file pure feature candidate, including this boundary after comment cleanup and formatting. This is not a full-repository/app/native pass. Actual storage, native authority, Privacy inventory/disclosure and UI/runtime gates remain open.

This agent has run no runner, type/lint/build/install, database, browser or commit. Actual reds preceded the initial implementation and the subsequent visible-text fix, and root observed the 26-case green above. The restored routine small-unit recovery policy remains available only for owned selected one-worker runs on existing dependencies, at most 30 seconds, with live free disk at least 5 GiB. Types, lint, build, install and PostgreSQL are outside that policy. The original selected reproduction command remains:

```sh
PATH="$PWD/.runtime/bin:$PATH" bun run test:unit src/features/agency-projects/communication/communicationPreferences.test.ts --maxWorkers=1
```

The command reproduces a selected scope; it does not imply an allocated future heavy/static/native window. AP-03.1 dependencies and owner/privacy/runtime gates remain open. Earlier qualified feature files and parser/schema source were not changed; the only post-green test-source change removed a phase-status comment. No route, store, grant or effect is introduced.
