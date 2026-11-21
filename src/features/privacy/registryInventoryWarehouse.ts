import { classifyInventory } from "./registryClassification";

export const inventoryWarehouseEntry = classifyInventory(
  [
    "derived:src/features/inventory/warehouse/balances.ts",
    "derived:src/features/inventory/warehouse/reads.ts",
    "derived:src/features/inventory/warehouse/snapshot.ts",
    "derived:src/features/inventory/warehouse/ui/WarehouseFixture.tsx",
    "derived:src/features/inventory/warehouse/ui/WarehouseWorkspaceView.tsx",
    "sourceReview:drizzle/0131_inventory_warehouse.sql#5a8bf84ec0478db6c68e09d10fcd74f0dbb4567e58ccb8bcb8b08f7d2c55a56e",
    "sourceReview:src/app/(app)/inventory/warehouse/page.tsx#25b0e22a9a54ceca62656f90cdbe2178dfe34695fdd5ad3f35063dc6eb858226",
    "sourceReview:src/features/inventory/warehouse/balances.ts#9b022b4d2bae891443ac991de914b32d6b0ee784b1a37b992e8011e81a626588",
    "sourceReview:src/features/inventory/warehouse/changes.ts#294655e249d89a32e54df150d20e30ed1bebd059abd00d1ad261474459cba1a6",
    "sourceReview:src/features/inventory/warehouse/reads.ts#c707d4e010e03bef256284b6a5c224fbf978a9f2558165a428954800e75ced92",
    "sourceReview:src/features/inventory/warehouse/router.ts#065e119174b75c0ac5487c5ffb95d668ae26958668679b973bb2b2a888eae78a",
    "sourceReview:src/features/inventory/warehouse/schema.ts#2b6f3981f7bc09ce7044049cca97d0ec5ef632949df79ad4dc3a90d43beef10d",
    "sourceReview:src/features/inventory/warehouse/service.ts#8a98e09d5d772c342989c6aee7db9c165ee28d6e7352de118045ff003e684049",
    "sourceReview:src/features/inventory/warehouse/snapshot.ts#50896c372af9fb5eb9e6dfa9acaa1df529f4ec3bd83b699386f443f60f6f4788",
    "sourceReview:src/features/inventory/warehouse/ui/WarehouseFixture.tsx#dca5417b3a9ba455d7f6a2628b57cef0e6b376facf83f1894093270cf7f565f5",
    "sourceReview:src/features/inventory/warehouse/ui/WarehouseWorkspaceView.tsx#bcfbacab58dc743637b0c2d08c2f1427c57cef4a53e55f88c21c9a598f17ab2f",
    "table:inventory_stock_allocations",
    "table:inventory_stock_events",
    "table:inventory_stock_incoming",
    "table:inventory_stock_location_policies",
    "table:inventory_stock_positions",
    "writer:src/app/(app)/inventory/warehouse/page.tsx#query:dynamic",
    "writer:src/features/inventory/warehouse/balances.ts#delete:inventoryStockAllocations",
    "writer:src/features/inventory/warehouse/balances.ts#execute:sql",
    "writer:src/features/inventory/warehouse/balances.ts#insert:inventoryStockAllocations",
    "writer:src/features/inventory/warehouse/balances.ts#insert:inventoryStockEvents",
    "writer:src/features/inventory/warehouse/changes.ts#insert:inventoryStockEvents",
    "writer:src/features/inventory/warehouse/changes.ts#insert:inventoryStockIncoming",
    "writer:src/features/inventory/warehouse/changes.ts#insert:inventoryStockLocationPolicies",
    "writer:src/features/inventory/warehouse/changes.ts#insert:inventoryStockPositions",
    "writer:src/features/inventory/warehouse/changes.ts#update:inventoryStockIncoming",
    "writer:src/features/inventory/warehouse/changes.ts#update:inventoryStockPositions",
    "writer:src/features/inventory/warehouse/router.ts#query:dynamic",
    "writer:src/features/inventory/warehouse/service.ts#insert:inventoryCommandReceipts",
    "writer:src/features/inventory/warehouse/service.ts#update:dynamic",
    "writer:src/features/inventory/warehouse/snapshot.ts#execute:sql",
    "writer:src/features/inventory/warehouse/ui/WarehouseWorkspaceView.tsx#delete:key",
  ],
  {
    owner: "warehouse stock traceability",
    categories: [
      "stock balances by part revision, site and location, lot, serial, expiry, state and incoming plans",
      "CRM owner organization references, order and reservation links, event actor and command receipt",
    ],
    subjectRelation:
      "An authorized role may link stock to a visible CRM organization. Stock events and idempotency receipts identify the current native actor.",
    purpose:
      "Separate physical, reserved, available and incoming units, trace exact reservations and preserve existing aggregate inventory history.",
    disclosure:
      "Native user and directory grants scope site reads and writes. Restricted part records follow catalog visibility. CRM owner labels follow CRM visibility. Administrators manage the legacy Unlocated pool. Warehouse data and dialogs are masked from replay.",
    retention:
      "PostgreSQL retains trace events, existing stock movements, serial identities and inbound plan history. Settled positions remain as trace references. The explicit local fixture uses disposable component state.",
    externalEffects:
      "Authorized Web calls use typed Core reads and CSRF-guarded commands. Position changes, order allocations, canonical movement links and receipts commit in PostgreSQL transactions.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
