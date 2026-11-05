import { classifyInventory } from "./registryClassification";
import { workflowBlocksIds1, workflowRuntimeIds1 } from "./registryIdsWorkflowBlocks1";

export const workflowBlocksInventoryEntry = classifyInventory(workflowBlocksIds1, {
  owner: "Workflow blocks v2 authoring, execution and record event delivery",
  categories: [
    "workflow owners, publishers, run actors, assignees, responders and notification recipients",
    "authored graph names, layout, field bindings, formulas, code, messages, mail content, URLs, request headers, filters and form definitions",
    "record IDs, event names, changed field names, raw prior/current CRM row snapshots and origin-run provenance",
    "version-pinned trigger inputs, run state, repeated iterator inputs/outputs, wait responses, durable provider request and outcome receipts",
    "current visible native field metadata, pipeline/stage/type and workforce picker labels, and projected CRM records",
    "local private mail drafts, activity calendar entries and in-app workflow messages with optional approval wait references",
    "transient editor selections, graph layout, previews, request state and validation/error identifiers",
    "queue run references and operational retry/reconciliation identifiers",
  ],
  subjectRelation:
    "Workflow owner, publisher, current executor, event initiator, recipient and form responder are distinct roles. Free text, copied records, prompt values, attachments and responses can concern people unrelated to any of those IDs. Workflow ownership, active membership, a trigger receipt or a version pin does not establish reviewed subject identity or full disclosure authority.",
  purpose:
    "Author, publish and activate versioned workflow definitions; admit manual, scheduled, webhook or CRM event runs; execute a bounded graph with step receipts, waits, branching, iteration and external-effect outcomes. Native blocks use current record visibility and existing entity mutation services. Record event triggers copy old/new CRM rows into an internal outbox only when there is a matching active published trigger or open wait. The worker projects approved active fields against current actor, record and parent authority before admission or resumption. Versions and runtime evidence are separate from workflow drafts and the KPI evaluator.",
  disclosure:
    "Ordinary workflow draft, run, publication and responder reads use current account and workflow authority. Run history redacts stored trigger and runtime output payloads; assigned responders see the appropriate form or message fields. An event uses current row/tombstone, pipeline and dominant-parent authorization and separately checks snapshot visibility; missing hard-deleted rows are not projected. The raw event outbox is not a browser response. Run and trigger receipts can retain copies of previously visible values, and the runtime rechecks bound record sources before a new effect. Native entity pickers expose approved labels and IDs under current visibility; reference filters check access to the selected target. In-app messages are recipient-owned notifications; the approval link uses an opaque wait ID and a recipient-authorized route. Local drafts remain private in the actor's owned mailbox. API-key webhook configuration stores the generated key digest and returns the new key in the rotation response. No existing privacy export or unrestricted disclosure capability is granted.",
  retention:
    "Published definition revisions and logic-function revisions are immutable. Archive/deactivation, cancellation, lease expiry and soft deletion change ordinary product state and are not erasure. Delivered or terminally failed outbox rows clear raw before/after columns; identifiers, changed field names, attempts and timestamps remain. That update neither erases copied trigger/run/provider receipts nor establishes physical storage or backup erasure. Workflow, version, actor, responder and run foreign keys require coordinated disposition. No version, run, effect, trigger or wait subject-lifecycle adapter or activated retention schedule is established.",
  externalEffects:
    "The native path reads or mutates PostgreSQL using established CRM services and writes progress and effect records in the same transaction. Local draft, calendar and in-app message blocks do not submit provider drafts, invitations, conference requests or notification email. The worker may dispatch separate authorized live email, HTTP and AI effects under the reviewed runtime boundary. Run queue jobs carry the run ID and reconciliation jobs carry no record content; a queue-unavailable warning includes the run ID. Installation log storage and retention are not established. The source scanner's execute:sql signatures also include reads, scoped row/advisory locks and a transaction-local provenance setting; editor Map/Set changes and Hash.update on pick/webhook keys are transient, not row mutation or data erasure. Browser simulation skips live external/DB effects where marked and does not qualify actual delivery.",
  erasureTask: "DPL-16",
});

export const workflowRuntimeInventoryEntry = classifyInventory(workflowRuntimeIds1, {
  owner: "Workflow runtime administration, protected AI configuration and outbound actions",
  categories: [
    "active administrator and logic-function author IDs",
    "encrypted configured AI API key, endpoint/model settings and internal endpoint policy",
    "user-authored executable code, versioned function schemas and bounded JSON inputs/outputs",
    "owned mailbox and attachment references, recipients, subject/body content, HTTP destination, request headers/body and response metadata",
    "AI prompts, classification inputs, instructions, model outputs and provider-result receipts",
  ],
  subjectRelation:
    "The workspace administrator controls runtime configuration; credentials can belong to a provider account, not the workflow's actor or any CRM subject. Messages, function inputs and provider requests may describe multiple people. Provider configuration, actor authorization and remote receipt do not identify a privacy subject or establish provider-side lifecycle authority.",
  purpose:
    "Configure permitted AI endpoint/model choices and versioned logic functions; run bounded sandboxed code and typed external adapters. Resolve the current owned mail connection for the durable send service; dispatch HTTPS requests through approved socket addresses and a bounded response parser; invoke the configured AI endpoint for agent and classification output validation. Live provider attempts and uncertain outcomes remain distinct from configuration and draft simulation.",
  disclosure:
    "Runtime configuration changes require current administrator authority. The configured AI key is stored encrypted and ordinary runtime settings return key presence only; the server decrypts it for the configured request. User-authored HTTP URLs, headers, bodies or code can themselves contain secrets and are ordinary workflow configuration/receipt data, not a credential vault. The transport excludes selected hop-by-hop/request headers and response Set-Cookie; it does not make all provider payloads non-sensitive. Code workers receive bounded JSON and source for execution and return validated output; those inputs/outputs may include copied personal data. Configured email recipients, HTTP destinations and AI providers receive the payload explicitly used by the action. No broad provider or privacy-subject authorization follows.",
  retention:
    "Replacing or removing the configured AI key changes the current stored settings only. It is not remote credential revocation or erasure of old database/backup copies. Function versions and effect inputs/results persist under their own run and version records. Worker termination releases the active execution context without proving physical memory erasure. Provider copies and the existing mail outbox/receipts have their own lifecycle; no generic remote deletion, subject disclosure or retention job is established here.",
  externalEffects:
    "Live email may decrypt or refresh an owned mailbox grant, use attachment storage and submit via Gmail or SMTP through the existing outbox. HTTPS uses pinned endpoint resolution, TLS verification, bounded headers and bodies, and no redirect following; configured external HTTP and AI targets can retain received data. Provider timeouts and ambiguous receipts are represented as uncertainty rather than fabricated success or retries. CODE and LOGIC_FUNCTION use a local bounded worker with no provider invocation in that adapter. Source classification and synthetic checks do not establish installation or real-provider acceptance.",
  erasureTask: "DPL-16",
});
