import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Optional isolated local PostgreSQL lane. The ordinary Docker CI lane remains unchanged.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/features/workflows/**/*.integration.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    globalSetup: ["./scripts/workflows-test-setup.ts"],
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
