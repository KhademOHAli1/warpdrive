import { classifyInventory } from "./registryClassification";

export const engineeringChangesEntry = classifyInventory(
  [
    "derived:src/features/inventory/releases/changes/fixture.ts",
    "derived:src/features/inventory/releases/changes/reviewFixture.ts",
    "derived:src/features/inventory/releases/changes/ui/EngineeringChangePanel.tsx",
    "sourceReview:src/features/inventory/releases/changes/contracts.ts#4a4d3d2e1c375ec6de8f12197d65d491b434ddf58b2bd7bc68f22d213302d4ba",
    "sourceReview:src/features/inventory/releases/changes/fixture.ts#d3e09165bd432ec38da65a25bf46cbe4ab6f7a8b3076ae9762e8360f622a7084",
    "sourceReview:src/features/inventory/releases/changes/reviewFixture.ts#6e830112ac5dbec52cf7cfdb140a6d44b302772d5603e643d8dc64938a293025",
    "sourceReview:src/features/inventory/releases/changes/ui/EngineeringChangePanel.tsx#c32d140f7d027e33e7463584594309ff01e90a42dfdd2573e0cc5c13b89ca932",
    "sourceReview:src/features/inventory/releases/changes/ui/EngineeringChangeRows.tsx#a82d931274494f30b258861abf84efab2ec8ffca0bc18ab426a24f2ec57255a2",
    "sourceReview:src/features/inventory/releases/changes/ui/EngineeringComparison.tsx#698d2c3e94162499bc02ae1fb5eb006e49eacec04bdc5f51ff31dc6d5fc934b0",
    "sourceReview:src/features/inventory/releases/changes/ui/messages.ts#43d38509ccc93672eaaee6703b7a01cf8eb2b94f8c84ee21604bd1978a47b3e6",
    "writer:src/features/inventory/releases/changes/reviewFixture.ts#delete:manufacturingBom",
    "writer:src/features/inventory/releases/changes/ui/EngineeringChangePanel.tsx#delete:key",
    "writer:src/features/inventory/releases/changes/ui/EngineeringChangePanel.tsx#execute:dynamic",
    "writer:src/features/inventory/releases/changes/ui/EngineeringChangePanel.tsx#update:dynamic",
    "writer:src/features/inventory/releases/changes/ui/EngineeringChangePanel.tsx#update:emptyProposal",
    "writer:src/features/inventory/releases/ui/ManufacturingReleasesFixture.tsx#execute:command",
  ],
  {
    owner: "manufacturing engineering changes",
    categories: [
      "product and release identity, engineering revision history and user decisions",
      "review evidence digests, approved BOM deltas and where-used references",
      "site-scoped release provenance, lot and serial disposition preview",
    ],
    subjectRelation:
      "Release editors, approvers and scoped warehouse staff are attributed to their own fixture decisions.",
    purpose:
      "Preview an exact engineering change, its future effective release and disposition of known old stock.",
    disclosure:
      "Use active fixture role capabilities. Mask manufacturing evidence, staff names and position identifiers in session replay.",
    retention:
      "Fixture reviews, dispositions and build pins live in disposable browser memory and reset on reload.",
    externalEffects:
      "The fixture computes file digests locally and applies state only in the browser.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
