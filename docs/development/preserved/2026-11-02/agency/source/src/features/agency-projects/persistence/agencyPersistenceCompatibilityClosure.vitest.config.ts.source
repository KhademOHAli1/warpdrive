import { defineConfig } from "vitest/config";
import schemaConfig from "./agencyPersistence.vitest.config";

// Only the four compatibility cases and thirteen affected immutable-audit/receipt cases.
export default defineConfig({
  ...schemaConfig,
  test: {
    ...schemaConfig.test,
    name: "agency-persistence-compatibility-closure",
    include: [
      "src/features/agency-projects/persistence/projectPersistenceCompatibility.integration.test.ts",
      "src/features/agency-projects/persistence/projectReceipts.integration.test.ts",
    ],
  },
});
