# Workflow blocks and custom KPI calculations

Goals opens as a compact, searchable list of ordinary goals and custom KPI assignments. The existing goal form still handles standard targets. **Custom KPI** opens a separate calculation canvas. Its nodes read scoped CRM metrics, compute numbers, compare values, combine Boolean conditions, select a result, and return one numeric KPI. It cannot write records, call code or providers, send messages, or pause for input.

Workflows uses the same compact node cards, picker and inspector patterns. New workflows use the version 2 studio; existing workflows retain their version 1 editor, published versions and runs. Both appear in the workflow library. No stored version 1 graph is reinterpreted as version 2.

## Block coverage

| Group | Version 2 blocks and behavior |
| --- | --- |
| Records | Create, update, delete, upsert, find and pick leads, deals, people, organizations and activities using the current actor’s CRM permissions. Find supports grouped filters, sort and bounded pagination. Pick supports random, round-robin and load-based selection. |
| Logic | Filter, ordered If/Else routes and Iterator with separate loop and done connections. Code runs TypeScript/JavaScript `main(inputs)` in a bounded guest without host capabilities. A Logic Function references a specific immutable revision configured by a workspace administrator. |
| Communication | Send Email uses an actor-owned connected mailbox and its existing delivery receipt. Draft Email saves a private CRM draft. Send Chat Message creates an in-app notification and can wait for the recipient’s decision. Create Calendar Event creates a Warpdrive calendar activity; provider invitations and conference creation require a separate provider integration and cannot be published as working options. |
| Waits | Form collects a typed response from the assigned active member. Delay accepts a duration or instant. Wait for Event resumes on a matching authorized record event or on timeout when configured. |
| Integrations | HTTP Request calls an approved HTTPS endpoint with explicit method, headers, body and optional response schema. It uses the checked address for the connection and does not follow redirects. AI Agent and Classify use a configured workspace model. Classify supports Boolean, choice and numeric score questions. |

A workflow can start manually, by schedule, by webhook, or when a record is created, updated, deleted, or created or updated. Record triggers use the same five CRM objects as record blocks. An administrator can configure an OpenAI-compatible endpoint, model allowlist and encrypted key under **Settings → Workflow runtime**. Structured AI results require a provider that supports JSON Schema responses. Send Email requires a working connected mailbox. This source change does not configure, contact, or qualify a production provider.

## Author, test, publish

1. Choose a trigger, add blocks, and connect the outputs you want to follow. Use an earlier output in a field through the variable picker. Branches and loop bodies have distinct connections.
2. Run **Test draft** to inspect the path and calculation outputs. The test can use permitted reads and bounded code, and labels effects that it skips. A downstream step that needs a skipped effect’s output cannot be evaluated from that draft test.
3. Publish the reviewed draft. Each live run uses the published revision it started with. The run history records transitions, waits and errors. A form or approval is available to its authorized recipient.

Database effects and step completion share a transaction. External effects commit a claim before dispatch; an interrupted claim with uncertain delivery is recorded as unknown, without automatic redispatch. Record event capture runs only for matching active subscriptions or waiting runs. The outbox applies current visibility before admitting or resuming a run, and clears raw row copies after delivery or terminal failure.

For webhooks, `POST /api/workflows-v2/{workflowId}` accepts a bounded JSON object, a UUID `Idempotency-Key` and the configured Bearer key. The same key and payload replay the same run against the same published revision; changed intent conflicts. Public webhooks require an explicit unauthenticated configuration. Keep ordinary workflow text and bindings free of credentials intended for the encrypted workspace runtime settings.

The interaction references were [Frappe CRM list views](https://docs.frappe.io/crm/view), the [Twenty conditional workflow on Mobbin](https://mobbin.com/flows/c9abe7c1-9de6-46ff-a1f7-5943d071b333), and Twenty’s [action types](https://github.com/twentyhq/twenty/blob/246e644740b85679065c9013d3e6a02035f33895/packages/twenty-shared/src/workflow/types/WorkflowActionType.ts) and [configuration schemas](https://github.com/twentyhq/twenty/tree/246e644740b85679065c9013d3e6a02035f33895/packages/twenty-shared/src/workflow/schemas).
