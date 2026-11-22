import { classifyInventory } from "./registryClassification";

export const engineeringChangesEntry = classifyInventory(
  [
    "derived:src/features/inventory/releases/changes/fixture.ts",
    "derived:src/features/inventory/releases/changes/reviewFixture.ts",
    "derived:src/features/inventory/releases/changes/ui/EngineeringChangePanel.tsx",
    "sourceReview:src/features/inventory/releases/changes/contracts.ts#887b07dbbb49342a557697e9c686c96d5d9084b4f0116d878366a712c5ee4f99",
    "sourceReview:src/features/inventory/releases/changes/fixture.ts#d3e09165bd432ec38da65a25bf46cbe4ab6f7a8b3076ae9762e8360f622a7084",
    "sourceReview:src/features/inventory/releases/changes/reviewFixture.ts#ac6f585a5d1b1d4c0f8e45516fce80b288b53e65ec350249cbc8cc2b2017f712",
    "sourceReview:src/features/inventory/releases/changes/ui/EngineeringChangePanel.tsx#c32d140f7d027e33e7463584594309ff01e90a42dfdd2573e0cc5c13b89ca932",
    "sourceReview:src/features/inventory/releases/changes/ui/EngineeringChangeRows.tsx#a82d931274494f30b258861abf84efab2ec8ffca0bc18ab426a24f2ec57255a2",
    "sourceReview:src/features/inventory/releases/changes/ui/EngineeringComparison.tsx#55b4999569836bc0727f8414a9e1a2d9a11025a15282ce1f859549b8f72c76e7",
    "sourceReview:src/features/inventory/releases/changes/ui/messages.ts#3fa02c4b448ad908e95fcb6aae67c10b26e678142f57746dd595a439d7fe59fc",
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
