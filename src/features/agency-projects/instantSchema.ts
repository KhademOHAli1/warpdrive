import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

function supportedInstant(value: string): boolean {
  if (/\.\d{10}/u.test(value)) return false;
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}

// Validate exact supported instants without rewriting their supplied offset/fraction strings.
export const exactInstantSchema = z.iso.datetime({ offset: true }).max(64).refine(supportedInstant);
