import { classifyInventory } from "./registryClassification";

export const assetMediaEntry = classifyInventory(
  [
    "derived:src/features/assets/media/fixture.ts",
    "derived:src/features/assets/media/ui/AssetMedia.tsx",
    "sourceReview:src/features/assets/media/contracts.ts#4c2aea670e1a0c29ea5a191745d322afd64edce763ca35cc82b05b352ee7b9b9",
    "sourceReview:src/features/assets/media/fileRules.ts#2cfb57fab36285e9ff63067eae3390f5a9a7bc130849058eeebe04e6c31762d1",
    "sourceReview:src/features/assets/media/fixture.ts#d2e1d7a89c2d358edf74583747035ca0c4255c82f42d92671503fa4aa06ce4bb",
    "sourceReview:src/features/assets/media/ui/AssetMedia.tsx#43e5fd4a673c0e93c1f6972615cd97497d515eb49a452535fda641e250940cda",
    "sourceReview:src/features/assets/media/ui/ModelMedia.tsx#a733f092bf3d7ef293ab93e300037dc64fdc3b944f5e0dcfcea6ca3cb487fbde",
    "sourceReview:src/features/assets/media/ui/messages.ts#046f17d9d0824e1f5186d3ed00d6c434554c08ed92444c9ff7cc3f43da8ba879",
    "sourceReview:src/features/assets/media/ui/useAssetMedia.ts#b1b1e0c42208448e78604cff14e840d8850700d0f83c45f6c01ddce036a3b21a",
  ],
  {
    owner: "site-scoped equipment photos and supporting documents",
    categories: [
      "equipment and model IDs, selected photos and earlier file versions",
      "equipment photos and supporting PDFs, display filenames and attributable file activity",
    ],
    subjectRelation:
      "Media belongs to a site equipment record or model and shows the staff member who uploaded or selected it.",
    purpose:
      "Give an equipment operator a visual reference and authorized access to supporting files and their history.",
    disclosure:
      "Media inherits the register's current site scope. The Asset register and media dialogs are masked from session replay.",
    retention:
      "Fixture photos and PDFs remain in local browser memory and are released when the view closes.",
    externalEffects:
      "Explicit local fixture sessions can preview demonstration photos and download selected files without a Core write.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
