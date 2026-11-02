import { defineConfig } from "vitest/config";
import persistence from "./agencyPersistence.vitest.config";

export default defineConfig({
  ...persistence,
  envDir: false,
  cacheDir: ".runtime/agency-project-list-native-cache",
  test: {
    ...persistence.test,
    name: "agency-project-list",
    include: [
      "src/features/agency-projects/persistence/projectList.integration.test.ts",
      "src/features/agency-projects/persistence/projectListPaging.integration.test.ts",
    ],
  },
});
