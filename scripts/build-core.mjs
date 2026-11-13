import { build } from "esbuild";
import { buildOptionsForEntry, selectBuildEntries } from "./build-workers.mjs";

const workflowCodeWorker = selectBuildEntries("web").find(
  (entry) => entry.out === "dist/workflow-code-worker.mjs",
);
if (!workflowCodeWorker) throw new Error("Core workflow code worker entry is missing");

const entries = [
  { in: "src/entrypoints/core-api.ts", out: "dist/core-api.mjs" },
  workflowCodeWorker,
];
await Promise.all(entries.map((entry) => build(buildOptionsForEntry(entry))));
