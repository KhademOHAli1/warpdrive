import { defineConfig } from "vitest/config";
import schemaConfig from "./agencyPersistence.vitest.config";

// The same isolated real-PG template, with repository behavior added to the schema selection.
export default defineConfig({
  ...schemaConfig,
  test: {
    ...schemaConfig.test,
    name: "agency-project-journey",
    include: [
      "src/features/agency-projects/persistence/projectPersistence.integration.test.ts",
      "src/features/agency-projects/persistence/projectReceipts.integration.test.ts",
      "src/features/agency-projects/persistence/projectRepository.integration.test.ts",
    ],
  },
});
