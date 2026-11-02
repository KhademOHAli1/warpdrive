# Private intake canonical contract, version 1

This is test preparation for candidate-local migration 0094. It adds no production
functions, SQL, schema, journal entries or migration authority. The companion real
PostgreSQL tests must first produce actual RED. Missing-function assertions establish
structural RED only; they do not exercise hashing or isolation. Root owns any minimal
scaffold needed to obtain behavioral RED and the subsequent SQL implementation.

## SQL API

All functions live in `public`, use a pinned `pg_catalog, public` search path and are
invoked with explicit schema qualification. These APIs provide canonical data, not
native session authorization, a receipt, permission to disclose content or resend.

| Function                       | Input                                            | Output                                                                        |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `private_intake_hash_v1`       | `jsonb`                                          | Lowercase 64-character SHA256 text; SQL NULL returns SQL NULL                 |
| `private_intake_message_v1`    | `public.email_messages` composite row            | Explicit JSONB message projection                                             |
| `private_intake_thread_v1`     | `public.email_threads` composite row             | Explicit JSONB thread projection                                              |
| `private_intake_attachment_v1` | `public.email_message_attachments` composite row | Explicit JSONB attachment projection                                          |
| `private_intake_baseline_v1`   | Account UUID, message UUID, in that order        | Zero or one row: `message_hash text, thread_hash text, attachments_hash text` |

The hash kernel is exactly
`encode(digest(convert_to(value::text, 'UTF8'), 'sha256'), 'hex')` for a JSONB input.
Migration 0000 installs pgcrypto. This uses PostgreSQL's JSONB representation rather
than JavaScript object insertion order. SQL NULL differs from the JSON value `null`.
No locale-dependent text formatting, `to_jsonb(whole_row)`, `row_to_json(whole_row)`,
`SELECT *` projection or removal of null-valued keys belongs in a v1 projector.

All selected timestamptz fields become JSON numbers of signed integer Unix
microseconds: `(extract(epoch FROM value) * 1000000)::bigint`. A NULL timestamp is
an explicit JSON null. The tests retain a `.123456` fractional instant and change
both TimeZone and DateStyle on the same pinned transaction connection.

## Fixed field sets

Field names below are the output JSON keys. Other fields retain their stored JSON
type and value. UUIDs and citext addresses are represented as JSON strings. Array
order is preserved, including references, recipients and labels. The attachment
collection is the separately ordered array described below.

- Message: `id`, `thread_id`, `account_id`, `gmail_message_id`,
  `provider_message_id`, `rfc_message_id`, `in_reply_to`, `references`,
  `message_fingerprint`, `direction`, `from_email`, `from_name`, `to_emails`,
  `cc_emails`, `subject`, `snippet`, `body_html`, `body_text`, `sent_at_us`,
  `tracking_enabled`, `created_at_us`.
- Thread: `id`, `account_id`, `gmail_thread_id`, `provider_thread_id`, `subject`,
  `deal_id`, `lead_id`, `person_id`, `visibility`, `last_message_at_us`,
  `archived_at_us`, `trashed_at_us`, `remote_trashed_at_us`, `follow_up_status`,
  `labels`, `created_at_us`, `updated_at_us`.
- Attachment: `id`, `message_id`, `account_id`, `gmail_attachment_id`,
  `provider_locator`, `filename`, `mime_type`, `size_bytes`, `created_at_us`.

Adding or populating an unrelated nullable column must not change v1 output or
hashes. A future field-set change requires a new version and explicit migration
policy; it must not silently reinterpret stored v1 baselines. The schema owner's
version discriminator is `hash_version = 1`.

## Baseline collection and scope

The baseline function finds the message by both supplied account and message UUID,
then its thread by the message's thread UUID and the same account. A missing or
foreign message/thread produces zero rows, never a baseline from another mailbox.
The function itself makes no assumption that a UUID proves actor authority. The
existing native transaction must establish ownership and lock the relevant rows.

Before hashing attachment metadata, reject SQLSTATE `23514` if any attachment with
the selected message UUID has an account UUID different from the supplied account.
The existing attachment table permits this legacy inconsistent shape, so silently
filtering it out would incorrectly certify an incomplete baseline. Attachment rows
for other message UUIDs, including another mailbox owned by the same user, are
irrelevant and must not affect this result.

Hash the message projector and thread projector separately. Build the attachment
JSONB array only from rows matching both message and account, explicitly ordered by
attachment UUID ascending. The empty collection is `[]`, never SQL NULL. Hash that
array with the same v1 hash kernel. Hashing metadata does not prove attachment bytes
or authenticate a provider locator.

The tests use real PostgreSQL rows and pgcrypto, with no database mocks. They cover
the structural API, UTF8/JSONB hash semantics, exact field sets and explicit nulls,
session invariance, unrelated new columns, semantic body/link/locator changes,
attachment ordering and scope, and inconsistent foreign metadata rejection. They
do not qualify native intake authorization, immutable ledger triggers, confirmation,
CAS, retention, provider effects or migration upgrade/restore routes.

The existing schema test fixtures still use provisional whole-row hashes. Root must
adapt those fixtures to this shared kernel after actual RED, preserving their prior
oracles. This note does not modify them or claim that their behavior has passed.
