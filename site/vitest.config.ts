import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The marketing site is all component tests (happy-dom). No Postgres, no integration lane, unlike the
// app's split config. `@` resolves to ./src to match tsconfig paths.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    globals: false,
    environment: "happy-dom",
    // Vitest's fork watchdog needs an IPC operation Bun does not implement.
    pool: "threads",
    setupFiles: ["./vitest.setup.ts"],
  },
});
