import { classifyInventory } from "./registryClassification";

// Independently reviewed source proposal; every lifecycle capability remains unsupported.
export const analyticsInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/history/dealCohortRepository.ts",
    "sourceReview:src/features/stats/history/dealCohortRepository.ts#07ef16dc05a14a329d784f26f57de8860a3e2aa39f5f3472b7c01e6e3ff6b9a7",
    "writer:src/features/stats/history/dealCohortRepository.ts#execute:sql",
    "derived:src/features/stats/history/equalAgeCohorts.ts",
    "derived:src/features/stats/history/inventorySnapshotRepository.ts",
    "sourceReview:src/features/stats/history/equalAgeCohorts.ts#94f4431c6970716663982a3d13f13e16c00764b4683aa19a03f100e4d162f4c9",
    "sourceReview:src/features/stats/history/inventorySnapshotRepository.ts#48c248eeb2633ee17a2a07620f062abfe7d81574cdfd924612dd110ad600bb65",
    "writer:src/features/stats/history/inventorySnapshotRepository.ts#execute:sql",
    "derived:src/features/stats/history/inventoryMovement.ts",
    "derived:src/features/stats/history/stageDefinitionRepository.ts",
    "derived:src/features/stats/history/stageDefinitions.ts",
    "sourceReview:src/features/stats/history/inventoryMovement.ts#d915bb99c0564e25986f2bc82d2b1625412f7b489e252eee645568a40edba087",
    "sourceReview:src/features/stats/history/stageDefinitionRepository.ts#7c4a5e0b384b3f9959e4191ab4f4688e8ff96b4675143bcf875238e8b01b1327",
    "sourceReview:src/features/stats/history/stageDefinitions.ts#900c123dd4f40e0c3bb0d0d9604056532b48331028220b7b46a327328097bf48",
    "writer:src/features/stats/history/inventoryMovement.ts#delete:dynamic",
    "writer:src/features/stats/history/stageDefinitionRepository.ts#execute:sql",
    "derived:src/features/stats/history/stageStatistics.ts",
    "sourceReview:src/features/stats/history/stageStatistics.ts#72c14845455676890312a1d870604d30d947653b61c093fedebab24e49ff6cf6",
    "derived:src/features/stats/history/stageEpisodes.ts",
    "sourceReview:src/features/stats/history/stageEpisodes.ts#3cd1d2944db399dc5c676b6c074f505f7d694e66f810b7a3845b1840054ecad6",
    "derived:src/features/stats/history/fold.ts",
    "derived:src/features/stats/history/repository.ts",
    "sourceReview:src/db/schema/analyticsHistory.ts#ac12a8b33b1141bc08418a31ad45ef57858aaa1ff84c3303c71490c5e666c319",
    "sourceReview:src/features/stats/history/fold.ts#41fdd735826d853c5b9256fc98690e4d13906e990f145838d03d6f754719142b",
    "sourceReview:src/features/stats/history/repository.ts#24ac35b5333aaa9b80b63457f275537f2464454dc9ad2f62a725e9bcbbb531f0",
    "table:analytics_history_coverage",
    "table:analytics_history_events",
    "table:analytics_history_heads",
    "table:analytics_report_snapshots",
    "writer:src/features/stats/history/repository.ts#execute:sql",
  ],
  {
    owner: "sales analytics history",
    categories: [
      "CRM opportunity and workforce identifiers",
      "title and loss free text",
      "exact commercial values",
      "recorded pipeline/stage definitions",
      "observed changes and report facts",
      "visibility controls and transaction/snapshot metadata",
    ],
    subjectRelation:
      "Deal projections retain owner/person/organization references and commercial facts. These references are linkable data, not verified data-subject identity. Unknown capture actor/command stays null. Current deal authority does not grant independent contact or retained-deletion authority.",
    purpose:
      "Private source for activation baselines, row observations, physical incarnations, transaction folding, stage definitions, stage duration, inventory reconciliation, observed equal-age deal cohorts, bounded current-deal history and immutable inventory snapshot creation. No schema export, canonical migration or installed storage is established by this classification.",
    disclosure:
      "Internal readers reapply live deal/report scope and historical pipeline visibility in one database observation. The snapshot writer rechecks creator scope and records minimal facts for the selected currency, excluding names and independent contact identifiers. Global baseline counts, unrestricted custom fields and raw history/snapshots have no viewer output; creator authority never transfers to recipients.",
    retention:
      "The private proposal deliberately retains immutable event/baseline/report rows and physical incarnations after source deletion. Immutability does not authorize indefinite retention. It supplies no retention schedule, erasure adapter or legal-retention determination. Canonical admission must qualify storage, subject scope, restrictions, backups and controlled lifecycle handling separately.",
    externalEffects:
      "The record, stage and cohort repositories read and set session-local limits. The snapshot writer inserts one immutable row into the proposed storage after a bounded authorized read in its own repeatable-read transaction. Private SQL capture, if installed, writes transactional ledger/head rows. Folding, reconciliation and cohorts use transient Map/Set data; the reconciliation delete retires an in-memory key. No provider call, email, telemetry, file/object export, production CRM mutation or privacy lifecycle operation is authorized by this classification.",
    erasureTask: "DPL-15 / #596 / #597",
  },
);
