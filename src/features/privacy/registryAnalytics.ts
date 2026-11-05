import { classifyInventory } from "./registryClassification";

export const recordedDealSourceInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/recordedDealSourceReport.ts",
    "sourceReview:src/features/stats/recordedDealSourceReport.ts#9e7475b7833a2d3b222b65b81e82f7bd152da89689032770fd846d634ef1ed59",
    "writer:src/features/stats/recordedDealSourceReport.ts#execute:sql",
  ],
  {
    owner: "recorded CRM deal source analytics",
    categories: [
      "current recorded channel, deal owner and visibility, nominal deal values and clocks",
    ],
    subjectRelation:
      "Deal records may concern people and organizations. Current channel labels do not establish identity or attribution.",
    purpose:
      "Summarize currently authorized in-period deal creation and outcomes by the recorded native channel classes and one currency.",
    disclosure:
      "Only fixed channel classes, current authorized counts, known sums and elapsed totals. Raw source text, free-form reference, identities, names and underlying CRM rows are excluded.",
    retention: "Read only, no new storage. Source records retain their existing lifecycle policy.",
    externalEffects:
      "An authenticated server caller can request a read-only repeatable-read observation. Transaction-local settings bound query time. No provider, export or CRM write.",
    erasureTask: "DPL-15 / #714",
  },
);

export const analyticsComputationInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/analyticsInputAdmission.ts",
    "derived:src/features/stats/attribution.ts",
    "derived:src/features/stats/commercialDecomposition.ts",
    "derived:src/features/stats/fixedExperimentReadout.ts",
    "derived:src/features/stats/forecastEvaluation.ts",
    "derived:src/features/stats/history/dealCloseIncidence.ts",
    "derived:src/features/stats/periodForecast.ts",
    "sourceReview:src/features/stats/analyticsInputAdmission.ts#559893ca5917887784666fb30672259f1be3d96ed2823aea15d96b4c7dc21ed3",
    "sourceReview:src/features/stats/attribution.ts#5f6a361893b683967972de619327f39595c784f5fe7070335fe1a417b35d2de7",
    "sourceReview:src/features/stats/commercialDecomposition.ts#3d362fc66e384257a08205db5e967bc0422d9dae2f425e1bc9d12145e04e061a",
    "sourceReview:src/features/stats/fixedExperimentReadout.ts#4f4ff4b0d81681ed6d4c2c9d19b5a5a9c1790b2e10c0125c27d427828800f0ed",
    "sourceReview:src/features/stats/forecastEvaluation.ts#93b8623477eb9dfb0d1802ac61aa6e445b32402ffe354d0198cd975ccf339d10",
    "sourceReview:src/features/stats/history/dealCloseIncidence.ts#0ad2c3f82f2b868f682222a470d379347dcfccba1c119085b4c29a06d5b43071",
    "sourceReview:src/features/stats/periodForecast.ts#500d5c56f006ea39067c741877de1b581de7731142750b431ffbd91cfead2021",
    "writer:src/features/stats/analyticsInputAdmission.ts#update:dynamic",
    "writer:src/features/stats/fixedExperimentReadout.ts#update:payload",
  ],
  {
    owner: "marketing and sales analytics computations",
    categories: [
      "source producer, event, identity and correction references",
      "interaction classifications and descriptive credit",
      "CRM deal identifiers, amounts and forecast assumptions",
      "deal incarnations, observed entry and close facts, and precise elapsed ages",
      "settled segment counts, first wins and exact won deal amounts",
      "saved forecast and settlement references, scoped outcomes, experiment assignments and endpoint evidence",
    ],
    subjectRelation:
      "Projections may refer to people, accounts and deals; a source key or fingerprint does not verify subject identity or authorize access.",
    purpose:
      "Compute an atomic input admission plan and explicitly scoped analytics: attribution, forecast scenarios and error, fixed experiment contrasts, competing outcome incidence and commercial change.",
    disclosure:
      "Private server-side values. An adapter must prove authorized and complete membership and build a separate disclosure DTO before sharing results. Single-deal steps and precise ages in an incidence curve can identify a contributor and are not viewer output.",
    retention:
      "Transient computation only. Immutable source receipts, correction policy, subject restrictions and deletion require separately qualified storage and lifecycle behavior.",
    externalEffects:
      "No database, file, provider or network calls. The update identifier feeds bytes to an in-memory SHA-256 hash; it does not persist, amend or transmit an event.",
    erasureTask: "DPL-15 / #596 / #597",
  },
);

export const analyticsGovernedCustodyInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/governedInputRepository.ts",
    "sourceReview:docs/analytics/governed-source-storage-proposal.sql#3e402a7e317a75febbd1b5b160fbbae1c9c9593e8f33266b7f85251d6b9ffaeb",
    "sourceReview:src/features/stats/governedInputRepository.ts#a540a07dbf2dc522436e21af8fb5515fe2fd01d630b4b85d3f66a431dc567aa1",
    "writer:src/features/stats/governedInputRepository.ts#query:BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY; SET LOCAL statement_timeout = '5000ms'",
    "writer:src/features/stats/governedInputRepository.ts#query:BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE",
    "writer:src/features/stats/governedInputRepository.ts#query:COMMIT",
    "writer:src/features/stats/governedInputRepository.ts#query:ROLLBACK",
    "writer:src/features/stats/governedInputRepository.ts#query:SELECT 1 FROM public.users WHERE id = $1::uuid AND is_active FOR SHARE",
    "writer:src/features/stats/governedInputRepository.ts#query:SET LOCAL statement_timeout = '5000ms'; SET LOCAL lock_timeout = '2000ms'; SET LOCAL synchronous_commit = on",
    "writer:src/features/stats/governedInputRepository.ts#query:dynamic",
  ],
  {
    owner: "marketing and sales analytics governed source custody proposal",
    categories: [
      "producer, registration and grant identifiers and active or revoked policy references",
      "pseudonymous actor and source subject references, source revisions and delivery receipts",
      "validated source event bodies, financial facts, timestamps and exact canonical fingerprints",
    ],
    subjectRelation:
      "The payload and provenance may relate to people, accounts, deals and purchases. Fingerprints and producer keys do not identify a person independently. Authenticated user or service evidence must come from a separate trusted server adapter.",
    purpose:
      "Serialize bounded source admissions and preserve first event, correction, and exact retry evidence in a disposable custody proposal.",
    disclosure:
      "Private receipt to the trusted server caller. No viewer, provider, browser, export or privacy lifecycle entry point. Neither a receipt nor a stored grant supplies current permission to see source payloads.",
    retention:
      "Immutable source events and receipts by proposal; producer and grant identity persist across disablement and revocation. No erasure, backup or retained-authority policy has been qualified. The proposal remains outside canonical schema.",
    externalEffects:
      "With disposable storage supplied, the repository reads and locks authority and prior metadata, inserts one atomic admission and confirms the exact committed receipt. The SQL would add internal tables and guards; it supplies no runtime grants, provider or network call.",
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
    "derived:src/features/stats/history/stageAgingView.ts",
    "sourceReview:docs/analytics/forecast-custody-proposal.sql#b8188bfb71922f154440de3f82a412afbb66c2ae6efd428b78864d764c65f07b",
    "sourceReview:src/features/stats/history/currentStageAgingRepository.ts#6ddea2286f0d5b85cff1535382afdcaf26f59301a57a589f25223c6ab07779b3",
    "sourceReview:src/features/stats/history/stageAgingView.ts#66795afa9e005a183572cd48dafa4d90e8421cb98b85085fd443c459a85cf1f1",
    "sourceReview:src/features/stats/history/inventoryBoundaryEvidence.ts#49120ce8c2a5dd7306698555dc06350dcc32314392537316d0a297b3413866fd",
    "sourceReview:src/features/stats/history/inventoryMovementEvidenceSource.ts#c9e8b45f148a08672702b8b60cef45485ede5a920b2b5b496b875ae52484fd63",
    "sourceReview:src/features/stats/history/inventoryMovementRepository.ts#375c6e2dde6ba2deb862bed3e270950d72de90d32600e4d11b39bace28e717e4",
    "writer:src/features/stats/history/currentStageAgingRepository.ts#execute:sql",
    "writer:src/features/stats/history/inventoryBoundaryEvidence.ts#delete:key",
    "writer:src/features/stats/history/inventoryMovementEvidenceSource.ts#delete:key",
    "writer:src/features/stats/history/stageAgingView.ts#delete:key",
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
      "Private source for activation baselines, row observations, physical incarnations, transaction folding, stage definitions and aging, snapshot inventory reconciliation, observed equal-age deal cohorts, bounded current-deal history, and immutable inventory and forecast custody. No schema export, canonical migration or installed storage is established by this classification.",
    disclosure:
      "Internal readers reapply live deal/report scope and historical pipeline visibility in one database observation. Cohorts disclose only aggregate counts, scope kind and coverage. The unwired stage-aging projection rechecks captured deal-side access, uses current authorized stage labels from the same observation and withholds all aggregates when evidence is denied or incomplete. Movement remains creator-only and internal: global dependency checks can affect availability. The snapshot writer excludes names and independent contact identifiers. Global baseline counts, unrestricted custom fields and raw history/snapshots have no viewer output.",
    retention:
      "The private proposal deliberately retains immutable event/baseline/report rows and physical incarnations after source deletion. Immutability does not authorize indefinite retention. It supplies no retention schedule, erasure adapter or legal-retention determination. Canonical admission must qualify storage, subject scope, restrictions, backups and controlled lifecycle handling separately.",
    externalEffects:
      "The record, stage, movement and cohort repositories read and set session-local limits. The snapshot writer inserts one immutable row after a bounded authorized read and native witness check in its own repeatable-read transaction. Private SQL capture writes ledger/head rows if installed. Folding and reconciliation use transient Map/Set data; each delete identifier retires an in-memory key. No provider, network export, production CRM mutation or privacy lifecycle operation is authorized here.",
    erasureTask: "DPL-15 / #596 / #597",
  },
);
