import { classifyInventory } from "./registryClassification";

export const projectIntakeInventoryEntry = classifyInventory(
  [
    "sourceReview:src/features/projects/intake/router.ts#d365248a2b4be2b002777d2c4eb2571703f2a152151b00de403699c9759b575d",
    "sourceReview:src/features/projects/intake/schema.ts#ba4558dadd9d20efdcd5037b714d91ecdbfab7f7481eb18bb89f9d24e9f6814c",
    "sourceReview:src/features/projects/intake/service.ts#618412d598b6d4b4e9ad6830e9152a02474df6b376450338a8c631647acb3180",
    "sourceReview:src/features/projects/intake/ui/IntakeDecisionDialog.tsx#5d7359fca59c041154281ad3ee2d8dcd8aff10fc69c6249ab1b7b891a1504efc",
    "sourceReview:src/features/projects/intake/ui/IntakeEditorDialog.tsx#a1eedf0e2dbfe85048e173d35164c4d6ef021ae153d618c3eed0e82f16ebaf17",
    "sourceReview:src/features/projects/intake/ui/ProjectIntakeSettings.tsx#7aea1394d2f7e804bd64afc63e6ef282f7279f6e90f0fc81adf4d3abfc4d3780",
    "sourceReview:src/features/projects/intake/webReads.ts#088a82e0605fd57bf63fc8b23bd3fc8be10e7a8a1c8e1918c537149b7db3b242",
    "table:internal_project_intake_requests",
    "writer:src/features/projects/intake/router.ts#query:dynamic",
    "writer:src/features/projects/intake/service.ts#insert:requests",
    "writer:src/features/projects/intake/service.ts#update:internalProjectSettings",
    "writer:src/features/projects/intake/service.ts#update:requests",
    "writer:src/features/projects/intake/ui/IntakeDecisionDialog.tsx#execute:dynamic",
    "writer:src/features/projects/intake/ui/IntakeEditorDialog.tsx#execute:dynamic",
    "writer:src/features/projects/intake/ui/ProjectIntakeSettings.tsx#execute:dynamic",
    "writer:src/features/projects/intake/webReads.ts#query:input",
  ],
  {
    owner: "internal project intake",
    categories: [
      "request titles and descriptions",
      "workforce requester and reviewer",
      "status, deadlines and linked project items",
    ],
    subjectRelation:
      "Requester and reviewer identify participants. Authored prose can refer to other people.",
    purpose:
      "Submit, review, and admit requests as internal work items under the current project grant.",
    disclosure:
      "Core checks project settings and current membership. Owners review. Project editors can read the queue and viewers can read their own requests.",
    retention:
      "Requests and decision links persist in PostgreSQL and backups. Withdrawn intents are retained for safe retries. Snoozed records become eligible again after the chosen day.",
    externalEffects:
      "Typed requests affect the same Core installation only. Acceptance creates one work item and records a separate reviewer action in the same transaction.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);

export const projectWorkStructureInventoryEntry = classifyInventory(
  [
    "derived:src/features/projects/work-structure/EstimateSettings.tsx",
    "derived:src/features/projects/work-structure/LabelSettings.tsx",
    "derived:src/features/projects/work-structure/WorkStructureClient.tsx",
    "derived:src/features/projects/work-structure/catalog.ts",
    "derived:src/features/projects/work-structure/estimates.ts",
    "derived:src/features/projects/work-structure/input.ts",
    "derived:src/features/projects/work-structure/itemStructure.ts",
    "derived:src/features/projects/work-structure/labels.ts",
    "sourceReview:src/features/projects/work-structure/EstimateSettings.tsx#d8773a32cdfba1b1b0740b737c83f400fcedf76a218639ceef19271ab4c1aaba",
    "sourceReview:src/features/projects/work-structure/LabelSettings.tsx#eb37e720ed4063f6facacb940bd1533a570a41ac700e02f1df8a7ac87052eee0",
    "sourceReview:src/features/projects/work-structure/WorkStructureClient.tsx#88d87e71b9059a059c0c0bfddb7f48eb7a939fb647e5425e591ea3761f704e03",
    "sourceReview:src/features/projects/work-structure/access.ts#051f57921af65a8c884eba51aa61a22d19a444548629f9f71752738b2208660b",
    "sourceReview:src/features/projects/work-structure/actions.backend.ts#1da7abbc22213abc06be537b10bf378d6dd5a9b814ad11e3f81bbfbbcd2a28fa",
    "sourceReview:src/features/projects/work-structure/catalog.ts#28aaacc11300c249b59a34096eef4a561f1bfa0ad68b046d91cbd4bd6adfc22b",
    "sourceReview:src/features/projects/work-structure/estimates.ts#d25315673b4da68cf5a388cb328af2ac8ade06c7feebece9f5b0861a5a18f2ab",
    "sourceReview:src/features/projects/work-structure/input.ts#32c453416e9c879eb3fbda431fe99a979dda318df1d41c19b8886f73dcfd0fa9",
    "sourceReview:src/features/projects/work-structure/itemStructure.ts#efef32cfdb31e493e850e007762a503f00500346428e596307ad4dfc594febf2",
    "sourceReview:src/features/projects/work-structure/labels.ts#dadda149bbb472768baf12da80d33ff6ecc5871d3adec4f74dc23ab7a7565d46",
    "sourceReview:src/features/projects/work-structure/schema.ts#1bd531ff66ff43b78af39a90cb8ede0850d9989000964cdd365763fb16bb900a",
    "table:internal_project_estimate_points",
    "table:internal_project_estimate_scales",
    "table:internal_project_item_estimates",
    "table:internal_project_item_labels",
    "table:internal_project_labels",
    "table:internal_project_structure_settings",
    "writer:src/features/projects/work-structure/LabelSettings.tsx#update:dynamic",
    "writer:src/features/projects/work-structure/WorkStructureClient.tsx#execute:write",
    "writer:src/features/projects/work-structure/access.ts#insert:settings",
    "writer:src/features/projects/work-structure/access.ts#update:items",
    "writer:src/features/projects/work-structure/actions.backend.ts#write:db",
    "writer:src/features/projects/work-structure/estimates.ts#delete:points",
    "writer:src/features/projects/work-structure/estimates.ts#delete:records",
    "writer:src/features/projects/work-structure/estimates.ts#delete:scales",
    "writer:src/features/projects/work-structure/estimates.ts#insert:points",
    "writer:src/features/projects/work-structure/estimates.ts#insert:scales",
    "writer:src/features/projects/work-structure/estimates.ts#update:records",
    "writer:src/features/projects/work-structure/estimates.ts#update:settings",
    "writer:src/features/projects/work-structure/itemStructure.ts#delete:estimates",
    "writer:src/features/projects/work-structure/itemStructure.ts#delete:itemLabels",
    "writer:src/features/projects/work-structure/itemStructure.ts#insert:estimates",
    "writer:src/features/projects/work-structure/itemStructure.ts#insert:itemLabels",
    "writer:src/features/projects/work-structure/labels.ts#delete:labels",
    "writer:src/features/projects/work-structure/labels.ts#delete:records",
    "writer:src/features/projects/work-structure/labels.ts#insert:labels",
  ],
  {
    owner: "internal project labels and estimates",
    categories: ["label and estimate definitions", "work-item tag and estimate links"],
    subjectRelation:
      "Tags and estimates classify project work. They can describe work that involves identifiable members.",
    purpose: "Classify work and record planning estimates using project-scoped labels and scales.",
    disclosure:
      "Current project membership governs workspace projections. Owners configure catalogs and project editors update their authorized work items.",
    retention:
      "Catalogs and assignments persist in PostgreSQL and backups. Inactive estimate scales retain existing item selections. Removing or replacing an option updates dependent assignments.",
    externalEffects:
      "Changes are native scoped writes and affect related work-item revisions. They do not invoke providers or enqueue delivery.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);

export const projectAutomationsInventoryEntry = classifyInventory(
  [
    "sourceReview:src/features/projects/automations/ProjectAutomationClient.tsx#796cafe44ac7345e3480d169feef3c586105531c8ac901d8f7a5a640198a3354",
    "sourceReview:src/features/projects/automations/service.ts#85427b526503cd8c1c6bbf81496b1d8ca486d8c6e4da8d6caa70dcfbaa91627b",
    "derived:src/features/projects/automations/ProjectAutomationClient.tsx",
    "queue:project.automations",
    "sourceReview:src/app/(app)/projects/internal/[projectId]/archive/page.tsx#beb254fc91b97c2f82b8a8fcdfc7557a0f3104f58e9ae49aafa91a2bf15aca16",
    "sourceReview:src/app/(app)/projects/internal/[projectId]/settings/automations/page.tsx#67dcad3bf104200d1d28bdd952cd976dd420d0a3ba6362844651bd15fe7213cb",
    "sourceReview:src/features/projects/automations/router.ts#a6426d36da63a6a2a24f8912b6e990e5f6f26104e59d9a8514a46a278839ade6",
    "sourceReview:src/features/projects/automations/schema.ts#e359ff180032d288d2d053099704e83a03f28816bc0ccc3cab4b8a579cabcdc1",
    "sourceReview:src/features/projects/automations/worker.ts#e55eca22eaaa230d112a6bf1f314c5694540e4eb0e851d89755a1eda69c4e0aa",
    "table:internal_project_automation_events",
    "table:internal_project_automations",
    "writer:src/app/(app)/projects/internal/[projectId]/archive/page.tsx#query:dynamic",
    "writer:src/app/(app)/projects/internal/[projectId]/settings/automations/page.tsx#query:dynamic",
    "writer:src/features/projects/automations/router.ts#query:dynamic",
    "writer:src/features/projects/automations/service.ts#insert:rules",
    "writer:src/features/projects/automations/service.ts#update:item",
    "writer:src/features/projects/automations/worker.ts#insert:events",
    "writer:src/features/projects/automations/worker.ts#update:items",
  ],
  {
    owner: "internal project automations and work-item archive",
    categories: [
      "configuration of close and archive rules",
      "work item age, state and planning links",
      "automated lifecycle events",
    ],
    subjectRelation:
      "The work-item link can reference workforce participation through the existing project record. Scheduled events represent system changes.",
    purpose:
      "Close inactive open work and archive completed or cancelled work using owner-configured rules.",
    disclosure:
      "Settings and automation activity are restricted to project owners. Current project membership governs archive reads. Editing grants govern manual archive and restore.",
    retention:
      "Rule settings, archives and automated activity persist in PostgreSQL and backups. Archived work remains recoverable within its project.",
    externalEffects:
      "A scheduled worker checks enabled projects and updates eligible work under the project transaction fence. Queue jobs carry no subject payload. No external delivery or deletion is performed.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
