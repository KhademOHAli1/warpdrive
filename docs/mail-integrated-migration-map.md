# Canonical MAIL migration map

This map records source consolidation of completed MAIL `46f7b1bb76e4bea2a082112eb11dfa801f4ffdd4` onto canonical main `b64a9fb4c4920aea8f4c0e56e6a2568d2f106560`. Published canonical SQL, snapshots and journal entries 0000–0087 remain unchanged. Original MAIL SQL/journal/snapshots are archived verbatim in `docs/migration-history/mail-original`; original CONN83/Workflow84 artifacts remain under `platform-original`.

Each MAIL SQL body is byte-identical to its original source. New tags and strictly increasing timestamps append it after Privacy83–85, Workflow86 and CONN87. No installed ledger is renamed, rewritten, backfilled or silently bridged. Fresh schemas and exact canonical prefixes are supported; divergent historical MAIL/CONN/Workflow installations are refused before SQL and require a separate reviewed upgrade procedure.

## SQL identity and order

| Original MAIL tag                | Canonical tag                    | New timestamp | Exact SQL SHA256                                                   |
| -------------------------------- | -------------------------------- | ------------- | ------------------------------------------------------------------ |
| 0085_natural_deathstrike         | 0088_natural_deathstrike         | 1793540158005 | `3a91f34acc7a9ba493425fc703d739dfab7ca71cc5e568d9940e1c8b5b4fed9b` |
| 0086_military_loki               | 0089_military_loki               | 1793540158006 | `562d6affd4ddcb70a5d9baa0ba2ac076dd5e04b32e2113e759c18471725e04e2` |
| 0087_cooing_night_nurse          | 0090_cooing_night_nurse          | 1793540158007 | `87171bd516d517c20756b2ce09efedf7ea0a88cd6dba58d2635bdab21ee4157f` |
| 0088_early_tomas                 | 0091_early_tomas                 | 1793540158008 | `e98695888d8aec834ccdff77340d5123089b335d6f011e76d4815bd89e0b2a57` |
| 0089_cool_stryfe                 | 0092_cool_stryfe                 | 1793540158009 | `6b951166dd50bdc38ee2855d0044d3a948eff9b65c355a3fd3f970b08a540586` |
| 0090_skinny_slyde                | 0093_skinny_slyde                | 1793540158010 | `63f9f00ae03c629b64e84a40f9d69dd21685bcafb63cb2bef609630d10e35fb0` |
| 0091_mail_source_aliases         | 0094_mail_source_aliases         | 1793540158011 | `709dd3f02d8e9ada8dcd6e7277d80dd8baf180b2c5398eb25cddd8b91c944aff` |
| 0092_mail_delivery_observations  | 0095_mail_delivery_observations  | 1793540158012 | `2f0e17fec225d54a39a3c549df63d661d0c67eba9ca155eacefa09cd09291883` |
| 0093_notification_send_admission | 0096_notification_send_admission | 1793540158013 | `58c694455cc4489f903e4f48c1eecdd64dc71071d9d888ad2c6936afc4ea6aa7` |
| 0094_private_mail_intake         | 0097_private_mail_intake         | 1793540158014 | `402ed79e5dd1aa466620b07cf3715ebb70f8bc975f1b2b46e0bc570a7f573d93` |

## Combined snapshots

Every original legacy84 table and metadata component matched canonical87 before overlay; canonical87 additionally held eleven Privacy tables. Each cumulative original MAIL85–94 snapshot was overlaid independently on canonical87, preserving those Privacy definitions and the Workflow/CONN schema, with a fresh linked snapshot identity. MAIL's original changes to existing mail/phone tables remain represented. The final union has107 tables. Actual `drizzle-kit generate` against the merged schema reported no changes; this does not establish SQL-only protections by itself.

| Canonical entry | Fresh snapshot ID                      | Previous snapshot ID                   | Tables |
| --------------- | -------------------------------------- | -------------------------------------- | ------ |
| 0088            | `88d667fd-b19c-47a1-877e-f1a8e8454e64` | `d1969358-f19d-406b-9068-2473c761a661` | 100    |
| 0089            | `5bd88d5a-82f7-4488-ac8b-4dac831bfc78` | `88d667fd-b19c-47a1-877e-f1a8e8454e64` | 101    |
| 0090            | `5e944cb4-b2b0-4137-88ac-d0bd6cc49414` | `5bd88d5a-82f7-4488-ac8b-4dac831bfc78` | 103    |
| 0091            | `59fba3ee-c16c-4794-bfd4-838a43706005` | `5e944cb4-b2b0-4137-88ac-d0bd6cc49414` | 103    |
| 0092            | `1ba0416c-dfc6-4ad8-be7d-5a2b9a7e3f04` | `59fba3ee-c16c-4794-bfd4-838a43706005` | 103    |
| 0093            | `32b0916f-b158-4a08-a197-a9fda7293ca8` | `1ba0416c-dfc6-4ad8-be7d-5a2b9a7e3f04` | 103    |
| 0094            | `996b24da-63af-48c8-8920-f96d5703bdc4` | `32b0916f-b158-4a08-a197-a9fda7293ca8` | 103    |
| 0095            | `03eae812-a71f-4d7a-828d-9f90bf7becd4` | `996b24da-63af-48c8-8920-f96d5703bdc4` | 105    |
| 0096            | `92c111f4-68a7-4583-9591-65b92c97c21a` | `03eae812-a71f-4d7a-828d-9f90bf7becd4` | 105    |
| 0097            | `8ab340e9-4bab-4958-a3e2-776b68b8a23f` | `92c111f4-68a7-4583-9591-65b92c97c21a` | 107    |

## Admission and qualification

The productive migration entrypoints validate every ledger hash/timestamp against an exact canonical prefix and apply loaded SQL/receipts in one advisory-fenced transaction. Preflight checks use only the applied prefix; postflight checks use the resulting full prefix. Workflow protection checks are retained. MAIL additionally verifies ten function definitions/attributes, four unrestricted enabled triggers and three pointer-only SET NULL foreign keys, including enabled internal referential-integrity triggers. Account identity must remain non-null and outside each pointer's nulling set.

The actual PostgreSQL regression first reproduced 57 unsafe admissions with 3 positive controls, then passed the 60-case MAIL matrix and 22 existing migration/Workflow/concurrency cases. These include delivery-only prefix95 to97, unchanged no-op admission, tampered protections and actual legacy94 refusal. Full combined feature/static/hosted qualification is tracked separately in the branch consolidation receipt; no installed legacy upgrade, production restore, provider acceptance or deployment is claimed.

The retained `scripts/mail-migration-reconcile.ts` targets its historical platform84/local-mail88 profile and is read-only by default. It is not the canonical-main migration path; its planner refuses the current profile. See [canonical history](migration-history/README.md) for the current public entrypoint and support boundary.
