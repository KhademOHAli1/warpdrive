import { classifyInventory } from "./registryClassification";

export const industrialInventoryEntry = classifyInventory(
  [
    "derived:src/features/inventory/fixtures.ts",
    "derived:src/features/inventory/projectBridge.ts",
    "derived:src/features/inventory/reads.ts",
    "derived:src/features/inventory/service.ts",
    "derived:src/features/inventory/stock.ts",
    "derived:src/features/inventory/ui/InventoryClient.tsx",
    "sourceReview:drizzle/0127_industrial_inventory.sql#8b41d0580b5b5ef1beeaf0026cfa81b843191bea78b8d7225d0a1d50c7247e7f",
    "sourceReview:src/app/(app)/inventory/page.tsx#87e365221fc9f47633723bcf399c81639311264ce5ae1b89059112daa23f805f",
    "sourceReview:src/features/inventory/fixtures.ts#9f155cf2aa027899855e9e36a7c84dc597ef0c6326af2cb134b523a061e14794",
    "sourceReview:src/features/inventory/projectBridge.ts#b04b89fbbd59d47140488c5ab1fadbfa500898b74fdf18f718c3d18f11144c3a",
    "sourceReview:src/features/inventory/reads.ts#fd101b75f28866a904f721a43a3b19d689410451bffc035bf4829a4112927542",
    "sourceReview:src/features/inventory/router.ts#98e189b52afa983e2cc063b1d89f7a91bd0295ac8eb7efb9e2f36e6ecc4e0552",
    "sourceReview:src/features/inventory/schema.ts#25e403a3323372ce8580746fad9d09535ba83752baab46f4ee062cf175856a4b",
    "sourceReview:src/features/inventory/service.ts#d2c728f7496652dd66526c3e1a833e5d536b7911b1b8a7cd302d5f1e3d8d1b1e",
    "sourceReview:src/features/inventory/stock.ts#db8b66883ea230892e17ace274267f041b8cdd6ffcb708f9727f077b36698b57",
    "sourceReview:src/features/inventory/ui/InventoryClient.tsx#c3088f89c907ba264b2c076991f0c027e11ce2604e649e0dee41a4f90f2b0271",
    "table:inventory_bom_lines",
    "table:inventory_command_receipts",
    "table:inventory_items",
    "table:inventory_movements",
    "table:inventory_order_materials",
    "table:inventory_order_tasks",
    "table:inventory_orders",
    "table:inventory_templates",
    "writer:src/app/(app)/inventory/page.tsx#query:dynamic",
    "writer:src/features/inventory/projectBridge.ts#update:dynamic",
    "writer:src/features/inventory/router.ts#query:dynamic",
    "writer:src/features/inventory/service.ts#insert:inventoryBomLines",
    "writer:src/features/inventory/service.ts#insert:inventoryCommandReceipts",
    "writer:src/features/inventory/service.ts#insert:inventoryItems",
    "writer:src/features/inventory/service.ts#insert:inventoryOrderMaterials",
    "writer:src/features/inventory/service.ts#insert:inventoryOrderTasks",
    "writer:src/features/inventory/service.ts#insert:inventoryOrders",
    "writer:src/features/inventory/service.ts#insert:inventoryTemplates",
    "writer:src/features/inventory/service.ts#update:dynamic",
    "writer:src/features/inventory/service.ts#update:inventoryOrders",
    "writer:src/features/inventory/stock.ts#insert:inventoryMovements",
    "writer:src/features/inventory/stock.ts#update:inventoryItems",
    "writer:src/features/inventory/ui/InventoryClient.tsx#delete:key",
  ],
  {
    owner: "industrial inventory",
    categories: [
      "item and bill of materials, stock quantities and movement history",
      "deal references, fulfillment quantities and order state",
      "administrator delegation, command actor, and project work-item and assignee identifiers",
    ],
    subjectRelation:
      "An order can reference a visible customer deal. Staff identifiers record stock actions and authorized assignment. Inventory does not duplicate CRM contact details.",
    purpose:
      "Confirm customer demand, maintain warehouse availability, route shortages to assigned production work, and record fulfillment.",
    disclosure:
      "Accepted staff can read the catalogue. Order visibility follows the native CRM deal scope, with historical stock supervision for administrators. Project references and tasks need a separate native Projects grant. Only administrators configure templates and post warehouse operations.",
    retention:
      "PostgreSQL retains orders, stock movements, BOM snapshots, task references and replay receipts. The warehouse ledger is append-only. A removed CRM anchor is hidden or cleared while the warehouse order remains. The Web fixture and pending intents are held in memory.",
    externalEffects:
      "The authenticated action registry admits typed commands with current session and CSRF checks. Core writes stock effects and creates native Projects work items in one transaction. Warehouse data is not sent to an external service.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
