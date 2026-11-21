import { classifyInventory } from "./registryClassification";

export const projectPlanningInventoryEntry = classifyInventory(
  [
    "writer:src/features/projects/planning/views.ts#delete:views",
    "writer:src/features/projects/planning/views.ts#insert:favorites",
    "writer:src/features/projects/planning/views.ts#delete:favorites",
    "writer:src/features/projects/planning/rollover.ts#update:groups",
    "writer:src/features/projects/planning/rollover.ts#update:assignments",
    "table:internal_project_saved_view_favorites",
    "sourceReview:src/features/projects/planning/rollover.ts#c85b8628be133b2e89cdf72c60d5bf8a8dd638f3e249b03a9b4d6105a7274b04",
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
    "sourceReview:src/features/projects/planning/views.ts#8ef6cbd1680a1949d2caca49156c6629ca3ffa0d0d1d0e8ca9f83b7cc99416b1",
    "sourceReview:src/features/projects/planning/schema.ts#4cbfdf05caabb49e6e283d36ed49c2a57b4643a5021840cd9aa8cd1648ee1b53",
    "sourceReview:src/features/projects/planning/router.ts#a8d88c5613e90935b77f9b8f9d6ebcdeb6321fccccc78d21d19826d395257b4f",
    "sourceReview:src/features/projects/planning/groups.ts#423e89a9690619011ba117e641b00fba5902f3004ae81af80ac187f426986be6",
    "sourceReview:src/features/projects/planning/assignments.ts#6a7200a8f932cacbfcc4349cbe77c8a8233fd7beb9b50655095ba8aa07186268",
    "derived:src/features/projects/planning/assignments.ts",
  ],
  {
    owner: "internal project planning",
    categories: [
      "cycle and module titles, descriptions, dates and progress states",
      "work-item membership in cycles and modules",
      "saved view ownership, layout and filter definitions, and personal favorites",
    ],
    subjectRelation:
      "Saved view authors and optional assignee filters reference workforce identities. Group membership references work items whose authors and assignees remain in the Projects domain.",
    purpose:
      "Schedule work in cycles, organize named deliverables in modules, and reopen filtered project work in a saved layout.",
    disclosure:
      "Core rechecks the enabled module and the actor’s project grant for each request. Private view definitions require current project access and authorship. Active project edit, author, and archive permissions gate changes.",
    retention:
      "Planning records and assignments persist in PostgreSQL and backups. Archived groups and views retain their links. Cycle rollover preserves the source progress totals and destination identity. Web holds the current projection in memory and addresses saved or scoped views with the opaque identifier in the URL.",
    externalEffects:
      "Same-origin typed procedures read and update scoped Core records. Changes have no provider, background delivery or object-store effect.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
