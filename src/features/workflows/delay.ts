import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import {
  type DelayDurationUnit,
  delayDurationMilliseconds,
  delayDurationUnits,
  delayUntilDate,
  maxDelayMilliseconds,
} from "./delayConfig";
import { isMappingDate } from "./mappingLiteralIntent";
import { actionRegistry, delayMinutesSchema, delayScheduleConfigSchema } from "./registry";
import { type RunMappingContext, resolveRunBinding } from "./runBindings";
import type { RunOutputs } from "./runTypes";
import { type Binding, bindingSchema } from "./schemas";

type DelayMappingContext = Omit<RunMappingContext, "path"> & { outputs: RunOutputs };

export function delayResumeAt(raw: unknown, now: Date) {
  const binding = bindingSchema.safeParse(raw);
  if (!binding.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  if (binding.data.kind !== "value") return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const minutes = delayMinutesSchema.safeParse(binding.data.value);
  if (!minutes.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const resumeAt = new Date(now.getTime() + minutes.data * 60_000);
  return Number.isFinite(resumeAt.getTime()) ? ok(resumeAt) : err(ERROR_IDS.WORKFLOW_INVALID);
}

function delayBinding(
  binding: Binding,
  path: readonly string[],
  context: DelayMappingContext | undefined,
) {
  if (binding.kind === "value") return ok(binding.value);
  if (context === undefined) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const resolved = resolveRunBinding(binding, context.outputs, { ...context, path });
  if (resolved.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
  return resolved.state === "value" ? ok(resolved.value) : err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
}

function configuredScheduleAt(raw: unknown, now: Date, context?: DelayMappingContext) {
  const parsed = delayScheduleConfigSchema.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const config = parsed.data;
  if (config.delayType === "SCHEDULED_DATE") {
    const resolved = delayBinding(config.scheduledDateTime, ["scheduledDateTime"], context);
    if (!resolved.ok) return resolved;
    const requested = delayUntilDate(
      config.scheduledDateTime.kind === "reference" && isMappingDate(resolved.value)
        ? `${resolved.value}T00:00:00.000Z`
        : resolved.value,
    );
    if (requested === null) return err(ERROR_IDS.WORKFLOW_INVALID);
    const elapsed = requested.getTime() - now.getTime();
    return elapsed >= 0 && elapsed <= maxDelayMilliseconds
      ? ok(requested)
      : err(ERROR_IDS.WORKFLOW_INVALID);
  }
  const amounts: Partial<Record<DelayDurationUnit, unknown>> = {};
  for (const unit of delayDurationUnits) {
    const binding = config.duration[unit];
    if (binding === undefined) continue;
    const resolved = delayBinding(binding, ["duration", unit], context);
    if (!resolved.ok) return resolved;
    amounts[unit] = resolved.value;
  }
  const elapsed = delayDurationMilliseconds(amounts);
  if (elapsed === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  const deadline = new Date(now.getTime() + elapsed);
  return Number.isFinite(deadline.getTime()) ? ok(deadline) : err(ERROR_IDS.WORKFLOW_INVALID);
}

// Only initial arming uses the current database clock and future horizon. An
// armed wait must instead retain its stored deadline across subsequent wakes.
export function delayScheduleAt(rawConfig: unknown, now: Date, context?: DelayMappingContext) {
  if (!Number.isFinite(now.getTime())) return err(ERROR_IDS.WORKFLOW_INVALID);
  if (rawConfig === null || typeof rawConfig !== "object" || Array.isArray(rawConfig))
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (Object.hasOwn(rawConfig, "delayType")) return configuredScheduleAt(rawConfig, now, context);
  if (!actionRegistry.delay.config.safeParse(rawConfig).success)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (!Object.hasOwn(rawConfig, "until"))
    return delayResumeAt((rawConfig as Record<string, unknown>).minutes, now);
  const binding = bindingSchema.safeParse((rawConfig as Record<string, unknown>).until);
  if (!binding.success || binding.data.kind !== "value") return err(ERROR_IDS.WORKFLOW_INVALID);
  const requested = delayUntilDate(binding.data.value);
  if (requested === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  const elapsed = requested.getTime() - now.getTime();
  return elapsed > maxDelayMilliseconds ? err(ERROR_IDS.WORKFLOW_INVALID) : ok(requested);
}
