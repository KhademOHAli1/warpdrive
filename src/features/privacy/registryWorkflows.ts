import { classifyInventory } from "./registryClassification";
import { workflowIds1 } from "./registryIdsWorkflows1";

export const workflowInventoryEntry = classifyInventory(workflowIds1, {
  owner: "workflow automation",
  categories: [
    "workforce ownership, publisher and execution references",
    "user-authored draft and immutable published configuration",
    "trigger record references and replay keys",
    "copied CRM outputs and execution-step history",
    "queue cursors and transient editor graphs",
  ],
  subjectRelation:
    "Workflow owners, publishers and execution actors are workforce provenance, not proof of the subjects described by configuration, referenced CRM records or copied outputs. Literals and historical definitions can concern third parties.",
  purpose:
    "Author, publish and execute the bounded manual workflow engine; persist version-pinned runs and database-only effects with recovery metadata.",
  disclosure:
    "No workflow ownership or run permission establishes privacy case scope. Drafts, published literals, trigger references and stored CRM outputs require separate subject/provenance review. Ordinary history omits trigger/output payloads, but run details still expose historical configuration to the currently authorized workflow viewer.",
  retention:
    "Pause, cancellation and editor undo are not erasure. Published versions are immutable under SQL; runs, step outputs, created activities, queued jobs, browser query state and backups require coordinated reviewed lifecycle adapters. No purge or retention period is activated.",
  externalEffects:
    "pg-boss receives run IDs and reconciliation jobs; supported live nodes read deals and create CRM activities within the run transaction. Simulation rolls CRM writes back while retaining labeled run/step evidence. Reminder scheduling is suppressed for workflow activity creation. No mail/provider/CONN effect is introduced. Existing browser transport, observability and installation log sinks retain their separate reviewed boundaries.",
  erasureTask: "DPL-16",
});
