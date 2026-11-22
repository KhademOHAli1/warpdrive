import { classifyInventory } from "./registryClassification";

export const assetAuditHistoryEntry = classifyInventory(
  [
    "sourceReview:src/features/assets/audits/history/AssetAuditHistory.tsx#3460d1d0cd556b43b59c643673331f228df19308c5853961e1c70f50eedb3566",
    "sourceReview:src/features/assets/audits/history/contracts.ts#ee5bdfb11dcc4f0f1bb686995fc036b5900271ed40d28f27a6ca1db97cd17404",
    "sourceReview:src/features/assets/audits/history/fixture.ts#dbba50e9148a364ebb2616f91ce5f51175ffe014d6dd89e1cb8e59abd92c94e2",
    "sourceReview:src/features/assets/audits/history/projection.ts#bada5fdc6416983d687513068e2dc5d787a1ed05fb220c497be0a890a595b500",
    "sourceReview:src/features/assets/audits/history/repository.ts#23a7788a724dd49d0dd241c91016c7c8ef138393f4e784ed52e37839947bafe5",
    "sourceReview:src/features/assets/audits/history/service.ts#299b8c14caacb5c5903496f8a75052b4a709eaefab02504c2654ae5d2ea1c92a",
    "writer:src/features/assets/audits/history/repository.ts#execute:sql",
    "writer:src/features/assets/ui/AssetsLive.tsx#query:dynamic",
  ],
  {
    owner: "equipment audit history",
    categories: [
      "authorized audit titles and frozen equipment placement",
      "finding counts and attributed correction evidence",
    ],
    subjectRelation: "Correction events relate to the auditor who recorded the count or undo.",
    purpose:
      "Reconcile original and corrected equipment counts and open the matching audit from an equipment record.",
    disclosure:
      "The same actor must currently be authorized to read the equipment and that audit. The history omits general audit notes, private files and unattributed scans.",
    retention:
      "Core reads frozen equipment rows and their correction events from the existing audit ledger. It adds no new stored personal data.",
    externalEffects:
      "Core reads exact equipment findings through the intersection of current equipment and audit permissions.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
