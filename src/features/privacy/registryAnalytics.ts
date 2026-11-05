import { classifyInventory } from "./registryClassification";

export const dealReportExportInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/dealReportExportCsv.ts",
    "derived:src/features/stats/dealReportExportRequest.ts",
    "sourceReview:src/app/(app)/dashboard/export/route.ts#beed840079d9b47973e260bc39644014094a3f5212d16a7bb3909e0b5a5a56b7",
    "sourceReview:src/features/stats/dealReportExportCsv.ts#7096c072639d63feaeaac8d3b8a31c768ab3b9611d92cffc22ad4d4a9a793de9",
    "sourceReview:src/features/stats/dealReportExportRequest.ts#0234508321d17b428dc7f98df3fd064f56daf4654f5206e470cd038453a79a78",
  ],
  {
    owner: "authorized performance deal export",
    categories: ["CRM deal identifiers, recorded status, nominal values and UTC record clocks"],
    subjectRelation: "Deal identifiers may refer to records concerning people and organizations.",
    purpose: "Download a complete bounded set for a currently authorized contributing-deal report.",
    disclosure:
      "An authenticated actor with data.export gets only the current records procedure's matching population after a fresh check. CSV cells use fixed types and omit titles, source labels, owner identities and linked contacts.",
    retention:
      "No server artifact or cache. The download creates a user-controlled copy outside the application.",
    externalEffects:
      "A private HTTP response to the authenticated requester. No CRM write or provider call.",
    erasureTask: "DPL-15 / #714",
  },
);

export const recordedDealSourceInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/recordedDealSourceReport.ts",
    "sourceReview:src/features/stats/recordedDealSourceReport.ts#3ab90044df83b3662c5d0de9d81c1cec95340f01969edc15d6ce90b75aff1931",
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

export const analyticsForecastCommitInventoryEntry = classifyInventory(
  [
    "sourceReview:src/features/stats/history/forecastCommitQualification.ts#56fbc23b26cd57ad0211060810b4b70ddbe18d3ea8ca1435715341f02bcaa90b",
    "writer:src/features/stats/history/forecastCommitQualification.ts#query:BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "writer:src/features/stats/history/forecastCommitQualification.ts#query:ROLLBACK",
    "writer:src/features/stats/history/forecastCommitQualification.ts#query:SET LOCAL search_path = pg_catalog, pg_temp; SET LOCAL statement_timeout = '5000ms'; SET LOCAL lock_timeout = '2000ms'",
    "writer:src/features/stats/history/forecastCommitQualification.ts#query:dynamic",
  ],
  {
    owner: "private pre-target forecast commit qualification",
    categories: [
      "forecast creator and receipt identifiers, digests, native transaction witnesses and clocks",
    ],
    subjectRelation: "The expected receipt names its creator and references a private forecast.",
    purpose:
      "Verify that a specific forecast tuple was visible to a separate native primary snapshot before the forecast target began.",
    disclosure:
      "Private server-side proof for the exact creator and receipt. No roster, forecast assumptions or result bytes enter the proof.",
    retention: "Transient proof only. Durable proof custody requires an explicit admission policy.",
    externalEffects: "Bounded read-only PostgreSQL transaction. No persistent or provider writes.",
    erasureTask: "DPL-15 / #714",
  },
);

export const analyticsAttentionInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/analyticsAttention.ts",
    "sourceReview:src/features/stats/analyticsAttention.ts#04a3d6d41222077a83208fac37632cf61d04fe6bf928e8887c1b0c7141495bc5",
    "writer:src/features/stats/analyticsAttention.ts#execute:dynamic",
    "writer:src/features/stats/analyticsAttention.ts#execute:sql",
  ],
  {
    owner: "scoped current deal next actions",
    categories: ["deal and activity identifiers, deal ownership, visibility and due clocks"],
    subjectRelation: "The source may reference activities or deals about people and organizations.",
    purpose:
      "Count overdue deal activities and open deals with no unfinished linked activity under the canonical queue rules.",
    disclosure:
      "The current protected report returns only the two authorized counts, observation time and account zone. Anchors and exact due evidence remain in the private reader.",
    retention: "Read-only computation. Source rows retain their existing lifecycle policies.",
    externalEffects:
      "One bounded database snapshot and transaction-local settings. No CRM or provider writes.",
    erasureTask: "DPL-15 / #714",
  },
);

