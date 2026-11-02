import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export default defineConfig({
  root: ROOT,
  envDir: false,
  test: {
    name: "agency-persistence",
    globals: false,
    environment: "node",
    setupFiles: [fileURLToPath(new URL("../../../../vitest.setup.ts", import.meta.url))],
    globalSetup: [fileURLToPath(new URL("./agencyPersistence.globalSetup.ts", import.meta.url))],
    include: [
      "src/features/agency-projects/persistence/projectPersistence.integration.test.ts",
      "src/features/agency-projects/persistence/projectReceipts.integration.test.ts",
    ],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
    teardownTimeout: 20_000,
    passWithNoTests: false,
  },
  resolve: { alias: { "@": fileURLToPath(new URL("../../../../src", import.meta.url)) } },
});
