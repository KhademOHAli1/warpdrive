# Workflow preference validation

The UX-19 / #867 validation pack exercises the existing personal preferences at
`/settings/workflow`. It changes no production preference, persistence model,
permission, schema or route. Phone formatting and sound remain in their current
location; relocation needs a separate information architecture decision.

## Exercised contract

Six scenarios run in each of English and German desktop and Persian 390px RTL:

- Rapid changes to a generic Boolean flag and to the dedicated Won preference
  retain ordered persistence and the newest local intent.
- A failed newer write rolls back to the last acknowledged success, reports the
  genuine failure through the existing global dialog and permits another attempt.
- A superseded failure does not open a stale error dialog or undo the newer choice.
- Rapid master/child open-details changes preserve the full cumulative object.
- Choices for two different keys remain locally usable and both persist without
  overwriting sibling preferences.

The installed Next router queues server actions sequentially. The different-key
scenario checks both local choices while the first response is held, then checks
their actual ordered server writes. The existing focused component cases separately
exercise independent per-key application queues with mocked action promises. Neither
observation is a claim that native server action requests run concurrently.

The pack uses native password login, the production application, real server actions
and disposable PostgreSQL. One real password login per locale supplies in-memory
session state for that locale's isolated contexts. State is cloned, never written to a
file, and cleared during cleanup. This avoids exhausting the existing login budget;
production rate limits and authentication checks remain enforced. A strict probe
forwards supported non-mail preference
requests, decodes only the action result selected by the genuine Flight root and
holds the actual response. It never manufactures a result. Removing the readable
CSRF cookie creates a real rejected action; the cookie is restored for recovery.
The database is observed before response delivery, then the visible state and a real
reload must agree with the expected persisted result. Unscheduled preference actions
are blocked. Unsupported action shapes and malformed results cannot qualify.

## Isolation and evidence

Environment admission runs before importing database or browser clients and refuses
`DATABASE_URL_FILE` overrides, shared databases and nonlocal endpoints. The existing
synthetic actor and a second actor make preservation checks nonvacuous. Non-default
timezone, density and unrelated UI values remain present. Each write checks the
complete actor row except its legitimate update timestamp and checks every other
actor's complete preference row. A denied action must preserve its timestamp too.

The pack preserves external HTTP/WebSocket blocking and service-worker blocking.
Each journey closes its owned context before it can pass. Final cleanup independently
closes the browser, restores the exact pre-pack actor preferences and timestamp,
preserves unknown UI keys and ends its database pool. That restoration is disposable
fixture cleanup, not an application undo or customer migration capability.

The existing nine smoke journeys run unchanged before the separate bounded preference
command in the single browser job. No dependency root or additional check context is
introduced. The dedicated `workflow-preferences-validation-<run>-<attempt>` artifact
retains the revision, production Build ID, locale/viewport, action outcomes, synthetic
database comparisons, accessible markup, screenshots and cleanup state. The receipt
omits cookies, tokens, request bodies and raw Flight responses. Failed journeys also
retain Playwright traces of the disposable fixture; those diagnostic traces can contain
synthetic authentication and protocol data. The general failure-only browser artifact
remains in place.

The separate helper tests verify result attribution, response custody and strict
input/refusal boundaries. They do not prove a browser journey ran. Actual branch CI,
artifact inspection, resulting-main CI, human acceptance, assistive technology,
installation, release and deployment remain separate evidence and gates. Do not close
the whole issue from this validation pack or from a focused passing selection.
