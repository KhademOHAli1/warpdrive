import { classifyInventory } from "./registryClassification";

export const assetTagsEntry = classifyInventory(
  [
    "browserStore:src/features/assets/tags/fixtureData.ts#storageKey",
    "derived:src/features/assets/tags/fixtureCommands.ts",
    "derived:src/features/assets/tags/fixtureData.ts",
    "derived:src/features/assets/tags/legacyImport.ts",
    "derived:src/features/assets/tags/ui/AssetTagWorkspace.tsx",
    "derived:src/features/assets/tags/ui/TagEditors.tsx",
    "derived:src/features/assets/tags/ui/TagImportDialog.tsx",
    "sourceReview:src/app/(app)/assets/tags/page.tsx#8939cd08fc8f3cb59cd5ef71c43e757c6899d7c9a0bb6ca24e353aad6229c400",
    "sourceReview:src/app/equipment-tag/[token]/page.tsx#2342172bb56f39fb3ccc24274b014904306a9b848c481ee1685f9052d51f8752",
    "sourceReview:src/features/assets/tags/AssetTagsFixture.tsx#6f2c5cef1fe1397994f68f5c2ef3eadbe7314db33589a5c59095aac2a13b6c9c",
    "sourceReview:src/features/assets/tags/contracts.ts#236888409f26774c1b2d501d4c84f2178de6591b68254e0326b89efbb0975e04",
    "sourceReview:src/features/assets/tags/fixtureCommands.ts#503ff178193d96a2d1d54d9e840447809003cbfa9cc0ea4d7059f541d501b39d",
    "sourceReview:src/features/assets/tags/fixtureData.ts#f126ba1e6b84c72e7d9a725625cd8c1a66a4870903d6cc9d4bf98ebcc1857f58",
    "sourceReview:src/features/assets/tags/fixtureScans.ts#f19e6966f2c019799b052922862b27763c9c5a4763530552f5570a21f3c0e350",
    "sourceReview:src/features/assets/tags/legacyImport.ts#12aa14f4892b26fccf0bbb45cd03e1418baf3b498be92a44196b74b9a035a1af",
    "sourceReview:src/features/assets/tags/tagCodes.ts#5fc8ada0398532229c2a702cd619a5fe1546b8b128ea37f6f5008e8269edfd78",
    "sourceReview:src/features/assets/tags/ui/AssetTagLanding.tsx#cd9c102475958d23a915087114e934928d27cbd92b128ec1eb8597ecbf506283",
    "sourceReview:src/features/assets/tags/ui/AssetTagWorkspace.tsx#272ba1eba91d8b30a5eafdd6984720d84d7985aa80774a35335c146210b8f11e",
    "sourceReview:src/features/assets/tags/ui/AssetTagsLink.tsx#9256fc2ae15201ee2e9f1837dfbeaffff162735ab9b30710bf6928e4d2e7db8c",
    "sourceReview:src/features/assets/tags/ui/TagEditors.tsx#d62bd80711ae4d868cfd313ebc590f750b53a2f7f8ba4cf1de883f6e435f5fae",
    "sourceReview:src/features/assets/tags/ui/TagImportDialog.tsx#2b3571a9220f1d3d9cb27f49288ff67a62d15c322d96ddf13a32006d0aee3f5c",
    "sourceReview:src/features/assets/tags/ui/TagPanels.tsx#876663695280a28a086c02f663d62250c91d644aeb29d5e04a3a44a46f015f06",
    "sourceReview:src/features/assets/tags/ui/assetTagLandingMessages.ts#07bd65119e6900aad2161a0ca092acd845da6980f4ef76903828a4ff9c57d707",
    "sourceReview:src/features/assets/tags/ui/tagMessages.ts#3f52b6bd4478bfbf79d4a332a8e7e62149ef925585fce1f15f664477990c5302",
    "writer:src/features/assets/tags/fixtureData.ts#setItem:storageKey",
    "writer:src/features/assets/tags/ui/AssetTagLanding.tsx#send:dynamic",
    "writer:src/features/assets/tags/ui/AssetTagWorkspace.tsx#delete:id",
    "writer:src/features/assets/tags/ui/AssetTagWorkspace.tsx#delete:key",
  ],
  {
    owner: "site-scoped equipment tags",
    categories: [
      "site, asset and kit identities with dated tag assignments and prior aliases",
      "issued and imported code identities, operator references, scan times, source and optional coordinates",
      "public contact messages and optional reply email, read receipts and assignment status",
    ],
    subjectRelation:
      "A printed tag points to an equipment assignment at a site. A visitor can submit contact information only when that assignment enables public messaging.",
    purpose:
      "Issue, print, claim, swap and migrate equipment tags, provide site-scoped scan history, and route optional owner messages to the responsible site inbox.",
    disclosure:
      "The finder sees a generic owner message form for an opted-in tag. A signed-in viewer sees the currently authorized record, and a site manager can review allowed coordinates and owner messages. Printed links and the tag surfaces are removed from replay.",
    retention:
      "Demo tags, action receipts, optional location and contact form entries remain in the current browser session storage.",
    externalEffects:
      "The fixture resolves synthetic equipment and can open the operating system print dialog. A visitor message is simulated in the same browser and no external delivery is invoked.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
