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
    "sourceReview:src/features/inventory/warehouse/changes.ts#a0d3e1e5c60d224e226396ab7c9e1b82bda1256458450ff9f835e2d72e9ec553",
    "sourceReview:src/features/inventory/warehouse/reads.ts#c707d4e010e03bef256284b6a5c224fbf978a9f2558165a428954800e75ced92",
    "sourceReview:src/features/inventory/warehouse/router.ts#bffe98cd8f327dfbeef949f2d09ed506b7161753a659b6465a25ccd4b8102e4d",
    "sourceReview:src/features/inventory/warehouse/schema.ts#b4e5184b6e8c1b7e0b37a54e0ec70fedeb73559e816b4652ac2f203d63168a41",
    "sourceReview:src/features/inventory/warehouse/service.ts#8a98e09d5d772c342989c6aee7db9c165ee28d6e7352de118045ff003e684049",
    "sourceReview:src/features/inventory/warehouse/snapshot.ts#855d2c34a68c9a35e7786b687e6c1ce9519257779e3b233484739cff18a93eb3",
    "sourceReview:src/features/inventory/warehouse/ui/WarehouseFixture.tsx#dca5417b3a9ba455d7f6a2628b57cef0e6b376facf83f1894093270cf7f565f5",
    "sourceReview:src/features/inventory/warehouse/ui/WarehouseWorkspaceView.tsx#7ff90cae11f71b9577d5535966f665d9de71d318c1b0a6a3c5348ee2e51a5566",
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
