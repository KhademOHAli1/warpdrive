import { defineConfig } from "vitest/config";
import schemaConfig from "./agencyPersistence.vitest.config";

export default defineConfig({
  ...schemaConfig,
  test: {
    ...schemaConfig.test,
    name: "agency-persistence-compatibility-and-repository",
    include: [
      "src/features/agency-projects/persistence/projectPersistenceCompatibility.integration.test.ts",
      "src/features/agency-projects/persistence/projectRepositoryCrm.integration.test.ts",
      "src/features/agency-projects/persistence/projectRepositoryConcurrency.integration.test.ts",
    ],
  },
});
