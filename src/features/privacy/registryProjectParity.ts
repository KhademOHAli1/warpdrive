import { classifyInventory } from "./registryClassification";

export const projectIntakeInventoryEntry = classifyInventory(
  [
    "sourceReview:src/features/projects/intake/snoozeTimeZone.ts#cee716d0620bfa5c5e434168a3d1d60e32e104ba00919b2e06437406c64c20ac",
    "writer:src/features/projects/intake/snoozeTimeZone.ts#update:requests",
    "sourceReview:src/features/projects/intake/router.ts#9d957a13a12330bfa5079acb58bb5014c72c95694b3333b977e9745a76d8d298",
    "sourceReview:src/features/projects/intake/schema.ts#acb5bd96f51735fc16cb519eb9deb058e3c5080857ba56022e3ecb756698819a",
    "sourceReview:src/features/projects/intake/service.ts#4b9c210bd8c64769bf34b9d44de14fec6e57b91f78b2d81f9d0de82305817e5e",
    "sourceReview:src/features/projects/intake/ui/IntakeDecisionDialog.tsx#c08a289d11bca2647bcc7abb0de3806dfbbddc06209b4a555a36c92da69fff1f",
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
    "sourceReview:src/features/projects/work-structure/EstimateSettings.tsx#7dff7b9a62da0434c04ca187c58d66ed351bd3387465d9090317b0d60034ce52",
    "sourceReview:src/features/projects/work-structure/LabelSettings.tsx#eb37e720ed4063f6facacb940bd1533a570a41ac700e02f1df8a7ac87052eee0",
    "sourceReview:src/features/projects/work-structure/WorkStructureClient.tsx#88d87e71b9059a059c0c0bfddb7f48eb7a939fb647e5425e591ea3761f704e03",
    "sourceReview:src/features/projects/work-structure/access.ts#6f52f9aa8ac7b3b57e90f7b9dd6dc761ebf2146f1601ded755fcbf0b42dd8406",
    "sourceReview:src/features/projects/work-structure/actions.backend.ts#1da7abbc22213abc06be537b10bf378d6dd5a9b814ad11e3f81bbfbbcd2a28fa",
    "sourceReview:src/features/projects/work-structure/catalog.ts#28aaacc11300c249b59a34096eef4a561f1bfa0ad68b046d91cbd4bd6adfc22b",
    "sourceReview:src/features/projects/work-structure/estimates.ts#d25315673b4da68cf5a388cb328af2ac8ade06c7feebece9f5b0861a5a18f2ab",
    "sourceReview:src/features/projects/work-structure/input.ts#32c453416e9c879eb3fbda431fe99a979dda318df1d41c19b8886f73dcfd0fa9",
    "sourceReview:src/features/projects/work-structure/itemStructure.ts#efef32cfdb31e493e850e007762a503f00500346428e596307ad4dfc594febf2",
    "sourceReview:src/features/projects/work-structure/labels.ts#85aa56a97299be601fe6ad39328c61ec8fd1456ae6df9e07184f00f1208a99b6",
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
    "sourceReview:src/features/projects/automations/service.ts#26e15c383a6f72c892d74ae235a2a9da97b3c27c1a43b28d89c5ca3debc0cb34",
    "derived:src/features/projects/automations/ProjectAutomationClient.tsx",
    "queue:project.automations",
    "sourceReview:src/app/(app)/projects/internal/[projectId]/archive/page.tsx#beb254fc91b97c2f82b8a8fcdfc7557a0f3104f58e9ae49aafa91a2bf15aca16",
    "sourceReview:src/app/(app)/projects/internal/[projectId]/settings/automations/page.tsx#67dcad3bf104200d1d28bdd952cd976dd420d0a3ba6362844651bd15fe7213cb",
    "sourceReview:src/features/projects/automations/router.ts#b0b12d5e34a76d16ac93e2807c91597b992565386b2ae46468c6142eaeecc931",
    "sourceReview:src/features/projects/automations/schema.ts#e359ff180032d288d2d053099704e83a03f28816bc0ccc3cab4b8a579cabcdc1",
    "sourceReview:src/features/projects/automations/worker.ts#f1dd4b81aea120c40916c0008dec773f20eafa9e66b67c565a4ea7b44da8db83",
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
