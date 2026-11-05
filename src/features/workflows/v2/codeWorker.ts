import { parentPort, workerData } from "node:worker_threads";
import RELEASE from "@jitl/quickjs-singlefile-cjs-release-sync";
import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import type { WorkflowCodeInput } from "./codeSandbox";

// Guest code runs in QuickJS WASM with no host functions, module loader, network,
// filesystem, or process object. The parent independently terminates this worker.
async function execute(input: WorkflowCodeInput): Promise<unknown> {
  const variant = newVariant(RELEASE, {
    wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
  });
  const engine = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 150;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  try {
    const { Transpiler } = (
      globalThis as typeof globalThis & {
        Bun: {
          Transpiler: new (options: {
            loader: "ts";
            target: "browser";
            define: Record<string, string>;
          }) => { transformSync(source: string): string };
        };
      }
    ).Bun;
    const code = new Transpiler({
      loader: "ts",
      target: "browser",
      define: { require: "undefined" },
    }).transformSync(input.sourceCode);
    // Serializing inside the guest keeps getters, promises and toJSON callbacks
    // subject to the same instruction and memory limits as main itself.
    const wrapped = `${code}\n;globalThis.__workflowResult = undefined; Promise.resolve(main(${JSON.stringify(input.inputs)})).then(value => { globalThis.__workflowResult = JSON.stringify({value}); });`;
    const evaluated = context.evalCode(wrapped, "workflow.js", { type: "module" });
    if (evaluated.error !== undefined) {
      evaluated.error.dispose();
      throw new TypeError("Guest execution failed");
    }
    evaluated.value.dispose();
    for (let index = 0; runtime.hasPendingJob() && index < 1000; index++) {
      const jobs = runtime.executePendingJobs(1);
      if (jobs.error !== undefined) {
        jobs.error.dispose();
        throw new TypeError("Guest execution failed");
      }
    }
    const handle = context.getProp(context.global, "__workflowResult");
    try {
      const serialized = context.getString(handle);
      if (serialized.length > 200_000) throw new RangeError("Guest output exceeds budget");
      const output: unknown = JSON.parse(serialized);
      if (typeof output !== "object" || output === null || !("value" in output))
        throw new TypeError("Invalid guest JSON");
      return output.value;
    } finally {
      handle.dispose();
    }
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
try {
  const value = await execute(workerData as WorkflowCodeInput);
  parentPort?.postMessage({ ok: true, value });
} catch {
  parentPort?.postMessage({ ok: false, value: null });
}
