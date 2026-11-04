# Appearance feedback validation — settings/UX-18, issue #866

The appearance profile runs against the normal production application in the existing
`Browser smoke checks` GitHub Actions job. It follows the original nine smoke journeys,
using the same disposable loopback PostgreSQL database, canonical migrations, seeded
native password actor, loopback HTTPS proxy and locked Chromium tooling. It adds no
application endpoint, dependency, privilege, schema or provider operation.

`scripts/browser-appearance.mjs` refuses execution outside the admitted GitHub production
fixture. Admission runs before importing PostgreSQL or browser tooling. Do not impersonate
GitHub Actions to run this against a local database or operator session.

## Exercised matrix

The runner defines 15 sequential journeys under a separate 300-second outer deadline:

- Twelve recovery journeys: EN/DE/FA × 1280/390 pixels × light/dark device media.
- One pre-upstream transport failure/retry journey for both cards.
- One genuine-success response ordering journey followed by System changes.
- One genuine-CSRF-denial ordering journey followed by System changes.

Every recovery journey checks actual theme success, actual missing-CSRF rejection and
keyboard Retry, deliberate density draft/Save rejection and Retry, applied density after
acknowledgment, disabled unchanged Save and authenticated reload persistence. Immediate
theme cookie/paint, failed-theme rollback, failed-density draft retention and long feedback
geometry are checked directly. The exact local saving/saved/error text, one named live
region per card/role, atomic announcement markup and absence of contradictory simultaneous
success/error are asserted. Accessibility snapshots and screenshots are retained.
At narrow widths, density feedback must use the card's available content width, with
Save/Retry below it. This prevents a long localized error becoming a word-wide column.

The action probe holds only genuine typed Next action responses and blocks unsupported or
unscheduled actions. It validates the root-selected Flight result, rather than HTTP status
or an unrelated result object. Redirects fail closed. Controlled transport failure aborts
the exact preference POST before it reaches upstream; it does not fabricate a server
response or qualify committed-write/lost-acknowledgment recovery.

An independent PostgreSQL pool uses read-only connection defaults and finite query
timeouts. Held-response snapshots prove writes have committed before browser acknowledgment.
Theme writes preserve density, timezone, unrelated UI keys and other actors; density writes
preserve the corresponding siblings. Rejected, aborted, draft and no-op observations compare
the complete preference row, including its timestamp. Non-default sibling values and a
second sentinel actor make these assertions substantive. Preferences do not generate audit
records in this implementation; no audit-count claim is made.

The ordering cases hold the first real response, choose System, verify that the second
write waits, then hold its actual response. Stale success/denial must not overwrite the
newest paint, show a stale error/dialog or announce a premature Saved state. Dark/light
device changes affect System paint without another persistence action.

Recovery setup selects the matching actual light/dark theme through the real action when
needed, so density feedback is exercised in both rendered themes. Navigation/reload may
cancel a superseded same-origin document or RSC GET with `net::ERR_ABORTED`; the receipt
retains those exact classified cancellations. Other failed GETs, unexpected POSTs, browser
errors and attempted external requests fail the journey.
An aborted action stream is recorded separately only when the probe proves custody of that
exact request object and successful fulfillment of its
typed response. This classification occurs only after held-response completion and the
independent DOM/database checks. An unknown or unfulfilled POST cancellation still fails;
this is not a general allowance for failed mutations.

## Evidence and limits

The always-retained `appearance-validation-<run>-<attempt>` artifact contains a sanitized
receipt with the actual `APP_COMMIT`, production Build ID, browser version, locale,
viewport/media, exact announcement observations, database comparisons and context/browser/
pool cleanup. It contains no authentication cookie, CSRF token, request body or raw Flight
body. Each journey and the overall receipt can pass only after owned cleanup succeeds.
Page routes and context routes are separately removed with bounded `behavior: "wait"`
draining before final network verification and context closure. Late unhandled asynchronous
rejections fail the process and rewrite the retained overall receipt as FAIL; they cannot
leave a passing artifact paired with a failing command. No route exception is ignored.
The surrounding existing workflow trap stops its Next/HTTPS processes; GitHub owns service
container teardown. Preserve failed runs and diagnose their actual stage before any
correction. A timeout or setup failure is not a product assertion result.

`node --test scripts/browser-appearance-actions.test.mjs` separately checks the bounded
Flight decoder's result attribution and malformed-input rejection (16 cases), plus exact
request custody across pending/successful fulfillment, failed fulfillment, and transport
abort (three cases). Those 19 helper cases do not establish native behavior. Syntax/format
checks likewise do not establish that a browser journey ran.

The original pre-presentation native baseline remains historical and unrun. The new matrix
observes the integrated current appearance source; it cannot retroactively supply that
earlier observation. Actual screen-reader speech, perceived duplication between the global
dialog and local alert, and human journey acceptance require a named human/assistive-
technology record. Automated accessibility snapshots establish browser markup, not spoken
output. Full issue acceptance/closure, release and deployment remain separate gates.
