import { classifyInventory } from "./registryClassification";

export const bomPlanningEntry = classifyInventory(
  [
    "derived:src/features/inventory/bom/graph.ts",
    "derived:src/features/inventory/bom/legacyBuilds.ts",
    "derived:src/features/inventory/bom/planning.ts",
    "derived:src/features/inventory/bom/reads.ts",
    "derived:src/features/inventory/bom/ui/BomPlanViews.tsx",
    "derived:src/features/inventory/releases/approvedBom.ts",
    "derived:src/features/inventory/releases/approvedBomGraph.ts",
    "sourceReview:src/app/(app)/inventory/bom/page.tsx#3192b29826dafb0ceb0391d81fd7711d94cd0a16500fd22be06c54e0cca92052",
    "sourceReview:src/features/inventory/bom/graph.ts#5d89a5f0731b88267e26c2743f582262fbe53124de871b9605e2ae81c02afff1",
    "sourceReview:src/features/inventory/bom/legacyBuilds.ts#877853f85254d6b8529d2a07b83f6e58f7c9392eed69f3fba6caffdffc9788c2",
    "sourceReview:src/features/inventory/bom/planning.ts#3c616d22c43a084dcaae28abde8a668582708a4121a1aa1abfb4e28269c10267",
    "sourceReview:src/features/inventory/bom/reads.ts#9caecd42333060137bfa84e235a28680a143fb7e74720990f65f2c24ad1c0193",
    "sourceReview:src/features/inventory/bom/router.ts#5bfb50a29e721c11fcf121ef9d16fb0ee63bd2fa01c3803cc37cf7c3ca5fd3a9",
    "sourceReview:src/features/inventory/bom/ui/BomPlanViews.tsx#87341e295d6e9c9667c86093513e700b1c7b72862d16d43def4911b450c26e3e",
    "sourceReview:src/features/inventory/bom/ui/BomPlanner.tsx#858823efc33c5d0559789b81b3c49616d0d45503d7db47e34e65dc333ba3f4fb",
    "sourceReview:src/features/inventory/releases/approvedBom.ts#b5e3d4c8fe9dd5d3acf82695aebc6e92e7d4c75f162880639d4a09c136bee42f",
    "sourceReview:src/features/inventory/releases/approvedBomGraph.ts#f659090f9cf0160fecb6be2e6c817d3f7d79b509810032c2ac0fd1a291c92484",
    "sourceReview:src/features/inventory/releases/service.ts#3059de39b618b6ce4ded1f64cd8e8f07b4926c05c4ee0bed76ad8307e13c001b",
    "sourceReview:src/features/inventory/releases/ui/ManufacturingReleasesLive.tsx#762ce27d1a98b1491a73f31feb877d32fe713b7c918d7f7197a0284e0d27de92",
    "writer:src/app/(app)/inventory/bom/page.tsx#query:dynamic",
    "writer:src/features/inventory/bom/graph.ts#delete:id",
    "writer:src/features/inventory/bom/planning.ts#delete:key",
    "writer:src/features/inventory/bom/reads.ts#execute:sql",
    "writer:src/features/inventory/bom/router.ts#query:dynamic",
    "writer:src/features/inventory/bom/ui/BomPlanner.tsx#update:dynamic",
    "writer:src/features/inventory/releases/approvedBomGraph.ts#delete:dynamic",
  ],
  {
    owner: "engineering BOM planning",
    categories: [
      "immutable approved product revisions and component references, quantities, units, and assembly relationships",
      "site-restricted part availability and manufacturing demand",
    ],
    subjectRelation:
      "Staff access is recomputed from current native account, engineering, catalog, and site scope.",
    purpose: "Plan component and subassembly quantities from an approved engineering release.",
    disclosure:
      "Recursive planning and where-used results require admitted catalog parts and current release grants. Site balances require warehouse read access at that site. The Web surface masks planning details from replay.",
    retention:
      "Planning reads existing immutable releases and point-in-time eligible balances. The planning request creates no production order or reservation.",
    externalEffects:
      "The planner uses the typed Core read boundary. Existing release approval seals BOM metadata from verified artifact bytes.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
