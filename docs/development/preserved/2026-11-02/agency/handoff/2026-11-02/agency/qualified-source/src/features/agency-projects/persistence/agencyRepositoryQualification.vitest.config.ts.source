import { defineConfig } from "vitest/config";
import schemaConfig from "./agencyPersistence.vitest.config";

// Preparation only: the same isolated native-PG overlay, limited to four qualification cases.
export default defineConfig({
  ...schemaConfig,
  test: {
    ...schemaConfig.test,
    name: "agency-repository-qualification",
    include: [
      "src/features/agency-projects/persistence/projectRepositoryCrm.integration.test.ts",
      "src/features/agency-projects/persistence/projectRepositoryConcurrency.integration.test.ts",
    ],
  },
});
