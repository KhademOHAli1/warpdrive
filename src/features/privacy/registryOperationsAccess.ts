import { classifyInventory } from "./registryClassification";

export const operationsAccessEntry = classifyInventory(
  [
    "derived:src/features/inventory/warehouse/legacyScope.ts",
    "derived:src/features/operations-access/scope.ts",
    "derived:src/features/operations-access/ui/OperationsAccessPanel.tsx",
    "sourceReview:drizzle/0134_operations_site_roles.sql#d0e458f9e9cc7525fc8cc42c7918f3ebc610520a7cc020705bd9687cad0b84bc",
    "sourceReview:src/app/(app)/settings/operations-access/page.tsx#a478557ec5c9613e9166dbc5a6904ce4d44fd229285cc664f0be13bddc98f5b9",
    "sourceReview:src/features/inventory/warehouse/legacyScope.ts#ffb9d39de60a57e4bf433614c4c7460c6ccf719cedaa85bec4378fda865c510a",
    "sourceReview:src/features/operations-access/router.ts#6fbfbf4101ecc31bedc1bf1f59fb7f7b93f2e457a094aab16f967e9bc2ec3193",
    "sourceReview:src/features/operations-access/schema.ts#983a640cf54ebe278ba9286edd8c1fa2429fb0563bcd4226cd9f681612f7f2db",
    "sourceReview:src/features/operations-access/scope.ts#965641f3e66c5f5bef8d30c05186a7a4cf3446aabe835768e5940cee5a94c5ac",
    "sourceReview:src/features/operations-access/service.ts#6e4b8487cff7cff83efd81ba021d10adfadacfaf8c1674a3f8df3810aa69de79",
    "sourceReview:src/features/operations-access/ui/OperationsAccessPanel.tsx#b09c7051a31d55ba280d932576b410bb4f9707f7011e52d208f8ddee2b05ff36",
    "table:operations_access_receipts",
    "table:operations_site_grants",
    "writer:src/app/(app)/settings/operations-access/page.tsx#query:none",
    "writer:src/features/operations-access/router.ts#query:dynamic",
    "writer:src/features/operations-access/service.ts#delete:operationsSiteGrants",
    "writer:src/features/operations-access/service.ts#insert:operationsAccessReceipts",
    "writer:src/features/operations-access/service.ts#insert:operationsSiteGrants",
    "writer:src/features/operations-access/ui/OperationsAccessPanel.tsx#delete:changeKey",
  ],
  {
    owner: "site-scoped operations access",
    categories: [
      "site identities, staff IDs and roles, administrator names and staff contact labels",
      "grant and revocation receipts with administrator, subject, site and request IDs",
    ],
    subjectRelation:
      "The records associate accepted staff with roles for a site and identify the administrators who changed access.",
    purpose:
      "Delegate warehouse, asset, purchasing and cost capabilities by site and keep an audit history.",
    disclosure:
      "Workspace admins see the role assignments. Active native staff can read their own effective capabilities. The management panel masks staff and grant details from replay.",
    retention:
      "Assignments persist until revoked or the user is removed. Append-only request receipts preserve the grant and revocation history independently of current assignments.",
    externalEffects:
      "Fresh-authenticated administrator commands commit role changes and audit receipts atomically in PostgreSQL.",
    erasureTask: "DPL-15 / DPL-18 / DPL-21",
  },
);
