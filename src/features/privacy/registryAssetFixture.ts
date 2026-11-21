import { classifyInventory } from "./registryClassification";

export const assetFixtureEntry = classifyInventory(
  [
    "derived:src/features/assets/registerRules.ts",
    "derived:src/features/assets/ui/AssetEditorFields.tsx",
    "derived:src/features/assets/ui/AssetEditors.tsx",
    "derived:src/features/assets/ui/AssetTable.tsx",
    "derived:src/features/assets/ui/AssetsWorkspace.tsx",
    "sourceReview:src/features/assets/fixtureCommands.ts#59040066e890a4d4416512ffde97729ce7e57542bb20b0d6f4264f9d5021e7e0",
    "sourceReview:src/features/assets/registerRules.ts#c5ea24729144c3fb5982280635fb40dbaafc8c718cde8ae8a4fff727d9424fcc",
    "sourceReview:src/features/assets/ui/AssetEditorFields.tsx#0fbcb71b1b44556453c353861cf6ff0d3fce70efb08f3d7289f6020975f7fbc5",
    "sourceReview:src/features/assets/ui/AssetEditors.tsx#0fabe57f3316fb904d4ec2ce2523d15416e45952800163fc47e8b23cc6db33ad",
    "sourceReview:src/features/assets/ui/AssetTable.tsx#31d19dd5a56788b5290bde6a20a3dfa1f5fbe5f6966286ff7c87184cbd017643",
    "sourceReview:src/features/assets/ui/AssetsWorkspace.tsx#ce32eb192f85e87fb40256c6bd1227072756759709f8eb70517281407d04d025",
    "writer:src/features/assets/fixtureCommands.ts#update:workspace",
    "writer:src/features/assets/ui/AssetEditors.tsx#update:dynamic",
  ],
  {
    owner: "equipment register development fixture",
    categories: [
      "sample equipment names, codes, model and serial numbers",
      "sample sites, locations, categories, typed values and movement history",
    ],
    subjectRelation: "The fixture uses synthetic records and a fixed actor label.",
    purpose:
      "Exercise individual assets and quantity pools in Web using the shared location fixture.",
    disclosure:
      "The authenticated development route exposes sample records. The fixtures and forms are masked from replay. Editing requires a current native administrator session.",
    retention: "Changes are kept in browser memory for the route and cleared on reload.",
    externalEffects: "The fixture performs no operational writes.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
