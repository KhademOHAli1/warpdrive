import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import { configurationLimits } from "./configurationLimits";
import { delayUntilDate } from "./delayConfig";
import { actionRegistry, delayMinutesSchema } from "./registry";
import { bindingSchema } from "./schemas";

export function delayResumeAt(raw: unknown, now: Date) {
  const binding = bindingSchema.safeParse(raw);
  if (!binding.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  if (binding.data.kind !== "value") return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const minutes = delayMinutesSchema.safeParse(binding.data.value);
  if (!minutes.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const resumeAt = new Date(now.getTime() + minutes.data * 60_000);
  return Number.isFinite(resumeAt.getTime()) ? ok(resumeAt) : err(ERROR_IDS.WORKFLOW_INVALID);
}

// Only initial arming uses the current database clock and future horizon. An
// armed wait must instead retain its stored deadline across subsequent wakes.
export function delayScheduleAt(rawConfig: unknown, now: Date) {
  if (!Number.isFinite(now.getTime())) return err(ERROR_IDS.WORKFLOW_INVALID);
  if (!actionRegistry.delay.config.safeParse(rawConfig).success)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (rawConfig === null || typeof rawConfig !== "object" || Array.isArray(rawConfig))
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (!Object.hasOwn(rawConfig, "until"))
    return delayResumeAt((rawConfig as Record<string, unknown>).minutes, now);
  const binding = bindingSchema.safeParse((rawConfig as Record<string, unknown>).until);
  if (!binding.success || binding.data.kind !== "value") return err(ERROR_IDS.WORKFLOW_INVALID);
  const requested = delayUntilDate(binding.data.value);
  if (requested === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  const elapsed = requested.getTime() - now.getTime();
  return elapsed > configurationLimits.waitMax * 60_000
    ? err(ERROR_IDS.WORKFLOW_INVALID)
    : ok(requested);
}
