import { classifyInventory } from "./registryClassification";

export const physicalLabelsEntry = classifyInventory(
  [
    "browserStore:src/features/physical-labels/fixtureState.ts#key",
    "derived:src/features/physical-labels/cameraDecoder.ts",
    "derived:src/features/physical-labels/fixtureState.ts",
    "derived:src/features/physical-labels/formats.ts",
    "derived:src/features/physical-labels/ui/LabelWorkspace.tsx",
    "sourceReview:src/app/(app)/operations/labels/page.tsx#82adb718ccbf5bcf466d198107f60843e098598838ac14b3056a85c06aff42e8",
    "sourceReview:src/app/operations/scan/page.tsx#6ac5999005521807a56c2e5780bb42b7906dd7195ee7707babe7ed49f26fde06",
    "sourceReview:src/features/physical-labels/LabelScannerFixture.tsx#bf60c2cae44f90bb67e24c1072e1916726e891c58c856183701337160282a72b",
    "sourceReview:src/features/physical-labels/LabelsFixture.tsx#2020594478cebc713d735e25495815a0046cca7cc613c4f1e1a95ef871c1cf5d",
    "sourceReview:src/features/physical-labels/barcodeDrawing.ts#afa3ada9dc8b3bef2e99ffddc25246ea1fe061cccb3c1f12149c74fd174c3f9d",
    "sourceReview:src/features/physical-labels/cameraDecoder.ts#55f34100441a2e4478a2379a4b977b35a6c03dc5510cab33fac5372412804999",
    "sourceReview:src/features/physical-labels/cameraSession.ts#51240675edc1f101eeb6eeaabf8d0c1473b5ef0f8b2981041275ab7028428572",
    "sourceReview:src/features/physical-labels/contracts.ts#eaab2e2f443ff8ec5ab34201f34cb0a890bc12a2fdd37d55a73d27e7bceab998",
    "sourceReview:src/features/physical-labels/encodeLabel.ts#57aabc6314184ea5239b545d74aefd1930b27106f18d7183fb80e6b1c214f94b",
    "sourceReview:src/features/physical-labels/fixtureState.ts#32e0092658fd472fcef2de1aa453a9af6077eaa94a65bf4213bd08bd41fdcab7",
    "sourceReview:src/features/physical-labels/formats.ts#0d43e8ac495e0d443a1d47d8f0129aaab2686ba9319c5e595dbc65149e58622a",
    "sourceReview:src/features/physical-labels/printLayout.ts#498a2b5f23c0b0db1a54b6eccdfcb657c2839ee2a9f86067b9d8231af5151989",
    "sourceReview:src/features/physical-labels/ui/LabelEditorDialog.tsx#1162831058954ef9b3ebf3a8405c98250cd0a7c4e958bb31e52805bd62830f3c",
    "sourceReview:src/features/physical-labels/ui/LabelPrintDialog.tsx#afd8e1165305049a10884b5f551fb245141100e3e9ffadda1705b2304f0cc0de",
    "sourceReview:src/features/physical-labels/ui/LabelRegistryLink.tsx#10ed91bd92a6a517a4ea4631ce6597600a84e946d39d85bfc86fd8248d190747",
    "sourceReview:src/features/physical-labels/ui/LabelScanner.tsx#135e913b82a1ca14481a658a7f3309146b154cbbafb697ad302ffac78e3bd67b",
    "sourceReview:src/features/physical-labels/ui/LabelWorkspace.tsx#afd94249a563ac622aa0fcabb24142c3c849e5b133d816d7c8316aac1b31d890",
    "sourceReview:src/features/physical-labels/ui/labelMessages.ts#9584625be11e5a83e80d3cf0a8204b3943e881a55169b6c35e6ccda3bf431477",
    "sourceReview:src/features/physical-labels/ui/scannerMessages.ts#c7936a9ed1d2b5e9fdff48f4baf75d7289798a79bf102656ea532ec815267e1a",
    "writer:src/features/physical-labels/fixtureState.ts#setItem:key",
    "writer:src/features/physical-labels/ui/LabelPrintDialog.tsx#update:dynamic",
    "writer:src/features/physical-labels/ui/LabelWorkspace.tsx#delete:id",
  ],
  {
    owner: "scoped physical labels and scanners",
    categories: [
      "equipment, kit, part, stock position, site location, release and supplier-offer identities",
      "label codes, formats, creator and retirement actor references",
      "optional camera stream decoded in browser memory and printed label names",
    ],
    subjectRelation:
      "A printable identifier links to one operations record. Persisted commands retain the authenticated issuer or retirement actor when available.",
    purpose:
      "Identify and locate an exact operations record using approved label storage, printing, and scanner input.",
    disclosure:
      "The scanner returns the minimal owner-approved record projection to the current actor. The standalone scanner, registry and print dialogs mask content and requests from replay. Scanned links are never opened as navigation targets.",
    retention:
      "Only synthetic demo label registrations and receipts are kept in actor-specific browser session storage. Camera frames are held in browser memory for local decoding.",
    externalEffects:
      "The explicit fixture resolves synthetic records and can send authorized label pages to the operating system print dialog.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
