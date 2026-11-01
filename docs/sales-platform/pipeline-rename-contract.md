# Guarded rename in the existing editor

Application source `f006b5a5026449fd2bf792439b9149ba3517feb8`. This is a partial
SP-02.3 increment. It replaces the existing rename writer and extends the current
edit page; it does not create a second pipeline command engine. Creation, stage
mutation, sharing, duplicate structure and transfer remain separate work.

## Command and authority

`renamePipeline(db, requestHeaders, raw, signal)` accepts only pipeline ID, an
authored name and the expected source timestamp. Its strict schema rejects
client actor/role/permission fields and missing revision. A new name must contain
non-whitespace text and fit the existing 255-character application bound.
Authored mixed-language text and surrounding whitespace are retained.

The existing server action validates CSRF and supplies server request headers.
The command acquires the lifecycle advisory lock before checking the existing
native Better Auth fresh-session authority. It then locks and rechecks the
current session, account, user, permission set and membership, using the same
helper as archive/restore. Missing, restricted and archived pipelines produce the
same unavailable result. Current administrators retain the existing scope bypass
but must still satisfy native freshness/MFA policy.

The pipeline row is locked. A stale revision conflicts; the new timestamp advances
by at least one millisecond. A request for the already-current name returns the
current row only after authorization, without another audit. This is an
already-achieved state check, not a durable creation-intent receipt. State and
`pipeline.rename` audit commit together; an audit failure rolls both back.

Old clients without a source revision receive a validation result and cannot
overwrite a newer name. Other create/stage mutation signatures are unchanged.
Their earlier actor projection is not newly qualified by this rename work.

## Editor recovery

The current server loader supplies the authoritative pipeline revision and a
fresh read identifier. The editor remains keyed by pipeline ID, so an in-place
refresh can retain the unsaved name and stage draft.

- Successful rename remembers the acknowledged name/revision before stage work.
  A later stage failure does not resubmit that rename; a subsequent deliberate
  name change uses the acknowledged revision.
- Conflict, unavailable source and unknown write outcome block rename retry.
  Refresh shows the current saved name while keeping the draft. Only the explicit
  review action advances the draft's source revision; the next save still uses
  server CAS and current authority.
- Expired proof links to existing account security in another tab. No new auth
  authority or policy relaxation is introduced.
- An unchanged legacy whitespace-only name does not block a stage-only save.
  An actively proposed whitespace-only rename remains invalid.

FA/DE/EN messages cover these states. Raw pipeline and stage names are not
translated by a locale change. These copy changes do not provide native human
language, screen-reader or complete narrow-layout acceptance.

## Actual evidence and limits

Focused checks passed 42 unit tests across five files and 31 PostgreSQL tests
across four files, including eight native-session rename tests. The old two
projected-session rename tests were replaced with native tests covering scope,
stale/concurrent names, rollback, queued sign-out, capability/group loss,
freshness expiry and injected authority. Existing stage/editor retry assertions
remain, with localized error expectations updated.

The later full root unit run passed 6068 tests in 972 files. The affected
PostgreSQL batch passed 245 tests in 51 files. These are combined suite totals,
not counts of newly authored tests. Final type/lint/build status belongs in
`verification.md`; a previous source's build pass does not qualify this source.

The synthetic native journey exercised fresh-proof refusal and existing password
confirmation, then a warm successful rename. In two editor tabs, a competing
saved name made the older draft conflict. Refresh retained that draft and showed
the saved name; explicit review and save then succeeded. Three intended renames
produced three audit entries; the refused conflict produced none. Farsi regional
controls, RTL editor validation and correction were also exercised. Record,
stage and saved-filter digests remained unchanged. See
`evidence/r1-rename/native-journey.json` and its original captures.

Initial cold development/RSC timeouts reset an editor and lost the first unsaved
draft during re-verification. That observation is separate from the successful
warm in-place conflict recovery. Draft durability across a full reload or error
boundary unmount remains unimplemented; no performance or interruption acceptance
is inferred. The existing auth timeout was not increased or disabled.

Concurrent global MFA-policy/passkey changes, all create/stage command races,
full cross-surface access revocation, durable creation/duplicate receipts,
retained-installation upgrade, broader FA/DE/EN review, pilot and production
qualification remain open. No new schema, sender, workflow or provider effect
was introduced.
