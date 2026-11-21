import { classifyInventory } from "./registryClassification";

export const projectDocumentsInventoryEntry = classifyInventory(
  [
    "sourceReview:drizzle/0121_internal_project_documents.sql#28352e3a2e638c00827df34b2f62e9fc7bb2d232677ea3ade472e81fa6a5cad3",
    "sourceReview:src/features/projects/documents/actions.backend.ts#3e4c4a880313fa57a9a38e50e3f34e2afb847d3203781d975c35ee359b38f812",
    "sourceReview:src/features/projects/documents/actions.ts#e039de3c838e2988328e3a6189c4e8a3ebade48a93a56e4c207b1cd191cc393e",
    "sourceReview:src/features/projects/documents/contracts.ts#cc4cd441a09bb12bb5e657294624f6beba64f0af2b1dafaeda30804c93e2c6e6",
    "sourceReview:src/features/projects/documents/input.ts#af85002a0a7c4e7626a0bdbdeb9c7b6b90f0e67166ffa57f9ac718b17708a5ad",
    "sourceReview:src/features/projects/documents/router.ts#82e0009155d418fcb65f9dba040d6d6ddc02b9cf0f28d5cc69edf95bb84c194c",
    "sourceReview:src/features/projects/documents/schema.ts#441c1620dc8eb3667016814cecddf43b1ccaebac4a4f249f45a3b4cf5faf88e7",
    "sourceReview:src/features/projects/documents/service.ts#570df1c0c524fd209342995b874eb34431a241e9072b0fbd1818d8a60c35c4d8",
    "sourceReview:src/features/projects/documents/webReads.ts#29a60794992a3dbf2c65bc86c915db5b01ffcafd32da341fac13d50ec427c206",
    "sourceReview:src/features/projects/documents/ui/ProjectPage.tsx#30228228f112ac30668a7111dd06d92b8e939c129720b3affb0e2f08f26d74ea",
    "sourceReview:src/features/projects/documents/ui/ProjectPagesList.tsx#b7143e7e5408e0056e39ce698df1fa0348516e482d050c0f7d75ba1c90242955",
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
    ],
    subjectRelation:
      "An author or editor identity records participation in internal project documentation. Authored content can describe other workforce or customer subjects.",
    purpose:
      "Create, edit and retrieve written project material, inspect versions, and manage archive and edit-lock state within a single internal project.",
    disclosure:
      "Core rechecks the enabled module, live session, current workforce admission and project-local grant. Private documents and versions are available to the author only while the author can access the project. The selected project and document identifiers are constrained together before serving content or a revision.",
    retention:
      "Current sanitized HTML and historical content snapshots persist in PostgreSQL and backups. Archived documents remain in project scope until an authorized restore. No lifecycle adapter or archive expiry is enabled.",
    externalEffects:
      "Web reads and writes use the existing authenticated Core boundary. Core stores bounded HTML and revision snapshots. Embedded resources and active HTML are removed. No provider connection, background delivery or object store write is added.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
