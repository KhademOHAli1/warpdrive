import { classifyInventory } from "./registryClassification";

export const sharedLocationsEntry = classifyInventory(
  [
    "derived:src/features/locations/directory.ts",
    "derived:src/features/locations/LocationsDirectory.tsx",
    "derived:src/features/locations/service.ts",
    "sourceReview:drizzle/0129_shared_locations.sql#dddc8ebd0ea3fad0de8f5205ad486d3d874f9506307a096a8ba72c5fb29fb4d3",
    "sourceReview:src/app/(app)/locations/page.tsx#db1403803fe9d5124cb638e73070c5e89663bfb9afb130cdc5876a2daee2a38c",
    "sourceReview:src/features/locations/directory.ts#b53d02706b7be9cd3fa652a6390d97a5834bd8444640509893971904cfddba84",
    "sourceReview:src/features/locations/LocationsDirectory.tsx#f4d462ddeb23d88168a7b307adacaec3b8c9f459c4b473d66d22999697f4c93f",
    "sourceReview:src/features/locations/router.ts#728197737102fe9225dec9084037dc4742f57ef01c9321ce758934f460cef399",
    "sourceReview:src/features/locations/schema.ts#42bab566fc010e28fed905d1f4205d5d31c42a1839c1384cc07137677860f82b",
    "sourceReview:src/features/locations/service.ts#f958732ce1c7a5a87098e9baeb85fb359914bf4a4c306d7fec13a1feb2f0ef14",
    "table:directory_command_receipts",
    "table:directory_locations",
    "table:directory_site_grants",
    "table:directory_sites",
    "writer:src/app/(app)/locations/page.tsx#query:none",
    "writer:src/features/locations/LocationsDirectory.tsx#delete:key",
    "writer:src/features/locations/router.ts#query:dynamic",
    "writer:src/features/locations/service.ts#delete:directorySiteGrants",
    "writer:src/features/locations/service.ts#execute:dynamic",
    "writer:src/features/locations/service.ts#insert:directoryCommandReceipts",
    "writer:src/features/locations/service.ts#insert:directoryLocations",
    "writer:src/features/locations/service.ts#insert:directorySiteGrants",
    "writer:src/features/locations/service.ts#insert:directorySites",
    "writer:src/features/locations/service.ts#update:directoryLocations",
    "writer:src/features/locations/service.ts#update:directorySites",
    "writer:src/features/locations/service.ts#update:dynamic",
  ],
  {
    owner: "shared sites and locations",
    categories: [
      "site and location names, codes, archive state and parent relationships",
      "native staff identifiers, site roles and staff account names and email addresses shown to administrators, and command receipts containing an actor, digest and record IDs",
    ],
    subjectRelation:
      "A grant connects a native staff account with a site. Command receipts refer to the native actor and the affected site and location.",
    purpose:
      "Maintain a shared operations directory and enforce site-scoped access across Inventory and Assets.",
    disclosure:
      "Core verifies the current accepted native session. Directory or Asset roles provide read access at their sites. Directory managers retain the existing location editing authority. Administrators also receive eligible staff names, email addresses, identifiers and grants. Directory fields and dialogs are masked from replay.",
    retention:
      "PostgreSQL retains site and location identities after archive. Revocation removes the grant. Account deletion cascades to grants and command receipts. Receipt replay recalculates current access. The explicit development fixture resets on reload.",
    externalEffects:
      "Authenticated reads and CSRF-guarded commands use the configured Core boundary. Directory changes and their receipts commit in one PostgreSQL transaction.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
