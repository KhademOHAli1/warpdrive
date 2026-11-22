import { classifyInventory } from "./registryClassification";

export const assetDiscoveryEntry = classifyInventory(
  [
    "derived:src/features/assets/discovery/batch.ts",
    "derived:src/features/assets/discovery/fixture.ts",
    "derived:src/features/assets/discovery/settings.ts",
    "derived:src/features/assets/discovery/sort.ts",
    "derived:src/features/assets/discovery/ui/AssetRegisterBatch.tsx",
    "derived:src/features/search/ui/equipmentFixture.ts",
    "sourceReview:src/features/assets/discovery/batch.ts#657ec622604aef216c8713c4669e956405a93004d8abdb2af8b4acc0d987f980",
    "sourceReview:src/features/assets/discovery/contracts.ts#4ca0437c9015078044c4d19644d7eccbdaf601af05cd33715f8b77da7458ca11",
    "sourceReview:src/features/assets/discovery/fixture.ts#64bbb20c0511dd2f5593022eb4b170a455ad307531133608b3aae8f127cd5eea",
    "sourceReview:src/features/assets/discovery/settings.ts#d7a5a7a7aea072a8e8ae0f7f59b5bdece56eefa2cea4cbc4f10e295ed3f5cf96",
    "sourceReview:src/features/assets/discovery/sort.ts#03c5d84e0b48378e35bcdc852186fb48bf47b2815e09e1b7d1222a8d30d8604a",
    "sourceReview:src/features/assets/discovery/ui/AssetRegisterBatch.tsx#bf12c98b65d921aeeaa4ac0b6f41045861be6c81fc21bee7ef9063f57733e720",
    "sourceReview:src/features/assets/discovery/ui/AssetRegisterDiscoveryToolbar.tsx#c3ed2e9daa632f5df80a1327fda5f49f71bc0253fb9a38b8043bd2b61c07ccef",
    "sourceReview:src/features/assets/discovery/ui/AssetRegisterSortMenu.tsx#b41e253da88ffdb04af2b7116f2a8e1585ddea98abcda9e307d6136547c3611d",
    "sourceReview:src/features/assets/discovery/ui/AssetRegisterViewsMenu.tsx#aac126d3019598148c4e3ed3c220a1ed5ca0b17b5d0abe8cb6a3c1a79f5429aa",
    "sourceReview:src/features/assets/discovery/ui/DiscoveryDialog.tsx#44fe75b7280f5f60e1b73cf51ccc28f023fc6c89ba71e1c46fa524f96ef093e5",
    "sourceReview:src/features/assets/discovery/ui/messages.ts#e87b196216bfe12dc63c9ba72ea6c916425f21027700a0c1413702bccd863eef",
    "sourceReview:src/features/assets/discovery/ui/presentation.ts#e3a173c89fe02e876d41c9357c32dfc98af41b16fa6ba70eab4e7372d28dc224",
    "sourceReview:src/features/search/ui/equipmentFixture.ts#15b930e15c806186eec0f433e53ac55a24d3becfc9482bb895c70eb134ec321a",
    "writer:src/features/assets/discovery/fixture.ts#delete:id",
    "writer:src/features/assets/discovery/ui/AssetRegisterBatch.tsx#delete:id",
  ],
  {
    owner: "site-scoped equipment register discovery and metadata edits",
    categories: [
      "equipment identifiers, names, model and serial labels under site visibility",
      "per-actor equipment filters, selected columns and sorts, and exact batch change outcomes",
    ],
    subjectRelation: "Saved views and batch requests belong to the current native staff member.",
    purpose:
      "Find equipment, reuse a personal register view and edit explicitly selected equipment records.",
    disclosure:
      "Scoped Assets projections control results. Search, register and dialogs are masked from session replay.",
    retention:
      "Demo saved views, selection and edit results stay in browser memory for the current fixture view.",
    externalEffects:
      "Fixture views and bulk edits have no Core effect. In fixture mode search contains the agreed synthetic equipment rows.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
