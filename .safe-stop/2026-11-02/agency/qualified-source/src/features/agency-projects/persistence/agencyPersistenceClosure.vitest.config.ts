import { defineConfig } from "vitest/config";
import schemaConfig from "./agencyPersistence.vitest.config";

// The actor/recorder FK change affects receipts and repository writes; project checks are unchanged.
export default defineConfig({
  ...schemaConfig,
  test: {
    ...schemaConfig.test,
    name: "agency-persistence-closure",
    include: [
      "src/features/agency-projects/persistence/projectReceipts.integration.test.ts",
      "src/features/agency-projects/persistence/projectRepository.integration.test.ts",
    ],
  },
});
