import { classifyInventory } from "./registryClassification";

export const stocktakesEntry = classifyInventory(
  [
    "derived:src/features/inventory/warehouse/stocktakes/counts.ts",
    "derived:src/features/inventory/warehouse/stocktakes/scope.ts",
    "sourceReview:drizzle/0137_inventory_stocktakes.sql#929c97a11cf74934a8f40ce036edb3b33f4bbc5ccfdfa5a923ca44bc0c73b02e",
    "sourceReview:src/app/(app)/inventory/warehouse/stocktakes/page.tsx#c9a53bf2e241310fefc1341cf1a6205d37f9b89157620073ef1e639eb11a28bb",
    "sourceReview:src/features/inventory/warehouse/stocktakes/countSchema.ts#9a09a6d0ff83697ca1cf65d63bc811bdae064101d3107e477714c4195e0215d7",
    "sourceReview:src/features/inventory/warehouse/stocktakes/counts.ts#fbd177a27dd73ce6c123f420555a4a8a3104d7edae577c395080714ca753a1ad",
    "sourceReview:src/features/inventory/warehouse/stocktakes/router.ts#1cefb70f25e97807e2582ebb6d3672749055307c8255a5d364fd165b81d1fd12",
    "sourceReview:src/features/inventory/warehouse/stocktakes/scope.ts#1004d5db5fe7bfa8bbd727bed453a9b0bb23d1d3dd3ab47e2fa34203cef500d9",
    "sourceReview:src/features/inventory/warehouse/stocktakes/service.ts#38762ac5acbb9d68a5664ee23c8279af5a6822d24d76221681437b76d61ad5a5",
    "sourceReview:src/features/inventory/warehouse/stocktakes/valuationSchema.ts#c262fb6bbdca1edd1bd31dbd95183d908a94be5018fde9fb39fb02f19ed84d3c",
    "sourceReview:src/features/inventory/warehouse/stocktakes/valuations.ts#10f236d904c4e54b6019957cbd46ba76dc5ae86e0c0bae2268d73db6db020f20",
    "table:inventory_stocktake_lines",
    "table:inventory_stocktakes",
    "table:inventory_valuation_lines",
    "table:inventory_valuation_snapshots",
    "writer:src/app/(app)/inventory/warehouse/stocktakes/page.tsx#query:dynamic",
    "writer:src/features/inventory/warehouse/stocktakes/counts.ts#insert:headers",
    "writer:src/features/inventory/warehouse/stocktakes/counts.ts#insert:lines",
    "writer:src/features/inventory/warehouse/stocktakes/counts.ts#update:headers",
    "writer:src/features/inventory/warehouse/stocktakes/counts.ts#update:lines",
    "writer:src/features/inventory/warehouse/stocktakes/router.ts#query:dynamic",
    "writer:src/features/inventory/warehouse/stocktakes/service.ts#insert:table",
    "writer:src/features/inventory/warehouse/stocktakes/service.ts#update:dynamic",
    "writer:src/features/inventory/warehouse/stocktakes/service.ts#update:warehouse-stocktakes-v1:",
    "writer:src/features/inventory/warehouse/stocktakes/valuations.ts#insert:inventoryValuationLines",
    "writer:src/features/inventory/warehouse/stocktakes/valuations.ts#insert:inventoryValuationSnapshots",
    "writer:src/features/inventory/warehouse/stocktakes/valuations.ts#update:inventoryValuationSnapshots",
  ],
  {
    owner: "inventory stocktakes and valuation",
    categories: [
      "site, bin, part, lot and serial identities; expected, counted and reserved quantities",
      "native counter and approver identifiers, reason and linked immutable stock corrections",
      "restricted valuation amounts, currencies, cost bases and provenance references",
    ],
    subjectRelation:
      "Count observations retain the native staff member who recorded them. Valuation snapshots retain their creator and original inventory basis.",
    purpose: "Reconcile bin counts and preserve point-in-time stock valuation.",
    disclosure:
      "Core scopes warehouse counts and valuation by current native staff, site, and catalog visibility. Valuation history requires separate cost access. The Web surface masks operational details from replay.",
    retention:
      "Closed count observations and valuation snapshots cannot be changed. Reconciliations link to canonical warehouse audit events.",
    externalEffects:
      "Authorized Web commands write warehouse corrections and sealed PostgreSQL snapshots; valuation capture does not alter stock.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
