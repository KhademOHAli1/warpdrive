import { classifyInventory } from "./registryClassification";

export const analyticsComputationInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/analyticsInputAdmission.ts",
    "derived:src/features/stats/attribution.ts",
    "derived:src/features/stats/history/dealCloseIncidence.ts",
    "derived:src/features/stats/periodForecast.ts",
    "sourceReview:src/features/stats/analyticsInputAdmission.ts#674093beb290f925d774c58d0992657351fa8ae1a85f7a21886dbe04ddba482f",
    "sourceReview:src/features/stats/attribution.ts#5f6a361893b683967972de619327f39595c784f5fe7070335fe1a417b35d2de7",
    "sourceReview:src/features/stats/history/dealCloseIncidence.ts#0ad2c3f82f2b868f682222a470d379347dcfccba1c119085b4c29a06d5b43071",
    "sourceReview:src/features/stats/periodForecast.ts#500d5c56f006ea39067c741877de1b581de7731142750b431ffbd91cfead2021",
    "writer:src/features/stats/analyticsInputAdmission.ts#update:dynamic",
  ],
  {
    owner: "marketing and sales analytics computations",
    categories: [
      "source producer, event, identity and correction references",
      "interaction classifications and descriptive credit",
      "CRM deal identifiers, amounts and forecast assumptions",
      "deal incarnations, observed entry and close facts, and precise elapsed ages",
    ],
    subjectRelation:
      "Projections may refer to people, accounts and deals; a source key or fingerprint does not verify subject identity or authorize access.",
    purpose:
      "Compute an atomic input admission plan, descriptive attribution, exact forecast scenarios and competing outcome incidence from explicitly scoped facts.",
    disclosure:
      "Private server-side values. An adapter must prove authorized and complete membership and build a separate disclosure DTO before sharing results. Single-deal steps and precise ages in an incidence curve can identify a contributor and are not viewer output.",
    retention:
      "Transient computation only. Immutable source receipts, correction policy, subject restrictions and deletion require separately qualified storage and lifecycle behavior.",
    externalEffects:
      "No database, file, provider or network calls. The update identifier feeds bytes to an in-memory SHA-256 hash; it does not persist, amend or transmit an event.",
    erasureTask: "DPL-15 / #596 / #597",
  },
);

// Independently reviewed source proposal; every lifecycle capability remains unsupported.
export const analyticsInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/history/currentStageAgingRepository.ts",
    "derived:src/features/stats/history/inventoryBoundaryEvidence.ts",
    "derived:src/features/stats/history/inventoryMovementEvidenceSource.ts",
    "derived:src/features/stats/history/inventoryMovementRepository.ts",
    "sourceReview:src/features/stats/history/currentStageAgingRepository.ts#484504ec0fe8fc47a4c3e0b1eef4df40bf25e2944cefb93d9d98104b1025d96b",
    "sourceReview:src/features/stats/history/inventoryBoundaryEvidence.ts#49120ce8c2a5dd7306698555dc06350dcc32314392537316d0a297b3413866fd",
    "sourceReview:src/features/stats/history/inventoryMovementEvidenceSource.ts#c9e8b45f148a08672702b8b60cef45485ede5a920b2b5b496b875ae52484fd63",
    "sourceReview:src/features/stats/history/inventoryMovementRepository.ts#375c6e2dde6ba2deb862bed3e270950d72de90d32600e4d11b39bace28e717e4",
    "writer:src/features/stats/history/currentStageAgingRepository.ts#execute:sql",
    "writer:src/features/stats/history/inventoryBoundaryEvidence.ts#delete:key",
    "writer:src/features/stats/history/inventoryMovementEvidenceSource.ts#delete:key",
    "writer:src/features/stats/history/inventoryMovementRepository.ts#execute:sql",
    "derived:src/features/stats/history/dealCohortRepository.ts",
    "sourceReview:src/features/stats/history/dealCohortRepository.ts#2ae1758be41685b62dc80f98973a2af6191cf8c1415b4a653bc8a65d865a69df",
    "writer:src/features/stats/history/dealCohortRepository.ts#execute:sql",
    "derived:src/features/stats/history/equalAgeCohorts.ts",
    "derived:src/features/stats/history/inventorySnapshotRepository.ts",
    "sourceReview:src/features/stats/history/equalAgeCohorts.ts#94f4431c6970716663982a3d13f13e16c00764b4683aa19a03f100e4d162f4c9",
    "sourceReview:src/features/stats/history/inventorySnapshotRepository.ts#9a978cf8ee0a6a4851eb1289527c00076ddb790c1a667289d90972a4c4af2ad6",
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
    "sourceReview:src/features/stats/history/repository.ts#570db83c79b942bdb66dd93faba9635000048c67be1cabf7ee5898804e94e5d6",
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
      "Private source for activation baselines, row observations, physical incarnations, transaction folding, stage definitions and aging, snapshot inventory reconciliation, observed equal-age deal cohorts, bounded current-deal history and immutable inventory snapshot creation. No schema export, canonical migration or installed storage is established by this classification.",
    disclosure:
      "Internal readers reapply live deal/report scope and historical pipeline visibility in one database observation. Cohorts disclose only aggregate counts, scope kind and coverage. Movement remains creator-only and internal: global dependency checks can affect availability. The snapshot writer excludes names and independent contact identifiers. Global baseline counts, unrestricted custom fields and raw history/snapshots have no viewer output.",
    retention:
      "The private proposal deliberately retains immutable event/baseline/report rows and physical incarnations after source deletion. Immutability does not authorize indefinite retention. It supplies no retention schedule, erasure adapter or legal-retention determination. Canonical admission must qualify storage, subject scope, restrictions, backups and controlled lifecycle handling separately.",
    externalEffects:
      "The record, stage, movement and cohort repositories read and set session-local limits. The snapshot writer inserts one immutable row after a bounded authorized read and native witness check in its own repeatable-read transaction. Private SQL capture writes ledger/head rows if installed. Folding and reconciliation use transient Map/Set data; each delete identifier retires an in-memory key. No provider, network export, production CRM mutation or privacy lifecycle operation is authorized here.",
    erasureTask: "DPL-15 / #596 / #597",
  },
);
