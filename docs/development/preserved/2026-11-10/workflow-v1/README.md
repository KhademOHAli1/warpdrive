# Retained local workflow prototypes

The local V1 AI, mailbox-send and record-event prototypes are preserved here as source history. They were never connected to the production V1 registry or migrated schema. The integrated Workflow Studio uses the V2 runtime for these behaviors. Maintaining a second sender, event store and AI adapter would split execution authority.

Current production implementations are `src/features/workflows/v2/aiActions.ts`, `externalActions.ts`, `events.ts`, `eventOutbox.ts` and `waits.ts`, with V2 schema, native mailbox receipts and runtime tests. Provider qualification remains separate from fixture execution. These retained files are not loaded, compiled, migrated or presented as enabled features.

The manifest accounts for all 24 original untracked workflow files. Five sidebar duplicates already exist in main history; three scheduler duplicates already exist in PR991 history. The remaining 16 exact prototypes are retained under `source/` with `.source` suffixes. Their Git blob hashes identify the original bytes.
