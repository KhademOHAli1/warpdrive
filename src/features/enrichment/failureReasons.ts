import { z } from "zod";
import { type EnrichmentMessages, enrichmentMessagesForLocale } from "./enrichmentMessages";

const reasonsSchema = z.record(z.string(), z.string());

// The per-provider reasons the server put on the error context, as one line. Null when the context
// carries nothing renderable, which leaves the caller on its plain message.
export function failureReasonsText(
  context: Record<string, unknown> | undefined,
  messages: EnrichmentMessages = enrichmentMessagesForLocale("en"),
): string | null {
  const S = messages.dialog;
  const verdicts: Readonly<Record<string, string>> = messages.outcome;
  const parsed = reasonsSchema.safeParse(context?.reasons);
  if (!parsed.success) return null;
  const lines = Object.entries(parsed.data).flatMap(([provider, kind]) => {
    const verdict = verdicts[kind];
    return verdict === undefined ? [] : [S.outcomeLine(provider, verdict)];
  });
  return lines.length === 0 ? null : lines.join(S.reasonSeparator);
}
