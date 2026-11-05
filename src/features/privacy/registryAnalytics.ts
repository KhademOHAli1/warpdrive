import { classifyInventory } from "./registryClassification";

// Independently reviewed source proposal; every lifecycle capability remains unsupported.
export const analyticsInventoryEntry = classifyInventory(
  [
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
    "sourceReview:src/features/stats/history/repository.ts#f797f21fe9de3b9db911f58e1580e6df8208140e8505f1837b2e250fedd41461",
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
      "Private source proposal for activation baselines, row observations, physical incarnations, transaction folding, stage-definition reads, stage-episode/quantile and inventory reconciliation calculations, immutable report storage and an internal bounded current-deal history read. No schema export, canonical migration, report writer or installed storage is established by this classification.",
    disclosure:
      "Internal reader reapplies live deal/report scope and historical pipeline visibility in one database observation; reused pipeline IDs are conservatively denied. Global baseline counts, unrestricted custom fields and labels are excluded from viewer output. Raw history/snapshots and linked contact identifiers require a separately scoped browser/export DTO; creator authority never transfers to recipients.",
    retention:
      "The private proposal deliberately retains immutable event/baseline/report rows and physical incarnations after source deletion. Immutability does not authorize indefinite retention. It supplies no retention schedule, erasure adapter or legal-retention determination. Canonical admission must qualify storage, subject scope, restrictions, backups and controlled lifecycle handling separately.",
    externalEffects:
      "Source-only PostgreSQL table/trigger declarations and an internal SELECT reader; the scanner's execute:sql identifier is a read, not a SQL mutation. Folding, definition selection and reconciliation use transient Map/Set data. The inventory delete identifier retires a key in an in-memory map, not a database row. Stage definition reads use an owned read-only repeatable-read transaction and local query timeouts. Private SQL capture, if installed, performs transactional ledger/head writes; it has not been locally executed. No provider, email, telemetry, file/object export, production source mutation or lifecycle operation is performed by classification.",
    erasureTask: "DPL-15 / #596 / #597",
  },
);
