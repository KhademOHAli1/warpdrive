# Native Calendar reminders: local qualification snapshot

Work item: [technical support #907](https://github.com/KhademOHAli1/warpdrive/issues/907). Human journey acceptance remains on [#83](https://github.com/KhademOHAli1/warpdrive/issues/83).

This snapshot precedes production-build and browser qualification. Its source base is `6101e35f054c9a203b385222f26d2ff6889e7c6b` plus the Calendar, migration and inventory increment. The live work item records later results and the included main revision.

The native editor records an authored event time zone and an explicit in-app reminder choice. All-day reminders use a deliberate civil clock. Legacy events receive no invented zone or historical receipt. An uncertain create locks resubmission until the user checks Calendar; it does not have a durable create-operation receipt. Editing, cancelling and retrying use the current actor and reminder generation. Delivered state remains a tombstone when its notification is removed.

Observed local checks:

- Configured Next type generation, full TypeScript, affected typed lint, translations and 39 component/guard cases passed. The first static failure and its corrections remain separate evidence.
- The unmodified inventory CLI reported empty missing/invalid lists for exactly 2,399 eligible source files. All 31 registry/coverage cases passed. Lifecycle capabilities and installation gates retain their existing status.
- The actual 103-entry migration candidate was generated with the pinned tool. Historical SQL/snapshots and the first 102 ledger entries were preserved. One native run passed 47 cases and failed the new upgrade fixture's incorrect repeat-success flag. The corrected upgrade case then passed separately, including exact ledger equality on repetition, legacy row/zone preservation and one delivered notification/intent receipt. This is not a single green 48-case run.
- The remaining fairness case passed in an earlier bounded private-schema cut. Its original red evidence and the effective-due-time correction are retained; it is not a canonical-upgrade or full-worker acceptance result.
- Final configured formatter CHECK passed for all 47 Calendar files after three test-only fixed-point corrections.

The worker cases exercise real local PostgreSQL and pg-boss registration, boot/restart, duplicate/stale nudges, cancellation, current-recipient authority and retry behavior. The supported native reminder channel is in-app. Legacy notification/email behavior is a separate boundary. There is no customer-provider, installed deployment, release or localized human acceptance claim in this snapshot.

The new `activity_reminder_intents` table holds activity-linked temporal and current-outcome metadata. Hard activity deletion cascades; soft cancellation retains it; notification deletion clears the link while preserving the delivered tombstone. No expiry or lifecycle adapter is activated. Discovery coverage explicitly marks this store unsupported until purpose-specific subject and lifecycle behavior is qualified.

Operator-local receipts are identified in the companion JSON. They are local evidence, not hosted artifacts. The original failed runs are retained alongside the later corrections.
