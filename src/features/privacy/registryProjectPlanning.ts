import { classifyInventory } from "./registryClassification";

export const projectPlanningInventoryEntry = classifyInventory(
  [
    "writer:src/features/projects/planning/webReads.ts#query:dynamic",
    "writer:src/features/projects/planning/views.ts#update:views",
    "writer:src/features/projects/planning/views.ts#insert:views",
    "writer:src/features/projects/planning/router.ts#query:dynamic",
    "writer:src/features/projects/planning/groups.ts#update:groups",
    "writer:src/features/projects/planning/groups.ts#insert:groups",
    "writer:src/features/projects/planning/assignments.ts#insert:assignments",
    "writer:src/features/projects/planning/assignments.ts#delete:assignments",
    "table:internal_project_saved_views",
    "table:internal_project_planning_groups",
    "table:internal_project_planning_assignments",
    "sourceReview:src/features/projects/planning/webReads.ts#0561e4bb0ea4d28bc643fc9c6cec113c98114b97253469397ab8e77e063e4863",
    "sourceReview:src/features/projects/planning/views.ts#87b506e1f4f4e9f397a923b628feec02d98152acf4d1c5513349305803b2b742",
    "sourceReview:src/features/projects/planning/schema.ts#eb092f63fb05e55660263791f3e0171fc395ebfa02a87841df15833c8e2bf1d9",
    "sourceReview:src/features/projects/planning/router.ts#fc2737c2c573c03a87a78398411662d891d3c8c4d05d8077af6c5bf28f44d83e",
    "sourceReview:src/features/projects/planning/groups.ts#4d6f04e1aef7ee1f9f5b7834fce00c511ce9e8cfa3bfde44f823a89d913a6a43",
    "sourceReview:src/features/projects/planning/assignments.ts#bc336cb79f8b09f0e7997da0a75a455514292324d9fd482409e63fe5c5128b4a",
    "derived:src/features/projects/planning/assignments.ts",
  ],
  {
    owner: "internal project planning",
    categories: [
      "cycle and module titles, descriptions, dates and progress states",
      "work-item membership in cycles and modules",
      "saved view ownership, layout and filter definitions",
    ],
    subjectRelation:
      "Saved view authors and optional assignee filters reference workforce identities. Group membership references work items whose authors and assignees remain in the Projects domain.",
    purpose:
      "Schedule work in cycles, organize named deliverables in modules, and reopen filtered project work in a saved layout.",
    disclosure:
      "Core rechecks the enabled module and the actor’s project grant for each request. Private view definitions require current project access and authorship. Active project edit, author, and archive permissions gate changes.",
    retention:
      "Planning records and assignments persist in PostgreSQL and backups. Archived groups and views retain their links. Web holds the current projection in memory and addresses saved or scoped views with the opaque identifier in the URL.",
    externalEffects:
      "Same-origin typed procedures read and update scoped Core records. Changes have no provider, background delivery or object-store effect.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
