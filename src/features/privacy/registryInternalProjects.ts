import { classifyInventory } from "./registryClassification";

export const internalProjectsInventoryEntry = classifyInventory(
  [
    "table:internal_project_items",
    "sourceReview:drizzle/0122_internal_project_item_details.sql#d1ff7f2b010386a7dbb4a3d1d17b39b9db3f81d08b63e80abeb102fecc1c9c3f",
    "writer:src/features/projects/ui/InternalProjectWorkspace.tsx#delete:view",
    "writer:src/features/projects/ui/InternalProjectWorkspace.tsx#delete:item",
    "writer:src/features/projects/profile/webReads.ts#query:none",
    "writer:src/features/projects/profile/webReads.ts#query:input",
    "writer:src/features/projects/profile/router.ts#query:dynamic",
    "derived:src/features/projects/ui/planeDirectory.tsx",
    "sourceReview:src/features/projects/ui/planeDirectory.tsx#660d045922166eb79286b927411a85e1e22515a59d833b7e3d6809f7d2ce9a78",
    "sourceReview:src/features/projects/profile/webReads.ts#14516789990f1086b207f746b43f59f79f7f04e1c2ea93d2de9666238f09cf4f",
    "sourceReview:src/features/projects/profile/router.ts#4337219af5fd082dcbabf0a2f4fe06d14de69b6ee5dbe50dcf917389f51c9334",
    "sourceReview:drizzle/0120_internal_projects.sql#c1816f9fe75298b6875c8a5919d23263e8cda1da1feeff58162dfe744f17bc87",
    "sourceReview:src/features/projects/schema.ts#0c0f72e38ca8148e05eefe46114338627fb9809eb4c6e49f9a1054133410e9b1",
    "sourceReview:src/features/projects/access.ts#8a00a70fd99ff1a25c22411ca828bee231330415220ebcfcdc6fc2a6ff67f9bd",
    "sourceReview:src/features/projects/actions.backend.ts#43d3bfb39582dfd3f87d3c1cc1394d4e9bdf181a1284994681361829072c1848",
    "sourceReview:src/features/projects/actions.ts#94d80f927756d8affdee96133b38745795a8c8a93ddc71cc5ffc1826ce0f2952",
    "sourceReview:src/features/projects/router.ts#04a72f5b35b5144586e7b8d7ef6f1e59f9b5d98fe47a78d59f54000ccc7cf70b",
    "sourceReview:src/features/projects/service.ts#a4482e3492cb093fda8f26e0542c00ed4e9d9c25d5447d4aac3dfe2bd010ece2",
    "sourceReview:src/features/projects/webReads.ts#2768c3441a1a3f9e07b589c940af19d8869ffa378ffb85840caa5ea518837419",
    "writer:src/features/projects/router.ts#query:dynamic",
    "writer:src/features/projects/service.ts#delete:agencyProjectMembers",
    "writer:src/features/projects/service.ts#insert:agencyProjectMembers",
    "writer:src/features/projects/service.ts#insert:agencyProjects",
    "writer:src/features/projects/service.ts#insert:internalProjectItems",
    "writer:src/features/projects/service.ts#update:dynamic",
    "writer:src/features/projects/service.ts#update:internalProjectItems",
    "writer:src/features/projects/webReads.ts#query:dynamic",
    "writer:src/features/projects/webReads.ts#query:none",
    "derived:src/features/projects/testing/fixture.ts",
    "sourceReview:src/features/projects/testing/fixture.ts#ad2ef71f244043a6a944f2863d945d15a10300e93b0239af701661b03765e44f",
    "sourceReview:src/features/projects/ui/InternalProjectWorkspace.tsx#f151b0faf48c5377926b06255223230722772ceeb5f407365e0577c666f7bf4e",
    "sourceReview:src/features/projects/ui/InternalProjectsList.tsx#824be2e671981041cafd5602535ff646b72b9eef25ce830a098498595f435001",
    "sourceReview:src/features/projects/ui/projectWrites.ts#85b37cf2ceb843225378525ae3341e3e436e66193d37d626eb4dfcb8baebd2d9",
    "writer:src/features/projects/ui/InternalProjectWorkspace.tsx#execute:dynamic",
    "writer:src/features/projects/ui/InternalProjectsList.tsx#execute:dynamic",
    "writer:src/features/projects/ui/projectWrites.ts#write:none",
  ],
  {
    owner: "internal projects",
    categories: [
      "project titles and work-item titles and descriptions",
      "accepted staff memberships, work-item creators, and assignees",
      "work-item status, priorities, scheduling dates, and revisions",
    ],
    subjectRelation:
      "Membership, ownership and assignment identify workforce access and work allocation. They do not identify every person referred to in authored titles or descriptions.",
    purpose:
      "Coordinate internal project work. List and board views share the same project work-item records and project-local membership grants.",
    disclosure:
      "Core derives the live session and accepted active staff from the existing module gate. Only owners and explicit members receive project and work-item projections. The owner-only staff picker returns names and IDs without email or credentials. Project-local edit and assignment grants control writes, and commands recheck the expected account and CSRF before requesting a change.",
    retention:
      "Project identities, work items, project-local membership and creation history persist in PostgreSQL and backups. Loaded Web components hold their current projection and pending command state in memory. No persistent browser data store is added. Web keeps the view name and opaque work-item ID in the URL for direct navigation.",
    externalEffects:
      "Typed Web index and workspace queries read permission-filtered Core projections. The authenticated command bridge can create internal projects and work items, update work-item content or assignments, and modify project membership. Membership removal clears assignments to that member within the same transaction. The Web callbacks submit through this command bridge. The synthetic frontend fixture uses only in-memory state. The project schema and commands use existing workforce identities and have no provider, queue or object storage effect.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
