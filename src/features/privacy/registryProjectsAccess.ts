import { classifyInventory } from "./registryClassification";

export const projectBrandInventoryEntry = classifyInventory(
  [
    "sourceReview:src/features/projects/brand/cover.ts#8855cf41f2a6fd3b7e36c7f80404026ab43aaa3d60177ebf323e4c8b9af24b89",
    "sourceReview:src/features/projects/brand/schema.ts#85962219fde949af296537c7abdb9ceeebc1cca642e57fa9f5c70bf071cc64cc",
    "table:internal_project_cover_assets",
    "writer:src/features/projects/brand/cover.ts#delete:assets",
    "writer:src/features/projects/brand/cover.ts#insert:assets",
  ],
  {
    owner: "Projects branding and calendar settings",
    categories: ["project logos and cover imagery", "project time zone"],
    subjectRelation: "User-provided imagery can depict people. Time zones are project settings.",
    purpose:
      "Render chosen branding and use a common calendar day for project schedules and Intake.",
    disclosure:
      "Private covers require current project membership. Owners can explicitly publish an image through the revocable board.",
    retention:
      "Only the current normalized image remains in the active store. Historical backups follow the installation policy.",
    externalEffects:
      "Core normalizes PNG, JPEG or WebP locally. No image is fetched from a third-party host.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);

export const projectGuestInventoryEntry = classifyInventory(
  [
    "sourceReview:src/features/projects/guests/invitations.ts#b37e0265456a7e837cc5287e285f7659f3f24536c09aadd7a4cf3f442bc904c2",
    "sourceReview:src/features/projects/guests/service.ts#15b74b905493855ba6fe3b5c5db0bf945d9703948337559a76e76afd252cc9f0",
    "writer:src/features/projects/guests/invitations.ts#insert:agencyProjectMembers",
    "writer:src/features/projects/guests/invitations.ts#insert:users",
    "writer:src/features/projects/guests/service.ts#insert:agencyProjectMembers",
    "writer:src/features/projects/guests/service.ts#update:settings",
    "writer:src/proxy.ts#delete:PROJECT_GUEST_PATH_HEADER",
  ],
  {
    owner: "Projects guest access",
    categories: [
      "invited identity, email and name",
      "project membership and guest scope",
      "revocable account invitations",
    ],
    subjectRelation:
      "The guest is the invited account owner. The invitation audit records who initiated access.",
    purpose:
      "Grant project-specific access to an existing user or provision a verified Projects-only external guest.",
    disclosure:
      "Owner-only invitation and settings. Guests must authenticate and can only reach authorized project features.",
    retention:
      "Project membership can be removed. Invitations, mail outbox records, and account data follow the native identity lifecycles.",
    externalEffects:
      "The existing authentication outbox queues invitation and verification emails for the operator-configured transport.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);

export const projectPublicationInventoryEntry = classifyInventory(
  [
    "sourceReview:src/features/projects/publication/PublicIntakeForm.tsx#dc82edc6181b10c7a690dbcb57f452230293af01d82d1a24d3c61b138233de74",
    "sourceReview:src/features/projects/publication/PublicIntakePortal.tsx#66280ca0ba4f37488ee02b192d5770217952f77a7498c914a4a01ea896b16b11",
    "sourceReview:src/features/projects/publication/PublicationSettings.tsx#885843a376527219766b1d42b84774c7847effd4faa5e0d19243d98b956a1f92",
    "sourceReview:src/features/projects/publication/router.ts#730dee43659bbe9582d84708fc51d8c25536c0e3ee841130f45371b38ab23e2f",
    "sourceReview:src/features/projects/publication/schema.ts#c4c944b5e645e4ab6024a0285dc4a59bfd7dd2452abc061c3af6190034c4e607",
    "sourceReview:src/features/projects/publication/service.ts#70f199749b3c3979899ce32e4659d93db4ced2eb0c8e088dafd5e4442d5fb843",
    "sourceReview:src/features/projects/publication/webReads.ts#50e0782c54fc1554453f2ab475e447c7f0de43a5d411b6198815d7b3cfa35840",
    "table:internal_project_publications",
    "writer:src/features/projects/publication/PublicIntakeForm.tsx#execute:dynamic",
    "writer:src/features/projects/publication/PublicIntakePortal.tsx#execute:dynamic",
    "writer:src/features/projects/publication/PublicationSettings.tsx#execute:dynamic",
    "writer:src/features/projects/publication/router.ts#query:dynamic",
    "writer:src/features/projects/publication/service.ts#insert:publications",
    "writer:src/features/projects/publication/webReads.ts#query:dynamic",
    "writer:src/features/projects/publication/webReads.ts#query:none",
  ],
  {
    owner: "Published Projects boards and visitor Intake",
    categories: [
      "revocable public board links",
      "published work titles and branding",
      "authenticated visitor-authored Intake",
    ],
    subjectRelation:
      "Intake retains the reporter. Shared title or uploaded branding can contain information concerning people.",
    purpose:
      "Publish an opted-in project projection and accept requests from authenticated visitors into native Intake.",
    disclosure:
      "Anonymous visitors can see the published fields through the active link. Visitor request reads and changes are restricted to their own records.",
    retention:
      "Unpublish invalidates the link. Intake decision and withdrawal records follow the native Intake lifecycle.",
    externalEffects:
      "Web serves the approved projection to link holders. Submission queues no external delivery and does not grant membership.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);

export const projectIntegratorInventoryEntry = classifyInventory(
  [
    "derived:src/features/projects/integrator/planning.ts",
    "derived:src/features/projects/integrator/runtime.ts",
    "derived:src/features/projects/integrator/workItems.ts",
    "sourceReview:src/app/(app)/settings/projects-integrator/page.tsx#7bcea875e311e5e8ab6ae2be9b04984992280a2d3d83726ab794f915adb7bbdd",
    "sourceReview:src/features/projects/integrator/ProjectIntegratorSettings.tsx#db117948fa8fb37ee30dc0c25fec9966bf697a62ce639b6c745580330f0779a8",
    "sourceReview:src/features/projects/integrator/keyFormat.ts#248d3d0b53c91ffb391d115ef8453ed92153e5df07e844172aeda788f0b4dedb",
    "sourceReview:src/features/projects/integrator/management.ts#17bbd6a30505df23bb0678996c60198fa5b036432c0182aa8dcf27357c2830a2",
    "sourceReview:src/features/projects/integrator/planning.ts#0dcc6af1754b6724354e7fb9cd4eb3fdbf048f806c50a48d5fd31af1cdf71cff",
    "sourceReview:src/features/projects/integrator/principal.ts#7a46618f03520a6f95b35d5abcb574c1fa17bb75879953f4f89f1239c7693582",
    "sourceReview:src/features/projects/integrator/router.ts#4eaa638663be261081065d7b593ae8bbd98b6b13d1ac2dba3962c57d7ee8126b",
    "sourceReview:src/features/projects/integrator/runtime.ts#27b1892582ec7948388f7bdc5e4c066844dcc04a92c04278bb88293199d27a0d",
    "sourceReview:src/features/projects/integrator/schema.ts#9af83ce5cc78d724cd0ae27ee54ad634dbb5b104d95990ca2e87c72ab8af8360",
    "sourceReview:src/features/projects/integrator/workItems.ts#b98b7eebcaa88fe64b647d8d8c539238a7354091ab7da3f624dba99b9a2fdf3b",
    "table:project_integrator_keys",
    "writer:src/app/(app)/settings/projects-integrator/page.tsx#query:none",
    "writer:src/features/projects/integrator/ProjectIntegratorSettings.tsx#execute:dynamic",
    "writer:src/features/projects/integrator/keyFormat.ts#update:token",
    "writer:src/features/projects/integrator/management.ts#insert:keys",
    "writer:src/features/projects/integrator/management.ts#update:keys",
    "writer:src/features/projects/integrator/principal.ts#update:keys",
    "writer:src/features/projects/integrator/router.ts#query:dynamic",
  ],
  {
    owner: "Projects integrator API",
    categories: ["personal API key digest and last use", "authorized project data"],
    subjectRelation:
      "Keys belong to one authenticated internal account. API work is attributed to that actor.",
    purpose:
      "Allow automation clients to read or change native Projects resources with the caller's current permissions.",
    disclosure:
      "The plaintext credential is shown only on issue. Use requires the key and current project authority. Project guests cannot issue keys.",
    retention:
      "The digest, hint, lifecycle and last use remain with the owner. Expiry or revocation ends authority immediately.",
    externalEffects:
      "Provides a client-initiated HTTP API on the existing installation. It does not call integration providers.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
