import { classifyInventory } from "./registryClassification";

export const projectDocumentsInventoryEntry = classifyInventory(
  [
    "sourceReview:src/features/projects/documents/ui/ProjectPageEditor.tsx#62927ca97b61a473e0297286059453779594472bccc2f682bdffaca89857c928",
    "sourceReview:src/features/projects/documents/live/useProjectDocumentCollaboration.ts#98f38e553d9d588f3c4678b1ea72dcace92f6f42114b15271bc0e41ca392487f",
    "sourceReview:src/features/projects/documents/live/state.ts#7bcdbe3652396040df118dcb4c42b32f57d1507b2acda1cf6283031efcdcc110",
    "writer:src/features/projects/documents/live/presence.ts#insert:presence",
    "writer:src/features/projects/documents/live/presence.ts#delete:presence",
    "table:internal_project_document_presence",
    "sourceReview:src/features/projects/documents/live/presence.ts#84770518d5474c9c97f6ad51035350634e7856a815ce6b5d09caf4b3a149c8a0",
    "sourceReview:src/features/projects/documents/live/awareness.ts#d27685b343a60cfbaed0b5fe000a596e10fb0608784c06e7f1e1b0bae8ecf931",
    "derived:src/features/projects/documents/live/awareness.ts",
    "sourceReview:drizzle/0121_internal_project_documents.sql#28352e3a2e638c00827df34b2f62e9fc7bb2d232677ea3ade472e81fa6a5cad3",
    "sourceReview:src/features/projects/documents/actions.backend.ts#3e4c4a880313fa57a9a38e50e3f34e2afb847d3203781d975c35ee359b38f812",
    "sourceReview:src/features/projects/documents/actions.ts#e039de3c838e2988328e3a6189c4e8a3ebade48a93a56e4c207b1cd191cc393e",
    "sourceReview:src/features/projects/documents/contracts.ts#2e41822ab3845e3c2e0e9a56728cb5a1a0ca85b26cbfe4dbf95047204b131eae",
    "sourceReview:src/features/projects/documents/input.ts#7ec0baaa122ac22a7170a1621e0f87b100de086f01dc5274985ae3e4a7a4abed",
    "sourceReview:src/features/projects/documents/router.ts#6a240e0da53da8593f74a66486befd1a7dbf6485a247be6e43cc8c2a7695b600",
    "sourceReview:src/features/projects/documents/schema.ts#a8905e0c6f27716d7af934c1907bb53d67ee52af2f1ad095c898339fe6d3be66",
    "sourceReview:src/features/projects/documents/service.ts#1eaed67cf27005c9b88ccb616695dacf85c5761a09ac3d04c47b5f39b69201b2",
    "sourceReview:src/features/projects/documents/webReads.ts#29a60794992a3dbf2c65bc86c915db5b01ffcafd32da341fac13d50ec427c206",
    "sourceReview:src/features/projects/documents/ui/ProjectPage.tsx#2a0be0ef505abcd6778fc4ec4258f87b7e0ae19b3865346911caeadd6827fb14",
    "sourceReview:src/features/projects/documents/ui/ProjectPagesList.tsx#f9746e359c93d79b49f399d4f64592cc2e9fbd7cb18e7f20fe2984fe29bfd6b3",
    "table:internal_project_documents",
    "table:internal_project_document_versions",
    "writer:src/features/projects/documents/router.ts#query:dynamic",
    "writer:src/features/projects/documents/service.ts#insert:documents",
    "writer:src/features/projects/documents/service.ts#insert:versions",
    "writer:src/features/projects/documents/service.ts#update:documents",
    "writer:src/features/projects/documents/ui/ProjectPage.tsx#execute:dynamic",
    "writer:src/features/projects/documents/ui/ProjectPagesList.tsx#execute:dynamic",
    "writer:src/features/projects/documents/webReads.ts#query:dynamic",
    "writer:src/features/projects/documents/webReads.ts#query:input",
  ],
  {
    owner: "internal project documents",
    categories: [
      "document titles and rich-text content",
      "workforce authors and editors",
      "content revisions and lifecycle state",
      "same-page cursor positions and short-lived editing presence",
    ],
    subjectRelation:
      "An author or editor identity records participation in internal project documentation. Authored content can describe other workforce or customer subjects.",
    purpose:
      "Create, edit and retrieve written project material, inspect versions, and manage archive and edit-lock state within a single internal project.",
    disclosure:
      "Core rechecks the enabled module, live session, current workforce admission and project-local grant. Private documents and versions are available to the author only while the author can access the project. The selected project and document identifiers are constrained together before serving content, history or live peers. Only current admitted project sessions receive collaborator display names and selections for the same page.",
    retention:
      "Current sanitized HTML, the bounded collaborative document and historical snapshots persist in PostgreSQL and backups. Presence expires from reads within 15 seconds and is removed on leave, subsequent collaboration traffic, or session or page deletion. Idle expired rows may physically persist until that cleanup runs.",
    externalEffects:
      "Web reads and writes use the existing authenticated Core boundary. Core merges Yjs updates and stores bounded content and revision snapshots. Only active same-page peers receive relative cursor positions, without Core session identifiers. Embedded resources and active HTML are removed. No provider connection, background delivery or object store write is added.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
