import { classifyInventory } from "./registryClassification";

export const sharedLocationsEntry = classifyInventory(
  [
    "derived:src/features/locations/directory.ts",
    "sourceReview:src/features/locations/directory.ts#b53d02706b7be9cd3fa652a6390d97a5834bd8444640509893971904cfddba84",
  ],
  {
    owner: "shared sites and locations",
    categories: ["demo sites, location names and codes, site and parent relationships"],
    subjectRelation:
      "The directory fixture contains operational places. It does not store user or customer IDs.",
    purpose: "Exercise one site and location hierarchy across the Inventory and Assets contexts.",
    disclosure:
      "The development fixture uses the native active session for access. An administrator can edit the browser-local directory. Directory fields and dialogs are masked from replay.",
    retention: "Location edits exist only in Web component state and reset on reload.",
    externalEffects: "Directory edits do not invoke Core, provider APIs or external storage.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
