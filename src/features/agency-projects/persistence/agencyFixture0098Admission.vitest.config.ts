import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import listConfig from "./agencyProjectList.vitest.config";

// Only the future one-case fixture-advancement control. The admitted native12/17 selections stay.
export default defineConfig({
  ...listConfig,
  envDir: false,
  cacheDir: ".runtime/agency-fixture-0098-admission-cache",
  test: {
    ...listConfig.test,
    name: "agency-fixture-0098-admission",
    globalSetup: [fileURLToPath(new URL("./agencyFixture0098.globalSetup.ts", import.meta.url))],
    include: [
      "src/features/agency-projects/persistence/agencyFixture0098Admission.integration.test.ts",
    ],
  },
});
