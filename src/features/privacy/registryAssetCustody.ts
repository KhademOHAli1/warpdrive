import { classifyInventory } from "./registryClassification";

export const assetCustodyEntry = classifyInventory(
  [
    "derived:src/features/assets/custody/contracts.ts",
    "derived:src/features/assets/custody/repository.ts",
    "derived:src/features/assets/custody/ui/CustodyPanels.tsx",
    "derived:src/features/assets/custody/ui/useCustodyWorkspace.ts",
    "derived:src/features/assets/ui/AssetsFixture.tsx",
    "sourceReview:drizzle/0145_asset_custody.sql#b39abb6874182a3b34d3f21dc3666e07b8687567f36091951cb8b1549749bf9e",
    "sourceReview:src/features/assets/custody/actions.backend.ts#28c8175c47302880ca5f4020f347ef592d110d9213dd95de85c8d4a0f50d3c33",
    "sourceReview:src/features/assets/custody/contracts.ts#51ff421149453f84d6a0e3645d5ed8b5289c504ac217822e2e62221567e4db70",
    "sourceReview:src/features/assets/custody/repository.ts#fc62c5db672f1102c0d7b4ad08a3600010d7659849b578bf2124f0bc03c9303a",
    "sourceReview:src/features/assets/custody/schema.ts#78fe08d886e893ac286ac84f7d2c3bba4fc2c47eedfa94864919d03abfca23a3",
    "sourceReview:src/features/assets/custody/service.ts#5006c6600f445a34f9f82641ae583ae45acfd0d2692dd60a6b11682ad5b72586",
    "sourceReview:src/features/assets/custody/transitions.ts#214b42a61199a30f1147cc653d17a3d678cc86910bba6a4f7a22a5c96ab67460",
    "sourceReview:src/features/assets/custody/ui/CustodyDialogs.tsx#efdce9cf32c42f8a48e9cbea51671ecb01e5b0f571f7e5f6f5b35fad8468e1f0",
    "sourceReview:src/features/assets/custody/ui/CustodyPanels.tsx#81c04bf3a09892a9c5d080cb628311db2e0f456be00e9cccd963618614791c09",
    "sourceReview:src/features/assets/custody/ui/messages.ts#b512d91984d8abdf2e0b1ebcac5026c1b58b74c52905b1b1d295c304659401be",
    "sourceReview:src/features/assets/custody/ui/useCustodyWorkspace.ts#258cfe10d618525835a125193bfda9fcd1c3664014a8963e4cec5513cc84c22f",
    "sourceReview:src/features/assets/custody/webActions.ts#d7d88cf25b869c840f5b65beb3dccb322810e8499597fb33f0a2a12882b25442",
    "sourceReview:src/features/assets/ui/AssetsFixture.tsx#d7b6aaa9e674676574dfbd5e63597964dfdcfff58f1155f174443360d09d5c24",
    "table:asset_custodian_notes",
    "table:asset_custodians",
    "table:asset_custody_history",
    "table:asset_custody_holdings",
    "table:asset_custody_receipts",
    "writer:src/features/assets/custody/repository.ts#delete:assetCustodyHoldings",
    "writer:src/features/assets/custody/repository.ts#insert:assetCustodianNotes",
    "writer:src/features/assets/custody/repository.ts#insert:assetCustodians",
    "writer:src/features/assets/custody/repository.ts#insert:assetCustodyHistory",
    "writer:src/features/assets/custody/repository.ts#insert:assetCustodyHoldings",
    "writer:src/features/assets/custody/repository.ts#update:assetCustodians",
    "writer:src/features/assets/custody/repository.ts#update:assetCustodyHoldings",
    "writer:src/features/assets/custody/service.ts#insert:assetCustodyReceipts",
    "writer:src/features/assets/custody/service.ts#update:dynamic",
    "writer:src/features/assets/custody/ui/useCustodyWorkspace.ts#delete:id",
  ],
  {
    owner: "equipment custody and handovers",
    categories: [
      "site-scoped custodian display names and optional accepted staff links",
      "equipment IDs, quantities, condition, handover locations, and operator notes",
      "native staff attribution, versioned handover history, and request receipts",
    ],
    subjectRelation:
      "An Asset custodian can be an existing staff member or a named non-login person.",
    purpose:
      "Track equipment held by each custodian, its condition and the quantities returned to storage.",
    disclosure:
      "Asset viewers see holdings and item history at their granted sites. Asset managers at those sites see the custody roster and recipient notes. Staff selection exposes account IDs and names. Web masks the register and its dialogs from replay.",
    retention:
      "PostgreSQL retains custody snapshots and notes after returns, moves and roster edits. Account deletion clears live account links while retaining the original handover snapshot.",
    externalEffects:
      "An Asset manager can move equipment and free quantities into custody, transfer holdings and return quantities to a shared bin. Equipment balances, custody and history commit in one transaction.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