export const currentLeadHandoffInventoryEntry = classifyInventory(
  [
    "derived:src/features/stats/hydrateReportActor.ts",
    "sourceReview:src/features/stats/currentLeadHandoffReport.ts#d74f1f114ea4f75639e4a50d8d675cf1453b185146d602fd9a4c9d3e5445416d",
    "sourceReview:src/features/stats/hydrateReportActor.ts#cc1a43a053f20aaa3ba8c1b3183baf21f8adfd914a2b27a96c6dc278aac3c7cd",
    "writer:src/features/stats/currentLeadHandoffReport.ts#execute:sql",
  ],
  {
    owner: "current lead and deal linkage analytics",
    categories: [
      "lead creation clock, lead scope and ownership, recorded deal linkage and visibility",
    ],
    subjectRelation: "Lead and deal records may concern people and organizations.",
    purpose:
      "Count links across two independently authorized CRM populations in a read-only snapshot.",
    disclosure:
      "Authorized aggregate counts. The source lead list already exposes whether a lead was converted. An unavailable link count combines all destination failures without revealing target identifiers, attributes or reasons.",
    retention:
      "No new storage. Source lead and deal rows retain their existing lifecycle policies.",
    externalEffects:
      "Authenticated snapshot read with transaction-local statement and lock bounds. No CRM or provider writes.",
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
    "derived:src/features/stats/lifecycleEconomics.ts",
    "derived:src/features/stats/periodForecast.ts",
    "sourceReview:src/features/stats/analyticsInputAdmission.ts#559893ca5917887784666fb30672259f1be3d96ed2823aea15d96b4c7dc21ed3",
    "sourceReview:src/features/stats/attribution.ts#5f6a361893b683967972de619327f39595c784f5fe7070335fe1a417b35d2de7",
    "sourceReview:src/features/stats/commercialDecomposition.ts#3d362fc66e384257a08205db5e967bc0422d9dae2f425e1bc9d12145e04e061a",
    "sourceReview:src/features/stats/fixedExperimentReadout.ts#4f4ff4b0d81681ed6d4c2c9d19b5a5a9c1790b2e10c0125c27d427828800f0ed",
    "sourceReview:src/features/stats/forecastEvaluation.ts#93b8623477eb9dfb0d1802ac61aa6e445b32402ffe354d0198cd975ccf339d10",
    "sourceReview:src/features/stats/history/dealCloseIncidence.ts#0ad2c3f82f2b868f682222a470d379347dcfccba1c119085b4c29a06d5b43071",
    "sourceReview:src/features/stats/lifecycleEconomics.ts#f9173c38f1e2c375e0b5280acd85e1fb4e0fcaf64f7133cab07aefa5f650e542",
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
      "eligible account and posting references, realized net revenue and attributable delivery costs",
    ],
    subjectRelation:
      "Projections may refer to people, accounts and deals; a source key or fingerprint does not verify subject identity or authorize access.",
    purpose:
      "Compute an atomic input admission plan and explicitly scoped analytics: attribution, forecast scenarios and error, fixed experiment contrasts, competing outcome incidence, commercial change and customer economics.",
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
    "derived:src/features/stats/ui/StageAgingPanel.tsx",
    "sourceReview:src/features/stats/ui/StageAgingPanel.tsx#47394710d463d54d78e8dd7e30e80234e6f05fae3de842408950097cd682037f",
    "sourceReview:docs/analytics/forecast-custody-proposal.sql#b8188bfb71922f154440de3f82a412afbb66c2ae6efd428b78864d764c65f07b",
    "sourceReview:src/features/stats/history/currentStageAgingRepository.ts#7f9d1f3d4f1b5f1a8a5879e256db498ef12bc233b0c0dd4d21f8abcc33d7aa6c",
    "sourceReview:src/features/stats/history/stageAgingView.ts#6994bca1d8ccf9ed59fbe071682b067c99cd1fdcb3650d460d34cd05c53ff34c",
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
      "Internal readers reapply live deal/report scope and historical pipeline visibility in one database observation. Cohorts disclose only aggregate counts, scope kind and coverage. The stage-aging report rechecks captured deal-side access, uses current authorized stage labels from the same observation and withholds all aggregates when evidence is denied or incomplete. Movement remains creator-only and internal: global dependency checks can affect availability. The snapshot writer excludes names and independent contact identifiers. Global baseline counts, unrestricted custom fields and raw history/snapshots have no viewer output.",
    retention:
      "The private proposal deliberately retains immutable event/baseline/report rows and physical incarnations after source deletion. Immutability does not authorize indefinite retention. It supplies no retention schedule, erasure adapter or legal-retention determination. Canonical admission must qualify storage, subject scope, restrictions, backups and controlled lifecycle handling separately.",
    externalEffects:
      "The record, stage, movement and cohort repositories read and set session-local limits. The snapshot writer inserts one immutable row after a bounded authorized read and native witness check in its own repeatable-read transaction. Private SQL capture writes ledger/head rows if installed. Folding and reconciliation use transient Map/Set data; each delete identifier retires an in-memory key. No provider, network export, production CRM mutation or privacy lifecycle operation is authorized here.",
    erasureTask: "DPL-15 / #596 / #597",
  },
);
