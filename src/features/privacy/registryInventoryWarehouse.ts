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
    "sourceReview:src/features/inventory/warehouse/balances.ts#3b61f397a4d74e6755f2dac2b89521117b08358b6edcba38225796ccee5e28d1",
    "sourceReview:src/features/inventory/warehouse/changes.ts#de58bdc03d983bc83a8ca3f0b74d2833ebb617694af98ae2ef109282e5a736c3",
    "sourceReview:src/features/inventory/warehouse/reads.ts#d4ce94e357f8f16cd6d2c99f2243dae166ff66587ce540659318a1e3f239ea62",
    "sourceReview:src/features/inventory/warehouse/router.ts#5c8dd55c7a8233b18b7371b4c0b94c483bb56bb65b0087ff331d639f9e47bb8a",
    "sourceReview:src/features/inventory/warehouse/schema.ts#4c7e0ebc24cbe1c873215638c63518245e2d7264a87895b8e16c947596a52c25",
    "sourceReview:src/features/inventory/warehouse/service.ts#03a2eef43583aaa11ecc366e956100d47853b897944c551443e786a5d868047a",
    "sourceReview:src/features/inventory/warehouse/snapshot.ts#00456e16b111d5a72e237598ef4e4fe7c0d57b210304f657bcb112e6e0f49cc5",
    "sourceReview:src/features/inventory/warehouse/ui/WarehouseFixture.tsx#725c6b0484a3681aa0a7f2d5bfcbc479040d27f7178ed2dbede4b7f4c6b78b53",
    "sourceReview:src/features/inventory/warehouse/ui/WarehouseWorkspaceView.tsx#7c821346d94515879518ab6afb7bdbd380917a81af81ef59cce3c686b0fc6946",
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
