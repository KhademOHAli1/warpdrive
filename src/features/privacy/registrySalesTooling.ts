import { classifyInventory } from "./registryClassification";
import { salesToolingIds1 } from "./registryIdsSalesTooling1";

export const salesToolingInventoryEntry = classifyInventory(salesToolingIds1, {
  owner: "maintainer qualification and programme tooling",
  categories: [
    "repository task/evidence metadata",
    "supplied migration ledger exports",
    "synthetic native session and object fixtures",
    "operator diagnostics",
  ],
  subjectRelation:
    "Source paths, task states and migration hashes do not identify a CRM subject or confer disclosure authority. A synthetic smoke actor or local owner does not authorize changing real records.",
  purpose:
    "Check approved task and journey registers, compare explicit source/ledger files without database access, and run a separately invoked disposable integration profile smoke harness.",
  disclosure:
    "Register and lineage output contains metadata, digests and bounded issues, not source file contents or credential payloads. The operational harness uses validated runtime configuration; secrets and real customer values are excluded from routine evidence.",
  retention:
    "Source/evidence artifacts and terminal output follow operator-controlled lifecycles. Synthetic auth/session/ticket and temporary object cleanup require actual execution proof; no generic data retention or erasure capability is granted.",
  externalEffects:
    "The checkers read explicitly selected source/evidence/ledger files, hash bytes, traverse in-memory sets and write stdout/stderr only. The independent smoke script requires an exact local development profile and empty user/provider stores before queuing auth-maintenance, creating synthetic sessions, sending WebSocket/NOTIFY frames and uploading/removing base-smoke objects. Those operational effects require their own bounded invocation; they were not executed by source inventory review.",
  erasureTask: "DPL-35",
});
