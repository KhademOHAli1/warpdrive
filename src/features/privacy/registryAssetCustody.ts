import { classifyInventory } from "./registryClassification";

export const assetCustodyEntry = classifyInventory(
  [
    "derived:src/features/assets/custody/contracts.ts",
    "derived:src/features/assets/custody/ui/CustodyPanels.tsx",
    "derived:src/features/assets/custody/ui/useCustodyWorkspace.ts",
    "derived:src/features/assets/ui/AssetsFixture.tsx",
    "sourceReview:src/features/assets/custody/contracts.ts#51ff421149453f84d6a0e3645d5ed8b5289c504ac217822e2e62221567e4db70",
    "sourceReview:src/features/assets/custody/transitions.ts#ada558f7e3c78b98f1b9ad65c4c41987c976b027f2cd1a99f9ad85ae6d22f1d0",
    "sourceReview:src/features/assets/custody/ui/CustodyDialogs.tsx#efdce9cf32c42f8a48e9cbea51671ecb01e5b0f571f7e5f6f5b35fad8468e1f0",
    "sourceReview:src/features/assets/custody/ui/CustodyPanels.tsx#81c04bf3a09892a9c5d080cb628311db2e0f456be00e9cccd963618614791c09",
    "sourceReview:src/features/assets/custody/ui/messages.ts#b512d91984d8abdf2e0b1ebcac5026c1b58b74c52905b1b1d295c304659401be",
    "sourceReview:src/features/assets/custody/ui/useCustodyWorkspace.ts#258cfe10d618525835a125193bfda9fcd1c3664014a8963e4cec5513cc84c22f",
    "sourceReview:src/features/assets/ui/AssetsFixture.tsx#1ea7f2336de3e93f56f70828a531835d6bd2a2841a1dc65d05969540a4168a8c",
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
    retention: "Synthetic fixtures and receipts live in memory and reset on reload.",
    externalEffects:
      "The Web fixture changes its in-memory available and held quantities. Core continues to handle authenticated reads.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
