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
    "sourceReview:src/features/inventory/warehouse/changes.ts#f9c7b34f3d1f4a54dcefefc54c6aeb6d4eab5875ac15b0db56f645c55b0a8c1d",
    "sourceReview:src/features/inventory/warehouse/reads.ts#d4ce94e357f8f16cd6d2c99f2243dae166ff66587ce540659318a1e3f239ea62",
    "sourceReview:src/features/inventory/warehouse/router.ts#5c8dd55c7a8233b18b7371b4c0b94c483bb56bb65b0087ff331d639f9e47bb8a",
    "sourceReview:src/features/inventory/warehouse/schema.ts#8bef5f2810afd7cc99d9a45ae42f71c99fef5d07fc9179fc8fd67c957c225762",
    "sourceReview:src/features/inventory/warehouse/service.ts#8a98e09d5d772c342989c6aee7db9c165ee28d6e7352de118045ff003e684049",
    "sourceReview:src/features/inventory/warehouse/snapshot.ts#855d2c34a68c9a35e7786b687e6c1ce9519257779e3b233484739cff18a93eb3",
    "sourceReview:src/features/inventory/warehouse/ui/WarehouseFixture.tsx#ce9062553e5abdf4d4cfc85a1d7c5ffb8b529a902e49ecce7df583242c6f97e8",
    "sourceReview:src/features/inventory/warehouse/ui/WarehouseWorkspaceView.tsx#74eac9aa41e28d939ac5edd48d9b78193668823b6a74a35b5672b184eed7160d",
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
