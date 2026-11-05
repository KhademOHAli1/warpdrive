import { existsSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { BlockJson } from "@/features/blocks/contracts";
import { err, ok, type Result } from "@/types/result";
import { isBlockJson, matchesResponseSchema, validResponseSchema } from "./responseSchema";

export interface WorkflowCodeInput {
  sourceCode: string;
  inputs: BlockJson;
  outputSchema?: BlockJson;
}
export async function runWorkflowCode(
  input: WorkflowCodeInput,
  signal: AbortSignal,
): Promise<Result<BlockJson, string>> {
  if (
    input.sourceCode.length > 50_000 ||
    JSON.stringify(input.inputs).length > 200_000 ||
    !isBlockJson(input.inputs) ||
    (input.outputSchema !== undefined && !validResponseSchema(input.outputSchema))
  )
    return err("E_WORKFLOW_CODE_INPUT");
  if (signal.aborted) return err("E_WORKFLOW_CODE_ABORTED");
  const production = join(process.cwd(), "dist/workflow-code-worker.mjs");
  const path = existsSync(production)
    ? production
    : join(process.cwd(), "src/features/workflows/v2/codeWorker.ts");
  return new Promise((resolve) => {
    const worker = new Worker(path, { workerData: input });
    let finished = false;
    const finish = (result: Result<BlockJson, string>) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      void worker.terminate();
      resolve(result);
    };
    const abort = () => finish(err("E_WORKFLOW_CODE_ABORTED"));
    const timer = setTimeout(() => finish(err("E_WORKFLOW_CODE_TIMEOUT")), 3000);
    signal.addEventListener("abort", abort, { once: true });
    worker.once("error", () => finish(err("E_WORKFLOW_CODE_FAILED")));
    worker.once("exit", () => finish(err("E_WORKFLOW_CODE_FAILED")));
    worker.once("message", (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("ok" in message) ||
        !("value" in message) ||
        message.ok !== true ||
        !isBlockJson(message.value)
      )
        return finish(err("E_WORKFLOW_CODE_FAILED"));
      if (
        JSON.stringify(message.value).length > 200_000 ||
        (input.outputSchema !== undefined &&
          !matchesResponseSchema(input.outputSchema, message.value))
      )
        return finish(err("E_WORKFLOW_BLOCK_OUTPUT"));
      finish(ok(message.value));
    });
  });
}
