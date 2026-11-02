import { err, ok, type Result } from "@/types/result";
import { manualContextSchema } from "./manualCommunicationContext";
import { manualActionSchema, manualCommandSchema } from "./manualCommunicationSchemas";
import type { ManualAction, ManualCommand, ManualContext } from "./manualCommunicationTypes";

export { applyManualCommunicationCommand } from "./manualCommunicationPolicy";

export function parseManualCommunicationAction(
  input: unknown,
): Result<ManualAction, "invalid_manual_action"> {
  const parsed = manualActionSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("invalid_manual_action");
}
export function parseManualCommunicationCommand(
  input: unknown,
): Result<ManualCommand, "invalid_manual_command"> {
  const parsed = manualCommandSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("invalid_manual_command");
}
export function parseManualCommunicationContext(
  input: unknown,
): Result<ManualContext, "invalid_manual_context"> {
  const parsed = manualContextSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("invalid_manual_context");
}
