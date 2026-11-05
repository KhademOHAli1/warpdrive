import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { BlockJson, BlockOutput, BlockReference, WorkflowV2RunState } from "./contracts";

const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const invalid = () => err("E_WORKFLOW_V2_BINDING");
const limit = () => err("E_WORKFLOW_V2_BINDING_LIMIT");
type JsonResult = Result<BlockJson, string>;
type Visit = (value: BlockJson, depth: number) => JsonResult;
function object(value: BlockJson | undefined): value is BlockOutput {
  return (
    value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
  );
}
function reference(value: BlockOutput): value is BlockOutput & BlockReference {
  return (
    value.kind === "reference" && typeof value.nodeId === "string" && Array.isArray(value.path)
  );
}
function findOutput(nodeId: string, outputs: WorkflowV2RunState["outputs"], path: string[]) {
  for (let depth = path.length; depth >= 0; depth--) {
    const match = outputs[`${path.slice(0, depth).join("/")}|${nodeId}`];
    if (match !== undefined) return match.output;
  }
  return undefined;
}
function readPath(value: BlockJson | undefined, key: string | number) {
  if (forbidden.has(String(key)) || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value))
    return typeof key === "number" && Number.isInteger(key) && key >= 0 ? value[key] : undefined;
  return Object.hasOwn(value, key) ? value[String(key)] : undefined;
}
function readReference(
  ref: BlockReference,
  outputs: WorkflowV2RunState["outputs"],
  path: string[],
  trigger: BlockOutput,
): JsonResult {
  let value: BlockJson | undefined =
    ref.nodeId === "$trigger" ? trigger : findOutput(ref.nodeId, outputs, path);
  for (const key of ref.path) {
    if (typeof key !== "string" && typeof key !== "number") return invalid();
    value = readPath(value, key);
  }
  return value === undefined ? invalid() : ok(value);
}
function visitTemplate(
  value: BlockOutput,
  resolve: (ref: BlockReference) => JsonResult,
): JsonResult {
  if (typeof value.template !== "string" || !object(value.variables)) return invalid();
  let result = value.template;
  for (const [key, ref] of Object.entries(value.variables)) {
    if (!object(ref) || !reference(ref)) return invalid();
    const resolved = resolve(ref);
    if (!resolved.ok) return resolved;
    if (typeof resolved.value === "object") return err("E_WORKFLOW_V2_BINDING_TYPE");
    result = result.split(`{{${key}}}`).join(String(resolved.value));
    if (result.length > 100_000) return limit();
  }
  return ok(result);
}
function visitArray(values: BlockJson[], depth: number, visit: Visit): JsonResult {
  const output: BlockJson[] = [];
  for (const item of values) {
    const result = visit(item, depth + 1);
    if (!result.ok) return result;
    output.push(result.value);
  }
  return ok(output);
}
function visitObject(value: BlockOutput, depth: number, visit: Visit): Result<BlockOutput, string> {
  const output: BlockOutput = {};
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) return invalid();
    const result = visit(child, depth + 1);
    if (!result.ok) return result;
    output[key] = result.value;
  }
  return ok(output);
}
export function resolveBlockConfig(
  config: BlockOutput,
  outputs: WorkflowV2RunState["outputs"],
  framePath: string[],
  trigger: BlockOutput,
): Result<BlockOutput, string> {
  let count = 0;
  const resolve = (ref: BlockReference) => readReference(ref, outputs, framePath, trigger);
  function visit(value: BlockJson, depth: number): JsonResult {
    if (++count > 20_000 || depth > 20) return limit();
    if (Array.isArray(value)) return visitArray(value, depth, visit);
    if (!object(value)) return ok(value);
    if (value.kind === "literal")
      return Object.hasOwn(value, "value") ? ok(value.value ?? null) : invalid();
    if (value.kind === "reference") return reference(value) ? resolve(value) : invalid();
    if (value.kind === "template") return visitTemplate(value, resolve);
    return visitObject(value, depth, visit);
  }
  return visitObject(config, 0, visit);
}
export function blockReferences(config: BlockJson): BlockReference[] {
  const refs: BlockReference[] = [];
  let count = 0;
  function visit(value: BlockJson, depth: number) {
    if (++count > 20_000 || depth > 20)
      throw new AppError(ERROR_IDS.WORKFLOW_INVALID, "Block binding limit");
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
    } else if (object(value)) {
      if (reference(value)) refs.push(value);
      else if (value.kind !== "literal")
        for (const child of Object.values(value)) visit(child, depth + 1);
    }
  }
  visit(config, 0);
  return refs;
}
