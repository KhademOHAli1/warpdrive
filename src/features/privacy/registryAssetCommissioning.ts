import { classifyInventory } from "./registryClassification";

export const assetCommissioningEntry = classifyInventory(
  [
    "derived:src/features/assets/commissioning/eligibility.ts",
    "sourceReview:drizzle/0144_asset_commissioning.sql#4c2d49fd3fddbfed9da38b2da84b59245ac2e53a3bcc9a3ce5b9c72ce9ae163e",
    "sourceReview:src/features/assets/commissioning/actions.backend.ts#ef8a2c92b14b810f15d76bb994ad0c13f2351d6eb8e34e14ec11e0e587a4532f",
    "sourceReview:src/features/assets/commissioning/eligibility.ts#fd78a883ff22d7de44da5db16553dcff791c3f49ead0e637497538333f66a954",
    "sourceReview:src/features/assets/commissioning/protection.ts#1aed014572a2efed6d7fae16be40e509981337c13c1e20f5ef74d9c3a2f616e5",
    "sourceReview:src/features/assets/commissioning/schema.ts#9b4771df6bf735f38cd1adb4472f830321d0e2ac46785f827ebe16ce9e8cecd8",
    "sourceReview:src/features/assets/commissioning/service.ts#e2caf3d6a6e2b98aa9b6244e3cbaf9e1855e5568987a24f41db0b758cf4a5035",
    "sourceReview:src/features/assets/commissioning/webActions.ts#9223f148a5cf20fb3a9d211091e668c8aa0c5dc608d04077c717aeaeeb2207ce",
    "table:asset_commissioning_handoffs",
    "writer:src/features/assets/commissioning/service.ts#insert:assetCommissioningHandoffs",
    "writer:src/features/assets/commissioning/service.ts#update:dynamic",
    "writer:src/features/assets/commissioning/service.ts#update:inventoryStockPositions",
  ],
  {
    owner: "Inventory-to-Asset commissioning",
    categories: [
      "exact stock position, part, lot, serial, bin, and optional approved build provenance",
      "independent equipment identity, Inventory debit and Asset history",
      "native staff acting at the shared site, handoff reasons and replay receipts",
    ],
    subjectRelation:
      "The handoff identifies the authorized native operator and links two equipment records.",
    purpose: "Commission one warehouse unit as equipment and reconcile the two domain ledgers.",
    disclosure:
      "Core rechecks current Warehouse and Asset authority at the same site. Each module exposes its own authorized history, and Web masks the handoff form from replay.",
    retention:
      "PostgreSQL retains the exact zero-balance stock position, original serial, immutable handoff and both ledger entries.",
    externalEffects:
      "One transaction posts the Inventory debit and creates one Asset. The development fixture applies the same visible interaction to disposable data.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
