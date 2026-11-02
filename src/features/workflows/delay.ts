import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import { delayMinutesSchema } from "./registry";
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
