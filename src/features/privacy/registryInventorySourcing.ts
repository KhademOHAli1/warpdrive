import { classifyInventory } from "./registryClassification";

export const inventorySourcingEntry = classifyInventory(
  [
    "derived:src/features/inventory/sourcing/changes.ts",
    "derived:src/features/inventory/sourcing/reads.ts",
    "derived:src/features/inventory/sourcing/scope.ts",
    "derived:src/features/inventory/sourcing/service.ts",
    "derived:src/features/inventory/sourcing/ui/SourcingView.tsx",
    "sourceReview:drizzle/0135_inventory_sourcing.sql#fa01c8092ed3474698ffc7d6c24333d23392b363f5653c6baccbe626d73d7ce1",
    "sourceReview:src/app/(app)/inventory/sourcing/page.tsx#57afea02d162dd0139f2224540e89e31aa6706db153d8e226f5267c23f54f1a8",
    "sourceReview:src/features/inventory/router.ts#5f2726bcf5fdc5f9d33fd065859100e36a0ee21109e8464a43200d18fdce0bb2",
    "sourceReview:src/features/inventory/sourcing/changes.ts#4b492c00f571d56abe61b3a2120800614e5ae6b5fa757fc1b514d6bd6ee375b6",
    "sourceReview:src/features/inventory/sourcing/reads.ts#9e4a25fa93632b25c03d9af0a395f7a005f7b9dea5b437602d875ac3626359fd",
    "sourceReview:src/features/inventory/sourcing/router.ts#0319fbc1b20dcea1312ceff60cbdb863aecb2ed7909712b54f0e3436313c8519",
    "sourceReview:src/features/inventory/sourcing/schema.ts#dcbc5272317ea28bb62ff9e0671728d63cbedca08b0555c34f864d669dede14e",
    "sourceReview:src/features/inventory/sourcing/scope.ts#885a21ca6d0a61491cf0648ab344bdac9511b6f83e9c37b83e0f4bb67e2f7ff4",
    "sourceReview:src/features/inventory/sourcing/service.ts#2321e4193c24ed442730a7306abbd94c6ea3e6eb5f7e02dafb9bc1260c7d47cd",
    "sourceReview:src/features/inventory/sourcing/ui/SourcingView.tsx#c11d52fb154d47ce881128a18b8b5ee30a7be3815ae969f077138c28aaf198c5",
    "table:inventory_item_cost_overrides",
    "table:inventory_manufacturer_parts",
    "table:inventory_supplier_offers",
    "table:inventory_supplier_price_tiers",
    "writer:src/app/(app)/inventory/sourcing/page.tsx#query:dynamic",
    "writer:src/features/inventory/sourcing/changes.ts#delete:table",
    "writer:src/features/inventory/sourcing/changes.ts#insert:table",
    "writer:src/features/inventory/sourcing/changes.ts#update:table",
    "writer:src/features/inventory/sourcing/router.ts#query:dynamic",
    "writer:src/features/inventory/sourcing/scope.ts#execute:dynamic",
    "writer:src/features/inventory/sourcing/service.ts#insert:table",
    "writer:src/features/inventory/sourcing/service.ts#update:dynamic",
    "writer:src/features/inventory/sourcing/service.ts#update:inventory-sourcing-v1\u0000",
  ],
  {
    owner: "inventory sourcing",
    categories: [
      "site and part revision references, visible CRM organization links, supplier and manufacturer part numbers",
      "pack sizes, source approval and availability, restricted cost amounts, currencies, and quantity tiers",
      "native actor and fingerprinted request receipts",
    ],
    subjectRelation:
      "Sourcing links existing CRM organizations and records staff command receipts.",
    purpose:
      "Compare approved sources and quote quantities for a particular site and part revision.",
    disclosure:
      "Core checks active native staff, site roles, revision visibility and existing CRM organization access. Only explicit cost authority can read amounts, currencies or tier thresholds. Sourcing content is masked from replay.",
    retention:
      "Disabled offers retain their existing identities. Current tiers and overrides remain in PostgreSQL until updated or removed by an authorized buyer with cost access.",
    externalEffects:
      "Authenticated typed Web commands commit sourcing changes and replay receipts atomically.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
