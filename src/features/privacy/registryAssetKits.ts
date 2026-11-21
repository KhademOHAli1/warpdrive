import { classifyInventory } from "./registryClassification";

export const assetKitsEntry = classifyInventory(
  [
    "derived:src/features/assets/kits/contracts.ts",
    "derived:src/features/assets/kits/transitions.ts",
    "derived:src/features/assets/kits/ui/KitDefinitionDialog.tsx",
    "derived:src/features/assets/kits/ui/KitDetail.tsx",
    "derived:src/features/assets/kits/ui/KitHandoverDialogs.tsx",
    "derived:src/features/assets/kits/ui/KitsRegister.tsx",
    "derived:src/features/assets/kits/ui/kitView.ts",
    "sourceReview:src/features/assets/kits/contracts.ts#0e21128e18614e6a9fd9bf13a8a2d2fa1dd5918531deb960b10a4bc4bfb7ffd6",
    "sourceReview:src/features/assets/kits/transitions.ts#4f3918a8ad6d09ed5e98781101905933d434984381edecdef5749d53b4d910aa",
    "sourceReview:src/features/assets/kits/ui/KitDefinitionDialog.tsx#a770dfdc25e0f9b62d31bf9d7f2b6b4d359fc0073d985b4631466e5d54cd18fc",
    "sourceReview:src/features/assets/kits/ui/KitDetail.tsx#1e384edde023721664824651bd396c53545a9ade3c8765647b8faedc4b1f18da",
    "sourceReview:src/features/assets/kits/ui/KitDialog.tsx#4af8420da24c543efab7d5c3d89010663bdee529d812ac38a7676ecd24e599c3",
    "sourceReview:src/features/assets/kits/ui/KitHandoverDialogs.tsx#2015776a3f401c0db2d4531b15d57fd033ba4b3e7abcb85e2abf69e30b5367fe",
    "sourceReview:src/features/assets/kits/ui/KitsRegister.tsx#dcd1ec5cc70529e11abeb728ba6b2defc460226142b7ad4465d9f6bef03730ce",
    "sourceReview:src/features/assets/kits/ui/kitView.ts#64ce594cdf2b7b91dd267e250bc7fc23a3de9288a229755f5d1a56e335a73d9c",
    "sourceReview:src/features/assets/kits/ui/messages.ts#f38dd1d488baf15c5296894ea603c2975f44edfb6756a5ab3bd95b13e0194919",
    "sourceReview:src/features/assets/kits/ui/useKitWorkspace.ts#fdd502a64182440b9ebb4e62b610d0430ea638a02c219a069473e6db862d2b51",
    "sourceReview:src/features/assets/kits/usage.ts#2f27f0e6eb83c954148118101bfbcb09d7504a6fe9aada7c676235b53d3a2ae0",
  ],
  {
    owner: "site-scoped equipment kits",
    categories: [
      "equipment, serials, model requirements, and packed, returned and consumed quantities",
      "site and bin references, named or staff custodians, and actor attribution",
      "kit definitions, handover snapshots, condition and operator notes",
    ],
    subjectRelation:
      "Kit custody identifies a staff-linked or named non-login custodian and logs the staff author of each action.",
    purpose:
      "Track kit components through packing, handover, substitution, partial return and consumption.",
    disclosure:
      "Asset access limits kit contents and handover history to granted sites. Managers select active same-site custodians. The UI masks kit contents and dialogs from replay.",
    retention: "Synthetic fixture commands and receipts live in memory until reload.",
    externalEffects:
      "The fixture moves synthetic quantities between loose, packed, held and consumed states in memory.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
