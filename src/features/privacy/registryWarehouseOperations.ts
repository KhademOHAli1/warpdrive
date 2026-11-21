import { classifyInventory } from "./registryClassification";

export const warehouseOperationsEntry = classifyInventory(
  [
    "derived:src/features/inventory/warehouse/operations/shared.ts",
    "derived:src/features/inventory/warehouse/operations/transfers.ts",
    "derived:src/features/inventory/warehouse/operations/ui/OperationsDialogs.tsx",
    "sourceReview:drizzle/0132_inventory_warehouse_operations.sql#efcf5c21041db6891f4f198cecb7658ba9cd363696171882bb592bf06b3d7570",
    "sourceReview:src/app/(app)/inventory/warehouse/operations/page.tsx#00f3a30ba0348befb901d3ebeacf8e95dfa67d711f1c23e17169d62bc875483e",
    "sourceReview:src/features/inventory/warehouse/operations/corrections.ts#1c532cd566e640ad7a23f433ab1396a8152cba9ea3358b3d63db81967e6603f5",
    "sourceReview:src/features/inventory/warehouse/operations/historyProjection.ts#1b643f463f8951083ed49a20719abc97643d17ad11c8420ed54c06217be71612",
    "sourceReview:src/features/inventory/warehouse/operations/service.ts#eb7044fa6169f1624e7d0761f4393532a6b1d6f7edc65018cd50ab59f7454c99",
    "sourceReview:src/features/inventory/warehouse/operations/shared.ts#76c810f5a7a447556622ad14a1074b42a1b26eb4dcba5790b156e19bb6888f4a",
    "sourceReview:src/features/inventory/warehouse/operations/transferProjection.ts#bb2d8258384c92d6eca9b7be1587034543247616fe1288f767bf137f26886048",
    "sourceReview:src/features/inventory/warehouse/operations/transfers.ts#bfc07a2caf7e691ff7993b38a81b280005b9bb123dc376acef9dfc950df21100",
    "sourceReview:src/features/inventory/warehouse/operations/ui/OperationsDialogs.tsx#a1836229c1b2d65fb3441fb30e871235384b290391264fa295a7ef0884d91cff",
    "table:inventory_stock_event_details",
    "table:inventory_stock_transfer_lines",
    "table:inventory_stock_transfers",
    "writer:src/app/(app)/inventory/warehouse/operations/page.tsx#query:dynamic",
    "writer:src/features/inventory/warehouse/operations/corrections.ts#update:inventoryStockPositions",
    "writer:src/features/inventory/warehouse/operations/historyProjection.ts#execute:sql",
    "writer:src/features/inventory/warehouse/operations/service.ts#insert:inventoryCommandReceipts",
    "writer:src/features/inventory/warehouse/operations/service.ts#update:dynamic",
    "writer:src/features/inventory/warehouse/operations/shared.ts#insert:inventoryStockEventDetails",
    "writer:src/features/inventory/warehouse/operations/shared.ts#insert:inventoryStockEvents",
    "writer:src/features/inventory/warehouse/operations/transferProjection.ts#execute:sql",
    "writer:src/features/inventory/warehouse/operations/transfers.ts#insert:inventoryStockPositions",
    "writer:src/features/inventory/warehouse/operations/transfers.ts#insert:inventoryStockTransferLines",
    "writer:src/features/inventory/warehouse/operations/transfers.ts#insert:inventoryStockTransfers",
    "writer:src/features/inventory/warehouse/operations/transfers.ts#update:inventoryStockPositions",
    "writer:src/features/inventory/warehouse/operations/transfers.ts#update:inventoryStockTransferLines",
    "writer:src/features/inventory/warehouse/operations/transfers.ts#update:inventoryStockTransfers",
  ],
  {
    owner: "warehouse transfer and correction history",
    categories: [
      "location, revision, lot, serial, transfer and movement references",
      "native actor name and ID, version, operation reason, quantity and reversal link",
    ],
    subjectRelation:
      "Warehouse operations identify the staff member who performed them. Transfer lines remain linked to physical stock identities.",
    purpose:
      "Track stock from dispatch to receipt and preserve reasoned corrections and their compensating entries.",
    disclosure:
      "Core checks the active native actor, catalog access and site grants. Transfer orders require visibility at both endpoints. A locally visible movement omits cross-site references and reasons when the transfer is inaccessible. Warehouse content is masked from replay.",
    retention:
      "PostgreSQL keeps the operation events and captured historical locations. Corrections and reversals append durable entries. Search and pagination are held in memory in the Web view.",
    externalEffects:
      "Authorized Web queries and CSRF-guarded commands use typed Core APIs and transactional warehouse writes.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
