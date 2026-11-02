import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const baseline = "/private/tmp/warpdrive-builder-ux-20261031";

export default defineConfig({
  root: baseline,
  cacheDir: root + "/.workflow-qa-cache",
  plugins: [react()],
  resolve: { alias: { "@": baseline + "/src" } },
  test: {
    include: [
      root + "/src/features/workflows/ui/WorkflowDialogs.focus.test.tsx",
      root + "/src/features/workflows/ui/RunTrace.selection.test.tsx",
    ],
    setupFiles: [baseline + "/vitest.setup.ts"],
    maxWorkers: 1,
  },
});
