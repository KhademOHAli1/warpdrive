import { classifyInventory } from "./registryClassification";

export const internalProjectsInventoryEntry = classifyInventory(
  [
    "table:internal_project_items",
    "sourceReview:drizzle/0120_internal_projects.sql#c1816f9fe75298b6875c8a5919d23263e8cda1da1feeff58162dfe744f17bc87",
    "sourceReview:src/features/projects/schema.ts#8f71dcd1f3e1eb6a8b602c8329eb80e60044360e9bd9518431bdf087183a4a6a",
    "sourceReview:src/features/projects/access.ts#8a00a70fd99ff1a25c22411ca828bee231330415220ebcfcdc6fc2a6ff67f9bd",
    "sourceReview:src/features/projects/actions.backend.ts#43d3bfb39582dfd3f87d3c1cc1394d4e9bdf181a1284994681361829072c1848",
    "sourceReview:src/features/projects/actions.ts#94d80f927756d8affdee96133b38745795a8c8a93ddc71cc5ffc1826ce0f2952",
    "sourceReview:src/features/projects/router.ts#0423d03025d6c7e8f0521f1004fae3fd6a8fd9fab899f63fb94eba9fb4e1ad44",
    "sourceReview:src/features/projects/service.ts#d92bdd1f4056c0563a238291401f5a16824a30eb5cb30c3e7dbf21a6dbd916d7",
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
    "sourceReview:src/features/projects/testing/fixture.ts#f61615ef94c453bda74a282adc879d803dd9b024a5c04102aace0ab11d44ca86",
    "sourceReview:src/features/projects/ui/InternalProjectWorkspace.tsx#d2d54187bdcffc83a03f9341346f2caa672f2fdbb265b5b89b2dd2b34e347e3e",
    "sourceReview:src/features/projects/ui/InternalProjectsList.tsx#a6d3f1a6a1245fd1c3b41ce325843a325d39340c22d89d03fccfdd507acfaa00",
    "sourceReview:src/features/projects/ui/projectWrites.ts#85b37cf2ceb843225378525ae3341e3e436e66193d37d626eb4dfcb8baebd2d9",
    "writer:src/features/projects/ui/InternalProjectWorkspace.tsx#execute:dynamic",
    "writer:src/features/projects/ui/InternalProjectsList.tsx#execute:dynamic",
    "writer:src/features/projects/ui/projectWrites.ts#write:none",
  ],
  {
    owner: "internal projects",
    categories: [
      "project and work-item titles",
      "accepted staff memberships and assignees",
      "work-item status and revisions",
    ],
    subjectRelation:
      "Membership, ownership and assignment identify workforce access and work allocation. They do not identify every person referred to in authored titles.",
    purpose:
      "Coordinate internal project work. List and board views share the same project work-item records and project-local membership grants.",
    disclosure:
      "Core derives the live session and accepted active staff from the existing module gate. Only owners and explicit members receive project and work-item projections. The owner-only staff picker returns names and IDs without email or credentials. Project-local edit and assignment grants control writes, and commands recheck the expected account and CSRF before requesting a change.",
    retention:
      "Project identities, work items, project-local membership and creation history persist in PostgreSQL and backups. Loaded Web components hold their current projection and pending command state in memory. No persistent browser data store or lifecycle adapter is added.",
    externalEffects:
      "Typed Web index and workspace queries read permission-filtered Core projections. The authenticated command bridge can create internal projects and work items, update work-item content or assignments, and modify project membership. Membership removal clears assignments to that member within the same transaction. The Web callbacks submit through this command bridge. The synthetic frontend fixture uses only in-memory state. The project schema and commands use existing workforce identities and have no provider, queue or object storage effect.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
