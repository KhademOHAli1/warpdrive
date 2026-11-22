import { classifyInventory } from "./registryClassification";

export const operationsSearchEntry = classifyInventory(
  [
    "derived:src/features/search/operationsFilter.ts",
    "derived:src/features/search/operationsFixture.ts",
    "sourceReview:src/features/search/operationsContracts.ts#fda9b089f9e1d20a205639e5969656554086d70859f49ab4b1b3e8cfb8fd2eac",
    "sourceReview:src/features/search/operationsFilter.ts#c9ad4c6a42ac062779c4667a6ef86678b914285e0c29d195e0f58609d74d3da9",
    "sourceReview:src/features/search/operationsFixture.ts#0230d8ce7d288b3ba5b617f4068dcebc6a14e15b04d60e5804a234d5efa53577",
    "sourceReview:src/features/search/ui/SearchResultsList.tsx#5843987528a06240d40ed57ef79a6d59714b4b5c809b393d4dd95c5984956700",
  ],
  {
    owner: "workspace location and booking search",
    categories: [
      "current site and location labels",
      "authorized booking titles and stable route identities",
    ],
    subjectRelation:
      "Booking results use the current operator’s site management or requester authority.",
    purpose: "Open a scoped location or booking from the existing workspace search.",
    disclosure:
      "Directory and booking owners provide independent scope. Search results omit anonymous occupancy and requester contact details.",
    retention:
      "The explicit Web fixture projects synthetic directory and booking labels and applies no additional durable write.",
    externalEffects:
      "Results can focus an exact authorized demo location or booking using its stable link.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
