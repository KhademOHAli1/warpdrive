import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// One functional PG16 fixture, then two destructive fixtures, run sequentially.
// This lane omits the normal shared integration template container.
export default defineConfig({
  root:fileURLToPath(new URL("../../",import.meta.url)),
  test:{include:["src/db/mailMigrationQualification.integration.test.ts"],setupFiles:["./vitest.setup.ts"],environment:"node",maxWorkers:1,testTimeout:240_000,hookTimeout:180_000},
  resolve:{alias:{"@":fileURLToPath(new URL("../",import.meta.url))}},
});
