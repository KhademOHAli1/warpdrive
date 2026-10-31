import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import type { RunOutputs } from "./runTypes";
import { bindingSchema } from "./schemas";

export function stringBinding(raw: unknown, outputs: RunOutputs) {
  const parsed = bindingSchema.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const binding = parsed.data;
  const value =
    binding.kind === "value" ? binding.value : outputs[binding.nodeId]?.[binding.path.join(".")];
  return typeof value === "string" ? ok(value) : err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
}

export function uuidBinding(raw: unknown, outputs: RunOutputs) {
  const result = stringBinding(raw, outputs);
  if (!result.ok) return result;
  return z.string().uuid().safeParse(result.value).success
    ? result
    : err(ERROR_IDS.WORKFLOW_INVALID);
}
