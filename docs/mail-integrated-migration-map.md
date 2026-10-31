# Integrated mail migration map

This candidate preserves the active local88 mail preview. It reconciles immutable source cuts only; PostgreSQL upgrade, clean-install, restore and installed-provider qualification are separate gates. Fingerprint91 remains reserved and is not implemented here.

Platform: `b8b2708d4076551b803451ce10d4928a87ce35cd`. Mail: `297c1dd5dbff4e19f6d1559a16bb258cc3368577`. Actual common82 snapshot SHA256: `3b26d54e4602737812ca9af0637e812df9b5d7cf198f34e2c78cd28f979dd54a`. Snapshot82 and all historical SQL/snapshots0..82 were compared through their actual Git blobs, with identical journal entries0..82.

## Forward mapping

Platform SQL/snapshots0..84 remain byte-identical. Existing journal bytes through entry84 are retained as a prefix. Each new timestamp exceeds platform84 and the preceding addition; retaining the earlier local-mail timestamps would silently skip the migrations on a platform84 upgrade.

| Original mail tag | Integrated tag | Original timestamp | Forward timestamp | Exact SQL SHA256 |
| --- | --- | --- | --- | --- |
| 0083_natural_deathstrike | 0085_natural_deathstrike | 1793446537651 | 1793452709229 | 3a91f34acc7a9ba493425fc703d739dfab7ca71cc5e568d9940e1c8b5b4fed9b |
| 0084_military_loki | 0086_military_loki | 1793447063979 | 1793452709230 | 562d6affd4ddcb70a5d9baa0ba2ac076dd5e04b32e2113e759c18471725e04e2 |
| 0085_cooing_night_nurse | 0087_cooing_night_nurse | 1793448196423 | 1793452709231 | 87171bd516d517c20756b2ce09efedf7ea0a88cd6dba58d2635bdab21ee4157f |
| 0086_early_tomas | 0088_early_tomas | 1793451580903 | 1793452709232 | e98695888d8aec834ccdff77340d5123089b335d6f011e76d4815bd89e0b2a57 |
| 0087_cool_stryfe | 0089_cool_stryfe | 1793451892308 | 1793452709233 | 6b951166dd50bdc38ee2855d0044d3a948eff9b65c355a3fd3f970b08a540586 |
| 0088_skinny_slyde | 0090_skinny_slyde | 1793452405456 | 1793452709234 | 63f9f00ae03c629b64e84a40f9d69dd21685bcafb63cb2bef609630d10e35fb0 |

## Metadata chain

The recursive three-way merge uses actual common82, platform84 and each cumulative mail snapshot. An unchanged side retains the other side; identical changes coalesce. Disjoint object keys recurse. Ordered arrays remain atomic. Scalar conflicts, delete/edit collisions and competing new objects stop with exact JSON paths. Only snapshot id/prevId are replaced. Conflict count: **0**.

| Entry | Fresh snapshot ID | Previous ID | Tables | Structural SHA256 excluding IDs |
| --- | --- | --- | --- | --- |
| 85 | 3f898dbd-ab2e-441f-a769-620c8f1f77f9 | d447ce0b-f2b8-4142-ab52-9b89b09d81af | 89 | 990b1488dc92cd77b83c380f31ba4ff75ad9ea42c19ecf2576f2c22cc727ce7d |
| 86 | 01d9f4b8-083b-424b-8563-6df993fbac52 | 3f898dbd-ab2e-441f-a769-620c8f1f77f9 | 90 | a04a977b110051ea015640824b160a80cba011cde46b017913284caac6ac99eb |
| 87 | 64e33723-f99b-4bba-9d20-7591fa031e53 | 01d9f4b8-083b-424b-8563-6df993fbac52 | 92 | d41406073dfc762523561914ff2d5b1c16727cb18258d7295f256605b2b44882 |
| 88 | 662809eb-8ec3-4799-9039-e34027f3be79 | 64e33723-f99b-4bba-9d20-7591fa031e53 | 92 | 34136c710ab84ae8f356d85f18c353078822d70c6a815a4510c95a08dcf25590 |
| 89 | 0594f50a-9955-42c5-bafb-659b73355dba | 662809eb-8ec3-4799-9039-e34027f3be79 | 92 | 97f74af2af8355c704dd78a8966f4e22912c3f9f71caa2d7fc65ca5971bb4065 |
| 90 | 9d8a2311-4709-469f-856e-5b3a3d7fc5d8 | 0594f50a-9955-42c5-bafb-659b73355dba | 92 | 89cbe4c572fdc275828d9ffca7022e8c212fa145ab3ca0a4bf572511f9068056 |

Structural hashes use recursively sorted JSON object keys, retaining array order. All seven platform table definitions remain intact alongside the mail tables and six modified email tables.

## Guards and remaining qualification

The platform84 SQL is retained unchanged, including the SQL-only `workflows_published_version_fk`, `workflow_version_immutable()` and `workflow_versions_immutable` trigger. Snapshot/no-schema-diff checks cannot establish these custom guards; PostgreSQL tests must inspect and exercise them. Mail87 retains the corrected ordering that creates `email_messages_id_account_uq` before its locator composite FK, and retains Gmail UUID/provider-identity backfills.

The script does not modify schemas, credentials, runtime configuration, original previews or Git history. Obsolete isolated-mail SQL names are removed only in this candidate. The six forward SQL bodies are exact copies under new names. Divergent installed/local88 histories need a separate qualified path; this sequence is for the agreed platform84 baseline.

Reproduce in a fresh pending merge of the two immutable cuts:

`bun scripts/mail-migration-reconcile.ts --root <isolated-candidate> --platform b8b2708d4076551b803451ce10d4928a87ce35cd --mail 297c1dd5dbff4e19f6d1559a16bb258cc3368577`

The default is read-only. Add `--write` only for the isolated candidate: it checks exact HEAD/MERGE_HEAD, historical file hashes and absence of unexpected migration files before writing. It never stages or commits. Tests: `bun run test:unit scripts/mail-migration`.
