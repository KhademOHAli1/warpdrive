import { err, ok, type Result } from "@/types/result";
import { communicationPreferenceRequestSchema } from "./communicationPreferenceSchemas";
import type { CommunicationPreferenceRequest } from "./communicationPreferenceTypes";

// Ingress data only. Identity, storage and any communication effect remain separate services.
export function parseCommunicationPreferenceRequest(
  input: unknown,
): Result<CommunicationPreferenceRequest, "invalid_communication_preference"> {
  const parsed = communicationPreferenceRequestSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("invalid_communication_preference");
}
