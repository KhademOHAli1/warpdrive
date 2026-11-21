import { classifyInventory } from "./registryClassification";

export const projectProfileInventoryEntry = classifyInventory(
  [
    "sourceReview:drizzle/0123_internal_project_profile_activity.sql#47a2aeb67baf2377f52106976d36fcdf8eac4b912de206fa753cb75b618ae2ab",
    "sourceReview:src/features/projects/profile/events.ts#2ccb8818f76218d4e33fea3d5cf28acda45c2618b91fad97b3b51c5217faa5c9",
    "sourceReview:src/features/projects/profile/router.ts#723739df262de12e6eccbe37ceb87a0e9a4ed7425cdb4e3be7641453de2cd404",
    "sourceReview:src/features/projects/profile/schema.ts#c99b8dd21d21848801533c26b7da76318a952a578cb2425afb69378eb3217614",
    "sourceReview:src/features/projects/profile/service.ts#6591ffd8a540b19659d87908cb6560a621740627c70e04864bcedfce68676941",
    "sourceReview:src/features/projects/profile/subscriptions.ts#14f93b120d556b318e9e29d8c88abc38d3d6488163890930bca2ba3ddc9063aa",
    "sourceReview:src/features/projects/profile/webReads.ts#298ceb812c31f26ee9959c267ca2f329e38971a07318ff03addf49f6f89f2c36",
    "table:internal_project_item_events",
    "table:internal_project_item_subscriptions",
    "writer:src/features/projects/profile/events.ts#insert:internalProjectItemEvents",
    "writer:src/features/projects/profile/router.ts#query:dynamic",
    "writer:src/features/projects/profile/subscriptions.ts#delete:subscriptions",
    "writer:src/features/projects/profile/subscriptions.ts#insert:subscriptions",
    "writer:src/features/projects/profile/webReads.ts#query:dynamic",
    "writer:src/features/projects/profile/webReads.ts#query:input",
    "writer:src/features/projects/profile/webReads.ts#query:none",
  ],
  {
    owner: "internal project member profile",
    categories: [
      "member and work-item subscription links",
      "work-item actor, action, and event timestamp",
      "permission-filtered current work-item titles, status, and priority",
    ],
    subjectRelation:
      "A subscription records a member’s choice to follow a work item. An event identifies the workforce actor who performed an authenticated create or update. The current title may describe other subjects.",
    purpose:
      "Let members review their assigned, created and subscribed work and their own work-item activity. Subscribing adds an item to the member’s list.",
    disclosure:
      "Core derives the actor from the live native session. Profile queries constrain items and events to Internal projects that the actor owns or can currently read through membership. The subscription command accepts changes for the actor only, checks the CSRF context, verifies both the item and project and holds the project read grant through the transaction.",
    retention:
      "PostgreSQL and its backups hold a subscription until removed and event rows as product history. Both link only the item and workforce identity. Parent item or actor hard deletion cascades to this data. There is no privacy-case execution adapter or automatic history expiry.",
    externalEffects:
      "The subscription command inserts or deletes an actor/item relation. Committed work-item commands append metadata-only events in the same transaction as the work item. Summary and list views use typed Core reads. Subscription triggers no notifications, outbound delivery, provider access, background work, or persistent browser storage.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
